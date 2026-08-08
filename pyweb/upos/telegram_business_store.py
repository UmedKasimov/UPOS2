"""Telegram для бизнеса: подключение бота к личному аккаунту и переписка.

Владелец включает бота в настройках Telegram (Настройки → Telegram для бизнеса
→ Чат-боты). После этого личные переписки приходят боту апдейтами
`business_message`, а ответы уходят клиенту от имени владельца — для этого при
отправке передаётся `business_connection_id`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select

from upos.db import session_scope
from upos.db_models import (
    Counterparty,
    TelegramBusinessConnection,
    TelegramBusinessMessage,
)

logger = logging.getLogger(__name__)


def _clean(value: Any, limit: int = 0) -> str:
    text = str(value or "").strip()
    return text[:limit] if limit else text


def _display_name(user: dict[str, Any]) -> str:
    parts = [str(user.get("first_name") or ""), str(user.get("last_name") or "")]
    name = " ".join(part for part in parts if part).strip()
    return name or str(user.get("username") or "") or "Клиент"


# Виды вложений и как их называть в переписке. Раньше в базу писался голый
# флаг True, и любой файл показывался безымянным словом «Вложение».
_ATTACHMENT_KINDS: tuple[tuple[str, str], ...] = (
    ("photo", "Фото"),
    ("document", "Документ"),
    ("video", "Видео"),
    ("video_note", "Видеосообщение"),
    ("voice", "Голосовое сообщение"),
    ("audio", "Аудио"),
    ("animation", "GIF"),
    ("sticker", "Стикер"),
    ("location", "Геопозиция"),
    ("contact", "Контакт"),
)


def _attachment_payload(message: dict[str, Any]) -> dict[str, Any]:
    """Описание вложения: вид, подпись и file_id для будущей выгрузки."""
    for key, label in _ATTACHMENT_KINDS:
        raw = message.get(key)
        if not raw:
            continue
        # У фото Telegram присылает список размеров — берём самый крупный.
        item = raw[-1] if isinstance(raw, list) and raw else raw
        item = item if isinstance(item, dict) else {}
        file_name = _clean(item.get("file_name"), 255)
        mime_type = _clean(item.get("mime_type"), 120)
        # Картинки показываем превью прямо в чате. Это фото и стикеры, а также
        # документы с картиночным mime (когда фото отправили файлом).
        is_image = key in {"photo", "sticker"} or mime_type.startswith("image/")
        # Средний размер — для превью: оригинал грузим только по клику.
        thumb_file_id = ""
        if key == "photo" and isinstance(raw, list) and raw:
            thumb = raw[len(raw) // 2] if len(raw) > 1 else raw[0]
            thumb_file_id = _clean((thumb or {}).get("file_id"), 255)
        return {
            key: True,
            "kind": key,
            "label": f"{label}: {file_name}" if file_name else label,
            "file_id": _clean(item.get("file_id"), 255),
            "thumb_file_id": thumb_file_id,
            "file_unique_id": _clean(item.get("file_unique_id"), 120),
            "file_name": file_name,
            "file_size": int(item.get("file_size") or 0),
            "mime_type": mime_type,
            "is_image": is_image,
        }
    return {}


def attachment_is_image(payload: Any) -> bool:
    data = payload if isinstance(payload, dict) else {}
    return bool(data.get("is_image"))


def attachment_file_ref(payload: Any, *, thumb: bool = False) -> dict[str, str]:
    """file_id вложения для выгрузки из Telegram. thumb=True — превью-размер."""
    data = payload if isinstance(payload, dict) else {}
    file_id = ""
    if thumb:
        file_id = _clean(data.get("thumb_file_id")) or _clean(data.get("file_id"))
    else:
        file_id = _clean(data.get("file_id"))
    return {
        "file_id": file_id,
        "file_unique_id": _clean(data.get("file_unique_id")),
        "mime_type": _clean(data.get("mime_type")),
        "file_name": _clean(data.get("file_name")),
        "is_image": "1" if data.get("is_image") else "",
    }


def message_attachment_ref(workspace_owner_id: str, message_id: str, *, thumb: bool = False) -> dict[str, Any]:
    """Ссылка на вложение сообщения: file_id, чат и connection для getFile."""
    with session_scope() as session:
        row = session.get(TelegramBusinessMessage, str(message_id or ""))
        if row is None or row.workspace_owner_id != workspace_owner_id:
            return {}
        ref = attachment_file_ref(row.payload, thumb=thumb)
        if not ref.get("file_id"):
            return {}
        ref["chat_id"] = row.chat_id
        ref["connection_id"] = row.connection_id or ""
        return ref


def sale_document(payload: Any) -> dict[str, Any]:
    """Заказ или продажа, отправленные клиенту этим сообщением."""
    data = payload if isinstance(payload, dict) else {}
    document_id = _clean(data.get("sale_document_id"))
    if not document_id:
        return {}
    return {
        "id": document_id,
        "number": _clean(data.get("sale_number")),
        "title": _clean(data.get("sale_title")) or "Документ",
        "amount": _clean(data.get("sale_amount")),
        "currency": _clean(data.get("sale_currency")) or "UZS",
    }


def attachment_label(payload: Any) -> str:
    """Как показать вложение в списке диалогов и в переписке."""
    data = payload if isinstance(payload, dict) else {}
    if not data:
        return ""
    label = _clean(data.get("label"))
    if label:
        return label
    for key, fallback in _ATTACHMENT_KINDS:
        if data.get(key):
            return fallback
    return "Вложение"


def save_connection(workspace_owner_id: str, connection: dict[str, Any]) -> str:
    """Сохраняет (или обновляет) подключение бота к личному аккаунту."""
    connection_id = _clean(connection.get("id"), 120)
    if not connection_id:
        return ""
    user = connection.get("user") if isinstance(connection.get("user"), dict) else {}
    # Telegram переименовал поле: is_enabled в старых версиях, rights в новых.
    rights = connection.get("rights") if isinstance(connection.get("rights"), dict) else None
    can_reply = bool(connection.get("can_reply")) or bool(rights and rights.get("can_reply"))
    is_enabled = connection.get("is_enabled")
    enabled = True if is_enabled is None else bool(is_enabled)

    with session_scope() as session:
        row = session.execute(
            select(TelegramBusinessConnection).where(
                TelegramBusinessConnection.connection_id == connection_id
            )
        ).scalar_one_or_none()
        if row is None:
            row = TelegramBusinessConnection(
                id=str(uuid.uuid4()),
                connection_id=connection_id,
            )
            session.add(row)
        row.workspace_owner_id = workspace_owner_id
        row.user_chat_id = int(connection.get("user_chat_id") or 0)
        row.telegram_user_id = int(user.get("id") or 0)
        row.username = _clean(user.get("username"), 80)
        row.display_name = _clean(_display_name(user), 255)
        row.can_reply = can_reply
        row.is_enabled = enabled
    return connection_id


def has_business_chat(workspace_owner_id: str, chat_id: int) -> bool:
    """Есть ли у владельца личная переписка с этим чатом.

    Если есть — отвечать и слать файлы правильнее от имени владельца:
    клиент писал человеку, а не боту.
    """
    if not chat_id:
        return False
    with session_scope() as session:
        found = session.execute(
            select(TelegramBusinessMessage.id)
            .where(
                TelegramBusinessMessage.workspace_owner_id == workspace_owner_id,
                TelegramBusinessMessage.chat_id == int(chat_id),
            )
            .limit(1)
        ).scalar_one_or_none()
    return found is not None


def mark_can_reply(workspace_owner_id: str, connection_id: str) -> None:
    """Ответ ушёл — значит владелец разрешил боту отвечать.

    Telegram присылает обновление прав отдельным событием, и до него наш
    флаг говорит «нельзя», хотя право уже выдано.
    """
    clean_id = _clean(connection_id, 120)
    if not clean_id:
        return
    with session_scope() as session:
        row = session.execute(
            select(TelegramBusinessConnection).where(
                TelegramBusinessConnection.connection_id == clean_id,
                TelegramBusinessConnection.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is not None:
            row.can_reply = True


def active_connection(workspace_owner_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        row = session.execute(
            select(TelegramBusinessConnection)
            .where(
                TelegramBusinessConnection.workspace_owner_id == workspace_owner_id,
                TelegramBusinessConnection.is_enabled.is_(True),
            )
            .order_by(TelegramBusinessConnection.updated_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if row is None:
            return None
        return {
            "connection_id": row.connection_id,
            "username": row.username,
            "display_name": row.display_name,
            "can_reply": bool(row.can_reply),
            "connected_at": row.connected_at.isoformat() if row.connected_at else "",
        }


def workspace_for_connection(connection_id: str) -> str:
    with session_scope() as session:
        row = session.execute(
            select(TelegramBusinessConnection.workspace_owner_id).where(
                TelegramBusinessConnection.connection_id == _clean(connection_id, 120)
            )
        ).scalar_one_or_none()
    return str(row or "")


def _match_counterparty(session: Any, workspace_owner_id: str, phone: str, username: str) -> str | None:
    """Ищет клиента по телефону или телеграм-нику, чтобы привязать диалог к CRM."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits and len(digits) >= 7:
        tail = digits[-9:]
        row = session.execute(
            select(Counterparty.id).where(
                Counterparty.workspace_owner_id == workspace_owner_id,
                func.replace(
                    func.replace(
                        func.replace(func.coalesce(Counterparty.phone, ""), " ", ""),
                        "-",
                        "",
                    ),
                    "+",
                    "",
                ).like(f"%{tail}"),
            ).limit(1)
        ).scalar_one_or_none()
        if row:
            return str(row)
    handle = _clean(username).lstrip("@").lower()
    if handle:
        row = session.execute(
            select(Counterparty.id).where(
                Counterparty.workspace_owner_id == workspace_owner_id,
                func.lower(Counterparty.data.op("->>")("telegram")).in_(
                    [handle, f"@{handle}"]
                ),
            ).limit(1)
        ).scalar_one_or_none()
        if row:
            return str(row)
    return None


