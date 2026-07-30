"""Хранилище выездных установок: заказы, чек-листы и журнал действий.

Установка живёт рядом с продажей, но не внутри неё: продажа фиксирует деньги и
товар, установка — работу на объекте. Поэтому здесь отдельные таблицы, а связь с
sale_documents необязательная (SET NULL) — удаление продажи не должно стирать
историю выездов.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from upos.db import session_scope
from upos.db_models import (
    Counterparty,
    InstallationEvent,
    InstallationOrder,
    InstallationTask,
    InstallationTaskTemplate,
    User,
)

# Порядок соответствует процессу из ТЗ. Держим кортежем: важен и состав, и очерёдность.
INSTALLATION_STATUSES: tuple[tuple[str, str], ...] = (
    ("new", "Новый"),
    ("pending", "Ожидает принятия"),
    ("accepted", "Принят"),
    ("date_negotiation", "Согласование даты"),
    ("scheduled", "Запланирован"),
    ("en_route", "В пути"),
    ("started", "Установка начата"),
    ("in_progress", "Выполняется"),
    ("awaiting_payment", "Ожидает оплаты"),
    ("completed", "Завершён"),
    ("postponed", "Отложен"),
    ("cancelled", "Отменён"),
)

STATUS_LABELS: dict[str, str] = dict(INSTALLATION_STATUSES)

# Статусы, после которых установка больше не занимает слот в календаре.
CLOSED_STATUSES: frozenset[str] = frozenset({"completed", "cancelled"})

# Установщик не может выставить произвольный статус — только разрешённый переход.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "new": frozenset({"pending", "accepted", "date_negotiation", "cancelled"}),
    "pending": frozenset({"accepted", "date_negotiation", "cancelled"}),
    "accepted": frozenset({"date_negotiation", "scheduled", "en_route", "postponed", "cancelled"}),
    "date_negotiation": frozenset({"scheduled", "accepted", "postponed", "cancelled"}),
    "scheduled": frozenset({"en_route", "started", "date_negotiation", "postponed", "cancelled"}),
    "en_route": frozenset({"started", "postponed", "cancelled"}),
    "started": frozenset({"in_progress", "awaiting_payment", "completed", "postponed", "cancelled"}),
    "in_progress": frozenset({"awaiting_payment", "completed", "postponed", "cancelled"}),
    "awaiting_payment": frozenset({"completed", "postponed", "cancelled"}),
    "postponed": frozenset({"scheduled", "date_negotiation", "accepted", "cancelled"}),
    "completed": frozenset(),
    "cancelled": frozenset(),
}

PRIORITIES: tuple[tuple[str, str], ...] = (
    ("low", "Низкий"),
    ("normal", "Обычный"),
    ("high", "Высокий"),
    ("urgent", "Срочный"),
)

PRIORITY_LABELS: dict[str, str] = dict(PRIORITIES)


class InstallationError(ValueError):
    """Ошибка бизнес-правил установки, которую нужно показать пользователю."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    text = str(value if value is not None else "").strip().replace(" ", "").replace(",", ".")
    if not text:
        return Decimal("0")
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _clean(value: Any, limit: int = 0) -> str:
    text = str(value if value is not None else "").strip()
    return text[:limit] if limit else text


def status_label(status: str) -> str:
    return STATUS_LABELS.get(str(status or "").strip(), str(status or ""))


def can_transition(current: str, target: str) -> bool:
    return str(target or "") in ALLOWED_TRANSITIONS.get(str(current or ""), frozenset())


def log_event(
    session: Session,
    *,
    workspace_owner_id: str,
    order_id: str,
    kind: str,
    actor_user_id: str = "",
    actor_name: str = "",
    detail: str = "",
    payload: dict[str, Any] | None = None,
) -> InstallationEvent:
    """Пишет запись в журнал. Вызывается на каждое изменение, включая финансы."""
    event = InstallationEvent(
        id=str(uuid.uuid4()),
        workspace_owner_id=workspace_owner_id,
        installation_order_id=order_id,
        kind=_clean(kind, 40),
        actor_user_id=_clean(actor_user_id) or None,
        actor_name=_clean(actor_name, 160),
        detail=_clean(detail),
        payload=payload or {},
    )
    session.add(event)
    return event


