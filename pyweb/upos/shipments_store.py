from __future__ import annotations

import calendar
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func, select, text

from upos.db import session_scope
from upos.db_models import (
    DeliveryShipment,
    DeliveryShipmentItem,
    HrAttendance,
    HrEmployee,
    Position,
    Transaction,
)

COURIER_PAYMENT_CATEGORY = "Оплата от доставщиков"


def _clean_text(raw: Any, max_len: int | None = None) -> str:
    value = str(raw or "").strip()
    if max_len and len(value) > max_len:
        return value[:max_len]
    return value


def _money(raw: Any) -> Decimal:
    text_raw = str(raw or "0").strip()
    text_raw = text_raw.replace("\u00a0", "").replace("\u202f", "").replace(" ", "").replace("'", "")
    if "," in text_raw and "." in text_raw:
        text_raw = text_raw.replace(",", "")
    elif text_raw.count(",") > 1:
        text_raw = text_raw.replace(",", "")
    elif "," in text_raw:
        text_raw = text_raw.replace(",", ".")
    try:
        value = Decimal(text_raw or "0").quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("invalid_amount") from exc
    if value < 0:
        raise ValueError("invalid_amount")
    return value


def _money_out(raw: Any) -> float:
    return float(Decimal(str(raw or "0")).quantize(Decimal("0.01")))


def _date_str(raw: Any) -> str:
    value = _clean_text(raw, 10)
    if value:
        try:
            datetime.strptime(value, "%Y-%m-%d")
            return value
        except ValueError:
            pass
    return datetime.now().strftime("%Y-%m-%d")


def _month_key(raw: Any) -> tuple[str, int, int]:
    value = _date_str(raw)
    dt = datetime.strptime(value, "%Y-%m-%d")
    return value, dt.year, dt.month


def _currency(raw: Any) -> str:
    value = _clean_text(raw, 3).upper()
    return value if len(value) == 3 and value.isalpha() else "UZS"


def _doc_status(raw: Any) -> str:
    value = _clean_text(raw, 20).lower()
    return "confirmed" if value == "confirmed" else "new"


def _employee_full_name(row: HrEmployee | None) -> str:
    if row is None:
        return ""
    return _clean_text(f"{row.first_name or ''} {row.last_name or ''}", 255)


def _status_from_amounts(total: Decimal, paid: Decimal) -> str:
    if total <= 0:
        return "paid"
    if paid <= 0:
        return "open"
    if paid >= total:
        return "paid"
    return "partial"


def _attendance_salary(monthly_salary: Decimal, present_days: int, year: int, month: int) -> Decimal:
    days_in_month = calendar.monthrange(year, month)[1]
    if days_in_month <= 0 or present_days <= 0:
        return Decimal("0.00")
    return (monthly_salary / Decimal(days_in_month) * Decimal(present_days)).quantize(Decimal("0.01"))


def _bool_flag(raw: Any) -> bool:
    return str(raw or "").strip().lower() in {"1", "true", "on", "yes", "y"}


def _employee_to_dict(
    row: HrEmployee,
    attendance_map: dict[str, str],
    year: int,
    month: int,
    position_row: Position | None = None,
    attendance_notes: dict[str, str] | None = None,
) -> dict[str, Any]:
    present_days = sum(1 for status in attendance_map.values() if status == "present")
    absent_days = sum(1 for status in attendance_map.values() if status == "absent")
    salary = Decimal(str(row.monthly_salary or "0"))
    salary_due = _attendance_salary(salary, present_days, year, month)
    photo_path = _clean_text(row.photo_path, 255)
    return {
        "id": row.id,
        "first_name": row.first_name or "",
        "last_name": row.last_name or "",
        "full_name": _employee_full_name(row),
        "position_id": row.position_id or "",
        "position": (position_row.name if position_row is not None else "") or row.position or "",
        "passport_series": row.passport_series or "",
        "passport_number": row.passport_number or "",
        "photo_path": photo_path,
        "photo_url": f"/static/{photo_path}" if photo_path else "",
        "monthly_salary": _money_out(row.monthly_salary),
        "monthly_salary_label": _amount_label(row.monthly_salary),
        "is_courier": bool(row.is_courier),
        "status": row.status or "active",
        "hired_at": row.hired_at or "",
        "dismissed_at": row.dismissed_at or "",
        "present_days": present_days,
        "absent_days": absent_days,
        "salary_due": _money_out(salary_due),
        "salary_due_label": _amount_label(salary_due),
        "attendance": dict(sorted(attendance_map.items())),
        "attendance_notes": dict(sorted((attendance_notes or {}).items())),
    }


def _amount_label(raw: Any) -> str:
    value = _money_out(raw)
    return f"{value:,.0f}".replace(",", " ")


