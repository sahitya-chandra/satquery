import { createProviderRegistry } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

// Add provider adapters here; model IDs stay in server-side configuration.
export const modelRegistry = createProviderRegistry({ openai, anthropic, google });

export function analysisModel() {
  const id = process.env.SATQUERY_AI_MODEL;
  if (!id) throw new Error("Set SATQUERY_AI_MODEL to enable AI answers.");
  if (!/^(openai|anthropic|google):.+$/.test(id)) throw new Error("SATQUERY_AI_MODEL must use a registered provider:model ID.");
  return { id, model: modelRegistry.languageModel(id as Parameters<typeof modelRegistry.languageModel>[0]) };
}
