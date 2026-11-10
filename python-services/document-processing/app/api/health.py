from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.core.config import Settings, get_settings
from app.extractors import ocr
from app.schemas.v1 import Health, Readiness

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=Health,
    operation_id="getHealth",
    summary="Liveness: the process is up and serving HTTP",
)
def health() -> Health:
    return Health(status="ok")


@router.get(
    "/health/ready",
    response_model=Readiness,
    operation_id="getReadiness",
    responses={503: {"model": Readiness, "description": "No access token configured"}},
    summary="Readiness: an access token is configured; also reports whether OCR is available",
)
def ready(settings: Annotated[Settings, Depends(get_settings)]) -> JSONResponse:
    auth_configured = bool(settings.document_processing_token.get_secret_value())
    version = ocr.tesseract_version()
    body = Readiness(
        status="ready" if auth_configured else "not_ready",
        auth_configured=auth_configured,
        ocr_available=version is not None,
        tesseract_version=version,
    )
    return JSONResponse(body.model_dump(mode="json"), status_code=200 if auth_configured else 503)