def template_tasks(session: Session, workspace_owner_id: str, template_id: str) -> list[dict[str, Any]]:
    """Пункты шаблона. Пустой список, если шаблон не выбран или чужой."""
    clean_id = _clean(template_id)
    if not clean_id:
        return []
    row = session.get(InstallationTaskTemplate, clean_id)
    if not row or row.workspace_owner_id != workspace_owner_id:
        return []
    items = row.tasks if isinstance(row.tasks, list) else []
    result: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = _clean(item.get("title"), 200)
        if not title:
            continue
        result.append(
            {
                "title": title,
                "description": _clean(item.get("description")),
                "is_required": bool(item.get("is_required")),
            }
        )
    return result


def add_tasks(
    session: Session,
    *,
    workspace_owner_id: str,
    order_id: str,
    tasks: list[dict[str, Any]],
    start_order: int = 0,
) -> int:
    """Добавляет пункты чек-листа. Возвращает количество добавленных."""
    added = 0
    for index, item in enumerate(tasks):
        title = _clean(item.get("title"), 200)
        if not title:
            continue
        session.add(
            InstallationTask(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                installation_order_id=order_id,
                title=title,
                description=_clean(item.get("description")),
                is_required=bool(item.get("is_required")),
                sort_order=start_order + index,
            )
        )
        added += 1
    return added


def next_installation_number(session: Session, workspace_owner_id: str) -> str:
    """Сквозной номер вида У-000123 в пределах рабочего пространства."""
    count = int(
        session.scalar(
            select(func.count())
            .select_from(InstallationOrder)
            .where(InstallationOrder.workspace_owner_id == workspace_owner_id)
        )
        or 0
    )
    return f"У-{count + 1:06d}"


def create_installation(
    session: Session,
    *,
    workspace_owner_id: str,
    installer_user_id: str,
    created_by_user_id: str = "",
    actor_name: str = "",
    sale_document_id: str = "",
    counterparty_id: str = "",
    branch_id: str = "",
    scheduled_at: datetime | None = None,
    priority: str = "normal",
    address: str = "",
    latitude: str = "",
    longitude: str = "",
    amount: Any = 0,
    paid_amount: Any = 0,
    currency: str = "UZS",
    template_id: str = "",
    extra_tasks: list[dict[str, Any]] | None = None,
    comment: str = "",
    data: dict[str, Any] | None = None,
    external_source: str = "",
    external_id: str = "",
) -> InstallationOrder:
    """Создаёт установку и её чек-лист.

    Повторный вызов с тем же external_source/external_id возвращает существующую
    запись: продавец может нажать «Отправить установщику» дважды, и это не должно
    порождать два выезда.
    """
    clean_installer = _clean(installer_user_id)
    if not clean_installer:
        raise InstallationError("Выберите установщика")

    installer = session.get(User, clean_installer)
    # Сотрудник принадлежит пространству через employer_user_id, владелец — сам себе.
    if installer is None or (
        installer.employer_user_id != workspace_owner_id and installer.id != workspace_owner_id
    ):
        raise InstallationError("Установщик не найден в этой организации")

    source = _clean(external_source, 40)
    ext_id = _clean(external_id, 180)
    if source and ext_id:
        existing = session.scalar(
            select(InstallationOrder).where(
                InstallationOrder.workspace_owner_id == workspace_owner_id,
                InstallationOrder.external_source == source,
                InstallationOrder.external_id == ext_id,
            )
        )
        if existing is not None:
            return existing

    priority_key = _clean(priority) or "normal"
    if priority_key not in PRIORITY_LABELS:
        priority_key = "normal"

    order = InstallationOrder(
        id=str(uuid.uuid4()),
        workspace_owner_id=workspace_owner_id,
        number=next_installation_number(session, workspace_owner_id),
        sale_document_id=_clean(sale_document_id) or None,
        counterparty_id=_clean(counterparty_id) or None,
        branch_id=_clean(branch_id) or None,
        installer_user_id=clean_installer,
        created_by_user_id=_clean(created_by_user_id) or None,
        status="pending",
        priority=priority_key,
        scheduled_at=scheduled_at,
        scheduled_confirmed=False,
        address=_clean(address),
        latitude=_clean(latitude, 32),
        longitude=_clean(longitude, 32),
        amount=_decimal(amount),
        paid_amount=_decimal(paid_amount),
        currency=(_clean(currency, 3) or "UZS").upper(),
        data=data or {},
        external_source=source,
        external_id=ext_id,
    )
    session.add(order)
    session.flush()

    tasks = template_tasks(session, workspace_owner_id, template_id)
    tasks.extend(
        item
        for item in (extra_tasks or [])
        if isinstance(item, dict) and _clean(item.get("title"))
    )
    add_tasks(
        session,
        workspace_owner_id=workspace_owner_id,
        order_id=order.id,
        tasks=tasks,
    )

    log_event(
        session,
        workspace_owner_id=workspace_owner_id,
        order_id=order.id,
        kind="assignment",
        actor_user_id=created_by_user_id,
        actor_name=actor_name,
        detail=f"Назначен установщик: {installer.name or installer.username}",
        payload={
            "installer_user_id": clean_installer,
            "scheduled_at": scheduled_at.isoformat() if scheduled_at else "",
            "tasks": len(tasks),
            "comment": _clean(comment),
        },
    )
    return order


