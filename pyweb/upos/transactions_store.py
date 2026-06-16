from __future__ import annotations

import logging
import hmac
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import and_, delete, false, func, not_, or_, select, text, update

from upos.db import session_scope
from upos.db_models import (
    AccountBalance,
    Branch,
    Counterparty,
    EmployeeAccountAccess,
    FinanceAccount,
    FinanceCategory,
    Organization,
    Transaction,
    TransactionEntry,
    User,
)
from upos.storage import load_workspace_settings, save_workspace_settings
from upos.timezones import normalize_workspace_timezone, parse_created_at_for_workspace
from upos.organizations_store import list_organization_ids, list_organizations
from upos.treasury_store import apply_transaction_posting

logger = logging.getLogger(__name__)

_CURRENCY_CODE = re.compile(r"^[A-Z]{3}$")
# Совпадает с `greenwhite_store.INTEGRATION` — не импортируем модуль, чтобы избежать циклов.
_INTEGRATION_GREENWHITE = "greenwhite"

# Совпадает с колонками PostgreSQL (`schema_postgres.sql` / db_models.Transaction).
_TX_CATEGORY_LEN = 100
_TX_BRANCH_LEN = 100
_TX_MONTH_LEN = 20
_TX_TYPE_LEN = 20
_TX_CLIENT_LEN = 255
_TX_SUPPLIER_LEN = 255
_FIN_CATEGORY_NAME_LEN = 160
_FIN_CATEGORY_SUBCATEGORY_LEN = 120
_FIN_CATEGORY_SUBCATS_KEY = "finance_category_subcategories"
_BRANCH_NAME_LEN = 255
_BRANCH_EXTERNAL_ID_LEN = 180
_COUNTERPARTY_NAME_LEN = 255
_COUNTERPARTY_EXTERNAL_ID_LEN = 180
REPORT_LOCKED_CATEGORIES: set[tuple[str, str]] = {
    ("expense", "Зарплата"),
    ("income", "Оплата от доставщиков"),
}


def is_report_locked_category(name: str | None, cat_type: str | None) -> bool:
    return (str(cat_type or "").strip(), str(name or "").strip()) in REPORT_LOCKED_CATEGORIES


def _trunc_field(raw: Any, max_len: int) -> str | None:
    """Обрезка под VARCHAR в БД: иначе psycopg даёт DataError → 500 в API."""
    v = _clean_text(raw)
    if v is None:
        return None
    if len(v) <= max_len:
        return v
    return v[:max_len]


def _normalize_tx_type(raw: Any) -> str:
    t = str(raw or "income").strip().lower()
    if t not in {"income", "expense", "transfer"}:
        t = "expense"
    return _trunc_field(t, _TX_TYPE_LEN) or "expense"


def _resolve_employee_id(session, raw: Any) -> str | None:
    """FK на users.id: неверный или чужой id давал IntegrityError."""
    eid = _clean_text(raw)
    if not eid:
        return None
    try:
        key = str(uuid.UUID(eid))
    except ValueError:
        return None
    if session.get(User, key) is None:
        return None
    return key


def _coerce_json_dict(raw: Any) -> dict[str, Any]:
    return raw if isinstance(raw, dict) else {}


def _actor_is_employee(actor: dict[str, Any] | None) -> bool:
    return bool(actor and actor.get("is_employee"))


def _actor_user_id(actor: dict[str, Any] | None) -> str:
    return str((actor or {}).get("user_id") or (actor or {}).get("id") or "").strip()


def _account_owner_employee_id(session, workspace_owner_id: str, account_id: Any) -> str | None:
    aid = _clean_text(account_id)
    if not aid:
        return None
    row = session.get(FinanceAccount, aid)
    if row is None or row.workspace_owner_id != workspace_owner_id or not row.is_active:
        return None
    return str(row.owner_employee_id or "").strip() or None


def _visible_account_ids(session, workspace_owner_id: str, employee_id: str | None = None) -> list[str]:
    stmt = select(FinanceAccount.id).where(
        FinanceAccount.workspace_owner_id == workspace_owner_id,
        FinanceAccount.is_active.is_(True),
    )
    eid = str(employee_id or "").strip()
    if eid:
        explicit_ids = [
            str(x)
            for x in session.scalars(
                select(EmployeeAccountAccess.account_id)
                .join(FinanceAccount, FinanceAccount.id == EmployeeAccountAccess.account_id)
                .where(
                    EmployeeAccountAccess.employee_id == eid,
                    FinanceAccount.workspace_owner_id == workspace_owner_id,
                    FinanceAccount.is_active.is_(True),
                ),
            ).all()
        ]
        if explicit_ids:
            stmt = stmt.where(
                or_(
                    FinanceAccount.id.in_(explicit_ids),
                    FinanceAccount.owner_employee_id == eid,
                ),
            )
        else:
            stmt = stmt.where(FinanceAccount.owner_employee_id == eid)
    return [str(x) for x in session.scalars(stmt).all()]


def _actor_restricted_employee_id(actor: dict[str, Any] | None) -> str:
    if not _actor_is_employee(actor):
        return ""
    role_key = str((actor or {}).get("employee_role_key") or "").strip()
    if role_key == "general_director":
        return ""
    return _actor_user_id(actor)


def _require_actor_account_access(
    session,
    workspace_owner_id: str,
    tx_type: str,
    from_account_id: str | None,
    to_account_id: str | None,
    actor: dict[str, Any] | None,
) -> None:
    employee_id = _actor_restricted_employee_id(actor)
    if not employee_id:
        return
    allowed = set(_visible_account_ids(session, workspace_owner_id, employee_id))
    check_id = ""
    if tx_type == "income":
        check_id = str(to_account_id or "").strip()
    elif tx_type in {"expense", "transfer"}:
        check_id = str(from_account_id or "").strip()
    if check_id and check_id not in allowed:
        raise PermissionError("account_forbidden")


def _visible_transaction_condition(workspace_owner_id: str, account_ids: list[str]):
    conds = [Transaction.workspace_owner_id == workspace_owner_id]
    if account_ids:
        conds.append(
            or_(
                Transaction.from_account_id.in_(account_ids),
                Transaction.to_account_id.in_(account_ids),
                Transaction.from_pocket_id.in_(account_ids),
                Transaction.to_pocket_id.in_(account_ids),
                Transaction.data.op("->>")("courier_parent_account_id").in_(account_ids),
            ),
        )
    else:
        conds.append(false())
    return and_(*conds)