def _position_name(raw: Any) -> str:
    return _clean_text(raw, 160)


def _position_to_dict(row: Position) -> dict[str, Any]:
    created = row.created_at.isoformat() if row.created_at else ""
    return {
        "id": row.id,
        "name": row.name or "",
        "organization_id": row.organization_id or "",
        "created_at": created,
    }


def _find_position_by_name(session, organization_id: str, name: str) -> Position | None:
    clean = _position_name(name)
    if not clean:
        return None
    return session.execute(
        select(Position).where(
            Position.organization_id == organization_id,
            func.lower(Position.name) == clean.lower(),
        )
    ).scalar_one_or_none()


def _ensure_position_row(session, organization_id: str, name: str) -> Position | None:
    clean = _position_name(name)
    if not clean:
        return None
    existing = _find_position_by_name(session, organization_id, clean)
    if existing is not None:
        return existing
    row = Position(
        id=str(uuid.uuid4()),
        organization_id=organization_id,
        name=clean,
    )
    session.add(row)
    session.flush()
    return row


def _position_by_id(session, organization_id: str, position_id: str) -> Position | None:
    clean_id = _clean_text(position_id, 36)
    if not clean_id:
        return None
    return session.execute(
        select(Position).where(
            Position.id == clean_id,
            Position.organization_id == organization_id,
        )
    ).scalar_one_or_none()


def _sync_legacy_employee_positions(session, organization_id: str, employees: list[HrEmployee]) -> dict[str, Position]:
    by_id: dict[str, Position] = {}
    existing_ids = [row.position_id for row in employees if row.position_id]
    if existing_ids:
        rows = session.execute(
            select(Position).where(
                Position.organization_id == organization_id,
                Position.id.in_(existing_ids),
            )
        ).scalars().all()
        by_id = {row.id: row for row in rows}
    for employee in employees:
        if employee.position_id and employee.position_id in by_id:
            employee.position = by_id[employee.position_id].name or employee.position or ""
            continue
        if employee.position:
            row = _ensure_position_row(session, organization_id, employee.position)
            if row is not None:
                employee.position_id = row.id
                employee.position = row.name
                by_id[row.id] = row
    return by_id


def list_positions(organization_id: str) -> list[dict[str, Any]]:
    org_id = _clean_text(organization_id, 36)
    if not org_id:
        return []
    with session_scope() as session:
        employees = session.execute(
            select(HrEmployee).where(HrEmployee.workspace_owner_id == org_id)
        ).scalars().all()
        if employees:
            _sync_legacy_employee_positions(session, org_id, list(employees))
        rows = session.execute(
            select(Position)
            .where(Position.organization_id == org_id)
            .order_by(func.lower(Position.name), Position.created_at)
        ).scalars().all()
        return [_position_to_dict(row) for row in rows]


def create_position(organization_id: str, name: str) -> dict[str, Any]:
    org_id = _clean_text(organization_id, 36)
    clean = _position_name(name)
    if not org_id:
        raise ValueError("organization_required")
    if not clean:
        raise ValueError("position_name_required")
    with session_scope() as session:
        row = _ensure_position_row(session, org_id, clean)
        assert row is not None
        return _position_to_dict(row)


def update_position(organization_id: str, position_id: str, name: str) -> dict[str, Any] | None:
    org_id = _clean_text(organization_id, 36)
    clean = _position_name(name)
    if not org_id:
        raise ValueError("organization_required")
    if not clean:
        raise ValueError("position_name_required")
    with session_scope() as session:
        row = _position_by_id(session, org_id, position_id)
        if row is None:
            return None
        duplicate = _find_position_by_name(session, org_id, clean)
        if duplicate is not None and duplicate.id != row.id:
            raise ValueError("position_exists")
        row.name = clean
        session.execute(
            text("UPDATE hr_employees SET position = :name WHERE workspace_owner_id = :org_id AND position_id = :position_id"),
            {"name": clean, "org_id": org_id, "position_id": row.id},
        )
        session.flush()
        return _position_to_dict(row)


def delete_position(organization_id: str, position_id: str) -> bool:
    org_id = _clean_text(organization_id, 36)
    if not org_id:
        raise ValueError("organization_required")
    with session_scope() as session:
        row = _position_by_id(session, org_id, position_id)
        if row is None:
            return False
        session.execute(
            text("UPDATE hr_employees SET position_id = NULL, position = '' WHERE workspace_owner_id = :org_id AND position_id = :position_id"),
            {"org_id": org_id, "position_id": row.id},
        )
        session.delete(row)
        session.flush()
        return True


