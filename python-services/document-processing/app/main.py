"""LeaseGuard document-processing service.

Its only job: extract and validate tenant statement data from PDFs and return it to the
LeaseGuard backend. It never stores records and never contacts tenants.
"""

from fastapi import FastAPI

from app.api import extractions, health
from app.api.errors import register_error_handlers
from app.core.config import ENGINE_VERSION, get_settings
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging(get_settings().logging_level)
    app = FastAPI(
        title="LeaseGuard document processing",
        version=ENGINE_VERSION,
        summary="Extracts and validates tenant statement data from PDF files.",
    )
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(extractions.router)
    return app


app = create_app()
