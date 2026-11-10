"""Generic, label-based tenant statement parser.

It looks for common statement labels (Tenant, Unit, Statement Date, Period, Balance Brought
Forward, Closing Balance, Amount Due, ...) and for transaction rows that start with a date. It is
not tuned to any accounting system. Confidence reflects how the value was found; a value that is
not on the document is returned as `None` and is never filled in.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import date
from decimal import Decimal
from typing import Literal

from app.extractors.pdf import DocumentContent, Table, TextLine
from app.parsers.dates import parse_date, parse_period, split_leading_date
from app.parsers.money import Money, parse_zar, split_trailing_zar
from app.schemas.v1 import (
    EXTRACTION_FIELD_NAMES,
    FINANCIAL_FIELD_NAMES,
    ExtractedField,
    ExtractionFieldName,
    Issue,
    LineItem,
    LineItemCategory,
    LineItemKind,
)

FLAG_BELOW = 0.8
"""Values with a confidence below this are flagged for review."""

FINANCIAL_FLAG_BELOW = 0.9
"""Rand amounts are held to a higher bar. It equals `DEFAULT_MIN_FINANCIAL_CONFIDENCE` in the
domain package, so an amount the backend would not pre-fill is also flagged here."""

ALWAYS_REVIEW_REASONS = frozenset(
    {"derived_from_line_items", "no_matching_line_items", "conflicting_values"}
)
"""Values that were not printed as such, or not unambiguously: flagged whatever their confidence."""

_EXACT_LABEL = 0.95  # label in its own column, value in the next
_LABEL_PREFIX = 0.85  # label and value run together on one line
_TABLE_ROW = 0.95
_TEXT_ROW = 0.85
_NO_CENTS = 0.8
_OCR = 0.85
_DERIVED = 0.9
_UNCERTAIN = 0.6

Target = Literal[
    "tenant_name",
    "unit_number",
    "statement_date",
    "period",
    "opening_balance",
    "rental_charged",
    "additional_charges",
    "payments_received",
    "outstanding_balance",
    "total_due",
]
_MONEY_TARGETS: frozenset[Target] = frozenset(
    {
        "opening_balance",
        "rental_charged",
        "additional_charges",
        "payments_received",
        "outstanding_balance",
        "total_due",
    }
)
_TEXT_TARGETS: frozenset[Target] = frozenset({"tenant_name", "unit_number"})
_BALANCE_TARGETS: frozenset[Target] = frozenset(
    {"opening_balance", "outstanding_balance", "total_due"}
)

_LABEL_SYNONYMS: dict[Target, tuple[str, ...]] = {
    "tenant_name": ("tenant name", "tenant", "lessee", "account name"),
    "unit_number": ("unit number", "unit no", "unit", "shop no", "premises"),
    "statement_date": ("statement date", "date of statement", "date issued"),
    "period": ("statement period", "billing period", "period"),
    "opening_balance": (
        "balance brought forward",
        "opening balance",
        "balance b/f",
        "brought forward",
    ),
    "rental_charged": ("rental charged", "total rental", "basic rental", "rental"),
    "additional_charges": ("additional charges", "other charges", "sundry charges"),
    "payments_received": ("payments received", "payment received", "total payments"),
    "outstanding_balance": (
        "outstanding balance",
        "closing balance",
        "balance outstanding",
        "amount outstanding",
        "balance carried forward",
        "balance c/f",
    ),
    "total_due": ("total amount due", "total due", "amount due", "amount payable"),
}
_LABELS: list[tuple[str, Target]] = sorted(
    ((label, target) for target, labels in _LABEL_SYNONYMS.items() for label in labels),
    key=lambda pair: -len(pair[0]),
)

_PAYMENT_WORDS = re.compile(r"\b(?:payment|paid|receipt|received|eft)\b", re.IGNORECASE)
_CATEGORY_PATTERNS: tuple[tuple[re.Pattern[str], LineItemCategory], ...] = (
    (re.compile(r"\bparking\b", re.I), "parking"),
    (re.compile(r"\bmarketing\b", re.I), "marketing_levy"),
    (re.compile(r"\binterest\b", re.I), "interest"),
    (re.compile(r"\b(?:operating costs?|opex)\b", re.I), "operating_costs"),
    (re.compile(r"\b(?:rates|taxes|municipal)\b", re.I), "rates_and_taxes"),
    (
        re.compile(r"\b(?:electricity|water|sewer\w*|sewage|refuse|utilit\w*|gas)\b", re.I),
        "utilities",
    ),
    (re.compile(r"\brent(?:al)?\b", re.I), "rental"),
)

_HEADER_KEYWORDS: dict[str, tuple[str, ...]] = {
    "date": ("date", "trans date", "transaction date"),
    "description": ("description", "details", "particulars", "transaction", "reference"),
    "debit": ("debit", "debits", "charges", "dr"),
    "credit": ("credit", "credits", "payments", "cr"),
    "amount": ("amount", "amount (r)", "amount (zar)"),
}

Column = Literal["debit", "credit", "amount"]


@dataclass(frozen=True, slots=True)
class _Candidate:
    target: Target
    value: str | Decimal | date | tuple[date, date]
    raw_text: str
    confidence: float
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class _Row:
    date: date | None
    description: str
    amounts: list[tuple[Column, Money]]
    raw: str
    from_table: bool
    ocr: bool
    has_unparsed_amount: bool = False


def flag_threshold(name: ExtractionFieldName) -> float:
    """Confidence below which the named field is flagged for review."""
    return FINANCIAL_FLAG_BELOW if name in FINANCIAL_FIELD_NAMES else FLAG_BELOW


@dataclass(slots=True)
class ParsedStatement:
    fields: dict[ExtractionFieldName, ExtractedField]
    line_items: list[LineItem]
    opening_balance: Decimal | None
    issues: list[Issue] = field(default_factory=list)
    opening_balance_confidence: float | None = None
    """How the opening balance was read; `None` when it was not found."""

    def money(self, name: ExtractionFieldName) -> Decimal | None:
        value = self.fields[name].value
        return value if isinstance(value, Decimal) else None

    def iso_date(self, name: ExtractionFieldName) -> date | None:
        value = self.fields[name].value
        return date.fromisoformat(value) if isinstance(value, str) else None

    @property
    def found_anything(self) -> bool:
        return bool(self.line_items) or any(f.value is not None for f in self.fields.values())


def parse_statement(document: DocumentContent) -> ParsedStatement:
    candidates: dict[Target, list[_Candidate]] = defaultdict(list)
    items: list[LineItem] = []
    issues: list[Issue] = []

    for page in document.pages:
        statement_tables = [(t, h) for t in page.tables if (h := _locate_header(t)) is not None]
        for table, header in statement_tables:
            for row in _rows_from_table(table, *header):
                _consume_row(row, candidates, items, issues)
        for line in page.lines:
            if split_leading_date(line.text) is not None:
                # Date-led lines are transactions. On pages with a ruled table they were already
                # read from the table, so only unruled pages use the text row.
                if not statement_tables and (row := _row_from_line(line)) is not None:
                    _consume_row(row, candidates, items, issues)
            elif (candidate := _match_label(line)) is not None:
                candidates[candidate.target].append(candidate)

    resolved = {t: c for t, cs in candidates.items() if (c := _resolve(cs, issues)) is not None}
    _derive_totals(resolved, items)
    opening = resolved.get("opening_balance")
    if opening is not None and isinstance(opening.value, Decimal):
        opening_balance, opening_confidence = opening.value, round(opening.confidence, 2)
    else:
        opening_balance, opening_confidence = None, None
    return ParsedStatement(
        fields=_to_fields(resolved),
        line_items=items,
        opening_balance=opening_balance,
        issues=issues,
        opening_balance_confidence=opening_confidence,
    )


def _norm(text: str) -> str:
    return " ".join(text.lower().replace(":", " ").split())


def _match_label(line: TextLine) -> _Candidate | None:
    first = _norm(line.cells[0])
    lowered = line.text.lower()
    for label, target in _LABELS:
        if first == label and len(line.cells) > 1:
            value_text, base, reason = " ".join(line.cells[1:]), _EXACT_LABEL, None
        elif lowered.startswith(label) and not lowered[len(label) : len(label) + 1].isalnum():
            remainder = line.text[len(label) :]
            # "TENANT STATEMENT" is a title, not a tenant: free-text values need "Label: value".
            if target in _TEXT_TARGETS and not remainder.lstrip().startswith(":"):
                continue
            value_text = remainder.lstrip(" :-\t")
            base, reason = _LABEL_PREFIX, "label_and_value_run_together"
        else:
            continue
        base *= _OCR if line.ocr else 1.0
        candidate = _interpret(target, value_text.strip(), line.text, base, reason)
        if candidate is not None:
            return candidate
    return None


def _interpret(
    target: Target, value_text: str, raw: str, base: float, reason: str | None
) -> _Candidate | None:
    if not value_text:
        return None
    if target in _MONEY_TARGETS:
        money = parse_zar(value_text)
        if money is None:
            return None
        if not money.has_cents:
            base, reason = base * _NO_CENTS, reason or "amount_without_cents"
        return _Candidate(target, money.amount, raw, base, reason)
    if target == "statement_date":
        parsed = parse_date(value_text)
        return _Candidate(target, parsed, raw, base, reason) if parsed else None
    if target == "period":
        period = parse_period(value_text)
        if period is None:
            return None
        start, end, from_month = period
        if from_month:
            base, reason = base * 0.85, "period_from_month_label"
        return _Candidate(target, (start, end), raw, base, reason)
    if parse_zar(value_text) is not None or parse_date(value_text) is not None:
        return None
    return _Candidate(target, value_text, raw, base, reason)


def _resolve(candidates: list[_Candidate], issues: list[Issue]) -> _Candidate | None:
    if not candidates:
        return None
    first = candidates[0]
    if all(c.value == first.value for c in candidates):
        return max(candidates, key=lambda c: c.confidence)
    issues.append(
        Issue(
            code="conflicting_values",
            severity="warning",
            message=f"The statement shows {len({c.value for c in candidates})} different values "
            f"for {first.target.replace('_', ' ')}; the first one is used.",
            field=_field_for(first.target),
        )
    )
    return replace(first, confidence=min(first.confidence, 0.5), reason="conflicting_values")


def _field_for(target: Target) -> ExtractionFieldName | None:
    if target == "period":
        return "period_start"
    return None if target == "opening_balance" else target


def _locate_header(table: Table) -> tuple[int, dict[str, int]] | None:
    for index, row in enumerate(table[:5]):
        columns: dict[str, int] = {}
        for position, cell in enumerate(row):
            text = _norm(cell or "")
            for key, keywords in _HEADER_KEYWORDS.items():
                if key not in columns and text in keywords:
                    columns[key] = position
        has_amounts = any(k in columns for k in ("debit", "credit", "amount"))
        if "date" in columns and "description" in columns and has_amounts:
            return index, columns
    return None


def _rows_from_table(table: Table, header_index: int, columns: dict[str, int]) -> list[_Row]:
    rows: list[_Row] = []
    for raw_row in table[header_index + 1 :]:
        cells = [" ".join((c or "").split()) for c in raw_row]

        def cell(key: str, cells: list[str] = cells) -> str:
            position = columns.get(key)
            return cells[position] if position is not None and position < len(cells) else ""

        amounts: list[tuple[Column, Money]] = []
        unparsed = False
        for column in ("debit", "credit", "amount"):
            if text := cell(column):
                money = parse_zar(text)
                if money is None:
                    unparsed = True
                else:
                    amounts.append((column, money))
        date_text = cell("date")
        rows.append(
            _Row(
                date=parse_date(date_text) if date_text else None,
                description=cell("description"),
                amounts=amounts,
                raw=" | ".join(c for c in cells if c),
                from_table=True,
                ocr=False,
                has_unparsed_amount=unparsed,
            )
        )
    return rows


def _row_from_line(line: TextLine) -> _Row | None:
    split = split_leading_date(line.text)
    if split is None:
        return None
    row_date, rest = split
    amounts: list[tuple[Column, Money]] = []
    if len(line.cells) > 1:
        first_rest = split_leading_date(line.cells[0])
        cells = ([first_rest[1]] if first_rest and first_rest[1] else []) + list(line.cells[1:])
        description_parts: list[str] = []
        for text in cells:
            money = parse_zar(text)
            # A bare number without cents or an R symbol is more likely a reference than money.
            if money is not None and (money.has_cents or money.has_symbol):
                amounts.append(("amount", money))
            else:
                description_parts.append(text)
        description = " ".join(description_parts)
    else:
        trailing = split_trailing_zar(rest)
        if trailing is not None:
            amounts.append(("amount", trailing[1]))
        description = trailing[0] if trailing else rest
    return _Row(row_date, description, amounts, line.text, from_table=False, ocr=line.ocr)


def _consume_row(
    row: _Row,
    candidates: dict[Target, list[_Candidate]],
    items: list[LineItem],
    issues: list[Issue],
) -> None:
    description = _norm(row.description)
    balance = next(
        (t for label, t in _LABELS if t in _BALANCE_TARGETS and description.startswith(label)),
        None,
    )
    if balance is not None and row.amounts:
        column, money = row.amounts[0]
        amount = -abs(money.amount) if column == "credit" else money.amount
        base = (_TABLE_ROW if row.from_table else _TEXT_ROW) * (_OCR if row.ocr else 1.0)
        candidates[balance].append(_Candidate(balance, amount, row.raw, base))
        return
    if row.has_unparsed_amount or (row.date is None and row.amounts):
        issues.append(
            Issue(
                code="unparsed_row",
                severity="warning",
                message=f"A statement row could not be read and was skipped: {row.raw!r}.",
            )
        )
        return
    if row.date is None or not row.amounts:
        return
    if row.from_table and len(row.amounts) > 1:
        issues.append(
            Issue(
                code="unparsed_row",
                severity="warning",
                message=f"A row has both a debit and a credit and was skipped: {row.raw!r}.",
            )
        )
        return
    column, money = row.amounts[0]
    if money.amount == 0:
        return
    confidence = (_TABLE_ROW if row.from_table else _TEXT_ROW) * (_OCR if row.ocr else 1.0)
    if not money.has_cents:
        confidence *= _NO_CENTS
    if len(row.amounts) > 1:
        # Unruled rows with several amounts may include a running balance column.
        confidence = min(confidence, _UNCERTAIN)
    kind, direction_certain = _direction(column, money, row.description)
    if not direction_certain:
        confidence = min(confidence, _UNCERTAIN)
    if column in ("debit", "credit") and money.amount < 0:
        confidence = min(confidence, _UNCERTAIN)
        issues.append(
            Issue(
                code="negative_amount",
                severity="warning",
                message=f"A negative amount appears in the {column} column: {row.raw!r}.",
            )
        )
    items.append(
        LineItem(
            date=row.date,
            description=row.description,
            category=_category(kind, row.description),
            kind=kind,
            amount=abs(money.amount),
            confidence=round(confidence, 2),
            flagged=confidence < FLAG_BELOW,
        )
    )


def _direction(column: Column, money: Money, description: str) -> tuple[LineItemKind, bool]:
    """Returns the kind and whether the document states it (column or sign) unambiguously."""
    payment_like = _PAYMENT_WORDS.search(description) is not None
    if column == "debit":
        return "charge", True
    if column == "credit" or money.amount < 0:
        return ("payment" if payment_like else "credit"), True
    # A positive signed amount is a charge, unless the description says it is a payment.
    return ("payment", False) if payment_like else ("charge", True)


def _category(kind: LineItemKind, description: str) -> LineItemCategory:
    if kind == "payment":
        return "payment"
    if kind == "credit":
        return "credit"
    for pattern, category in _CATEGORY_PATTERNS:
        if pattern.search(description):
            return category
    return "other_charge"


def _derive_totals(resolved: dict[Target, _Candidate], items: list[LineItem]) -> None:
    """Totals the statement does not print are summed from its own line items and marked so."""
    if not items:
        return
    charges = [i for i in items if i.kind == "charge"]
    groups: dict[Target, list[LineItem]] = {
        "rental_charged": [i for i in charges if i.category == "rental"],
        "additional_charges": [i for i in charges if i.category != "rental"],
        "payments_received": [i for i in items if i.kind == "payment"],
    }
    lowest = min(i.confidence for i in items)
    for target, group in groups.items():
        if target in resolved:
            continue
        total = sum((i.amount for i in group), Decimal("0.00"))
        if group:
            confidence = min(i.confidence for i in group) * _DERIVED
            reason, raw = "derived_from_line_items", f"Sum of {len(group)} line item(s)"
        else:
            # Zero because no matching rows were read: plausible, but a person should confirm it.
            confidence = min(lowest * _DERIVED, 0.75)
            reason, raw = "no_matching_line_items", "No matching line items"
        resolved[target] = _Candidate(target, total, raw, confidence, reason)


def _to_fields(resolved: dict[Target, _Candidate]) -> dict[ExtractionFieldName, ExtractedField]:
    fields: dict[ExtractionFieldName, ExtractedField] = {}
    period = resolved.get("period")
    for name in EXTRACTION_FIELD_NAMES:
        candidate = period if name in ("period_start", "period_end") else resolved.get(name)
        if candidate is None:
            fields[name] = ExtractedField(
                name=name, raw_text="", value=None, confidence=0.0, flagged=True, reason="not_found"
            )
            continue
        value = candidate.value
        if isinstance(value, tuple):
            value = value[0] if name == "period_start" else value[1]
        flagged = (
            candidate.confidence < flag_threshold(name) or candidate.reason in ALWAYS_REVIEW_REASONS
        )
        fields[name] = ExtractedField(
            name=name,
            raw_text=candidate.raw_text,
            value=value.isoformat() if isinstance(value, date) else value,
            confidence=round(candidate.confidence, 2),
            flagged=flagged,
            # A flagged value always says why, so a reviewer knows what to check.
            reason=candidate.reason or ("low_confidence" if flagged else None),
        )
    return fields
