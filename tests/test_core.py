from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from satquery_core import (  # noqa: E402
    MODE_AUTO,
    MODE_CHANGE,
    TASK_BI_TEMPORAL_CHANGE,
    TASK_OPTICAL_SAR_FUSION,
    TASK_SINGLE_IMAGE_VQA,
    TASK_TEXT_GUIDED_GROUNDING,
    TASK_UNSUPPORTED,
    bi_temporal_change_analysis,
    load_image,
    make_trace_step,
    route_task,
    validate_inputs,
    vegetation_mask,
    water_mask,
)


def test_one_image_routing():
    route = route_task(1, MODE_AUTO, "What major land-cover regions are visible?")
    assert route["task"] == TASK_SINGLE_IMAGE_VQA
    assert route["reason"]


def test_grounding_routing():
    route = route_task(1, MODE_AUTO, "Please highlight the water body")
    assert route["task"] == TASK_TEXT_GUIDED_GROUNDING


def test_change_routing():
    route = route_task(2, MODE_AUTO, "What changed between these two dates?")
    assert route["task"] == TASK_BI_TEMPORAL_CHANGE


def test_optical_sar_routing():
    route = route_task(2, MODE_AUTO, "Use the optical and SAR images together")
    assert route["task"] == TASK_OPTICAL_SAR_FUSION


def test_unsupported_ambiguous_two_image_routing():
    route = route_task(2, MODE_AUTO, "What major regions are visible?")
    assert route["task"] == TASK_UNSUPPORTED
    assert "Choose a mode" in route["reason"]


def test_water_mask_dimensions():
    image = np.zeros((96, 128, 3), dtype=np.uint8)
    image[:, :] = (90, 115, 80)
    image[20:70, 12:72] = (24, 92, 180)
    mask = water_mask(image)
    assert mask.shape == image.shape[:2]
    assert mask.any()


def test_vegetation_mask_dimensions():
    image = np.zeros((96, 128, 3), dtype=np.uint8)
    image[:, :] = (105, 105, 95)
    image[14:82, 32:92] = (44, 145, 64)
    mask = vegetation_mask(image)
    assert mask.shape == image.shape[:2]
    assert mask.any()


def test_change_mask_dimensions():
    before = np.full((128, 128, 3), (85, 120, 82), dtype=np.uint8)
    after = before.copy()
    after[38:76, 52:96] = (178, 178, 170)
    result = bi_temporal_change_analysis(before, after)
    assert result["mask"].shape == before.shape[:2]


def test_change_detector_identifies_known_synthetic_change():
    before = np.full((128, 128, 3), (86, 122, 82), dtype=np.uint8)
    after = before.copy()
    after[42:86, 44:90] = (190, 190, 184)
    result = bi_temporal_change_analysis(before, after)
    changed_region = result["mask"][42:86, 44:90]
    assert changed_region.mean() > 0.65
    assert result["changed_or_detected_percentage"] > 5.0


def test_execution_trace_contains_required_fields():
    step = make_trace_step(
        "Task Routing",
        "DeterministicRouter",
        "success",
        {"mode": MODE_AUTO},
        3,
        "routed",
    )
    assert set(step) == {"step", "tool", "status", "parameters", "duration_ms", "message"}


def test_empty_or_invalid_input_is_rejected():
    validation = validate_inputs([], MODE_AUTO)
    assert not validation["valid"]
    assert validation["errors"]

    with pytest.raises(ValueError):
        load_image(io.BytesIO(b"not an image"), name="bad.txt")
