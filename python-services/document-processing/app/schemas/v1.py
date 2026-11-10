"""Version 1 of the document-processing API contract.

The authoritative definition is the TypeScript wire contract in
`packages/domain/src/types/extraction.ts` (with the shared enumerations in
`packages/domain/src/types/statement.ts`). `tests/test_project_consistency.py` parses both files
and fails if any enumeration, property name or nullability here drifts from them.

Python attributes are snake_case; JSON is camelCase. Every model derives its JSON names with
`to_camel`, accepts either form when constructed in Python, and always serialises by alias.
Nullable properties are always present in the JSON (as `null` when absent), never omitted.

Money is a `Decimal` with exactly two decimal places, serialised in JSON as a string
(`"35000.00"`) so no precision is lost. Positive amounts are rands owed by the tenant; a negative
`openingBalance` or `outstandingBalance` is a credit balance.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer
from pydantic.alias_generators import to_camel
from pydantic.fields import ComputedFieldInfo, FieldInfo

StatementSource = Literal["MRI", "MDA", "PropSys", "Sage", "other"]
ExtractionFieldName = Literal[
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
FinancialFieldName = Literal[
    "rental_charged",
    "additional_charges",
    "payments_received",
    "outstanding_balance",
    "total_due",
]
LineItemCategory = Literal[
    "rental",
    "operating_costs",
    "rates_and_taxes",
    "utilities",
    "parking",
    "marketing_levy",
    "interest",
    "other_charge",
    "payment",
    "credit",
]
LineItemKind = Literal["charge", "payment", "credit"]
IssueCode = Literal[
    "missing_field",
    "low_confidence",
    "totals_do_not_reconcile",
    "cannot_reconcile",
    "invalid_period",
    "statement_date_out_of_range",
    "negative_amount",
    "duplicate_line_item",
    "conflicting_values",
    "unparsed_row",
    "hint_mismatch",
    "unsupported_layout",
    "scanned_without_ocr",
    "ocr_used",
]
IssueSeverity = Literal["error", "warning"]
ExtractionStatus = Literal["extracted", "needs_review", "failed"]
ErrorCode = Literal[
    "invalid_request",
    "missing_token",
    "invalid_token",
    "auth_not_configured",
    "file_too_large",
    "unsupported_media_type",
    "encrypted_pdf",
    "corrupt_pdf",
    "empty_pdf",
    "not_found",
    "method_not_allowed",
    "internal_error",
]

EXTRACTION_FIELD_NAMES: tuple[ExtractionFieldName, ...] = get_args(ExtractionFieldName)
FINANCIAL_FIELD_NAMES: tuple[FinancialFieldName, ...] = get_args(FinancialFieldName)
"""Fields whose values are rand amounts (`FINANCIAL_EXTRACTION_FIELDS` in the domain package)."""

ZAR_DECIMAL_PATTERN = r"^-?\d{1,13}\.\d{2}$"
"""Wire format of money; the same pattern `parseZarDecimal` accepts in the domain package."""

Confidence = Annotated[float, Field(ge=0, le=1)]
Rand = Annotated[
    Decimal,
    Field(max_digits=15, decimal_places=2),
    PlainSerializer(
        lambda amount: f"{amount:.2f}",
        return_type=Annotated[str, Field(pattern=ZAR_DECIMAL_PATTERN)],
        when_used="json",
    ),
]


def _title(name: str, _: FieldInfo | ComputedFieldInfo) -> str:
    return name.replace("_", " ").title()


class WireModel(BaseModel):
    """Base for every JSON body: snake_case attributes, camelCase JSON, nulls always present."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        field_title_generator=_title,
        # Fields with a default (`None`) are still always serialised, so OpenAPI marks them
        # required in responses, matching the non-optional TypeScript properties.
        json_schema_serialization_defaults_required=True,
    )


class ExtractedField(WireModel):
    name: ExtractionFieldName
    raw_text: str = Field(description="The document text the value was read from; empty if none.")
    value: str | Rand | None = Field(
        description="Names and unit numbers as text, dates as ISO `YYYY-MM-DD`, money as a "
        "2-decimal string. `null` when the value was not found; it is never guessed."
    )
    confidence: Confidence
    flagged: bool = Field(description="True when a person must check this value.")
    reason: str | None = Field(default=None, description="Why the value is flagged or derived.")


class LineItem(WireModel):
    date: date
    description: str
    category: LineItemCategory
    kind: LineItemKind
    amount: Rand = Field(gt=0, description="Always positive; `kind` gives the direction.")
    confidence: Confidence
    flagged: bool


class Issue(WireModel):
    code: IssueCode
    severity: IssueSeverity
    message: str
    field: ExtractionFieldName | None = None


class ExtractionResult(WireModel):
    engine: str
    engine_version: str
    page_count: int = Field(ge=1)
    text_layer: bool = Field(description="True when every page has a text layer.")
    ocr_used: bool
    opening_balance: Rand | None = Field(
        description="Balance brought forward, used to reconcile totals. `null` if not found."
    )
    fields: list[ExtractedField] = Field(description="Exactly one entry per extraction field.")
    line_items: list[LineItem]
    overall_confidence: Confidence
    issues: list[Issue]
    status: ExtractionStatus


class ErrorResponse(WireModel):
    code: ErrorCode
    message: str
    errors: list[dict[str, Any]] | None = Field(
        default=None, description="Per-field details for `invalid_request`; otherwise `null`."
    )


class Health(WireModel):
    status: Literal["ok"]


class Readiness(WireModel):
    status: Literal["ready", "not_ready"]
    auth_configured: bool
    ocr_available: bool
    tesseract_version: str | None
