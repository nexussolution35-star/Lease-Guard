"""Bearer-token authentication for calls from the LeaseGuard backend."""

import hmac
import logging
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.errors import ApiError
from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False, description="DOCUMENT_PROCESSING_TOKEN from the root .env")


def require_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    expected = settings.document_processing_token.get_secret_value()
    if not expected:
        logger.error("DOCUMENT_PROCESSING_TOKEN is not set; refusing request")
        raise ApiError(503, "auth_not_configured", "The service has no access token configured.")
    if credentials is None:
        raise ApiError(401, "missing_token", "A bearer token is required.")
    if not hmac.compare_digest(credentials.credentials.encode(), expected.encode()):
        raise ApiError(401, "invalid_token", "The bearer token is not valid.")
