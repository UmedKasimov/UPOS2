"""Учёт сессий входа по устройствам (владелец аккаунта)."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from upos.db import session_scope
from upos.db_models import UserAuthSession

ONLINE_WINDOW = timedelta(minutes=5)
_TOUCH_THROTTLE = timedelta(seconds=55)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _client_ip(request: Any) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    if request.client and request.client.host:
        return str(request.client.host)[:64]
    return ""


def _geo_label_from_request(request: Any) -> str:
    for key in ("cf-ipcountry", "x-vercel-ip-country", "x-appengine-country"):
        val = (request.headers.get(key) or "").strip()
        if val and val.upper() not in {"XX", "T1"}:
            return val.upper()[:80]
    city = (request.headers.get("cf-ipcity") or request.headers.get("x-vercel-ip-city") or "").strip()
    country = (request.headers.get("cf-ipcountry") or "").strip()
    if city and country:
        return f"{city}, {country}"[:120]
    return ""


def parse_user_agent(ua: str) -> dict[str, str]:
    raw = (ua or "").strip()[:512]
    low = raw.lower()
    os_family = "unknown"
    device_type = "desktop"
    if "android" in low:
        os_family = "android"
        device_type = "mobile"
    elif "iphone" in low or "ipad" in low or "ipod" in low:
        os_family = "ios"
        device_type = "mobile" if "iphone" in low or "ipod" in low else "tablet"
    elif "windows" in low:
        os_family = "windows"
    elif "mac os" in low or "macintosh" in low:
        os_family = "mac"
    elif "linux" in low:
        os_family = "linux"

    browser = "browser"
    if "edg/" in low or "edge/" in low:
        browser = "Edge"
    elif "chrome/" in low and "chromium" not in low:
        browser = "Chrome"
    elif "firefox/" in low:
        browser = "Firefox"
    elif "safari/" in low and "chrome" not in low:
        browser = "Safari"
    elif "opr/" in low or "opera" in low:
        browser = "Opera"

    os_label = {
        "windows": "Windows",
        "android": "Android",
        "ios": "iOS",
        "mac": "macOS",
        "linux": "Linux",
    }.get(os_family, "Unknown")
    device_label = f"{browser} · {os_label}"
    if device_type == "mobile" and os_family in {"android", "ios"}:
        m = re.search(r"\(([^)]+)\)", raw)
        if m:
            hint = m.group(1).split(";")[0].strip()
            if hint and len(hint) < 40:
                device_label = f"{browser} · {hint}"

    return {
        "user_agent": raw,
        "device_label": device_label[:160],
        "os_family": os_family,
        "browser_family": browser[:40],
        "device_type": device_type,
    }


def _session_row_to_dict(row: UserAuthSession, *, current_id: str | None) -> dict[str, Any]:
    now = _utcnow()
    online = row.last_seen_at and (now - row.last_seen_at) <= ONLINE_WINDOW
    revoked = row.revoked_at is not None
    blocked = row.blocked_at is not None
    return {
        "id": row.id,
        "user_id": row.user_id,
        "device_label": row.device_label,
        "os_family": row.os_family,
        "browser_family": row.browser_family,
        "device_type": row.device_type,
        "ip_address": row.ip_address or "",
        "geo_label": row.geo_label or "",
        "client_meta": row.client_meta if isinstance(row.client_meta, dict) else {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "blocked_at": row.blocked_at.isoformat() if row.blocked_at else None,
        "is_online": bool(online and not revoked and not blocked),
        "is_current": row.id == current_id,
        "is_revoked": revoked,
        "is_blocked": blocked,
    }


def create_auth_session(user_id: str, request: Any) -> str:
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("user_id required")
    ua_info = parse_user_agent(request.headers.get("user-agent") or "")
    now = _utcnow()
    sid = str(uuid.uuid4())
    with session_scope() as session:
        row = UserAuthSession(
            id=sid,
            user_id=uid,
            user_agent=ua_info["user_agent"],
            device_label=ua_info["device_label"],
            os_family=ua_info["os_family"],
            browser_family=ua_info["browser_family"],
            device_type=ua_info["device_type"],
            ip_address=_client_ip(request),
            geo_label=_geo_label_from_request(request),
            client_meta={},
            created_at=now,
            last_seen_at=now,
        )
        session.add(row)
        session.flush()
    return sid


def get_auth_session(session_id: str) -> UserAuthSession | None:
    sid = str(session_id or "").strip()
    if not sid:
        return None
    with session_scope() as session:
        return session.get(UserAuthSession, sid)


def validate_auth_session(session_id: str, user_id: str) -> tuple[bool, str | None]:
    """Возвращает (ok, reason) где reason: revoked | blocked | missing."""
    row = get_auth_session(session_id)
    if not row or row.user_id != user_id:
        return False, "missing"
    if row.blocked_at is not None:
        return False, "blocked"
    if row.revoked_at is not None:
        return False, "revoked"
    return True, None


def touch_auth_session(
    session_id: str,
    user_id: str,
    *,
    client_meta: dict[str, Any] | None = None,
) -> bool:
    sid = str(session_id or "").strip()
    uid = str(user_id or "").strip()
    if not sid or not uid:
        return False
    now = _utcnow()
    with session_scope() as session:
        row = session.get(UserAuthSession, sid)
        if not row or row.user_id != uid:
            return False
        if row.revoked_at or row.blocked_at:
            return False
        if row.last_seen_at and (now - row.last_seen_at) < _TOUCH_THROTTLE:
            return True
        row.last_seen_at = now
        if client_meta:
            merged = dict(row.client_meta or {})
            merged.update(client_meta)
            row.client_meta = merged
        session.flush()
    return True


def list_user_devices(user_id: str, *, current_session_id: str | None) -> list[dict[str, Any]]:
    uid = str(user_id or "").strip()
    if not uid:
        return []
    with session_scope() as session:
        rows = session.scalars(
            select(UserAuthSession)
            .where(UserAuthSession.user_id == uid)
            .order_by(UserAuthSession.last_seen_at.desc()),
        ).all()
        return [_session_row_to_dict(r, current_id=current_session_id) for r in rows]


def revoke_auth_session(user_id: str, session_id: str) -> bool:
    uid = str(user_id or "").strip()
    sid = str(session_id or "").strip()
    if not uid or not sid:
        return False
    now = _utcnow()
    with session_scope() as session:
        row = session.get(UserAuthSession, sid)
        if not row or row.user_id != uid:
            return False
        if row.revoked_at is None:
            row.revoked_at = now
            session.flush()
        return True


def block_auth_session(user_id: str, session_id: str) -> bool:
    uid = str(user_id or "").strip()
    sid = str(session_id or "").strip()
    if not uid or not sid:
        return False
    now = _utcnow()
    with session_scope() as session:
        row = session.get(UserAuthSession, sid)
        if not row or row.user_id != uid:
            return False
        row.blocked_at = now
        if row.revoked_at is None:
            row.revoked_at = now
        session.flush()
        return True


def ensure_auth_session_for_user(user_id: str, request: Any, existing_id: str | None) -> str:
    """Если в cookie нет валидной сессии — создаёт новую."""
    uid = str(user_id or "").strip()
    sid = str(existing_id or "").strip()
    if sid:
        ok, _ = validate_auth_session(sid, uid)
        if ok:
            touch_auth_session(sid, uid)
            return sid
    return create_auth_session(uid, request)
