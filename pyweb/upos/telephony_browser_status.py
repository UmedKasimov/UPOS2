"""Validate credential-free browser SIP diagnostics before logging them."""

from __future__ import annotations

import re


EVENTS = {"connecting", "registered", "registration_failed", "unregistered",
          "disconnected", "incoming", "heartbeat"}

def browser_status_event(event: object, status_code: object, cause: object) -> tuple[str, int, str]:
    clean_event = str(event or "").strip()
    if clean_event not in EVENTS:
        raise ValueError("invalid_event")
    try:
        code = int(status_code or 0)
    except (TypeError, ValueError):
        code = 0
    detail = re.sub(r"[\x00-\x1f\x7f]", " ", str(cause or "")).strip()[:100]
    return clean_event, code if 0 <= code <= 699 else 0, detail
