"""Statement extraction pipeline: read the PDF, parse it, validate it, score it.

The service only reports what the document says. It never stores records; the backend decides
what to do with the result after a person has reviewed it.
"""

import re
from dataclasses import dataclass
from datetime import date

from app.core.config import ENGINE_NAME, ENGINE_VERSION
from app.extractors.pdf import DocumentContent, read_document
from app.parsers.statement import (
    ALWAYS_REVIEW_REASONS,
    FINANCIAL_FLAG_BELOW,
    ParsedStatement,
    flag_threshold,
    parse_statement,
)
from app.schemas.v1 import (
    EXTRACTION_FIELD_NAMES,
    FINANCIAL_FIELD_NAMES,
    ExtractedField,
    ExtractionResult,
    ExtractionStatus,
    Issue,
    LineItem,
)
from app.validators.statement import validate_statement

ERROR_CONFIDENCE_CAP = 0.5
"""Overall confidence never exceeds this while an error-level issue is open."""


@dataclass(frozen=True, slots=True)
class Hints:
    """Tenant names and unit numbers the backend expects for this property (optional)."""

    tenant_names: tuple[str, ...] = ()
    unit_numbers: tuple[str, ...] = ()


def extract_statement(
    data: bytes, *, hints: Hints, ocr_available: bool, today: date
) -> ExtractionResult:
    document = read_document(data, ocr_available=ocr_available)
    issues = _readability_issues(document)
    if not any(page.lines for page in document.pages):
        return _failed(document, issues)

    parsed = parse_statement(document)
    issues.extend(parsed.issues)
    if not parsed.found_anything:
        issues.append(
            Issue(
                code="unsupported_layout",
                severity="error",
                message="No statement labels or transaction rows were recognised in this layout.",
            )
        )
        return _failed(document, issues)

    _check_hint(parsed.fields["tenant_name"], hints.tenant_names, issues, unit=False)
    _check_hint(parsed.fields["unit_number"], hints.unit_numbers, issues, unit=True)
    issues.extend(validate_statement(parsed, today=today))
    issues.extend(_low_confidence(parsed))

    fields = [parsed.fields[name] for name in EXTRACTION_FIELD_NAMES]
    overall = sum(f.confidence for f in fields) / len(fields)
    if any(i.severity == "error" for i in issues):
        overall = min(overall, ERROR_CONFIDENCE_CAP)
    return ExtractionResult(
        engine=ENGINE_NAME,
        engine_version=ENGINE_VERSION,
        page_count=len(document.pages),
        text_layer=document.text_layer,
        ocr_used=document.ocr_used,
        opening_balance=parsed.opening_balance,
        fields=fields,
        line_items=parsed.line_items,
        overall_confidence=round(overall, 2),
        issues=issues,
        status=review_status(fields, parsed.line_items, issues),
    )


def review_status(
    fields: list[ExtractedField], line_items: list[LineItem], issues: list[Issue]
) -> ExtractionStatus:
    """`extracted` only when nothing is open: no issue, no flagged value or line item, and every
    rand amount read from the document with full confidence. A rand amount that is missing,
    flagged, derived or low-confidence is never passed as `extracted`."""
    financial_uncertain = any(
        f.value is None or f.flagged or f.confidence < FINANCIAL_FLAG_BELOW
        for f in fields
        if f.name in FINANCIAL_FIELD_NAMES
    )
    if (
        issues
        or financial_uncertain
        or any(f.flagged for f in fields)
        or any(item.flagged for item in line_items)
    ):
        return "needs_review"
    return "extracted"


def _readability_issues(document: DocumentContent) -> list[Issue]:
    issues: list[Issue] = []
    unreadable = document.unreadable_pages
    if unreadable:
        every_page = len(unreadable) == len(document.pages)
        issues.append(
            Issue(
                code="scanned_without_ocr",
                severity="error" if every_page else "warning",
                message=f"Page(s) {', '.join(map(str, unreadable))} have no text layer and OCR is "
                "not available on this server, so they were not read.",
            )
        )
    if document.ocr_used:
        issues.append(
            Issue(
                code="ocr_used",
                severity="warning",
                message="Some pages were read with OCR; check every value against the PDF.",
            )
        )
    return issues


def _failed(document: DocumentContent, issues: list[Issue]) -> ExtractionResult:
    return ExtractionResult(
        engine=ENGINE_NAME,
        engine_version=ENGINE_VERSION,
        page_count=len(document.pages),
        text_layer=document.text_layer,
        ocr_used=document.ocr_used,
        opening_balance=None,
        fields=[
            ExtractedField(
                name=name, raw_text="", value=None, confidence=0.0, flagged=True, reason="not_read"
            )
            for name in EXTRACTION_FIELD_NAMES
        ],
        line_items=[],
        overall_confidence=0.0,
        issues=issues,
        status="failed",
    )


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _matches(value: str, hint: str, *, unit: bool) -> bool:
    wanted = _normalise(hint)
    if not wanted:
        return False
    if _normalise(value) == wanted:
        return True
    # "Shop 12" matches the unit hint "12".
    tokens = re.findall(r"[a-z0-9]+", value.lower())
    return unit and bool(tokens) and tokens[-1] == wanted


def _check_hint(
    extracted: ExtractedField, hints: tuple[str, ...], issues: list[Issue], *, unit: bool
) -> None:
    if not hints or not isinstance(extracted.value, str):
        return
    if any(_matches(extracted.value, hint, unit=unit) for hint in hints):
        if extracted.reason != "conflicting_values":
            extracted.confidence = max(extracted.confidence, 0.95)
            extracted.flagged = extracted.confidence < flag_threshold(extracted.name)
            extracted.reason = "matched_expected_value"
        return
    extracted.flagged = True
    extracted.reason = "not_in_expected_values"
    issues.append(
        Issue(
            code="hint_mismatch",
            severity="warning",
            message=f"{extracted.name.replace('_', ' ').capitalize()} {extracted.value!r} is not "
            "one of the expected values for this property.",
            field=extracted.name,
        )
    )


def _low_confidence(parsed: ParsedStatement) -> list[Issue]:
    issues = [
        Issue(
            code="low_confidence",
            severity="warning",
            message=f"{f.name.replace('_', ' ').capitalize()} was read with low confidence "
            f"({f.confidence:.0%}).",
            field=f.name,
        )
        for f in parsed.fields.values()
        # Derived and conflicting values are already flagged with their own reason.
        if f.value is not None
        and f.confidence < flag_threshold(f.name)
        and f.reason not in ALWAYS_REVIEW_REASONS
    ]
    opening = parsed.opening_balance_confidence
    if opening is not None and opening < FINANCIAL_FLAG_BELOW:
        # The opening balance has no field of its own, but totals are reconciled against it.
        issues.append(
            Issue(
                code="low_confidence",
                severity="warning",
                message=f"The opening balance was read with low confidence ({opening:.0%}).",
            )
        )
    flagged_items = sum(1 for item in parsed.line_items if item.flagged)
    if flagged_items:
        issues.append(
            Issue(
                code="low_confidence",
                severity="warning",
                message=f"{flagged_items} line item(s) need checking against the PDF.",
            )
        )
    return issues