def list_hr_employees(workspace_owner_id: str, selected_date: str | None = None) -> list[dict[str, Any]]:
    selected, year, month = _month_key(selected_date)
    month_prefix = selected[:7]
    with session_scope() as session:
        employees = session.execute(
            select(HrEmployee)
            .where(HrEmployee.workspace_owner_id == workspace_owner_id)
            .order_by(HrEmployee.status, HrEmployee.last_name, HrEmployee.first_name, HrEmployee.created_at)
        ).scalars().all()
        ids = [row.id for row in employees]
        attendance_rows = []
        if ids:
            attendance_rows = session.execute(
                select(HrAttendance)
                .where(
                    HrAttendance.workspace_owner_id == workspace_owner_id,
                    HrAttendance.employee_id.in_(ids),
                    HrAttendance.work_date >= f"{month_prefix}-01",
                    HrAttendance.work_date <= f"{month_prefix}-31",
                )
            ).scalars().all()
        positions_by_id = _sync_legacy_employee_positions(session, workspace_owner_id, list(employees))
        grouped: dict[str, dict[str, str]] = {eid: {} for eid in ids}
        notes_grouped: dict[str, dict[str, str]] = {eid: {} for eid in ids}
        for item in attendance_rows:
            grouped.setdefault(item.employee_id, {})[item.work_date] = item.status
            if item.note:
                notes_grouped.setdefault(item.employee_id, {})[item.work_date] = item.note
        return [
            _employee_to_dict(
                row,
                grouped.get(row.id, {}),
                year,
                month,
                positions_by_id.get(row.position_id or ""),
                notes_grouped.get(row.id, {}),
            )
            for row in employees
        ]


def create_hr_employee(workspace_owner_id: str, data: dict[str, Any]) -> dict[str, Any]:
    first_name = _clean_text(data.get("first_name"), 120)
    last_name = _clean_text(data.get("last_name"), 120)
    if not first_name and not last_name:
        raise ValueError("employee_name_required")
    with session_scope() as session:
        position_row = _position_by_id(session, workspace_owner_id, data.get("position_id") or "")
        if position_row is None:
            position_row = _ensure_position_row(session, workspace_owner_id, data.get("position") or "")
        row = HrEmployee(
            id=str(uuid.uuid4()),
            workspace_owner_id=workspace_owner_id,
            first_name=first_name,
            last_name=last_name,
            position_id=position_row.id if position_row is not None else None,
            position=position_row.name if position_row is not None else _clean_text(data.get("position"), 160),
            passport_series=_clean_text(data.get("passport_series"), 16).upper(),
            passport_number=_clean_text(data.get("passport_number"), 32),
            photo_path=_clean_text(data.get("photo_path"), 255) or None,
            monthly_salary=_money(data.get("monthly_salary")),
            is_courier=_bool_flag(data.get("is_courier")),
            status="active",
            hired_at=_date_str(data.get("hired_at")),
        )
        session.add(row)
        session.flush()
        return _employee_to_dict(row, {}, *(_month_key(row.hired_at)[1:]), position_row)


