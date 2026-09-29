"""Заработок сотрудников: начисления, выплаты и акт сверки.

Начисление создаётся автоматически, когда установка переходит в статус
«Завершён»: сумма считается по ставке сотрудника — процент от суммы заказа либо
фиксированная сумма за выезд. Руководитель может добавить начисление или
выплату вручную. Остаток к выплате — начислено минус выплачено.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from upos.db import session_scope
from upos.db_models import EmployeeEarning, InstallationOrder, SaleDocument, User
from upos.storage import load_workspace_settings, save_workspace_settings

logger = logging.getLogger(__name__)

RATE_TYPES = (("percent", "Процент от суммы заказа"), ("fixed", "Фиксировано за заказ"))
_SETTINGS_KEY = "employee_earning_rules"
_ZERO = Decimal("0.00")


def _money(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return _ZERO


def _clean_rule(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    rate_type = str(src.get("type") or "percent").strip()
    if rate_type not in {key for key, _ in RATE_TYPES}:
        rate_type = "percent"
    try:
        value = Decimal(str(src.get("value") or 0))
    except Exception:
        value = _ZERO
    if value < 0:
        value = _ZERO
    # Процент выше 100 почти всегда опечатка и уводит расчёт в минус по марже.
    if rate_type == "percent" and value > 100:
        value = Decimal("100")
    return {"type": rate_type, "value": str(value)}


def _clean_service_percent(raw: Any) -> str:
    """Процент бонуса за услугу: 0..100, пусто — ставка не задана."""
    try:
        value = Decimal(str(raw or 0))
    except Exception:
        value = _ZERO
    if value < 0:
        value = _ZERO
    if value > 100:
        value = Decimal("100")
    return str(value)


def load_rules(workspace_owner_id: str) -> dict[str, Any]:
    raw = load_workspace_settings(workspace_owner_id).get(_SETTINGS_KEY)
    src = raw if isinstance(raw, dict) else {}
    by_user_raw = src.get("by_user") if isinstance(src.get("by_user"), dict) else {}
    by_service_raw = src.get("by_service") if isinstance(src.get("by_service"), dict) else {}
    return {
        "default": _clean_rule(src.get("default")),
        "by_user": {str(key): _clean_rule(value) for key, value in by_user_raw.items() if str(key or "").strip()},
        "by_service": {
            str(key): _clean_service_percent(value)
            for key, value in by_service_raw.items()
            if str(key or "").strip() and _money(value) > 0
        },
    }


def save_rules(
    workspace_owner_id: str,
    default_rule: Any,
    by_user: dict[str, Any] | None = None,
    by_service: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rules = {
        "default": _clean_rule(default_rule),
        "by_user": {
            str(key): _clean_rule(value)
            for key, value in (by_user or {}).items()
            if str(key or "").strip()
        },
        "by_service": {
            str(key): _clean_service_percent(value)
            for key, value in (by_service or {}).items()
            if str(key or "").strip() and _money(value) > 0
        },
    }
    settings = load_workspace_settings(workspace_owner_id)
    settings[_SETTINGS_KEY] = rules
    save_workspace_settings(workspace_owner_id, settings)
    return rules


def service_bonus_for_order(
    session: Session,
    order: InstallationOrder,
    by_service: dict[str, str],
) -> tuple[Decimal, list[dict[str, str]]]:
    """Бонус за услуги в заказе: процент от суммы строки услуги.

    Услуга «прикрепляется» ставкой в правилах — строки заказа сверяются по
    product_id. Возвращает сумму бонуса и детализацию для записи начисления.
    """
    if not by_service or not order.sale_document_id:
        return _ZERO, []
    sale = session.get(SaleDocument, str(order.sale_document_id))
    if sale is None or sale.workspace_owner_id != order.workspace_owner_id:
        return _ZERO, []
    data = sale.data if isinstance(sale.data, dict) else {}
    total_bonus = _ZERO
    details: list[dict[str, str]] = []
    for line in data.get("lines") or []:
        if not isinstance(line, dict):
            continue
        product_id = str(line.get("product_id") or "").strip()
        percent_raw = by_service.get(product_id)
        if not percent_raw:
            continue
        line_total = _money(line.get("total"))
        if line_total <= 0:
            line_total = _money(line.get("price")) * _money(line.get("quantity"))
        if line_total <= 0:
            continue
        bonus = _money(line_total * _money(percent_raw) / Decimal("100"))
        if bonus <= 0:
            continue
        total_bonus += bonus
        details.append(
            {
                "product_id": product_id,
                "product": str(line.get("product") or ""),
                "line_total": str(line_total),
                "percent": str(percent_raw),
                "bonus": str(bonus),
            }
        )
    return total_bonus, details


def rule_for_user(workspace_owner_id: str, user_id: str) -> dict[str, Any]:
    rules = load_rules(workspace_owner_id)
    return rules["by_user"].get(str(user_id or ""), rules["default"])


def calculate_amount(rule: dict[str, Any], order_amount: Any) -> Decimal:
    value = _money(rule.get("value"))
    if str(rule.get("type") or "percent") == "fixed":
        return value
    return _money(_money(order_amount) * value / Decimal("100"))


def accrue_for_installation(session: Session, order: InstallationOrder) -> EmployeeEarning | None:
    """Начисляет вознаграждение установщику за завершённый заказ.

    Вызывается в той же транзакции, что и смена статуса, поэтому откат заказа
    отменит и начисление. Повторный вызов ничего не создаёт: на пару
    (заказ, вид записи) стоит уникальный индекс, а до вставки идёт проверка.
    """
    installer_id = str(order.installer_user_id or "").strip()
    if not installer_id:
        return None

    existing = session.execute(
        select(EmployeeEarning.id).where(
            EmployeeEarning.installation_order_id == order.id,
            EmployeeEarning.kind == "accrual",
        ).limit(1)
    ).scalar_one_or_none()
    if existing:
        return None

    rules = load_rules(order.workspace_owner_id)
    rule = rules["by_user"].get(installer_id, rules["default"])
    base_amount = calculate_amount(rule, order.amount)
    # Бонус за услуги: к прикреплённым услугам в заказе добавляется процент
    # от суммы строки — поверх базовой ставки установщика.
    service_bonus, service_details = service_bonus_for_order(session, order, rules["by_service"])
    amount = base_amount + service_bonus
    if amount <= 0:
        return None

    row = EmployeeEarning(
        id=str(uuid.uuid4()),
        workspace_owner_id=order.workspace_owner_id,
        employee_user_id=installer_id,
        kind="accrual",
        amount=amount,
        currency=str(order.currency or "UZS").upper()[:3] or "UZS",
        source="installation",
        installation_order_id=order.id,
        title=f"Установка {order.number}".strip(),
        earned_on=(order.completed_at.date() if order.completed_at else date.today()).isoformat(),
        data={
            "rate_type": rule.get("type"),
            "rate_value": rule.get("value"),
            "base_amount": str(base_amount),
            "service_bonus": str(service_bonus),
            "service_details": service_details,
            "order_amount": str(_money(order.amount)),
            "order_number": str(order.number or ""),
        },
    )
    session.add(row)
    return row


def add_entry(
    workspace_owner_id: str,
    *,
    employee_user_id: str,
    kind: str,
    amount: Any,
    currency: str = "UZS",
    title: str = "",
    note: str = "",
    earned_on: str = "",
    created_by_user_id: str = "",
) -> dict[str, Any]:
    clean_kind = "payout" if str(kind or "").strip() == "payout" else "accrual"
    value = _money(amount)
    if value <= 0:
        raise ValueError("Сумма должна быть больше нуля")
    if not str(employee_user_id or "").strip():
        raise ValueError("Выберите сотрудника")

    row_id = str(uuid.uuid4())
    with session_scope() as session:
        employee = session.get(User, str(employee_user_id).strip())
        if employee is None or employee.employer_user_id != workspace_owner_id:
            raise ValueError("Сотрудник не найден")
        session.add(
            EmployeeEarning(
                id=row_id,
                workspace_owner_id=workspace_owner_id,
                employee_user_id=str(employee_user_id).strip(),
                kind=clean_kind,
                amount=value,
                currency=str(currency or "UZS").upper()[:3] or "UZS",
                source="manual",
                title=str(title or "").strip()[:255],
                note=str(note or "").strip(),
                earned_on=str(earned_on or "").strip()[:10] or date.today().isoformat(),
                created_by_user_id=str(created_by_user_id or "").strip() or None,
            )
        )
    return {"id": row_id, "kind": clean_kind, "amount": str(value)}


def delete_entry(workspace_owner_id: str, entry_id: str) -> bool:
    with session_scope() as session:
        row = session.get(EmployeeEarning, str(entry_id or "").strip())
        if row is None or row.workspace_owner_id != workspace_owner_id:
            return False
        session.delete(row)
    return True


def _period_filters(stmt: Any, date_from: str = "", date_to: str = ""):
    if date_from:
        stmt = stmt.where(EmployeeEarning.earned_on >= date_from)
    if date_to:
        stmt = stmt.where(EmployeeEarning.earned_on <= date_to)
    return stmt


def summary_by_employee(
    workspace_owner_id: str,
    *,
    date_from: str = "",
    date_to: str = "",
    employee_user_id: str = "",
) -> list[dict[str, Any]]:
    """Итоги по каждому сотруднику: начислено, выплачено, остаток."""
    with session_scope() as session:
        stmt = (
            select(
                EmployeeEarning.employee_user_id,
                EmployeeEarning.kind,
                EmployeeEarning.currency,
                func.sum(EmployeeEarning.amount),
                func.count(EmployeeEarning.id),
            )
            .where(EmployeeEarning.workspace_owner_id == workspace_owner_id)
            .group_by(
                EmployeeEarning.employee_user_id,
                EmployeeEarning.kind,
                EmployeeEarning.currency,
            )
        )
        if employee_user_id:
            stmt = stmt.where(EmployeeEarning.employee_user_id == employee_user_id)
        stmt = _period_filters(stmt, date_from, date_to)
        rows = session.execute(stmt).all()

        employees = {
            str(user.id): str(user.name or user.username or "Сотрудник")
            for user in session.execute(
                select(User).where(User.employer_user_id == workspace_owner_id)
            ).scalars()
        }

    buckets: dict[str, dict[str, Any]] = {}
    for user_id, kind, currency, total, count in rows:
        uid = str(user_id or "")
        bucket = buckets.setdefault(
            uid,
            {
                "employee_user_id": uid,
                "employee_name": employees.get(uid, "Сотрудник"),
                "accrued": {},
                "paid": {},
                "balance": {},
                "entries": 0,
            },
        )
        key = "paid" if kind == "payout" else "accrued"
        cur = str(currency or "UZS")
        bucket[key][cur] = _money(bucket[key].get(cur, 0)) + _money(total)
        bucket["entries"] += int(count or 0)

    result = []
    for bucket in buckets.values():
        currencies = set(bucket["accrued"]) | set(bucket["paid"])
        for cur in currencies:
            bucket["balance"][cur] = _money(bucket["accrued"].get(cur, 0)) - _money(bucket["paid"].get(cur, 0))
        result.append(bucket)
    result.sort(key=lambda item: item["employee_name"].lower())
    return result


def list_entries(
    workspace_owner_id: str,
    *,
    employee_user_id: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 300,
) -> list[dict[str, Any]]:
    with session_scope() as session:
        stmt = (
            select(EmployeeEarning)
            .where(EmployeeEarning.workspace_owner_id == workspace_owner_id)
            .order_by(EmployeeEarning.earned_on.desc(), EmployeeEarning.created_at.desc())
            .limit(max(1, min(int(limit or 300), 1000)))
        )
        if employee_user_id:
            stmt = stmt.where(EmployeeEarning.employee_user_id == employee_user_id)
        stmt = _period_filters(stmt, date_from, date_to)
        rows = list(session.execute(stmt).scalars())

        employees = {
            str(user.id): str(user.name or user.username or "Сотрудник")
            for user in session.execute(
                select(User).where(User.employer_user_id == workspace_owner_id)
            ).scalars()
        }
        return [
            {
                "id": row.id,
                "employee_user_id": row.employee_user_id,
                "employee_name": employees.get(str(row.employee_user_id), "Сотрудник"),
                "kind": row.kind,
                "kind_label": "Выплата" if row.kind == "payout" else "Начисление",
                "amount": _money(row.amount),
                "currency": row.currency,
                "source": row.source,
                "title": row.title,
                "note": row.note,
                "earned_on": row.earned_on,
                "installation_order_id": row.installation_order_id or "",
                "data": row.data if isinstance(row.data, dict) else {},
            }
            for row in rows
        ]


def settlement_act(
    workspace_owner_id: str,
    employee_user_id: str,
    *,
    date_from: str = "",
    date_to: str = "",
) -> dict[str, Any]:
    """Акт сверки по сотруднику: начисления, выплаты и остаток за период."""
    entries = list_entries(
        workspace_owner_id,
        employee_user_id=employee_user_id,
        date_from=date_from,
        date_to=date_to,
        limit=1000,
    )
    totals = summary_by_employee(
        workspace_owner_id,
        date_from=date_from,
        date_to=date_to,
        employee_user_id=employee_user_id,
    )
    summary = totals[0] if totals else {
        "employee_user_id": employee_user_id,
        "employee_name": "Сотрудник",
        "accrued": {},
        "paid": {},
        "balance": {},
        "entries": 0,
    }
    return {
        "employee_user_id": employee_user_id,
        "employee_name": summary["employee_name"],
        "date_from": date_from,
        "date_to": date_to,
        "accrued": summary["accrued"],
        "paid": summary["paid"],
        "balance": summary["balance"],
        "accruals": [item for item in entries if item["kind"] == "accrual"],
        "payouts": [item for item in entries if item["kind"] == "payout"],
    }
