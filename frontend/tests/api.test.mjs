import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const base = process.env.SATQUERY_TEST_URL || "http://localhost:3000";
async function analyze(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(`${base}/api/analyze`, { method: "POST", body: form });
  return { status: response.status, payload: await response.json() };
}

test("Next.js serves health, demo cases and actual PNG images", async () => {
  assert.equal((await (await fetch(`${base}/api/health`)).json()).backend, "nextjs");
  const { cases } = await (await fetch(`${base}/api/demo-cases`)).json();
  assert.equal(cases.length, 3);
  for (const item of cases) {
    const response = await fetch(base + item.image_urls[0]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  }
});

for (const [demo_case, analysis_mode, task] of [
  ["single", "Auto Detect", "SINGLE_IMAGE_VQA"],
  ["change", "Bi-temporal Change", "BI_TEMPORAL_CHANGE"],
  ["fusion", "Optical-SAR Pair", "OPTICAL_SAR_FUSION"],
]) {
  test(`demo ${demo_case} returns evidence and matching report`, async () => {
    const { status, payload } = await analyze({ demo_case, analysis_mode, query: "What is visible?" });
    assert.equal(status, 200);
    assert.equal(payload.result.task, task);
    assert.ok(payload.visuals.length >= 2);
    assert.equal(JSON.parse(payload.report).answer, payload.result.answer);
  });
}

test("uploads retain the filename and reject a missing pair", async () => {
  const data = await readFile(new URL("../public/demo_data/single_optical.png", import.meta.url));
  const first_image = new File([data], "uploaded.png", { type: "image/png" });
  const { status, payload } = await analyze({ input_source: "upload", first_image, analysis_mode: "Single Image", query: "Is there water?" });
  assert.equal(status, 200);
  assert.equal(payload.input_metadata[0].name, "uploaded.png");
  const missing = await analyze({ input_source: "upload", first_image, analysis_mode: "Bi-temporal Change" });
  assert.equal(missing.status, 400);
  assert.equal(missing.payload.ok, false);
});

test("invalid requests return structured errors", async () => {
  for (const fields of [{ demo_case: "unknown" }, { input_source: "invalid" }, { analysis_mode: "invalid" }, { input_source: "upload" }]) {
    const { status, payload } = await analyze(fields);
    assert.equal(status, 400);
    assert.equal(payload.ok, false);
    assert.ok(payload.error);
  }
  const response = await fetch(`${base}/api/analyze`, { method: "POST", body: "invalid" });
  assert.equal(response.status, 400);
});

test("optional AI preserves evidence and keeps its report consistent", async () => {
  const fields = { demo_case: "single", query: "What is visible?" };
  const baseline = await analyze(fields);
  const { status, payload } = await analyze({ ...fields, use_ai: "true" });
  assert.equal(status, 200);
  assert.equal(payload.result.changed_or_detected_percentage, baseline.payload.result.changed_or_detected_percentage);
  const step = payload.trace.at(-1);
  assert.equal(step.tool, "Vercel AI SDK");
  assert.ok(["success", "warning"].includes(step.status));
  if (step.status === "warning") {
    assert.equal(payload.result.answer, baseline.payload.result.answer);
    assert.ok(payload.result.all_warnings.some((warning) => warning.includes("AI answer unavailable")));
  }
  const report = JSON.parse(payload.report);
  assert.equal(report.answer, payload.result.answer);
  assert.deepEqual(report.warnings, payload.result.all_warnings);
  assert.deepEqual(report.execution_trace, payload.trace);
});

test("oversized bodies and corrupt uploads return structured errors", async () => {
  const response = await fetch(`${base}/api/analyze`, { method: "POST", body: new Uint8Array(4_000_001) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).ok, false);
  const corrupt = await analyze({ input_source: "upload", first_image: new File(["broken"], "broken.png") });
  assert.equal(corrupt.status, 400);
  assert.ok(corrupt.payload.error);
});
