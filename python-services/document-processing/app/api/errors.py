"""Machine-readable error responses: every error body is an `ErrorResponse`.

That covers the service's own `ApiError`s, request validation (422), routing errors raised by
Starlette (404, 405, ...) and unhandled exceptions (500). `errors` is always present: the list of
per-field problems for `invalid_request`, `null` otherwise.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.v1 import ErrorCode, ErrorResponse

logger = logging.getLogger(__name__)

_HTTP_ERROR_CODES: dict[int, ErrorCode] = {
    404: "not_found",
    405: "method_not_allowed",
    413: "file_too_large",
    415: "unsupported_media_type",
}
_HTTP_ERROR_MESSAGES: dict[ErrorCode, str] = {
    "not_found": "No such endpoint.",
    "method_not_allowed": "This endpoint does not support that HTTP method.",
    "file_too_large": "The request body is too large.",
    "unsupported_media_type": "Only PDF statements are accepted.",
    "invalid_request": "The request could not be processed.",
    "internal_error": "The service failed unexpectedly.",
}


class ApiError(Exception):
    def __init__(self, status_code: int, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code: ErrorCode = code
        self.message = message


def error_code_for_status(status_code: int) -> ErrorCode:
    """The `ErrorResponse` code for an HTTP error the service did not raise itself."""
    if status_code in _HTTP_ERROR_CODES:
        return _HTTP_ERROR_CODES[status_code]
    return "internal_error" if status_code >= 500 else "invalid_request"


def error_response(
    status_code: int,
    code: ErrorCode,
    message: str,
    *,
    errors: list[dict[str, object]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(code=code, message=message, errors=errors)
    return JSONResponse(body.model_dump(mode="json"), status_code, headers=headers)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
        return error_response(exc.status_code, exc.code, exc.message, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            422,
            "invalid_request",
            "The request is missing fields or has invalid values.",
            # `input` could echo document content back; `ctx` may hold non-JSON objects.
            errors=jsonable_encoder(exc.errors(), exclude={"input", "ctx"}),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = error_code_for_status(exc.status_code)
        # Starlette's details for routing errors are terse ("Not Found"), so mapped codes use the
        # service's wording. Other client errors keep the framework's explanation (for example
        # "Invalid multipart data."); server errors never expose details.
        message = _HTTP_ERROR_MESSAGES[code]
        if code == "invalid_request" and isinstance(exc.detail, str) and exc.detail:
            message = exc.detail
        return error_response(exc.status_code, code, message, headers=exc.headers)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Never echo the exception text: it may contain document content.
        logger.error(
            "unhandled error",
            exc_info=exc,
            extra={"method": request.method, "path": request.url.path},
        )
        return error_response(500, "internal_error", _HTTP_ERROR_MESSAGES["internal_error"])
