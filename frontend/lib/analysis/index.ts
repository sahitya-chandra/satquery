import { errorPayload, type AnalysisPayload } from "../contracts";
import { alignPair, loadImage, percentile, visual, type InputImage, type Raster } from "./images";
import { changeMask, clean, colors, components, gray, intersection, opticalMasks, paint, percentage, texture, union, type Color, type Mask } from "./masks";

const SINGLE = "SINGLE_IMAGE_VQA", GROUND = "TEXT_GUIDED_GROUNDING", CHANGE = "BI_TEMPORAL_CHANGE", FUSION = "OPTICAL_SAR_FUSION", UNSUPPORTED = "UNSUPPORTED";
const has = (query: string, terms: string[]) => terms.some(term => query.toLowerCase().includes(term));
export function routeTask(count: number, mode: string, query: string) {
  let task = UNSUPPORTED, reason = "Choose change analysis or optical-SAR fusion for a pair of images.";
  if (mode === "Bi-temporal Change") { task = CHANGE; reason = "Manual bi-temporal change mode."; }
  else if (mode === "Optical-SAR Pair") { task = FUSION; reason = "Manual optical-SAR mode."; }
  else if (count === 1) {
    task = has(query, ["highlight", "locate", "show me", "mark", "where is"]) && has(query, ["water", "river", "lake", "vegetation", "forest", "crop", "urban", "built-up", "built up", "building"]) ? GROUND : SINGLE;
    reason = task === GROUND ? "Spatial query with a supported land-cover concept." : "Single-image question answering.";
  } else if (count === 2 && mode !== "Single Image") {
    const change = has(query, ["change", "increase", "decrease", "before", "after", "between", "dates"]);
    const fusion = has(query, ["sar", "radar", "optical", "fusion", "both images", "together"]);
    if (change && fusion) reason = "Query includes both change and fusion terms. Select a specific analysis mode.";
    else if (change || fusion) { task = change ? CHANGE : FUSION; reason = "Two images and matching query terms."; }
  }
  return { task, reason, required_tools: task === CHANGE ? ["LAB_difference", "morphology"] : task === FUSION ? ["optical_masks", "sar_texture", "fusion"] : ["colour_statistics", "morphology", "overlay"] };
}

