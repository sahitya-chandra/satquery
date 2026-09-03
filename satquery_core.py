from __future__ import annotations

import io
import json
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
import rasterio
from PIL import Image
from rasterio.io import MemoryFile
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds


TASK_SINGLE_IMAGE_VQA = "SINGLE_IMAGE_VQA"
TASK_TEXT_GUIDED_GROUNDING = "TEXT_GUIDED_GROUNDING"
TASK_BI_TEMPORAL_CHANGE = "BI_TEMPORAL_CHANGE"
TASK_OPTICAL_SAR_FUSION = "OPTICAL_SAR_FUSION"
TASK_UNSUPPORTED = "UNSUPPORTED"

MODE_AUTO = "Auto Detect"
MODE_SINGLE = "Single Image"
MODE_CHANGE = "Bi-temporal Change"
MODE_FUSION = "Optical-SAR Pair"

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}

THEME_COLORS = {
    "water": (0, 96, 255),
    "vegetation": (0, 190, 90),
    "built_up": (255, 125, 0),
    "change": (255, 32, 32),
}


def make_trace_step(
    step: str,
    tool: str,
    status: str,
    parameters: Optional[Dict[str, Any]] = None,
    duration_ms: int = 0,
    message: str = "",
) -> Dict[str, Any]:
    return {
        "step": step,
        "tool": tool,
        "status": status,
        "parameters": parameters or {},
        "duration_ms": int(duration_ms),
        "message": message,
    }


def add_trace_step(
    trace: List[Dict[str, Any]],
    step: str,
    tool: str,
    status: str,
    started_at: float,
    parameters: Optional[Dict[str, Any]] = None,
    message: str = "",
) -> None:
    duration_ms = round((time.perf_counter() - started_at) * 1000)
    trace.append(make_trace_step(step, tool, status, parameters, duration_ms, message))


def _source_name(source: Any, name: Optional[str] = None) -> str:
    if name:
        return Path(name).name
    if isinstance(source, (str, Path)):
        return Path(source).name
    if hasattr(source, "name") and source.name:
        return Path(str(source.name)).name
    return "image"


def _read_source_bytes(source: Any) -> bytes:
    if isinstance(source, bytes):
        return source
    if isinstance(source, (str, Path)):
        return Path(source).read_bytes()
    if hasattr(source, "getvalue"):
        data = source.getvalue()
        if isinstance(data, str):
            return data.encode("utf-8")
        return data
    if hasattr(source, "read"):
        position = None
        if hasattr(source, "tell") and hasattr(source, "seek"):
            try:
                position = source.tell()
                source.seek(0)
            except Exception:
                position = None
        data = source.read()
        if position is not None:
            try:
                source.seek(position)
            except Exception:
                pass
        if isinstance(data, str):
            return data.encode("utf-8")
        return data
    raise ValueError("Input is not a readable file-like object or path.")


def _finite_percentile_stretch(values: np.ndarray, low: float = 2.0, high: float = 98.0) -> np.ndarray:
    arr = np.asarray(values, dtype=np.float32)
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return np.zeros(arr.shape, dtype=np.uint8)

    lo, hi = np.percentile(finite, [low, high])
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        lo = float(np.min(finite))
        hi = float(np.max(finite))
    if hi <= lo:
        return np.zeros(arr.shape, dtype=np.uint8)

    scaled = (arr - lo) / (hi - lo)
    scaled = np.clip(scaled, 0.0, 1.0)
    scaled = np.nan_to_num(scaled, nan=0.0, posinf=1.0, neginf=0.0)
    return (scaled * 255).astype(np.uint8)


def _raster_display_preview(raw_data: np.ndarray) -> np.ndarray:
    if raw_data.ndim != 3 or raw_data.shape[0] == 0:
        raise ValueError("Raster has no readable bands.")

    if raw_data.shape[0] >= 3:
        bands = raw_data[:3]
        return np.dstack([_finite_percentile_stretch(band) for band in bands])

    gray = _finite_percentile_stretch(raw_data[0])
    return np.dstack([gray, gray, gray])


def _bounds_to_dict(bounds: Any) -> Optional[Dict[str, float]]:
    if bounds is None:
        return None
    return {
        "left": float(bounds.left),
        "bottom": float(bounds.bottom),
        "right": float(bounds.right),
        "top": float(bounds.top),
    }


def _serializable_transform(transform: Optional[Affine]) -> Optional[List[float]]:
    if transform is None:
        return None
    return [float(v) for v in transform]


def load_image(source: Any, name: Optional[str] = None) -> Dict[str, Any]:
    """Load PNG/JPEG/TIFF/GeoTIFF and return display RGB plus metadata."""
    source_name = _source_name(source, name)
    suffix = Path(source_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type '{suffix or 'unknown'}'. Supported formats: PNG, JPEG, TIFF and GeoTIFF."
        )

    if suffix in {".tif", ".tiff"}:
        if isinstance(source, (str, Path)):
            with rasterio.open(source) as src:
                return _load_raster_dataset(src, source_name, suffix)

        with MemoryFile(_read_source_bytes(source)) as memory_file:
            with memory_file.open() as src:
                return _load_raster_dataset(src, source_name, suffix)

    data = _read_source_bytes(source)
    with Image.open(io.BytesIO(data)) as image:
        original_bands = len(image.getbands())
        display = np.asarray(image.convert("RGB"), dtype=np.uint8)

    height, width = display.shape[:2]
    metadata = {
        "name": source_name,
        "format": "JPEG" if suffix in {".jpg", ".jpeg"} else "PNG",
        "width": int(width),
        "height": int(height),
        "bands": int(original_bands),
        "crs": None,
        "bounds": None,
        "pixel_resolution": None,
        "nodata": None,
        "dtype": str(display.dtype),
        "is_geotiff": False,
        "crs_is_projected": False,
    }
    return {
        "name": source_name,
        "display": display,
        "metadata": metadata,
        "raw_data": np.moveaxis(display.astype(np.float32), -1, 0),
        "transform": None,
        "crs": None,
        "bounds": None,
        "alignment_notes": [],
    }


