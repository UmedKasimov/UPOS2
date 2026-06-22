"""Настройки рабочих мест в PostgreSQL (JSONB payload на workspace)."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from upos.db import session_scope
from upos.db_models import GlobalSetting, WorkspaceSetting
from upos.integrations import default_integration_settings
from upos.timezones import DEFAULT_WORKSPACE_TIMEZONE

logger = logging.getLogger(__name__)
_LEGACY_KEY = "app_settings"
DEFAULT_CURRENCIES = ["UZS", "USD", "RUB", "EUR"]
BASE_AVAILABLE_CURRENCIES = [
    "UZS",
    "USD",
    "RUB",
    "EUR",
    "KZT",
    "GBP",
    "CNY",
    "AED",
    "TRY",
    "CHF",
    "JPY",
    "KRW",
]

_OWNER_ID_RE = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
    re.I,
)


def _default() -> dict[str, Any]:
    return {
        "telegram_bot_token": "",
        "theme": "light",
        "timezone": DEFAULT_WORKSPACE_TIMEZONE,
        "usd_uzs_rate": "12000",
        "available_currencies": list(BASE_AVAILABLE_CURRENCIES),
        "enabled_currencies": list(DEFAULT_CURRENCIES),
        "integrations": default_integration_settings(),
    }


def _copy_data(data: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(data, ensure_ascii=False))


def _normalize_currency_codes(values: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    source = values if isinstance(values, list) else []
    for raw in source:
        code = str(raw or "").strip().upper()
        if len(code) != 3 or not code.isalpha() or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


def _normalize_currency_settings(data: dict[str, Any]) -> None:
    available = _normalize_currency_codes(data.get("available_currencies"))
    enabled = _normalize_currency_codes(data.get("enabled_currencies"))
    if not enabled:
        enabled = list(DEFAULT_CURRENCIES)
    merged_available = _normalize_currency_codes(
        list(BASE_AVAILABLE_CURRENCIES) + available + enabled
    )
    data["available_currencies"] = merged_available
    data["enabled_currencies"] = [
        code for code in enabled if code in set(merged_available)
    ] or [merged_available[0]]


def _merge_workspace_payload(raw: dict[str, Any]) -> dict[str, Any]:
    """Собирает настройки воркспейса: не даём частичному `integrations` затереть целые интеграции (Smartup/greenwhite и др.)."""
    if not isinstance(raw, dict):
        raw = {}
    defaults = _default()
    tmpl_int = defaults["integrations"]
    raw_int = raw.get("integrations") if isinstance(raw.get("integrations"), dict) else {}
    merged_int: dict[str, Any] = {}
    for name, block in tmpl_int.items():
        merged_block = dict(block)
        if name in raw_int and isinstance(raw_int[name], dict):
            merged_block.update(raw_int[name])
        merged_int[name] = merged_block
    merged: dict[str, Any] = dict(defaults)
    for key, val in raw.items():
        if key == "integrations":
            continue
        merged[key] = val
    merged["integrations"] = merged_int
    _normalize_currency_settings(merged)
    return merged


_PLACEHOLDER_BOT_TOKENS = frozenset({"test", "тест"})


def _sanitize_placeholder_bot_token(data: dict[str, Any]) -> bool:
    """Убирает заглушки вроде «Test» из сохранённого токена."""
    raw = data.get("telegram_bot_token")
    if raw is None:
        return False
    s = str(raw).strip()
    if not s or s.lower() not in _PLACEHOLDER_BOT_TOKENS:
        return False
    data["telegram_bot_token"] = ""
    return True


def load_legacy_settings() -> dict[str, Any]:
    """Глобальные настройки. Сейчас используются как источник темы для админ-панели."""
    with session_scope() as session:
        row = session.get(GlobalSetting, _LEGACY_KEY)
        if row is None:
            data = _default()
            session.add(GlobalSetting(key=_LEGACY_KEY, data=data))
            return _copy_data(data)
        raw = row.data if isinstance(row.data, dict) else {}
    base = _merge_workspace_payload(raw)
    if _sanitize_placeholder_bot_token(base):
        try:
            save_legacy_settings(base)
        except Exception:
            logger.exception("[upos] save_legacy_settings after token sanitize failed")
    return _copy_data(base)


def save_legacy_settings(data: dict[str, Any]) -> None:
    payload = _copy_data(data)
    with session_scope() as session:
        row = session.get(GlobalSetting, _LEGACY_KEY)
        if row is None:
            session.add(GlobalSetting(key=_LEGACY_KEY, data=payload))
        else:
            row.data = payload


def valid_workspace_owner_id(owner_id: str) -> bool:
    return bool(owner_id and _OWNER_ID_RE.match(owner_id.strip()))


def load_workspace_settings(workspace_owner_id: str) -> dict[str, Any]:
    """Настройки бизнеса: тема, интеграции и т.д. Привязаны к stable id владельца, не к логину."""
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        return _copy_data(_default())
    with session_scope() as session:
        row = session.get(WorkspaceSetting, oid)
        if row is None:
            base = _default()
            return _copy_data(base)
        raw = row.data if isinstance(row.data, dict) else {}
        base = _merge_workspace_payload(raw)
        if _sanitize_placeholder_bot_token(base):
            try:
                save_workspace_settings(oid, base)
            except Exception:
                logger.exception(
                    "[upos] save_workspace_settings after token sanitize failed; oid=%s",
                    oid,
                )
        return _copy_data(base)


def save_workspace_settings(workspace_owner_id: str, data: dict[str, Any]) -> None:
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        raise ValueError("invalid workspace_owner_id")
    payload = _copy_data(data)
    try:
        with session_scope() as session:
            row = session.get(WorkspaceSetting, oid)
            if row is None:
                session.add(WorkspaceSetting(workspace_owner_id=oid, data=payload))
            else:
                row.data = payload
    except IntegrityError as exc:
        raise ValueError("workspace owner does not exist") from exc


def delete_workspace_settings(workspace_owner_id: str) -> None:
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        return
    with session_scope() as session:
        session.execute(
            delete(WorkspaceSetting).where(WorkspaceSetting.workspace_owner_id == oid),
        )


# Обратная совместимость имён для постепенного перехода.
def load_settings() -> dict[str, Any]:
    return load_legacy_settings()


def save_settings(data: dict[str, Any]) -> None:
    save_legacy_settings(data)
