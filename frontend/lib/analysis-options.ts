// Shared by the browser and API; these are input constraints, not model routing.
export const MAX_QUERY_LENGTH = 8000;
export const MAX_UPLOAD_BYTES = 3_900_000;
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.tif,.tiff";

const sceneSuggestions = ["Describe the main land-cover regions.", "Where is water visible?", "What stands out in this scene?"];
const defaultLabels = ["Image 1", "Image 2"];

export const analysisOptions = [
  { value: "Auto Detect", label: "Let AI choose", description: "The model chooses the analysis from your question and images.", imageCount: null, task: null, example: null, labels: defaultLabels, suggestions: sceneSuggestions },
  { value: "Single Image", label: "Explore one image", description: "Ask about visible features, land cover, or the overall scene.", imageCount: 1, task: "visual_question", example: "single", labels: defaultLabels, suggestions: sceneSuggestions },
  { value: "Bi-temporal Change", label: "Compare two dates", description: "Add the earlier image first, then the later image of the same place.", imageCount: 2, task: "change_comparison", example: "change", labels: ["Earlier image", "Later image"], suggestions: ["What changed between these dates?", "How has the vegetation changed?"] },
  { value: "Optical-SAR Pair", label: "Compare optical & SAR", description: "Add optical first and SAR second for a qualitative visual comparison.", imageCount: 2, task: "optical_sar_comparison", example: "fusion", labels: ["Optical image", "SAR image"], suggestions: ["Compare the water patterns in both views.", "What can each sensor tell us?"] },
] as const;

export const modes: readonly string[] = analysisOptions.map(option => option.value);
export function getAnalysisOption(mode: string) {
  return analysisOptions.find(option => option.value === mode);
}

export function isSupportedImage(name: string) {
  return /\.(png|jpe?g|tiff?)$/i.test(name);
}

// Used on selection and submission so replacing a file follows the same limits.
export function uploadError(files: readonly { name: string; size: number }[]) {
  if (files.some(file => !file.size || !isSupportedImage(file.name))) return "Choose non-empty PNG, JPEG, TIFF or GeoTIFF images.";
  if (files.reduce((size, file) => size + file.size, 0) > MAX_UPLOAD_BYTES) return "Combined uploads must be smaller than 3.9 MB.";
  return null;
}
