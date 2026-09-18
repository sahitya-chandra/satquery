import sharp from "sharp";
import { fromArrayBuffer } from "geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import proj4 from "proj4";

export const MAX_PIXELS = 4_000_000;
export const ANALYSIS_SIDE = 768;
export type InputImage = { name: string; data: Buffer };
type Projection = ReturnType<typeof toProj4>;
// x = a * column + b * row + c; y = d * column + e * row + f.
export type Grid = [number, number, number, number, number, number];
export type Raster = {
  data: Uint8Array; valid: Uint8Array; width: number; height: number;
  metadata: Record<string, unknown>; warnings: string[];
  grid?: Grid; projection?: Projection;
};

export function percentile(values: ArrayLike<number>, fraction: number) {
  const sorted = Float64Array.from(values).filter(Number.isFinite).sort();
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width * height) || width < 1 || height < 1 || width * height > MAX_PIXELS) {
    throw new Error("Images must contain between 1 and 4 million pixels.");
  }
  const scale = Math.min(1, ANALYSIS_SIDE / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

export async function loadImage(input: InputImage): Promise<Raster> {
  const warnings: string[] = [];
  if (/\.tiff?$/i.test(input.name)) {
    const tiff = await fromArrayBuffer(Uint8Array.from(input.data).buffer);
    const image = await tiff.getImage();
    const originalWidth = image.getWidth(), originalHeight = image.getHeight();
    const [width, height] = dimensions(originalWidth, originalHeight);
    const bands = image.getSamplesPerPixel();
    if (bands < 1 || bands > 16 || originalWidth * originalHeight * bands > 16_000_000) {
      throw new Error("TIFF exceeds the 16-band or 16-million-sample limit.");
    }
    warnings.push("TIFF previews use the first three bands (or first band for grayscale), independently contrast-stretched. Band order and natural colours are not verified; radiometric values are not sent to the model.");
    const samples = bands >= 3 ? [0, 1, 2] : [0];
    const raw = await image.readRasters({ samples, width, height, interleave: true });
    const nodata = image.getGDALNoData();
    const valid = new Uint8Array(width * height).fill(1);
    const data = new Uint8Array(width * height * 3);
    for (let c = 0; c < samples.length; c++) {
      const band = Float64Array.from({ length: width * height }, (_, i) => {
        const value = Number(raw[i * samples.length + c]);
        if (!Number.isFinite(value) || value === nodata) { valid[i] = 0; return NaN; }
        return value;
      });
      const low = percentile(band, 0.02), high = percentile(band, 0.98);
      for (let i = 0; i < band.length; i++) {
        const value = high > low ? Math.round(Math.max(0, Math.min(1, (band[i] - low) / (high - low))) * 255) : 0;
        for (const channel of samples.length === 1 ? [0, 1, 2] : [c]) data[i * 3 + channel] = value;
      }
    }
    const keys = image.getGeoKeys() || {};
    const directory = image.getFileDirectory();
    let grid: Grid | undefined;
    const matrix = directory.getValue("ModelTransformation");
    const tie = directory.getValue("ModelTiepoint"), scale = directory.getValue("ModelPixelScale");
    if (matrix) {
      grid = [matrix[0], matrix[1], matrix[3], matrix[4], matrix[5], matrix[7]];
    } else if (tie && scale) {
      grid = [scale[0], 0, tie[3] - tie[0] * scale[0], 0, -scale[1], tie[4] + tie[1] * scale[1]];
    }
    if (grid && keys.GTRasterTypeGeoKey === 2) {
      grid[2] -= (grid[0] + grid[1]) / 2;
      grid[5] -= (grid[3] + grid[4]) / 2;
    }
    if (grid) {
      grid[0] *= originalWidth / width; grid[3] *= originalWidth / width;
      grid[1] *= originalHeight / height; grid[4] *= originalHeight / height;
      if (!grid.every(Number.isFinite) || Math.abs(grid[0] * grid[4] - grid[1] * grid[3]) < 1e-15) {
        throw new Error("Invalid GeoTIFF affine grid.");
      }
    }
    let projection: Projection | undefined;
    if (keys.GTModelTypeGeoKey) {
      try {
        if (![1, 2].includes(keys.GTModelTypeGeoKey)) throw new Error("Only projected and geographic CRS are supported");
        const converted = toProj4(keys);
        if (Object.keys(converted.errors).length) throw new Error("Unsupported CRS parameters");
        proj4(converted.proj4);
        projection = converted;
      } catch { warnings.push("GeoTIFF CRS could not be resolved; geographic alignment and ground area are unavailable."); }
    }
    const corners = grid ? [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => world(grid, x, y)) : [];
    const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey;
    const metadata = {
      name: input.name, format: grid ? "GeoTIFF" : "TIFF", width: originalWidth, height: originalHeight,
      analysis_width: width, analysis_height: height, bands, dtype: raw.constructor.name,
      is_geotiff: Boolean(grid), crs: epsg && epsg !== 32767 ? `EPSG:${epsg}` : projection?.proj4 || null,
      crs_is_projected: Boolean(projection && !projection.isGCS),
      nodata: Number.isFinite(nodata) ? nodata : null,
      transform: grid || null,
      pixel_resolution: grid ? { x: Math.hypot(grid[0], grid[3]), y: Math.hypot(grid[1], grid[4]) } : null,
      bounds: corners.length ? { left: Math.min(...corners.map(p => p[0])), right: Math.max(...corners.map(p => p[0])), bottom: Math.min(...corners.map(p => p[1])), top: Math.max(...corners.map(p => p[1])) } : null,
    };
    if (width !== originalWidth || height !== originalHeight) warnings.push("Image downsampled for bounded serverless analysis; small features may be lost in model previews.");
    if (valid.includes(0)) warnings.push("Nodata pixels are shown in grey and are not visual evidence.");
    return { data, valid, width, height, metadata, warnings, grid, projection };
  }
  const decoder = sharp(input.data, { limitInputPixels: MAX_PIXELS, failOn: "error" });
  const meta = await decoder.metadata();
  if (!["png", "jpeg"].includes(meta.format || "")) throw new Error("Expected a PNG, JPEG or TIFF image.");
  const [width, height] = dimensions(meta.width || 0, meta.height || 0);
  const { data } = await decoder.resize(width, height, { fit: "fill" }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = new Uint8Array(width * height * 3), valid = new Uint8Array(width * height);
  for (let i = 0; i < valid.length; i++) {
    rgb.set(data.subarray(i * 4, i * 4 + 3), i * 3);
    valid[i] = Number(data[i * 4 + 3] > 0);
  }
  if (width !== meta.width || height !== meta.height) warnings.push("Image downsampled for bounded serverless analysis; small features may be lost in model previews.");
  return { data: rgb, valid, width, height, warnings, metadata: { name: input.name, format: meta.format?.toUpperCase(), width: meta.width, height: meta.height, analysis_width: width, analysis_height: height, bands: meta.channels, is_geotiff: false, crs: null, crs_is_projected: false, bounds: null, pixel_resolution: null, nodata: null, dtype: "uint8" } };
}

function world(grid: Grid, x: number, y: number): [number, number] {
  return [grid[0] * x + grid[1] * y + grid[2], grid[3] * x + grid[4] * y + grid[5]];
}

export function alignPair(first: Raster, second: Raster): Raster {
  const data = new Uint8Array(first.width * first.height * 3), valid = new Uint8Array(first.width * first.height);
  const geo = first.grid && second.grid;
  if (geo && (!first.projection || !second.projection)) throw new Error("Cannot align GeoTIFFs with unresolved coordinate systems.");
  const sameProjection = first.projection?.proj4 === second.projection?.proj4
    && first.projection?.conversionParameters.x === second.projection?.conversionParameters.x
    && first.projection?.conversionParameters.y === second.projection?.conversionParameters.y;
  const project = geo && !sameProjection ? proj4(first.projection!.proj4, second.projection!.proj4) : undefined;
  const sameGrid = geo && sameProjection && first.width === second.width && first.height === second.height && first.grid!.every((v, i) => Math.abs(v - second.grid![i]) < 1e-8);
  if (sameGrid) return second;
  for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++) {
    let sx = (x + 0.5) * second.width / first.width - 0.5;
    let sy = (y + 0.5) * second.height / first.height - 0.5;
    if (geo) {
      let point = world(first.grid!, x + 0.5, y + 0.5);
      if (project) {
        const a = first.projection!.conversionParameters, b = second.projection!.conversionParameters;
        point = project.forward([point[0] * a.x, point[1] * a.y]);
        point = [point[0] / b.x, point[1] / b.y];
      }
      const [a, b, c, d, e, f] = second.grid!;
      const dx = point[0] - c, dy = point[1] - f, det = a * e - b * d;
      sx = (e * dx - b * dy) / det - 0.5; sy = (-d * dx + a * dy) / det - 0.5;
    }
    if (!Number.isFinite(sx + sy) || sx < -0.5 || sy < -0.5 || sx >= second.width - 0.5 || sy >= second.height - 0.5) continue;
    const ix = Math.max(0, Math.min(second.width - 1, Math.round(sx))), iy = Math.max(0, Math.min(second.height - 1, Math.round(sy)));
    const source = iy * second.width + ix, target = y * first.width + x;
    valid[target] = second.valid[source];
    data.set(second.data.subarray(source * 3, source * 3 + 3), target * 3);
  }
  if (geo && !valid.some((value, i) => value && first.valid[i])) throw new Error("The GeoTIFFs have no valid overlapping pixels.");
  const note = geo ? "Second GeoTIFF reprojected to the first analysis grid with nearest-neighbour resampling." : "Pair alignment is assumed; the second image is resized when needed.";
  return { ...second, data, valid, width: first.width, height: first.height, warnings: [...second.warnings, note], metadata: { ...second.metadata, analysis_width: first.width, analysis_height: first.height, alignment_note: note } };
}

export async function visual(label: string, data: Uint8Array, width: number, height: number, maxSide = 384) {
  const png = await sharp(data, { raw: { width, height, channels: 3 } }).resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return { id: label.toLowerCase().replaceAll(" ", "-"), label, src: `data:image/png;base64,${png.toString("base64")}` };
}
