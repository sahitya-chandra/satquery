from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, Dict, List

import streamlit as st
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
    load_image,
    optical_sar_fusion,
    route_task,
    text_guided_grounding,
    validate_inputs,
    verify_evidence,
)


APP_DIR = Path(__file__).resolve().parent
DEMO_DIR = APP_DIR / "demo_data"

DEMO_CASES = {
    "Single Image Analysis": {
        "mode": MODE_AUTO,
        "files": ["single_optical.png"],
        "query": "What major land-cover regions are visible?",
    },
    "Bi-temporal Change": {
        "mode": MODE_CHANGE,
        "files": ["change_before.png", "change_after.png"],
        "query": "What changed between these two dates, and where?",
    },
    "Optical-SAR Fusion": {
        "mode": MODE_FUSION,
        "files": ["fusion_optical.png", "fusion_sar.png"],
        "query": "Use the optical and SAR images together to identify water and built-up regions.",
    },
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


@st.cache_resource(show_spinner=False)
def load_blip_resources(model_id: str):
    import torch
    from transformers import BlipForQuestionAnswering, BlipProcessor

    processor = BlipProcessor.from_pretrained(model_id)
    model = BlipForQuestionAnswering.from_pretrained(model_id)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    model.eval()
    return processor, model, device, torch


def run_blip_vqa(rgb_image, query: str, model_id: str) -> str:
    processor, model, device, torch = load_blip_resources(model_id)
    pil_image = Image.fromarray(rgb_image)
    inputs = processor(pil_image, query, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.no_grad():
        generated = model.generate(**inputs, max_new_tokens=32)
    return processor.decode(generated[0], skip_special_tokens=True).strip()


def set_demo_case(case_name: str) -> None:
    case = DEMO_CASES[case_name]
    st.session_state["input_source"] = "Use Demo Data"
    st.session_state["analysis_mode"] = case["mode"]
    st.session_state["query"] = case["query"]
    st.session_state["demo_case"] = case_name


def load_selected_images(input_source: str, uploads: Dict[str, Any], trace: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    started = time.perf_counter()
    images = []
    if input_source == "Use Demo Data":
        case = DEMO_CASES[st.session_state["demo_case"]]
        images = [load_image(DEMO_DIR / filename) for filename in case["files"]]
        add_trace_step(
            trace,
            "Input Loaded",
            "DemoDataLoader",
            "success",
            started,
            {"source": input_source, "files": case["files"]},
            f"Loaded {len(images)} generated demo image(s).",
        )
        return images

    if uploads.get("first") is not None:
        images.append(load_image(uploads["first"], name=uploads["first"].name))
    if uploads.get("second") is not None:
        images.append(load_image(uploads["second"], name=uploads["second"].name))
    status = "success" if images else "error"
    add_trace_step(
        trace,
        "Input Loaded",
        "UploadLoader",
        status,
        started,
        {"source": input_source, "count": len(images)},
        f"Loaded {len(images)} uploaded image(s).",
    )
    return images


def run_specialist(
    task: str,
    images: List[Dict[str, Any]],
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


def render_styles() -> None:
    st.markdown(
        """
        <style>
        :root {
            --navy: #071A33;
            --sat-blue: #1677C8;
            --isro-orange: #F47B20;
            --teal: #14A78B;
            --ink: #132238;
            --soft: #EEF5FA;
            --panel: #F7FAFD;
            --line: #D9E6F0;
            --muted: #5E7084;
        }
        html,
        body,
        .stApp,
        [data-testid="stAppViewContainer"],
        [data-testid="stMain"],
        [data-testid="stMainBlockContainer"] {
            background: #FFFFFF;
            color: var(--ink);
        }
        [data-testid="stHeader"] {
            background: rgba(255, 255, 255, .96);
            color: var(--ink);
        }
        h1, h2, h3, h4, h5, h6,
        p, span, label,
        [data-testid="stMarkdownContainer"],
        [data-testid="stWidgetLabel"],
        [data-testid="stCaptionContainer"] {
            color: var(--ink);
        }
        [data-testid="stCaptionContainer"],
        small {
            color: var(--muted);
        }
        .sat-header {
            border: 1px solid #dce8f2;
            border-radius: 8px;
            padding: 1.25rem 1.35rem;
            background: linear-gradient(110deg, rgba(7,26,51,.96), rgba(22,119,200,.90));
            color: white;
            margin-bottom: 1rem;
        }
        .sat-title {
            font-size: 2.2rem;
            line-height: 1.05;
            font-weight: 760;
            margin: 0 0 .25rem 0;
            letter-spacing: 0;
        }
        .sat-subtitle {
            font-size: 1.08rem;
            margin: 0 0 .45rem 0;
            color: #dff3ff;
        }
        .sat-disclaimer {
            max-width: 760px;
            font-size: .92rem;
            color: #f4fbff;
            margin: 0;
            border-left: 3px solid var(--isro-orange);
            padding-left: .7rem;
        }
        .sat-header .sat-title,
        .sat-header .sat-subtitle,
        .sat-header .sat-disclaimer {
            color: white;
        }
        div[data-baseweb="select"] > div,
        div[data-baseweb="input"] > div,
        div[data-baseweb="textarea"] > div,
        textarea,
        input {
            background-color: #FFFFFF;
            color: var(--ink);
            border-color: var(--line);
        }
        div[data-baseweb="select"] svg,
        div[data-baseweb="checkbox"] svg,
        div[data-baseweb="radio"] svg {
            color: var(--sat-blue);
            fill: var(--sat-blue);
        }
        [data-baseweb="popover"],
        [data-baseweb="menu"],
        [role="listbox"] {
            background-color: #FFFFFF;
            color: var(--ink);
        }
        [role="option"] {
            background-color: #FFFFFF;
            color: var(--ink);
        }
        [role="option"]:hover,
        [role="option"][aria-selected="true"] {
            background-color: var(--soft);
            color: var(--navy);
        }
        [data-testid="stTextArea"] textarea,
        [data-testid="stTextInput"] input {
            background: #FFFFFF;
            color: var(--ink);
            border: 1px solid var(--line);
            caret-color: var(--sat-blue);
        }
        [data-testid="stTextArea"] textarea:focus,
        [data-testid="stTextInput"] input:focus {
            border-color: var(--sat-blue);
            box-shadow: 0 0 0 1px var(--sat-blue);
        }
        [data-testid="stRadio"] label,
        [data-testid="stCheckbox"] label {
            color: var(--ink);
        }
        [data-testid="stFileUploader"] section {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            color: var(--ink);
        }
        [data-testid="stFileUploader"] section button {
            background: #FFFFFF;
            color: var(--navy);
            border: 1px solid var(--sat-blue);
        }
        [data-testid="stFileUploader"] section div,
        [data-testid="stFileUploader"] section span,
        [data-testid="stFileUploader"] section small {
            color: var(--ink);
        }
        [data-testid="stAlert"] {
            background: #F3F8FC;
            color: var(--ink);
            border-radius: 8px;
        }
        div.stButton > button[kind="primary"] {
            background-color: var(--isro-orange);
            border-color: var(--isro-orange);
            color: white;
        }
        div.stButton > button {
            border-radius: 8px;
            background: #FFFFFF;
            color: var(--navy);
            border: 1px solid #B7CADB;
            box-shadow: none;
        }
        div.stButton > button:hover {
            border-color: var(--sat-blue);
            color: var(--sat-blue);
            background: #F8FBFE;
        }
        div.stButton > button[kind="primary"]:hover {
            background-color: #D96613;
            border-color: #D96613;
            color: white;
        }
        [data-testid="stMetricValue"] {
            color: var(--navy);
            font-size: 1.35rem;
        }
        [data-testid="stMetricLabel"] {
            color: #39546f;
        }
        [data-testid="stMetric"] {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: .8rem .9rem;
        }
        [data-testid="stExpander"] {
            background: #FFFFFF;
            border: 1px solid var(--line);
            border-radius: 8px;
        }
        [data-testid="stExpander"] summary,
        [data-testid="stExpander"] details,
        [data-testid="stExpander"] div {
            color: var(--ink);
        }
        [data-testid="stTable"] {
            background: #FFFFFF;
            color: var(--ink);
        }
        [data-testid="stTable"] table {
            background: #FFFFFF;
            color: var(--ink);
            border-color: var(--line);
        }
        [data-testid="stTable"] th {
            background: var(--soft);
            color: var(--navy);
        }
        [data-testid="stTable"] td {
            background: #FFFFFF;
            color: var(--ink);
            border-color: var(--line);
        }
        [data-testid="stJson"] {
            background: #FFFFFF;
            color: var(--ink);
            border: 1px solid var(--line);
            border-radius: 8px;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_header() -> None:
    st.markdown(
        """
        <div class="sat-header">
            <div class="sat-title">SatQuery AI</div>
            <div class="sat-subtitle">Ask satellite imagery. See the evidence.</div>
            <p class="sat-disclaimer">
                Lightweight demonstration of input-aware routing, spatial evidence and multimodal analysis.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_inputs():
    st.subheader("Input")
    st.caption("Demo cases")
    demo_cols = st.columns(3)
    for column, case_name in zip(demo_cols, DEMO_CASES):
        if column.button(case_name, use_container_width=True):
            set_demo_case(case_name)

    input_source = st.radio(
        "Input source",
        ["Use Demo Data", "Upload My Images"],
        horizontal=True,
        key="input_source",
    )
    analysis_mode = st.selectbox(
        "Analysis mode",
        [MODE_AUTO, MODE_SINGLE, MODE_CHANGE, MODE_FUSION],
        key="analysis_mode",
    )

    first_upload = None
    second_upload = None
    if input_source == "Use Demo Data":
        st.selectbox("Loaded demo case", list(DEMO_CASES), key="demo_case")
    else:
        first_label = "First image uploader"
        second_label = "Second image uploader"
        if analysis_mode == MODE_FUSION:
            first_label = "First image uploader (optical)"
            second_label = "Second image uploader (SAR/radar)"
            st.info("Optical-SAR mode expects the first image to be optical and the second image to be SAR.")
        first_upload = st.file_uploader(first_label, type=["png", "jpg", "jpeg", "tif", "tiff"])
        if analysis_mode in {MODE_AUTO, MODE_CHANGE, MODE_FUSION}:
            second_upload = st.file_uploader(second_label, type=["png", "jpg", "jpeg", "tif", "tiff"])

    query = st.text_area("Natural-language query", key="query", height=92)
    use_blip = st.checkbox(
        "Use optional BLIP model",
        value=False,
        help="Loads a generic BLIP VQA baseline only when selected. The deterministic fallback is always available.",
    )
    analyse = st.button("Analyse", type="primary", use_container_width=True)
    return input_source, analysis_mode, {"first": first_upload, "second": second_upload}, query, use_blip, analyse


def render_images(result: Dict[str, Any], images: List[Dict[str, Any]]) -> None:
    task = result.get("task")
    st.subheader("Visual Evidence")
    if task == TASK_BI_TEMPORAL_CHANGE and result.get("comparison"):
        st.caption("Red fill and outline mark detected visual change candidates.")
        labels = ["Earlier image", "Later image", "Change mask", "Change overlay"]
        keys = ["earlier", "later", "change_mask", "change_overlay"]
        cols = st.columns(4)
        for col, label, key in zip(cols, labels, keys):
            col.image(result["comparison"][key], caption=label, use_container_width=True)
        return

    if task == TASK_OPTICAL_SAR_FUSION:
        st.caption("Blue marks water evidence. Orange marks built-up evidence. Strong outlines improve visibility.")
        cols = st.columns(4)
        cols[0].image(images[0]["display"], caption="Optical image", use_container_width=True)
        cols[1].image(result.get("sar_preview", images[1]["display"]), caption="SAR image", use_container_width=True)
        cols[2].image(result["overlay"], caption="Fusion overlay", use_container_width=True)
        cols[3].image(result["mask_display"], caption="Water and built-up masks", use_container_width=True)
        return

    st.caption("Blue marks water, green marks vegetation and orange marks built-up/high-texture evidence.")
    cols = st.columns(3)
    cols[0].image(images[0]["display"], caption="Original image", use_container_width=True)
    cols[1].image(result["overlay"], caption="Evidence overlay", use_container_width=True)
    if result.get("mask_display") is not None:
        cols[2].image(result["mask_display"], caption="Mask alone", use_container_width=True)
    else:
        cols[2].image(images[0]["display"], caption="No supported mask", use_container_width=True)


def render_area(area: Dict[str, Any]) -> None:
    st.subheader("Area Measurement")
    if area.get("available"):
        cols = st.columns(3)
        cols[0].metric("Square metres", f"{area['area_square_metres']:.1f}")
        cols[1].metric("Hectares", f"{area['area_hectares']:.3f}")
        cols[2].metric("Square kilometres", f"{area['area_square_kilometres']:.5f}")
    st.caption(area.get("message", "No area information available."))


def render_output(
    result: Dict[str, Any],
    images: List[Dict[str, Any]],
    validation: Dict[str, Any],
    routing: Dict[str, Any],
    trace: List[Dict[str, Any]],
) -> None:
    st.subheader("Output")
    metric_cols = st.columns(3)
    metric_cols[0].metric("Selected Task", result["task"])
    metric_cols[1].metric("Prototype Reliability", result["reliability"])
    metric_cols[2].metric(
        "Changed or Detected Area",
        f"{float(result.get('changed_or_detected_percentage') or 0):.1f}%",
    )

    st.markdown("**Answer**")
    st.write(result["answer"])
    st.caption(result.get("explanation", ""))

    render_images(result, images)
    render_area(result.get("area_measurement", {}))

    with st.expander("Input Metadata", expanded=False):
        st.json([image["metadata"] for image in images])

    with st.expander("Warnings", expanded=bool(result.get("all_warnings"))):
        warnings = result.get("all_warnings") or []
        if warnings:
            for warning in warnings:
                st.warning(warning)
        else:
            st.write("No warnings were reported.")

    with st.expander("GeoGuard Validation Checks", expanded=False):
        st.table(validation.get("checks", []))

    st.subheader("Execution Trace")
    st.table(trace)

    report = build_json_report(result, images, validation, routing, trace)
    st.download_button(
        "Download JSON report",
        data=report,
        file_name="satquery_ai_report.json",
        mime="application/json",
        use_container_width=True,
    )


def main() -> None:
    st.set_page_config(page_title="SatQuery AI", page_icon="S", layout="wide")
    ensure_demo_data()
    st.session_state.setdefault("input_source", "Use Demo Data")
    st.session_state.setdefault("analysis_mode", DEMO_CASES["Single Image Analysis"]["mode"])
    st.session_state.setdefault("query", DEMO_CASES["Single Image Analysis"]["query"])
    st.session_state.setdefault("demo_case", "Single Image Analysis")

    render_styles()
    render_header()
    input_source, analysis_mode, uploads, query, use_blip, analyse = render_inputs()

    if not analyse:
        return

    trace: List[Dict[str, Any]] = []
    try:
        images = load_selected_images(input_source, uploads, trace)
    except Exception as exc:
        st.error(f"Input could not be loaded: {exc}")
        trace.append(
            {
                "step": "Input Loaded",
                "tool": "ImageLoader",
                "status": "error",
                "parameters": {"source": input_source},
                "duration_ms": 0,
                "message": str(exc),
            }
        )
        st.table(trace)
        return

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
        st.error("Invalid input")
        for error in validation["errors"]:
            st.error(error)
        with st.expander("Validation checks", expanded=True):
            st.table(validation["checks"])
        st.subheader("Execution Trace")
        st.table(trace)
        return

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
        st.error(routing["reason"])
        with st.expander("GeoGuard Validation Checks", expanded=False):
            st.table(validation["checks"])
        st.subheader("Execution Trace")
        st.table(trace)
        return

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
        st.error(f"Analysis failed: {exc}")
        st.table(trace)
        return

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
        "StreamlitRenderer",
        "success",
        started,
        {"downloadable_report": True},
        "Answer, overlays, metadata and JSON report prepared.",
    )
    render_output(result, images, validation, routing, trace)


if __name__ == "__main__":
    main()
