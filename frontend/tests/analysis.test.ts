import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { writeArrayBuffer } from "geotiff";
import proj4 from "proj4";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import { runAnalysis, routeTask } from "../lib/analysis";
import { alignPair, loadImage, type Grid } from "../lib/analysis/images";
import { changeMask, opticalMasks, percentage } from "../lib/analysis/masks";

async function scene(water = true, width = 96, height = 96) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    raw.set(water && x > width / 4 && x < width * 3 / 4 && y > height / 4 && y < height * 3 / 4 ? [24, 92, 180] : [88, 146, 64], (y * width + x) * 3);
  }
  return { name: "scene.png", data: await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer() };
}

function geotiff(x = 500000, epsg = 32643, nodata = false) {
  const pixels = Float32Array.from({ length: 96 * 96 * 3 }, (_, i) => nodata && i < 96 * 3 ? NaN : 20 + (i % 200));
  return { name: "raster.tif", data: Buffer.from(writeArrayBuffer(pixels, {
    width: 96, height: 96, SamplesPerPixel: 3, BitsPerSample: [32, 32, 32], SampleFormat: [3, 3, 3],
    PhotometricInterpretation: 2, ModelPixelScale: [10, 10, 0], ModelTiepoint: [0, 0, 0, x, 2000000, 0],
    GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: epsg, GTRasterTypeGeoKey: 1, ...(nodata ? { GDAL_NODATA: "nan\0" } : {}),
  })) };
}

for (const [names, mode, task] of [
  [["single_optical.png"], "Auto Detect", "SINGLE_IMAGE_VQA"],
  [["change_before.png", "change_after.png"], "Bi-temporal Change", "BI_TEMPORAL_CHANGE"],
  [["fusion_optical.png", "fusion_sar.png"], "Optical-SAR Pair", "OPTICAL_SAR_FUSION"],
] as const) {
  test(`${task} returns decodable evidence and a consistent report`, async () => {
    const images = await Promise.all(names.map(async name => ({ name, data: await readFile(new URL(`../public/demo_data/${name}`, import.meta.url)) })));
    const { status, payload } = await runAnalysis({ images, analysis_mode: mode, query: "What is visible?" });
    assert.equal(status, 200); assert.equal(payload.result?.task, task);
    assert.ok(Number(payload.result?.changed_or_detected_percentage) > 0);
    assert.equal(JSON.parse(payload.report!).answer, payload.result?.answer);
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 4_000_000);
    for (const item of payload.visuals) {
      const metadata = await sharp(Buffer.from(item.src.split(",")[1], "base64")).metadata();
      assert.equal(metadata.format, "png"); assert.ok(metadata.width! <= 384);
    }
  });
}

test("water and vegetation masks locate synthetic regions", async () => {
  const raster = await loadImage(await scene());
  const masks = opticalMasks(raster);
  assert.ok(percentage(masks.water, raster.valid) > 20);
  assert.ok(percentage(masks.water, raster.valid) < 30);
  assert.ok(percentage(masks.vegetation, raster.valid) > 65);
  assert.equal(masks.water[48 * 96 + 48], 1);
  assert.equal(masks.water[5 * 96 + 5], 0);
});

test("grounding returns a bounding box for water", async () => {
  const { payload } = await runAnalysis({ images: [await scene()], analysis_mode: "Single Image", query: "Highlight water" });
  assert.equal(payload.result?.task, "TEXT_GUIDED_GROUNDING");
  assert.ok(Array.isArray(payload.result?.bbox));
});

test("identical images have zero change; a localized edit produces change", async () => {
  const first = await loadImage(await scene(false)), second = await loadImage(await scene());
  assert.equal(percentage(changeMask(first, first), first.valid), 0);
  const changed = changeMask(first, second);
  assert.ok(percentage(changed, first.valid) > 15);
  assert.ok(percentage(changed, first.valid) < 40);
});

test("ambiguous auto-detection does not choose a task silently", () => {
  assert.equal(routeTask(2, "Auto Detect", "compare images").task, "UNSUPPORTED");
  assert.equal(routeTask(2, "Auto Detect", "what changed in the radar images").task, "UNSUPPORTED");
  assert.equal(routeTask(2, "Bi-temporal Change", "what changed in radar").task, "BI_TEMPORAL_CHANGE");
});

test("bad files and missing pairs return validation errors", async () => {
  for (const [images, analysis_mode] of [
    [[{ name: "broken.png", data: Buffer.from("bad") }], "Single Image"],
    [[await scene()], "Bi-temporal Change"],
    [[], "Auto Detect"],
  ] as const) {
    const result = await runAnalysis({ images: [...images], analysis_mode, query: "" });
    assert.equal(result.status, 400); assert.equal(result.payload.ok, false);
  }
});

test("ordinary pairs resize to the first grid", async () => {
  const first = await loadImage(await scene()), second = await loadImage(await scene(true, 64, 64));
  const aligned = alignPair(first, second);
  assert.equal(aligned.width, first.width); assert.equal(aligned.height, first.height);
  assert.equal(aligned.data.length, first.data.length);
});

test("GeoTIFF projected area and NaN nodata survive JSON serialization", async () => {
  const input = geotiff(500000, 32643, true);
  const raster = await loadImage(input);
  assert.equal(raster.metadata.crs, "EPSG:32643");
  assert.ok(raster.projection, JSON.stringify(raster.warnings));
  assert.equal(raster.valid[0], 0);
  const { payload, status } = await runAnalysis({ images: [input], query: "What is visible?", analysis_mode: "Single Image" });
  assert.equal(status, 200);
  const area = payload.result?.area_measurement as { available: boolean; area_square_metres: number };
  assert.equal(area.available, true);
  assert.ok(Number.isFinite(area.area_square_metres));
  assert.doesNotThrow(() => JSON.parse(payload.report!));
});

test("GeoTIFF alignment rejects disjoint grids and resamples overlapping grids", async () => {
  const first = await loadImage(geotiff());
  assert.throws(() => alignPair(first, { ...first, grid: [10, 0, 600000, 0, -10, 2000000] }), /overlap/);
  const aligned = alignPair(first, await loadImage(geotiff(500100)));
  assert.equal(aligned.valid[0], 0);
  assert.equal(aligned.valid[20], 1);
});

test("images exceeding the decoded pixel limit are rejected", async () => {
  const data = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: "black" } }).png().toBuffer();
  await assert.rejects(loadImage({ name: "large.png", data }), /pixel/i);
});

test("pair reprojection handles geographic coordinates and projected unit conversion", async () => {
  const first = await loadImage(geotiff());
  const projection = toProj4({ GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 });
  const converter = proj4(first.projection!.proj4, projection.proj4);
  const top = converter.forward([500000, 2000000]);
  const bottom = converter.forward([500960, 1999040]);
  const geographic = { ...first, projection, grid: [(bottom[0] - top[0]) / 96, 0, top[0], 0, (bottom[1] - top[1]) / 96, top[1]] as Grid };
  const aligned = alignPair(first, geographic);
  assert.ok(aligned.valid.reduce((sum, v) => sum + v, 0) > first.valid.length * 0.98);
  const feet = { ...first, projection: { ...first.projection!, conversionParameters: { x: 0.3048, y: 0.3048, z: 1 } }, grid: first.grid!.map(v => v / 0.3048) as Grid };
  assert.deepEqual(alignPair(first, feet).data, first.data);
});
