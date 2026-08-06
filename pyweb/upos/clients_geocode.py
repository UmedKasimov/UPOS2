"""Определение координат клиентов по адресу.

Адреса разбирает OpenStreetMap Nominatim. Его правила разрешают не больше
одного запроса в секунду, поэтому проход идёт медленно и в фоне: тысяча
адресов занимает около двадцати минут. Ход работы виден в настройках
рабочего пространства, чтобы страница могла его показывать.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from upos.db import session_scope
from upos.db_models import Counterparty
from upos.storage import load_workspace_settings, save_workspace_settings

logger = logging.getLogger("upos.geocode")

# Правило Nominatim: не чаще одного обращения в секунду.
REQUEST_INTERVAL_SECONDS = 1.1
PROGRESS_KEY = "clients_geocode"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _coordinate(value: Any, *, limit: float) -> str:
    try:
        number = float(str(value or "").strip())
    except (TypeError, ValueError):
        return ""
    if not (-limit <= number <= limit) or number == 0:
        return ""
    return f"{number:.6f}".rstrip("0").rstrip(".")


def geocode_address(address: str) -> tuple[str, str]:
    """Координаты по адресу. Пустой ответ означает, что адрес не найден."""
    query = str(address or "").strip()
    if not query:
        return "", ""
    url = "https://nominatim.openstreetmap.org/search?" + urlencode(
        {"format": "jsonv2", "limit": "1", "countrycodes": "uz,kz,kg,tj,tm", "q": query}
    )
    request = UrlRequest(
        url,
        headers={"Accept": "application/json", "User-Agent": "UPOS/2.0 client-location-geocoder"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8") or "[]")
    except Exception as exc:
        logger.info("[geocode] адрес не разобран: %s", exc)
        return "", ""
    if not isinstance(payload, list) or not payload:
        return "", ""
    first = payload[0] if isinstance(payload[0], dict) else {}
    return (
        _coordinate(first.get("lat"), limit=90),
        _coordinate(first.get("lon"), limit=180),
    )


def read_progress(workspace_owner_id: str) -> dict[str, Any]:
    data = load_workspace_settings(workspace_owner_id) or {}
    progress = data.get(PROGRESS_KEY)
    return dict(progress) if isinstance(progress, dict) else {}


def _save_progress(workspace_owner_id: str, progress: dict[str, Any]) -> None:
    try:
        data = load_workspace_settings(workspace_owner_id)
        data[PROGRESS_KEY] = progress
        save_workspace_settings(workspace_owner_id, data)
    except Exception:
        logger.warning("[geocode] не удалось записать ход работы", exc_info=True)


def clients_without_location(workspace_owner_id: str) -> list[tuple[str, str]]:
    """Клиенты, у которых есть адрес, но нет координат."""
    out: list[tuple[str, str]] = []
    with session_scope() as session:
        rows = session.execute(
            select(Counterparty).where(Counterparty.workspace_owner_id == workspace_owner_id)
        ).scalars().all()
        for row in rows:
            data = row.data if isinstance(row.data, dict) else {}
            if str(data.get("latitude") or "").strip() and str(data.get("longitude") or "").strip():
                continue
            address = str(data.get("address") or "").strip()
            if not address:
                continue
            out.append((str(row.id), address))
    return out


def is_running(workspace_owner_id: str) -> bool:
    progress = read_progress(workspace_owner_id)
    if progress.get("status") != "running":
        return False
    # Проход мог оборваться перезапуском сервера: считаем живым только тот,
    # который отчитывался в последние десять минут.
    beat = str(progress.get("heartbeat") or "")
    try:
        moment = datetime.fromisoformat(beat.replace("Z", "+00:00"))
    except ValueError:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return (datetime.now(UTC) - moment).total_seconds() < 600


def run_geocode(workspace_owner_id: str) -> dict[str, Any]:
    """Проходит по клиентам без координат и проставляет их."""
    targets = clients_without_location(workspace_owner_id)
    progress: dict[str, Any] = {
        "status": "running",
        "total": len(targets),
        "done": 0,
        "found": 0,
        "started_at": _now(),
        "heartbeat": _now(),
        "finished_at": "",
        "error": "",
    }
    _save_progress(workspace_owner_id, progress)
    if not targets:
        progress.update({"status": "ok", "finished_at": _now()})
        _save_progress(workspace_owner_id, progress)
        return progress

    found = 0
    try:
        for index, (client_id, address) in enumerate(targets, start=1):
            latitude, longitude = geocode_address(address)
            if latitude and longitude:
                with session_scope() as session:
                    row = session.get(Counterparty, client_id)
                    if row is not None and row.workspace_owner_id == workspace_owner_id:
                        data = dict(row.data if isinstance(row.data, dict) else {})
                        data["latitude"] = latitude
                        data["longitude"] = longitude
                        row.data = data
                        flag_modified(row, "data")
                        found += 1
            progress.update({"done": index, "found": found, "heartbeat": _now()})
            # Ход работы пишем не на каждом адресе, чтобы не дёргать базу.
            if index % 10 == 0 or index == len(targets):
                _save_progress(workspace_owner_id, progress)
            if index < len(targets):
                time.sleep(REQUEST_INTERVAL_SECONDS)
        progress.update({"status": "ok", "finished_at": _now()})
    except Exception as exc:
        progress.update({"status": "error", "error": str(exc) or "Сбой определения локаций", "finished_at": _now()})
        logger.exception("[geocode] проход прерван")
    _save_progress(workspace_owner_id, progress)
    return progress
