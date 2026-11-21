"""The MRI "Tax Invoice & Statement" reader, against the owner's test statement."""

from dataclasses import replace
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.extractors.pdf import DocumentContent, PageContent, TextLine, read_document
from app.parsers.mri import is_mri_statement, parse_mri_statement
from app.parsers.statement import parse_statement
from app.services.extraction import Hints, extract_statement
from conftest import statement_pdf, upload

FIXTURE = (
    Path(__file__).parent / "fixtures/statements/mri-tax-invoice-statement-collfin-2025-04.pdf"
)
TODAY = date(2026, 11, 21)


@pytest.fixture(scope="module")
def pdf() -> bytes:
    return FIXTURE.read_bytes()


@pytest.fixture(scope="module")
def document(pdf: bytes) -> DocumentContent:
    return read_document(pdf, ocr_available=False)


def _edit(document: DocumentContent, old: str, new: str | None) -> DocumentContent:
    """The same document with the first cell printed as `old` changed (removed when `new` is
    None)."""
    found = False
    pages: list[PageContent] = []
    for page in document.pages:
        lines: list[TextLine] = []
        for line in page.lines:
            cells, boxes = list(line.cells), list(line.boxes)
            if not found and old in cells:
                found = True
                index = cells.index(old)
                if new is None:
                    del cells[index], boxes[index]
                else:
                    cells[index] = new
            if cells:
                lines.append(replace(line, cells=tuple(cells), boxes=tuple(boxes)))
        pages.append(replace(page, lines=lines))
    assert found, old
    return DocumentContent(pages)


