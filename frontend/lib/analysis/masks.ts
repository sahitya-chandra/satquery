import { percentile, type Raster } from "./images";

export type Mask = Uint8Array;
export type Color = [number, number, number];
export const colors = { water: [0, 96, 255], vegetation: [0, 190, 90], built_up: [255, 125, 0], change: [255, 32, 32] } satisfies Record<string, Color>;

export function boxMean(values: ArrayLike<number>, width: number, height: number, radius: number) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += values[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + sum;
    }
  }
  return Float32Array.from({ length: width * height }, (_, i) => {
    const x = i % width, y = Math.floor(i / width);
    const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    return (integral[bottom * (width + 1) + right] - integral[top * (width + 1) + right] - integral[bottom * (width + 1) + left] + integral[top * (width + 1) + left]) / ((right - left) * (bottom - top));
  });
}

export function components(mask: Mask, width: number, height: number, minArea = 12) {
  const seen = new Uint8Array(mask.length), output = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let largest = 0, bbox: number[] | null = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next] && !seen[next]) {
          seen[next] = 1; queue[tail++] = next;
        }
      }
    }
    if (tail < minArea) continue;
    for (let j = 0; j < tail; j++) output[queue[j]] = 1;
    if (tail > largest) { largest = tail; bbox = [left, top, right - left + 1, bottom - top + 1]; }
  }
  return { mask: output, bbox };
}

export function clean(mask: Mask, raster: Raster, radius = 2, fraction = 0.0008) {
  let current = Uint8Array.from(mask, (v, i) => v && raster.valid[i] ? 1 : 0);
  // Opening followed by closing; integral images keep morphology linear in pixel count.
  for (const dilate of [false, true, true, false]) {
    const mean = boxMean(current, raster.width, raster.height, radius);
    current = Uint8Array.from(mean, v => Number(dilate ? v > 0 : v >= 0.999999));
  }
  for (let i = 0; i < current.length; i++) current[i] &= raster.valid[i];
  return components(current, raster.width, raster.height, Math.max(12, Math.floor(mask.length * fraction))).mask;
}

export function gray(raster: Raster) {
  return Float32Array.from(raster.valid, (_, i) => 0.299 * raster.data[i * 3] + 0.587 * raster.data[i * 3 + 1] + 0.114 * raster.data[i * 3 + 2]);
}

function hsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  if (hue < 0) hue += 6;
  return [hue * 30, max ? delta / max * 255 : 0, max];
}

export function texture(values: Float32Array, raster: Raster) {
  const mean = boxMean(values, raster.width, raster.height, 4);
  const squares = boxMean(values.map(v => v * v), raster.width, raster.height, 4);
  return squares.map((v, i) => Math.sqrt(Math.max(0, v - mean[i] ** 2)));
}

export function opticalMasks(raster: Raster) {
  const water = new Uint8Array(raster.valid.length), vegetation = new Uint8Array(water.length), built = new Uint8Array(water.length);
  const intensity = gray(raster), localTexture = texture(intensity, raster);
  const threshold = Math.max(8, percentile(localTexture, 0.68));
  for (let i = 0; i < water.length; i++) {
    const [r, g, b] = raster.data.subarray(i * 3, i * 3 + 3), [h, s, v] = hsv(r, g, b);
    water[i] = Number((b > g * 1.04 && b > r * 1.15 && b > 45 && h >= 82 && h <= 132 && s > 35 && v > 30 && v < 235) || (b > r + 8 && g > r + 2 && v < 165 && s > 18 && b >= g * 0.72));
    vegetation[i] = Number(h >= 35 && h <= 88 && s > 28 && v > 35 && (2 * g - r - b > 22 || (g > r * 1.1 && g > b * 1.04)));
    built[i] = Number(s < 82 && v > 55 && v < 245 && localTexture[i] > threshold);
  }
  return { water: clean(water, raster), vegetation: clean(vegetation, raster), built_up: clean(built, raster, 1, 0.0007) };
}

export function percentage(mask: Mask, valid: Mask) {
  let count = 0, total = 0;
  for (let i = 0; i < mask.length; i++) if (valid[i]) { total++; if (mask[i]) count++; }
  return total ? count * 100 / total : 0;
}
export function union(a: Mask, b: Mask): Mask { return Uint8Array.from(a, (v, i) => v | b[i]); }
export function intersection(a: Mask, b: Mask): Mask { return Uint8Array.from(a, (v, i) => v & b[i]); }

export function paint(raster: Raster, masks: [Mask, Color][], blank = false, bbox?: number[] | null) {
  const out = blank ? new Uint8Array(raster.data.length).fill(248) : Uint8Array.from(raster.data);
  for (const [mask, color] of masks) for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = blank ? color[c] : Math.round(out[i * 3 + c] * 0.38 + color[c] * 0.62);
  }
  if (bbox) {
    const [x, y, w, h] = bbox;
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      if (row > y + 1 && row < y + h - 2 && col > x + 1 && col < x + w - 2) continue;
      out.set([255, 255, 255], (row * raster.width + col) * 3);
    }
  }
  return out;
}

function lab(raster: Raster) {
  const channels = [new Float32Array(raster.valid.length), new Float32Array(raster.valid.length), new Float32Array(raster.valid.length)];
  const linear = (v: number) => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
  const f = (v: number) => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116;
  for (let i = 0; i < raster.valid.length; i++) {
    const r = linear(raster.data[i * 3]), g = linear(raster.data[i * 3 + 1]), b = linear(raster.data[i * 3 + 2]);
    const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
    const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    channels[0][i] = (116 * y - 16) * 2.55; channels[1][i] = 500 * (x - y) + 128; channels[2][i] = 200 * (y - z) + 128;
  }
  return channels.map(c => boxMean(c, raster.width, raster.height, 2));
}

export function changeMask(first: Raster, second: Raster) {
  const a = lab(first), b = lab(second);
  const differences = Float32Array.from(first.valid, (v, i) => v ? Math.hypot(...a.map((channel, c) => channel[i] - b[c][i])) : NaN);
  const low = percentile(differences, 0.01), high = percentile(differences, 0.99);
  // A uniform non-zero difference is still a change, unlike a zero-range stretch.
  if (high - low < 0.001) return clean(Uint8Array.from(differences, v => Number(v > 18)), first);
  const values = Uint8Array.from(differences, v => Math.round(Math.max(0, Math.min(255, (v - low) * 255 / (high - low)))));
  const histogram = new Uint32Array(256);
  let total = 0, sum = 0;
  for (let i = 0; i < values.length; i++) if (first.valid[i]) { histogram[values[i]]++; sum += values[i]; total++; }
  let weight = 0, partial = 0, best = 0, otsu = 0;
  for (let t = 0; t < 256; t++) {
    weight += histogram[t]; partial += t * histogram[t];
    if (!weight || weight === total) continue;
    const variance = weight * (total - weight) * (partial / weight - (sum - partial) / (total - weight)) ** 2;
    if (variance > best) { best = variance; otsu = t; }
  }
  const threshold = Math.max(otsu, percentile(values.filter((_, i) => Boolean(first.valid[i])), 0.9), 18);
  return clean(Uint8Array.from(values, v => Number(v >= threshold)), first, 2, 0.001);
}
