# SatQuery AI

A Next.js prototype for asking questions about satellite/aerial imagery through a configured vision-language model. The model interprets the question, selects a task and returns visual observations, limitations or a clarification request in a validated structured response.

There is no keyword router, colour/texture segmentation, synthetic confidence score, measured coverage estimate or heuristic answer fallback. The obsolete Python/FastAPI heuristic service has been removed. Image decoding, size limits, geospatial validation and preview preparation remain normal code.

## Setup

Use Node.js 22 or later:

```bash
cd frontend
npm install
```

Create `frontend/.env.local` (never commit the key):

```dotenv
SATQUERY_AI_MODEL=google:gemini-2.5-flash
GOOGLE_GENERATIVE_AI_API_KEY=your-key
```

Then run `npm run dev` in `frontend` and open `http://localhost:3000`.

The registry in `frontend/lib/models.ts` also supports `openai:model-id` with `OPENAI_API_KEY` and `anthropic:model-id` with `ANTHROPIC_API_KEY`. Choose a vision-capable model supporting structured output. Only one provider is required. The UI checks configuration presence; successful inference is the test of credentials, quota and model access.

Analysis sends the question, image previews and metadata to the configured provider. No optional AI toggle or offline inference fallback remains. Missing configuration returns 503; access/model errors return 503, rate limits 429, timeouts 504 and unusable model responses 502. No raw SDK errors or API keys are returned/logged.

## Supported workflows

- **Single Image:** qualitative questions and verbal descriptions of visible regions.
- **Auto Detect:** the model interprets the question and images; ambiguous requests produce a clarification question.
- **Bi-temporal Change:** qualitative comparison; upload earlier first, later second. Acquisition dates are not verified.
- **Optical-SAR Pair:** qualitative visual comparison; upload optical first, SAR second. This is not calibrated or learned sensor fusion.

Demo scenes are synthetic illustrations. Uploaded PNG/JPEG previews are shown locally; TIFF previews appear after decoding on the server. Results show the model, observations linked to numbered source images, limitations, input metadata and execution trace. A downloadable JSON report preserves those results. Cancel stops waiting in the browser and propagates an abort signal where supported; provider processing may already have started.

## Capabilities deliberately unavailable

The connected vision-language model does not supply trained pixel masks, reliable exact counts, measured land-cover percentages/areas or calibrated SAR analysis. Requests for these should return an explicit unsupported-capability response rather than fabricated masks or numbers. Model output can still be wrong; structured validation verifies response shape and input references, not scientific accuracy. Specialist segmentation/change models and real-image evaluation remain future work.

## Images and GeoTIFFs

PNG, JPEG, TIFF and GeoTIFF are accepted. Inputs are limited to 4 million pixels, and TIFFs to 16 bands/16 million samples. The first TIFF image and first three bands (or first band for grayscale) are used, independently contrast-stretched; natural RGB band order and calibrated radiometry are not assumed. Invalid pixels are greyed out in previews.

The model receives PNG views up to 768 pixels per side; display previews are at most 384 pixels. Small objects can disappear. Metadata includes original/analysis dimensions, resolved CRS, bounds and nodata. GeoTIFF pairs with unresolved coordinate systems or no valid overlap are rejected. The model receives original views, not pixelwise difference maps. PNG/JPEG co-registration cannot be verified.

## Deploy

Set the hosting project's root directory to `frontend`, use the Next.js preset, and set the same server environment variables before deploying. No Python runtime, local model weights or GPU is required for the hosted API model.

Requests and responses are capped at 4 MB; the browser limits combined uploads to 3.9 MB. Larger imagery needs object storage and a separate processing workflow. Model calls have a 60-second timeout and no automatic retries. The route declares a 150-second maximum duration; choose hosting settings that support it.

A public deployment can consume your provider quota. Per-user authentication/quotas and distributed concurrency controls are not implemented; apply hosting access controls or add those before unrestricted public use.

## API

- `GET /api/health`: application status and AI configuration presence (no credentials).
- `GET /api/demo-cases`: bundled scene metadata.
- `POST /api/analyze`: multipart fields `input_source` (`demo`/`upload`), `demo_case`, `analysis_mode`, `query` (1–8000 characters), `first_image`, `second_image`. Every valid analysis uses the model; legacy `use_ai` fields have no effect.

Successful responses contain `result` (`task`, `answer`, `reason`, `observations`, `limitations`, `clarification`, `model`, `all_warnings`), numbered source previews, metadata, routing, validation, trace and a JSON report. Clarification/unsupported are valid model responses with HTTP 200. Invalid inputs return 400 or 413. Provider failures return explicit errors and no substitute answer/report.

## Verification

```bash
cd frontend
npm test
npm run lint
npm run build
npm run start
```

With the server running, `npm run test:api` checks health and validation without paid inference. Explicitly opt into live model calls with:

```bash
SATQUERY_TEST_LIVE=1 npm run test:api
```

Set `SATQUERY_TEST_URL` for another origin. Unit tests use injected model responses and verify schema checks, clarification, errors, preview preparation, no heuristic fallback and geospatial handling. Live checks send bundled demo images to the configured provider and may consume quota.

Bundled synthetic illustrations live only in `frontend/public/demo_data`. The Python generator, dependencies and virtual environment have been removed; development and deployment use Node.js only.

Browser regressions can run against an already running Chrome/Chromium debugging session:

```bash
google-chrome --headless --remote-debugging-port=9227 --user-data-dir=/tmp/satquery-browser about:blank
# In another terminal, with the app also running:
cd frontend
npm run test:browser
```

Set `SATQUERY_BROWSER_DEBUG_URL` if Chrome uses a different port. This test stubs model responses in the browser (no provider calls) and checks uploads/previews, mode switching, stale results, demo isolation, result rendering, report download and cancellation. Live provider coverage is separate. Screenshots/reports are written to a temporary directory printed by the test.
