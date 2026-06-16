"""Пути legacy JSON-данных: используются только одноразовой миграцией в PostgreSQL."""

from __future__ import annotations

import os
from pathlib import Path


def get_data_dir() -> Path:
    raw = (os.environ.get("UPOS_DATA_DIR") or "").strip()
    if raw:
        p = Path(raw).expanduser().resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p
    return Path(__file__).resolve().parents[1] / "data"