def _load_raster_dataset(src: rasterio.io.DatasetReader, source_name: str, suffix: str) -> Dict[str, Any]:
    if src.width <= 0 or src.height <= 0 or src.count <= 0:
        raise ValueError("Raster has empty dimensions or no bands.")

    raw_data = src.read(out_dtype="float32")
    if src.nodata is not None:
        raw_data = np.where(raw_data == float(src.nodata), np.nan, raw_data)

    display = _raster_display_preview(raw_data)
    crs_text = src.crs.to_string() if src.crs else None
    is_geotiff = bool(src.crs) or src.transform != Affine.identity()
    metadata = {
        "name": source_name,
        "format": "GeoTIFF" if is_geotiff else "TIFF",
        "width": int(src.width),
        "height": int(src.height),
        "bands": int(src.count),
        "crs": crs_text,
        "bounds": _bounds_to_dict(src.bounds),
        "pixel_resolution": {"x": float(abs(src.res[0])), "y": float(abs(src.res[1]))},
        "nodata": None if src.nodata is None else float(src.nodata),
        "dtype": str(src.dtypes[0]) if src.dtypes else str(raw_data.dtype),
        "driver": src.driver,
        "is_geotiff": bool(is_geotiff),
        "crs_is_projected": bool(src.crs and src.crs.is_projected),
        "transform": _serializable_transform(src.transform),
    }
    return {
        "name": source_name,
        "display": display,
        "metadata": metadata,
        "raw_data": raw_data,
        "transform": src.transform,
        "crs": src.crs,
        "bounds": src.bounds,
        "alignment_notes": [],
    }


def _add_check(checks: List[Dict[str, str]], name: str, status: str, message: str) -> None:
    checks.append({"name": name, "status": status, "message": message})


def _required_count(mode: str) -> Optional[int]:
    if mode == MODE_SINGLE:
        return 1
    if mode in {MODE_CHANGE, MODE_FUSION}:
        return 2
    return None


def _image_shape(image_record: Dict[str, Any]) -> Tuple[int, int]:
    display = image_record["display"]
    return int(display.shape[0]), int(display.shape[1])


def _bounds_overlap(bounds_a: Sequence[float], bounds_b: Sequence[float]) -> bool:
    left_a, bottom_a, right_a, top_a = bounds_a
    left_b, bottom_b, right_b, top_b = bounds_b
    return not (right_a <= left_b or right_b <= left_a or top_a <= bottom_b or top_b <= bottom_a)


def _same_grid(first: Dict[str, Any], second: Dict[str, Any]) -> bool:
    if first.get("crs") != second.get("crs"):
        return False
    if _image_shape(first) != _image_shape(second):
        return False
    first_transform = first.get("transform")
    second_transform = second.get("transform")
    if first_transform is None or second_transform is None:
        return False
    return np.allclose(tuple(first_transform), tuple(second_transform), rtol=1e-8, atol=1e-8)


def _resize_second_to_first(first: Dict[str, Any], second: Dict[str, Any], note: str) -> Dict[str, Any]:
    height, width = _image_shape(first)
    resized = cv2.resize(second["display"], (width, height), interpolation=cv2.INTER_AREA)
    aligned = dict(second)
    aligned["display"] = resized.astype(np.uint8)
    aligned["raw_data"] = np.moveaxis(aligned["display"].astype(np.float32), -1, 0)
    aligned["alignment_notes"] = [*second.get("alignment_notes", []), note]
    aligned["metadata"] = dict(second["metadata"])
    aligned["metadata"]["analysis_width"] = int(width)
    aligned["metadata"]["analysis_height"] = int(height)
    aligned["metadata"]["alignment_note"] = note
    return aligned


def _reproject_second_to_first(first: Dict[str, Any], second: Dict[str, Any]) -> Dict[str, Any]:
    first_height, first_width = _image_shape(first)
    source = second["raw_data"].astype(np.float32)
    destination = np.full((source.shape[0], first_height, first_width), np.nan, dtype=np.float32)
    src_nodata = second["metadata"].get("nodata")

    for band_index in range(source.shape[0]):
        reproject(
            source=source[band_index],
            destination=destination[band_index],
            src_transform=second["transform"],
            src_crs=second["crs"],
            src_nodata=src_nodata,
            dst_transform=first["transform"],
            dst_crs=first["crs"],
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )

    aligned = dict(second)
    aligned["display"] = _raster_display_preview(destination)
    aligned["raw_data"] = destination
    aligned["transform"] = first["transform"]
    aligned["crs"] = first["crs"]
    aligned["bounds"] = first["bounds"]
    aligned["alignment_notes"] = [*second.get("alignment_notes", []), "Reprojected to the first image grid."]
    aligned["metadata"] = dict(second["metadata"])
    aligned["metadata"]["width"] = int(first_width)
    aligned["metadata"]["height"] = int(first_height)
    aligned["metadata"]["crs"] = first["metadata"].get("crs")
    aligned["metadata"]["bounds"] = first["metadata"].get("bounds")
    aligned["metadata"]["pixel_resolution"] = first["metadata"].get("pixel_resolution")
    aligned["metadata"]["transform"] = first["metadata"].get("transform")
    aligned["metadata"]["alignment_note"] = "Reprojected to the first image grid."
    return aligned


