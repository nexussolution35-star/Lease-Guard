"""South African rand amounts.

`parse_zar` follows the same decimal rule as `parseZAR` in packages/domain/src/rules/money.ts
(the canonical rule for the TypeScript apps): the last `,` or `.` is the decimal separator when
1-2 digits follow it or when both separators appear; every other separator groups thousands.
Brackets, a leading minus or a `Cr` suffix make the amount negative.
"""

import re
from dataclasses import dataclass
from decimal import Decimal

CENT = Decimal("0.01")
_NON_STANDARD_SPACES = re.compile("[\u00a0\u2007\u2009\u202f]")
_AMOUNT = (
    r"\(?\s*-?\s*(?:ZAR|R)?\s*-?\s*\d+(?:[ ,.]\d{3})*(?:[.,]\d{1,2})?\s*\)?"
    r"(?:\s*(?:CR|DR)\b)?"
)
_FULL_AMOUNT = re.compile(_AMOUNT, re.IGNORECASE)
_TRAILING_AMOUNT = re.compile(rf"(?<![\w,.]){_AMOUNT}$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Money:
    amount: Decimal
    """Signed amount rounded to cents."""
    has_cents: bool
    has_symbol: bool


def parse_zar(text: str) -> Money | None:
    """Parse a cell that contains only an amount. Returns None for anything else."""
    s = _NON_STANDARD_SPACES.sub(" ", text).strip()
    if not _FULL_AMOUNT.fullmatch(s):
        return None
    negative = False
    if s.startswith("(") and ")" in s:
        negative = True
    if re.search(r"\bCR\b", s, re.IGNORECASE) or re.match(r"(?:ZAR|R)?\s*-", s, re.IGNORECASE):
        negative = True
    cleaned = re.sub(r"[^0-9.,]", "", s)
    integer, fraction = cleaned, ""
    last_sep = max(cleaned.rfind(","), cleaned.rfind("."))
    if last_sep != -1:
        after = cleaned[last_sep + 1 :]
        if ("," in cleaned and "." in cleaned) or 1 <= len(after) <= 2:
            integer, fraction = cleaned[:last_sep], after
    integer = re.sub(r"[.,]", "", integer) or "0"
    amount = Decimal(f"{integer}.{fraction or '0'}").quantize(CENT)
    if negative and amount:
        amount = -amount
    has_symbol = re.match(r"\(?\s*-?\s*(?:ZAR|R)", s, re.IGNORECASE) is not None
    return Money(amount, has_cents=len(fraction) == 2, has_symbol=has_symbol)


def split_trailing_zar(text: str) -> tuple[str, Money] | None:
    """Split `"Rental October R 35 000,00"` into its text and the amount that ends it."""
    s = _NON_STANDARD_SPACES.sub(" ", text).strip()
    match = _TRAILING_AMOUNT.search(s)
    if match is None:
        return None
    money = parse_zar(match.group())
    return (s[: match.start()].strip(), money) if money else None


def format_zar(amount: Decimal) -> str:
    """`R 79 950,50` / `-R 1 200,00`, matching `formatZAR` in the domain package."""
    sign = "-" if amount < 0 else ""
    grouped = f"{abs(amount.quantize(CENT)):,.2f}".replace(",", " ").replace(".", ",")
    return f"{sign}R {grouped}"
