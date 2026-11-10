from datetime import date
from decimal import Decimal

from app.parsers.statement import ParsedStatement
from app.schemas.v1 import EXTRACTION_FIELD_NAMES, ExtractedField, LineItem
from app.validators.statement import validate_statement

TODAY = date(2026, 11, 7)


def _parsed(
    opening: str | None = "1000.00",
    items: list[LineItem] | None = None,
    **values: str | Decimal | None,
) -> ParsedStatement:
    defaults: dict[str, str | Decimal | None] = {
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
    } | values
    fields = {
        name: ExtractedField(
            name=name, raw_text="", value=defaults[name], confidence=0.95, flagged=False
        )
        for name in EXTRACTION_FIELD_NAMES
    }
    return ParsedStatement(fields, items or [], Decimal(opening) if opening else None)


def _item(kind: str, amount: str, description: str = "Rental") -> LineItem:
    category = {"charge": "rental", "payment": "payment", "credit": "credit"}[kind]
    return LineItem(
        date=date(2026, 10, 1),
        description=description,
        category=category,  # type: ignore[arg-type]
        kind=kind,  # type: ignore[arg-type]
        amount=Decimal(amount),
        confidence=0.95,
        flagged=False,
    )


def _codes(parsed: ParsedStatement) -> list[str]:
    return [issue.code for issue in validate_statement(parsed, today=TODAY)]


def test_consistent_statement_has_no_issues() -> None:
    assert _codes(_parsed()) == []


def test_totals_reconcile_within_one_cent() -> None:
    assert _codes(_parsed(outstanding_balance=Decimal("1200.01"))) == []
    parsed = _parsed(outstanding_balance=Decimal("1200.02"))
    assert _codes(parsed) == ["totals_do_not_reconcile"]
    assert parsed.fields["outstanding_balance"].flagged
    assert parsed.fields["outstanding_balance"].reason == "totals_do_not_reconcile"
    assert parsed.fields["outstanding_balance"].value == Decimal("1200.02")  # never corrected


def test_a_flag_keeps_the_reason_it_already_had() -> None:
    parsed = _parsed(outstanding_balance=Decimal("1300.00"))
    parsed.fields["outstanding_balance"].flagged = True
    parsed.fields["outstanding_balance"].reason = "amount_without_cents"
    assert _codes(parsed) == ["totals_do_not_reconcile"]
    assert parsed.fields["outstanding_balance"].reason == "amount_without_cents"


def test_reconciles_from_line_items_including_credits() -> None:
    items = [_item("charge", "600.00"), _item("payment", "300.00"), _item("credit", "100.00")]
    assert _codes(_parsed(items=items)) == []
    assert _codes(_parsed(items=items, outstanding_balance=Decimal("1300.00"))) == [
        "totals_do_not_reconcile"
    ]


def test_missing_values_are_reported_not_filled() -> None:
    parsed = _parsed(opening=None, outstanding_balance=None)
    issues = validate_statement(parsed, today=TODAY)
    assert [(i.code, i.field) for i in issues] == [
        ("missing_field", "outstanding_balance"),
        ("cannot_reconcile", None),
    ]
    assert parsed.fields["outstanding_balance"].value is None
    assert "opening balance, closing balance" in issues[1].message


def test_period_must_not_end_before_it_starts() -> None:
    parsed = _parsed(period_start="2026-11-01", period_end="2026-10-31")
    assert "invalid_period" in _codes(parsed)
    assert parsed.fields["period_end"].flagged


def test_statement_date_sanity() -> None:
    assert _codes(_parsed(statement_date="2027-01-15")) == ["statement_date_out_of_range"]
    assert _codes(
        _parsed(statement_date="1999-12-31", period_start="1999-12-01", period_end="1999-12-31")
    ) == ["statement_date_out_of_range"]
    assert _codes(_parsed(statement_date="2026-09-30")) == ["statement_date_out_of_range"]


def test_negative_totals_are_flagged() -> None:
    parsed = _parsed(payments_received=Decimal("-400.00"), outstanding_balance=Decimal("2000.00"))
    assert _codes(parsed) == ["negative_amount"]
    assert parsed.fields["payments_received"].flagged


def test_duplicate_line_items_are_flagged() -> None:
    items = [_item("charge", "300.00"), _item("charge", "300.00"), _item("payment", "400.00")]
    parsed = _parsed(items=items)
    assert _codes(parsed) == ["duplicate_line_item"]
    assert [i.flagged for i in parsed.line_items] == [True, True, False]
