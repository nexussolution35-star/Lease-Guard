from datetime import date
from decimal import Decimal
from typing import Any

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.schemas.v1 import EXTRACTION_FIELD_NAMES, ExtractedField, Issue, LineItem
from app.services.extraction import review_status
from conftest import (
    RULED_ROWS,
    TOTALS_FOOTER,
    UNRULED_FOOTER,
    UNRULED_HEADER,
    UNRULED_ROWS,
    image_only_pdf,
    statement_pdf,
    upload,
)


def _fields(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {f["name"]: f for f in body["fields"]}


def _codes(body: dict[str, Any]) -> list[str]:
    return [issue["code"] for issue in body["issues"]]


def test_ruled_statement_that_reconciles(client: TestClient) -> None:
    response = upload(client, statement_pdf())
    assert response.status_code == 200
    body = response.json()
    fields = _fields(body)

    assert list(fields) == [
        "tenant_name",
        "unit_number",
        "statement_date",
        "period_start",
        "period_end",
        "rental_charged",
        "additional_charges",
        "payments_received",
        "outstanding_balance",
        "total_due",
    ]
    assert {name: f["value"] for name, f in fields.items()} == {
        "tenant_name": "Blue Crane Pharmacy (Pty) Ltd",
        "unit_number": "Shop 12",
        "statement_date": "2026-10-31",
        "period_start": "2026-10-01",
        "period_end": "2026-10-31",
        "rental_charged": "35000.00",
        "additional_charges": "9950.50",
        "payments_received": "35000.00",
        "outstanding_balance": "79950.50",
        "total_due": "79950.50",
    }
    assert body["openingBalance"] == "70000.00"
    # The statement prints no rental, charges or payments totals: they are summed from its line
    # items, so they are flagged for a person to confirm and the result is never `extracted`.
    derived = {"rental_charged", "additional_charges", "payments_received"}
    for name in derived:
        assert fields[name]["flagged"] is True
        assert fields[name]["reason"] == "derived_from_line_items"
    assert not any(f["flagged"] for name, f in fields.items() if name not in derived)
    assert [(i["category"], i["kind"], i["amount"]) for i in body["lineItems"]] == [
        ("rental", "charge", "35000.00"),
        ("operating_costs", "charge", "4500.00"),
        ("rates_and_taxes", "charge", "2300.00"),
        ("utilities", "charge", "3150.50"),
        ("payment", "payment", "35000.00"),
    ]
    assert body["issues"] == []
    assert body["status"] == "needs_review"
    assert body["textLayer"] is True
    assert body["ocrUsed"] is False
    assert body["overallConfidence"] >= 0.9


def test_unruled_statement_with_mixed_formats_that_does_not_reconcile(client: TestClient) -> None:
    pdf = statement_pdf(
        header=UNRULED_HEADER, rows=UNRULED_ROWS, footer=UNRULED_FOOTER, ruled=False
    )
    body = upload(client, pdf).json()
    fields = _fields(body)

    assert fields["tenant_name"]["value"] == "Karoo Coffee Roasters"
    assert fields["statement_date"]["value"] == "2026-10-31"
    assert fields["period_end"]["reason"] == "period_from_month_label"
    assert body["openingBalance"] == "12000.00"
    assert [(i["kind"], i["amount"]) for i in body["lineItems"]] == [
        ("charge", "35000.00"),
        ("charge", "1500.00"),
        ("credit", "1200.00"),
        ("payment", "35000.00"),
    ]
    # Read from an unruled text row (not a ruled table), so it is below the bar for money.
    assert {
        "code": "low_confidence",
        "severity": "warning",
        "message": "The opening balance was read with low confidence (85%).",
        "field": None,
    } in body["issues"]
    reconcile = next(i for i in body["issues"] if i["code"] == "totals_do_not_reconcile")
    assert reconcile["severity"] == "error"
    assert "R 12 300,00" in reconcile["message"]
    assert fields["outstanding_balance"]["value"] == "20000.00"  # reported as printed
    assert fields["outstanding_balance"]["flagged"] is True
    assert body["status"] == "needs_review"
    assert body["overallConfidence"] <= 0.5


def test_missing_balance_is_null_flagged_and_reported(client: TestClient) -> None:
    body = upload(client, statement_pdf(footer=[])).json()
    fields = _fields(body)
    for name in ("outstanding_balance", "total_due"):
        assert fields[name]["value"] is None
        assert fields[name]["flagged"] is True
        assert fields[name]["confidence"] == 0
    assert _codes(body).count("missing_field") == 2
    assert "cannot_reconcile" in _codes(body)
    assert body["status"] == "needs_review"


def test_scanned_page_without_ocr_fails(client: TestClient) -> None:
    body = upload(client, image_only_pdf()).json()
    assert body["status"] == "failed"
    assert body["textLayer"] is False
    assert _codes(body) == ["scanned_without_ocr"]
    assert all(f["value"] is None and f["flagged"] for f in body["fields"])


def test_scanned_page_uses_ocr_when_available(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.extractors.ocr.tesseract_available", lambda: True)
    monkeypatch.setattr(
        "app.extractors.ocr.page_text",
        lambda _page: "Tenant: Blue Crane\nClosing Balance R 1 000,00\n",
    )
    body = upload(client, image_only_pdf()).json()
    fields = _fields(body)
    assert body["ocrUsed"] is True
    assert fields["tenant_name"]["value"] == "Blue Crane"
    assert fields["outstanding_balance"]["value"] == "1000.00"
    assert fields["outstanding_balance"]["confidence"] < 0.95  # OCR lowers confidence
    assert "ocr_used" in _codes(body)
    assert body["status"] == "needs_review"


def test_text_without_statement_labels_is_an_unsupported_layout(client: TestClient) -> None:
    document = pymupdf.open()
    document.new_page().insert_text((50, 50), "Minutes of the body corporate meeting")
    body = upload(client, document.tobytes()).json()
    assert body["status"] == "failed"
    assert _codes(body) == ["unsupported_layout"]


def test_hints_confirm_or_question_tenant_and_unit(client: TestClient) -> None:
    matched = upload(
        client,
        statement_pdf(footer=TOTALS_FOOTER),
        data={
            "expectedTenantNames": ["Blue Crane Pharmacy (PTY) LTD"],
            "expectedUnitNumbers": ["12"],
        },
    ).json()
    assert _fields(matched)["unit_number"]["reason"] == "matched_expected_value"
    assert matched["status"] == "extracted"

    mismatched = upload(
        client, statement_pdf(), data={"expectedTenantNames": ["Someone Else", "Another"]}
    ).json()
    tenant = _fields(mismatched)["tenant_name"]
    assert tenant["flagged"] is True
    assert tenant["value"] == "Blue Crane Pharmacy (Pty) Ltd"  # never replaced by a hint
    assert "hint_mismatch" in _codes(mismatched)


def test_money_is_serialised_as_two_decimal_strings(client: TestClient) -> None:
    body = upload(client, statement_pdf()).json()
    for item in body["lineItems"]:
        assert isinstance(item["amount"], str)
        assert Decimal(item["amount"]).as_tuple().exponent == -2


# Uncertain rand amounts are never passed silently: each is flagged with a reason, and the result
# is `needs_review` whenever any financial field is flagged, missing or below the money threshold.

FINANCIAL = (
    "rental_charged",
    "additional_charges",
    "payments_received",
    "outstanding_balance",
    "total_due",
)


def _assert_review_invariants(body: dict[str, Any]) -> None:
    for field in body["fields"]:
        if field["flagged"]:
            assert field["reason"], f"{field['name']} is flagged without a reason"
    uncertain_money = [
        f["name"]
        for f in body["fields"]
        if f["name"] in FINANCIAL and (f["value"] is None or f["flagged"] or f["confidence"] < 0.9)
    ]
    if uncertain_money:
        assert body["status"] != "extracted", uncertain_money


@pytest.mark.parametrize(
    "pdf",
    [
        statement_pdf(),
        statement_pdf(footer=TOTALS_FOOTER),
        statement_pdf(footer=[]),
        statement_pdf(header=UNRULED_HEADER, rows=UNRULED_ROWS, footer=UNRULED_FOOTER, ruled=False),
        statement_pdf(footer=[("Closing Balance:", "R 79 950"), ("Amount Due:", "R 79 950,50")]),
        statement_pdf(rows=[r for r in RULED_ROWS if "Payment" not in r[1]]),
        image_only_pdf(),
    ],
    ids=["derived", "printed", "no-footer", "unruled", "no-cents", "no-payments", "scanned"],
)
def test_every_flagged_value_has_a_reason_and_uncertain_money_needs_review(
    client: TestClient, pdf: bytes
) -> None:
    _assert_review_invariants(upload(client, pdf).json())


def test_statement_with_printed_totals_is_extracted_without_flags(client: TestClient) -> None:
    body = upload(client, statement_pdf(footer=TOTALS_FOOTER)).json()
    fields = _fields(body)
    assert [fields[name]["value"] for name in FINANCIAL] == [
        "35000.00",
        "9950.50",
        "35000.00",
        "79950.50",
        "79950.50",
    ]
    assert not any(f["flagged"] for f in body["fields"])
    assert all(f["reason"] is None for f in body["fields"])
    assert body["issues"] == []
    assert body["status"] == "extracted"


def test_amount_without_cents_is_flagged_with_a_reason(client: TestClient) -> None:
    footer = [("Closing Balance:", "R 79 950"), ("Amount Due:", "R 79 950,50")]
    body = upload(client, statement_pdf(footer=footer)).json()
    closing = _fields(body)["outstanding_balance"]
    assert closing["value"] == "79950.00"  # as printed, never "corrected" to the line-item total
    assert closing["flagged"] is True
    assert closing["reason"] == "amount_without_cents"
    assert body["status"] == "needs_review"


def test_money_label_run_together_with_its_value_is_below_the_money_bar(
    client: TestClient,
) -> None:
    # One text cell ("Amount Due R 79 950,50") instead of a label column and a value column.
    document = pymupdf.open(stream=statement_pdf(footer=TOTALS_FOOTER[:-1]), filetype="pdf")
    document[0].insert_text((50, 700), "Amount Due R 79 950,50", fontsize=10)
    body = upload(client, document.tobytes()).json()
    total_due = _fields(body)["total_due"]
    assert total_due["value"] == "79950.50"
    assert total_due["confidence"] < 0.9
    assert total_due["flagged"] is True
    assert total_due["reason"] == "label_and_value_run_together"
    assert "low_confidence" in _codes(body)
    assert body["status"] == "needs_review"


def test_total_with_no_matching_line_items_is_zero_but_flagged(client: TestClient) -> None:
    rows = [row for row in RULED_ROWS if "Payment" not in row[1]]
    footer = [("Closing Balance:", "R 114 950,50"), ("Amount Due:", "R 114 950,50")]
    body = upload(client, statement_pdf(rows=rows, footer=footer)).json()
    payments = _fields(body)["payments_received"]
    assert payments["value"] == "0.00"
    assert payments["flagged"] is True
    assert payments["reason"] == "no_matching_line_items"
    assert body["status"] == "needs_review"


def test_value_flagged_by_a_validator_gets_the_issue_as_its_reason(client: TestClient) -> None:
    footer = [("Closing Balance:", "R 80 000,00"), ("Amount Due:", "R 80 000,00")]
    body = upload(client, statement_pdf(footer=footer)).json()
    closing = _fields(body)["outstanding_balance"]
    assert closing["value"] == "80000.00"
    assert closing["flagged"] is True
    assert closing["reason"] == "totals_do_not_reconcile"
    assert body["status"] == "needs_review"


def _clean_fields(**overrides: dict[str, Any]) -> list[ExtractedField]:
    values: dict[str, str | Decimal] = {
        "tenant_name": "Blue Crane",
        "unit_number": "12",
        "statement_date": "2026-10-31",
        "period_start": "2026-10-01",
        "period_end": "2026-10-31",
        "rental_charged": Decimal("500.00"),
        "additional_charges": Decimal("100.00"),
        "payments_received": Decimal("400.00"),
        "outstanding_balance": Decimal("1200.00"),
        "total_due": Decimal("1200.00"),
    }
    return [
        ExtractedField.model_validate(
            {
                "name": name,
                "raw_text": "",
                "value": values[name],
                "confidence": 0.95,
                "flagged": False,
            }
            | overrides.get(name, {})
        )
        for name in EXTRACTION_FIELD_NAMES
    ]


def test_review_status_is_extracted_only_when_nothing_is_open() -> None:
    assert review_status(_clean_fields(), [], []) == "extracted"


@pytest.mark.parametrize(
    "override",
    [
        {"value": None, "confidence": 0.0, "flagged": True, "reason": "not_found"},
        {"flagged": True, "reason": "derived_from_line_items"},
        # Even unflagged, a rand amount below the money threshold is never `extracted`.
        {"confidence": 0.85},
        {"value": None},
    ],
    ids=["missing", "flagged", "low-confidence", "null-unflagged"],
)
@pytest.mark.parametrize("name", FINANCIAL)
def test_review_status_never_passes_uncertain_money(name: str, override: dict[str, Any]) -> None:
    assert review_status(_clean_fields(**{name: override}), [], []) == "needs_review"


def test_review_status_counts_flagged_line_items_and_issues() -> None:
    item = LineItem(
        date=date(2026, 10, 1),
        description="Rental",
        category="rental",
        kind="charge",
        amount=Decimal("500.00"),
        confidence=0.6,
        flagged=True,
    )
    issue = Issue(code="ocr_used", severity="warning", message="OCR was used.")
    assert review_status(_clean_fields(), [item], []) == "needs_review"
    assert review_status(_clean_fields(), [], [issue]) == "needs_review"