def set_status(
    session: Session,
    *,
    order: InstallationOrder,
    target: str,
    actor_user_id: str = "",
    actor_name: str = "",
    detail: str = "",
    payload: dict[str, Any] | None = None,
) -> None:
    """Меняет статус с проверкой допустимости перехода и записью в журнал."""
    current = str(order.status or "")
    clean_target = _clean(target, 32)
    if clean_target == current:
        return
    if clean_target not in STATUS_LABELS:
        raise InstallationError("Неизвестный статус установки")
    if not can_transition(current, clean_target):
        raise InstallationError(
            f"Нельзя перейти из «{status_label(current)}» в «{status_label(clean_target)}»"
        )

    order.status = clean_target
    now = _now()
    if clean_target == "accepted" and order.accepted_at is None:
        order.accepted_at = now
    if clean_target == "started" and order.started_at is None:
        order.started_at = now
    if clean_target == "completed":
        order.completed_at = now

    event_payload = {"from": current, "to": clean_target}
    if payload:
        event_payload.update(payload)
    log_event(
        session,
        workspace_owner_id=order.workspace_owner_id,
        order_id=order.id,
        kind="status",
        actor_user_id=actor_user_id,
        actor_name=actor_name,
        detail=detail or f"{status_label(current)} → {status_label(clean_target)}",
        payload=event_payload,
    )


def reschedule(
    session: Session,
    *,
    order: InstallationOrder,
    scheduled_at: datetime | None,
    actor_user_id: str = "",
    actor_name: str = "",
    reason: str = "",
    confirmed: bool = False,
) -> None:
    """Переносит дату выезда, сохраняя прежнее значение в журнале."""
    previous = order.scheduled_at
    order.scheduled_at = scheduled_at
    order.scheduled_confirmed = bool(confirmed)
    log_event(
        session,
        workspace_owner_id=order.workspace_owner_id,
        order_id=order.id,
        kind="schedule",
        actor_user_id=actor_user_id,
        actor_name=actor_name,
        detail=reason or "Изменена дата установки",
        payload={
            "from": previous.isoformat() if previous else "",
            "to": scheduled_at.isoformat() if scheduled_at else "",
            "confirmed": bool(confirmed),
        },
    )


def busy_conflicts(
    session: Session,
    *,
    workspace_owner_id: str,
    installer_user_id: str,
    scheduled_at: datetime | None,
    exclude_order_id: str = "",
    window_minutes: int = 60,
) -> list[InstallationOrder]:
    """Установки того же мастера, попадающие в окно вокруг времени выезда.

    Не блокирует назначение — только даёт основание предупредить продавца.
    """
    if scheduled_at is None or not installer_user_id:
        return []
    delta = abs(int(window_minutes)) * 60
    rows = list(
        session.execute(
            select(InstallationOrder).where(
                InstallationOrder.workspace_owner_id == workspace_owner_id,
                InstallationOrder.installer_user_id == installer_user_id,
                InstallationOrder.scheduled_at.is_not(None),
                InstallationOrder.status.notin_(tuple(CLOSED_STATUSES)),
            )
        ).scalars()
    )
    conflicts: list[InstallationOrder] = []
    for row in rows:
        if exclude_order_id and row.id == exclude_order_id:
            continue
        other = row.scheduled_at
        if other is None:
            continue
        if abs((other - scheduled_at).total_seconds()) < delta:
            conflicts.append(row)
    return conflicts


