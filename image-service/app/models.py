from typing import Literal

from pydantic import BaseModel, Field


class QcFlags(BaseModel):
    blur: bool
    glare: bool
    low_exposure: bool
    skew: bool


class WellCenter(BaseModel):
    x: int
    y: int


class WellFeatures(BaseModel):
    mean_intensity: float
    intensity_std: float
    dark_fraction: float


class WellPrediction(BaseModel):
    well_id: str
    row_index: int = Field(ge=0, le=7)
    column_index: int = Field(ge=0, le=11)
    center: WellCenter
    radius: int = Field(gt=0)
    prediction: Literal["growth", "no_growth"]
    confidence: float = Field(ge=0, le=1)
    review_needed: bool
    features: WellFeatures


class AnalysisResponse(BaseModel):
    service_version: str
    qc_score: float = Field(ge=0, le=1)
    qc_flags: QcFlags
    detected_wells: int = Field(ge=0, le=96)
    confidence: float = Field(ge=0, le=1)
    review_needed: bool
    wells: list[WellPrediction]

