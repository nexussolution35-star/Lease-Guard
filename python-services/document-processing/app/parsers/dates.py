"""Dates as printed on South African statements: `31 Oct 2026`, `31 October 2026`,
`31/10/2026` (day first), `2026-10-31`. Two-digit years are ambiguous and never parsed."""

import calendar
import re
from datetime import date

_MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name}
_MONTHS |= {name.lower(): i for i, name in enumerate(calendar.month_abbr) if name}
_MONTHS["sept"] = 9

_TEXT_DATE = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?[\s/.-]+([A-Za-z]{3,9})\.?[\s/.,-]+(\d{4})\b")
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DAY_FIRST_DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
_MONTH_YEAR = re.compile(r"([A-Za-z]{3,9})\.?\s+(\d{4})")


def find_dates(text: str) -> list[tuple[date, int, int]]:
    """Every valid date in `text` as `(date, start, end)`, in reading order."""
    found: list[tuple[date, int, int]] = []
    for match in _TEXT_DATE.finditer(text):
        month = _MONTHS.get(match.group(2).lower())
        if month:
            _append(found, match, int(match.group(3)), month, int(match.group(1)))
    for match in _ISO_DATE.finditer(text):
        _append(found, match, int(match.group(1)), int(match.group(2)), int(match.group(3)))
    for match in _DAY_FIRST_DATE.finditer(text):
        _append(found, match, int(match.group(3)), int(match.group(2)), int(match.group(1)))
    return sorted(found, key=lambda item: item[1])


def _append(
    found: list[tuple[date, int, int]], match: re.Match[str], y: int, m: int, d: int
) -> None:
    try:
        found.append((date(y, m, d), match.start(), match.end()))
    except ValueError:
        return


def parse_date(text: str) -> date | None:
    dates = find_dates(text)
    return dates[0][0] if dates else None


def split_leading_date(text: str) -> tuple[date, str] | None:
    """`"01 Oct 2026 Rental"` -> `(date(2026, 10, 1), "Rental")`; None if no leading date."""
    stripped = text.strip()
    dates = find_dates(stripped)
    if not dates or dates[0][1] != 0:
        return None
    return dates[0][0], stripped[dates[0][2] :].strip()


def parse_period(text: str) -> tuple[date, date, bool] | None:
    """`(start, end, from_month_label)`. A bare `October 2026` covers that calendar month."""
    dates = find_dates(text)
    if len(dates) >= 2:
        return dates[0][0], dates[1][0], False
    match = _MONTH_YEAR.fullmatch(text.strip())
    month = _MONTHS.get(match.group(1).lower()) if match else None
    if match is None or month is None:
        return None
    year = int(match.group(2))
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1]), True