def save_message(
    workspace_owner_id: str,
    message: dict[str, Any],
    *,
    connection_id: str = "",
    direction: str = "in",
    extra: dict[str, Any] | None = None,
) -> bool:
    """Кладёт сообщение личной переписки в базу. Повторный апдейт с тем же
    message_id игнорируется — Telegram может прислать его несколько раз.

    `extra` дописывается в payload: так отправленная накладная запоминает,
    какой это документ, и переписка показывает карточку заказа.
    """
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    chat_id = int(chat.get("id") or 0)
    if not chat_id:
        return False
    sender = message.get("from") if isinstance(message.get("from"), dict) else {}
    message_id = int(message.get("message_id") or 0)
    sent_at = datetime.fromtimestamp(int(message.get("date") or 0) or 0, tz=timezone.utc) if message.get("date") else datetime.now(timezone.utc)
    text_body = _clean(message.get("text") or message.get("caption"))
    payload = _attachment_payload(message)
    if extra:
        payload = {**payload, **{key: value for key, value in extra.items() if value not in (None, "")}}

    with session_scope() as session:
        if message_id:
            exists = session.execute(
                select(TelegramBusinessMessage.id).where(
                    TelegramBusinessMessage.workspace_owner_id == workspace_owner_id,
                    TelegramBusinessMessage.chat_id == chat_id,
                    TelegramBusinessMessage.message_id == message_id,
                ).limit(1)
            ).scalar_one_or_none()
            if exists:
                return False
        else:
            # Без message_id уникальный ключ (чат, 0) занимает первое же
            # сообщение, и все следующие ответы молча пропадали. Даём такой
            # записи собственный отрицательный номер — с настоящими,
            # положительными, он не столкнётся.
            lowest = session.execute(
                select(func.min(TelegramBusinessMessage.message_id)).where(
                    TelegramBusinessMessage.workspace_owner_id == workspace_owner_id,
                    TelegramBusinessMessage.chat_id == chat_id,
                )
            ).scalar()
            message_id = min(0, int(lowest or 0)) - 1
        phone = _clean((message.get("contact") or {}).get("phone_number") if isinstance(message.get("contact"), dict) else "", 40)
        username = _clean(sender.get("username") or chat.get("username"), 80)
        counterparty_id = _match_counterparty(session, workspace_owner_id, phone, username)
        session.add(
            TelegramBusinessMessage(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                connection_id=_clean(connection_id, 120),
                chat_id=chat_id,
                message_id=message_id,
                direction="out" if direction == "out" else "in",
                sender_user_id=int(sender.get("id") or 0),
                sender_name=_clean(_display_name(sender) if sender else _display_name(chat), 255),
                sender_username=username,
                sender_phone=phone,
                text_body=text_body,
                payload=payload,
                counterparty_id=counterparty_id,
                # Раньше время сообщения вычислялось и терялось: в базу шла
                # отметка вставки, из-за чего порядок переписки плыл.
                sent_at=sent_at,
            )
        )
    return True


