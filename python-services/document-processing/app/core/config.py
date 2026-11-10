"""Service configuration, read from the repository-root `.env` and the process environment."""

import logging
from functools import lru_cache
from importlib.metadata import version
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENGINE_NAME = "leaseguard-document-processing"
ENGINE_VERSION = version(ENGINE_NAME)

SILENT = logging.CRITICAL + 1
"""Above every standard level, so nothing is logged."""

LOG_LEVELS: dict[str, int] = {
    # pino (the backend's logger): fatal, error, warn, info, debug, trace, silent.
    "fatal": logging.CRITICAL,
    "error": logging.ERROR,
    "warn": logging.WARNING,
    "info": logging.INFO,
    "debug": logging.DEBUG,
    "trace": logging.DEBUG,
    "silent": SILENT,
    # Python's own names.
    "critical": logging.CRITICAL,
    "warning": logging.WARNING,
}
"""Accepted `LOG_LEVEL` values (case-insensitive) and the `logging` level each one maps to."""


def _repo_root_env_file() -> Path | None:
    """Every LeaseGuard app reads the one `.env` at the repository root (see `.env.example`).

    Inside the container there is no repository, so settings come from the environment only.
    """
    for parent in Path(__file__).resolve().parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent / ".env"
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_repo_root_env_file(), env_file_encoding="utf-8", extra="ignore"
    )

    # Shared secret the backend sends as a bearer token. Empty means every request is refused.
    document_processing_token: SecretStr = SecretStr("")
    document_processing_max_file_mb: int = Field(default=20, gt=0, le=200)
    # Shared with the Node apps, so pino's names are accepted as well as Python's.
    log_level: str = "info"

    @field_validator("log_level")
    @classmethod
    def _known_level(cls, value: str) -> str:
        level = value.strip().lower()
        if level not in LOG_LEVELS:
            raise ValueError(
                f"unsupported LOG_LEVEL {value!r}; use one of {', '.join(sorted(LOG_LEVELS))}"
            )
        return level

    @property
    def logging_level(self) -> int:
        """`LOG_LEVEL` as a level for the standard `logging` module."""
        return LOG_LEVELS[self.log_level]

    @property
    def max_file_bytes(self) -> int:
        return self.document_processing_max_file_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
