import { modes } from "./analysis-options";
export const demoCases = [
  { id: "single", name: "Single Image Analysis", mode: modes[0], files: ["single_optical.png"], query: "What major land-cover regions are visible?" },
  { id: "change", name: "Bi-temporal Change", mode: modes[2], files: ["change_before.png", "change_after.png"], query: "What changed between these two dates, and where?" },
  { id: "fusion", name: "Optical-SAR Comparison", mode: modes[3], files: ["fusion_optical.png", "fusion_sar.png"], query: "Use the optical and SAR images together to identify water and built-up regions." },
].map((item) => ({ ...item, image_urls: item.files.map((file) => `/demo_data/${file}`) }));

export type DemoCase = typeof demoCases[number];
