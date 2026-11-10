"""JSON-lines logging for the service and for uvicorn."""

import json
import logging
from datetime import UTC, datetime

# Attributes every LogRecord has (plus uvicorn's ANSI-coloured duplicate); anything else
# was passed through `extra=` and is logged.
_STANDARD_ATTRS = frozenset(vars(logging.makeLogRecord({}))) | {
    "message",
    "asctime",
    "color_message",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in vars(record).items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: int) -> None:
    """Send every log record, including uvicorn's, to stderr as JSON lines at `level`."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    # Propagated records skip ancestor logger levels, so the handler enforces the level too.
    handler.setLevel(level)
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Route uvicorn's own loggers through the same JSON handler, at the same level.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.setLevel(logging.NOTSET)
        uvicorn_logger.propagate = True
