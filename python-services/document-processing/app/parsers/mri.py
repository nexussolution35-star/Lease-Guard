"""Reader for the MRI Real Estate Software "Tax Invoice & Statement" layout.

The layout is recognised from the document itself (its title, its labels and its "Software
Supplied by: MRI Real Estate Software" footer), never from the source system the uploader chose.
Values are read by position: a heading's value is the cell printed directly below it ("Unit No."
over "F0921"), or after it on the same line ("Balance B/f  7,528.00"). The transaction table is
read by its column headings (Date, Allocation, Remarks, Exclusive, Tax, Inclusive) and amounts
are taken from the Inclusive column.

What MRI prints and what it does not:

- The tenant is the unlabelled recipient block left of the Property column. It often has two
  lines (the person and the account name) and the document does not say which one is the
  tenant, so every line is offered (`tenant_name_options`) and the value is flagged until one of
  them matches an expected tenant name.
- The closing balance is "Amount Due". It is only taken as confident when the ageing row adds up
  to it.
- Rental, additional charges and payments totals are not printed. They are summed from the line
  items and are confident only when the line items add up to the printed "Current Month Charges"
  and the opening balance plus those charges equals the amount due; otherwise they are flagged.

A value that is missing or does not parse is left empty and flagged; nothing is guessed. A credit
balance (a negative amount due) stays negative.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.extractors.pdf import Box, DocumentContent
from app.parsers.dates import parse_date
from app.parsers.money import Money, format_zar, parse_zar
from app.parsers.statement import (
    ALWAYS_REVIEW_REASONS,
    PAYMENT_WORDS,
    STATEMENT_NUMBER,
    ParsedStatement,
    flag_threshold,
    line_item_category,
)
from app.schemas.v1 import (
    EXTRACTION_FIELD_NAMES,
    ExtractedField,
    ExtractionFieldName,
    Issue,
    LineItem,
    LineItemKind,
)

LAYOUT = "mri"

_LABELLED = 0.95  # read from its own heading or inline label
_RECIPIENT_SINGLE_LINE = 0.85  # the recipient block has no heading, but only one line
_AMBIGUOUS = 0.6
_DERIVED = 0.9
_CLOSING_UNCONFIRMED = 0.85  # amount due read, but the ageing row does not confirm it
_ALIGN = 6.0  # points of slack when lining a value up with its heading
_CENT = Decimal("0.01")

_AGEING_LABELS = ("120 days +", "90 days", "60 days", "30 days", "current")
_TABLE_HEADINGS = ("date", "allocation", "remarks", "exclusive", "tax", "inclusive")
_MONTH_YEAR = re.compile(r"^([A-Za-z]{3,9})\.?\s+(\d{4})$")
_MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name} | {
    name.lower(): i for i, name in enumerate(calendar.month_abbr) if name
}


@dataclass(frozen=True, slots=True)
class _Cell:
    text: str
    box: Box
    line: int
    page: int

    @property
    def x0(self) -> float:
        return self.box[0]

    @property
    def y0(self) -> float:
        return self.box[1]

    @property
    def x1(self) -> float:
        return self.box[2]

    @property
    def y1(self) -> float:
        return self.box[3]

    @property
    def key(self) -> str:
        return _key(self.text)


def _key(text: str) -> str:
    return " ".join(text.lower().rstrip(" .:").split())


def is_mri_statement(document: DocumentContent) -> bool:
    """The MRI footer, or the MRI title together with MRI's own statement labels."""
    text = " ".join(line.text for page in document.pages for line in page.lines).lower()
    if "software supplied by: mri real estate software" in text:
        return True
    return (
        "tax invoice & statement" in text
        and "tax invoice no" in text
        and "for the month" in text
        and "balance b/f" in text
    )


def parse_mri_statement(document: DocumentContent) -> ParsedStatement:
    reader = _Reader(document)
    return reader.parse()


