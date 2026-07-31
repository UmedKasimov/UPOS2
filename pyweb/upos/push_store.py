"""Web Push: хранение подписок устройств и отправка уведомлений.

Подписка создаётся браузером (PushManager) и привязывается к паре
workspace + пользователь, поэтому одно уведомление можно адресно доставить на
все устройства конкретного сотрудника. Ключи VAPID задаются переменными
окружения; если их нет, отправка молча выключена — остальное приложение
работает как обычно.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import func, select

from upos.config import get_settings
from upos.db import session_scope
from upos.db_models import InstallationPushSubscription, UserNotification

logger = logging.getLogger(__name__)

# Коды, которыми push-сервис сообщает, что подписка мертва.
_GONE_STATUS_CODES = frozenset({404, 410})


def push_enabled() -> bool:
    settings = get_settings()
    return bool((settings.vapid_public_key or "").strip() and (settings.vapid_private_key or "").strip())


def public_key() -> str:
    return (get_settings().vapid_public_key or "").strip()


def _vapid_claims() -> dict[str, str]:
    email = (get_settings().vapid_contact_email or "").strip()
    return {"sub": f"mailto:{email}" if email else "mailto:admin@u-pos.uz"}


def _endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()


def save_subscription(
    workspace_owner_id: str,
    user_id: str,
    subscription: dict[str, Any],
    user_agent: str = "",
) -> bool:
    """Сохраняет подписку устройства. Повторная подписка того же браузера
    обновляет существующую запись, а не плодит дубли."""
    endpoint = str(subscription.get("endpoint") or "").strip()
    keys = subscription.get("keys") if isinstance(subscription.get("keys"), dict) else {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    if not endpoint or not p256dh or not auth:
        return False

    digest = _endpoint_hash(endpoint)
    with session_scope() as session:
        row = session.execute(
            select(InstallationPushSubscription).where(
                InstallationPushSubscription.workspace_owner_id == workspace_owner_id,
                InstallationPushSubscription.endpoint_hash == digest,
            )
        ).scalar_one_or_none()
        if row is None:
            row = InstallationPushSubscription(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                endpoint_hash=digest,
            )
            session.add(row)
        row.user_id = user_id
        row.endpoint = endpoint
        row.p256dh = p256dh[:255]
        row.auth = auth[:255]
        row.user_agent = str(user_agent or "")[:255]
        row.is_active = True
    return True


def drop_subscription(workspace_owner_id: str, endpoint: str) -> bool:
    endpoint = str(endpoint or "").strip()
    if not endpoint:
        return False
    with session_scope() as session:
        row = session.execute(
            select(InstallationPushSubscription).where(
                InstallationPushSubscription.workspace_owner_id == workspace_owner_id,
                InstallationPushSubscription.endpoint_hash == _endpoint_hash(endpoint),
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)
    return True


def has_subscription(workspace_owner_id: str, user_id: str) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(InstallationPushSubscription.id).where(
                InstallationPushSubscription.workspace_owner_id == workspace_owner_id,
                InstallationPushSubscription.user_id == user_id,
                InstallationPushSubscription.is_active.is_(True),
            ).limit(1)
        ).scalar_one_or_none()
    return bool(row)


def _deactivate(subscription_id: str) -> None:
    with session_scope() as session:
        row = session.get(InstallationPushSubscription, subscription_id)
        if row is not None:
            row.is_active = False


def _mark_used(subscription_id: str) -> None:
    with session_scope() as session:
        row = session.get(InstallationPushSubscription, subscription_id)
        if row is not None:
            row.last_used_at = datetime.now(timezone.utc)


def _store_notifications(
    workspace_owner_id: str,
    user_ids: list[str],
    *,
    title: str,
    body: str,
    url: str,
    tag: str,
) -> None:
    try:
        with session_scope() as session:
            for user_id in user_ids:
                session.add(
                    UserNotification(
                        id=str(uuid.uuid4()),
                        workspace_owner_id=workspace_owner_id,
                        user_id=user_id,
                        title=str(title or "")[:160],
                        body=str(body or ""),
                        url=str(url or "")[:255],
                        tag=str(tag or "")[:120],
                    )
                )
    except Exception:
        logger.exception("[upos] не удалось записать уведомление")


def list_notifications(workspace_owner_id: str, user_id: str, limit: int = 60) -> list[dict[str, Any]]:
    with session_scope() as session:
        rows = list(
            session.execute(
                select(UserNotification)
                .where(
                    UserNotification.workspace_owner_id == workspace_owner_id,
                    UserNotification.user_id == user_id,
                )
                .order_by(UserNotification.created_at.desc())
                .limit(max(1, min(int(limit or 60), 200)))
            ).scalars()
        )
        return [
            {
                "id": row.id,
                "title": row.title,
                "body": row.body,
                "url": row.url,
                "is_read": bool(row.is_read),
                "created_at": row.created_at.isoformat() if row.created_at else "",
            }
            for row in rows
        ]


def unread_count(workspace_owner_id: str, user_id: str) -> int:
    with session_scope() as session:
        return int(
            session.execute(
                select(func.count(UserNotification.id)).where(
                    UserNotification.workspace_owner_id == workspace_owner_id,
                    UserNotification.user_id == user_id,
                    UserNotification.is_read.is_(False),
                )
            ).scalar_one()
            or 0
        )


def mark_read(workspace_owner_id: str, user_id: str, notification_id: str = "") -> int:
    """Отмечает одно уведомление прочитанным или все сразу, если id не задан."""
    now = datetime.now(timezone.utc)
    with session_scope() as session:
        stmt = select(UserNotification).where(
            UserNotification.workspace_owner_id == workspace_owner_id,
            UserNotification.user_id == user_id,
            UserNotification.is_read.is_(False),
        )
        if notification_id:
            stmt = stmt.where(UserNotification.id == notification_id)
        rows = list(session.execute(stmt).scalars())
        for row in rows:
            row.is_read = True
            row.read_at = now
        return len(rows)


def notify_users(
    workspace_owner_id: str,
    user_ids: Iterable[str],
    *,
    title: str,
    body: str,
    url: str = "/installer",
    tag: str = "",
) -> dict[str, Any]:
    """Шлёт уведомление на все активные устройства указанных сотрудников.

    Ошибки доставки не поднимаются наверх: уведомление — побочный эффект
    бизнес-операции, и падение push-сервиса не должно ронять запрос.
    """
    targets = [str(uid).strip() for uid in user_ids if str(uid or "").strip()]
    if not targets:
        return {"ok": True, "sent": 0, "skipped": "no_targets"}

    # Историю пишем до отправки и независимо от неё: уведомление должно быть
    # видно в приложении, даже если push выключен или устройство не подписано.
    _store_notifications(workspace_owner_id, targets, title=title, body=body, url=url, tag=tag)

    if not push_enabled():
        return {"ok": True, "sent": 0, "skipped": "not_configured"}

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:  # pragma: no cover - зависимость объявлена в requirements
        logger.warning("[upos] pywebpush не установлен, push пропущен")
        return {"ok": False, "sent": 0, "skipped": "no_library"}

    with session_scope() as session:
        rows = list(
            session.execute(
                select(InstallationPushSubscription).where(
                    InstallationPushSubscription.workspace_owner_id == workspace_owner_id,
                    InstallationPushSubscription.user_id.in_(targets),
                    InstallationPushSubscription.is_active.is_(True),
                )
            ).scalars()
        )
        devices = [
            {
                "id": row.id,
                "endpoint": row.endpoint,
                "p256dh": row.p256dh,
                "auth": row.auth,
            }
            for row in rows
        ]

    if not devices:
        return {"ok": True, "sent": 0, "skipped": "no_devices"}

    payload = json.dumps(
        {
            "title": str(title or "U-POS")[:120],
            "body": str(body or "")[:300],
            "url": url or "/installer",
            "tag": tag or "",
        },
        ensure_ascii=False,
    )
    private_key = (get_settings().vapid_private_key or "").strip()
    sent = 0
    for device in devices:
        try:
            webpush(
                subscription_info={
                    "endpoint": device["endpoint"],
                    "keys": {"p256dh": device["p256dh"], "auth": device["auth"]},
                },
                data=payload,
                vapid_private_key=private_key,
                vapid_claims=dict(_vapid_claims()),
                ttl=3600,
            )
            sent += 1
            _mark_used(device["id"])
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", 0)
            if status in _GONE_STATUS_CODES:
                # Приложение удалили или разрешение отозвали — подписка больше
                # не нужна, иначе она будет отваливаться при каждой отправке.
                _deactivate(device["id"])
            else:
                logger.warning("[upos] push failed (%s): %s", status or "?", exc)
        except Exception:
            logger.exception("[upos] push failed unexpectedly")
    return {"ok": sent > 0, "sent": sent}
