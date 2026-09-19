import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { analyzeWithModel, AnalysisFailure, type ModelInput } from "@/lib/ai-analysis";
import { modelRegistry } from "@/lib/models";

const input: ModelInput = { query: "What is visible?", mode: "Single Image", warnings: [], images: [{ label: "Image 1", metadata: {}, src: "data:image/png;base64,aGVsbG8=" }] };
const answer = { task: "visual_question", reason: "Visual interpretation.", answer: "A lake is visible.", observations: [{ image: 1, description: "A blue region." }], limitations: [], clarification: "" };

function restoreEnv() {
  const model = process.env.SATQUERY_AI_MODEL, key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return () => {
    if (model === undefined) delete process.env.SATQUERY_AI_MODEL; else process.env.SATQUERY_AI_MODEL = model;
    if (key === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
  };
}

test("SDK receives image bytes and structured schema, and malformed output fails without a fallback", async t => {
  t.after(restoreEnv());
  process.env.SATQUERY_AI_MODEL = "google:test";
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  for (const text of [JSON.stringify(answer), "not JSON", JSON.stringify({ ...answer, observations: [{ image: 9, description: "Invented input" }] })]) {
    const model = new MockLanguageModelV4({ doGenerate: {
      content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "STOP" }, warnings: [],
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
    } });
    const replacement = t.mock.method(modelRegistry, "languageModel", () => model);
    if (text === JSON.stringify(answer)) {
      const result = await analyzeWithModel(input);
      assert.deepEqual(result.analysis, answer);
      assert.equal(result.model, "google:test");
      assert.equal(model.doGenerateCalls[0].responseFormat?.type, "json");
      const user = model.doGenerateCalls[0].prompt.find(m => m.role === "user");
      assert.ok(user && user.content.some(c => c.type === "file"));
    } else await assert.rejects(analyzeWithModel(input), (error: unknown) => error instanceof AnalysisFailure && error.status === 502);
    assert.equal(model.doGenerateCalls.length, 1);
    replacement.mock.restore();
  }
});

test("missing credentials return configuration failure before contacting a provider", async t => {
  t.after(restoreEnv());
  delete process.env.SATQUERY_AI_MODEL;
  await assert.rejects(analyzeWithModel(input), (error: unknown) => error instanceof AnalysisFailure && error.status === 503);
});
