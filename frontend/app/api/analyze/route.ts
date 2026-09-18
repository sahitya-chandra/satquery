import { readFile } from "node:fs/promises";
import path from "node:path";
import { demoCases, modes } from "../../../lib/demo-cases";
import { runAnalysis } from "../../../lib/analysis";
import type { InputImage } from "../../../lib/analysis/images";
import { errorPayload } from "../../../lib/contracts";

export const runtime = "nodejs";
export const maxDuration = 150;
const maxBytes = 4_000_000;

export async function POST(request: Request) {
  try {
    // Bound streamed bodies as well as requests with Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return Response.json(errorPayload("Multipart form data is required."), { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return Response.json(errorPayload("Request exceeds the 4 MB limit."), { status: 413 });
      }
      chunks.push(value);
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    } catch { return Response.json(errorPayload("Invalid multipart form data."), { status: 400 }); }
    const inputSource = String(form.get("input_source") || "demo");
    const mode = String(form.get("analysis_mode") || modes[0]);
    const query = String(form.get("query") || "").trim();
    if (!["demo", "upload"].includes(inputSource) || !modes.includes(mode) || !query || query.length > 8000) {
      return Response.json(errorPayload("Invalid input source, analysis mode, or query (1–8000 characters)."), { status: 400 });
    }
    const images: InputImage[] = [];
    if (inputSource === "demo") {
      const id = String(form.get("demo_case") || "single").toLowerCase();
      const demo = demoCases.find((item) => item.id === id || item.name.toLowerCase() === id);
      if (!demo) return Response.json(errorPayload("Unknown demo case."), { status: 400 });
      for (const name of demo.files) images.push({ name, data: await readFile(path.join(process.cwd(), "public", "demo_data", name)) });
    } else {
      for (const key of ["first_image", "second_image"]) {
        const file = form.get(key);
        if (!(file instanceof File) || !file.name || !file.size) {
          if (key === "first_image") return Response.json(errorPayload("A non-empty first image is required."), { status: 400 });
          continue;
        }
        const extension = path.extname(file.name).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".tif", ".tiff"].includes(extension)) return Response.json(errorPayload("Unsupported image format."), { status: 400 });
        images.push({ data: Buffer.from(await file.arrayBuffer()), name: path.basename(file.name) });
      }
    }
    const { status, payload } = await runAnalysis({ images, query, analysis_mode: mode, is_demo: inputSource === "demo", signal: request.signal });
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > maxBytes) return Response.json(errorPayload("Analysis response exceeds the 4 MB limit."), { status: 413 });
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Analysis request failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json(errorPayload("Analysis failed. Check the server logs."), { status: 500 });
  }
}