def _with_actor_data(data: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    """Записывает автора операции в tx.data (приоритет сервера над клиентом)."""
    out = dict(data)
    extra = dict(_coerce_json_dict(out.get("data")))
    name = str(actor.get("name") or actor.get("username") or "").strip()
    uid = str(actor.get("user_id") or actor.get("id") or "").strip()
    username = str(actor.get("username") or "").strip()
    if name:
        extra["author"] = name
    if uid:
        extra["author_id"] = uid
    if username:
        extra["author_username"] = username
    out["data"] = extra
    return out


def _post_confirmed_balances_and_entries(session, workspace_owner_id: str, tx: Transaction) -> None:
    """Одно место: остатки по кассе + журнал проводок (без двойного применения)."""
    apply_transaction_posting(session, workspace_owner_id, _tx_to_dict(tx))
    _create_entries_for_tx(session, tx)


def _next_transaction_number(session, workspace_owner_id: str) -> int:
    return int(
        session.execute(
            select(func.coalesce(func.max(Transaction.number), 0) + 1).where(
                Transaction.workspace_owner_id == workspace_owner_id,
            ),
        ).scalar_one()
        or 1
    )


def _enable_courier_channel_children(tx: Transaction) -> None:
    data = tx.data if isinstance(tx.data, dict) else {}
    if not data.get("courier_payment") or not isinstance(data.get("courier_breakdown"), dict):
        return
    tx.data = {**data, "courier_split_children": True}


def _courier_channel_child_specs(tx: Transaction) -> list[dict[str, Any]]:
    data = tx.data if isinstance(tx.data, dict) else {}
    breakdown = data.get("courier_breakdown")
    if not data.get("courier_payment") or not data.get("courier_split_children") or not isinstance(breakdown, dict):
        return []
    specs: list[dict[str, Any]] = []
    currency = str(tx.currency or "UZS").strip().upper()[:3]
    for channel, label, amount_key, account_key in (
        ("transfer", "Перечисление", "transfer", "transfer_account_id"),
        ("terminal", "Терминал", "terminal", "terminal_account_id"),
    ):
        account_id = str(breakdown.get(account_key) or "").strip()
        if not account_id:
            continue
        try:
            amount = _money(breakdown.get(amount_key))
        except ValueError:
            continue
        if amount <= 0:
            continue
        specs.append({"channel": channel, "label": label, "account_id": account_id, "amount": amount, "currency": currency})
    extra_rows = data.get("extra_income_postings")
    if isinstance(extra_rows, list):
        for index, row in enumerate(extra_rows, start=1):
            if not isinstance(row, dict):
                continue
            account_id = str(row.get("account_id") or row.get("pocket_id") or "").strip()
            extra_currency = str(row.get("currency") or currency).strip().upper()[:3]
            if not account_id or not _CURRENCY_CODE.match(extra_currency):
                continue
            try:
                amount = _money(row.get("amount"))
            except ValueError:
                continue
            if amount <= 0:
                continue
            specs.append({
                "channel": f"extra_{index}",
                "label": "Дополнительная оплата",
                "account_id": account_id,
                "amount": amount,
                "currency": extra_currency,
            })
    return specs


def _delete_courier_channel_children(session, workspace_owner_id: str, parent_id: str) -> None:
    children = session.execute(
        select(Transaction).where(
            Transaction.workspace_owner_id == workspace_owner_id,
            Transaction.data.op("->>")("courier_parent_id") == parent_id,
            Transaction.data.op("->>")("courier_payment_child") == "true",
        )
    ).scalars().all()
    for child in children:
        snapshot = _tx_to_dict(child)
        if not _reverse_existing_entries(session, child.id):
            apply_transaction_posting(session, workspace_owner_id, snapshot, reverse=True)
        session.execute(delete(Transaction).where(Transaction.id == child.id))
    if children:
        session.flush()


def _create_courier_channel_children(session, workspace_owner_id: str, parent: Transaction) -> None:
    specs = _courier_channel_child_specs(parent)
    if not specs:
        return
    parent_data = parent.data if isinstance(parent.data, dict) else {}
    parent_account_id = str(parent.to_account_id or parent.to_pocket_id or "").strip()
    courier_name = str(parent_data.get("courier_name") or parent.supplier or parent.client or "").strip()
    for spec in specs:
        child_data = {
            "author": parent_data.get("author") or "",
            "author_id": parent_data.get("author_id") or "",
            "author_username": parent_data.get("author_username") or "",
            "courier_name": courier_name,
            "courier_payment_child": True,
            "courier_parent_id": parent.id,
            "courier_parent_number": parent.number,
            "courier_parent_account_id": parent_account_id,
            "courier_payment_channel": spec["channel"],
            "courier_payment_channel_label": spec["label"],
        }
        child = Transaction(
            id=str(uuid.uuid4()),
            workspace_owner_id=workspace_owner_id,
            number=_next_transaction_number(session, workspace_owner_id),
            amount=spec["amount"],
            currency=spec["currency"],
            client=parent.client,
            employee_id=parent.employee_id,
            from_pocket_id=None,
            to_pocket_id=spec["account_id"],
            from_account_id=None,
            to_account_id=spec["account_id"],
            month=parent.month,
            type="income",
            is_confirmed=bool(parent.is_confirmed),
            status=parent.status or ("confirmed" if parent.is_confirmed else "draft"),
            requires_confirmation=False,
            confirmed_by=parent.confirmed_by,
            confirmed_at=parent.confirmed_at,
            category=parent.category,
            category_id=parent.category_id,
            branch=parent.branch,
            branch_id=parent.branch_id,
            supplier=parent.supplier,
            counterparty_id=parent.counterparty_id,
            note=spec["label"],
            data=child_data,
            created_at=parent.created_at,
        )
        session.add(child)
        session.flush()
        _post_confirmed_balances_and_entries(session, workspace_owner_id, child)


def _sync_delivery_debts_safe(session, workspace_owner_id: str) -> None:
    try:
        from upos.shipments_store import recompute_delivery_debts_in_session

        recompute_delivery_debts_in_session(session, workspace_owner_id)
    except Exception:
        logger.exception("[upos] delivery shipment debts sync failed; wid=%s", workspace_owner_id)


def _clean_text(raw: Any) -> str | None:
    value = str(raw or "").strip()
    return value or None


def _money(raw: Any) -> Decimal:
    try:
        value = Decimal(str(raw or "0")).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Неверная сумма операции") from exc
    if value < 0:
        raise ValueError("Сумма операции не может быть отрицательной")
    return value


def _money_out(raw: Any) -> float:
    return float(Decimal(str(raw or "0")).quantize(Decimal("0.01")))


def _tx_to_dict(tx: Transaction) -> dict[str, Any]:
    return {
        "id": tx.id,
        "number": tx.number,
        "amount": _money_out(tx.amount),
        "currency": tx.currency,
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
        "client": tx.client,
        "employee_id": tx.employee_id,
        "from_pocket_id": tx.from_account_id or tx.from_pocket_id,
        "to_pocket_id": tx.to_account_id or tx.to_pocket_id,
        "from_account_id": tx.from_account_id,
        "to_account_id": tx.to_account_id,
        "month": tx.month,
        "type": tx.type,
        "is_confirmed": tx.is_confirmed,
        "status": tx.status or ("confirmed" if tx.is_confirmed else "pending"),
        "requires_confirmation": bool(tx.requires_confirmation),
        "confirmed_by": tx.confirmed_by,
        "confirmed_at": tx.confirmed_at.isoformat() if tx.confirmed_at else None,
        "category": tx.category,
        "category_id": tx.category_id,
        "branch": tx.branch,
        "branch_id": tx.branch_id,
        "counterparty_id": tx.counterparty_id,
        "supplier": tx.supplier,
        "note": tx.note,
        "data": tx.data,
    }


def list_transactions(
    workspace_owner_id: str,
    *,
    limit: int = 500,
    offset: int = 0,
    visible_employee_id: str | None = None,
    allowed_category_ids: list[str] | tuple[str, ...] | None = None,
    allowed_category_names: list[str] | tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 5000))
    offset = max(0, offset)
    with session_scope() as session:
        account_ids = _visible_account_ids(session, workspace_owner_id, visible_employee_id)
        stmt = (
            select(Transaction)
            .where(_visible_transaction_condition(workspace_owner_id, account_ids))
            .order_by(Transaction.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if allowed_category_ids is not None or allowed_category_names is not None:
            cat_ids = [str(x).strip() for x in (allowed_category_ids or []) if str(x or "").strip()]
            cat_names = [str(x).strip() for x in (allowed_category_names or []) if str(x or "").strip()]
            cat_conditions = []
            if cat_ids:
                cat_conditions.append(Transaction.category_id.in_(cat_ids))
            if cat_names:
                cat_conditions.append(Transaction.category.in_(cat_names))
            stmt = stmt.where(or_(*cat_conditions) if cat_conditions else false())
        rows = session.execute(stmt).scalars().all()
        return [_tx_to_dict(r) for r in rows]


def _tx_integration_external_id_expr():
    return Transaction.data.op("->>")("external_id")


def _tx_integration_source_expr():
    return Transaction.data.op("->>")("source")


def _tx_transfer_kind_expr():
    return Transaction.data.op("->>")("transfer_kind")


def _tx_source_public(data: dict[str, Any] | None) -> str:
    """Для UI: Smartup (greenwhite / внешний id) или manual."""
    d = _coerce_json_dict(data)
    ext = str(d.get("external_id") or "").strip()
    if str(d.get("source") or "").strip() == _INTEGRATION_GREENWHITE or ext:
        return "smartup"
    return "manual"


def _apply_director_consolidated_filters(
    *conditions,
    organization_workspace_ids: list[str],
    organization_id: str | None = None,
    period_start_utc: datetime | None = None,
    period_end_utc: datetime | None = None,
    tx_type: str | None = None,
    currency: str | None = None,
    category: str | None = None,
    source: str | None = None,
):
    """Расширяет список условий WHERE для консолидированной кассы директора."""
    ws_ids = organization_workspace_ids
    if organization_id:
        ws_ids = [organization_id]
    conds = [
        *conditions,
        Transaction.workspace_owner_id.in_(ws_ids),
    ]
    if period_start_utc is not None:
        conds.append(Transaction.created_at >= period_start_utc)
    if period_end_utc is not None:
        conds.append(Transaction.created_at < period_end_utc)
    if currency:
        conds.append(Transaction.currency == str(currency).strip().upper())
    if category:
        conds.append(Transaction.category == str(category).strip())

    tk = _tx_transfer_kind_expr()
    src_gw = _tx_integration_source_expr()
    ext_id = _tx_integration_external_id_expr()
    smartup_cond = or_(
        src_gw == _INTEGRATION_GREENWHITE,
        func.length(func.trim(func.coalesce(ext_id, ""))) > 0,
    )

    tt = (tx_type or "").strip().lower()
    if tt == "income":
        conds.append(Transaction.type == "income")
    elif tt == "expense":
        conds.append(Transaction.type == "expense")
    elif tt == "transfer":
        conds.append(
            and_(
                Transaction.type == "transfer",
                func.coalesce(tk, "") != "cashout",
            ),
        )
    elif tt in {"cashout", "cash_out"}:
        conds.append(and_(Transaction.type == "transfer", tk == "cashout"))
    elif tt == "transfer_all":
        conds.append(Transaction.type == "transfer")

    ss = (source or "").strip().lower()
    if ss == "smartup":
        conds.append(smartup_cond)
    elif ss == "manual":
        conds.append(not_(smartup_cond))

    return and_(*conds)


def director_transaction_filter_hints(owner_user_id: str) -> dict[str, list[str]]:
    """Категории и валюты по всем организациям владельца (для фильтров UI)."""
    owner_id = (owner_user_id or "").strip()
    allowed = list_organization_ids(owner_id)
    if not allowed:
        return {"categories": [], "currencies": []}
    org_clause = and_(
        Organization.owner_user_id == owner_id,
        Organization.is_active.is_(True),
        Organization.id == Transaction.workspace_owner_id,
    )
    with session_scope() as session:
        cats = session.scalars(
            select(Transaction.category)
            .join(Organization, org_clause)
            .where(
                Transaction.workspace_owner_id.in_(allowed),
                Transaction.category.isnot(None),
                Transaction.category != "",
            )
            .distinct()
            .order_by(Transaction.category),
        ).all()
        ccys = session.scalars(
            select(Transaction.currency)
            .join(Organization, org_clause)
            .where(Transaction.workspace_owner_id.in_(allowed))
            .distinct()
            .order_by(Transaction.currency),
        ).all()
        clean_cats = sorted({str(c).strip() for c in cats if str(c or "").strip()})
        clean_ccy = sorted({str(c).strip().upper() for c in ccys if _CURRENCY_CODE.match(str(c or "").strip().upper())})
        return {"categories": clean_cats, "currencies": clean_ccy}


def list_director_consolidated_transactions(
    owner_user_id: str,
    *,
    organization_id: str | None = None,
    period_start_utc: datetime | None = None,
    period_end_utc: datetime | None = None,
    tx_type: str | None = None,
    currency: str | None = None,
    category: str | None = None,
    source: str | None = None,
    limit: int = 2500,
) -> dict[str, Any]:
    """
    Все операции по организациям владельца (консолидированная касса).
    Границы периода: [period_start_utc, period_end_utc) в UTC.
    """
    owner_id = (owner_user_id or "").strip()
    allowed = list_organization_ids(owner_id)
    if not allowed:
        return {
            "transactions": [],
            "summary": {
                "total_count": 0,
                "income_by_currency": {},
                "expense_by_currency": {},
                "transfer_by_currency": {},
                "cashout_by_currency": {},
                "net_by_currency": {},
                "truncated": False,
                "limit": max(1, min(int(limit or 2500), 5000)),
            },
            "organizations": [],
        }

    cap = max(1, min(int(limit or 2500), 5000))
    org_filter_id = (organization_id or "").strip()
    if org_filter_id and org_filter_id not in allowed:
        raise ValueError("organization_not_allowed")

    base_org_join = and_(
        Organization.owner_user_id == owner_id,
        Organization.is_active.is_(True),
        Organization.id == Transaction.workspace_owner_id,
    )

    filter_blob = _apply_director_consolidated_filters(
        base_org_join,
        organization_workspace_ids=allowed,
        organization_id=org_filter_id or None,
        period_start_utc=period_start_utc,
        period_end_utc=period_end_utc,
        tx_type=tx_type,
        currency=currency,
        category=category,
        source=source,
    )

    def _money_dict(rows: list[tuple[Any, Any]]) -> dict[str, float]:
        out: dict[str, float] = {}
        for ccy_raw, amt in rows:
            ccy = str(ccy_raw or "").strip().upper()
            if not _CURRENCY_CODE.match(ccy):
                continue
            out[ccy] = round(float(amt or 0), 2)
        return out

    with session_scope() as session:
        total_count = int(
            session.scalar(
                select(func.count(Transaction.id)).select_from(Transaction).join(Organization, filter_blob),
            )
            or 0,
        )

        income_rows = session.execute(
            select(Transaction.currency, func.sum(Transaction.amount))
            .join(Organization, filter_blob)
            .where(Transaction.type == "income")
            .group_by(Transaction.currency),
        ).all()
        expense_rows = session.execute(
            select(Transaction.currency, func.sum(Transaction.amount))
            .join(Organization, filter_blob)
            .where(Transaction.type == "expense")
            .group_by(Transaction.currency),
        ).all()
        transfer_kind = _tx_transfer_kind_expr()
        transfer_rows = session.execute(
            select(Transaction.currency, func.sum(Transaction.amount))
            .join(Organization, filter_blob)
            .where(
                Transaction.type == "transfer",
                func.coalesce(transfer_kind, "") != "cashout",
            )
            .group_by(Transaction.currency),
        ).all()
        cashout_rows = session.execute(
            select(Transaction.currency, func.sum(Transaction.amount))
            .join(Organization, filter_blob)
            .where(Transaction.type == "transfer", transfer_kind == "cashout")
            .group_by(Transaction.currency),
        ).all()

        income_by_currency = _money_dict(list(income_rows))
        expense_by_currency = _money_dict(list(expense_rows))
        transfer_by_currency = _money_dict(list(transfer_rows))
        cashout_by_currency = _money_dict(list(cashout_rows))

        keys = set(income_by_currency) | set(expense_by_currency)
        net_by_currency = {k: round(income_by_currency.get(k, 0.0) - expense_by_currency.get(k, 0.0), 2) for k in keys}

        list_stmt = (
            select(Transaction, Organization.name)
            .join(Organization, filter_blob)
            .order_by(Transaction.created_at.desc())
            .limit(cap + 1)
        )
        raw_rows = session.execute(list_stmt).all()
        truncated = len(raw_rows) > cap
        raw_rows = raw_rows[:cap]

        org_names = {
            str(r["id"]): str(r.get("name") or "")
            for r in (
                session.execute(
                    select(Organization.id, Organization.name).where(
                        Organization.owner_user_id == owner_id,
                        Organization.is_active.is_(True),
                        Organization.id.in_(allowed),
                    ),
                ).mappings().all()
            )
        }

    out_tx: list[dict[str, Any]] = []
    for tx, org_name in raw_rows:
        wid = str(tx.workspace_owner_id)
        d = _tx_to_dict(tx)
        d["organization_id"] = wid
        d["organization_name"] = str(org_name or org_names.get(wid) or "")
        d["source"] = _tx_source_public(tx.data)

        out_tx.append(d)

    return {
        "transactions": out_tx,
        "summary": {
            "total_count": total_count,
            "income_by_currency": income_by_currency,
            "expense_by_currency": expense_by_currency,
            "transfer_by_currency": transfer_by_currency,
            "cashout_by_currency": cashout_by_currency,
            "net_by_currency": net_by_currency,
            "truncated": truncated,
            "limit": cap,
        },
        "organizations": sorted(
            [{"id": oid, "name": org_names.get(oid, "")} for oid in allowed],
            key=lambda x: (str(x.get("name") or "").lower(), str(x.get("id") or "")),
        ),
    }


def _normalize_category_subcategory_name(raw: Any) -> str:
    return (_trunc_field(raw, _FIN_CATEGORY_SUBCATEGORY_LEN) or "").strip()


def _normalize_category_subcategories(raw: Any) -> dict[str, list[str]]:
    source = raw if isinstance(raw, dict) else {}
    out: dict[str, list[str]] = {}
    for cat_id, values in source.items():
        key = str(cat_id or "").strip()
        if not key:
            continue
        seen: set[str] = set()
        clean_values: list[str] = []
        for item in values if isinstance(values, list) else []:
            name = _normalize_category_subcategory_name(item)
            name_key = name.casefold()
            if name and name_key not in seen:
                seen.add(name_key)
                clean_values.append(name)
        if clean_values:
            out[key] = clean_values
    return out


def _load_category_subcategories(workspace_owner_id: str) -> dict[str, list[str]]:
    data = load_workspace_settings(workspace_owner_id)
    return _normalize_category_subcategories(data.get(_FIN_CATEGORY_SUBCATS_KEY))


def _save_category_subcategories(workspace_owner_id: str, payload: dict[str, list[str]]) -> None:
    data = load_workspace_settings(workspace_owner_id)
    data[_FIN_CATEGORY_SUBCATS_KEY] = _normalize_category_subcategories(payload)
    save_workspace_settings(workspace_owner_id, data)


def _category_to_dict(row: FinanceCategory, subcategories: list[str] | None = None) -> dict[str, Any]:
    locked = is_report_locked_category(row.name, row.type)
    return {
        "id": row.id,
        "name": row.name,
        "type": row.type,
        "subcategories": list(subcategories or []),
        "protected": locked,
        "protected_reason": "report" if locked else "",
    }


def list_categories(workspace_owner_id: str) -> list[dict[str, Any]]:
    subcats = _load_category_subcategories(workspace_owner_id)
    with session_scope() as session:
        stmt = (
            select(FinanceCategory)
            .where(FinanceCategory.workspace_owner_id == workspace_owner_id)
            .order_by(FinanceCategory.type, FinanceCategory.created_at, FinanceCategory.name)
        )
        rows = session.execute(stmt).scalars().all()
        return [_category_to_dict(r, subcats.get(str(r.id))) for r in rows]


def seed_default_categories(workspace_owner_id: str) -> None:
    defaults = {
        "income": [
            "Продажи",
            "Оплата услуг",
            "Арендный доход",
            "Проценты и кэшбэк",
            "Инвестиции",
            "Возвраты",
            "Оплата от доставщиков",
            "Прочие доходы",
        ],
        "expense": [
            "Закупка товара",
            "Зарплата",
            "Аренда",
            "Маркетинг",
            "Налоги",
            "Логистика",
            "Коммунальные услуги",
        ],
        "transfer": ["Межсчетный перевод", "Инкассация", "Прочее"],
    }
    with session_scope() as session:
        for cat_type, names in defaults.items():
            for name in names:
                _ensure_category(session, workspace_owner_id, name, cat_type)


def create_category(workspace_owner_id: str, name: str, cat_type: str) -> str:
    name_row = _trunc_field(name, _FIN_CATEGORY_NAME_LEN)
    cat_t = cat_type if cat_type in {"income", "expense", "transfer"} else "expense"
    with session_scope() as session:
        return _ensure_category(session, workspace_owner_id, name_row, cat_t) or ""


def add_category_subcategory(workspace_owner_id: str, cat_id: str, name: str) -> dict[str, Any] | None:
    clean_name = _normalize_category_subcategory_name(name)
    clean_id = str(cat_id or "").strip()
    if not clean_name:
        raise ValueError("name_required")
    if not clean_id:
        raise ValueError("id_required")
    with session_scope() as session:
        row = session.execute(
            select(FinanceCategory).where(
                FinanceCategory.id == clean_id,
                FinanceCategory.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return None
    subcats = _load_category_subcategories(workspace_owner_id)
    values = list(subcats.get(clean_id) or [])
    if clean_name.casefold() not in {str(x).casefold() for x in values}:
        values.append(clean_name)
    subcats[clean_id] = values
    _save_category_subcategories(workspace_owner_id, subcats)
    with session_scope() as session:
        row = session.get(FinanceCategory, clean_id)
        if row is None or row.workspace_owner_id != workspace_owner_id:
            return None
        return _category_to_dict(row, values)


def delete_category_subcategory(workspace_owner_id: str, cat_id: str, name: str) -> dict[str, Any] | None:
    clean_name = _normalize_category_subcategory_name(name)
    clean_id = str(cat_id or "").strip()
    if not clean_name:
        raise ValueError("name_required")
    if not clean_id:
        raise ValueError("id_required")
    with session_scope() as session:
        row = session.execute(
            select(FinanceCategory).where(
                FinanceCategory.id == clean_id,
                FinanceCategory.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return None
    subcats = _load_category_subcategories(workspace_owner_id)
    values = [
        value
        for value in list(subcats.get(clean_id) or [])
        if str(value).casefold() != clean_name.casefold()
    ]
    if values:
        subcats[clean_id] = values
    else:
        subcats.pop(clean_id, None)
    _save_category_subcategories(workspace_owner_id, subcats)
    with session_scope() as session:
        row = session.get(FinanceCategory, clean_id)
        if row is None or row.workspace_owner_id != workspace_owner_id:
            return None
        return _category_to_dict(row, values)


def update_category(workspace_owner_id: str, cat_id: str, name: str, cat_type: str) -> dict[str, Any] | None:
    clean_name_row = _trunc_field(name, _FIN_CATEGORY_NAME_LEN)
    if not clean_name_row:
        raise ValueError("name_required")
    tx_category_mirror = _trunc_field(clean_name_row, _TX_CATEGORY_LEN)
    clean_type = cat_type if cat_type in {"income", "expense", "transfer"} else "expense"
    with session_scope() as session:
        row = session.execute(
            select(FinanceCategory).where(
                FinanceCategory.id == cat_id,
                FinanceCategory.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        if is_report_locked_category(row.name, row.type) and (
            row.name != clean_name_row or row.type != clean_type
        ):
            raise ValueError("protected_category")
        duplicate = session.execute(
            select(FinanceCategory).where(
                FinanceCategory.workspace_owner_id == workspace_owner_id,
                FinanceCategory.type == clean_type,
                FinanceCategory.name == clean_name_row,
                FinanceCategory.id != cat_id,
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            raise ValueError("duplicate_category")
        old_id = row.id
        row.name = clean_name_row
        row.type = clean_type
        session.execute(
            update(Transaction)
            .where(
                Transaction.workspace_owner_id == workspace_owner_id,
                Transaction.category_id == old_id,
            )
            .values(category=tx_category_mirror)
        )
        session.flush()
        return _category_to_dict(row, _load_category_subcategories(workspace_owner_id).get(str(row.id)))


def delete_category(workspace_owner_id: str, cat_id: str) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(FinanceCategory).where(
                FinanceCategory.id == cat_id,
                FinanceCategory.workspace_owner_id == workspace_owner_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        if is_report_locked_category(row.name, row.type):
            raise ValueError("protected_category")
        session.execute(
            update(Transaction)
            .where(
                Transaction.workspace_owner_id == workspace_owner_id,
                Transaction.category_id == cat_id,
            )
            .values(category=None, category_id=None)
        )
        stmt = delete(FinanceCategory).where(
            FinanceCategory.id == cat_id,
            FinanceCategory.workspace_owner_id == workspace_owner_id,
        )
        res = session.execute(stmt)
        subcats = _load_category_subcategories(workspace_owner_id)
        if str(cat_id) in subcats:
            subcats.pop(str(cat_id), None)
            _save_category_subcategories(workspace_owner_id, subcats)
        return bool(res.rowcount)


def get_pnl_data(
    workspace_owner_id: str,
    start_date: datetime | None,
    end_date: datetime | None,
    *,
    visible_employee_id: str | None = None,
) -> dict[str, Any]:
    with session_scope() as session:
        account_ids = _visible_account_ids(session, workspace_owner_id, visible_employee_id)
        base_visible = _visible_transaction_condition(workspace_owner_id, account_ids)
        income_category = func.coalesce(
            FinanceCategory.name,
            Transaction.category,
            "Без категории",
        ).label("category_name")
        income_stmt = (
            select(
                income_category,
                func.sum(Transaction.amount),
                Transaction.currency,
                func.count(Transaction.id),
            )
            .outerjoin(FinanceCategory, Transaction.category_id == FinanceCategory.id)
            .where(
                base_visible,
                Transaction.type == "income",
                Transaction.is_confirmed == True,
            )
            .group_by(income_category, Transaction.currency)
            .order_by(func.sum(Transaction.amount).desc(), income_category.asc())
        )
        if start_date is not None:
            income_stmt = income_stmt.where(Transaction.created_at >= start_date)
        if end_date is not None:
            income_stmt = income_stmt.where(Transaction.created_at < end_date)
        income_rows = session.execute(income_stmt).all()

        expense_category = func.coalesce(
            FinanceCategory.name,
            Transaction.category,
            "Без категории",
        ).label("category_name")
        expense_stmt = (
            select(
                expense_category,
                func.sum(Transaction.amount),
                Transaction.currency,
                func.count(Transaction.id),
            )
            .outerjoin(FinanceCategory, Transaction.category_id == FinanceCategory.id)
            .where(
                base_visible,
                Transaction.type == "expense",
                Transaction.is_confirmed == True,
            )
            .group_by(expense_category, Transaction.currency)
            .order_by(func.sum(Transaction.amount).desc(), expense_category.asc())
        )
        if start_date is not None:
            expense_stmt = expense_stmt.where(Transaction.created_at >= start_date)
        if end_date is not None:
            expense_stmt = expense_stmt.where(Transaction.created_at < end_date)
        expense_rows = session.execute(expense_stmt).all()

        return {
            "income": [
                {"name": r[0], "amount": float(r[1]), "currency": r[2], "count": int(r[3] or 0)}
                for r in income_rows
            ],
            "expense": [
                {"name": r[0], "amount": float(r[1]), "currency": r[2], "count": int(r[3] or 0)}
                for r in expense_rows
            ],
        }


def _merge_named_currency_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    acc: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        name = str(row.get("name") or "Без категории")
        ccy = str(row.get("currency") or "").strip().upper() or "USD"
        if not _CURRENCY_CODE.match(ccy):
            continue
        try:
            amt = float(row.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        cnt = int(row.get("count") or 0)
        key = (name, ccy)
        cur = acc.setdefault(key, {"name": name, "currency": ccy, "amount": 0.0, "count": 0})
        cur["amount"] = round(float(cur["amount"]) + amt, 2)
        cur["count"] = int(cur["count"]) + cnt
    merged = list(acc.values())
    merged.sort(key=lambda x: (-float(x.get("amount") or 0), str(x.get("name") or "")))
    return merged


def get_director_consolidated_pnl(
    owner_user_id: str,
    start_date: datetime | None,
    end_date: datetime | None,
    *,
    organization_id: str | None = None,
) -> dict[str, Any]:
    """ОиУ по всем организациям владельца за период (UTC-границы как у get_pnl_data)."""
    owner_id = (owner_user_id or "").strip()
    org_meta = list_organizations(owner_id)
    allowed = [str(o["id"]) for o in org_meta]
    if not allowed:
        return {
            "income": [],
            "expense": [],
            "by_organization": [],
            "organizations": [],
        }

    oid_filter = (organization_id or "").strip()
    if oid_filter and oid_filter not in allowed:
        raise ValueError("organization_not_allowed")

    todo = [o for o in org_meta if not oid_filter or str(o.get("id")) == oid_filter]

    merge_inc: list[dict[str, Any]] = []
    merge_exp: list[dict[str, Any]] = []
    by_org: list[dict[str, Any]] = []

    for org in todo:
        oid = str(org.get("id") or "")
        if not oid:
            continue
        pnl = get_pnl_data(oid, start_date, end_date)
        inc_rows = list(pnl.get("income") or [])
        exp_rows = list(pnl.get("expense") or [])
        merge_inc.extend(inc_rows)
        merge_exp.extend(exp_rows)

        inc_ccy: dict[str, float] = {}
        exp_ccy: dict[str, float] = {}
        for row in inc_rows:
            ccy = str(row.get("currency") or "").strip().upper() or "USD"
            if not _CURRENCY_CODE.match(ccy):
                continue
            inc_ccy[ccy] = round(inc_ccy.get(ccy, 0.0) + float(row.get("amount") or 0), 2)
        for row in exp_rows:
            ccy = str(row.get("currency") or "").strip().upper() or "USD"
            if not _CURRENCY_CODE.match(ccy):
                continue
            exp_ccy[ccy] = round(exp_ccy.get(ccy, 0.0) + float(row.get("amount") or 0), 2)
        keys = set(inc_ccy) | set(exp_ccy)
        net_ccy = {k: round(inc_ccy.get(k, 0.0) - exp_ccy.get(k, 0.0), 2) for k in keys}

        by_org.append(
            {
                "organization_id": oid,
                "organization_name": str(org.get("name") or ""),
                "income_by_currency": dict(sorted(inc_ccy.items())),
                "expense_by_currency": dict(sorted(exp_ccy.items())),
                "net_by_currency": dict(sorted(net_ccy.items())),
            },
        )

    return {
        "income": _merge_named_currency_rows(merge_inc),
        "expense": _merge_named_currency_rows(merge_exp),
        "by_organization": sorted(
            by_org,
            key=lambda x: (str(x.get("organization_name") or "").lower(), str(x.get("organization_id") or "")),
        ),
        "organizations": [{"id": str(o["id"]), "name": str(o.get("name") or "")} for o in org_meta],
    }


def get_account_movements(
    workspace_owner_id: str,
    start_date: datetime | None,
    end_date: datetime | None,
    *,
    visible_employee_id: str | None = None,
) -> dict[str, Any]:
    totals: dict[str, dict[str, Any]] = {}
    grand: dict[str, dict[str, Any]] = {}

    def _bucket(container: dict[str, dict[str, Any]], key: str, currency: str) -> dict[str, Any]:
        row = container.setdefault(key, {"currencies": {}})
        ccy = row["currencies"].setdefault(
            currency,
            {
                "currency": currency,
                "income": Decimal("0.00"),
                "expense": Decimal("0.00"),
                "net": Decimal("0.00"),
                "count": 0,
            },
        )
        return ccy

    with session_scope() as session:
        account_ids = _visible_account_ids(session, workspace_owner_id, visible_employee_id)
        visible_set = set(account_ids)
        stmt = select(Transaction).where(
            _visible_transaction_condition(workspace_owner_id, account_ids),
            Transaction.is_confirmed == True,
        )
        if start_date is not None:
            stmt = stmt.where(Transaction.created_at >= start_date)
        if end_date is not None:
            stmt = stmt.where(Transaction.created_at < end_date)
        rows = session.execute(stmt.order_by(Transaction.created_at.desc())).scalars().all()

        for tx in rows:
            for account_id, direction, amount, currency in _tx_postings(tx):
                aid = str(account_id or "").strip()
                if not aid:
                    continue
                if visible_set and aid not in visible_set:
                    continue
                cur = str(currency or "USD").upper()[:3]
                amt = _money(amount)
                acct = _bucket(totals, aid, cur)
                all_row = _bucket(grand, "all", cur)
                if direction == "out":
                    acct["expense"] += amt
                    acct["net"] -= amt
                    all_row["expense"] += amt
                    all_row["net"] -= amt
                else:
                    acct["income"] += amt
                    acct["net"] += amt
                    all_row["income"] += amt
                    all_row["net"] += amt
                acct["count"] += 1
                all_row["count"] += 1

    def _serialize(container: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, row in container.items():
            currencies = []
            for ccy_row in row.get("currencies", {}).values():
                currencies.append(
                    {
                        "currency": ccy_row["currency"],
                        "income": float(ccy_row["income"]),
                        "expense": float(ccy_row["expense"]),
                        "net": float(ccy_row["net"]),
                        "count": int(ccy_row["count"] or 0),
                    }
                )
            result[key] = {
                "currencies": sorted(currencies, key=lambda x: x["currency"]),
                "count": sum(int(x["count"]) for x in currencies),
            }
        return result

    return {
        "accounts": _serialize(totals),
        "total": _serialize(grand).get("all", {"currencies": [], "count": 0}),
    }


def create_transaction(
    workspace_owner_id: str,
    data: dict[str, Any],
    *,
    actor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if actor:
        data = _with_actor_data(data, actor)
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    created_at = parse_created_at_for_workspace(data.get("created_at"), tz)
    with session_scope() as session:
        # Advisory lock per workspace to prevent duplicate transaction numbers
        session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:wid))"), {"wid": workspace_owner_id})
        next_number = _next_transaction_number(session, workspace_owner_id)
        tx_type = _normalize_tx_type(data.get("type"))
        cat_key = _trunc_field(data.get("category"), _FIN_CATEGORY_NAME_LEN)
        category_txt = _trunc_field(cat_key, _TX_CATEGORY_LEN)
        client = _trunc_field(data.get("client"), _TX_CLIENT_LEN)
        supplier = _trunc_field(data.get("supplier"), _TX_SUPPLIER_LEN)
        branch_raw = _clean_text(data.get("branch"))
        branch_meta = _trunc_field(branch_raw, _BRANCH_NAME_LEN)
        branch_txt = _trunc_field(branch_raw, _TX_BRANCH_LEN)
        from_account_id = _clean_text(data.get("from_account_id") or data.get("from_pocket_id"))
        to_account_id = _clean_text(data.get("to_account_id") or data.get("to_pocket_id"))
        tx_data = _coerce_json_dict(data.get("data"))
        requested_status = str(data.get("status") or "").strip().lower()
        if requested_status not in {"draft", "pending", "confirmed", "rejected"}:
            requested_status = ""
        is_confirmed = bool(data.get("is_confirmed", True))
        requires_confirmation = bool(data.get("requires_confirmation")) if tx_type in {"income", "expense"} else False
        status = requested_status or (
            "pending" if requires_confirmation and not is_confirmed else ("confirmed" if is_confirmed else "draft")
        )
        is_confirmed = status == "confirmed"
        confirmed_by = None
        confirmed_at = None
        _require_actor_account_access(session, workspace_owner_id, tx_type, from_account_id, to_account_id, actor)
        if tx_type == "transfer":
            from_owner = _account_owner_employee_id(session, workspace_owner_id, from_account_id)
            to_owner = _account_owner_employee_id(session, workspace_owner_id, to_account_id)
            restricted_employee_id = _actor_restricted_employee_id(actor)
            actor_visible_ids = (
                set(_visible_account_ids(session, workspace_owner_id, restricted_employee_id))
                if restricted_employee_id
                else set()
            )
            source_visible = bool(not restricted_employee_id or from_account_id in actor_visible_ids)
            target_visible = bool(not restricted_employee_id or to_account_id in actor_visible_ids)
            different_personal_owner = bool(
                restricted_employee_id
                and from_owner
                and to_owner
                and from_owner != to_owner
            )
            transfer_to_external_access = bool(
                restricted_employee_id
                and to_account_id
                and source_visible
                and not target_visible
            )
            requires_confirmation = different_personal_owner or transfer_to_external_access
            tx_data = dict(tx_data)
            tx_data["transfer_from_owner_employee_id"] = from_owner or ""
            tx_data["transfer_to_owner_employee_id"] = to_owner or ""
            tx_data["transfer_requires_reason"] = (
                "external_cash_access" if transfer_to_external_access else (
                    "different_owner" if different_personal_owner else ""
                )
            )
            tx_data["transfer_from_visible_to_sender"] = source_visible
            tx_data["transfer_to_visible_to_sender"] = target_visible
            if requires_confirmation:
                is_confirmed = False
                status = "pending"
            else:
                if status not in {"draft", "confirmed"}:
                    status = "confirmed"
                is_confirmed = status == "confirmed"
                if is_confirmed:
                    confirmed_by = _actor_user_id(actor) or None
                    confirmed_at = datetime.now(timezone.utc)
        elif is_confirmed:
            confirmed_by = _actor_user_id(actor) or None
            confirmed_at = datetime.now(timezone.utc)
        payload = {
            "id": str(uuid.uuid4()),
            "workspace_owner_id": workspace_owner_id,
            "number": int(next_number),
            "amount": _money(data.get("amount", 0.0)),
            "currency": str(data.get("currency") or "USD").upper()[:3],
            "client": client,
            "employee_id": _resolve_employee_id(session, data.get("employee_id")),
            "from_pocket_id": _clean_text(data.get("from_pocket_id")),
            "to_pocket_id": _clean_text(data.get("to_pocket_id")),
            "from_account_id": from_account_id,
            "to_account_id": to_account_id,
            "month": _trunc_field(data.get("month"), _TX_MONTH_LEN),
            "type": tx_type,
            "is_confirmed": is_confirmed,
            "status": status,
            "requires_confirmation": requires_confirmation,
            "confirmed_by": confirmed_by,
            "confirmed_at": confirmed_at,
            "category": category_txt,
            "category_id": _ensure_category(session, workspace_owner_id, cat_key, tx_type),
            "branch": branch_txt,
            "branch_id": _ensure_branch(session, workspace_owner_id, branch_meta),
            "supplier": supplier,
            "counterparty_id": _ensure_counterparty(session, workspace_owner_id, client, supplier, tx_type),
            "note": _clean_text(data.get("note")),
            "data": tx_data,
        }
        if created_at is not None:
            payload["created_at"] = created_at
        new_tx = Transaction(**payload)
        _enable_courier_channel_children(new_tx)
        session.add(new_tx)
        session.flush()
        _post_confirmed_balances_and_entries(session, workspace_owner_id, new_tx)
        _create_courier_channel_children(session, workspace_owner_id, new_tx)
        _sync_delivery_debts_safe(session, workspace_owner_id)
        session.refresh(new_tx)
        return _tx_to_dict(new_tx)


def update_transaction(
    workspace_owner_id: str,
    tx_id: str,
    data: dict[str, Any],
    *,
    actor: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    with session_scope() as session:
        stmt = select(Transaction).where(
            Transaction.id == tx_id,
            Transaction.workspace_owner_id == workspace_owner_id
        )
        tx = session.execute(stmt).scalar_one_or_none()
        if not tx:
            return None

        before = _tx_to_dict(tx)
        if not _reverse_existing_entries(session, tx.id):
            apply_transaction_posting(session, workspace_owner_id, before, reverse=True)
        _delete_courier_channel_children(session, workspace_owner_id, tx.id)

        if "amount" in data:
            tx.amount = _money(data["amount"])
        if "currency" in data:
            tx.currency = str(data["currency"] or "USD").upper()[:3]
        if "created_at" in data:
            parsed_created_at = parse_created_at_for_workspace(data["created_at"], tz)
            if parsed_created_at is not None:
                tx.created_at = parsed_created_at
        if "client" in data:
            tx.client = _trunc_field(data["client"], _TX_CLIENT_LEN)
        if "employee_id" in data:
            tx.employee_id = _resolve_employee_id(session, data["employee_id"])
        if "from_pocket_id" in data:
            tx.from_pocket_id = _clean_text(data["from_pocket_id"])
            tx.from_account_id = _clean_text(data["from_pocket_id"])
        if "from_account_id" in data:
            tx.from_account_id = _clean_text(data["from_account_id"])
        if "to_pocket_id" in data:
            tx.to_pocket_id = _clean_text(data["to_pocket_id"])
            tx.to_account_id = _clean_text(data["to_pocket_id"])
        if "to_account_id" in data:
            tx.to_account_id = _clean_text(data["to_account_id"])
        if "month" in data:
            tx.month = _trunc_field(data["month"], _TX_MONTH_LEN)
        if "type" in data:
            tx.type = _normalize_tx_type(data["type"])
        if "is_confirmed" in data:
            tx.is_confirmed = bool(data["is_confirmed"])
            if "status" not in data:
                tx.status = "confirmed" if tx.is_confirmed else "draft"
        if "status" in data:
            clean_status = str(data.get("status") or "").strip().lower()
            if clean_status in {"draft", "pending", "confirmed", "rejected"}:
                tx.status = clean_status
                tx.is_confirmed = clean_status == "confirmed"
        if "category" in data:
            cat_key = _trunc_field(data["category"], _FIN_CATEGORY_NAME_LEN)
            tx.category = _trunc_field(cat_key, _TX_CATEGORY_LEN)
            tx.category_id = _ensure_category(session, workspace_owner_id, cat_key, tx.type)
        if "branch" in data:
            br_raw = _clean_text(data["branch"])
            branch_meta = _trunc_field(br_raw, _BRANCH_NAME_LEN)
            tx.branch = _trunc_field(br_raw, _TX_BRANCH_LEN)
            tx.branch_id = _ensure_branch(session, workspace_owner_id, branch_meta)
        if "supplier" in data:
            tx.supplier = _trunc_field(data["supplier"], _TX_SUPPLIER_LEN)
            tx.counterparty_id = _ensure_counterparty(session, workspace_owner_id, tx.client, tx.supplier, tx.type)
        if "client" in data:
            tx.counterparty_id = _ensure_counterparty(session, workspace_owner_id, tx.client, tx.supplier, tx.type)
        if "note" in data:
            tx.note = _clean_text(data["note"])
        if "data" in data:
            inc = data["data"]
            if isinstance(inc, dict):
                merged = dict(tx.data or {})
                merged.update(inc)
                tx.data = merged
            else:
                tx.data = _coerce_json_dict(inc)

        _require_actor_account_access(
            session,
            workspace_owner_id,
            str(tx.type or ""),
            tx.from_account_id or tx.from_pocket_id,
            tx.to_account_id or tx.to_pocket_id,
            actor,
        )
        if (tx.status or "") == "confirmed":
            tx.is_confirmed = True
            if not tx.confirmed_at:
                tx.confirmed_at = datetime.now(timezone.utc)
            if not tx.confirmed_by:
                tx.confirmed_by = _actor_user_id(actor) or None
        elif (tx.status or "") in {"draft", "rejected"}:
            tx.is_confirmed = False
            if (tx.status or "") == "draft":
                tx.confirmed_by = None
                tx.confirmed_at = None

        session.flush()
        _enable_courier_channel_children(tx)
        session.flush()
        _post_confirmed_balances_and_entries(session, workspace_owner_id, tx)
        _create_courier_channel_children(session, workspace_owner_id, tx)
        _sync_delivery_debts_safe(session, workspace_owner_id)
        session.refresh(tx)
        return _tx_to_dict(tx)


def delete_transaction(workspace_owner_id: str, tx_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        stmt = select(Transaction).where(
            Transaction.id == tx_id,
            Transaction.workspace_owner_id == workspace_owner_id
        )
        tx = session.execute(stmt).scalar_one_or_none()
        if tx is None:
            return None
        snapshot = _tx_to_dict(tx)
        if not _reverse_existing_entries(session, tx.id):
            apply_transaction_posting(session, workspace_owner_id, snapshot, reverse=True)
        _delete_courier_channel_children(session, workspace_owner_id, tx.id)
        session.execute(delete(Transaction).where(Transaction.id == tx_id))
        _sync_delivery_debts_safe(session, workspace_owner_id)
        return snapshot


def set_transaction_status(
    workspace_owner_id: str,
    tx_id: str,
    status: str,
    *,
    actor: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    clean_status = str(status or "").strip().lower()
    if clean_status not in {"draft", "pending", "confirmed", "rejected"}:
        raise ValueError("invalid_status")
    with session_scope() as session:
        tx = session.execute(
            select(Transaction)
            .where(
                Transaction.id == tx_id,
                Transaction.workspace_owner_id == workspace_owner_id,
            )
            .with_for_update()
        ).scalar_one_or_none()
        if tx is None:
            return None
        if tx.type == "transfer" and tx.requires_confirmation and clean_status == "draft":
            raise ValueError("transfer_confirmation_required")
        _require_actor_account_access(
            session,
            workspace_owner_id,
            str(tx.type or ""),
            tx.from_account_id or tx.from_pocket_id,
            tx.to_account_id or tx.to_pocket_id,
            actor,
        )
        if not _reverse_existing_entries(session, tx.id):
            apply_transaction_posting(session, workspace_owner_id, _tx_to_dict(tx), reverse=True)
        _delete_courier_channel_children(session, workspace_owner_id, tx.id)
        tx.status = clean_status
        tx.is_confirmed = clean_status == "confirmed"
        actor_id = _actor_user_id(actor) or None
        if clean_status == "confirmed":
            tx.confirmed_by = actor_id
            tx.confirmed_at = datetime.now(timezone.utc)
        elif clean_status in {"draft", "rejected"}:
            tx.confirmed_by = None if clean_status == "draft" else actor_id
            tx.confirmed_at = None if clean_status == "draft" else datetime.now(timezone.utc)
        session.flush()
        _enable_courier_channel_children(tx)
        session.flush()
        _post_confirmed_balances_and_entries(session, workspace_owner_id, tx)
        _create_courier_channel_children(session, workspace_owner_id, tx)
        _sync_delivery_debts_safe(session, workspace_owner_id)
        session.refresh(tx)
        return _tx_to_dict(tx)


def decide_transaction_telegram_limit_approval(
    workspace_owner_id: str,
    tx_id: str,
    token: str,
    *,
    approve: bool,
) -> dict[str, Any] | None:
    clean_token = str(token or "").strip()
    if not clean_token:
        raise PermissionError("invalid_token")
    with session_scope() as session:
        tx = session.execute(
            select(Transaction)
            .where(
                Transaction.id == str(tx_id or "").strip(),
                Transaction.workspace_owner_id == workspace_owner_id,
            )
            .with_for_update()
        ).scalar_one_or_none()
        if tx is None:
            return None
        data = dict(tx.data or {}) if isinstance(tx.data, dict) else {}
        approval = data.get("telegram_limit_approval")
        if not isinstance(approval, dict):
            raise ValueError("approval_not_found")
        expected = str(approval.get("token") or "").strip()
        if not expected or not hmac.compare_digest(expected, clean_token):
            raise PermissionError("invalid_token")
        if (tx.status or "") != "pending" or not tx.requires_confirmation:
            raise ValueError("not_pending")

        if not _reverse_existing_entries(session, tx.id):
            apply_transaction_posting(session, workspace_owner_id, _tx_to_dict(tx), reverse=True)
        _delete_courier_channel_children(session, workspace_owner_id, tx.id)

        now = datetime.now(timezone.utc)
        approval = dict(approval)
        approval["status"] = "confirmed" if approve else "rejected"
        approval["decided_at"] = now.isoformat()
        approval["decided_by"] = "telegram"
        data["telegram_limit_approval"] = approval
        tx.data = data
        tx.status = "confirmed" if approve else "rejected"
        tx.is_confirmed = bool(approve)
        tx.confirmed_by = None
        tx.confirmed_at = now
        session.flush()
        if approve:
            _enable_courier_channel_children(tx)
            session.flush()
            _post_confirmed_balances_and_entries(session, workspace_owner_id, tx)
            _create_courier_channel_children(session, workspace_owner_id, tx)
        _sync_delivery_debts_safe(session, workspace_owner_id)
        session.refresh(tx)
        return _tx_to_dict(tx)


def list_transfers(
    workspace_owner_id: str,
    *,
    status: str | None = None,
    direction: str | None = None,
    actor: dict[str, Any] | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 500), 5000))
    clean_status = str(status or "").strip().lower()
    clean_direction = str(direction or "").strip().lower()
    role_key = str((actor or {}).get("employee_role_key") or "").strip()
    employee_id = ""
    if _actor_is_employee(actor) and role_key != "general_director":
        employee_id = _actor_user_id(actor)
    with session_scope() as session:
        stmt = select(Transaction).where(
            Transaction.workspace_owner_id == workspace_owner_id,
            Transaction.type == "transfer",
        )
        if clean_status:
            stmt = stmt.where(Transaction.status == clean_status)
        if employee_id:
            account_ids = _visible_account_ids(session, workspace_owner_id, employee_id)
            if clean_direction == "incoming":
                if account_ids:
                    stmt = stmt.where(
                        or_(
                            Transaction.to_account_id.in_(account_ids),
                            Transaction.to_pocket_id.in_(account_ids),
                        ),
                    )
                else:
                    stmt = stmt.where(text("1 = 0"))
            elif clean_direction == "outgoing":
                if account_ids:
                    stmt = stmt.where(
                        or_(
                            Transaction.from_account_id.in_(account_ids),
                            Transaction.from_pocket_id.in_(account_ids),
                        ),
                    )
                else:
                    stmt = stmt.where(text("1 = 0"))
            else:
                stmt = stmt.where(_visible_transaction_condition(workspace_owner_id, account_ids))
        rows = session.execute(stmt.order_by(Transaction.created_at.desc()).limit(limit)).scalars().all()
        account_ids = {
            str(value)
            for row in rows
            for value in (
                row.from_account_id or row.from_pocket_id,
                row.to_account_id or row.to_pocket_id,
            )
            if value
        }
        account_names = {}
        if account_ids:
            account_names = dict(
                session.execute(
                    select(FinanceAccount.id, FinanceAccount.name)
                    .where(
                        FinanceAccount.workspace_owner_id == workspace_owner_id,
                        FinanceAccount.id.in_(account_ids),
                    )
                ).all()
            )
        out = []
        for row in rows:
            item = _tx_to_dict(row)
            from_id = str(row.from_account_id or row.from_pocket_id or "")
            to_id = str(row.to_account_id or row.to_pocket_id or "")
            item["from_account_name"] = account_names.get(from_id, "")
            item["to_account_name"] = account_names.get(to_id, "")
            out.append(item)
        return out


def _actor_can_use_account_for_transfer_resolution(
    session,
    workspace_owner_id: str,
    account_id: str | None,
    actor: dict[str, Any] | None,
) -> bool:
    if not _actor_is_employee(actor):
        return True
    role_key = str((actor or {}).get("employee_role_key") or "").strip()
    if role_key == "general_director":
        return True
    actor_id = _actor_user_id(actor)
    account_id = str(account_id or "").strip()
    if not actor_id or not account_id:
        return False
    return account_id in set(_visible_account_ids(session, workspace_owner_id, actor_id))


def _can_resolve_transfer(session, tx: Transaction, actor: dict[str, Any] | None) -> bool:
    return _actor_can_use_account_for_transfer_resolution(
        session,
        tx.workspace_owner_id,
        tx.to_account_id or tx.to_pocket_id,
        actor,
    )


def resolve_pending_transfer(
    workspace_owner_id: str,
    tx_id: str,
    *,
    action: str,
    actor: dict[str, Any] | None = None,
    to_account_id: str | None = None,
) -> dict[str, Any] | None:
    clean_action = str(action or "").strip().lower()
    if clean_action not in {"confirm", "reject"}:
        raise ValueError("invalid_action")
    with session_scope() as session:
        tx = session.execute(
            select(Transaction)
            .where(
                Transaction.id == tx_id,
                Transaction.workspace_owner_id == workspace_owner_id,
                Transaction.type == "transfer",
            )
            .with_for_update()
        ).scalar_one_or_none()
        if tx is None:
            return None
        if (tx.status or "") != "pending" or not tx.requires_confirmation:
            raise ValueError("not_pending")
        if not _can_resolve_transfer(session, tx, actor):
            raise PermissionError("forbidden")

        _reverse_existing_entries(session, tx.id)
        actor_id = _actor_user_id(actor) or None
        now = datetime.now(timezone.utc)
        if clean_action == "confirm":
            target_account_id = _clean_text(to_account_id)
            if target_account_id:
                account = session.get(FinanceAccount, target_account_id)
                if (
                    account is None
                    or account.workspace_owner_id != workspace_owner_id
                    or not account.is_active
                ):
                    raise ValueError("target_account_not_found")
                if not _actor_can_use_account_for_transfer_resolution(
                    session,
                    workspace_owner_id,
                    target_account_id,
                    actor,
                ):
                    raise PermissionError("account_forbidden")
                tx.to_account_id = target_account_id
                tx.to_pocket_id = target_account_id
            tx.status = "confirmed"
            tx.is_confirmed = True
            tx.confirmed_by = actor_id
            tx.confirmed_at = now
            session.flush()
            _post_confirmed_balances_and_entries(session, workspace_owner_id, tx)
        else:
            tx.status = "rejected"
            tx.is_confirmed = False
            tx.confirmed_by = actor_id
            tx.confirmed_at = now
        session.flush()
        session.refresh(tx)
        return _tx_to_dict(tx)


def _ensure_category(session, workspace_owner_id: str, name: str | None, tx_type: str) -> str | None:
    row_name = _trunc_field(name, _FIN_CATEGORY_NAME_LEN)
    if not row_name:
        return None
    cat_type = tx_type if tx_type in {"income", "expense", "transfer"} else "expense"
    row = session.execute(
        select(FinanceCategory).where(
            FinanceCategory.workspace_owner_id == workspace_owner_id,
            FinanceCategory.type == cat_type,
            FinanceCategory.name == row_name,
        )
    ).scalar_one_or_none()
    if row is None:
        row = FinanceCategory(id=str(uuid.uuid4()), workspace_owner_id=workspace_owner_id, name=row_name, type=cat_type)
        session.add(row)
        session.flush()
    return row.id


def _ensure_branch(session, workspace_owner_id: str, name: str | None) -> str | None:
    if not name:
        return None
    row_name = _trunc_field(name, _BRANCH_NAME_LEN)
    if not row_name:
        return None
    ext_full = row_name.strip().lower()
    ext_id = (
        ext_full
        if len(ext_full) <= _BRANCH_EXTERNAL_ID_LEN
        else ext_full[:_BRANCH_EXTERNAL_ID_LEN]
    )
    row = session.execute(
        select(Branch).where(
            Branch.workspace_owner_id == workspace_owner_id,
            Branch.external_source == "manual",
            Branch.external_id == ext_id,
        )
    ).scalar_one_or_none()
    if row is None:
        row = Branch(
            id=str(uuid.uuid4()),
            workspace_owner_id=workspace_owner_id,
            name=row_name,
            external_source="manual",
            external_id=ext_id,
        )
        session.add(row)
        session.flush()
    return row.id


def _ensure_counterparty(
    session,
    workspace_owner_id: str,
    client: str | None,
    supplier: str | None,
    tx_type: str,
) -> str | None:
    name_src = supplier if tx_type == "expense" and supplier else client or supplier
    name_row = _trunc_field(name_src, _COUNTERPARTY_NAME_LEN)
    if not name_row:
        return None
    kind = "supplier" if tx_type == "expense" and supplier else "client"
    ext_full = f"{kind}:{name_row.strip().lower()}"
    ext_id = (
        ext_full
        if len(ext_full) <= _COUNTERPARTY_EXTERNAL_ID_LEN
        else ext_full[:_COUNTERPARTY_EXTERNAL_ID_LEN]
    )
    row = session.execute(
        select(Counterparty).where(
            Counterparty.workspace_owner_id == workspace_owner_id,
            Counterparty.external_source == "manual",
            Counterparty.external_id == ext_id,
        )
    ).scalar_one_or_none()
    if row is None:
        row = Counterparty(
            id=str(uuid.uuid4()),
            workspace_owner_id=workspace_owner_id,
            kind=kind,
            name=name_row,
            external_source="manual",
            external_id=ext_id,
        )
        session.add(row)
        session.flush()
    return row.id


def _courier_extra_income_postings(raw_data: dict[str, Any], currency: str) -> list[tuple[str | None, str, Decimal, str]]:
    breakdown = raw_data.get("courier_breakdown")
    if (
        not raw_data.get("courier_payment")
        or not raw_data.get("courier_balance_posting")
        or raw_data.get("courier_split_children")
        or not isinstance(breakdown, dict)
    ):
        return []
    rows: list[tuple[str | None, str, Decimal, str]] = []
    for amount_key, account_key in (
        ("transfer", "transfer_account_id"),
        ("terminal", "terminal_account_id"),
    ):
        account_id = str(breakdown.get(account_key) or "").strip()
        if not account_id:
            continue
        try:
            amount = _money(breakdown.get(amount_key))
        except ValueError:
            continue
        if amount <= 0:
            continue
        rows.append((account_id, "in", amount, currency))
    extra_rows = raw_data.get("extra_income_postings")
    if isinstance(extra_rows, list):
        for row in extra_rows:
            if not isinstance(row, dict):
                continue
            account_id = str(row.get("account_id") or row.get("pocket_id") or "").strip()
            if not account_id:
                continue
            extra_currency = str(row.get("currency") or currency or "").strip().upper()[:3]
            if not _CURRENCY_CODE.match(extra_currency):
                continue
            try:
                amount = _money(row.get("amount"))
            except ValueError:
                continue
            if amount <= 0:
                continue
            rows.append((account_id, "in", amount, extra_currency))
    return rows


def _transfer_credit_leg(tx: Transaction) -> tuple[Decimal, str, Decimal, str]:
    """Дебет (списание) и кредит (зачисление) для перевода; при одной валюте суммы совпадают."""
    debit_amt = _money(tx.amount)
    debit_ccy = str(tx.currency or "USD").upper()[:3]
    data = tx.data if isinstance(tx.data, dict) else {}
    credit_ccy = str(data.get("transfer_credit_currency") or "").strip().upper()
    try:
        credit_amt = _money(data.get("transfer_credit_amount", debit_amt))
    except ValueError:
        credit_amt = debit_amt
    if not credit_ccy or not _CURRENCY_CODE.match(credit_ccy):
        credit_ccy = debit_ccy
        credit_amt = debit_amt
    return debit_amt, debit_ccy, credit_amt, credit_ccy


def _tx_postings(tx: Transaction) -> list[tuple[str | None, str, Decimal, str]]:
    amount = _money(tx.amount)
    ccy = str(tx.currency or "USD").upper()[:3]
    pending_transfer = bool(
        tx.type == "transfer"
        and (tx.status or "") == "pending"
        and tx.requires_confirmation
    )
    if not tx.is_confirmed and not pending_transfer:
        return []
    if tx.type == "income":
        data = tx.data if isinstance(tx.data, dict) else {}
        return [
            (tx.to_account_id or tx.to_pocket_id, "in", amount, ccy),
            *_courier_extra_income_postings(data, ccy),
        ]
    if tx.type == "expense":
        return [(tx.from_account_id or tx.from_pocket_id, "out", amount, ccy)]
    if tx.type == "transfer":
        damt, dccy, camt, cccy = _transfer_credit_leg(tx)
        rows = [(tx.from_account_id or tx.from_pocket_id, "out", damt, dccy)]
        if not pending_transfer:
            rows.append((tx.to_account_id or tx.to_pocket_id, "in", camt, cccy))
        return rows
    return []


def _create_entries_for_tx(session, tx: Transaction) -> None:
    for account_id, direction, amount, cur in _tx_postings(tx):
        if not account_id:
            continue
        entry = TransactionEntry(
            id=str(uuid.uuid4()),
            transaction_id=tx.id,
            account_id=account_id,
            direction=direction,
            currency=str(cur).upper()[:3],
            amount=amount,
        )
        session.add(entry)


def _reverse_existing_entries(session, tx_id: str) -> bool:
    entries = session.execute(
        select(TransactionEntry).where(TransactionEntry.transaction_id == tx_id)
    ).scalars().all()
    if not entries:
        return False
    for entry in entries:
        balance = session.execute(
            select(AccountBalance)
            .where(AccountBalance.account_id == entry.account_id, AccountBalance.currency == entry.currency)
            .with_for_update()
        ).scalar_one_or_none()
        if balance is not None:
            delta = _money(entry.amount)
            balance.amount = _money(balance.amount) + (delta if entry.direction == "out" else -delta)
        session.delete(entry)
    return True
