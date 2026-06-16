"""Storage helpers for Telegram bot config, chats and subscribers."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from upos.db import session_scope
from upos.db_models import (
    TelegramBotConfig,
    TelegramChat,
    TelegramDeliveryLog,
    TelegramSubscriber,
    User,
)
from upos.storage import load_workspace_settings, save_workspace_settings, valid_workspace_owner_id
from upos.telegram_events import hub

logger = logging.getLogger(__name__)

_SUBSCRIBER_STATUSES = frozenset({"pending", "approved", "rejected", "disabled"})

DEFAULT_NOTIFICATION_PREFS: dict[str, Any] = {
    "reports": {
        "transactions": True,
        "orders_telegram": True,
        "orders": True,
        "shipments": True,
        "returns": True,
        "purchases": True,
        "supplier_orders": True,
        "supplier_returns": True,
        "income": True,
        "courier_payment": True,
        "expense": True,
        "limits": True,
        "transaction_deleted": True,
        "transfer": True,
        "hr_attendance": True,
        "daily": True,
        "weekly": False,
        "monthly": False,
        "balance": False,
    },
    "targets": {
        "transactions": "",
        "orders_telegram": "",
        "orders": "",
        "shipments": "",
        "returns": "",
        "purchases": "",
        "supplier_orders": "",
        "supplier_returns": "",
        "income": "",
        "courier_payment": "",
        "expense": "",
        "limits": "",
        "transaction_deleted": "",
        "transfer": "",
        "hr_attendance": "",
        "daily": "",
        "weekly": "",
        "monthly": "",
        "balance": "",
    },
    "schedule": {
        "daily_hour": 21,
    },
    "templates": {
        "transactions": "{text}",
        "income": "{text}",
        "courier_payment": (
            "🚚 <b>ПОСТУПЛЕНИЕ ДЕНЕГ ОТ ДОСТАВЩИКА</b>\n"
            "Организация: {organization}\n"
            "Дата и время: {date} {time}\n\n"
            "<b>{courier_name}</b> (операция №{number})\n"
            "<pre>{courier_table}</pre>"
        ),
        "expense": "{text}",
        "limits": "{text}",
        "transaction_deleted": "{text}",
        "transfer": "{text}",
        "hr_attendance": (
            "🧾 <b>ДНЕВНОЙ ТАБЕЛЬ</b>\n"
            "Организация: {organization}\n"
            "Дата: {date}\n\n"
            "{text}\n\n"
            "<b>Кто пришёл</b>\n"
            "{present_list}\n\n"
            "<b>Кто не пришёл и причина</b>\n"
            "{absent_list}"
        ),
        "daily": (
            "🧾 <b>КАССОВЫЙ ОТЧЁТ</b>\n"
            "Организация: {organization}\n"
            "Дата формирования: {date} {time}\n\n"
            "{text}\n\n"
            "Нажмите кнопку ниже, чтобы посмотреть остатки по счетам организации."
        ),
        "weekly": "{text}",
        "monthly": "{text}",
        "balance": (
            "🏦 <b>ОСТАТКИ ПО СЧЕТАМ</b>\n"
            "Организация: {organization}\n"
            "Дата формирования: {date} {time}\n\n"
            "{text}"
        ),
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def mask_token(token: str) -> str:
    token = (token or "").strip()
    if not token:
        return ""
    if ":" in token:
        prefix, _ = token.split(":", 1)
        return f"{prefix}:••••••••"
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}••••{token[-2:]}"


def _chat_row_to_dict(row: TelegramChat) -> dict[str, Any]:
    return {
        "id": row.id,
        "chat_id": int(row.chat_id),
        "chat_type": row.chat_type,
        "title": row.title,
        "bot_is_admin": bool(row.bot_is_admin),
        "is_enabled": bool(row.is_enabled),
        "discovered_at": row.discovered_at.isoformat() if row.discovered_at else None,
        "last_seen_at": row.last_seen_at.isoformat() if row.last_seen_at else None,
    }


def _subscriber_row_to_dict(row: TelegramSubscriber) -> dict[str, Any]:
    return {
        "id": row.id,
        "telegram_user_id": int(row.telegram_user_id),
        "chat_id": int(row.chat_id),
        "display_name": row.display_name,
        "username": row.username,
        "phone": row.phone,
        "status": row.status,
        "requested_at": row.requested_at.isoformat() if row.requested_at else None,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
        "decided_by_user_id": row.decided_by_user_id,
    }


def merge_notification_prefs(raw: dict[str, Any] | None) -> dict[str, Any]:
    base = {
        "reports": dict(DEFAULT_NOTIFICATION_PREFS["reports"]),
        "targets": dict(DEFAULT_NOTIFICATION_PREFS["targets"]),
        "schedule": dict(DEFAULT_NOTIFICATION_PREFS["schedule"]),
        "templates": dict(DEFAULT_NOTIFICATION_PREFS["templates"]),
        "limits": {
            "enabled": False,
            "income": {"enabled": True, "amount": ""},
            "expense": {"enabled": True, "amount": ""},
        },
    }
    if not isinstance(raw, dict):
        return base
    reports_in = raw.get("reports")
    if isinstance(reports_in, dict):
        for key in base["reports"]:
            if key in reports_in:
                base["reports"][key] = bool(reports_in[key])
    targets_in = raw.get("targets")
    if isinstance(targets_in, dict):
        for key in base["targets"]:
            if key in targets_in:
                base["targets"][key] = str(targets_in[key] or "").strip()
    schedule_in = raw.get("schedule")
    if isinstance(schedule_in, dict) and "daily_hour" in schedule_in:
        try:
            hour = int(schedule_in["daily_hour"])
            base["schedule"]["daily_hour"] = max(0, min(23, hour))
        except (TypeError, ValueError):
            pass
    templates_in = raw.get("templates")
    if isinstance(templates_in, dict):
        for key in base["templates"]:
            if key in templates_in:
                value = str(templates_in[key] or "").strip()
                default_value = str(DEFAULT_NOTIFICATION_PREFS["templates"].get(key) or "{text}")
                if value == "{text}" and default_value != "{text}":
                    base["templates"][key] = default_value[:2000]
                else:
                    base["templates"][key] = value[:2000] if value else default_value[:2000]
    limits_in = raw.get("limits")
    if isinstance(limits_in, dict):
        base["limits"]["enabled"] = bool(limits_in.get("enabled", base["limits"]["enabled"]))
        for key in ("income", "expense"):
            rule_in = limits_in.get(key)
            if not isinstance(rule_in, dict):
                continue
            base["limits"][key]["enabled"] = bool(rule_in.get("enabled", base["limits"][key]["enabled"]))
            base["limits"][key]["amount"] = str(rule_in.get("amount") or "").strip()[:32]
    return base


def get_notification_prefs(workspace_owner_id: str) -> dict[str, Any]:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.get(TelegramBotConfig, wid)
        if row is None:
            return merge_notification_prefs(None)
        raw = row.notification_prefs if isinstance(row.notification_prefs, dict) else {}
        return merge_notification_prefs(raw)


def save_notification_prefs(workspace_owner_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    wid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(wid):
        raise ValueError("invalid workspace")
    with session_scope() as session:
        row = session.get(TelegramBotConfig, wid)
        if row is None or not (row.bot_token or "").strip():
            raise ValueError("not_connected")
        current = merge_notification_prefs(row.notification_prefs if isinstance(row.notification_prefs, dict) else {})
        reports_patch = patch.get("reports") if isinstance(patch.get("reports"), dict) else {}
        for key in current["reports"]:
            if key in reports_patch:
                current["reports"][key] = bool(reports_patch[key])
        targets_patch = patch.get("targets") if isinstance(patch.get("targets"), dict) else {}
        for key in current["targets"]:
            if key in targets_patch:
                current["targets"][key] = str(targets_patch[key] or "").strip()
        schedule_patch = patch.get("schedule") if isinstance(patch.get("schedule"), dict) else {}
        if "daily_hour" in schedule_patch:
            try:
                hour = int(schedule_patch["daily_hour"])
                current["schedule"]["daily_hour"] = max(0, min(23, hour))
            except (TypeError, ValueError):
                pass
        templates_patch = patch.get("templates") if isinstance(patch.get("templates"), dict) else {}
        for key in current["templates"]:
            if key in templates_patch:
                value = str(templates_patch[key] or "").strip()
                current["templates"][key] = value[:2000] if value else "{text}"
        limits_patch = patch.get("limits") if isinstance(patch.get("limits"), dict) else {}
        if limits_patch:
            current["limits"]["enabled"] = bool(limits_patch.get("enabled", current["limits"].get("enabled", False)))
            for key in ("income", "expense"):
                rule_patch = limits_patch.get(key)
                if not isinstance(rule_patch, dict):
                    continue
                current["limits"][key]["enabled"] = bool(
                    rule_patch.get("enabled", current["limits"][key].get("enabled", True))
                )
                current["limits"][key]["amount"] = str(rule_patch.get("amount") or "").strip()[:32]
        row.notification_prefs = current
        row.updated_at = _now()
        session.flush()
    hub.publish(wid, "prefs_updated", {"notification_prefs": current})
    return current


def get_last_delivery(workspace_owner_id: str) -> dict[str, Any] | None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.execute(
            select(TelegramDeliveryLog)
            .where(TelegramDeliveryLog.workspace_owner_id == wid)
            .order_by(TelegramDeliveryLog.created_at.desc())
            .limit(1),
        ).scalar_one_or_none()
        if row is None:
            return None
        return {
            "at": row.created_at.isoformat() if row.created_at else None,
            "ok": bool(row.ok),
            "kind": row.kind,
        }


def get_last_successful_delivery(workspace_owner_id: str) -> dict[str, Any] | None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.execute(
            select(TelegramDeliveryLog)
            .where(
                TelegramDeliveryLog.workspace_owner_id == wid,
                TelegramDeliveryLog.ok.is_(True),
            )
            .order_by(TelegramDeliveryLog.created_at.desc())
            .limit(1),
        ).scalar_one_or_none()
        if row is None:
            return None
        return {
            "at": row.created_at.isoformat() if row.created_at else None,
            "ok": True,
            "kind": row.kind,
        }


def _config_row_to_dict(row: TelegramBotConfig, *, include_token: bool = False) -> dict[str, Any]:
    raw_prefs = row.notification_prefs if isinstance(row.notification_prefs, dict) else {}
    return {
        "workspace_owner_id": row.workspace_owner_id,
        "bot_id": int(row.bot_id) if row.bot_id is not None else None,
        "bot_username": row.bot_username,
        "bot_first_name": row.bot_first_name,
        "masked_token": mask_token(row.bot_token),
        "bot_token": row.bot_token if include_token else None,
        "is_active": bool(row.is_active),
        "connected_at": row.connected_at.isoformat() if row.connected_at else None,
        "last_error": row.last_error,
        "webhook_secret": row.webhook_secret if include_token else None,
        "notification_prefs": merge_notification_prefs(raw_prefs),
    }


def get_bot_config(workspace_owner_id: str, *, session: Session | None = None) -> dict[str, Any] | None:
    wid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(wid):
        return None

    def _read(sess: Session) -> dict[str, Any] | None:
        row = sess.get(TelegramBotConfig, wid)
        if row is None or not (row.bot_token or "").strip() or not row.is_active:
            return None
        return _config_row_to_dict(row)

    if session is not None:
        return _read(session)
    with session_scope() as sess:
        return _read(sess)


def get_bot_config_with_token(workspace_owner_id: str) -> tuple[dict[str, Any] | None, str | None]:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.get(TelegramBotConfig, wid)
        if row is None or not (row.bot_token or "").strip() or not row.is_active:
            return None, None
        return _config_row_to_dict(row, include_token=True), row.bot_token.strip()


def get_bot_token(workspace_owner_id: str) -> str | None:
    _, token = get_bot_config_with_token(workspace_owner_id)
    return token


def save_bot_config(
    workspace_owner_id: str,
    *,
    bot_token: str,
    bot_id: int,
    bot_username: str,
    bot_first_name: str,
    webhook_secret: str,
) -> dict[str, Any]:
    wid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(wid):
        raise ValueError("invalid workspace")
    now = _now()
    with session_scope() as session:
        row = session.get(TelegramBotConfig, wid)
        if row is None:
            row = TelegramBotConfig(workspace_owner_id=wid)
            session.add(row)
        row.bot_token = bot_token.strip()
        row.bot_id = int(bot_id)
        row.bot_username = (bot_username or "").strip().lstrip("@")
        row.bot_first_name = (bot_first_name or "").strip()
        row.webhook_secret = (webhook_secret or "").strip() or str(uuid.uuid4())
        row.is_active = True
        row.last_error = None
        row.connected_at = now
        row.updated_at = now
        session.flush()
        out = _config_row_to_dict(row)

    data = load_workspace_settings(wid)
    data["telegram_bot_token"] = bot_token.strip()
    save_workspace_settings(wid, data)
    hub.publish(wid, "config_connected", {"bot_username": out.get("bot_username")})
    return out


def set_config_error(workspace_owner_id: str, error: str) -> None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.get(TelegramBotConfig, wid)
        if row:
            row.last_error = (error or "")[:2000]
            row.updated_at = _now()


def disconnect_bot(workspace_owner_id: str) -> None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        session.execute(delete(TelegramChat).where(TelegramChat.workspace_owner_id == wid))
        session.execute(delete(TelegramSubscriber).where(TelegramSubscriber.workspace_owner_id == wid))
        session.execute(delete(TelegramBotConfig).where(TelegramBotConfig.workspace_owner_id == wid))
    data = load_workspace_settings(wid)
    data["telegram_bot_token"] = ""
    save_workspace_settings(wid, data)
    hub.publish(wid, "config_disconnected", {})


def list_active_configs() -> list[dict[str, Any]]:
    with session_scope() as session:
        rows = session.execute(
            select(TelegramBotConfig).where(
                TelegramBotConfig.is_active.is_(True),
                TelegramBotConfig.bot_token != "",
            ),
        ).scalars().all()
        return [_config_row_to_dict(row, include_token=True) for row in rows]


def list_chats(workspace_owner_id: str, *, admin_only: bool = False) -> list[dict[str, Any]]:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        stmt = select(TelegramChat).where(TelegramChat.workspace_owner_id == wid)
        if admin_only:
            stmt = stmt.where(TelegramChat.bot_is_admin.is_(True))
        rows = session.execute(stmt.order_by(TelegramChat.title.asc())).scalars().all()
        return [_chat_row_to_dict(row) for row in rows]


def list_subscribers(workspace_owner_id: str, *, status: str | None = None) -> list[dict[str, Any]]:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        stmt = select(TelegramSubscriber).where(TelegramSubscriber.workspace_owner_id == wid)
        if status:
            stmt = stmt.where(TelegramSubscriber.status == status)
        rows = session.execute(stmt.order_by(TelegramSubscriber.requested_at.desc())).scalars().all()
        return [_subscriber_row_to_dict(row) for row in rows]


def get_subscriber_by_telegram_user(workspace_owner_id: str, telegram_user_id: int) -> dict[str, Any] | None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.execute(
            select(TelegramSubscriber).where(
                TelegramSubscriber.workspace_owner_id == wid,
                TelegramSubscriber.telegram_user_id == int(telegram_user_id),
            ),
        ).scalar_one_or_none()
        return _subscriber_row_to_dict(row) if row else None


def upsert_chat(
    workspace_owner_id: str,
    *,
    chat_id: int,
    chat_type: str,
    title: str,
    bot_is_admin: bool,
    session: Session | None = None,
) -> dict[str, Any]:
    wid = (workspace_owner_id or "").strip()
    now = _now()
    is_new = False

    def _upsert(sess: Session) -> TelegramChat:
        nonlocal is_new
        row = sess.execute(
            select(TelegramChat).where(
                TelegramChat.workspace_owner_id == wid,
                TelegramChat.chat_id == int(chat_id),
            ),
        ).scalar_one_or_none()
        if row is None:
            is_new = True
            row = TelegramChat(
                id=str(uuid.uuid4()),
                workspace_owner_id=wid,
                chat_id=int(chat_id),
                chat_type=(chat_type or "group").strip() or "group",
                title=(title or "").strip() or f"Chat {chat_id}",
                bot_is_admin=bool(bot_is_admin),
                is_enabled=False,
                discovered_at=now,
                last_seen_at=now,
            )
            sess.add(row)
        else:
            row.chat_type = (chat_type or row.chat_type).strip() or row.chat_type
            if title:
                row.title = title.strip()
            row.bot_is_admin = bool(bot_is_admin)
            if not row.bot_is_admin:
                row.is_enabled = False
            row.last_seen_at = now
        sess.flush()
        return row

    if session is not None:
        row = _upsert(session)
    else:
        with session_scope() as sess:
            row = _upsert(sess)
    out = _chat_row_to_dict(row)
    hub.publish(wid, "chat_discovered" if is_new else "chat_updated", out)
    return out


def set_chat_enabled(workspace_owner_id: str, chat_row_id: str, enabled: bool) -> dict[str, Any] | None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.get(TelegramChat, chat_row_id)
        if row is None or row.workspace_owner_id != wid or not row.bot_is_admin:
            return None
        row.is_enabled = bool(enabled)
        row.last_seen_at = _now()
        session.flush()
        out = _chat_row_to_dict(row)
    hub.publish(wid, "chat_updated", out)
    return out


def delete_chat(workspace_owner_id: str, chat_row_id: str) -> bool:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.get(TelegramChat, chat_row_id)
        if row is None or row.workspace_owner_id != wid:
            return False
        session.delete(row)
    hub.publish(wid, "chat_removed", {"id": chat_row_id})
    return True


def remove_chat_by_telegram_id(workspace_owner_id: str, chat_id: int) -> bool:
    """Remove group row when bot was kicked or left the chat."""
    wid = (workspace_owner_id or "").strip()
    row_id: str | None = None
    with session_scope() as session:
        row = session.execute(
            select(TelegramChat).where(
                TelegramChat.workspace_owner_id == wid,
                TelegramChat.chat_id == int(chat_id),
            ),
        ).scalar_one_or_none()
        if row is None:
            return False
        row_id = row.id
        session.delete(row)
    if row_id:
        hub.publish(wid, "chat_removed", {"id": row_id, "chat_id": int(chat_id)})
    return True


def upsert_subscriber_request(
    workspace_owner_id: str,
    *,
    telegram_user_id: int,
    chat_id: int,
    display_name: str,
    username: str = "",
    phone: str = "",
    contact_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    wid = (workspace_owner_id or "").strip()
    now = _now()
    became_pending = False
    with session_scope() as session:
        row = session.execute(
            select(TelegramSubscriber).where(
                TelegramSubscriber.workspace_owner_id == wid,
                TelegramSubscriber.telegram_user_id == int(telegram_user_id),
            ),
        ).scalar_one_or_none()
        if row is None:
            became_pending = True
            row = TelegramSubscriber(
                id=str(uuid.uuid4()),
                workspace_owner_id=wid,
                telegram_user_id=int(telegram_user_id),
                chat_id=int(chat_id),
                display_name=(display_name or "").strip() or "Пользователь",
                username=(username or "").strip().lstrip("@"),
                phone=(phone or "").strip(),
                contact_payload=contact_payload or {},
                status="pending",
                requested_at=now,
            )
            session.add(row)
        elif row.status in {"rejected", "disabled"}:
            became_pending = True
            row.status = "pending"
            row.chat_id = int(chat_id)
            row.display_name = (display_name or row.display_name).strip()
            row.username = (username or row.username).strip().lstrip("@")
            row.phone = (phone or row.phone).strip()
            row.contact_payload = contact_payload or row.contact_payload
            row.requested_at = now
            row.decided_at = None
            row.decided_by_user_id = None
        else:
            row.chat_id = int(chat_id)
            row.display_name = (display_name or row.display_name).strip()
            row.username = (username or row.username).strip().lstrip("@")
            row.phone = (phone or row.phone).strip()
            if contact_payload:
                row.contact_payload = contact_payload
        session.flush()
        out = _subscriber_row_to_dict(row)
    if became_pending:
        hub.publish(wid, "subscriber_pending", out)
    else:
        hub.publish(wid, "subscriber_updated", out)
    return out


def decide_subscriber(
    workspace_owner_id: str,
    subscriber_id: str,
    *,
    approve: bool,
    decided_by_user_id: str,
) -> dict[str, Any] | None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.get(TelegramSubscriber, subscriber_id)
        if row is None or row.workspace_owner_id != wid:
            return None
        row.status = "approved" if approve else "rejected"
        row.decided_by_user_id = decided_by_user_id
        row.decided_at = _now()
        session.flush()
        out = _subscriber_row_to_dict(row)
    hub.publish(wid, "subscriber_decided", out)
    return out


def delete_subscriber(workspace_owner_id: str, subscriber_id: str) -> bool:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.get(TelegramSubscriber, subscriber_id)
        if row is None or row.workspace_owner_id != wid:
            return False
        session.delete(row)
    hub.publish(wid, "subscriber_removed", {"id": subscriber_id})
    return True


def disable_subscriber_by_telegram_user(workspace_owner_id: str, telegram_user_id: int) -> None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        row = session.execute(
            select(TelegramSubscriber).where(
                TelegramSubscriber.workspace_owner_id == wid,
                TelegramSubscriber.telegram_user_id == int(telegram_user_id),
            ),
        ).scalar_one_or_none()
        if row:
            row.status = "disabled"
            row.decided_at = _now()
            session.flush()
            out = _subscriber_row_to_dict(row)
        else:
            out = None
    if out:
        hub.publish(wid, "subscriber_decided", out)


def refresh_chats_admin_status(workspace_owner_id: str, token: str, bot_id: int) -> list[dict[str, Any]]:
    from upos.telegram_client import bot_is_admin, get_chat_member

    wid = (workspace_owner_id or "").strip()
    updated: list[dict[str, Any]] = []
    with session_scope() as session:
        rows = session.execute(
            select(TelegramChat).where(TelegramChat.workspace_owner_id == wid),
        ).scalars().all()
        for row in rows:
            try:
                member = get_chat_member(token, int(row.chat_id), int(bot_id))
                row.bot_is_admin = bot_is_admin(member)
            except Exception as exc:
                logger.warning("[telegram] getChatMember chat=%s: %s", row.chat_id, exc)
                row.bot_is_admin = False
            if not row.bot_is_admin:
                row.is_enabled = False
            row.last_seen_at = _now()
            session.flush()
            updated.append(_chat_row_to_dict(row))
    hub.publish(wid, "chats_refreshed", {"count": len(updated)})
    return updated


def delivery_targets(workspace_owner_id: str, report_key: str | None = None) -> list[int]:
    wid = (workspace_owner_id or "").strip()
    target_row_id = ""
    if report_key:
        prefs = get_notification_prefs(wid)
        targets = prefs.get("targets") if isinstance(prefs.get("targets"), dict) else {}
        target_row_id = str(targets.get(str(report_key)) or "").strip()
    with session_scope() as session:
        if target_row_id:
            row = session.execute(
                select(TelegramChat).where(
                    TelegramChat.workspace_owner_id == wid,
                    TelegramChat.id == target_row_id,
                    TelegramChat.bot_is_admin.is_(True),
                ),
            ).scalar_one_or_none()
            return [int(row.chat_id)] if row is not None else []
        chats = session.execute(
            select(TelegramChat).where(
                TelegramChat.workspace_owner_id == wid,
                TelegramChat.is_enabled.is_(True),
                TelegramChat.bot_is_admin.is_(True),
            ),
        ).scalars().all()
        subscribers = session.execute(
            select(TelegramSubscriber).where(
                TelegramSubscriber.workspace_owner_id == wid,
                TelegramSubscriber.status == "approved",
            ),
        ).scalars().all()
        raw = [int(row.chat_id) for row in chats] + [int(row.chat_id) for row in subscribers]
    seen: set[int] = set()
    out: list[int] = []
    for chat_id in raw:
        if chat_id not in seen:
            seen.add(chat_id)
            out.append(chat_id)
    return out


def should_send_dedupe(workspace_owner_id: str, dedupe_key: str, *, window_seconds: int = 60) -> bool:
    if not dedupe_key:
        return True
    wid = (workspace_owner_id or "").strip()
    since = _now() - timedelta(seconds=max(1, int(window_seconds)))
    with session_scope() as session:
        row = session.execute(
            select(TelegramDeliveryLog.id)
            .where(
                TelegramDeliveryLog.workspace_owner_id == wid,
                TelegramDeliveryLog.dedupe_key == dedupe_key,
                TelegramDeliveryLog.ok.is_(True),
                TelegramDeliveryLog.created_at >= since,
            )
            .limit(1),
        ).scalar_one_or_none()
        return row is None


def log_delivery(
    workspace_owner_id: str,
    *,
    kind: str,
    target_chat_id: int | None,
    dedupe_key: str,
    ok: bool,
    error: str | None = None,
) -> None:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        session.add(
            TelegramDeliveryLog(
                id=str(uuid.uuid4()),
                workspace_owner_id=wid,
                kind=(kind or "")[:40],
                target_chat_id=target_chat_id,
                dedupe_key=(dedupe_key or "")[:120],
                ok=bool(ok),
                error=(error or "")[:2000] if error else None,
            ),
        )


def _is_transient_webhook_noise(message: str | None) -> bool:
    m = (message or "").lower()
    if not m:
        return False
    needles = (
        "connection reset",
        "reset by peer",
        "connection aborted",
        "broken pipe",
        "timeout",
        "timed out",
        "temporarily unavailable",
        "network error",
        "telegram network error",
    )
    return any(n in m for n in needles)


def _webhook_error_stale(last_error_date: Any) -> bool:
    if last_error_date in (None, "", 0):
        return False
    try:
        ts = float(last_error_date)
    except (TypeError, ValueError):
        return False
    try:
        err_at = datetime.fromtimestamp(ts, tz=timezone.utc)
    except (OSError, OverflowError, ValueError):
        return False
    return err_at < datetime.now(timezone.utc) - timedelta(hours=6)


def get_webhook_status(workspace_owner_id: str) -> dict[str, Any]:
    from upos.telegram_client import TelegramApiError, get_webhook_info

    _, token = get_bot_config_with_token(workspace_owner_id)
    if not token:
        return {}
    last_exc: TelegramApiError | None = None
    for attempt in range(2):
        try:
            info = get_webhook_info(token)
            out: dict[str, Any] = {
                "url": info.get("url"),
                "pending_update_count": info.get("pending_update_count"),
            }
            last_err = info.get("last_error_message")
            last_err_date = info.get("last_error_date")
            if last_err and not _is_transient_webhook_noise(str(last_err)):
                if not _webhook_error_stale(last_err_date):
                    out["last_error_message"] = last_err
                    out["last_error_date"] = last_err_date
            return out
        except TelegramApiError as exc:
            last_exc = exc
            if attempt == 0 and _is_transient_webhook_noise(str(exc)):
                continue
            break
    if last_exc and _is_transient_webhook_noise(str(last_exc)):
        return {}
    if last_exc:
        return {"error": str(last_exc)}
    return {}


def get_telegram_dashboard(workspace_owner_id: str) -> dict[str, Any]:
    wid = (workspace_owner_id or "").strip()
    cfg = get_bot_config(wid)
    chats = list_chats(wid, admin_only=True)
    pending = list_subscribers(wid, status="pending")
    approved = list_subscribers(wid, status="approved")
    out: dict[str, Any] = {
        "connected": cfg is not None,
        "config": cfg,
        "chats": chats,
        "pending": pending,
        "approved": approved,
        "admin_chats_count": len(chats),
        "enabled_chats_count": sum(1 for c in chats if c.get("is_enabled")),
        "pending_subscribers_count": len(pending),
        "approved_subscribers_count": len(approved),
    }
    if cfg:
        out["webhook"] = get_webhook_status(wid)
        out["last_delivery"] = get_last_delivery(wid)
        out["last_success_delivery"] = get_last_successful_delivery(wid)
        out["notification_prefs"] = get_notification_prefs(wid)
    return out


def status_summary(workspace_owner_id: str) -> dict[str, Any]:
    dashboard = get_telegram_dashboard(workspace_owner_id)
    return {
        key: value
        for key, value in dashboard.items()
        if key not in {"chats", "pending", "approved"}
    }


def workspace_display_name(workspace_owner_id: str) -> str:
    wid = (workspace_owner_id or "").strip()
    with session_scope() as session:
        user = session.get(User, wid)
        if user and (user.name or "").strip():
            return user.name.strip()
    return "UPOS FINANCE"