def list_threads(workspace_owner_id: str, limit: int = 60) -> list[dict[str, Any]]:
    """Диалоги: по одному на чат, с последним сообщением и счётчиком."""
    with session_scope() as session:
        rows = list(
            session.execute(
                select(TelegramBusinessMessage)
                .where(TelegramBusinessMessage.workspace_owner_id == workspace_owner_id)
                .order_by(TelegramBusinessMessage.sent_at.desc())
                .limit(1000)
            ).scalars()
        )
    threads: dict[int, dict[str, Any]] = {}
    for row in rows:
        thread = threads.get(row.chat_id)
        if thread is None:
            thread = {
                "chat_id": row.chat_id,
                "thread_id": f"tg-business-{row.chat_id}",
                "name": row.sender_name or "Клиент",
                "username": row.sender_username,
                "phone": row.sender_phone,
                "counterparty_id": row.counterparty_id or "",
                "last_text": row.text_body or attachment_label(row.payload),
                "last_at": row.sent_at.isoformat() if row.sent_at else "",
                "last_direction": row.direction,
                "messages": 0,
                "unanswered": 0,
            }
            threads[row.chat_id] = thread
        thread["messages"] += 1
        if row.direction == "in":
            # Имя берём из входящих: в исходящих отправитель — владелец.
            if row.sender_name:
                thread["name"] = row.sender_name
            if row.sender_username:
                thread["username"] = row.sender_username
        if not thread["counterparty_id"] and row.counterparty_id:
            thread["counterparty_id"] = row.counterparty_id
    for thread in threads.values():
        thread["waiting"] = thread["last_direction"] == "in"
    return sorted(threads.values(), key=lambda item: item["last_at"], reverse=True)[:limit]


def thread_messages(workspace_owner_id: str, chat_id: int, limit: int = 200) -> list[dict[str, Any]]:
    with session_scope() as session:
        rows = list(
            session.execute(
                select(TelegramBusinessMessage)
                .where(
                    TelegramBusinessMessage.workspace_owner_id == workspace_owner_id,
                    TelegramBusinessMessage.chat_id == int(chat_id),
                )
                .order_by(TelegramBusinessMessage.sent_at.asc())
                .limit(max(1, min(int(limit or 200), 500)))
            ).scalars()
        )
        return [
            {
                "id": row.id,
                "direction": row.direction,
                "text": row.text_body,
                "sender_name": row.sender_name,
                "sent_at": row.sent_at.isoformat() if row.sent_at else "",
                "has_attachment": bool(row.payload),
                "attachment_label": attachment_label(row.payload),
                "attachment_is_image": attachment_is_image(row.payload),
                "sale_document": sale_document(row.payload),
            }
            for row in rows
        ]