class _Reader:
    def __init__(self, document: DocumentContent) -> None:
        self.cells: list[_Cell] = []
        index = 0
        for page in document.pages:
            for line in page.lines:
                if len(line.boxes) == len(line.cells):
                    for text, box in zip(line.cells, line.boxes, strict=True):
                        self.cells.append(_Cell(text.strip(), box, index, page.number))
                index += 1
        self.fields: dict[ExtractionFieldName, ExtractedField] = {}
        self.issues: list[Issue] = []
        self.items: list[LineItem] = []
        self.signed_lines: list[Decimal] = []
        self.details: dict[str, str] = {}
        self.tenant_options: tuple[str, ...] = ()

    # Lookups -------------------------------------------------------------------------------

    def _heading(self, label: str) -> _Cell | None:
        return next((c for c in self.cells if c.key == label), None)

    def _below(self, heading: _Cell) -> _Cell | None:
        """The nearest cell under a heading, left- or right-aligned with it, on the next lines."""
        height = heading.y1 - heading.y0
        candidates = [
            c
            for c in self.cells
            if c.page == heading.page
            and c.y0 >= heading.y1 - 1
            and c.y0 - heading.y1 <= 2.5 * height
            and (abs(c.x0 - heading.x0) <= _ALIGN or abs(c.x1 - heading.x1) <= _ALIGN)
        ]
        return min(candidates, key=lambda c: c.y0, default=None)

    def _after(self, heading: _Cell) -> list[_Cell]:
        """Cells on the same line, right of the heading, left to right."""
        return sorted(
            (c for c in self.cells if c.line == heading.line and c.x0 > heading.x1),
            key=lambda c: c.x0,
        )

    def _inline(self, label: str) -> tuple[str, str] | None:
        """`"Statement Date: 04/04/2025"` -> (value, raw)."""
        for cell in self.cells:
            match = re.match(rf"^{re.escape(label)}\s*:\s*(.*)$", cell.text, re.IGNORECASE)
            if match:
                return match.group(1).strip(), cell.text
        return None

    # Field helpers -------------------------------------------------------------------------

    def _set(
        self,
        name: ExtractionFieldName,
        value: str | Decimal | None,
        raw: str,
        confidence: float,
        reason: str | None = None,
    ) -> None:
        if value is None:
            self.fields[name] = ExtractedField(
                name=name,
                raw_text=raw,
                value=None,
                confidence=0.0,
                flagged=True,
                reason=reason or "not_found",
            )
            return
        flagged = confidence < flag_threshold(name) or reason in ALWAYS_REVIEW_REASONS
        self.fields[name] = ExtractedField(
            name=name,
            raw_text=raw,
            value=value,
            confidence=round(confidence, 2),
            flagged=flagged,
            reason=reason or ("low_confidence" if flagged else None),
        )

    def _flag(
        self, name: ExtractionFieldName, reason: str, confidence: float | None = None
    ) -> None:
        current = self.fields[name]
        current.flagged = True
        current.reason = reason
        if confidence is not None and current.value is not None:
            current.confidence = min(current.confidence, confidence)

    def _money_after(self, label: str) -> tuple[Money | None, str] | None:
        """The last amount after a heading on its line (the Inclusive figure), or None."""
        heading = self._heading(label)
        if heading is None:
            return None
        after = self._after(heading)
        raw = " ".join([heading.text, *(c.text for c in after)])
        if not after:
            return None, raw
        return parse_zar(after[-1].text), raw

    # Parse ---------------------------------------------------------------------------------

    def parse(self) -> ParsedStatement:
        self._header()
        self._transactions()
        self._totals()
        fields = {name: self.fields[name] for name in EXTRACTION_FIELD_NAMES}
        return ParsedStatement(
            fields=fields,
            line_items=self.items,
            issues=self.issues,
            layout=LAYOUT,
            tenant_name_options=self.tenant_options,
            details=self.details,
        )

    def _header(self) -> None:
        self._tenant()
        for label, name, detail in (
            ("unit no", "unit_number", None),
            ("property", None, "property"),
        ):
            heading = self._heading(label)
            value = self._below(heading) if heading else None
            raw = f"{heading.text} {value.text}" if heading and value else ""
            if name is not None:
                self._set(name, value.text if value else None, raw, _LABELLED)
            elif detail is not None and value is not None:
                self.details[detail] = value.text

        number = self._inline("tax invoice no")
        if number and STATEMENT_NUMBER.match(number[0]) and any(ch.isdigit() for ch in number[0]):
            self._set("statement_number", number[0], number[1], _LABELLED)
        else:
            self._set(
                "statement_number",
                None,
                number[1] if number else "",
                0,
                "not_parsed" if number else None,
            )

        printed = self._inline("statement date")
        statement_date = parse_date(printed[0]) if printed else None
        self._set(
            "statement_date",
            statement_date.isoformat() if statement_date else None,
            printed[1] if printed else "",
            _LABELLED,
            None if statement_date or not printed else "not_parsed",
        )

        month = self._inline("for the month")
        period = _month(month[0]) if month else None
        raw = month[1] if month else ""
        for name, index in (("period_start", 0), ("period_end", 1)):
            self._set(
                name,
                period[index].isoformat() if period else None,
                raw,
                _LABELLED,
                ("period_is_calendar_month" if period else "not_parsed") if month else None,
            )

    def _tenant(self) -> None:
        title = next((c for c in self.cells if c.key == "tax invoice & statement"), None)
        column = self._heading("property") or self._heading("entity")
        bottom = next(
            (c for c in self.cells if re.match(r"^statement date\s*:", c.text, re.IGNORECASE)),
            None,
        )
        if title is None or column is None or bottom is None:
            self._set("tenant_name", None, "", 0)
            return
        block = sorted(
            (
                c
                for c in self.cells
                if c.page == title.page
                and c.y0 >= title.y1
                and c.y1 <= bottom.y0
                and c.x1 < column.x0 - 2
                and c.text
                and parse_zar(c.text) is None
            ),
            key=lambda c: (c.y0, c.x0),
        )
        lines = tuple(dict.fromkeys(c.text for c in block))
        self.tenant_options = lines
        raw = " / ".join(lines)
        if not lines:
            self._set("tenant_name", None, "", 0)
        elif len(lines) == 1:
            self._set("tenant_name", lines[0], raw, _RECIPIENT_SINGLE_LINE)
        else:
            self._set("tenant_name", lines[0], raw, _AMBIGUOUS, "recipient_block_has_several_lines")

    def _transactions(self) -> None:
        headings = {
            name: next((c for c in self.cells if c.key == name), None) for name in _TABLE_HEADINGS
        }
        date_h, alloc_h, remarks_h = headings["date"], headings["allocation"], headings["remarks"]
        incl_h = headings["inclusive"]
        if date_h is None or alloc_h is None or remarks_h is None or incl_h is None:
            self._set("opening_balance", None, "", 0)
            return
        stop = min(
            (
                c.y0
                for c in self.cells
                if c.key in ("arrears/prepaid", "current month charges", "amount due")
                and c.page == incl_h.page
            ),
            default=float("inf"),
        )
        rows: dict[int, list[_Cell]] = {}
        for cell in self.cells:
            if cell.page == incl_h.page and incl_h.y1 <= cell.y0 < stop:
                rows.setdefault(cell.line, []).append(cell)

        opening: tuple[Decimal | None, str] | None = None
        current: dict[str, str] | None = None
        parsed_rows: list[dict[str, str]] = []

        def column(cell: _Cell) -> str | None:
            for name in ("exclusive", "tax", "inclusive"):
                heading = headings[name]
                if heading is not None and abs(cell.x1 - heading.x1) <= _ALIGN:
                    return name
            if cell.x0 >= remarks_h.x0 - 2:
                return "remarks"
            if cell.x0 >= alloc_h.x0 - 2:
                return "allocation"
            return "date"

        for _, cells in sorted(rows.items()):
            by_column: dict[str, str] = {}
            for cell in sorted(cells, key=lambda c: c.x0):
                name = column(cell)
                if name is not None:
                    by_column[name] = (by_column.get(name, "") + " " + cell.text).strip()
            raw = " | ".join(c.text for c in sorted(cells, key=lambda c: c.x0))
            if _key(by_column.get("remarks", "")) == "balance b/f" or any(
                c.key == "balance b/f" for c in cells
            ):
                money = parse_zar(by_column.get("inclusive", ""))
                opening = (money.amount if money and money.has_cents else None, raw)
                continue
            if "date" in by_column:
                current = {**by_column, "raw": raw}
                parsed_rows.append(current)
            elif current is not None and set(by_column) <= {"allocation", "remarks"}:
                # A wrapped allocation or remark ("Merchant Fee (NSFAS" / "5%)").
                for name, text in by_column.items():
                    current[name] = f"{current.get(name, '')} {text}".strip()
                current["raw"] += f" | {raw}"
            else:
                self._unparsed(raw)

        if opening is None:
            self._set("opening_balance", None, "", 0)
        elif opening[0] is None:
            self._set("opening_balance", None, opening[1], 0, "not_parsed")
        else:
            self._set("opening_balance", opening[0], opening[1], _LABELLED)

        for row in parsed_rows:
            self._line_item(row)

    def _unparsed(self, raw: str) -> None:
        self.issues.append(
            Issue(
                code="unparsed_row",
                severity="warning",
                message=f"A statement row could not be read and was skipped: {raw!r}.",
            )
        )

    def _line_item(self, row: dict[str, str]) -> None:
        row_date = parse_date(row.get("date", ""))
        inclusive = parse_zar(row.get("inclusive", ""))
        if row_date is None or inclusive is None or not inclusive.has_cents:
            self._unparsed(row["raw"])
            # The line was there but not read, so no total built from the lines is confident.
            self.signed_lines.append(Decimal("NaN"))
            return
        self.signed_lines.append(inclusive.amount)
        if inclusive.amount == 0:
            return
        allocation, remarks = row.get("allocation", ""), row.get("remarks", "")
        description = " - ".join(part for part in (allocation, remarks) if part)
        confidence = _LABELLED
        exclusive, tax = parse_zar(row.get("exclusive", "")), parse_zar(row.get("tax", ""))
        if exclusive is None or tax is None or exclusive.amount + tax.amount != inclusive.amount:
            confidence = _AMBIGUOUS
            self.issues.append(
                Issue(
                    code="totals_do_not_reconcile",
                    severity="warning",
                    message=f"Exclusive plus tax does not equal the inclusive amount on the row "
                    f"{row['raw']!r}.",
                )
            )
        payment_like = PAYMENT_WORDS.search(description) is not None
        kind: LineItemKind
        if inclusive.amount < 0:
            kind = "payment" if payment_like else "credit"
        else:
            kind = "charge"
            if payment_like:
                # A positive amount described as a payment (a reversal?): a person decides.
                confidence = min(confidence, _AMBIGUOUS)
        self.items.append(
            LineItem(
                date=row_date,
                description=description,
                category=line_item_category(kind, description),
                kind=kind,
                amount=abs(inclusive.amount),
                confidence=confidence,
                flagged=confidence < flag_threshold("rental_charged"),
            )
        )

    def _totals(self) -> None:
        due = self._money_after("amount due")
        due_amount = due[0].amount if due and due[0] and due[0].has_cents else None
        due_raw = due[1] if due else ""
        due_reason = "not_parsed" if due and due_amount is None else None
        self._set("total_due", due_amount, due_raw, _LABELLED, due_reason)

        ageing = self._ageing()
        if due_amount is None:
            self._set("outstanding_balance", None, due_raw, 0, due_reason)
        elif ageing is not None and ageing == due_amount:
            self._set(
                "outstanding_balance",
                due_amount,
                due_raw,
                _LABELLED,
                "closing_balance_is_amount_due",
            )
        else:
            self._set(
                "outstanding_balance",
                due_amount,
                due_raw,
                _CLOSING_UNCONFIRMED,
                "closing_balance_is_amount_due",
            )
            if ageing is not None:
                self.issues.append(
                    Issue(
                        code="totals_do_not_reconcile",
                        severity="warning",
                        message=f"The ageing row adds up to {format_zar(ageing)}, but the amount "
                        f"due is {format_zar(due_amount)}.",
                        field="outstanding_balance",
                    )
                )

        opening = self.fields["opening_balance"].value
        arrears = self._money_after("arrears/prepaid")
        if arrears and arrears[0] is not None:
            self.details["arrears_prepaid"] = f"{arrears[0].amount:.2f}"
            if isinstance(opening, Decimal) and arrears[0].amount != opening:
                self._flag("opening_balance", "conflicting_values", 0.5)
                self.issues.append(
                    Issue(
                        code="conflicting_values",
                        severity="warning",
                        message=f"Balance B/f is {format_zar(opening)} but Arrears/Prepaid is "
                        f"{format_zar(arrears[0].amount)}.",
                        field="opening_balance",
                    )
                )

        month = self._money_after("current month charges")
        printed_month = month[0].amount if month and month[0] and month[0].has_cents else None
        if printed_month is not None:
            self.details["current_month_charges"] = f"{printed_month:.2f}"
        lines_total = sum(self.signed_lines, Decimal("0.00"))
        lines_read = not lines_total.is_nan()
        reconciled = (
            lines_read
            and printed_month is not None
            and lines_total == printed_month
            and isinstance(opening, Decimal)
            and due_amount is not None
            and (opening + lines_total).quantize(_CENT) == due_amount
        )
        if printed_month is not None and lines_read and lines_total != printed_month:
            self.issues.append(
                Issue(
                    code="totals_do_not_reconcile",
                    severity="error",
                    message=f"The line items add up to {format_zar(lines_total)}, but Current "
                    f"Month Charges shows {format_zar(printed_month)}.",
                    field="rental_charged",
                )
            )
        if (
            isinstance(opening, Decimal)
            and due_amount is not None
            and lines_read
            and (opening + lines_total).quantize(_CENT) != due_amount
        ):
            # The validator reports the mismatch against the closing balance; the amount due is
            # the same printed figure, so it is flagged with it.
            self._flag("total_due", "totals_do_not_reconcile")
        self._derived_totals(reconciled=reconciled)

    def _ageing(self) -> Decimal | None:
        total = Decimal("0.00")
        for label in _AGEING_LABELS:
            heading = self._heading(label)
            value = self._below(heading) if heading else None
            money = parse_zar(value.text) if value else None
            if money is None:
                return None
            self.details[f"ageing_{label.split()[0]}"] = f"{money.amount:.2f}"
            total += money.amount
        return total

    def _derived_totals(self, *, reconciled: bool) -> None:
        charges = [i for i in self.items if i.kind == "charge"]
        groups: dict[ExtractionFieldName, list[LineItem]] = {
            "rental_charged": [i for i in charges if i.category == "rental"],
            "additional_charges": [i for i in charges if i.category != "rental"],
            "payments_received": [i for i in self.items if i.kind == "payment"],
        }
        lowest = min((i.confidence for i in self.items), default=_LABELLED)
        for name, group in groups.items():
            total = sum((i.amount for i in group), Decimal("0.00"))
            raw = f"Sum of {len(group)} line item(s)" if group else "No matching line items"
            if not self.signed_lines and not reconciled:
                self._set(name, None, "", 0)
            elif reconciled:
                # Every line is accounted for by the printed Current Month Charges and the amount
                # due, so the sum (or zero) is what the statement says.
                confidence = min((i.confidence for i in group), default=lowest)
                self._set(name, total, raw, confidence, "summed_from_reconciled_line_items")
            else:
                reason = "derived_from_line_items" if group else "no_matching_line_items"
                self._set(name, total, raw, lowest * _DERIVED, reason)


def _month(text: str) -> tuple[date, date] | None:
    match = _MONTH_YEAR.match(text.strip())
    month = _MONTHS.get(match.group(1).lower()) if match else None
    if match is None or month is None:
        return None
    year = int(match.group(2))
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