def validate_inputs(images: Sequence[Dict[str, Any]], selected_mode: str) -> Dict[str, Any]:
    checks: List[Dict[str, str]] = []
    warnings: List[str] = []
    errors: List[str] = []
    aligned_images = list(images)

    count = len(aligned_images)
    required = _required_count(selected_mode)
    if count == 0:
        errors.append("Provide at least one supported satellite image.")
        _add_check(checks, "Image count", "fail", "No input images were provided.")
    elif count > 2:
        errors.append("This prototype accepts at most two images.")
        _add_check(checks, "Image count", "fail", f"{count} images were provided.")
    elif required is not None and count != required:
        errors.append(f"{selected_mode} requires exactly {required} image(s).")
        _add_check(checks, "Image count", "fail", f"Expected {required}, received {count}.")
    else:
        _add_check(checks, "Image count", "pass", f"{count} image(s) provided.")

    for index, image in enumerate(aligned_images, start=1):
        metadata = image.get("metadata", {})
        width = int(metadata.get("width") or 0)
        height = int(metadata.get("height") or 0)
        bands = int(metadata.get("bands") or 0)
        if width <= 0 or height <= 0 or bands <= 0:
            errors.append(f"Image {index} has empty dimensions or no bands.")
            _add_check(checks, f"Image {index} readability", "fail", "Empty dimensions or no bands.")
        else:
            _add_check(
                checks,
                f"Image {index} readability",
                "pass",
                f"{width} x {height}, {bands} band(s), {metadata.get('format')}.",
            )

        if metadata.get("is_geotiff") and metadata.get("nodata") is None:
            warning = f"Image {index} is a GeoTIFF/TIFF without an explicit nodata value."
            warnings.append(warning)
            _add_check(checks, f"Image {index} nodata", "warn", warning)

    if count == 2 and not errors:
        first, second = aligned_images
        first_geo = bool(first["metadata"].get("is_geotiff"))
        second_geo = bool(second["metadata"].get("is_geotiff"))
        first_has_grid = bool(first.get("crs") and first.get("transform") is not None and first.get("bounds"))
        second_has_grid = bool(second.get("crs") and second.get("transform") is not None and second.get("bounds"))

        if first_geo and second_geo and first_has_grid and second_has_grid:
            try:
                first_bounds = tuple(first["bounds"])
                if first["crs"] != second["crs"]:
                    second_bounds = transform_bounds(
                        second["crs"],
                        first["crs"],
                        second["bounds"].left,
                        second["bounds"].bottom,
                        second["bounds"].right,
                        second["bounds"].top,
                        densify_pts=21,
                    )
                    warnings.append("Input CRS differs; second GeoTIFF will be reprojected to the first image grid.")
                    _add_check(checks, "CRS compatibility", "warn", "Different CRS values; reprojection is required.")
                else:
                    second_bounds = tuple(second["bounds"])
                    _add_check(checks, "CRS compatibility", "pass", "Both GeoTIFFs use the same CRS.")

                if not _bounds_overlap(first_bounds, second_bounds):
                    errors.append("The two GeoTIFF geographic bounds do not overlap; analysis was rejected.")
                    _add_check(checks, "Geographic overlap", "fail", "No overlap between image bounds.")
                else:
                    _add_check(checks, "Geographic overlap", "pass", "GeoTIFF bounds overlap.")

                res_a = first["metadata"].get("pixel_resolution") or {}
                res_b = second["metadata"].get("pixel_resolution") or {}
                if first["crs"] == second["crs"] and res_a and res_b:
                    mean_a = (float(res_a["x"]) + float(res_a["y"])) / 2.0
                    mean_b = (float(res_b["x"]) + float(res_b["y"])) / 2.0
                    if mean_a > 0 and mean_b > 0:
                        ratio = abs(mean_a - mean_b) / max(mean_a, mean_b)
                        if ratio > 0.2:
                            warning = "Pixel resolutions differ by more than 20%; resampling may affect details."
                            warnings.append(warning)
                            _add_check(checks, "Pixel resolution", "warn", warning)
                        else:
                            _add_check(checks, "Pixel resolution", "pass", "Pixel resolutions are similar.")

                if not errors and not _same_grid(first, second):
                    aligned_images[1] = _reproject_second_to_first(first, second)
                    warning = "Second GeoTIFF was reprojected to match the first image grid for analysis."
                    warnings.append(warning)
                    _add_check(checks, "Image alignment", "warn", warning)
                elif not errors:
                    _add_check(checks, "Image alignment", "pass", "GeoTIFF grids are already aligned.")
            except Exception as exc:
                errors.append(f"GeoTIFF compatibility check failed: {exc}")
                _add_check(checks, "GeoTIFF compatibility", "fail", str(exc))
        else:
            if first_geo != second_geo:
                warning = "Mixed georeferenced and ordinary image inputs; geospatial alignment cannot be verified."
                warnings.append(warning)
                _add_check(checks, "Geospatial compatibility", "warn", warning)
            else:
                warning = "PNG/JPEG pair alignment was assumed; benchmark-style co-registration is not verified."
                warnings.append(warning)
                _add_check(checks, "Image alignment", "warn", warning)

            if _image_shape(first) != _image_shape(second):
                aligned_images[1] = _resize_second_to_first(
                    first,
                    second,
                    "Resized to the first image dimensions for prototype analysis.",
                )
                warnings.append("Second image was resized to the first image dimensions.")
                _add_check(checks, "Shape compatibility", "warn", "Second image was resized for analysis.")
            else:
                _add_check(checks, "Shape compatibility", "pass", "Image dimensions match.")

    return {
        "valid": len(errors) == 0,
        "checks": checks,
        "warnings": warnings,
        "errors": errors,
        "aligned_images": aligned_images,
    }


def _contains_any(query: str, terms: Sequence[str]) -> bool:
    lowered = query.lower()
    return any(term.lower() in lowered for term in terms)


