# LeaseGuard document-processing service

A small FastAPI service that extracts and validates tenant statement data from PDF files for the
LeaseGuard backend. It reads the PDF (PyMuPDF text layer, pdfplumber ruled tables, Tesseract OCR
for pages without a text layer), parses statement labels and transaction rows, checks the result
(totals reconcile, periods and dates make sense, no duplicate rows, expected tenant and unit) and
returns a scored proposal.

It is deliberately narrow:

- It never stores records, never contacts tenants and never handles payments.
- Its result is a proposal. The backend stores it for a person to confirm before any figure drives
  monitoring; even an `extracted` result still needs human verification.
- Nothing is guessed. A value that is not on the document is `null`. Every uncertain value is
  `flagged` with a `reason`. Rand amounts that are missing, derived from line items, read with
  confidence below 0.9 or otherwise flagged always give `status: "needs_review"`.

## Endpoints

| Method and path        | Auth   | Purpose |
| ---------------------- | ------ | ------- |
| `GET /health`          | none   | Liveness: `{"status": "ok"}` while the process serves HTTP. Used by the Docker `HEALTHCHECK`. |
| `GET /health/ready`    | none   | Readiness: `200 {"status": "ready", ...}` when an access token is configured, `503 {"status": "not_ready", ...}` otherwise. Also reports `ocrAvailable` and `tesseractVersion`. Route traffic on this. |
| `POST /v1/extractions` | bearer | Multipart upload of one statement PDF plus form fields `companyId`, `statementId`, `sourceSystem` (`MRI`, `MDA`, `PropSys`, `Sage`, `other`) and optionally repeated `expectedTenantNames` / `expectedUnitNumbers`. Returns a `DocumentExtractionResult`. |
| `GET /docs`, `GET /openapi.json` | none | Interactive docs and the OpenAPI document. |

Every error, including unknown paths (404), wrong methods (405), malformed bodies (400), invalid
fields (422) and unexpected failures (500), returns the same JSON body:

```json
{ "code": "invalid_request", "message": "...", "errors": [{ "loc": ["body", "sourceSystem"], "msg": "...", "type": "..." }] }
```

`errors` lists per-field problems for `invalid_request` from validation and is `null` otherwise.
Codes: `invalid_request`, `missing_token`, `invalid_token`, `auth_not_configured`,
`file_too_large`, `unsupported_media_type`, `encrypted_pdf`, `corrupt_pdf`, `empty_pdf`,
`not_found`, `method_not_allowed`, `internal_error`. A 500 never echoes exception details.

## Contract: source of truth

The wire contract is defined in TypeScript, in the domain package:

- `packages/domain/src/types/extraction.ts`: `DocumentExtractionResult`, `DocumentExtractionField`,
  `DocumentExtractionLineItem`, `DocumentExtractionIssue`, `DocumentExtractionRequest`,
  `DocumentProcessingErrorResponse`, issue codes, statuses, error codes and the financial fields.
- `packages/domain/src/types/statement.ts`: statement sources, extraction field names, line item
  categories and kinds.

`app/schemas/v1.py` mirrors it. Python attributes are snake_case; JSON is camelCase
(`engineVersion`, `rawText`, `lineItems`, ...), with nullable properties always present. Money is a
string with exactly two decimals (`"35000.00"`, `"-120.50"`), the `ZarDecimal` format that
`parseZarDecimal` reads. `tests/test_project_consistency.py` parses the TypeScript files and fails
on any difference in enumerations, property names, required properties, nullability, money format
or form fields. When the contract changes, change the TypeScript first, then this service, then
regenerate `openapi.json`.

## Configuration

Settings come from `backend/.env` (see `backend/.env.example`) when run from the repository,
and from the process environment otherwise (for example in the container).

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `DOCUMENT_PROCESSING_TOKEN` | empty | Shared secret the backend sends as `Authorization: Bearer <token>`. While empty, every extraction is refused with 503 `auth_not_configured` and `/health/ready` reports `not_ready`. |
| `DOCUMENT_PROCESSING_MAX_FILE_MB` | `20` | Largest accepted PDF, 1 to 200 MB. Larger files get 413 `file_too_large`. |
| `LOG_LEVEL` | `info` | Shared with the Node apps. Case-insensitive pino levels `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` or Python's `critical`, `warning`, ... (`trace` maps to DEBUG, `warn` to WARNING, `fatal` to CRITICAL, `silent` disables logging). Logs are JSON lines on stderr. |

## Local development

From `python-services/document-processing`, with Python 3.14 and, for OCR, `tesseract`
installed (OCR is optional locally; without it, scanned pages are reported, not read):

```sh
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'

.venv/bin/python -m pytest -q              # tests
.venv/bin/python -m ruff check .           # lint
.venv/bin/python -m ruff format --check .  # formatting (drop --check to apply)

.venv/bin/uvicorn app.main:app --reload --port 8000
```

After changing a schema or endpoint, regenerate the OpenAPI document (a test fails if it is stale):

```sh
.venv/bin/python scripts/export_openapi.py
```

## Docker

```sh
docker build -t leaseguard-document-processing .
docker run --rm -p 8000:8000 \
  -e DOCUMENT_PROCESSING_TOKEN=change-me -e LOG_LEVEL=info \
  leaseguard-document-processing
curl http://127.0.0.1:8000/health/ready
```

The image is based on a pinned patch release (`python:3.14.10-slim-trixie`), installs exactly the
packages in `requirements.txt` (with `--no-deps`, then `pip check`), includes Tesseract for OCR and
runs as an unprivileged user. Its `HEALTHCHECK` probes liveness at `/health`; orchestrators should
use `/health/ready` for readiness.

## Relocking requirements

`pyproject.toml` pins the direct dependencies and is the source of truth. `requirements.txt` is
the generated lock of every transitive runtime dependency for the Docker image; never edit it by
hand. After changing a dependency in `pyproject.toml`, regenerate it inside the Dockerfile's base
image, so the resolution matches the runtime platform:

```sh
docker run --rm -v "$PWD":/src -w /src -u "$(id -u):$(id -g)" -e HOME=/tmp \
  python:3.14.10-slim-trixie python scripts/lock_requirements.py
```

The script refuses to run on another OS or Python version unless `--any-platform` is passed. When
you move to a new base image, update the `FROM` line and the image tag above together, then
relock. `tests/test_project_consistency.py` checks that every line is a canonical `name==version`
pin and that the direct dependencies match `pyproject.toml`.