def update_hr_employee(workspace_owner_id: str, employee_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    first_name = _clean_text(data.get("first_name"), 120)
    last_name = _clean_text(data.get("last_name"), 120)
    if not first_name and not last_name:
        raise ValueError("employee_name_required")
    with session_scope() as session:
        row = session.execute(
            select(HrEmployee).where(
                HrEmployee.id == employee_id,
                HrEmployee.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        position_row = _position_by_id(session, workspace_owner_id, data.get("position_id") or "")
        if position_row is None:
            position_row = _ensure_position_row(session, workspace_owner_id, data.get("position") or "")
        row.first_name = first_name
        row.last_name = last_name
        row.position_id = position_row.id if position_row is not None else None
        row.position = position_row.name if position_row is not None else _clean_text(data.get("position"), 160)
        row.passport_series = _clean_text(data.get("passport_series"), 16).upper()
        row.passport_number = _clean_text(data.get("passport_number"), 32)
        row.monthly_salary = _money(data.get("monthly_salary"))
        row.is_courier = _bool_flag(data.get("is_courier"))
        row.hired_at = _date_str(data.get("hired_at"))
        photo_path = _clean_text(data.get("photo_path"), 255)
        if photo_path:
            row.photo_path = photo_path
        session.flush()
        return _employee_to_dict(row, {}, *(_month_key(row.hired_at)[1:]), position_row)


def dismiss_hr_employee(workspace_owner_id: str, employee_id: str, dismissed_at: str | None = None) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(HrEmployee).where(
                HrEmployee.id == employee_id,
                HrEmployee.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        row.status = "dismissed"
        row.dismissed_at = _date_str(dismissed_at)
        session.flush()
        return True


def restore_hr_employee(workspace_owner_id: str, employee_id: str) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(HrEmployee).where(
                HrEmployee.id == employee_id,
                HrEmployee.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        row.status = "active"
        row.dismissed_at = ""
        session.flush()
        return True


def delete_hr_employee_permanently(workspace_owner_id: str, employee_id: str) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(HrEmployee).where(
                HrEmployee.id == employee_id,
                HrEmployee.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        session.execute(
            text(
                "UPDATE delivery_shipments "
                "SET employee_id = NULL "
                "WHERE workspace_owner_id = :workspace_owner_id AND employee_id = :employee_id"
            ),
            {"workspace_owner_id": workspace_owner_id, "employee_id": employee_id},
        )
        session.delete(row)
        session.flush()
        return True


def set_hr_attendance(
    workspace_owner_id: str,
    employee_id: str,
    work_date: str,
    status: str,
    note: str = "",
) -> bool:
    clean_status = _clean_text(status, 16).lower()
    if clean_status not in {"present", "absent"}:
        raise ValueError("invalid_attendance_status")
    day = _date_str(work_date)
    with session_scope() as session:
        employee = session.execute(
            select(HrEmployee).where(
                HrEmployee.id == employee_id,
                HrEmployee.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if employee is None:
            return False
        row = session.execute(
            select(HrAttendance).where(
                HrAttendance.employee_id == employee_id,
                HrAttendance.work_date == day,
            )
        ).scalar_one_or_none()
        if row is None:
            row = HrAttendance(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                employee_id=employee_id,
                work_date=day,
                status=clean_status,
                note=_clean_text(note, 500),
            )
            session.add(row)
        else:
            row.status = clean_status
            row.note = _clean_text(note, 500)
        session.flush()
        return True


def set_hr_attendance_day(
    workspace_owner_id: str,
    work_date: str,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    day = _date_str(work_date)
    ids = [_clean_text(item.get("employee_id"), 36) for item in records]
    ids = [eid for eid in ids if eid]
    if not day:
        raise ValueError("attendance_date_required")
    if not ids:
        raise ValueError("attendance_rows_required")

    by_id: dict[str, dict[str, Any]] = {}
    for item in records:
        eid = _clean_text(item.get("employee_id"), 36)
        if not eid:
            continue
        status = _clean_text(item.get("status"), 16).lower() or "absent"
        if status not in {"present", "absent"}:
            status = "absent"
        by_id[eid] = {
            "employee_id": eid,
            "status": status,
            "note": _clean_text(item.get("note"), 500),
        }

    with session_scope() as session:
        employees = session.execute(
            select(HrEmployee)
            .where(
                HrEmployee.workspace_owner_id == workspace_owner_id,
                HrEmployee.id.in_(list(by_id.keys())),
                HrEmployee.status == "active",
            )
            .order_by(HrEmployee.last_name, HrEmployee.first_name, HrEmployee.created_at)
        ).scalars().all()
        if not employees:
            raise ValueError("attendance_rows_required")

        existing = session.execute(
            select(HrAttendance).where(
                HrAttendance.workspace_owner_id == workspace_owner_id,
                HrAttendance.employee_id.in_([row.id for row in employees]),
                HrAttendance.work_date == day,
            )
        ).scalars().all()
        existing_by_employee = {row.employee_id: row for row in existing}

        present: list[dict[str, str]] = []
        absent: list[dict[str, str]] = []
        for employee in employees:
            record = by_id.get(employee.id, {})
            status = _clean_text(record.get("status"), 16).lower() or "absent"
            if status not in {"present", "absent"}:
                status = "absent"
            note = _clean_text(record.get("note"), 500)
            if status == "absent" and not note:
                note = "Причина не указана"

            row = existing_by_employee.get(employee.id)
            if row is None:
                row = HrAttendance(
                    id=str(uuid.uuid4()),
                    workspace_owner_id=workspace_owner_id,
                    employee_id=employee.id,
                    work_date=day,
                    status=status,
                    note=note,
                )
                session.add(row)
            else:
                row.status = status
                row.note = note

            item = {
                "employee_id": employee.id,
                "name": _employee_full_name(employee) or "Без имени",
                "position": employee.position or "",
                "reason": note,
            }
            if status == "present":
                present.append(item)
            else:
                absent.append(item)

        session.flush()
        return {
            "work_date": day,
            "total": len(employees),
            "present_count": len(present),
            "absent_count": len(absent),
            "present": present,
            "absent": absent,
        }


def _shipment_to_dict(row: DeliveryShipment, items: list[DeliveryShipmentItem]) -> dict[str, Any]:
    total = _money_out(row.total_amount)
    paid = _money_out(row.paid_amount)
    debt = _money_out(row.debt_amount)
    return {
        "id": row.id,
        "number": row.number,
        "shipment_date": row.shipment_date or "",
        "courier_name": row.courier_name or "",
        "employee_id": row.employee_id or "",
        "currency": row.currency or "UZS",
        "total_amount": total,
        "paid_amount": paid,
        "debt_amount": debt,
        "total_amount_label": _amount_label(total),
        "paid_amount_label": _amount_label(paid),
        "debt_amount_label": _amount_label(debt),
        "status": row.status or "open",
        "doc_status": _doc_status(row.doc_status),
        "doc_status_label": "Подтверждён" if _doc_status(row.doc_status) == "confirmed" else "Новый",
        "note": row.note or "",
        "items": [
            {
                "product_name": item.product_name or "",
                "quantity": _money_out(item.quantity),
                "amount": _money_out(item.amount),
                "amount_label": _amount_label(item.amount),
            }
            for item in items
        ],
    }


def list_delivery_shipments(workspace_owner_id: str, limit: int = 500) -> list[dict[str, Any]]:
    cap = max(1, min(int(limit or 500), 2000))
    with session_scope() as session:
        rows = session.execute(
            select(DeliveryShipment)
            .where(DeliveryShipment.workspace_owner_id == workspace_owner_id)
            .order_by(DeliveryShipment.shipment_date.desc(), DeliveryShipment.number.desc())
            .limit(cap)
        ).scalars().all()
        shipment_ids = [row.id for row in rows]
        item_rows = []
        if shipment_ids:
            item_rows = session.execute(
                select(DeliveryShipmentItem).where(DeliveryShipmentItem.shipment_id.in_(shipment_ids))
            ).scalars().all()
        grouped: dict[str, list[DeliveryShipmentItem]] = {sid: [] for sid in shipment_ids}
        for item in item_rows:
            grouped.setdefault(item.shipment_id, []).append(item)
        return [_shipment_to_dict(row, grouped.get(row.id, [])) for row in rows]


def create_delivery_shipments(
    workspace_owner_id: str,
    rows: list[dict[str, Any]],
    shipment_date: str | None = None,
    *,
    employee_workspace_owner_id: str | None = None,
) -> list[dict[str, Any]]:
    clean_date = _date_str(shipment_date)
    hr_owner_id = _clean_text(employee_workspace_owner_id, 36) or workspace_owner_id
    created: list[DeliveryShipment] = []
    with session_scope() as session:
        session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:wid))"), {"wid": f"shipment:{workspace_owner_id}"})
        next_number = int(
            session.scalar(
                select(func.coalesce(func.max(DeliveryShipment.number), 0) + 1).where(
                    DeliveryShipment.workspace_owner_id == workspace_owner_id,
                )
            )
            or 1
        )
        for raw in rows:
            amount = _money(raw.get("amount"))
            if amount <= 0:
                continue
            employee_id = _clean_text(raw.get("employee_id"), 36)
            employee = None
            if employee_id:
                employee = session.execute(
                    select(HrEmployee).where(
                        HrEmployee.id == employee_id,
                        HrEmployee.workspace_owner_id == hr_owner_id,
                    )
                ).scalar_one_or_none()
                if employee is None:
                    employee_id = ""
            courier_name = _clean_text(raw.get("courier_name"), 255) or _employee_full_name(employee)
            if not courier_name:
                continue
            shipment = DeliveryShipment(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                number=next_number,
                shipment_date=clean_date,
                courier_name=courier_name,
                employee_id=employee_id or None,
                currency=_currency(raw.get("currency")),
                total_amount=amount,
                paid_amount=Decimal("0.00"),
                debt_amount=Decimal("0.00"),
                status="open",
                doc_status="new",
                note=_clean_text(raw.get("note"), 1000),
            )
            session.add(shipment)
            session.flush()
            item = DeliveryShipmentItem(
                id=str(uuid.uuid4()),
                shipment_id=shipment.id,
                product_name=_clean_text(raw.get("product_name"), 255) or "Отгруженные товары",
                quantity=Decimal("1.000"),
                amount=amount,
            )
            session.add(item)
            created.append(shipment)
            next_number += 1
        if not created:
            raise ValueError("shipment_rows_required")
        recompute_delivery_debts_in_session(session, workspace_owner_id)
        session.flush()
        return [_shipment_to_dict(row, []) for row in created]


def update_delivery_shipment_document(
    workspace_owner_id: str,
    day: str,
    rows: list[dict[str, Any]],
    *,
    employee_workspace_owner_id: str | None = None,
) -> bool:
    clean_day = _date_str(day)
    hr_owner_id = _clean_text(employee_workspace_owner_id, 36) or workspace_owner_id
    with session_scope() as session:
        shipments = session.execute(
            select(DeliveryShipment)
            .where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.shipment_date == clean_day,
            )
            .order_by(DeliveryShipment.number.asc())
        ).scalars().all()
        if not shipments:
            return False
        if any(_doc_status(row.doc_status) == "confirmed" for row in shipments):
            raise ValueError("shipment_document_confirmed")

        by_id = {row.id: row for row in shipments}
        item_rows = session.execute(
            select(DeliveryShipmentItem).where(DeliveryShipmentItem.shipment_id.in_(by_id.keys()))
        ).scalars().all()
        first_item_by_shipment: dict[str, DeliveryShipmentItem] = {}
        for item in item_rows:
            first_item_by_shipment.setdefault(item.shipment_id, item)

        changed = 0
        for raw in rows:
            shipment_id = _clean_text(raw.get("id") or raw.get("shipment_id"), 36)
            shipment = by_id.get(shipment_id)
            if shipment is None:
                continue
            amount = _money(raw.get("amount"))
            if amount <= 0:
                raise ValueError("invalid_amount")

            employee_id = _clean_text(raw.get("employee_id"), 36)
            employee = None
            if employee_id:
                employee = session.execute(
                    select(HrEmployee).where(
                        HrEmployee.id == employee_id,
                        HrEmployee.workspace_owner_id == hr_owner_id,
                    )
                ).scalar_one_or_none()
                if employee is None:
                    employee_id = ""
            courier_name = _clean_text(raw.get("courier_name"), 255) or _employee_full_name(employee)
            if not courier_name:
                raise ValueError("courier_required")

            shipment.employee_id = employee_id or None
            shipment.courier_name = courier_name
            shipment.currency = _currency(raw.get("currency"))
            shipment.total_amount = amount
            shipment.paid_amount = Decimal("0.00")
            shipment.debt_amount = Decimal("0.00")
            shipment.status = "open"
            shipment.note = _clean_text(raw.get("note"), 1000)

            item = first_item_by_shipment.get(shipment.id)
            product_name = _clean_text(raw.get("product_name"), 255) or "Отгруженные товары"
            if item is None:
                item = DeliveryShipmentItem(
                    id=str(uuid.uuid4()),
                    shipment_id=shipment.id,
                    product_name=product_name,
                    quantity=Decimal("1.000"),
                    amount=amount,
                )
                session.add(item)
                first_item_by_shipment[shipment.id] = item
            else:
                item.product_name = product_name
                item.amount = amount
            changed += 1

        if changed <= 0:
            raise ValueError("shipment_rows_required")
        recompute_delivery_debts_in_session(session, workspace_owner_id)
        session.flush()
        return True


def delete_delivery_shipment_document(workspace_owner_id: str, day: str) -> bool:
    clean_day = str(day or "").strip()[:10]
    if len(clean_day) != 10:
        return False
    with session_scope() as session:
        shipments = session.execute(
            select(DeliveryShipment).where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.shipment_date == clean_day,
            )
        ).scalars().all()
        if not shipments:
            return False
        for shipment in shipments:
            session.delete(shipment)
        session.flush()
        recompute_delivery_debts_in_session(session, workspace_owner_id)
        session.flush()
        return True


def delete_delivery_shipment(workspace_owner_id: str, shipment_id: str) -> str | None:
    clean_id = _clean_text(shipment_id, 36)
    if not clean_id:
        return None
    with session_scope() as session:
        shipment = session.execute(
            select(DeliveryShipment).where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.id == clean_id,
            )
        ).scalar_one_or_none()
        if shipment is None:
            return None
        day = str(shipment.shipment_date or "")[:10]
        session.execute(
            text("DELETE FROM delivery_shipment_items WHERE shipment_id = :shipment_id"),
            {"shipment_id": shipment.id},
        )
        session.delete(shipment)
        session.flush()
        recompute_delivery_debts_in_session(session, workspace_owner_id)
        session.flush()
        return day


def confirm_delivery_shipment_document(workspace_owner_id: str, day: str) -> bool:
    clean_day = str(day or "").strip()[:10]
    if len(clean_day) != 10:
        return False
    with session_scope() as session:
        rows = session.execute(
            select(DeliveryShipment).where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.shipment_date == clean_day,
            )
        ).scalars().all()
        if not rows:
            return False
        for row in rows:
            row.doc_status = "confirmed"
        recompute_delivery_debts_in_session(session, workspace_owner_id)
        session.flush()
        return True


def confirm_delivery_shipment(workspace_owner_id: str, shipment_id: str) -> str | None:
    clean_id = _clean_text(shipment_id, 36)
    if not clean_id:
        return None
    with session_scope() as session:
        shipment = session.execute(
            select(DeliveryShipment).where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.id == clean_id,
            )
        ).scalar_one_or_none()
        if shipment is None:
            return None
        shipment.doc_status = "confirmed"
        day = str(shipment.shipment_date or "")[:10]
        recompute_delivery_debts_in_session(session, workspace_owner_id)
        session.flush()
        return day


def shipment_totals(workspace_owner_id: str) -> dict[str, Any]:
    with session_scope() as session:
        rows = session.execute(
            select(
                DeliveryShipment.currency,
                func.sum(DeliveryShipment.total_amount),
                func.sum(DeliveryShipment.paid_amount),
                func.sum(DeliveryShipment.debt_amount),
                func.count(DeliveryShipment.id),
            )
            .where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.doc_status == "confirmed",
            )
            .group_by(DeliveryShipment.currency)
            .order_by(DeliveryShipment.currency)
        ).all()
    totals = []
    for ccy, total, paid, debt, count in rows:
        totals.append(
            {
                "currency": str(ccy or "UZS").upper(),
                "total": _money_out(total),
                "paid": _money_out(paid),
                "debt": _money_out(debt),
                "total_label": _amount_label(total),
                "paid_label": _amount_label(paid),
                "debt_label": _amount_label(debt),
                "count": int(count or 0),
            }
        )
    return {"currencies": totals}


def list_courier_debts(workspace_owner_id: str, include_zero: bool = False) -> list[dict[str, Any]]:
    with session_scope() as session:
        stmt = (
            select(
                DeliveryShipment.courier_name,
                DeliveryShipment.currency,
                func.sum(DeliveryShipment.total_amount),
                func.sum(DeliveryShipment.paid_amount),
                func.sum(DeliveryShipment.debt_amount),
                func.count(DeliveryShipment.id),
            )
            .where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.doc_status == "confirmed",
            )
            .group_by(DeliveryShipment.courier_name, DeliveryShipment.currency)
            .order_by(DeliveryShipment.courier_name, DeliveryShipment.currency)
        )
        rows = session.execute(stmt).all()
        pending_rows: list[tuple[str, str, float, float, int]] = []
        fallback_rows: list[tuple[str, str, int]] = []
        if include_zero:
            pending_rows.extend(
                (
                    str(courier or ""),
                    str(ccy or "UZS").upper(),
                    _money_out(total),
                    _money_out(paid),
                    int(count or 0),
                )
                for courier, ccy, total, paid, count in session.execute(
                    select(
                        DeliveryShipment.courier_name,
                        DeliveryShipment.currency,
                        func.sum(DeliveryShipment.total_amount),
                        func.sum(DeliveryShipment.paid_amount),
                        func.count(DeliveryShipment.id),
                    )
                    .where(
                        DeliveryShipment.workspace_owner_id == workspace_owner_id,
                        DeliveryShipment.doc_status != "confirmed",
                    )
                    .group_by(DeliveryShipment.courier_name, DeliveryShipment.currency)
                    .order_by(DeliveryShipment.courier_name, DeliveryShipment.currency)
                ).all()
            )
            courier_name_expr = Transaction.data.op("->>")("courier_name")
            fallback_rows.extend(
                (
                    _clean_text(courier or supplier or client, 255),
                    str(ccy or "UZS").upper(),
                    0,
                )
                for courier, supplier, client, ccy in session.execute(
                    select(
                        courier_name_expr,
                        Transaction.supplier,
                        Transaction.client,
                        Transaction.currency,
                    ).where(
                        Transaction.workspace_owner_id == workspace_owner_id,
                        Transaction.type == "income",
                        Transaction.category == COURIER_PAYMENT_CATEGORY,
                    )
                ).all()
            )
    out = []
    seen: set[tuple[str, str]] = set()
    for courier, ccy, total, paid, debt, count in rows:
        courier_name = str(courier or "")
        currency = str(ccy or "UZS").upper()
        seen.add((courier_name, currency))
        debt_value = _money_out(debt)
        if not include_zero and debt_value <= 0:
            continue
        out.append(
            {
                "courier_name": courier_name,
                "currency": currency,
                "total_amount": _money_out(total),
                "paid_amount": _money_out(paid),
                "debt_amount": debt_value,
                "total_amount_label": _amount_label(total),
                "paid_amount_label": _amount_label(paid),
                "debt_amount_label": _amount_label(debt),
                "shipment_count": int(count or 0),
            }
        )
    if include_zero:
        by_key = {
            (str(row.get("courier_name") or ""), str(row.get("currency") or "UZS").upper()): row
            for row in out
        }
        for courier_name, currency, total, paid, count in pending_rows:
            courier_name = _clean_text(courier_name, 255)
            currency = _currency(currency)
            if not courier_name:
                continue
            key = (courier_name, currency)
            debt_value = max(0.0, _money_out(total) - _money_out(paid))
            row = by_key.get(key)
            if row is None:
                row = {
                    "courier_name": courier_name,
                    "currency": currency,
                    "total_amount": 0.0,
                    "paid_amount": 0.0,
                    "debt_amount": 0.0,
                    "shipment_count": 0,
                }
                by_key[key] = row
                out.append(row)
            row["total_amount"] = _money_out(row.get("total_amount")) + _money_out(total)
            row["paid_amount"] = _money_out(row.get("paid_amount")) + _money_out(paid)
            row["debt_amount"] = _money_out(row.get("debt_amount")) + debt_value
            row["shipment_count"] = int(row.get("shipment_count") or 0) + int(count or 0)
            row["total_amount_label"] = _amount_label(row["total_amount"])
            row["paid_amount_label"] = _amount_label(row["paid_amount"])
            row["debt_amount_label"] = _amount_label(row["debt_amount"])
            seen.add(key)
        for courier_name, currency, count in fallback_rows:
            courier_name = _clean_text(courier_name, 255)
            currency = _currency(currency)
            if not courier_name or (courier_name, currency) in seen:
                continue
            seen.add((courier_name, currency))
            out.append(
                {
                    "courier_name": courier_name,
                    "currency": currency,
                    "total_amount": 0.0,
                    "paid_amount": 0.0,
                    "debt_amount": 0.0,
                    "total_amount_label": _amount_label(0),
                    "paid_amount_label": _amount_label(0),
                    "debt_amount_label": _amount_label(0),
                    "shipment_count": int(count or 0),
                }
            )
    return sorted(
        out,
        key=lambda row: (
            str(row.get("courier_name") or "").lower(),
            str(row.get("currency") or ""),
        ),
    )


