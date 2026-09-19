import { errorPayload } from "@/lib/contracts";
import { analyzeWithModel, modelFailure, validateModelAnalysis, type Inference } from "@/lib/ai-analysis";
import { getAnalysisOption, MAX_QUERY_LENGTH } from "@/lib/analysis-options";
import { alignPair, loadImage, visual, type InputImage } from "@/lib/analysis/images";

export async function runAnalysis(input: { images: InputImage[]; query: string; analysis_mode: string; is_demo?: boolean; signal?: AbortSignal }, infer: Inference = analyzeWithModel) {
  const payload = errorPayload("");
  payload.error = null; payload.errors = [];
  const warnings: string[] = [];
  const checks: { name: string; status: string; message: string }[] = [];
  payload.validation = { valid: false, checks, warnings, errors: [] };
  const fail = (status: number, message: string) => {
    payload.error = message; payload.errors = [message];
    if (status === 400) { payload.validation!.errors = [message]; payload.validation!.valid = false; }
    return { status, payload };
  };
  const count = input.images.length;
  const option = getAnalysisOption(input.analysis_mode);
  const required = option?.imageCount;
  if (!option || !input.query.trim() || input.query.length > MAX_QUERY_LENGTH) return fail(400, "Choose a supported mode and enter a question (1–8000 characters).");
  if (!count || count > 2 || (required && count !== required)) return fail(400, `${input.analysis_mode} requires ${required || "one or two"} image(s).`);
  let started = Date.now();
  try {
    const images = [];
    for (const file of input.images) images.push(await loadImage(file));
    if (images.some(image => !image.valid.includes(1))) return fail(400, "An image has no valid pixels to analyse.");
    // Geometric validation is retained; it does not classify pixels or route questions.
    if (count === 2 && images[0].grid && images[1].grid) {
      alignPair(images[0], images[1]);
      checks.push({ name: "Geospatial overlap", status: "pass", message: "Coordinate systems resolve and valid overlapping pixels exist. Original image views are sent to the model." });
    } else if (count === 2) warnings.push("Image co-registration cannot be verified. Visual differences may come from alignment rather than real change.");
    if (input.analysis_mode === "Bi-temporal Change") warnings.push("Image 1 is treated as earlier and image 2 as later; acquisition dates have not been verified.");
    if (input.analysis_mode === "Optical-SAR Pair") warnings.push("Image 1 is treated as optical and image 2 as SAR. Sensor types are user-supplied; this is visual comparison, not calibrated sensor fusion.");
    if (input.is_demo) warnings.push("These are synthetic demonstration images, not real satellite observations.");
    warnings.push(...images.flatMap(image => image.warnings));
    payload.input_metadata = images.map(image => image.metadata);
    checks.push({ name: "Image validation", status: "pass", message: `${count} image(s) decoded with valid pixels and bounded dimensions.` });
    payload.validation.valid = true;
    const modelImages = [];
    for (const [i, image] of images.entries()) {
      const label = `Image ${i + 1}`;
      // Invalid pixels are greyed out so the model cannot mistake hidden RGB data for evidence.
      const data = Uint8Array.from(image.data, (v, index) => image.valid[Math.floor(index / 3)] ? v : 128);
      payload.visuals.push(await visual(label, data, image.width, image.height));
      modelImages.push({ ...await visual(label, data, image.width, image.height, 768), metadata: image.metadata });
    }
    payload.trace.push({ step: "Input validation", tool: "Sharp / GeoTIFF.js / Proj4", status: "success", parameters: {}, duration_ms: Date.now() - started, message: "Decoded source views prepared; no masks or measurements generated." });
    started = Date.now();
    try {
      const response = await infer({ query: input.query.trim(), mode: input.analysis_mode, images: modelImages, warnings, signal: input.signal });
      const analysis = validateModelAnalysis(response.analysis);
      const expectedTask = option.task;
      const answered = !["clarification", "unsupported"].includes(analysis.task);
      if (analysis.observations.some(o => o.image > count)
        || (count < 2 && ["change_comparison", "optical_sar_comparison"].includes(analysis.task))
        || (answered && expectedTask && analysis.task !== expectedTask)
        || (answered && analysis.clarification.trim())) throw new Error("Model output contradicts supplied images or mode");
      payload.routing = { task: analysis.task, reason: analysis.reason, required_tools: ["vision_language_model"] };
      payload.result = { ...analysis, model: response.model, all_warnings: [...new Set([...warnings, ...analysis.limitations])] };
      payload.trace.push({ step: "Model routing and analysis", tool: response.model, status: answered ? "success" : "warning", parameters: { selected_mode: input.analysis_mode }, duration_ms: Date.now() - started, message: analysis.reason });
      payload.ok = true;
      payload.report = JSON.stringify({ application: "SatQuery AI", question: input.query.trim(), selected_mode: input.analysis_mode, ...payload.result, input_metadata: payload.input_metadata, validation: payload.validation, routing: payload.routing, execution_trace: payload.trace }, null, 2);
      return { status: 200, payload };
    } catch (error) {
      const failure = modelFailure(error);
      payload.trace.push({ step: "Model analysis", tool: "Vision model", status: "error", parameters: {}, duration_ms: Date.now() - started, message: failure.message });
      return fail(failure.status, failure.message);
    }
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : "Image could not be decoded.");
  }
}