def route_task(num_images: int, selected_mode: str, query: str) -> Dict[str, Any]:
    query = query or ""
    grounding_actions = ["highlight", "locate", "show me", "mark", "where is"]
    grounding_concepts = ["water", "river", "lake", "vegetation", "forest", "crop", "urban", "built-up", "built up"]
    change_terms = ["change", "changed", "increase", "decrease", "before", "after", "between", "dates"]
    fusion_terms = ["sar", "radar", "optical", "fusion", "both images", "together"]

    if selected_mode == MODE_CHANGE:
        return {
            "task": TASK_BI_TEMPORAL_CHANGE,
            "reason": "Manual mode selected: bi-temporal change analysis.",
            "required_tools": ["image_alignment", "LAB_difference", "morphology"],
        }
    if selected_mode == MODE_FUSION:
        return {
            "task": TASK_OPTICAL_SAR_FUSION,
            "reason": "Manual mode selected: optical-SAR pair analysis.",
            "required_tools": ["optical_masks", "sar_normalization", "sensor_fusion"],
        }

    if num_images == 1:
        if _contains_any(query, grounding_actions) and _contains_any(query, grounding_concepts):
            return {
                "task": TASK_TEXT_GUIDED_GROUNDING,
                "reason": "One image plus a spatial grounding phrase and supported land-cover concept.",
                "required_tools": ["RGB_heuristic_mask", "connected_components", "overlay"],
            }
        return {
            "task": TASK_SINGLE_IMAGE_VQA,
            "reason": "One image supplied, so the query is routed to single-image question answering.",
            "required_tools": ["image_statistics", "deterministic_vqa_fallback"],
        }

    if num_images == 2:
        has_change = _contains_any(query, change_terms)
        has_fusion = _contains_any(query, fusion_terms)
        if selected_mode == MODE_SINGLE:
            return {
                "task": TASK_UNSUPPORTED,
                "reason": "Single Image mode was selected but two images were supplied.",
                "required_tools": [],
            }
        if has_change and has_fusion:
            return {
                "task": TASK_UNSUPPORTED,
                "reason": (
                    "The query includes both change-analysis and optical-SAR fusion terms. "
                    "Select a specific analysis mode to disambiguate."
                ),
                "required_tools": [],
            }
        if has_change:
            return {
                "task": TASK_BI_TEMPORAL_CHANGE,
                "reason": "Two images plus change-related query terms indicate bi-temporal analysis.",
                "required_tools": ["image_alignment", "LAB_difference", "change_mask"],
            }
        if has_fusion:
            return {
                "task": TASK_OPTICAL_SAR_FUSION,
                "reason": "Two images plus optical/SAR/fusion terms indicate joint sensor analysis.",
                "required_tools": ["optical_masks", "sar_backscatter_proxy", "fusion_overlay"],
            }
        return {
            "task": TASK_UNSUPPORTED,
            "reason": (
                "Two images were supplied, but the query did not clearly request change analysis or "
                "optical-SAR fusion. Choose a mode or mention change, before/after, SAR, radar, fusion or together."
            ),
            "required_tools": [],
        }

    return {
        "task": TASK_UNSUPPORTED,
        "reason": "This prototype supports one or two images.",
        "required_tools": [],
    }


def ensure_rgb_uint8(image: np.ndarray) -> np.ndarray:
    arr = np.asarray(image)
    if arr.ndim == 2:
        arr = np.dstack([arr, arr, arr])
    if arr.shape[-1] == 4:
        arr = arr[..., :3]
    if arr.dtype != np.uint8:
        arr = np.nan_to_num(arr.astype(np.float32), nan=0.0, posinf=255.0, neginf=0.0)
        if arr.max(initial=0) <= 1.0:
            arr = arr * 255.0
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    return arr


def _cleanup_mask(mask: np.ndarray, kernel_size: int = 5, min_area_fraction: float = 0.0005) -> np.ndarray:
    mask_u8 = (mask.astype(np.uint8) * 255) if mask.dtype == bool else mask.astype(np.uint8)
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    cleaned = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, kernel)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)
    min_area = max(12, int(cleaned.shape[0] * cleaned.shape[1] * min_area_fraction))
    return remove_small_components(cleaned > 0, min_area)


def remove_small_components(mask: np.ndarray, min_area: int = 12) -> np.ndarray:
    mask_bool = np.asarray(mask).astype(bool)
    if not mask_bool.any():
        return mask_bool
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask_bool.astype(np.uint8), connectivity=8)
    output = np.zeros(mask_bool.shape, dtype=bool)
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] >= min_area:
            output[labels == label] = True
    return output


def water_mask(rgb: np.ndarray) -> np.ndarray:
    image = ensure_rgb_uint8(rgb)
    hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
    h, s, v = cv2.split(hsv)
    r = image[..., 0].astype(np.float32)
    g = image[..., 1].astype(np.float32)
    b = image[..., 2].astype(np.float32)

    blue_dominance = (b > g * 1.04) & (b > r * 1.15) & (b > 45)
    hsv_blue = (h >= 82) & (h <= 132) & (s > 35) & (v > 30) & (v < 235)
    dark_cool = (b > r + 8) & (g > r + 2) & (v < 165) & (s > 18)
    mask = (blue_dominance & hsv_blue) | (dark_cool & (b >= g * 0.72))
    return _cleanup_mask(mask, kernel_size=5, min_area_fraction=0.0008)


def vegetation_mask(rgb: np.ndarray) -> np.ndarray:
    image = ensure_rgb_uint8(rgb)
    hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
    h, s, v = cv2.split(hsv)
    r = image[..., 0].astype(np.float32)
    g = image[..., 1].astype(np.float32)
    b = image[..., 2].astype(np.float32)

    green_excess = (2.0 * g - r - b) > 22
    green_dominance = (g > r * 1.10) & (g > b * 1.04)
    hsv_green = (h >= 35) & (h <= 88) & (s > 28) & (v > 35)
    mask = hsv_green & (green_excess | green_dominance)
    return _cleanup_mask(mask, kernel_size=5, min_area_fraction=0.0008)


