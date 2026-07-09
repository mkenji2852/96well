from __future__ import annotations

from dataclasses import dataclass
from math import exp

import cv2
import numpy as np

from .models import AnalysisResponse, QcFlags, WellCenter, WellFeatures, WellPrediction

SERVICE_VERSION = "opencv-grid-v1"
EXPECTED_WELLS = 96
MAX_ANALYSIS_DIMENSION = 1200


@dataclass(frozen=True)
class Circle:
    x: int
    y: int
    radius: int


def decode_image(content: bytes) -> np.ndarray:
    encoded = np.frombuffer(content, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ValueError("The uploaded file is not a readable image")
    return image


def resize_for_analysis(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    largest = max(height, width)
    if largest <= MAX_ANALYSIS_DIMENSION:
        return image
    scale = MAX_ANALYSIS_DIMENSION / float(largest)
    resized_width = max(1, int(round(width * scale)))
    resized_height = max(1, int(round(height * scale)))
    return cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_AREA)


def preprocess_image(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    kernel = max(31, (min(gray.shape) // 12) | 1)
    illumination = cv2.GaussianBlur(gray, (kernel, kernel), 0)
    corrected = cv2.divide(gray, np.maximum(illumination, 1), scale=180)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(corrected)
    denoised = cv2.medianBlur(enhanced, 3)
    return gray, denoised


def assess_quality(gray: np.ndarray) -> tuple[float, QcFlags]:
    laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean_exposure = float(gray.mean())
    glare_fraction = float(np.mean(gray >= 250))

    edges = cv2.Canny(gray, 60, 160)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=max(80, min(gray.shape) // 4))
    skew_degrees = 0.0
    if lines is not None:
        deviations = []
        for rho_theta in lines[:40]:
            theta = float(rho_theta[0][1]) * 180 / np.pi
            deviation = min(abs(theta), abs(theta - 90), abs(theta - 180))
            if deviation <= 20:
                deviations.append(deviation)
        if deviations:
            skew_degrees = float(np.median(deviations))

    flags = QcFlags(
        blur=laplacian_variance < 70,
        glare=glare_fraction > 0.035,
        low_exposure=mean_exposure < 55,
        skew=skew_degrees > 7,
    )
    blur_score = min(1.0, laplacian_variance / 180)
    exposure_score = max(0.0, 1.0 - abs(mean_exposure - 145) / 145)
    glare_score = max(0.0, 1.0 - glare_fraction / 0.12)
    skew_score = max(0.0, 1.0 - skew_degrees / 15)
    qc_score = 0.35 * blur_score + 0.25 * exposure_score + 0.25 * glare_score + 0.15 * skew_score
    return round(float(np.clip(qc_score, 0, 1)), 4), flags


def _cluster_axis(values: np.ndarray, cluster_count: int) -> np.ndarray:
    samples = values.astype(np.float32).reshape(-1, 1)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 100, 0.2)
    _, _, centers = cv2.kmeans(samples, cluster_count, None, criteria, 10, cv2.KMEANS_PP_CENTERS)
    return np.sort(centers.flatten())


def _map_circles_to_grid(circles: list[Circle]) -> list[tuple[int, int, Circle]]:
    if len(circles) < 60:
        return []
    x_centers = _cluster_axis(np.array([circle.x for circle in circles]), 12)
    y_centers = _cluster_axis(np.array([circle.y for circle in circles]), 8)
    x_spacing = float(np.median(np.diff(x_centers)))
    y_spacing = float(np.median(np.diff(y_centers)))
    tolerance = max(8.0, min(x_spacing, y_spacing) * 0.42)
    available = set(range(len(circles)))
    mapped: list[tuple[int, int, Circle]] = []
    for row_index, y in enumerate(y_centers):
        for column_index, x in enumerate(x_centers):
            candidates = [
                (index, (circles[index].x - x) ** 2 + (circles[index].y - y) ** 2)
                for index in available
            ]
            if not candidates:
                continue
            index, distance_sq = min(candidates, key=lambda item: item[1])
            if distance_sq <= tolerance**2:
                mapped.append((row_index, column_index, circles[index]))
                available.remove(index)
    return mapped


def detect_wells(denoised: np.ndarray) -> list[tuple[int, int, Circle]]:
    height, width = denoised.shape
    min_radius = max(7, min(height, width) // 55)
    max_radius = max(min_radius + 4, min(height, width) // 16)
    circles = cv2.HoughCircles(
        denoised,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=max(20, min(height, width) // 18),
        param1=100,
        param2=22,
        minRadius=min_radius,
        maxRadius=max_radius,
    )
    if circles is None:
        return []
    candidates = [Circle(int(round(x)), int(round(y)), int(round(radius))) for x, y, radius in circles[0]]
    median_radius = float(np.median([circle.radius for circle in candidates]))
    filtered = [circle for circle in candidates if median_radius * 0.55 <= circle.radius <= median_radius * 1.55]
    mapped = _map_circles_to_grid(filtered)
    return [
        (
            row,
            column,
            Circle(circle.x, circle.y, int(round(np.clip(circle.radius, median_radius * 0.85, median_radius * 1.15)))),
        )
        for row, column, circle in mapped
    ]


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + exp(-value))


def predict_well(
    gray: np.ndarray,
    row_index: int,
    column_index: int,
    circle: Circle,
    threshold: float,
) -> WellPrediction:
    mask = np.zeros(gray.shape, dtype=np.uint8)
    inner_radius = max(3, int(circle.radius * 0.62))
    cv2.circle(mask, (circle.x, circle.y), inner_radius, 255, -1)
    pixels = gray[mask == 255]
    mean_intensity = float(pixels.mean())
    intensity_std = float(pixels.std())
    dark_fraction = float(np.mean(pixels < 145))
    growth_score = float(np.clip(0.75 * _sigmoid((150 - mean_intensity) / 18) + 0.25 * dark_fraction, 0, 1))
    prediction = "growth" if growth_score >= 0.5 else "no_growth"
    confidence = float(np.clip(abs(growth_score - 0.5) * 2, 0, 1))
    return WellPrediction(
        well_id=f"{chr(65 + row_index)}{column_index + 1}",
        row_index=row_index,
        column_index=column_index,
        center=WellCenter(x=circle.x, y=circle.y),
        radius=circle.radius,
        prediction=prediction,
        confidence=round(confidence, 4),
        review_needed=confidence < threshold,
        features=WellFeatures(
            mean_intensity=round(mean_intensity, 3),
            intensity_std=round(intensity_std, 3),
            dark_fraction=round(dark_fraction, 4),
        ),
    )


def analyze_image(image: np.ndarray, confidence_threshold: float = 0.85) -> AnalysisResponse:
    if not 0 <= confidence_threshold <= 1:
        raise ValueError("confidence_threshold must be between 0 and 1")
    image = resize_for_analysis(image)
    gray, denoised = preprocess_image(image)
    qc_score, qc_flags = assess_quality(gray)
    mapped = detect_wells(denoised)
    wells = [predict_well(gray, row, column, circle, confidence_threshold) for row, column, circle in mapped]
    completeness = min(1.0, len(wells) / EXPECTED_WELLS)
    mean_well_confidence = float(np.mean([well.confidence for well in wells])) if wells else 0.0
    confidence = float(np.clip(mean_well_confidence * completeness * (0.65 + 0.35 * qc_score), 0, 1))
    severe_qc = qc_flags.blur or qc_flags.low_exposure or qc_flags.skew
    review_needed = (
        confidence < confidence_threshold
        or len(wells) != EXPECTED_WELLS
        or severe_qc
        or any(well.review_needed for well in wells)
    )
    return AnalysisResponse(
        service_version=SERVICE_VERSION,
        qc_score=qc_score,
        qc_flags=qc_flags,
        detected_wells=len(wells),
        confidence=round(confidence, 4),
        review_needed=review_needed,
        wells=wells,
    )
