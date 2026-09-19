import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalysisForm, type AnalysisFormInput } from "@/lib/analysis-form";
import { modelConfiguration } from "@/lib/model-config";
import { MAX_UPLOAD_BYTES, uploadError } from "@/lib/analysis-options";

const base: AnalysisFormInput = {
  inputSource: "upload", demoCase: "single", mode: "Single Image", query: "Water?",
  firstFile: new File(["image"], "first.png"), secondFile: new File([new Uint8Array(3_900_001)], "second.png"),
};

test("single-image mode excludes a previously selected second file from upload and size checks", () => {
  const form = buildAnalysisForm(base);
  assert.equal(form.has("second_image"), false);
  assert.equal((form.get("first_image") as File).name, "first.png");
});

test("demo requests do not send retained uploads", () => {
  const form = buildAnalysisForm({ ...base, inputSource: "demo" });
  assert.equal(form.has("first_image"), false);
  assert.equal(form.has("second_image"), false);
});

test("auto mode accepts one image, pair modes require two, and active uploads are bounded", () => {
  assert.doesNotThrow(() => buildAnalysisForm({ ...base, mode: "Auto Detect", secondFile: null }));
  for (const mode of ["Bi-temporal Change", "Optical-SAR Pair"]) {
    assert.throws(() => buildAnalysisForm({ ...base, mode, secondFile: null }), /second image/);
    assert.throws(() => buildAnalysisForm({ ...base, mode }), /3.9 MB/);
    assert.equal(buildAnalysisForm({ ...base, mode, secondFile: new File(["image"], "second.tif") }).has("second_image"), true);
  }
  assert.throws(() => buildAnalysisForm({ ...base, firstFile: null }), /first image/);
  assert.throws(() => buildAnalysisForm({ ...base, firstFile: new File(["x"], "bad.pdf") }), /PNG/);
});

test("selection and submission share upload boundaries and reject empty or unsupported files", () => {
  const image = new File([new Uint8Array(MAX_UPLOAD_BYTES)], "image.TIFF");
  assert.equal(uploadError([image]), null);
  assert.doesNotThrow(() => buildAnalysisForm({ ...base, firstFile: image }));
  const extra = new File(["x"], "extra.jpeg");
  assert.match(uploadError([image, extra])!, /3.9 MB/);
  assert.throws(() => buildAnalysisForm({ ...base, mode: "Auto Detect", firstFile: image, secondFile: extra }), /3.9 MB/);
  for (const invalid of [new File([], "empty.png"), new File(["x"], "file.pdf")]) {
    assert.match(uploadError([invalid])!, /non-empty PNG/);
    assert.throws(() => buildAnalysisForm({ ...base, mode: "Auto Detect", secondFile: invalid }), /non-empty PNG/);
  }
});

test("AI configuration requires a supported provider and matching key, and never returns secrets", () => {
  assert.deepEqual(modelConfiguration({}), { configured: false });
  assert.deepEqual(modelConfiguration({ SATQUERY_AI_MODEL: "openai:test", ANTHROPIC_API_KEY: "secret" }), { configured: false });
  assert.deepEqual(modelConfiguration({ SATQUERY_AI_MODEL: "unknown:test", OPENAI_API_KEY: "secret" }), { configured: false });
  for (const [provider, key] of [["openai", "OPENAI_API_KEY"], ["anthropic", "ANTHROPIC_API_KEY"], ["google", "GOOGLE_GENERATIVE_AI_API_KEY"]]) {
    assert.deepEqual(modelConfiguration({ SATQUERY_AI_MODEL: `${provider}:test`, [key]: "secret" }), { configured: true });
  }
});
