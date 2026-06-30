import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.analyzer import analyze_image
from app.main import app
from tests.synthetic_plate import create_plate_image


def test_normal_image_detects_96_wells() -> None:
    result = analyze_image(create_plate_image())
    assert result.detected_wells == 96
    assert len(result.wells) == 96
    assert result.wells[0].well_id == "A1"
    assert result.wells[-1].well_id == "H12"


def test_blurred_image_sets_blur_flag() -> None:
    result = analyze_image(create_plate_image(blur_kernel=31))
    assert result.qc_flags.blur is True
    assert result.review_needed is True


def test_low_confidence_requires_review() -> None:
    ambiguous = np.full((700, 1040, 3), 145, dtype=np.uint8)
    result = analyze_image(ambiguous)
    assert result.confidence < 0.85
    assert result.review_needed is True


def test_api_returns_well_json() -> None:
    ok, encoded = cv2.imencode(".png", create_plate_image())
    assert ok
    response = TestClient(app).post(
        "/v1/analyze",
        files={"image": ("plate.png", encoded.tobytes(), "image/png")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["detected_wells"] == 96
    assert len(payload["wells"]) == 96

