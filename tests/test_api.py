from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.main import analyze, demo_cases  # noqa: E402
from satquery_core import MODE_SINGLE  # noqa: E402


def response_json(response):
    return json.loads(response.body)


class StubUpload:
    def __init__(self, data: bytes, filename: str) -> None:
        self._data = data
        self.filename = filename

    async def read(self) -> bytes:
        return self._data


def test_demo_cases_endpoint():
    payload = demo_cases()
    assert payload["cases"]
    assert payload["cases"][0]["image_urls"][0].startswith("/demo_data/")
    assert "Auto Detect" in payload["modes"]


def test_demo_analysis_returns_visuals_and_report():
    response = asyncio.run(
        analyze(
            input_source="demo",
            demo_case="single",
            analysis_mode="Auto Detect",
            query="What major land-cover regions are visible?",
            use_blip=False,
        )
    )
    payload = response_json(response)
    assert payload["ok"] is True
    assert payload["result"]["task"] == "SINGLE_IMAGE_VQA"
    assert payload["visuals"]
    assert payload["visuals"][0]["src"].startswith("data:image/png;base64,")
    assert "SatQuery AI" in payload["report"]


def test_upload_analysis_uses_fastapi_file_path():
    image = np.zeros((96, 128, 3), dtype=np.uint8)
    image[:, :] = (88, 126, 84)
    image[20:72, 20:86] = (24, 92, 180)
    buffer = io.BytesIO()
    Image.fromarray(image).save(buffer, format="PNG")
    upload = StubUpload(buffer.getvalue(), "water.png")

    response = asyncio.run(
        analyze(
            input_source="upload",
            analysis_mode=MODE_SINGLE,
            query="Is there water?",
            use_blip=False,
            first_image=upload,
        )
    )
    payload = response_json(response)
    assert payload["ok"] is True
    assert payload["input_metadata"][0]["name"] == "water.png"