def recompute_delivery_debts(workspace_owner_id: str) -> None:
    with session_scope() as session:
        recompute_delivery_debts_in_session(session, workspace_owner_id)


def recompute_delivery_debts_in_session(session, workspace_owner_id: str) -> None:
    shipments = session.execute(
        select(DeliveryShipment)
        .where(DeliveryShipment.workspace_owner_id == workspace_owner_id)
        .order_by(DeliveryShipment.shipment_date.asc(), DeliveryShipment.number.asc())
    ).scalars().all()
    for shipment in shipments:
        total = _money(shipment.total_amount)
        if _doc_status(shipment.doc_status) != "confirmed":
            shipment.paid_amount = Decimal("0.00")
            shipment.debt_amount = Decimal("0.00")
            shipment.status = "open"
        else:
            shipment.paid_amount = Decimal("0.00")
            shipment.debt_amount = total
            shipment.status = _status_from_amounts(total, Decimal("0.00"))
    session.flush()

    payments = session.execute(
        select(Transaction)
        .where(
            Transaction.workspace_owner_id == workspace_owner_id,
            Transaction.type == "income",
            Transaction.is_confirmed.is_(True),
            Transaction.category == COURIER_PAYMENT_CATEGORY,
        )
        .order_by(Transaction.created_at.asc(), Transaction.number.asc())
    ).scalars().all()

    for tx in payments:
        data = tx.data if isinstance(tx.data, dict) else {}
        courier_name = _clean_text(data.get("courier_name"), 255) or _clean_text(tx.supplier, 255) or _clean_text(tx.client, 255)
        if not courier_name:
            continue
        currency = _currency(tx.currency)
        remaining = _money(tx.amount)
        if remaining <= 0:
            continue
        open_shipments = session.execute(
            select(DeliveryShipment)
            .where(
                DeliveryShipment.workspace_owner_id == workspace_owner_id,
                DeliveryShipment.courier_name == courier_name,
                DeliveryShipment.currency == currency,
                DeliveryShipment.doc_status == "confirmed",
                DeliveryShipment.debt_amount > 0,
            )
            .order_by(DeliveryShipment.shipment_date.asc(), DeliveryShipment.number.asc())
        ).scalars().all()
        for shipment in open_shipments:
            if remaining <= 0:
                break
            debt = _money(shipment.debt_amount)
            if debt <= 0:
                continue
            applied = debt if debt <= remaining else remaining
            paid = _money(shipment.paid_amount) + applied
            total = _money(shipment.total_amount)
            shipment.paid_amount = paid
            shipment.debt_amount = max(Decimal("0.00"), total - paid)
            shipment.status = _status_from_amounts(total, paid)
            remaining -= applied
        session.flush()
