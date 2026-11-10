# LeaseGuard document-processing service. Build from this directory:
#   docker build -t leaseguard-document-processing .
# The base image is pinned to a patch release; requirements.txt is locked against the same image
# (see scripts/lock_requirements.py), so change both together.
FROM python:3.14.10-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Tesseract reads statement pages that have no text layer. PyMuPDF renders the pages itself,
# so poppler is not needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt ./
RUN pip install --no-deps -r requirements.txt && pip check
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-deps . && rm -rf /build

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin leaseguard
USER leaseguard
WORKDIR /srv

EXPOSE 8000
# Liveness: GET /health answers 200 while the process serves HTTP; any other outcome (error
# status, refused connection, timeout) makes the check exit non-zero. Readiness is separate:
# GET /health/ready returns 503 until DOCUMENT_PROCESSING_TOKEN is set and reports whether OCR is
# available, so orchestrators should route traffic on /health/ready, not on this check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
