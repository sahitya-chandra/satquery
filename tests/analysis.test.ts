import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { writeArrayBuffer } from "geotiff";
import proj4 from "proj4";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import { runAnalysis } from "../lib/analysis";
import { alignPair, loadImage, type Grid } from "../lib/analysis/images";
import { AnalysisFailure, validateModelAnalysis, type ModelAnalysis, type Inference } from "../lib/ai-analysis";

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

const answer: ModelAnalysis = { task: "visual_question", reason: "Visual question about one image.", answer: "Water is visible near the centre.", observations: [{ image: 1, description: "A blue region is visible." }], limitations: ["Visual interpretation only."], clarification: "" };
const infer: Inference = async () => ({ analysis: answer, model: "test:vision" });

for (const [names, mode, task] of [
  [["single_optical.png"], "Auto Detect", "visual_question"],
  [["change_before.png", "change_after.png"], "Bi-temporal Change", "change_comparison"],
  [["fusion_optical.png", "fusion_sar.png"], "Optical-SAR Pair", "optical_sar_comparison"],
] as const) {
  test(`${task} uses model output and returns only source views and a consistent report`, async () => {
    const images = await Promise.all(names.map(async name => ({ name, data: await readFile(new URL(`../public/demo_data/${name}`, import.meta.url)) })));
    let calls = 0;
    const { status, payload } = await runAnalysis({ images, analysis_mode: mode, query: "Explain this scene", is_demo: true }, async input => {
      calls++;
      assert.equal(input.images.length, names.length);
      assert.ok(input.warnings.some(w => w.includes("synthetic")));
      assert.ok(input.images.every(i => i.src.startsWith("data:image/png;base64,")));
      return { analysis: { ...answer, task }, model: "test:vision" };
    });
    assert.equal(calls, 1); assert.equal(status, 200); assert.equal(payload.result?.task, task);
    assert.equal(payload.result?.answer, answer.answer);
    assert.equal(payload.visuals.length, images.length);
    assert.equal("changed_or_detected_percentage" in payload.result!, false);
    assert.equal("reliability" in payload.result!, false);
    const report = JSON.parse(payload.report!);
    assert.equal(report.answer, payload.result?.answer);
    assert.deepEqual(report.observations, payload.result?.observations);
    assert.deepEqual(report.execution_trace, payload.trace);
    for (const item of payload.visuals) {
      const metadata = await sharp(Buffer.from(item.src.split(",")[1], "base64")).metadata();
      assert.equal(metadata.format, "png"); assert.ok(metadata.width! <= 384);
    }
  });
}

test("clarification and unsupported requests preserve the model response without fake measurements", async () => {
  for (const task of ["clarification", "unsupported"] as const) {
    const { payload, status } = await runAnalysis({ images: [await scene()], analysis_mode: "Auto Detect", query: "Can you help with this?" }, async () => ({ model: "test:vision", analysis: { ...answer, task, observations: [], clarification: task === "clarification" ? "Which region?" : "" } }));
    assert.equal(status, 200); assert.equal(payload.routing?.task, task);
    assert.deepEqual(payload.result?.observations, []);
    assert.equal("metrics" in payload.result!, false);
  }
});

test("model failure never falls back to heuristic results and does not expose provider secrets", async () => {
  for (const [error, expected] of [[{ statusCode: 429, message: "secret" }, 429], [{ statusCode: 401, message: "secret" }, 503], [new AnalysisFailure(504, "Timed out"), 504], [new Error("secret"), 502]] as const) {
    const { status, payload } = await runAnalysis({ images: [await scene()], analysis_mode: "Single Image", query: "What is visible?" }, async () => { throw error; });
    assert.equal(status, expected); assert.equal(payload.ok, false);
    assert.equal(payload.result, null); assert.equal(payload.report, null);
    assert.equal(JSON.stringify(payload).includes("secret"), false);
  }
});

test("bad inputs never invoke the model", async () => {
  const valid = await scene();
  for (const [images, mode, query] of [
    [[{ name: "broken.png", data: Buffer.from("bad") }], "Single Image", "Question"],
    [[valid], "Bi-temporal Change", "Question"], [[], "Auto Detect", "Question"],
    [[valid], "Single Image", ""], [[valid], "Invalid mode", "Question"],
  ] as const) {
    let called = false;
    const { status } = await runAnalysis({ images: [...images], analysis_mode: mode, query }, async input => { called = true; return infer(input); });
    assert.equal(status, 400); assert.equal(called, false);
  }
});

test("invalid model image references, tasks and schemas are rejected", async () => {
  for (const invalid of [{ ...answer, observations: [{ image: 2, description: "Unknown input" }] }, { ...answer, task: "change_comparison" as const }, { ...answer, answer: "" }]) {
    const { status, payload } = await runAnalysis({ images: [await scene()], analysis_mode: "Single Image", query: "Question" }, async () => ({ model: "test:vision", analysis: invalid }));
    assert.equal(status, 502); assert.equal(payload.result, null);
  }
  assert.throws(() => validateModelAnalysis({ ...answer, task: "invented_tool" }));
  assert.throws(() => validateModelAnalysis({ ...answer, task: "clarification", clarification: "" }));
  assert.equal("metrics" in validateModelAnalysis({ ...answer, metrics: { water_percentage: 90 } }), false);
});

test("a model-authored unsupported explanation is displayed even if its answer field is empty", async () => {
  const modelResponse = { ...answer, task: "unsupported" as const, answer: "", reason: "I cannot generate a trained segmentation mask.", observations: [] };
  const { status, payload } = await runAnalysis({ images: [await scene()], analysis_mode: "Single Image", query: "Generate a precise building mask" }, async () => ({ model: "test:vision", analysis: modelResponse }));
  assert.equal(status, 200);
  assert.equal(payload.result?.task, "unsupported");
  assert.equal(payload.result?.answer, modelResponse.reason);
  assert.equal(JSON.parse(payload.report!).answer, modelResponse.reason);
  assert.equal(modelResponse.answer, "");
});

test("GeoTIFF metadata and nodata survive the model path without generating area estimates", async () => {
  const input = geotiff(500000, 32643, true);
  const raster = await loadImage(input);
  assert.equal(raster.metadata.crs, "EPSG:32643"); assert.equal(raster.valid[0], 0);
  const { payload, status } = await runAnalysis({ images: [input], query: "What is visible?", analysis_mode: "Single Image" }, async request => {
    const pixels = await sharp(Buffer.from(request.images[0].src.split(",")[1], "base64")).raw().toBuffer();
    assert.deepEqual([...pixels.subarray(0, 3)], [128, 128, 128]);
    return infer(request);
  });
  assert.equal(status, 200);
  assert.equal("area_measurement" in payload.result!, false);
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
