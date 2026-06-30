from fastapi import FastAPI, File, HTTPException, Query, UploadFile

from .analyzer import analyze_image, decode_image
from .models import AnalysisResponse

MAX_UPLOAD_BYTES = 20 * 1024 * 1024

app = FastAPI(
    title="MIC Plate Image Assist",
    version="0.1.0",
    description="OpenCV-based auxiliary analysis. Every result remains subject to manual review.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/analyze", response_model=AnalysisResponse)
async def analyze(
    image: UploadFile = File(...),
    confidence_threshold: float = Query(default=0.85, ge=0, le=1),
) -> AnalysisResponse:
    if image.content_type is not None and not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="image file required")
    content = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image exceeds 20 MB")
    try:
        decoded = decode_image(content)
        return analyze_image(decoded, confidence_threshold)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

