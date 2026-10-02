"""Persist private Telegram bot conversations for the messenger inbox."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from upos.messenger_store import add_message, upsert_thread
from upos.telegram_business_store import _attachment_payload


def _display_name(user: dict[str, Any]) -> str:
    name = " ".join(
        str(user.get(key) or "").strip() for key in ("first_name", "last_name")
    ).strip()
    return name or str(user.get("username") or "").strip() or "Клиент Telegram"


def save_incoming(workspace_owner_id: str, message: dict[str, Any], *, bot_id: int = 0) -> bool:
    """Save before acknowledging the webhook; duplicate deliveries stay idempotent."""
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    sender = message.get("from") if isinstance(message.get("from"), dict) else {}
    if str(chat.get("type") or "private") != "private":
        return False
    chat_id = int(chat.get("id") or 0)
    message_id = int(message.get("message_id") or 0)
    if not chat_id or not message_id or (bot_id and int(sender.get("id") or 0) == bot_id):
        return False
    thread = upsert_thread(
        workspace_owner_id,
        channel="telegram_bot",
        external_id=str(chat_id),
        title=_display_name(sender or chat),
        username=str(sender.get("username") or chat.get("username") or ""),
    )
    payload = _attachment_payload(message)
    text = str(message.get("text") or message.get("caption") or "").strip()
    if not text:
        text = str(payload.get("label") or ("Контакт" if message.get("contact") else "Сообщение"))
    saved = add_message(
        workspace_owner_id,
        thread_id=str(thread["id"]),
        channel="telegram_bot",
        external_id=f"{chat_id}:{message_id}",
        direction="in",
        author=_display_name(sender or chat),
        text_body=text,
        payload=payload,
        sent_at=message.get("date"),
    )
    return not bool(saved.get("duplicate"))


def save_outgoing(
    workspace_owner_id: str,
    chat_id: int,
    sent_message: dict[str, Any],
    text: str,
    *,
    author: str = "UPOS",
    campaign_id: str = "",
    contact: str = "",
    username: str = "",
) -> bool:
    """Record a confirmed send using Telegram's message ID."""
    message_id = int(sent_message.get("message_id") or 0)
    if not chat_id or not message_id:
        return False
    thread = upsert_thread(
        workspace_owner_id,
        channel="telegram_bot",
        external_id=str(chat_id),
        title=contact,
        username=username,
        link_client=False,
    )
    result = add_message(
        workspace_owner_id,
        thread_id=str(thread["id"]),
        channel="telegram_bot",
        external_id=f"{chat_id}:{message_id}",
        direction="out",
        author=author,
        text_body=text,
        payload={"campaign_id": campaign_id} if campaign_id else {},
        sent_at=sent_message.get("date") or datetime.now(timezone.utc).timestamp(),
    )
    return not bool(result.get("duplicate"))
