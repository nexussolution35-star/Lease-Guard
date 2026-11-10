from datetime import date
from decimal import Decimal

import pytest

from app.parsers.dates import parse_date, parse_period, split_leading_date
from app.parsers.money import format_zar, parse_zar, split_trailing_zar


@pytest.mark.parametrize(
    ("text", "amount", "has_cents"),
    [
        ("R 35 000,00", "35000.00", True),
        ("R35,000.00", "35000.00", True),
        ("(1 200,00)", "-1200.00", True),
        ("35 000.00 Cr", "-35000.00", True),
        ("R35 000.00 CR", "-35000.00", True),
        ("-R 1 200,00", "-1200.00", True),
        ("R\N{NO-BREAK SPACE}35\N{NARROW NO-BREAK SPACE}000,00", "35000.00", True),
        ("R 3 150,5", "3150.50", False),
        ("ZAR 35000", "35000.00", False),
        ("R1,200", "1200.00", False),
        ("35000.00", "35000.00", True),
        ("1 200,00 Dr", "1200.00", True),
    ],
)
def test_parses_south_african_amounts(text: str, amount: str, has_cents: bool) -> None:
    money = parse_zar(text)
    assert money is not None
    assert money.amount == Decimal(amount)
    assert money.has_cents is has_cents


@pytest.mark.parametrize("text", ["", "Shop 12", "INV-2026-001", "R", "Rental", "31 Oct 2026"])
def test_rejects_text_that_is_not_only_an_amount(text: str) -> None:
    assert parse_zar(text) is None


def test_rand_symbol_is_detected_but_cr_is_not_a_symbol() -> None:
    assert parse_zar("R 100,00").has_symbol  # type: ignore[union-attr]
    assert not parse_zar("100,00 Cr").has_symbol  # type: ignore[union-attr]


def test_splits_a_trailing_amount_from_its_label() -> None:
    assert split_trailing_zar("Rental October 2026 R 35 000,00") == (
        "Rental October 2026",
        parse_zar("R 35 000,00"),
    )
    assert split_trailing_zar("Unit 12 Shop") is None


def test_formats_like_the_domain_package() -> None:
    assert format_zar(Decimal("79950.5")) == "R 79 950,50"
    assert format_zar(Decimal("-1200")) == "-R 1 200,00"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("31 Oct 2026", date(2026, 10, 31)),
        ("31 October 2026", date(2026, 10, 31)),
        ("1st Sept 2026", date(2026, 9, 1)),
        ("31-Oct-2026", date(2026, 10, 31)),
        ("31/10/2026", date(2026, 10, 31)),
        ("2026-10-31", date(2026, 10, 31)),
    ],
)
def test_parses_statement_dates(text: str, expected: date) -> None:
    assert parse_date(text) == expected


@pytest.mark.parametrize("text", ["31 Feb 2026", "31/10/26", "10/31/2026", "Octember 2026"])
def test_does_not_guess_invalid_or_ambiguous_dates(text: str) -> None:
    assert parse_date(text) is None


def test_parses_periods() -> None:
    assert parse_period("01 Oct 2026 - 31 Oct 2026") == (
        date(2026, 10, 1),
        date(2026, 10, 31),
        False,
    )
    assert parse_period("1 October 2026 to 31 October 2026")[:2] == (  # type: ignore[index]
        date(2026, 10, 1),
        date(2026, 10, 31),
    )
    assert parse_period("February 2028") == (date(2028, 2, 1), date(2028, 2, 29), True)
    assert parse_period("Q4") is None


def test_splits_a_leading_date() -> None:
    assert split_leading_date("01 Oct 2026 Rental") == (date(2026, 10, 1), "Rental")
    assert split_leading_date("Rental 01 Oct 2026") is None
