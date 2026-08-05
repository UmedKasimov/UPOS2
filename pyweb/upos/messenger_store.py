"""Хранение переписки мессенджеров и заявок из рекламы.

Веб-хук отдаёт события, а здесь они превращаются в записи: переписка, клиент
в базе и карточка в CRM. Повторную доставку одного и того же события Meta
делает регулярно, поэтому всё пишется по внешнему идентификатору.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select

from upos.db import session_scope
from upos.db_models import (
    Counterparty,
    CrmRecord,
    MessengerLead,
    MessengerMessage,
    MessengerThread,
)

logger = logging.getLogger("upos.messenger")

CHANNEL_INSTAGRAM = "instagram"


def _now() -> datetime:
    return datetime.now(UTC)


def _digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _moment(value: Any) -> datetime:
    """Время события: Meta присылает миллисекунды, заявки — строку ISO."""
    if isinstance(value, (int, float)) and value > 0:
        seconds = float(value)
        if seconds > 1e11:  # миллисекунды
            seconds /= 1000.0
        try:
            return datetime.fromtimestamp(seconds, UTC)
        except (OverflowError, OSError, ValueError):
            return _now()
    raw = str(value or "").strip()
    if raw:
        try:
            moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return moment if moment.tzinfo else moment.replace(tzinfo=UTC)
        except ValueError:
            return _now()
    return _now()


def _match_counterparty(session, workspace_owner_id: str, *, phone: str = "", username: str = "", name: str = "") -> Counterparty | None:
    """Ищет уже заведённого клиента по телефону, нику или имени."""
    phone_digits = _digits(phone)
    username_key = str(username or "").lstrip("@").strip().lower()
    name_key = str(name or "").strip().lower()
    if not (phone_digits or username_key or name_key):
        return None
    rows = session.execute(
        select(Counterparty).where(Counterparty.workspace_owner_id == workspace_owner_id)
    ).scalars().all()
    for row in rows:
        data = row.data if isinstance(row.data, dict) else {}
        if phone_digits:
            row_phone = _digits(row.phone or data.get("phone"))
            if row_phone and len(phone_digits) >= 9 and len(row_phone) >= 9:
                if row_phone[-9:] == phone_digits[-9:]:
                    return row
            elif row_phone and row_phone == phone_digits:
                return row
        if username_key:
            for key in ("instagram", "telegram", "username"):
                stored = str(data.get(key) or "").lstrip("@").strip().lower()
                if stored and stored == username_key:
                    return row
        if name_key and str(row.name or "").strip().lower() == name_key:
            return row
    return None


def upsert_thread(
    workspace_owner_id: str,
    *,
    channel: str = CHANNEL_INSTAGRAM,
    external_id: str,
    title: str = "",
    username: str = "",
    avatar_url: str = "",
    link_client: bool = True,
) -> dict[str, Any]:
    """Заводит переписку или обновляет её данные."""
    contact_id = str(external_id or "").strip()
    if not contact_id:
        raise ValueError("Не указан идентификатор собеседника")
    with session_scope() as session:
        row = session.execute(
            select(MessengerThread).where(
                MessengerThread.workspace_owner_id == workspace_owner_id,
                MessengerThread.channel == channel,
                MessengerThread.external_id == contact_id,
            )
        ).scalars().first()
        if row is None:
            row = MessengerThread(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                channel=channel,
                external_id=contact_id,
                created_at=_now(),
            )
            session.add(row)
        if title:
            row.title = title[:255]
        if username:
            row.username = username.lstrip("@")[:120]
        if avatar_url:
            row.avatar_url = avatar_url
        if link_client and not row.counterparty_id:
            client = _match_counterparty(
                session,
                workspace_owner_id,
                username=row.username,
                name=row.title,
            )
            if client is not None:
                row.counterparty_id = client.id
        session.flush()
        return {"id": row.id, "counterparty_id": row.counterparty_id, "title": row.title}


def add_message(
    workspace_owner_id: str,
    *,
    thread_id: str,
    channel: str = CHANNEL_INSTAGRAM,
    external_id: str = "",
    direction: str = "in",
    author: str = "",
    text_body: str = "",
    payload: dict[str, Any] | None = None,
    sent_at: Any = None,
) -> dict[str, Any]:
    """Записывает сообщение и обновляет карточку переписки.

    Одно и то же событие Meta присылает по нескольку раз, поэтому сообщение
    с уже известным идентификатором просто пропускается.
    """
    moment = _moment(sent_at)
    with session_scope() as session:
        if external_id:
            existing = session.execute(
                select(MessengerMessage).where(
                    MessengerMessage.workspace_owner_id == workspace_owner_id,
                    MessengerMessage.channel == channel,
                    MessengerMessage.external_id == external_id,
                )
            ).scalars().first()
            if existing is not None:
                return {"id": existing.id, "duplicate": True}

        row = MessengerMessage(
            id=str(uuid.uuid4()),
            workspace_owner_id=workspace_owner_id,
            thread_id=thread_id,
            channel=channel,
            external_id=external_id,
            direction="out" if direction == "out" else "in",
            author=str(author or "")[:255],
            text_body=str(text_body or ""),
            payload=payload or {},
            sent_at=moment,
            created_at=_now(),
        )
        session.add(row)

        thread = session.get(MessengerThread, thread_id)
        if thread is not None:
            preview = str(text_body or "").strip()
            if not preview and payload:
                preview = "Вложение"
            thread.last_message_text = preview[:500]
            thread.last_message_at = moment
            if row.direction == "in":
                thread.unread_count = int(thread.unread_count or 0) + 1
            else:
                thread.unread_count = 0
        session.flush()
        return {"id": row.id, "duplicate": False}


def mark_thread_read(workspace_owner_id: str, thread_id: str) -> None:
    with session_scope() as session:
        thread = session.get(MessengerThread, thread_id)
        if thread is not None and thread.workspace_owner_id == workspace_owner_id:
            thread.unread_count = 0


def list_threads(workspace_owner_id: str, *, channel: str = CHANNEL_INSTAGRAM, limit: int = 200) -> list[dict[str, Any]]:
    cap = max(1, min(int(limit or 200), 1000))
    with session_scope() as session:
        rows = session.execute(
            select(MessengerThread)
            .where(
                MessengerThread.workspace_owner_id == workspace_owner_id,
                MessengerThread.channel == channel,
            )
            .order_by(MessengerThread.last_message_at.desc().nullslast(), MessengerThread.created_at.desc())
            .limit(cap)
        ).scalars().all()
        client_names: dict[str, str] = {}
        client_ids = [row.counterparty_id for row in rows if row.counterparty_id]
        if client_ids:
            for client in session.execute(
                select(Counterparty).where(Counterparty.id.in_(client_ids))
            ).scalars():
                client_names[client.id] = client.name
        return [
            {
                "id": row.id,
                "channel": row.channel,
                "external_id": row.external_id,
                "title": row.title or row.username or row.external_id,
                "username": row.username,
                "avatar_url": row.avatar_url,
                "counterparty_id": row.counterparty_id or "",
                "client": client_names.get(row.counterparty_id or "", ""),
                "status": row.status,
                "last_message_text": row.last_message_text,
                "last_message_at": row.last_message_at.isoformat() if row.last_message_at else "",
                "unread_count": int(row.unread_count or 0),
            }
            for row in rows
        ]


def list_messages(workspace_owner_id: str, thread_id: str, *, limit: int = 200) -> list[dict[str, Any]]:
    cap = max(1, min(int(limit or 200), 1000))
    with session_scope() as session:
        rows = session.execute(
            select(MessengerMessage)
            .where(
                MessengerMessage.workspace_owner_id == workspace_owner_id,
                MessengerMessage.thread_id == thread_id,
            )
            .order_by(MessengerMessage.sent_at.asc())
            .limit(cap)
        ).scalars().all()
        return [
            {
                "id": row.id,
                "direction": row.direction,
                "author": row.author,
                "text": row.text_body,
                "sent_at": row.sent_at.isoformat() if row.sent_at else "",
                "payload": row.payload if isinstance(row.payload, dict) else {},
            }
            for row in rows
        ]


def thread_by_id(workspace_owner_id: str, thread_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        row = session.get(MessengerThread, thread_id)
        if row is None or row.workspace_owner_id != workspace_owner_id:
            return None
        return {
            "id": row.id,
            "channel": row.channel,
            "external_id": row.external_id,
            "title": row.title,
            "username": row.username,
            "counterparty_id": row.counterparty_id or "",
        }


def save_lead(
    workspace_owner_id: str,
    lead: dict[str, Any],
    *,
    channel: str = CHANNEL_INSTAGRAM,
    create_client: bool = True,
    create_crm_record: bool = True,
) -> dict[str, Any]:
    """Сохраняет заявку из рекламы, заводит клиента и карточку в CRM."""
    external_id = str(lead.get("external_id") or "").strip()
    if not external_id:
        raise ValueError("Не указан номер заявки")
    full_name = str(lead.get("full_name") or "").strip()
    phone = str(lead.get("phone") or "").strip()
    email = str(lead.get("email") or "").strip()
    title = full_name or phone or f"Заявка {external_id}"

    with session_scope() as session:
        row = session.execute(
            select(MessengerLead).where(
                MessengerLead.workspace_owner_id == workspace_owner_id,
                MessengerLead.channel == channel,
                MessengerLead.external_id == external_id,
            )
        ).scalars().first()
        if row is not None:
            return {"id": row.id, "duplicate": True, "counterparty_id": row.counterparty_id or ""}

        counterparty_id = None
        if create_client:
            client = _match_counterparty(session, workspace_owner_id, phone=phone, name=full_name)
            if client is None and (full_name or phone):
                client = Counterparty(
                    id=str(uuid.uuid4()),
                    workspace_owner_id=workspace_owner_id,
                    kind="client",
                    name=title[:255],
                    phone=phone[:64],
                    external_source=f"{channel}-lead",
                    external_id=external_id[:180],
                    data={
                        "source": "Реклама Instagram",
                        "email": email,
                        "lead_form": str(lead.get("form_name") or lead.get("form_id") or ""),
                        "campaign": str(lead.get("campaign_name") or ""),
                    },
                )
                session.add(client)
                session.flush()
            counterparty_id = client.id if client is not None else None

        crm_record_id = None
        if create_crm_record:
            record = CrmRecord(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                item_type="lead",
                title=title[:255],
                counterparty_id=counterparty_id,
                status="new",
                data={
                    "client": title,
                    "phone": phone,
                    "email": email,
                    "lead_source": "Instagram",
                    "contact_type": "Реклама",
                    "campaign": str(lead.get("campaign_name") or ""),
                    "form": str(lead.get("form_name") or lead.get("form_id") or ""),
                    "date": _moment(lead.get("created_time")).date().isoformat(),
                    "fields": lead.get("fields") if isinstance(lead.get("fields"), dict) else {},
                },
            )
            session.add(record)
            session.flush()
            crm_record_id = record.id

        row = MessengerLead(
            id=str(uuid.uuid4()),
            workspace_owner_id=workspace_owner_id,
            channel=channel,
            external_id=external_id,
            form_id=str(lead.get("form_id") or "")[:120],
            form_name=str(lead.get("form_name") or "")[:255],
            ad_id=str(lead.get("ad_id") or "")[:120],
            campaign_name=str(lead.get("campaign_name") or "")[:255],
            full_name=full_name[:255],
            phone=phone[:40],
            email=email[:190],
            fields=lead.get("fields") if isinstance(lead.get("fields"), dict) else {},
            counterparty_id=counterparty_id,
            crm_record_id=crm_record_id,
            received_at=_moment(lead.get("created_time")),
            created_at=_now(),
        )
        session.add(row)
        session.flush()
        return {
            "id": row.id,
            "duplicate": False,
            "counterparty_id": counterparty_id or "",
            "crm_record_id": crm_record_id or "",
        }


def list_leads(workspace_owner_id: str, *, channel: str = CHANNEL_INSTAGRAM, limit: int = 200) -> list[dict[str, Any]]:
    cap = max(1, min(int(limit or 200), 1000))
    with session_scope() as session:
        rows = session.execute(
            select(MessengerLead)
            .where(
                MessengerLead.workspace_owner_id == workspace_owner_id,
                MessengerLead.channel == channel,
            )
            .order_by(MessengerLead.received_at.desc())
            .limit(cap)
        ).scalars().all()
        return [
            {
                "id": row.id,
                "external_id": row.external_id,
                "full_name": row.full_name,
                "phone": row.phone,
                "email": row.email,
                "campaign_name": row.campaign_name,
                "form_name": row.form_name or row.form_id,
                "counterparty_id": row.counterparty_id or "",
                "crm_record_id": row.crm_record_id or "",
                "received_at": row.received_at.isoformat() if row.received_at else "",
                "fields": row.fields if isinstance(row.fields, dict) else {},
            }
            for row in rows
        ]


def unread_total(workspace_owner_id: str, *, channel: str = CHANNEL_INSTAGRAM) -> int:
    with session_scope() as session:
        value = session.execute(
            select(func.coalesce(func.sum(MessengerThread.unread_count), 0)).where(
                MessengerThread.workspace_owner_id == workspace_owner_id,
                MessengerThread.channel == channel,
            )
        ).scalar()
        return int(value or 0)

def find_workspace_by_instagram(*, account_id: str = "", verify_token: str = "") -> tuple[str, dict[str, Any]] | None:
    """Ищет рабочее пространство по аккаунту Instagram или проверочному слову.

    Веб-хук у приложения Meta один на всех, поэтому пространство определяется
    по идентификатору аккаунта из тела события. Аккаунт может быть записан
    двумя путями: кнопкой «Подключить Instagram» в настройках (social_links)
    или вручную в карточке интеграции.
    """
    from upos.db_models import WorkspaceSetting

    account = str(account_id or "").strip()
    token = str(verify_token or "").strip()
    if not account and not token:
        return None
    with session_scope() as session:
        rows = session.execute(select(WorkspaceSetting)).scalars().all()
        for row in rows:
            data = row.data if isinstance(row.data, dict) else {}
            config = (data.get("integrations") or {}).get(CHANNEL_INSTAGRAM)
            config = dict(config) if isinstance(config, dict) else {}
            social = data.get("social_links")
            social = social if isinstance(social, dict) else {}

            known_ids = {
                str(config.get("ig_user_id") or "").strip(),
                str(config.get("page_id") or "").strip(),
                str(social.get("instagram_business_id") or "").strip(),
                str(social.get("facebook_page_id") or "").strip(),
            }
            known_ids.discard("")
            if account and account in known_ids:
                return str(row.workspace_owner_id), config
            if token and token == str(config.get("verify_token") or "").strip():
                return str(row.workspace_owner_id), config
    return None