def _local_texture(gray: np.ndarray, kernel_size: int = 9) -> np.ndarray:
    gray_f = gray.astype(np.float32)
    mean = cv2.blur(gray_f, (kernel_size, kernel_size))
    mean_sq = cv2.blur(gray_f * gray_f, (kernel_size, kernel_size))
    variance = np.maximum(mean_sq - mean * mean, 0.0)
    return np.sqrt(variance)


def built_up_mask(rgb: np.ndarray) -> np.ndarray:
    image = ensure_rgb_uint8(rgb)
    hsv = cv2.cvtColor(image, cv2.COLOR_RGB2HSV)
    _, s, v = cv2.split(hsv)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 55, 145)
    edge_density = cv2.blur((edges > 0).astype(np.float32), (11, 11)) > 0.055
    texture = _local_texture(gray, kernel_size=9)
    texture_threshold = max(8.0, float(np.percentile(texture, 68)))

    low_saturation = s < 82
    usable_brightness = (v > 55) & (v < 245)
    mask = low_saturation & usable_brightness & (edge_density | (texture > texture_threshold))
    return _cleanup_mask(mask, kernel_size=3, min_area_fraction=0.0007)


def mask_percentage(mask: Optional[np.ndarray]) -> float:
    if mask is None:
        return 0.0
    mask_bool = np.asarray(mask).astype(bool)
    if mask_bool.size == 0:
        return 0.0
    return float(mask_bool.mean() * 100.0)


def largest_component_bbox(mask: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    mask_bool = np.asarray(mask).astype(bool)
    if not mask_bool.any():
        return None
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask_bool.astype(np.uint8), connectivity=8)
    if count <= 1:
        return None
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = int(stats[largest, cv2.CC_STAT_LEFT])
    y = int(stats[largest, cv2.CC_STAT_TOP])
    w = int(stats[largest, cv2.CC_STAT_WIDTH])
    h = int(stats[largest, cv2.CC_STAT_HEIGHT])
    return x, y, w, h


