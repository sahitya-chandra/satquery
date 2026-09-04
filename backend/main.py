from __future__ import annotations

import base64
import io
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from generate_demo_data import generate_demo_data
from satquery_core import (
    MODE_AUTO,
    MODE_CHANGE,
    MODE_FUSION,
    MODE_SINGLE,
    TASK_BI_TEMPORAL_CHANGE,
    TASK_OPTICAL_SAR_FUSION,
    TASK_SINGLE_IMAGE_VQA,
    TASK_TEXT_GUIDED_GROUNDING,
    TASK_UNSUPPORTED,
    add_trace_step,
    bi_temporal_change_analysis,
    build_json_report,
    deterministic_single_image_vqa,
    ensure_rgb_uint8,
    load_image,
    make_trace_step,
    optical_sar_fusion,
    route_task,
    text_guided_grounding,
    validate_inputs,
    verify_evidence,
)


APP_DIR = Path(__file__).resolve().parents[1]
DEMO_DIR = APP_DIR / "demo_data"

DEMO_CASES: Dict[str, Dict[str, Any]] = {
    "single": {
        "name": "Single Image Analysis",
        "mode": MODE_AUTO,
        "files": ["single_optical.png"],
        "query": "What major land-cover regions are visible?",
    },
    "change": {
        "name": "Bi-temporal Change",
        "mode": MODE_CHANGE,
        "files": ["change_before.png", "change_after.png"],
        "query": "What changed between these two dates, and where?",
    },
    "fusion": {
        "name": "Optical-SAR Fusion",
        "mode": MODE_FUSION,
        "files": ["fusion_optical.png", "fusion_sar.png"],
        "query": "Use the optical and SAR images together to identify water and built-up regions.",
    },
}

IMAGE_RESULT_KEYS = {
    "mask",
    "overlay",
    "mask_display",
    "comparison",
    "sar_preview",
    "water_mask",
    "built_up_mask",
}


def ensure_demo_data() -> None:
    required = {
        "single_optical.png",
        "change_before.png",
        "change_after.png",
        "fusion_optical.png",
        "fusion_sar.png",
    }
    if not DEMO_DIR.exists() or any(not (DEMO_DIR / filename).exists() for filename in required):
        generate_demo_data(DEMO_DIR)


ensure_demo_data()

app = FastAPI(
    title="SatQuery AI API",
    version="0.1.0",
    description="FastAPI backend for satellite-image routing, validation and visual evidence generation.",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "SATQUERY_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/demo_data", StaticFiles(directory=str(DEMO_DIR)), name="demo_data")


@lru_cache(maxsize=2)
def load_blip_resources(model_id: str):
    import torch
    from transformers import BlipForQuestionAnswering, BlipProcessor

    processor = BlipProcessor.from_pretrained(model_id)
    model = BlipForQuestionAnswering.from_pretrained(model_id)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    model.eval()
    return processor, model, device, torch