def order_tasks(session: Session, order_id: str) -> list[InstallationTask]:
    return list(
        session.execute(
            select(InstallationTask)
            .where(InstallationTask.installation_order_id == order_id)
            .order_by(InstallationTask.sort_order.asc(), InstallationTask.created_at.asc())
        ).scalars()
    )


def task_progress(tasks: list[InstallationTask]) -> dict[str, Any]:
    total = len(tasks)
    done = sum(1 for task in tasks if task.is_done)
    required_left = [task for task in tasks if task.is_required and not task.is_done]
    return {
        "total": total,
        "done": done,
        "percent": int(round(done * 100 / total)) if total else 0,
        "required_left": len(required_left),
        "required_titles": [task.title for task in required_left],
        "label": f"Выполнено {done} из {total}" if total else "Задач нет",
    }


def completion_blockers(
    order: InstallationOrder,
    tasks: list[InstallationTask],
    *,
    require_photo: bool = False,
) -> list[str]:
    """Что мешает нажать «Завершить установку». Пустой список — можно завершать."""
    blockers: list[str] = []
    progress = task_progress(tasks)
    if progress["required_left"]:
        titles = ", ".join(progress["required_titles"][:3])
        blockers.append(f"Не выполнены обязательные задачи: {titles}")
    if require_photo and not any(task.photo_path for task in tasks):
        blockers.append("Приложите хотя бы одно фото результата")
    data = order.data if isinstance(order.data, dict) else {}
    if not _clean(data.get("result_comment")):
        blockers.append("Укажите итоговый комментарий по установке")
    return blockers


def installer_orders(
    session: Session,
    *,
    workspace_owner_id: str,
    installer_user_id: str,
    statuses: tuple[str, ...] = (),
) -> list[InstallationOrder]:
    """Заказы конкретного установщика. Основа изоляции доступа в мобильном API."""
    query = select(InstallationOrder).where(
        InstallationOrder.workspace_owner_id == workspace_owner_id,
        InstallationOrder.installer_user_id == installer_user_id,
    )
    if statuses:
        query = query.where(InstallationOrder.status.in_(statuses))
    return list(
        session.execute(query.order_by(InstallationOrder.scheduled_at.asc().nulls_last())).scalars()
    )


def client_contact(session: Session, counterparty_id: str | None) -> dict[str, str]:
    """Имя, телефон и адрес клиента для карточки установки."""
    if not counterparty_id:
        return {"name": "", "phone": "", "address": ""}
    row = session.get(Counterparty, counterparty_id)
    if row is None:
        return {"name": "", "phone": "", "address": ""}
    data = row.data if isinstance(row.data, dict) else {}
    return {
        "name": _clean(row.name),
        "phone": _clean(data.get("phone")),
        "address": _clean(data.get("address")),
    }


def load_order(
    session: Session,
    *,
    workspace_owner_id: str,
    order_id: str,
    installer_user_id: str = "",
) -> InstallationOrder | None:
    """Загружает установку с проверкой владельца и (опционально) исполнителя."""
    row = session.get(InstallationOrder, _clean(order_id))
    if row is None or row.workspace_owner_id != workspace_owner_id:
        return None
    if installer_user_id and row.installer_user_id != installer_user_id:
        return None
    return row


def list_templates(workspace_owner_id: str) -> list[dict[str, Any]]:
    """Активные шаблоны чек-листов для выпадающего списка у продавца."""
    with session_scope() as session:
        rows = list(
            session.execute(
                select(InstallationTaskTemplate)
                .where(
                    InstallationTaskTemplate.workspace_owner_id == workspace_owner_id,
                    InstallationTaskTemplate.is_active.is_(True),
                )
                .order_by(
                    InstallationTaskTemplate.sort_order.asc(),
                    InstallationTaskTemplate.name.asc(),
                )
            ).scalars()
        )
        return [
            {
                "id": row.id,
                "name": row.name,
                "note": row.note,
                "task_count": len(row.tasks if isinstance(row.tasks, list) else []),
            }
            for row in rows
        ]
