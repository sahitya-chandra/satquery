import type { ModelAnalysis } from "./ai-analysis";

export type AnalysisPayload = {
  ok: boolean;
  error: string | null;
  errors: string[];
  result: null | ModelAnalysis & {
    model: string;
    all_warnings: string[];
  };
  visuals: { id: string; label: string; src: string }[];
  input_metadata: Record<string, unknown>[];
  trace: { step: string; tool: string; status: string; parameters: Record<string, unknown>; duration_ms: number; message: string }[];
  report: string | null;
  validation?: { valid: boolean; checks: { name: string; status: string; message: string }[]; warnings: string[]; errors: string[] };
  routing?: { task: string; reason: string; required_tools: string[] };
};

export function errorPayload(error: string): AnalysisPayload {
  return { ok: false, error, errors: [error], result: null, visuals: [], input_metadata: [], trace: [], report: null };
}
