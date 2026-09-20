import { modes } from "@/lib/analysis-options";
export const demoCases = [
  { id: "single", name: "Single Image Analysis", mode: modes[0], files: ["2026-08-01-00_00_2026-08-01-23_59_Sentinel-1_IW_RGB_Ratio (2).jpg"], query: "What major land-cover regions are visible?" },
  { id: "change", name: "Bi-temporal Change", mode: modes[2], files: ["2023-07-01-00_00_2023-07-01-23_59_Sentinel-1_IW_RGB_Ratio.jpg", "2026-08-01-00_00_2026-08-01-23_59_Sentinel-1_IW_RGB_Ratio (2).jpg"], query: "What changed between these two dates, and where?" },
  { id: "fusion", name: "Optical-SAR Comparison", mode: modes[3], files: ["2026-08-01-00_00_2026-08-01-23_59_Sentinel-1_IW_RGB_Ratio (1).jpg", "2026-08-01-00_00_2026-08-01-23_59_Sentinel-1_IW__SAR_Urban (1).jpg"], query: "Use the optical and SAR images together to identify water and built-up regions." },
].map((item) => ({ ...item, image_urls: item.files.map((file) => `/demo_data/${file}`) }));

export type DemoCase = typeof demoCases[number];
