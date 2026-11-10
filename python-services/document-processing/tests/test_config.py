import logging
from collections.abc import Iterator

import pytest
from pydantic import ValidationError

from app.core.config import SILENT, Settings
from app.core.logging import configure_logging


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        # pino levels, as the Node apps read the same LOG_LEVEL.
        ("fatal", logging.CRITICAL),
        ("error", logging.ERROR),
        ("warn", logging.WARNING),
        ("info", logging.INFO),
        ("debug", logging.DEBUG),
        ("trace", logging.DEBUG),
        ("silent", SILENT),
        # Python's own names.
        ("CRITICAL", logging.CRITICAL),
        ("WARNING", logging.WARNING),
        ("DEBUG", logging.DEBUG),
        # Case and surrounding whitespace do not matter.
        ("Warn", logging.WARNING),
        (" TRACE ", logging.DEBUG),
    ],
)
def test_log_level_accepts_pino_and_python_names(value: str, expected: int) -> None:
    settings = Settings(log_level=value)
    assert settings.logging_level == expected
    assert settings.log_level == value.strip().lower()


@pytest.mark.parametrize("value", ["verbose", "", "notset", "10"])
def test_unknown_log_levels_are_rejected(value: str) -> None:
    with pytest.raises(ValidationError, match="unsupported LOG_LEVEL"):
        Settings(log_level=value)


def test_log_level_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_LEVEL", "warn")
    assert Settings().logging_level == logging.WARNING


@pytest.fixture
def restore_logging() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers[:] = handlers
    root.setLevel(level)


@pytest.mark.usefixtures("restore_logging")
def test_silent_logs_nothing_not_even_uvicorn_or_critical(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging(SILENT)
    logging.getLogger("uvicorn.access").info("GET /health")
    logging.getLogger("app").critical("boom")
    assert capsys.readouterr().err == ""


@pytest.mark.usefixtures("restore_logging")
def test_warn_level_filters_uvicorn_info(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(logging.WARNING)
    logging.getLogger("uvicorn.access").info("GET /health")
    logging.getLogger("app").warning("careful")
    lines = capsys.readouterr().err.splitlines()
    assert len(lines) == 1
    assert '"level": "warning"' in lines[0]