def run_blip_vqa(rgb_image: np.ndarray, query: str, model_id: str) -> str:
    processor, model, device, torch = load_blip_resources(model_id)
    pil_image = Image.fromarray(ensure_rgb_uint8(rgb_image))
    inputs = processor(pil_image, query, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.no_grad():
        generated = model.generate(**inputs, max_new_tokens=32)
    return processor.decode(generated[0], skip_special_tokens=True).strip()


def run_specialist(
    task: str,
    images: Sequence[Dict[str, Any]],
    query: str,
    use_blip: bool,
) -> Dict[str, Any]:
    if task == TASK_SINGLE_IMAGE_VQA:
        result = deterministic_single_image_vqa(images[0]["display"], query)
        if use_blip:
            model_id = os.getenv("REMOTE_SENSING_MODEL_ID", "Salesforce/blip-vqa-base")
            try:
                blip_answer = run_blip_vqa(images[0]["display"], query, model_id)
                result["answer"] = (
                    f"Generic BLIP baseline answer: {blip_answer}\n\n"
                    f"Deterministic visual evidence: {result['answer']}"
                )
                result["metrics"]["vqa_engine"] = f"Optional baseline: {model_id}"
                result["explanation"] = (
                    "BLIP supplied the generic VQA text answer; deterministic masks provide the displayed "
                    "remote-sensing evidence. BLIP is not a remote-sensing-adapted final model."
                )
            except Exception as exc:
                result["warnings"].append(f"Optional BLIP unavailable or failed; deterministic fallback used. {exc}")
                result["metrics"]["vqa_engine"] = "Deterministic fallback"
        else:
            result["metrics"]["vqa_engine"] = "Deterministic fallback"
        return result

    if task == TASK_TEXT_GUIDED_GROUNDING:
        return text_guided_grounding(images[0]["display"], query)
    if task == TASK_BI_TEMPORAL_CHANGE:
        return bi_temporal_change_analysis(images[0]["display"], images[1]["display"])
    if task == TASK_OPTICAL_SAR_FUSION:
        return optical_sar_fusion(images[0]["display"], images[1]["display"])
    raise ValueError(f"Unsupported task: {task}")


def _json_safe(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return {
            "array_shape": list(value.shape),
            "dtype": str(value.dtype),
        }
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _public_validation(validation: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if validation is None:
        return None
    return {
        key: _json_safe(value)
        for key, value in validation.items()
        if key != "aligned_images"
    }


def _public_result(result: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if result is None:
        return None
    return {
        key: _json_safe(value)
        for key, value in result.items()
        if key not in IMAGE_RESULT_KEYS
    }


def _image_data_url(image: np.ndarray) -> str:
    rgb = ensure_rgb_uint8(image)
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _slug(label: str) -> str:
    slugged = "".join(ch.lower() if ch.isalnum() else "-" for ch in label)
    return "-".join(part for part in slugged.split("-") if part)


def _visual(label: str, image: np.ndarray) -> Dict[str, str]:
    return {
        "id": _slug(label),
        "label": label,
        "src": _image_data_url(image),
    }


def _build_visuals(result: Optional[Dict[str, Any]], images: Sequence[Dict[str, Any]]) -> List[Dict[str, str]]:
    if result is None or not images:
        return []

    task = result.get("task")
    if task == TASK_BI_TEMPORAL_CHANGE and result.get("comparison"):
        comparison = result["comparison"]
        return [
            _visual("Earlier image", comparison["earlier"]),
            _visual("Later image", comparison["later"]),
            _visual("Change mask", comparison["change_mask"]),
            _visual("Change overlay", comparison["change_overlay"]),
        ]

    if task == TASK_OPTICAL_SAR_FUSION:
        return [
            _visual("Optical image", images[0]["display"]),
            _visual("SAR image", result.get("sar_preview", images[1]["display"])),
            _visual("Fusion overlay", result["overlay"]),
            _visual("Water and built-up masks", result["mask_display"]),
        ]

    visuals = [
        _visual("Original image", images[0]["display"]),
        _visual("Evidence overlay", result["overlay"]),
    ]
    if result.get("mask_display") is not None:
        visuals.append(_visual("Mask alone", result["mask_display"]))
    return visuals


def _public_demo_case(case_id: str, case: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": case_id,
        "name": case["name"],
        "mode": case["mode"],
        "files": list(case["files"]),
        "query": case["query"],
        "image_urls": [f"/demo_data/{filename}" for filename in case["files"]],
    }


def _find_demo_case(case_id_or_name: Optional[str]) -> Dict[str, Any]:
    if not case_id_or_name:
        return DEMO_CASES["single"]
    normalized = case_id_or_name.strip().lower()
    if normalized in DEMO_CASES:
        return DEMO_CASES[normalized]
    for case in DEMO_CASES.values():
        if case["name"].lower() == normalized:
            return case
    raise ValueError(f"Unknown demo case: {case_id_or_name}")


async def _read_upload(upload: UploadFile) -> Dict[str, Any]:
    data = await upload.read()
    if not data:
        raise ValueError(f"{upload.filename or 'Uploaded file'} is empty.")
    return load_image(io.BytesIO(data), name=upload.filename or "uploaded_image")


async def _load_selected_images(
    input_source: str,
    demo_case: Optional[str],
    first_image: Optional[UploadFile],
    second_image: Optional[UploadFile],
    trace: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    started = time.perf_counter()
    normalized_source = (input_source or "").strip().lower()

    if normalized_source in {"demo", "demo data", "use demo data"}:
        case = _find_demo_case(demo_case)
        images = [load_image(DEMO_DIR / filename) for filename in case["files"]]
        add_trace_step(
            trace,
            "Input Loaded",
            "DemoDataLoader",
            "success",
            started,
            {"source": "demo", "files": case["files"]},
            f"Loaded {len(images)} generated demo image(s).",
        )
        return images

    uploads = [
        upload
        for upload in [first_image, second_image]
        if upload is not None and getattr(upload, "filename", None)
    ]
    images = [await _read_upload(upload) for upload in uploads]
    status = "success" if images else "error"
    add_trace_step(
        trace,
        "Input Loaded",
        "UploadLoader",
        status,
        started,
        {"source": "upload", "count": len(images), "files": [upload.filename for upload in uploads]},
        f"Loaded {len(images)} uploaded image(s).",
    )
    return images


def _analysis_payload(
    ok: bool,
    trace: Sequence[Dict[str, Any]],
    images: Sequence[Dict[str, Any]] = (),
    validation: Optional[Dict[str, Any]] = None,
    routing: Optional[Dict[str, Any]] = None,
    result: Optional[Dict[str, Any]] = None,
    report: Optional[str] = None,
    error: Optional[str] = None,
    errors: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    return {
        "ok": ok,
        "error": error,
        "errors": list(errors or []),
        "result": _public_result(result),
        "visuals": _build_visuals(result, images),
        "input_metadata": [image.get("metadata", {}) for image in images],
        "validation": _public_validation(validation),
        "routing": _json_safe(routing),
        "trace": _json_safe(list(trace)),
        "report": report,
    }


@app.get("/")
def root() -> Dict[str, str]:
    return {"name": "SatQuery AI API", "status": "ok"}


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/demo-cases")
def demo_cases() -> Dict[str, Any]:
    return {
        "cases": [_public_demo_case(case_id, case) for case_id, case in DEMO_CASES.items()],
        "modes": [MODE_AUTO, MODE_SINGLE, MODE_CHANGE, MODE_FUSION],
    }


@app.post("/api/analyze")
async def analyze(
    input_source: str = Form("demo"),
    demo_case: Optional[str] = Form(None),
    analysis_mode: str = Form(MODE_AUTO),
    query: str = Form(""),
    use_blip: bool = Form(False),
    first_image: Optional[UploadFile] = File(None),
    second_image: Optional[UploadFile] = File(None),
) -> JSONResponse:
    trace: List[Dict[str, Any]] = []
    try:
        images = await _load_selected_images(input_source, demo_case, first_image, second_image, trace)
    except Exception as exc:
        trace.append(
            make_trace_step(
                "Input Loaded",
                "ImageLoader",
                "error",
                {"source": input_source},
                0,
                str(exc),
            )
        )
        return JSONResponse(
            status_code=400,
            content=_analysis_payload(False, trace, error=f"Input could not be loaded: {exc}"),
        )

    started = time.perf_counter()
    validation = validate_inputs(images, analysis_mode)
    add_trace_step(
        trace,
        "GeoGuard Validation",
        "GeoGuard",
        "success" if validation["valid"] else "error",
        started,
        {"mode": analysis_mode, "image_count": len(images)},
        "Inputs accepted." if validation["valid"] else "Inputs rejected.",
    )
    if not validation["valid"]:
        return JSONResponse(
            content=_analysis_payload(
                False,
                trace,
                images,
                validation,
                error="Invalid input.",
                errors=validation["errors"],
            )
        )

    images = validation["aligned_images"]

    started = time.perf_counter()
    routing = route_task(len(images), analysis_mode, query)
    add_trace_step(
        trace,
        "Task Routing",
        "DeterministicRouter",
        "success" if routing["task"] != TASK_UNSUPPORTED else "error",
        started,
        {"mode": analysis_mode, "query": query, "image_count": len(images)},
        routing["reason"],
    )
    if routing["task"] == TASK_UNSUPPORTED:
        return JSONResponse(
            content=_analysis_payload(
                False,
                trace,
                images,
                validation,
                routing,
                error=routing["reason"],
                errors=[routing["reason"]],
            )
        )

    started = time.perf_counter()
    add_trace_step(
        trace,
        "Image Preprocessing",
        "NumPy/OpenCV",
        "success",
        started,
        {"image_count": len(images), "task": routing["task"]},
        "Display-ready RGB arrays prepared for specialist execution.",
    )

    started = time.perf_counter()
    try:
        result = run_specialist(routing["task"], images, query, use_blip)
        add_trace_step(
            trace,
            "Specialist Execution",
            routing["task"],
            "success",
            started,
            {"required_tools": routing.get("required_tools", [])},
            "Specialist completed and produced visual evidence.",
        )
    except Exception as exc:
        add_trace_step(
            trace,
            "Specialist Execution",
            routing["task"],
            "error",
            started,
            {"required_tools": routing.get("required_tools", [])},
            str(exc),
        )
        return JSONResponse(
            status_code=500,
            content=_analysis_payload(
                False,
                trace,
                images,
                validation,
                routing,
                error=f"Analysis failed: {exc}",
                errors=[str(exc)],
            ),
        )

    started = time.perf_counter()
    verification = verify_evidence(result, images, validation)
    result["reliability"] = verification["label"]
    result["reliability_details"] = verification
    result["area_measurement"] = verification["area_measurement"]
    result["all_warnings"] = verification["warnings"]
    add_trace_step(
        trace,
        "Evidence Verification",
        "EvidenceVerifier",
        "success",
        started,
        {"reliability": verification["label"]},
        "Reliability label assigned from transparent heuristic checks.",
    )

    started = time.perf_counter()
    add_trace_step(
        trace,
        "Result Generation",
        "FastAPISerializer",
        "success",
        started,
        {"downloadable_report": True},
        "Answer, overlays, metadata and JSON report prepared.",
    )
    report = build_json_report(result, images, validation, routing, trace)

    return JSONResponse(
        content=_analysis_payload(
            True,
            trace,
            images,
            validation,
            routing,
            result,
            report,
        )
    )