def overlay_mask(
    rgb: np.ndarray,
    mask: np.ndarray,
    color: Tuple[int, int, int],
    alpha: float = 0.62,
    bbox: Optional[Tuple[int, int, int, int]] = None,
    outline: bool = True,
) -> np.ndarray:
    image = ensure_rgb_uint8(rgb)
    output = image.copy()
    mask_bool = np.asarray(mask).astype(bool)
    if mask_bool.any():
        color_arr = np.array(color, dtype=np.float32)
        blended = (output[mask_bool].astype(np.float32) * (1.0 - alpha)) + (color_arr * alpha)
        output[mask_bool] = np.clip(blended, 0, 255).astype(np.uint8)
        if outline:
            contours, _ = cv2.findContours(mask_bool.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(output, contours, -1, (255, 255, 255), 5, lineType=cv2.LINE_AA)
            cv2.drawContours(output, contours, -1, color, 3, lineType=cv2.LINE_AA)
    if bbox:
        x, y, w, h = bbox
        cv2.rectangle(output, (x, y), (x + w, y + h), (255, 255, 255), 5)
        cv2.rectangle(output, (x, y), (x + w, y + h), color, 3)
    return output


def multi_mask_overlay(
    rgb: np.ndarray,
    masks: Sequence[Tuple[np.ndarray, Tuple[int, int, int]]],
    alpha: float = 0.58,
) -> np.ndarray:
    output = ensure_rgb_uint8(rgb).copy()
    for mask, color in masks:
        output = overlay_mask(output, mask, color=color, alpha=alpha, outline=True)
    return output


def mask_to_display(mask: Optional[np.ndarray], color: Optional[Tuple[int, int, int]] = None) -> np.ndarray:
    if mask is None:
        return np.zeros((1, 1, 3), dtype=np.uint8)
    mask_bool = np.asarray(mask).astype(bool)
    if color is None:
        gray = (mask_bool.astype(np.uint8) * 255)
        return np.dstack([gray, gray, gray])
    out = np.full((*mask_bool.shape, 3), 248, dtype=np.uint8)
    out[mask_bool] = np.array(color, dtype=np.uint8)
    if mask_bool.any():
        contours, _ = cv2.findContours(mask_bool.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(out, contours, -1, (35, 45, 58), 2, lineType=cv2.LINE_AA)
    return out


def _yes_no_from_percentage(percentage: float, positive_term: str) -> str:
    if percentage >= 5.0:
        return f"Yes. {positive_term} candidates cover approximately {percentage:.1f}% of the image."
    if percentage >= 1.0:
        return f"Possibly. {positive_term} candidates are limited, covering approximately {percentage:.1f}% of the image."
    return f"No strong evidence was detected. {positive_term} candidates cover approximately {percentage:.1f}% of the image."


def deterministic_single_image_vqa(rgb: np.ndarray, query: str) -> Dict[str, Any]:
    image = ensure_rgb_uint8(rgb)
    water = water_mask(image)
    vegetation = vegetation_mask(image)
    built = built_up_mask(image)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    dark = gray < 55
    bright = gray > 205

    water_pct = mask_percentage(water)
    vegetation_pct = mask_percentage(vegetation)
    built_pct = mask_percentage(built)
    dark_pct = mask_percentage(dark)
    bright_pct = mask_percentage(bright)
    query_lower = (query or "").lower()

    if any(term in query_lower for term in ["water", "river", "lake"]):
        answer = _yes_no_from_percentage(water_pct, "Water-like")
        selected_mask = water
    elif any(term in query_lower for term in ["vegetation", "forest", "crop", "green"]):
        answer = _yes_no_from_percentage(vegetation_pct, "Vegetation-like")
        selected_mask = vegetation
    elif any(term in query_lower for term in ["urban", "built-up", "built up", "building", "buildings"]):
        answer = _yes_no_from_percentage(built_pct, "Built-up/high-texture")
        selected_mask = built
    else:
        answer = (
            f"The prototype detects approximately {vegetation_pct:.1f}% vegetation-like regions, "
            f"{water_pct:.1f}% water-like regions and {built_pct:.1f}% high-texture built-up candidates. "
            "These are visual estimates and require a remote-sensing-adapted model for operational use."
        )
        selected_mask = water | vegetation | built

    overlay = multi_mask_overlay(
        image,
        [
            (water, THEME_COLORS["water"]),
            (vegetation, THEME_COLORS["vegetation"]),
            (built, THEME_COLORS["built_up"]),
        ],
    )
    return {
        "task": TASK_SINGLE_IMAGE_VQA,
        "answer": answer,
        "mask": selected_mask,
        "overlay": overlay,
        "mask_display": mask_to_display(selected_mask),
        "changed_or_detected_percentage": mask_percentage(selected_mask),
        "metrics": {
            "water_percentage": water_pct,
            "vegetation_percentage": vegetation_pct,
            "built_up_candidate_percentage": built_pct,
            "dark_region_percentage": mask_percentage(dark),
            "bright_region_percentage": mask_percentage(bright),
        },
        "warnings": [],
        "explanation": (
            "Fallback VQA used computed colour, brightness and edge statistics rather than a learned "
            "remote-sensing model."
        ),
    }


def grounding_concept(query: str) -> Optional[str]:
    q = (query or "").lower()
    if any(term in q for term in ["water", "river", "lake"]):
        return "water"
    if any(term in q for term in ["vegetation", "forest", "crop"]):
        return "vegetation"
    if any(term in q for term in ["urban", "built-up", "built up", "building", "buildings"]):
        return "built_up"
    return None


def text_guided_grounding(rgb: np.ndarray, query: str) -> Dict[str, Any]:
    image = ensure_rgb_uint8(rgb)
    concept = grounding_concept(query)
    if concept is None:
        return {
            "task": TASK_TEXT_GUIDED_GROUNDING,
            "answer": (
                "The lightweight prototype currently supports grounding of water, "
                "vegetation and built-up regions."
            ),
            "mask": None,
            "overlay": image,
            "mask_display": None,
            "changed_or_detected_percentage": 0.0,
            "metrics": {},
            "warnings": ["Unsupported grounding target requested."],
            "bbox": None,
            "explanation": "No supported concept was found in the query, so no mask was generated.",
        }

    if concept == "water":
        mask = water_mask(image)
        explanation = "Water candidates use blue-channel dominance, HSV blue/cool tones and brightness filtering."
        color = THEME_COLORS["water"]
        label = "water"
    elif concept == "vegetation":
        mask = vegetation_mask(image)
        explanation = "Vegetation candidates use green excess, green-channel dominance and HSV green ranges."
        color = THEME_COLORS["vegetation"]
        label = "vegetation"
    else:
        mask = built_up_mask(image)
        explanation = "Built-up candidates use low saturation, moderate-high brightness, edges and local texture."
        color = THEME_COLORS["built_up"]
        label = "built-up"

    bbox = largest_component_bbox(mask)
    percentage = mask_percentage(mask)
    overlay = overlay_mask(image, mask, color=color, alpha=0.68, bbox=bbox)
    answer = (
        f"The prototype highlighted {label} candidates across approximately {percentage:.1f}% "
        "of the analysed image. The overlay shows the spatial evidence used for the answer."
    )
    return {
        "task": TASK_TEXT_GUIDED_GROUNDING,
        "answer": answer,
        "mask": mask,
        "overlay": overlay,
        "mask_display": mask_to_display(mask, color=color),
        "changed_or_detected_percentage": percentage,
        "metrics": {f"{concept}_percentage": percentage},
        "warnings": [],
        "bbox": bbox,
        "explanation": explanation,
    }


def _resize_rgb_to_match(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    image_a = ensure_rgb_uint8(first)
    image_b = ensure_rgb_uint8(second)
    height, width = image_a.shape[:2]
    if image_b.shape[:2] == (height, width):
        return image_b
    return cv2.resize(image_b, (width, height), interpolation=cv2.INTER_AREA).astype(np.uint8)


def bi_temporal_change_analysis(first_rgb: np.ndarray, second_rgb: np.ndarray) -> Dict[str, Any]:
    first = ensure_rgb_uint8(first_rgb)
    second = _resize_rgb_to_match(first, second_rgb)
    first_lab = cv2.GaussianBlur(cv2.cvtColor(first, cv2.COLOR_RGB2LAB), (5, 5), 0)
    second_lab = cv2.GaussianBlur(cv2.cvtColor(second, cv2.COLOR_RGB2LAB), (5, 5), 0)
    diff = np.linalg.norm(first_lab.astype(np.float32) - second_lab.astype(np.float32), axis=2)
    diff_u8 = _finite_percentile_stretch(diff, low=1.0, high=99.0)

    if diff_u8.max(initial=0) == 0:
        mask = np.zeros(diff_u8.shape, dtype=bool)
    else:
        otsu_threshold, _ = cv2.threshold(diff_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        percentile_threshold = float(np.percentile(diff_u8, 90))
        threshold = max(float(otsu_threshold), percentile_threshold, 18.0)
        mask = diff_u8 >= threshold

    mask = _cleanup_mask(mask, kernel_size=5, min_area_fraction=0.001)
    percentage = mask_percentage(mask)
    overlay = overlay_mask(second, mask, color=THEME_COLORS["change"], alpha=0.70)
    answer = (
        f"The prototype detected change candidates across approximately {percentage:.1f}% of the analysed area. "
        "The highlighted regions show where the largest visual differences occurred. Seasonal effects, "
        "illumination differences and sensor differences may cause false change."
    )
    return {
        "task": TASK_BI_TEMPORAL_CHANGE,
        "answer": answer,
        "mask": mask,
        "overlay": overlay,
        "mask_display": mask_to_display(mask, color=THEME_COLORS["change"]),
        "changed_or_detected_percentage": percentage,
        "metrics": {"changed_pixel_percentage": percentage},
        "warnings": [],
        "explanation": "Change mask computed from blurred LAB absolute differences with adaptive thresholding.",
        "comparison": {
            "earlier": first,
            "later": second,
            "change_mask": mask_to_display(mask, color=THEME_COLORS["change"]),
            "change_overlay": overlay,
        },
    }


def _sar_gray_display(sar_rgb: np.ndarray) -> np.ndarray:
    sar = ensure_rgb_uint8(sar_rgb)
    gray = cv2.cvtColor(sar, cv2.COLOR_RGB2GRAY)
    return _finite_percentile_stretch(gray, low=2.0, high=98.0)


def optical_sar_fusion(optical_rgb: np.ndarray, sar_rgb: np.ndarray) -> Dict[str, Any]:
    optical = ensure_rgb_uint8(optical_rgb)
    sar_resized_rgb = _resize_rgb_to_match(optical, sar_rgb)
    sar = _sar_gray_display(sar_resized_rgb)

    optical_water = water_mask(optical)
    low_sar = _cleanup_mask(sar < max(70.0, float(np.percentile(sar, 34))), kernel_size=5, min_area_fraction=0.0008)
    water_agreement = optical_water & low_sar
    if mask_percentage(water_agreement) >= 0.25:
        water = _cleanup_mask(water_agreement, kernel_size=5, min_area_fraction=0.0008)
        water_note = "Water uses optical blue/cool evidence confirmed by low SAR backscatter."
    else:
        water = _cleanup_mask(optical_water | low_sar, kernel_size=5, min_area_fraction=0.0008)
        water_note = "Water uses the union of optical water evidence and low SAR backscatter because agreement was limited."

    optical_built = built_up_mask(optical)
    sar_texture = _local_texture(sar, kernel_size=9)
    texture_threshold = max(9.0, float(np.percentile(sar_texture, 68)))
    bright_sar = sar > float(np.percentile(sar, 63))
    sar_built = _cleanup_mask(bright_sar & (sar_texture > texture_threshold), kernel_size=3, min_area_fraction=0.0008)
    built_agreement = optical_built & sar_built
    if mask_percentage(built_agreement) >= 0.25:
        built = _cleanup_mask(built_agreement, kernel_size=3, min_area_fraction=0.0008)
        built_note = "Built-up evidence uses optical edge/texture confirmed by bright textured SAR response."
    else:
        built = _cleanup_mask(optical_built | sar_built, kernel_size=3, min_area_fraction=0.0008)
        built_note = "Built-up evidence uses optical edge/texture and bright textured SAR candidates with limited agreement."

    water_pct = mask_percentage(water)
    built_pct = mask_percentage(built)
    overlay = multi_mask_overlay(
        optical,
        [(water, THEME_COLORS["water"]), (built, THEME_COLORS["built_up"])],
    )
    water_union = optical_water | low_sar
    built_union = optical_built | sar_built
    agreement_denominator = int(water_union.sum() + built_union.sum())
    agreement_numerator = int(water_agreement.sum() + built_agreement.sum())
    fusion_agreement = float(agreement_numerator / agreement_denominator) if agreement_denominator else 0.0

    answer = (
        f"Using complementary optical and SAR evidence, the prototype detected approximately {water_pct:.1f}% "
        f"water candidates and {built_pct:.1f}% built-up candidates. Blue regions represent water evidence, "
        "while orange regions represent built-up evidence."
    )
    return {
        "task": TASK_OPTICAL_SAR_FUSION,
        "answer": answer,
        "mask": water | built,
        "water_mask": water,
        "built_up_mask": built,
        "overlay": overlay,
        "mask_display": multi_mask_overlay(
            np.zeros_like(optical),
            [(water, THEME_COLORS["water"]), (built, THEME_COLORS["built_up"])],
        ),
        "changed_or_detected_percentage": mask_percentage(water | built),
        "metrics": {
            "water_candidate_percentage": water_pct,
            "built_up_candidate_percentage": built_pct,
            "fusion_agreement": fusion_agreement,
        },
        "warnings": [],
        "explanation": (
            f"{water_note} {built_note} This is prototype-level heuristic fusion, not calibrated "
            "sensor physics or a trained remote-sensing model."
        ),
        "fusion_agreement": fusion_agreement,
        "sar_preview": np.dstack([sar, sar, sar]),
    }


def image_contrast(rgb: np.ndarray) -> float:
    image = ensure_rgb_uint8(rgb)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    return float(np.std(gray))


def measure_mask_area(mask: Optional[np.ndarray], metadata: Dict[str, Any]) -> Dict[str, Any]:
    if mask is None:
        return {
            "available": False,
            "message": "No mask was produced, so geospatial area was not calculated.",
        }
    if not metadata.get("is_geotiff") or not metadata.get("crs_is_projected"):
        return {
            "available": False,
            "pixel_percentage": mask_percentage(mask),
            "message": (
                "Reliable ground-area measurement requires a suitable projected GeoTIFF. "
                "Only pixel percentage is reported for this input."
            ),
        }
    resolution = metadata.get("pixel_resolution") or {}
    res_x = float(resolution.get("x") or 0)
    res_y = float(resolution.get("y") or 0)
    if res_x <= 0 or res_y <= 0 or not np.isfinite([res_x, res_y]).all():
        return {
            "available": False,
            "pixel_percentage": mask_percentage(mask),
            "message": "Projected GeoTIFF pixel resolution is missing or invalid.",
        }
    area_m2 = float(np.asarray(mask).astype(bool).sum() * res_x * res_y)
    return {
        "available": True,
        "area_square_metres": area_m2,
        "area_hectares": area_m2 / 10_000.0,
        "area_square_kilometres": area_m2 / 1_000_000.0,
        "pixel_percentage": mask_percentage(mask),
        "message": "Area calculated from projected CRS pixel resolution.",
    }


def verify_evidence(
    result: Dict[str, Any],
    images: Sequence[Dict[str, Any]],
    validation: Dict[str, Any],
) -> Dict[str, Any]:
    warnings = list(validation.get("warnings", [])) + list(result.get("warnings", []))
    checks: List[Dict[str, str]] = []
    score = 3.0

    if validation.get("errors"):
        score = 0.0
        _add_check(checks, "Input validation", "fail", "Input validation reported errors.")
    else:
        _add_check(checks, "Input validation", "pass", "Inputs passed required validation checks.")

    source_shape = images[0]["display"].shape[:2] if images else None
    masks = []
    if result.get("water_mask") is not None:
        masks.append(("water", result["water_mask"]))
    if result.get("built_up_mask") is not None:
        masks.append(("built_up", result["built_up_mask"]))
    if not masks:
        masks.append(("primary", result.get("mask")))

    serious_mask_issue = False
    for name, mask in masks:
        if mask is None:
            warnings.append(f"{name} mask was not produced.")
            score -= 1.2
            serious_mask_issue = True
            _add_check(checks, f"{name} mask", "warn", "No mask was produced.")
            continue
        mask_arr = np.asarray(mask)
        if source_shape and mask_arr.shape[:2] != source_shape:
            warnings.append(f"{name} mask dimensions do not match the source image.")
            score -= 1.4
            serious_mask_issue = True
            _add_check(checks, f"{name} mask dimensions", "fail", "Mask shape does not match source image.")
        else:
            _add_check(checks, f"{name} mask dimensions", "pass", "Mask shape matches the source image.")
        if not np.isfinite(mask_arr.astype(float)).all():
            warnings.append(f"{name} mask contains non-finite values.")
            score -= 1.4
            serious_mask_issue = True
            _add_check(checks, f"{name} finite values", "fail", "Mask contains non-finite values.")
        pct = mask_percentage(mask_arr)
        if pct <= 0.0:
            warnings.append(f"{name} mask is empty.")
            score -= 1.0
            serious_mask_issue = True
            _add_check(checks, f"{name} mask size", "warn", "Mask is empty.")
        elif pct >= 92.0:
            warnings.append(f"{name} mask covers {pct:.1f}% of the image, which is unusually broad.")
            score -= 1.0
            _add_check(checks, f"{name} mask size", "warn", "Mask coverage is unusually high.")
        else:
            _add_check(checks, f"{name} mask size", "pass", f"Mask covers {pct:.1f}% of the image.")

    if images:
        contrast = image_contrast(images[0]["display"])
        if contrast < 14.0:
            warnings.append("The source image has low contrast, reducing heuristic reliability.")
            score -= 0.6
            _add_check(checks, "Image contrast", "warn", f"Contrast std={contrast:.1f}.")
        else:
            _add_check(checks, "Image contrast", "pass", f"Contrast std={contrast:.1f}.")

    for warning in validation.get("warnings", []):
        lowered = warning.lower()
        if "alignment" in lowered or "resized" in lowered or "reprojected" in lowered:
            score -= 0.35
        elif "nodata" in lowered:
            score -= 0.1
        else:
            score -= 0.15

    if result.get("task") == TASK_OPTICAL_SAR_FUSION:
        agreement = float(result.get("fusion_agreement") or 0.0)
        if agreement >= 0.35:
            score += 0.25
            _add_check(checks, "Optical-SAR agreement", "pass", f"Agreement proxy={agreement:.2f}.")
        elif agreement > 0:
            warnings.append("Optical and SAR heuristic agreement was limited.")
            score -= 0.45
            _add_check(checks, "Optical-SAR agreement", "warn", f"Agreement proxy={agreement:.2f}.")
        else:
            warnings.append("No optical-SAR agreement could be measured.")
            score -= 0.75
            _add_check(checks, "Optical-SAR agreement", "warn", "Agreement proxy unavailable.")

    primary_mask = result.get("mask")
    area_measurement = measure_mask_area(primary_mask, images[0]["metadata"] if images else {})
    if area_measurement.get("available"):
        _add_check(checks, "Geospatial measurement", "pass", area_measurement["message"])
    else:
        _add_check(checks, "Geospatial measurement", "warn", area_measurement["message"])

    if serious_mask_issue:
        score = min(score, 1.4)

    if score >= 2.65:
        label = "Higher"
    elif score >= 1.55:
        label = "Moderate"
    else:
        label = "Low"

    return {
        "label": label,
        "score": round(float(max(0.0, min(3.25, score))), 2),
        "checks": checks,
        "warnings": warnings,
        "area_measurement": area_measurement,
    }


def _json_safe_value(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return {
            "array_shape": list(value.shape),
            "dtype": str(value.dtype),
        }
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, dict):
        return {str(key): _json_safe_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def build_json_report(
    result: Dict[str, Any],
    images: Sequence[Dict[str, Any]],
    validation: Dict[str, Any],
    routing: Dict[str, Any],
    trace: Sequence[Dict[str, Any]],
) -> str:
    report = {
        "application": "SatQuery AI",
        "selected_task": result.get("task"),
        "answer": result.get("answer"),
        "prototype_reliability": result.get("reliability"),
        "routing": routing,
        "metrics": result.get("metrics", {}),
        "changed_or_detected_percentage": result.get("changed_or_detected_percentage"),
        "area_measurement": result.get("area_measurement"),
        "input_metadata": [image.get("metadata", {}) for image in images],
        "validation": {
            "valid": validation.get("valid"),
            "checks": validation.get("checks", []),
            "warnings": validation.get("warnings", []),
            "errors": validation.get("errors", []),
        },
        "warnings": result.get("all_warnings", result.get("warnings", [])),
        "execution_trace": list(trace),
    }
    return json.dumps(_json_safe_value(report), indent=2)
