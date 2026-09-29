"""Short-lived in-memory cache for session user lookups in middleware."""

from __future__ import annotations

import os
import time
from threading import Lock
from typing import Any, Callable

_LOCK = Lock()
_ENTRIES: dict[str, tuple[float, dict[str, Any] | None]] = {}

_DEFAULT_TTL = max(15, int(os.getenv("UPOS_USER_CACHE_TTL", "45") or "45"))


def _ttl_seconds() -> int:
    return _DEFAULT_TTL


def get_cached(
    username: str,
    loader: Callable[[str], dict[str, Any] | None],
) -> dict[str, Any] | None:
    key = (username or "").strip().lower()
    if not key:
        return None
    now = time.monotonic()
    with _LOCK:
        entry = _ENTRIES.get(key)
        if entry is not None and now - entry[0] < _ttl_seconds():
            return entry[1]
    value = loader(username)
    with _LOCK:
        _ENTRIES[key] = (now, value)
    return value


def invalidate_username(username: str) -> None:
    key = (username or "").strip().lower()
    if not key:
        return
    with _LOCK:
        _ENTRIES.pop(key, None)


def clear_all() -> None:
    with _LOCK:
        _ENTRIES.clear()
