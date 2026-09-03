from __future__ import annotations

from pathlib import Path
from typing import Dict, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw


SIZE = 512
SEED = 20260902


def _clip_uint8(array: np.ndarray) -> np.ndarray:
    return np.clip(array, 0, 255).astype(np.uint8)


def _add_texture(rgb: np.ndarray, rng: np.random.Generator, amount: float = 7.0) -> np.ndarray:
    noise = rng.normal(0, amount, rgb.shape)
    low_frequency = cv2.GaussianBlur(rng.normal(0, amount * 1.8, rgb.shape).astype(np.float32), (31, 31), 0)
    return _clip_uint8(rgb.astype(np.float32) + noise + low_frequency)


def _draw_roads(rgb: np.ndarray) -> None:
    roads = [
        ((0, 172), (512, 236), 7),
        ((230, 0), (272, 512), 6),
        ((88, 510), (510, 315), 5),
    ]
    for start, end, width in roads:
        cv2.line(rgb, start, end, (188, 185, 176), width, lineType=cv2.LINE_AA)
        cv2.line(rgb, start, end, (126, 126, 122), 1, lineType=cv2.LINE_AA)


def _draw_buildings(rgb: np.ndarray, building_mask: np.ndarray, extra: bool = False) -> None:
    blocks = [
        (286, 72, 334, 118),
        (346, 78, 395, 122),
        (300, 148, 356, 188),
        (372, 154, 430, 204),
        (316, 246, 362, 296),
        (396, 256, 450, 306),
        (92, 92, 136, 136),
        (150, 108, 198, 148),
    ]
    if extra:
        blocks.extend(
            [
                (312, 342, 360, 386),
                (370, 346, 424, 394),
                (430, 330, 478, 374),
                (250, 354, 292, 398),
            ]
        )

    for index, (x0, y0, x1, y1) in enumerate(blocks):
        shade = 142 + (index % 4) * 18
        cv2.rectangle(rgb, (x0, y0), (x1, y1), (shade, shade, shade - 4), -1)
        cv2.rectangle(rgb, (x0, y0), (x1, y1), (78, 84, 88), 2)
        building_mask[y0:y1, x0:x1] = True


def _base_scene(seed: int) -> Tuple[np.ndarray, Dict[str, np.ndarray]]:
    rng = np.random.default_rng(seed)
    rgb = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    rgb[:, :] = (126, 118, 88)

    water = np.zeros((SIZE, SIZE), dtype=bool)
    vegetation = np.zeros((SIZE, SIZE), dtype=bool)
    built = np.zeros((SIZE, SIZE), dtype=bool)

    # Farmland and forest patches.
    fields = [
        (20, 20, 126, 96, (80, 145, 72)),
        (34, 112, 150, 196, (94, 160, 82)),
        (160, 32, 250, 120, (68, 136, 68)),
        (44, 235, 170, 318, (72, 154, 76)),
        (182, 224, 264, 310, (82, 146, 70)),
    ]
    for x0, y0, x1, y1, color in fields:
        cv2.rectangle(rgb, (x0, y0), (x1, y1), color, -1)
        vegetation[y0:y1, x0:x1] = True

    for center, axes, angle in [((106, 384), (85, 45), -18), ((216, 390), (55, 92), 10)]:
        cv2.ellipse(rgb, center, axes, angle, 0, 360, (46, 126, 73), -1, lineType=cv2.LINE_AA)
        ellipse = np.zeros_like(vegetation, dtype=np.uint8)
        cv2.ellipse(ellipse, center, axes, angle, 0, 360, 255, -1)
        vegetation |= ellipse > 0

    river = np.array(
        [
            [0, 320],
            [78, 284],
            [174, 296],
            [244, 352],
            [198, 430],
            [92, 462],
            [0, 448],
        ],
        dtype=np.int32,
    )
    lake = np.zeros((SIZE, SIZE), dtype=np.uint8)
    cv2.fillPoly(rgb, [river], (30, 104, 181), lineType=cv2.LINE_AA)
    cv2.fillPoly(lake, [river], 255)
    cv2.ellipse(rgb, (424, 104), (62, 36), -8, 0, 360, (36, 126, 194), -1, lineType=cv2.LINE_AA)
    cv2.ellipse(lake, (424, 104), (62, 36), -8, 0, 360, 255, -1)
    water |= lake > 0

    _draw_roads(rgb)
    _draw_buildings(rgb, built, extra=False)
    rgb = _add_texture(rgb, rng, amount=6.5)
    return rgb, {"water": water, "vegetation": vegetation, "built": built}


def _change_pair() -> Tuple[np.ndarray, np.ndarray]:
    before, _ = _base_scene(SEED + 10)
    after = before.copy()
    extra_mask = np.zeros((SIZE, SIZE), dtype=bool)
    _draw_buildings(after, extra_mask, extra=True)

    expansion = np.array(
        [
            [168, 286],
            [262, 300],
            [314, 356],
            [270, 424],
            [204, 428],
            [226, 354],
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(after, [expansion], (26, 96, 174), lineType=cv2.LINE_AA)
    cv2.line(after, (0, 172), (512, 236), (198, 198, 188), 8, lineType=cv2.LINE_AA)
    return before, after


def _sar_from_layers(layers: Dict[str, np.ndarray]) -> np.ndarray:
    rng = np.random.default_rng(SEED + 30)
    sar = rng.normal(112, 18, (SIZE, SIZE)).astype(np.float32)
    sar[layers["vegetation"]] = rng.normal(98, 16, int(layers["vegetation"].sum()))
    sar[layers["water"]] = rng.normal(34, 5, int(layers["water"].sum()))
    sar[layers["built"]] = rng.normal(190, 32, int(layers["built"].sum()))

    road_layer = np.zeros((SIZE, SIZE), dtype=np.uint8)
    cv2.line(road_layer, (0, 172), (512, 236), 255, 7, lineType=cv2.LINE_AA)
    cv2.line(road_layer, (230, 0), (272, 512), 255, 6, lineType=cv2.LINE_AA)
    cv2.line(road_layer, (88, 510), (510, 315), 255, 5, lineType=cv2.LINE_AA)
    sar[road_layer > 0] = np.maximum(sar[road_layer > 0], rng.normal(165, 20, int((road_layer > 0).sum())))

    speckle = rng.rayleigh(0.22, sar.shape).astype(np.float32) + 0.88
    sar = sar * speckle
    sar = cv2.GaussianBlur(sar, (3, 3), 0)
    sar = _clip_uint8(sar)
    return np.dstack([sar, sar, sar])


def generate_demo_data(output_dir: Path | str = "demo_data") -> None:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    single, _ = _base_scene(SEED)
    before, after = _change_pair()
    fusion_optical, layers = _base_scene(SEED + 20)
    fusion_sar = _sar_from_layers(layers)

    outputs = {
        "single_optical.png": single,
        "change_before.png": before,
        "change_after.png": after,
        "fusion_optical.png": fusion_optical,
        "fusion_sar.png": fusion_sar,
    }
    for filename, array in outputs.items():
        image = Image.fromarray(array)
        if filename == "single_optical.png":
            draw = ImageDraw.Draw(image)
            draw.rectangle((8, 8, 78, 24), fill=(245, 247, 250))
        image.save(output_path / filename)


if __name__ == "__main__":
    generate_demo_data(Path(__file__).resolve().parent / "demo_data")
