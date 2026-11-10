"""Test fixtures. Every PDF is generated at test time with PyMuPDF; nothing is checked in."""

from collections.abc import Iterator

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app

TOKEN = "test-token-0123456789"
MAX_FILE_MB = 1

HEADER = [
    ("Tenant:", "Blue Crane Pharmacy (Pty) Ltd"),
    ("Unit:", "Shop 12"),
    ("Statement Date:", "31 Oct 2026"),
    ("Period:", "01 Oct 2026 - 31 Oct 2026"),
]
RULED_ROWS = [
    ("Date", "Description", "Debit", "Credit"),
    ("01 Oct 2026", "Balance Brought Forward", "R 70 000,00", ""),
    ("01 Oct 2026", "Rental - October 2026", "R 35 000,00", ""),
    ("01 Oct 2026", "Operating Costs", "R 4 500,00", ""),
    ("01 Oct 2026", "Rates and Taxes", "R 2 300,00", ""),
    ("15 Oct 2026", "Electricity - September", "R 3 150,50", ""),
    ("20 Oct 2026", "Payment Received - Thank You", "", "R 35 000,00"),
]
FOOTER = [("Closing Balance:", "R 79 950,50"), ("Amount Due:", "R 79 950,50")]
# The same statement with its totals printed, so none has to be derived from the line items.
TOTALS_FOOTER = [
    ("Rental Charged:", "R 35 000,00"),
    ("Additional Charges:", "R 9 950,50"),
    ("Payments Received:", "R 35 000,00"),
    *FOOTER,
]

# Unruled statement, signed amount column, mixed South African formats. Correct closing balance
# would be 12 000 + 35 000 + 1 500 - 1 200 - 35 000 = R 12 300,00; it prints R 20 000,00.
UNRULED_HEADER = [
    ("Tenant Name:", "Karoo Coffee Roasters"),
    ("Unit No:", "4B"),
    ("Statement Date:", "31/10/2026"),
    ("Statement Period:", "October 2026"),
]
UNRULED_ROWS = [
    ("Date", "Description", "Amount"),
    ("01/10/2026", "Balance Brought Forward", "R12,000.00"),
    ("01/10/2026", "Basic Rental", "R35,000.00"),
    ("01/10/2026", "Parking Bays", "R1 500.00"),
    ("05/10/2026", "Rental Credit Note", "(1 200,00)"),
    ("18/10/2026", "Payment - EFT", "35 000.00 Cr"),
]
UNRULED_FOOTER = [("Closing Balance", "R 20 000,00"), ("Amount Due", "R 20 000,00")]


def _label_lines(page: pymupdf.Page, pairs: list[tuple[str, str]], y: float) -> float:
    for label, value in pairs:
        page.insert_text((50, y), label, fontsize=10)
        page.insert_text((220, y), value, fontsize=10)
        y += 18
    return y


def _table(page: pymupdf.Page, rows: list[tuple[str, ...]], y: float, *, ruled: bool) -> float:
    edges = [40, 120, 330, 440, 550][: len(rows[0]) + 1] if ruled else [40, 120, 330, 440, 550]
    for row in rows:
        for column, text in enumerate(row):
            rect = pymupdf.Rect(edges[column], y, edges[column + 1], y + 18)
            if ruled:
                page.draw_rect(rect, color=(0, 0, 0), width=0.5)
            if text:
                page.insert_text((rect.x0 + 4, rect.y0 + 13), text, fontsize=10)
        y += 18
    return y + 18


def statement_pdf(
    *,
    header: list[tuple[str, str]] = HEADER,
    rows: list[tuple[str, ...]] = RULED_ROWS,
    footer: list[tuple[str, str]] = FOOTER,
    ruled: bool = True,
) -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)  # A4
    page.insert_text((50, 50), "ACME PROPERTY MANAGEMENT (PTY) LTD", fontsize=12)
    page.insert_text((50, 70), "TENANT STATEMENT", fontsize=12)
    y = _label_lines(page, header, 100)
    y = _table(page, rows, y + 10, ruled=ruled)
    _label_lines(page, footer, y)
    return document.tobytes()


def image_only_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 100), False)
    pixmap.set_rect(pixmap.irect, (220, 220, 220))
    page.insert_image(pymupdf.Rect(50, 50, 450, 250), pixmap=pixmap)
    return document.tobytes()


def encrypted_pdf() -> bytes:
    return pymupdf.open(stream=statement_pdf(), filetype="pdf").tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="tenant", owner_pw="owner"
    )


def settings_for(token: str = TOKEN) -> Settings:
    return Settings(document_processing_token=token, document_processing_max_file_mb=MAX_FILE_MB)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    # Behave the same whether or not Tesseract happens to be installed on this machine.
    monkeypatch.setattr("app.extractors.ocr.tesseract_available", lambda: False)
    app.dependency_overrides[get_settings] = settings_for
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def upload(
    client: TestClient,
    pdf: bytes,
    *,
    token: str | None = TOKEN,
    content_type: str = "application/pdf",
    data: dict[str, str | list[str]] | None = None,
):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    form: dict[str, str | list[str]] = {
        "companyId": "cmp_nexus",
        "statementId": "stmt_0001",
        "sourceSystem": "MRI",
    }
    form.update(data or {})
    return client.post(
        "/v1/extractions",
        headers=headers,
        files={"file": ("statement.pdf", pdf, content_type)},
        data=form,
    )