export async function runAnalysis(input: { images: InputImage[]; query: string; analysis_mode: string }): Promise<{ status: number; payload: AnalysisPayload }> {
  const payload = errorPayload("");
  payload.error = null; payload.errors = [];
  const checks: { name: string; status: string; message: string }[] = [], warnings: string[] = [];
  const validation = { valid: false, checks, warnings, errors: [] as string[] };
  payload.validation = validation;
  const trace = (step: string, tool: string, started: number, message: string, status = "success") => payload.trace.push({ step, tool, status, duration_ms: Date.now() - started, parameters: {}, message });
  const reject = (message: string) => {
    payload.error = message; payload.errors = [message]; validation.errors = [message]; validation.valid = false;
    checks.push({ name: "Input validation", status: "fail", message });
    return { status: 400, payload };
  };
  const required = input.analysis_mode === "Single Image" ? 1 : ["Bi-temporal Change", "Optical-SAR Pair"].includes(input.analysis_mode) ? 2 : null;
  if (!input.images.length || input.images.length > 2 || (required && input.images.length !== required)) return reject(`${input.analysis_mode} requires ${required || "one or two"} image(s).`);
  let images: Raster[] = [];
  let started = Date.now();
  try {
    for (const image of input.images) images.push(await loadImage(image));
  } catch (error) { return reject(error instanceof Error ? error.message : "Image could not be decoded."); }
  trace("Input Loaded", "Sharp / GeoTIFF.js", started, "Images decoded in the Node.js runtime.");
  payload.input_metadata = images.map(image => image.metadata);
  started = Date.now();
  if (images.length === 2) {
    try {
      images[1] = alignPair(images[0], images[1]);
      const valid = intersection(images[0].valid, images[1].valid);
      images = images.map(image => ({ ...image, valid }));
      if (!images[0].grid || !images[1].grid) warnings.push("Geospatial pair alignment cannot be verified; co-registration is assumed.");
    } catch (error) { return reject(error instanceof Error ? error.message : "Pair alignment failed."); }
  }
  warnings.push(...images.flatMap(image => image.warnings));
  if (!images[0].valid.includes(1)) return reject("No valid image pixels remain for analysis.");
  checks.push({ name: "Image count and readability", status: "pass", message: `${images.length} image(s) decoded and validated.` });
  checks.push({ name: "Valid pixels", status: "pass", message: "Only valid overlapping pixels are used for measurements." });
  validation.valid = true;
  payload.input_metadata = images.map(image => image.metadata);
  trace("GeoGuard Validation", "TypeScript / Proj4", started, "Dimensions, valid pixels and pair alignment checked.");
  const routing = routeTask(images.length, input.analysis_mode, input.query);
  payload.routing = routing;
  trace("Task Routing", "DeterministicRouter", Date.now(), routing.reason, routing.task === UNSUPPORTED ? "error" : "success");
  if (routing.task === UNSUPPORTED) return reject(routing.reason);
  started = Date.now();
  const first = images[0], second = images[1];
  const pct = (mask: Mask) => percentage(mask, first.valid);
  let mask: Mask, layers: [Mask, Color][], answer: string, explanation: string;
  let bbox: number[] | null = null, agreement: number | undefined;
  const metrics: Record<string, unknown> = { engine: "TypeScript", vqa_engine: "Deterministic" };
  if (routing.task === CHANGE) {
    mask = changeMask(first, second); layers = [[mask, colors.change]];
    metrics.changed_pixel_percentage = pct(mask);
    answer = `Change candidates cover approximately ${pct(mask).toFixed(1)}% of valid analysed pixels. Seasonal, illumination and sensor differences may cause false change.`;
    explanation = "Smoothed CIE LAB differences, adaptive histogram thresholding and connected-component cleanup.";
  } else {
    const optical = opticalMasks(first);
    if (routing.task === FUSION) {
      const intensity = gray(second), low = percentile(intensity, 0.02), high = percentile(intensity, 0.98);
      const sar = intensity.map(v => high > low ? Math.max(0, Math.min(255, (v - low) * 255 / (high - low))) : 0);
      const localTexture = texture(sar, second);
      const waterThreshold = Math.max(70, percentile(sar, 0.34)), bright = percentile(sar, 0.63), textured = Math.max(9, percentile(localTexture, 0.68));
      const sarWater = clean(Uint8Array.from(sar, v => Number(v < waterThreshold)), first);
      const sarBuilt = clean(Uint8Array.from(sar, (v, i) => Number(v > bright && localTexture[i] > textured)), first, 1);
      const waterAgree = intersection(optical.water, sarWater), builtAgree = intersection(optical.built_up, sarBuilt);
      const waterUnion = union(optical.water, sarWater), builtUnion = union(optical.built_up, sarBuilt);
      const water = clean(pct(waterAgree) >= 0.25 ? waterAgree : waterUnion, first);
      const built = clean(pct(builtAgree) >= 0.25 ? builtAgree : builtUnion, first, 1);
      agreement = (pct(waterAgree) + pct(builtAgree)) / (pct(waterUnion) + pct(builtUnion) || 1);
      mask = union(water, built); layers = [[water, colors.water], [built, colors.built_up]];
      Object.assign(metrics, { water_candidate_percentage: pct(water), built_up_candidate_percentage: pct(built), fusion_agreement: agreement });
      answer = `Optical and SAR evidence identifies approximately ${pct(water).toFixed(1)}% water candidates and ${pct(built).toFixed(1)}% built-up candidates.`;
      explanation = "Optical colour/texture masks are combined with normalized SAR intensity and texture. Limited agreement uses the union of candidates. This is heuristic fusion, not calibrated sensor physics.";
    } else {
      const concept = has(input.query, ["water", "river", "lake"]) ? "water" : has(input.query, ["vegetation", "forest", "crop", "green"]) ? "vegetation" : has(input.query, ["urban", "built-up", "built up", "building"]) ? "built_up" : null;
      mask = concept ? optical[concept] : union(union(optical.water, optical.vegetation), optical.built_up);
      layers = routing.task === GROUND && concept ? [[mask, colors[concept]]] : [[optical.water, colors.water], [optical.vegetation, colors.vegetation], [optical.built_up, colors.built_up]];
      const intensity = gray(first);
      Object.assign(metrics, { water_percentage: pct(optical.water), vegetation_percentage: pct(optical.vegetation), built_up_candidate_percentage: pct(optical.built_up), dark_region_percentage: pct(Uint8Array.from(intensity, v => Number(v < 55))), bright_region_percentage: pct(Uint8Array.from(intensity, v => Number(v > 205))) });
      if (routing.task === GROUND) {
        bbox = components(mask, first.width, first.height).bbox;
        answer = `Highlighted ${concept?.replaceAll("_", " ")} candidates across approximately ${pct(mask).toFixed(1)}% of valid analysed pixels.`;
      } else if (concept) {
        answer = `${pct(mask) >= 5 ? "Yes." : pct(mask) >= 1 ? "Possibly." : "No strong evidence was detected."} ${concept.replaceAll("_", " ")} candidates cover approximately ${pct(mask).toFixed(1)}% of valid analysed pixels.`;
      } else answer = `The prototype detects approximately ${pct(optical.vegetation).toFixed(1)}% vegetation-like regions, ${pct(optical.water).toFixed(1)}% water-like regions and ${pct(optical.built_up).toFixed(1)}% built-up candidates.`;
      explanation = "Colour, HSV and local texture heuristics with morphological cleanup; not a trained remote-sensing model. Built-up detection uses local texture rather than OpenCV Canny edges.";
    }
  }
  trace("Specialist Execution", routing.task, started, "TypeScript masks and visual evidence generated.");
  started = Date.now();
  const detected = pct(mask);
  let score = 3;
  if (detected === 0 || detected >= 92) { score -= 1; warnings.push(detected === 0 ? "Detected mask is empty." : "Detected mask covers unusually broad regions."); }
  const intensity = gray(first).filter((_, i) => Boolean(first.valid[i]));
  const mean = intensity.reduce((sum, v) => sum + v, 0) / intensity.length;
  const contrast = Math.sqrt(intensity.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intensity.length);
  if (contrast < 14) { score -= 0.6; warnings.push("Low image contrast reduces heuristic reliability."); }
  if (agreement !== undefined && agreement < 0.35) { score -= 0.45; warnings.push("Optical-SAR agreement is limited."); }
  score -= validation.warnings.length * 0.15;
  if (detected === 0) score = Math.min(score, 1.4);
  const reliability = score >= 2.65 ? "Higher" : score >= 1.55 ? "Moderate" : "Low";
  const pixelArea = first.grid && first.projection && !first.projection.isGCS && first.projection.coordinatesUnits === "metre" ? Math.abs((first.grid[0] * first.grid[4] - first.grid[1] * first.grid[3]) * first.projection.conversionParameters.x * first.projection.conversionParameters.y) : 0;
  const count = mask.reduce((sum, v, i) => sum + Number(Boolean(v && first.valid[i])), 0);
  const area = pixelArea > 0 && Number.isFinite(pixelArea) ? { available: true, area_square_metres: count * pixelArea, area_hectares: count * pixelArea / 10_000, area_square_kilometres: count * pixelArea / 1_000_000, pixel_percentage: detected, message: "Approximate area from the projected analysis-grid affine determinant, converted to metres." } : { available: false, pixel_percentage: detected, message: "Ground area requires a supported projected GeoTIFF; only pixel percentage is reported." };
  const evidenceChecks = [{ name: "Mask coverage", status: detected > 0 && detected < 92 ? "pass" : "warn", message: `${detected.toFixed(1)}% of valid analysis pixels.` }, { name: "Image contrast", status: contrast < 14 ? "warn" : "pass", message: `Standard deviation ${contrast.toFixed(1)}.` }, { name: "Geospatial measurement", status: area.available ? "pass" : "warn", message: area.message }];
  payload.result = { task: routing.task, answer, explanation, reliability, reliability_details: { label: reliability, score: Math.max(0, score), checks: evidenceChecks }, changed_or_detected_percentage: detected, area_measurement: area, metrics, bbox, all_warnings: [...new Set(warnings)] };
  trace("Evidence Verification", "TypeScript", started, "Coverage, contrast and geographic measurement checked.");
  const base = routing.task === CHANGE ? second : first;
  const overlay = paint(base, layers, false, bbox), maskDisplay = paint(first, routing.task === SINGLE ? [[mask, colors.water]] : layers, true);
  const visualInputs: [string, Uint8Array][] = routing.task === CHANGE ? [["Earlier image", first.data], ["Later image", second.data], ["Change mask", maskDisplay], ["Change overlay", overlay]] : routing.task === FUSION ? [["Optical image", first.data], ["SAR image", second.data], ["Fusion overlay", overlay], ["Water and built-up masks", maskDisplay]] : [["Original image", first.data], ["Evidence overlay", overlay], ["Mask alone", maskDisplay]];
  for (const [label, data] of visualInputs) payload.visuals.push(await visual(label, data, first.width, first.height));
  trace("Result Generation", "Next.js", Date.now(), "PNG previews and JSON report prepared.");
  payload.ok = true;
  payload.report = JSON.stringify({ application: "SatQuery AI", selected_task: routing.task, answer, prototype_reliability: reliability, routing, metrics, changed_or_detected_percentage: detected, area_measurement: area, input_metadata: payload.input_metadata, validation, warnings: payload.result.all_warnings, execution_trace: payload.trace }, null, 2);
  return { status: 200, payload };
}
