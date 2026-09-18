import { getAnalysisOption, MAX_QUERY_LENGTH, uploadError } from "./analysis-options";

export type AnalysisFormInput = {
  inputSource: "demo" | "upload";
  demoCase: string;
  mode: string;
  query: string;
  firstFile: File | null;
  secondFile: File | null;
};

export function buildAnalysisForm(input: AnalysisFormInput) {
  const form = new FormData();
  form.set("input_source", input.inputSource);
  form.set("demo_case", input.demoCase);
  form.set("analysis_mode", input.mode);
  form.set("query", input.query);
  if (!input.query.trim() || input.query.length > MAX_QUERY_LENGTH) throw new Error("Enter a question between 1 and 8000 characters.");
  if (input.inputSource === "demo") return form;
  if (!input.firstFile?.size) throw new Error("Choose a non-empty first image.");
  const pairRequired = getAnalysisOption(input.mode)?.imageCount === 2;
  const second = input.mode === "Single Image" ? null : input.secondFile;
  if (pairRequired && !second?.size) throw new Error("This mode requires a second image.");
  const files = [input.firstFile, ...(second ? [second] : [])];
  const error = uploadError(files);
  if (error) throw new Error(error);
  form.set("first_image", input.firstFile);
  if (second) form.set("second_image", second);
  return form;
}