def _fields(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {f["name"]: f for f in body["fields"]}


def test_reads_every_value_of_the_test_statement(client: TestClient, pdf: bytes) -> None:
    response = upload(
        client,
        pdf,
        data={"expectedTenantNames": ["Nkosana Mpinga"], "expectedUnitNumbers": ["F0921"]},
    )
    assert response.status_code == 200
    body = response.json()
    fields = _fields(body)
    assert {name: f["value"] for name, f in fields.items()} == {
        "tenant_name": "Nkosana Mpinga",
        "unit_number": "F0921",
        "statement_number": "MIP01/202504/1",
        "statement_date": "2025-04-04",
        "period_start": "2025-04-01",
        "period_end": "2025-04-30",
        "opening_balance": "7528.00",
        "rental_charged": "4264.00",
        "additional_charges": "0.00",
        "payments_received": "12792.00",
        "outstanding_balance": "-1000.00",  # a credit balance stays negative
        "total_due": "-1000.00",
    }
    assert all(f["confidence"] >= 0.95 and not f["flagged"] for f in fields.values())
    assert fields["tenant_name"]["rawText"] == "Nkosana Mpinga / Luhambo Studens"
    assert [
        (i["date"], i["description"], i["category"], i["kind"], i["amount"])
        for i in body["lineItems"]
    ] == [
        ("2025-04-01", "Rent: Students", "rental", "charge", "4264.00"),
        (
            "2025-04-01",
            "STC:Luhambo Students - Payment Received - Thank you",
            "payment",
            "payment",
            "12152.40",
        ),
        (
            "2025-04-01",
            "Merchant Fee (NSFAS 5%) - Payment Received - Thank you",
            "payment",
            "payment",
            "639.60",
        ),
    ]
    assert not any(i["flagged"] for i in body["lineItems"])
    assert body["issues"] == []
    assert body["status"] == "extracted"


def test_reads_the_values_without_an_extraction_field(document: DocumentContent) -> None:
    parsed = parse_mri_statement(document)
    assert parsed.layout == "mri"
    assert parsed.details == {
        "property": "LUHAMBO STUDENTS",
        "ageing_120": "0.00",
        "ageing_90": "0.00",
        "ageing_60": "0.00",
        "ageing_30": "0.00",
        "ageing_current": "-1000.00",
        "arrears_prepaid": "7528.00",
        "current_month_charges": "-8528.00",
    }


def _extract(document: DocumentContent, monkeypatch: pytest.MonkeyPatch, **hints: Any) -> Any:
    monkeypatch.setattr("app.services.extraction.read_document", lambda *_a, **_k: document)
    return extract_statement(b"", hints=Hints(**hints), ocr_available=False, today=TODAY)


def test_tenant_is_flagged_when_no_expected_name_decides(
    document: DocumentContent, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _extract(document, monkeypatch)
    tenant = next(f for f in result.fields if f.name == "tenant_name")
    assert tenant.value == "Nkosana Mpinga"
    assert tenant.flagged
    assert tenant.confidence < 0.8
    assert tenant.reason == "recipient_block_has_several_lines"
    assert [i.field for i in result.issues] == ["tenant_name"]
    assert result.status == "needs_review"


def test_either_recipient_line_can_match_the_tenant(
    document: DocumentContent, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _extract(document, monkeypatch, tenant_names=("luhambo studens",))
    tenant = next(f for f in result.fields if f.name == "tenant_name")
    assert (tenant.value, tenant.flagged, tenant.reason) == (
        "Luhambo Studens",
        False,
        "matched_expected_value",
    )


def test_tenant_stays_flagged_when_neither_line_matches(
    document: DocumentContent, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The PDF prints "Luhambo Studens"; the property's tenant is spelt differently.
    result = _extract(document, monkeypatch, tenant_names=("Luhambo Students",))
    tenant = next(f for f in result.fields if f.name == "tenant_name")
    assert tenant.flagged
    assert tenant.reason == "not_in_expected_values"
    assert "hint_mismatch" in [i.code for i in result.issues]


def test_tenant_is_flagged_when_both_lines_match(
    document: DocumentContent, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _extract(document, monkeypatch, tenant_names=("Nkosana Mpinga", "Luhambo Studens"))
    tenant = next(f for f in result.fields if f.name == "tenant_name")
    assert tenant.flagged
    assert tenant.reason == "conflicting_values"


def test_changed_amount_due_fails_reconciliation(
    document: DocumentContent, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _extract(
        _edit(document, "R-1,000.00", "R-1,100.00"),
        monkeypatch,
        tenant_names=("Nkosana Mpinga",),
    )
    fields = {f.name: f for f in result.fields}
    assert fields["total_due"].value == Decimal("-1100.00")
    assert fields["outstanding_balance"].flagged
    assert fields["total_due"].flagged
    for name in ("rental_charged", "additional_charges", "payments_received"):
        assert fields[name].flagged
        assert fields[name].reason in ("derived_from_line_items", "no_matching_line_items")
    codes = [i.code for i in result.issues]
    assert "totals_do_not_reconcile" in codes
    assert result.status == "needs_review"


def test_changed_line_amount_fails_reconciliation(
    document: DocumentContent, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _extract(
        _edit(document, "4,264.00", "4,364.00"), monkeypatch, tenant_names=("Nkosana Mpinga",)
    )
    fields = {f.name: f for f in result.fields}
    assert fields["rental_charged"].value == Decimal("4364.00")
    assert fields["rental_charged"].flagged
    assert fields["outstanding_balance"].flagged
    rent = result.line_items[0]
    assert rent.flagged  # exclusive + tax no longer equals inclusive
    errors = [i for i in result.issues if i.severity == "error"]
    assert {i.code for i in errors} == {"totals_do_not_reconcile"}
    assert result.status == "needs_review"


def test_changed_brought_forward_conflicts_with_arrears(document: DocumentContent) -> None:
    parsed = parse_mri_statement(_edit(document, "7,528.00", "7,628.00"))
    opening = parsed.fields["opening_balance"]
    # The first 7,528.00 printed is Balance B/f; Arrears/Prepaid still says 7,528.00.
    assert opening.value == Decimal("7628.00")
    assert opening.flagged
    assert opening.reason == "conflicting_values"


def test_missing_label_is_left_empty_and_flagged(document: DocumentContent) -> None:
    parsed = parse_mri_statement(_edit(document, "Tax Invoice No: MIP01/202504/1", None))
    number = parsed.fields["statement_number"]
    assert (number.value, number.flagged, number.reason) == (None, True, "not_found")


def test_unparseable_value_is_left_empty_and_flagged(document: DocumentContent) -> None:
    parsed = parse_mri_statement(_edit(document, "For the Month: April 2025", "For the Month: ?"))
    for name in ("period_start", "period_end"):
        field = parsed.fields[name]
        assert (field.value, field.flagged, field.reason) == (None, True, "not_parsed")


def test_amount_due_is_unconfirmed_when_ageing_disagrees(document: DocumentContent) -> None:
    parsed = parse_mri_statement(_edit(document, "-1,000.00", "-900.00"))
    closing = parsed.fields["outstanding_balance"]
    assert closing.value == Decimal("-1000.00")
    assert closing.flagged
    assert any(i.code == "totals_do_not_reconcile" for i in parsed.issues)


def test_layout_is_recognised_from_the_document(document: DocumentContent) -> None:
    assert is_mri_statement(document)
    footerless = _edit(
        document, "Software Supplied by: MRI Real Estate Software www.mrisoftware.com/za", None
    )
    assert is_mri_statement(footerless)  # title and MRI's own labels
    assert not is_mri_statement(read_document(statement_pdf(), ocr_available=False))


def test_source_system_is_only_a_hint(client: TestClient, pdf: bytes) -> None:
    mri = _fields(upload(client, pdf, data={"sourceSystem": "other"}).json())
    assert mri["statement_number"]["value"] == "MIP01/202504/1"
    generic = _fields(upload(client, statement_pdf(), data={"sourceSystem": "MRI"}).json())
    assert generic["statement_number"]["value"] == "ST-2026-1042"


def test_general_reader_never_takes_a_heading_row_as_the_tenant(
    document: DocumentContent,
) -> None:
    tenant = parse_statement(document).fields["tenant_name"]
    assert tenant.value is None
    assert tenant.flagged


def test_general_reader_flags_a_value_spread_over_columns() -> None:
    line = TextLine(("Tenant", "Blue Crane", "Pharmacy"), 1, False)
    document = DocumentContent([PageContent(1, [line], [], True, False)])
    tenant = parse_statement(document).fields["tenant_name"]
    assert tenant.value == "Blue Crane Pharmacy"
    assert tenant.flagged
    assert tenant.reason == "value_spans_several_columns"
