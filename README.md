# SatQuery AI

SatQuery AI is a lightweight Next.js and FastAPI prototype for asking questions about satellite imagery and seeing the visual evidence used by the answer.

It demonstrates satellite-image upload, GeoTIFF/image validation, deterministic query routing, single-image question answering, text-guided region highlighting, bi-temporal change analysis, optical-SAR heuristic fusion, overlays, a prototype reliability label and an auditable execution trace.

## What It Does Not Claim

This is not a benchmark-ready remote-sensing system, not a calibrated scientific model and not an operational geospatial measurement service. The default analysis is deterministic image processing. Optional BLIP support is a generic VQA baseline and does not satisfy the final remote-sensing adaptation requirement by itself.

## Setup

Run the backend from the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

If your system exposes Python as `python3`, use `python3 -m venv .venv`.

Run the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend expects the backend at `http://localhost:8000` by default. Override it with:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev
```

## Optional AI Baseline

```bash
pip install -r requirements-ai.txt
```

The optional checkbox in the app asks the FastAPI backend to lazily load `Salesforce/blip-vqa-base` only when requested. You can point the hook at a future remote-sensing-adapted model with:

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

PNG, JPEG, TIFF and GeoTIFF are supported. GeoTIFF metadata is read with Rasterio, including width, height, band count, CRS, geographic bounds, pixel resolution, nodata and data type where available.

## Known Limitations

The masks are RGB, texture and intensity heuristics. Results are sensitive to season, illumination, atmospheric effects, sensor differences, clouds, shadows and image alignment. PNG/JPEG pairs are resized when necessary and treated as already co-registered. Reliable ground-area measurement requires a projected GeoTIFF.

## Future Model Replacement

The `REMOTE_SENSING_MODEL_ID` environment variable and lazy model-loading path are intended as a simple replacement hook. A future BigEarthNet.txt-adapted or otherwise remote-sensing-adapted model can replace the generic BLIP baseline while keeping the same validation, routing, evidence and trace surfaces.

## API

The FastAPI backend exposes:

- `GET /api/health`
- `GET /api/demo-cases`
- `POST /api/analyze`

`POST /api/analyze` accepts multipart form data with `input_source`, `demo_case`, `analysis_mode`, `query`, `use_blip`, `first_image` and `second_image`. It returns JSON metadata, execution trace, a downloadable report string and PNG data URLs for visual evidence.
