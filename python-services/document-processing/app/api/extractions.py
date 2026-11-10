import logging
import time
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.errors import ApiError
from app.core.config import Settings, get_settings
from app.core.security import require_token
from app.extractors import ocr
from app.extractors.pdf import PdfRejectedError, looks_like_pdf
from app.schemas.v1 import ErrorResponse, ExtractionResult, StatementSource
from app.services.extraction import Hints, extract_statement

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["extractions"], dependencies=[Depends(require_token)])

_PDF_CONTENT_TYPES = {"application/pdf", "application/x-pdf", "application/octet-stream"}


@router.post(
    "/extractions",
    response_model=ExtractionResult,
    operation_id="createExtraction",
    summary="Extract and validate a tenant statement PDF",
    responses={
        400: {"model": ErrorResponse, "description": "Malformed multipart body"},
        401: {"model": ErrorResponse, "description": "Missing or invalid bearer token"},
        413: {"model": ErrorResponse, "description": "File larger than the configured limit"},
        415: {"model": ErrorResponse, "description": "The file is not a PDF"},
        422: {"model": ErrorResponse, "description": "Invalid request, or unreadable PDF"},
        500: {"model": ErrorResponse, "description": "Unexpected failure"},
        503: {"model": ErrorResponse, "description": "No access token configured"},
    },
)
async def create_extraction(
    settings: Annotated[Settings, Depends(get_settings)],
    file: Annotated[UploadFile, File(description="Statement PDF")],
    # Form field names are camelCase, matching `DocumentExtractionRequest` in the domain package.
    company_id: Annotated[
        str, Form(alias="companyId", title="Company ID", min_length=1, max_length=100)
    ],
    statement_id: Annotated[
        str, Form(alias="statementId", title="Statement ID", min_length=1, max_length=100)
    ],
    source_system: Annotated[
        StatementSource,
        Form(
            alias="sourceSystem",
            title="Source System",
            description="Hint only; parsing is the same for every source.",
        ),
    ],
    expected_tenant_names: Annotated[
        list[str] | None,
        Form(
            alias="expectedTenantNames",
            title="Expected Tenant Names",
            description="Tenant names expected for this property; repeat the field per name.",
        ),
    ] = None,
    expected_unit_numbers: Annotated[
        list[str] | None,
        Form(
            alias="expectedUnitNumbers",
            title="Expected Unit Numbers",
            description="Unit numbers expected for this property; repeat the field per unit.",
        ),
    ] = None,
) -> ExtractionResult:
    data = await file.read(settings.max_file_bytes + 1)
    if len(data) > settings.max_file_bytes:
        raise ApiError(
            413,
            "file_too_large",
            f"The file exceeds {settings.document_processing_max_file_mb} MB.",
        )
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not looks_like_pdf(data) or (content_type and content_type not in _PDF_CONTENT_TYPES):
        raise ApiError(415, "unsupported_media_type", "Only PDF statements are accepted.")

    hints = Hints(tuple(expected_tenant_names or ()), tuple(expected_unit_numbers or ()))
    started = time.perf_counter()
    try:
        result = await run_in_threadpool(
            extract_statement,
            data,
            hints=hints,
            ocr_available=ocr.tesseract_available(),
            today=date.today(),
        )
    except PdfRejectedError as exc:
        raise ApiError(422, exc.code, exc.message) from exc
    logger.info(
        "statement extracted",
        extra={
            "company_id": company_id,
            "statement_id": statement_id,
            "source_system": source_system,
            "status": result.status,
            "page_count": result.page_count,
            "issue_codes": sorted({i.code for i in result.issues}),
            "duration_ms": round((time.perf_counter() - started) * 1000),
        },
    )
    return result
