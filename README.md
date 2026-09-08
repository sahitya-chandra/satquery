# SatQuery AI

SatQuery AI is a Next.js/TypeScript prototype for asking questions about satellite imagery and seeing the visual evidence used by the answer. Next.js Route Handlers run the complete analysis in Node.js, and Vercel AI SDK provides optional model answers. No Python runtime, subprocess, external backend or writable disk is required. The original FastAPI backend is retained separately in `backend/main.py`.

It demonstrates satellite-image upload, GeoTIFF/image validation, deterministic query routing, single-image question answering, text-guided region highlighting, bi-temporal change analysis, optical-SAR heuristic fusion, overlays, a prototype reliability label and an auditable execution trace.

## What It Does Not Claim

This is not a benchmark-ready remote-sensing system, not a calibrated scientific model and not an operational geospatial measurement service. The default analysis is deterministic image processing. Optional BLIP support is a generic VQA baseline and does not satisfy the final remote-sensing adaptation requirement by itself.

## Setup

Use Node.js 22 or later:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. All browser requests use the Next.js origin. `frontend/lib/analysis` contains image decoding, GeoTIFF validation/alignment, task routing, masks, evidence checks and report generation. Sharp handles PNG/JPEG decoding and PNG encoding; GeoTIFF.js and Proj4 handle geospatial rasters. The bundled demo images live in `frontend/public/demo_data`.

## Deploy to Vercel

1. Import the repository and set **Root Directory** to `frontend`.
2. Use the **Next.js** framework preset, `npm run build`, and the default output directory.
3. Add the optional model environment variables below in the Vercel project settings.
4. Deploy. The deterministic demo and upload workflows work without API keys.

The API uses the Node.js runtime. `next.config.ts` includes demo files in the analysis function's traced bundle and keeps native/image libraries as server dependencies. No files outside `frontend` are needed at build time or runtime.

[Vercel Functions limit request and response bodies to 4.5 MB](https://vercel.com/docs/functions/limitations). This app caps multipart requests and JSON responses at 4 MB; the browser caps combined uploads at 3.9 MB to allow form overhead. Larger uploads need a direct object-storage upload workflow, which is not included here. Images are limited to 4 million source pixels; TIFFs additionally allow at most 16 bands and 16 million samples. Analysis is downsampled to a maximum side of 768 pixels, and returned PNG previews to 384 pixels. No full-resolution analysis is claimed.

## AI Models

Create `frontend/.env.local` using `frontend/.env.example` as a reference:

```bash
SATQUERY_AI_MODEL=openai:gpt-4o-mini
OPENAI_API_KEY=your-key
```

Select **Include AI answer** to send the source image previews, query and deterministic evidence to the configured model. Without this option, analysis stays local. Model failures preserve the deterministic result and add a warning. AI text does not replace masks, measured percentages or the heuristic reliability label.

`frontend/lib/models.ts` registers OpenAI, Anthropic and Google using the [AI SDK provider registry](https://ai-sdk.dev/docs/ai-sdk-core/provider-management). Change `SATQUERY_AI_MODEL` to a vision-capable `provider:model-id`; set the matching `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. To add another provider, install its AI SDK adapter and add it to the registry and provider-ID validation in that file. No API route changes are required. Keys remain on the server.

## Retained FastAPI Backend

The original service and optional BLIP integration remain available independently:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

For its optional BLIP baseline:

```bash
pip install -r requirements-ai.txt
```

The legacy API's `use_blip=true` field lazily loads `Salesforce/blip-vqa-base`. You can point that hook at a future remote-sensing-adapted model with:

```bash
export REMOTE_SENSING_MODEL_ID=your-remote-sensing-model-id
```

The base app works without PyTorch, Transformers or BLIP.

## Demo Queries

```text
What major land-cover regions are visible?
```

```text
What changed between these two dates, and where?
```

```text
Use the optical and SAR images together to identify water and built-up regions.
```

## Supported Formats

PNG, JPEG, TIFF and GeoTIFF are supported. GeoTIFF.js reads dimensions, bands, CRS keys, geographic bounds, analysis-grid pixel resolution, nodata and data type. The first TIFF image and its first three bands (or first band for grayscale) are used. Invalid/nodata pixels are excluded from percentage denominators. Original dimensions and analysis dimensions are reported separately.

## Known Limitations

The masks are RGB, texture and intensity heuristics. Results are sensitive to season, illumination, atmospheric effects, sensor differences, clouds, shadows and image alignment. PNG/JPEG pairs are resized when necessary and treated as already co-registered. Reliable ground-area measurement requires a projected GeoTIFF.

The TypeScript implementation preserves the workflows, not bit-for-bit OpenCV output: built-up masks use local texture, LAB differences use a box smoothing filter, and pair resampling uses nearest neighbours. Grounding returns the largest component's bounding box. Supported GeoTIFF coordinate systems are reprojected to the first analysis grid, and only valid overlapping pixels are measured. Unresolved CRS pairs and non-overlapping pairs are rejected. Single-image inputs with an unresolved CRS can still produce visual evidence, with a warning and no ground-area measurement. Projected area uses the affine determinant and coordinate-unit conversion; geographic degree coordinates never produce square-metre estimates. Downsampling reduces spatial detail and makes area estimates approximate.

## API

Next.js exposes:

- `GET /api/health`
- `GET /api/demo-cases`
- `POST /api/analyze`

`POST /api/analyze` accepts multipart form data with `input_source` (`demo` or `upload`), `demo_case`, `analysis_mode`, `query`, `use_ai` (`true` or `false`), `first_image` and `second_image`. Queries are limited to 8000 characters. It returns JSON metadata, execution trace, a downloadable report string and PNG data URLs for visual evidence. Input errors return 400, oversized requests 413 and processing failures 500. Model errors return a successful deterministic result with a warning. Static `/demo_data/:filename` URLs serve the bundled demo images.

## Verification

```bash
cd frontend
npm test
npm run lint
npm run build
```

With Next.js running, run `npm run test:api` in `frontend` for API integration checks. Set `SATQUERY_TEST_URL` for a different origin. The AI integration check requests one optional model answer; without model credentials it checks the deterministic fallback.

The retained Python implementation's tests can still be run separately with `.venv/bin/python -m pytest -q` from the repository root.
