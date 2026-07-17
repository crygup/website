"""Shared, redacted logging configuration for the website services."""

from __future__ import annotations

import logging
import os
import re
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path

_DEFAULT_LOG_PATH = Path(__file__).resolve().parents[1] / "logs" / "website.log"
LOG_PATH = Path(os.environ.get("WEBSITE_LOG_PATH", _DEFAULT_LOG_PATH))
_MAX_BYTES = 10 * 1024 * 1024
_BACKUP_COUNT = 5
_SENSITIVE_PARAMETER = re.compile(
    r"(?i)((?:token|state|code|access_token|refresh_token|authorization|api[_-]?key|secret)=)[^&\s]+"
)
_BEARER_TOKEN = re.compile(r"(?i)(bearer\s+)[^\s,]+")


def _redact(value: str) -> str:
    value = _SENSITIVE_PARAMETER.sub(r"\1[REDACTED]", value)
    return _BEARER_TOKEN.sub(r"\1[REDACTED]", value)


class RedactFilter(logging.Filter):
    """Prevent credentials in exception text or diagnostics reaching the log."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact(record.getMessage())
        record.args = ()
        if record.exc_info:
            record.exc_text = _redact(
                "".join(traceback.format_exception(*record.exc_info))
            )
            record.exc_info = None
        return True


class PrivateRotatingFileHandler(RotatingFileHandler):
    """Rotating handler that keeps newly-created files private as well."""

    def _open(self):
        stream = super()._open()
        try:
            os.chmod(self.baseFilename, 0o640)
        except OSError:
            pass
        return stream


def get_logger(component: str) -> logging.Logger:
    """Return a component logger writing to the private rotating website log."""
    logger = logging.getLogger(f"website.{component}")
    if logger.handlers:
        return logger

    LOG_PATH.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    # Create the file with a private mode before the handler opens it.
    LOG_PATH.touch(mode=0o640, exist_ok=True)
    handler = PrivateRotatingFileHandler(
        LOG_PATH,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    handler.addFilter(RedactFilter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger
