import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from conftest import MAX_FILE_MB, TOKEN, encrypted_pdf, settings_for, statement_pdf, upload


def test_health_is_public(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_readiness_reports_ocr_availability(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"status", "authConfigured", "ocrAvailable", "tesseractVersion"}
    assert body["status"] == "ready"
    assert body["authConfigured"] is True
    assert isinstance(body["ocrAvailable"], bool)


@pytest.mark.parametrize(
    ("token", "code"), [(None, "missing_token"), ("wrong-token", "invalid_token")]
)
def test_rejects_missing_or_invalid_token(client: TestClient, token: str | None, code: str) -> None:
    response = upload(client, statement_pdf(), token=token)
    assert response.status_code == 401
    assert response.json() == {"code": code, "message": response.json()["message"], "errors": None}
    assert response.headers["www-authenticate"] == "Bearer"


def test_refuses_every_request_when_no_token_is_configured(client: TestClient) -> None:
    app.dependency_overrides[get_settings] = lambda: settings_for(token="")
    response = upload(client, statement_pdf(), token="")
    assert response.status_code == 503
    assert response.json()["code"] == "auth_not_configured"
    assert client.get("/health/ready").status_code == 503


def test_rejects_oversize_files(client: TestClient) -> None:
    oversize = b"%PDF-1.7\n" + b"0" * (MAX_FILE_MB * 1024 * 1024)
    response = upload(client, oversize)
    assert response.status_code == 413
    assert response.json()["code"] == "file_too_large"


def test_checks_magic_bytes_not_only_the_content_type(client: TestClient) -> None:
    response = upload(client, b"PK\x03\x04 a zip file", content_type="application/pdf")
    assert response.status_code == 415
    assert response.json()["code"] == "unsupported_media_type"


def test_rejects_a_pdf_declared_as_another_type(client: TestClient) -> None:
    assert upload(client, statement_pdf(), content_type="text/plain").status_code == 415


@pytest.mark.parametrize(
    ("pdf", "code"),
    [
        (encrypted_pdf(), "encrypted_pdf"),
        (b"%PDF-1.7\n this is not really a pdf", "corrupt_pdf"),
    ],
)
def test_unreadable_pdfs_return_422_with_a_code(client: TestClient, pdf: bytes, code: str) -> None:
    response = upload(client, pdf)
    assert response.status_code == 422
    assert response.json()["code"] == code


def test_invalid_form_fields_return_invalid_request(client: TestClient) -> None:
    response = upload(client, statement_pdf(), data={"sourceSystem": "Xero"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "invalid_request"
    assert body["errors"][0]["loc"] == ["body", "sourceSystem"]
    assert "input" not in body["errors"][0]  # never echoes submitted values


def test_form_fields_are_camel_case(client: TestClient) -> None:
    snake = {"company_id": "cmp_nexus", "statement_id": "stmt_0001", "source_system": "MRI"}
    response = client.post(
        "/v1/extractions",
        headers={"Authorization": f"Bearer {TOKEN}"},
        files={"file": ("statement.pdf", statement_pdf(), "application/pdf")},
        data=snake,
    )
    assert response.status_code == 422
    missing = {tuple(error["loc"]) for error in response.json()["errors"]}
    assert missing == {("body", "companyId"), ("body", "statementId"), ("body", "sourceSystem")}


def test_response_is_camel_case_with_nullable_properties_present(client: TestClient) -> None:
    body = upload(client, statement_pdf(footer=[])).json()
    assert set(body) == {
        "engine",
        "engineVersion",
        "pageCount",
        "textLayer",
        "ocrUsed",
        "openingBalance",
        "fields",
        "lineItems",
        "overallConfidence",
        "issues",
        "status",
    }
    assert {key for field in body["fields"] for key in field} == {
        "name",
        "rawText",
        "value",
        "confidence",
        "flagged",
        "reason",
    }
    assert all(set(issue) == {"code", "severity", "message", "field"} for issue in body["issues"])
    assert any(issue["field"] is None for issue in body["issues"])  # null, not omitted
    assert any(field["reason"] is None for field in body["fields"])
    assert set(body["lineItems"][0]) == {
        "date",
        "description",
        "category",
        "kind",
        "amount",
        "confidence",
        "flagged",
    }


def test_unknown_path_returns_a_structured_404(client: TestClient) -> None:
    response = client.get("/v2/nothing-here")
    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "No such endpoint.", "errors": None}


def test_wrong_method_returns_a_structured_405(client: TestClient) -> None:
    response = client.get("/v1/extractions", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"
    assert response.json()["errors"] is None
    assert response.headers["allow"] == "POST"


def test_malformed_multipart_body_is_an_invalid_request(client: TestClient) -> None:
    response = client.post(
        "/v1/extractions",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "multipart/form-data; boundary=missing",
        },
        content=b"--wrong\r\nnot multipart",
    )
    assert response.status_code == 400
    assert response.json() == {
        "code": "invalid_request",
        "message": "Invalid multipart data.",
        "errors": None,
    }


def test_unhandled_errors_return_a_structured_500_without_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def explode(*_: object, **__: object) -> None:
        raise RuntimeError("Blue Crane owes R 79 950,50")

    monkeypatch.setattr("app.api.extractions.extract_statement", explode)
    monkeypatch.setattr("app.extractors.ocr.tesseract_available", lambda: False)
    app.dependency_overrides[get_settings] = settings_for
    try:
        with TestClient(app, raise_server_exceptions=False) as raw_client:
            response = upload(raw_client, statement_pdf())
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 500
    assert response.json() == {
        "code": "internal_error",
        "message": "The service failed unexpectedly.",
        "errors": None,
    }
    assert "Blue Crane" not in response.text


def test_openapi_documents_the_contract(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    operation = schema["paths"]["/v1/extractions"]["post"]
    assert {"400", "401", "413", "415", "422", "500", "503"} <= set(operation["responses"])
    assert operation["operationId"] == "createExtraction"
    components = schema["components"]["schemas"]
    result = components["ExtractionResult"]
    assert "engineVersion" in result["properties"]
    assert set(result["required"]) == set(result["properties"])
    assert set(components["ErrorResponse"]["required"]) == {"code", "message", "errors"}
    money = result["properties"]["openingBalance"]["anyOf"][0]
    assert money == {"type": "string", "pattern": r"^-?\d{1,13}\.\d{2}$"}
