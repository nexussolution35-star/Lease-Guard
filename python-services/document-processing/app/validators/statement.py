"""Consistency checks on a parsed statement. Each check returns issues; fields named by an issue
are flagged for review, with the issue code as the reason when they had none. Nothing here changes
an extracted value."""

from collections import Counter
from datetime import date, timedelta
from decimal import Decimal

from app.parsers.money import format_zar
from app.parsers.statement import ParsedStatement
from app.schemas.v1 import Issue, LineItem

RECONCILE_TOLERANCE = Decimal("0.01")
EARLIEST_STATEMENT = date(2000, 1, 1)
MAX_DAYS_AHEAD = 31


def validate_statement(parsed: ParsedStatement, *, today: date) -> list[Issue]:
    issues = [
        *_missing_fields(parsed),
        *_reconcile(parsed),
        *_period(parsed),
        *_statement_date(parsed, today),
        *_negative_totals(parsed),
        *_duplicate_line_items(parsed),
    ]
    for issue in issues:
        if issue.field is None:
            continue
        flagged = parsed.fields[issue.field]
        if not flagged.flagged or flagged.reason is None:
            # The first problem found explains the flag; later issues are in `issues`.
            flagged.reason = issue.code
        flagged.flagged = True
    return issues


def _missing_fields(parsed: ParsedStatement) -> list[Issue]:
    return [
        Issue(
            code="missing_field",
            severity="error",
            message=f"{name.replace('_', ' ').capitalize()} was not found on the statement.",
            field=name,
        )
        for name, extracted in parsed.fields.items()
        if extracted.value is None
    ]


def _reconcile(parsed: ParsedStatement) -> list[Issue]:
    """Opening balance + charges - payments - credits must equal the closing balance."""
    closing = parsed.money("outstanding_balance")
    opening = parsed.opening_balance
    if parsed.line_items:
        charges, payments, credits = (
            sum((i.amount for i in parsed.line_items if i.kind == kind), Decimal("0.00"))
            for kind in ("charge", "payment", "credit")
        )
        basis = "line items"
    else:
        rental, other = parsed.money("rental_charged"), parsed.money("additional_charges")
        paid = parsed.money("payments_received")
        if rental is None or other is None or paid is None:
            charges = payments = None
        else:
            charges, payments = rental + other, paid
        credits = Decimal("0.00")
        basis = "statement totals (credits not itemised)"
    missing = [
        label
        for label, value in (
            ("opening balance", opening),
            ("closing balance", closing),
            ("charges", charges),
            ("payments", payments),
        )
        if value is None
    ]
    if opening is None or closing is None or charges is None or payments is None:
        return [
            Issue(
                code="cannot_reconcile",
                severity="warning",
                message=f"Totals could not be reconciled because the {', '.join(missing)} "
                "could not be read.",
            )
        ]
    expected = opening + charges - payments - credits
    difference = closing - expected
    if abs(difference) <= RECONCILE_TOLERANCE:
        return []
    return [
        Issue(
            code="totals_do_not_reconcile",
            severity="error",
            message=f"Opening {format_zar(opening)} + charges {format_zar(charges)} - payments "
            f"{format_zar(payments)} - credits {format_zar(credits)} = {format_zar(expected)}, "
            f"but the statement shows {format_zar(closing)} (difference "
            f"{format_zar(difference)}; based on {basis}).",
            field="outstanding_balance",
        )
    ]


def _period(parsed: ParsedStatement) -> list[Issue]:
    start, end = parsed.iso_date("period_start"), parsed.iso_date("period_end")
    if start is None or end is None or start <= end:
        return []
    return [
        Issue(
            code="invalid_period",
            severity="error",
            message=f"The statement period starts ({start:%d %b %Y}) after it ends "
            f"({end:%d %b %Y}).",
            field="period_end",
        )
    ]


def _statement_date(parsed: ParsedStatement, today: date) -> list[Issue]:
    statement_date = parsed.iso_date("statement_date")
    if statement_date is None:
        return []
    problem: str | None = None
    if statement_date > today + timedelta(days=MAX_DAYS_AHEAD):
        problem = "is more than a month in the future"
    elif statement_date < EARLIEST_STATEMENT:
        problem = f"is before {EARLIEST_STATEMENT:%d %b %Y}"
    elif (start := parsed.iso_date("period_start")) is not None and statement_date < start:
        problem = f"is before the statement period starts ({start:%d %b %Y})"
    if problem is None:
        return []
    return [
        Issue(
            code="statement_date_out_of_range",
            severity="warning",
            message=f"The statement date {statement_date:%d %b %Y} {problem}.",
            field="statement_date",
        )
    ]


def _negative_totals(parsed: ParsedStatement) -> list[Issue]:
    issues: list[Issue] = []
    for name in ("rental_charged", "additional_charges", "payments_received"):
        value = parsed.money(name)
        if value is not None and value < 0:
            issues.append(
                Issue(
                    code="negative_amount",
                    severity="warning",
                    message=f"{name.replace('_', ' ').capitalize()} is negative "
                    f"({format_zar(value)}).",
                    field=name,
                )
            )
    return issues


def _duplicate_line_items(parsed: ParsedStatement) -> list[Issue]:
    def key(item: LineItem) -> tuple[date, str, str, Decimal]:
        return item.date, " ".join(item.description.lower().split()), item.kind, item.amount

    counts = Counter(key(item) for item in parsed.line_items)
    for item in parsed.line_items:
        if counts[key(item)] > 1:
            item.flagged = True
    return [
        Issue(
            code="duplicate_line_item",
            severity="warning",
            message=f"{count} identical line items: {item_date:%d %b %Y} {description!r} "
            f"{format_zar(amount)}.",
        )
        for (item_date, description, _, amount), count in counts.items()
        if count > 1
    ]
