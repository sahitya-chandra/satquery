import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const base = process.env.SATQUERY_TEST_URL || "http://localhost:3000";
const live = process.env.SATQUERY_TEST_LIVE === "1";
async function analyze(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(`${base}/api/analyze`, { method: "POST", body: form, signal: AbortSignal.timeout(90_000) });
  return { status: response.status, payload: await response.json() };
}

test("health exposes configuration presence without secrets and demo files are served", async () => {
  const response = await fetch(`${base}/api/health`);
  const health = await response.json();
  assert.equal(health.backend, "nextjs");
  assert.equal(typeof health.ai.configured, "boolean");
  assert.deepEqual(Object.keys(health.ai), ["configured"]);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { cases } = await (await fetch(`${base}/api/demo-cases`)).json();
  assert.equal(cases.length, 3);
  for (const item of cases) {
    assert.equal((await fetch(base + item.image_urls[0])).headers.get("content-type"), "image/png");
  }
});

test("invalid, blank, oversized and corrupt requests return structured errors without model calls", async () => {
  for (const fields of [{ demo_case: "unknown", query: "test" }, { input_source: "invalid", query: "test" }, { analysis_mode: "invalid", query: "test" }, { input_source: "upload", query: "test" }, { query: "" }]) {
    const { status, payload } = await analyze(fields);
    assert.equal(status, 400); assert.equal(payload.ok, false); assert.ok(payload.error);
  }
  assert.equal((await fetch(`${base}/api/analyze`, { method: "POST", body: "invalid" })).status, 400);
  assert.equal((await fetch(`${base}/api/analyze`, { method: "POST", body: new Uint8Array(4_000_001) })).status, 413);
  const corrupt = await analyze({ query: "Question", input_source: "upload", first_image: new File(["broken"], "broken.png") });
  assert.equal(corrupt.status, 400);
  const data = await readFile(new URL("../public/demo_data/single_optical.png", import.meta.url));
  const missing = await analyze({ query: "Compare dates", input_source: "upload", first_image: new File([data], "uploaded.png"), analysis_mode: "Bi-temporal Change" });
  assert.equal(missing.status, 400);
});

// Explicit opt-in: these tests send bundled demo imagery to the configured provider.
for (const [demo_case, analysis_mode, query, task, imageCount] of [
  ["single", "Auto Detect", "Describe the visible land-cover regions qualitatively.", "visual_question", 1],
  ["change", "Bi-temporal Change", "Compare image 1 (earlier) and image 2 (later). Describe visible differences without measurements.", "change_comparison", 2],
  ["fusion", "Optical-SAR Pair", "Describe visible patterns in image 1 (optical) and image 2 (SAR), without calibrated fusion or measurements.", "optical_sar_comparison", 2],
]) {
  test(`LIVE: ${demo_case} returns a real model answer with no heuristic metrics`, { skip: !live }, async () => {
    const { status, payload } = await analyze({ demo_case, analysis_mode, query });
    assert.equal(status, 200, payload.error);
    assert.equal(payload.result.task, task);
    assert.ok(payload.result.answer.trim());
    assert.ok(payload.result.model);
    assert.ok(payload.result.observations.length);
    assert.equal(payload.visuals.length, imageCount);
    assert.equal("changed_or_detected_percentage" in payload.result, false);
    assert.equal("reliability" in payload.result, false);
    const report = JSON.parse(payload.report);
    assert.equal(report.answer, payload.result.answer);
    assert.deepEqual(report.observations, payload.result.observations);
    assert.deepEqual(report.execution_trace, payload.trace);
  });
}

test("LIVE: a precise segmentation request reports the missing capability", { skip: !live }, async () => {
  const { status, payload } = await analyze({ demo_case: "single", analysis_mode: "Single Image", query: "Generate an exact pixel segmentation mask of every building and measure the total building area in square metres." });
  assert.equal(status, 200, payload.error);
  assert.equal(payload.result.task, "unsupported");
  assert.equal(payload.visuals.length, 1);
  assert.equal("area_measurement" in payload.result, false);
});

test("LIVE: ambiguous date ordering asks for clarification", { skip: !live }, async () => {
  const { status, payload } = await analyze({ demo_case: "change", analysis_mode: "Auto Detect", query: "I want to compare changes over time, but I do not know which image is earlier. Ask me what you need before drawing conclusions." });
  assert.equal(status, 200, payload.error);
  assert.equal(payload.result.task, "clarification");
  assert.ok(payload.result.clarification.trim());
  assert.ok(payload.result.answer.trim());
});
