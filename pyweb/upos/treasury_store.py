"""PostgreSQL-хранилище песочницы казны по владельцу рабочего места."""

from __future__ import annotations

import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from upos.db import session_scope
from upos.db_models import AccountBalance, EmployeeAccountAccess, EmployeeOrganization, FinanceAccount, Treasury, User
from upos.fx import convert_through_usd, get_usd_rates
from upos.organizations_store import list_organization_ids, list_organizations
from upos.storage import valid_workspace_owner_id

_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


class TreasuryPostingError(ValueError):
    """Ошибка финансовой проводки между Кассой и Счётом."""


def default_treasury() -> dict[str, Any]:
    return {
        "version": 2,
        "display_currency": "USD",
        "pockets": [],
    }


def load_treasury(workspace_owner_id: str, *, visible_employee_id: str | None = None) -> dict[str, Any]:
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        return default_treasury()
    with session_scope() as session:
        display_currency = "USD"
        legacy = session.get(Treasury, oid)
        if legacy and isinstance(legacy.data, dict) and isinstance(legacy.data.get("display_currency"), str):
            display_currency = legacy.data["display_currency"].strip().upper() or "USD"

        account_stmt = (
            select(FinanceAccount)
            .where(FinanceAccount.workspace_owner_id == oid, FinanceAccount.is_active.is_(True))
            .order_by(FinanceAccount.created_at.asc())
        )
        emp_id = str(visible_employee_id or "").strip()
        if emp_id:
            explicit_ids = [
                str(x)
                for x in session.scalars(
                    select(EmployeeAccountAccess.account_id)
                    .join(FinanceAccount, FinanceAccount.id == EmployeeAccountAccess.account_id)
                    .where(
                        EmployeeAccountAccess.employee_id == emp_id,
                        FinanceAccount.workspace_owner_id == oid,
                        FinanceAccount.is_active.is_(True),
                    ),
                ).all()
            ]
            if explicit_ids:
                account_stmt = account_stmt.where(
                    or_(
                        FinanceAccount.id.in_(explicit_ids),
                        FinanceAccount.owner_employee_id == emp_id,
                    ),
                )
            else:
                account_stmt = account_stmt.where(FinanceAccount.owner_employee_id == emp_id)
        accounts = session.execute(account_stmt).scalars().all()
        if not accounts:
            return {"version": 2, "display_currency": display_currency, "pockets": []}

        balances = session.execute(
            select(AccountBalance).where(AccountBalance.account_id.in_([a.id for a in accounts]))
        ).scalars().all()
        by_account: dict[str, list[AccountBalance]] = {}
        for row in balances:
            by_account.setdefault(row.account_id, []).append(row)
        account_ids = [str(a.id) for a in accounts]
        owner_ids = sorted({str(a.owner_employee_id) for a in accounts if a.owner_employee_id})
        owner_names: dict[str, str] = {}
        if owner_ids:
            users = session.execute(select(User).where(User.id.in_(owner_ids))).scalars().all()
            owner_names = {u.id: (u.name or u.username or "") for u in users}
        access_names: dict[str, list[dict[str, str]]] = {account_id: [] for account_id in account_ids}
        access_rows = session.execute(
            select(EmployeeAccountAccess.account_id, User.id, User.name, User.username)
            .join(User, User.id == EmployeeAccountAccess.employee_id)
            .where(EmployeeAccountAccess.account_id.in_(account_ids))
            .order_by(User.name.asc(), User.username.asc())
        ).all()
        seen_access: set[tuple[str, str]] = set()
        for account_id, employee_id, name, username in access_rows:
            key = (str(account_id), str(employee_id))
            if key in seen_access:
                continue
            seen_access.add(key)
            access_names.setdefault(str(account_id), []).append(
                {
                    "id": str(employee_id),
                    "name": str(name or username or employee_id),
                }
            )
        return {
            "version": 2,
            "display_currency": display_currency,
            "pockets": [_account_to_pocket(a, by_account.get(a.id, []), owner_names, access_names) for a in accounts],
        }


def patch_display_currency(workspace_owner_id: str, display_currency_raw: Any) -> None:
    """Меняет только валюту отображения в метадатных казны, не затрагивая остатки (account_balances)."""
    dc = str(display_currency_raw or "USD").strip().upper()
    if not _CURRENCY_RE.match(dc):
        raise ValueError("Неверная валюта отображения")
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        raise ValueError("invalid workspace_owner_id")
    with session_scope() as session:
        row = session.get(Treasury, oid)
        if row is None:
            merged = dict(default_treasury())
            merged["display_currency"] = dc
            session.add(Treasury(workspace_owner_id=oid, data=merged))
            return
        merged = _normalize_treasury_data(row.data)
        merged["display_currency"] = dc
        row.data = merged


def save_treasury(workspace_owner_id: str, data: dict[str, Any]) -> None:
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        raise ValueError("invalid workspace_owner_id")
    to_save = {
        "version": 2,
        "display_currency": str(data.get("display_currency") or "USD").upper(),
        "pockets": [],
    }
    try:
        with session_scope() as session:
            seen: set[str] = set()
            pockets = data.get("pockets") or []
            if isinstance(pockets, list):
                for raw_pocket in pockets:
                    if not isinstance(raw_pocket, dict):
                        continue
                    cleaned = _normalize_pocket(raw_pocket)
                    account = _upsert_account(session, oid, cleaned)
                    seen.add(account.id)
                    _replace_account_balances(session, account.id, cleaned.get("entries") or [])

            current = session.execute(
                select(FinanceAccount).where(FinanceAccount.workspace_owner_id == oid)
            ).scalars().all()
            for account in current:
                if account.id not in seen:
                    account.is_active = False

            row = session.get(Treasury, oid)
            if row is None:
                session.add(Treasury(workspace_owner_id=oid, data=to_save))
            else:
                row.data = to_save
    except IntegrityError as exc:
        detail = str(getattr(exc, "orig", None) or exc).lower()
        if "uq_finance_accounts_workspace_name" in detail or (
            "finance_accounts" in detail and "name" in detail and "unique" in detail
        ):
            raise ValueError(
                "Уже есть место с таким именем. Задайте другое название счёта."
            ) from exc
        raise ValueError("Не удалось сохранить счета. Обновите страницу.") from exc


def apply_transaction_posting(
    session: Session,
    workspace_owner_id: str,
    tx: dict[str, Any],
    *,
    reverse: bool = False,
) -> None:
    """Применяет или откатывает проводку подтверждённой кассовой операции в account_balances (и подтягивает Treasuries‑строку для display_currency)."""
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        raise TreasuryPostingError("Неверное рабочее место")

    tx_type = str(tx.get("type") or "income").strip().lower()
    tx_status = str(tx.get("status") or ("confirmed" if tx.get("is_confirmed", True) else "pending")).strip().lower()
    pending_transfer = bool(tx_type == "transfer" and tx_status == "pending" and tx.get("requires_confirmation"))
    if not bool(tx.get("is_confirmed", True)) and not pending_transfer:
        return
    currency = str(tx.get("currency") or "USD").strip().upper()
    if not _CURRENCY_RE.match(currency):
        raise TreasuryPostingError("Неверная валюта операции")
    amount = _to_decimal(tx.get("amount"))
    if amount <= 0:
        raise TreasuryPostingError("Сумма операции должна быть больше нуля")

    sign = Decimal("-1") if reverse else Decimal("1")
    postings: list[tuple[str | None, Decimal, str, str]] = []
    to_id = str(tx.get("to_account_id") or tx.get("to_pocket_id") or "").strip()
    from_id = str(tx.get("from_account_id") or tx.get("from_pocket_id") or "").strip()
    if tx_type == "income":
        postings.append((to_id, amount * sign, currency, "Выберите счёт для дохода"))
        raw_data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
        postings.extend(_courier_extra_income_postings(raw_data, currency, sign))
    elif tx_type == "expense":
        postings.append((from_id, -amount * sign, currency, "Выберите счёт для расхода"))
    elif tx_type == "transfer":
        if from_id and to_id and from_id == to_id:
            raise TreasuryPostingError("Для перевода выберите разные счета")
        debit_ccy = currency
        debit_amt = amount
        raw_data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
        credit_ccy = str(raw_data.get("transfer_credit_currency") or "").strip().upper()
        try:
            credit_amt = _to_decimal(raw_data.get("transfer_credit_amount"))
        except TreasuryPostingError:
            credit_amt = Decimal("0.00")
        if not credit_ccy or not _CURRENCY_RE.match(credit_ccy):
            credit_ccy = debit_ccy
            credit_amt = debit_amt
        if credit_amt <= 0:
            raise TreasuryPostingError("Сумма зачисления должна быть больше нуля")
        postings.append((from_id, -debit_amt * sign, debit_ccy, "Выберите счёт списания"))
        if not pending_transfer:
            postings.append((to_id, credit_amt * sign, credit_ccy, "Выберите счёт зачисления"))
    else:
        raise TreasuryPostingError("Неверный тип операции")

    row = session.get(Treasury, oid, with_for_update=True)
    if row is None:
        session.add(Treasury(workspace_owner_id=oid, data=default_treasury()))

    for pocket_id, delta, cur, missing_msg in postings:
        _apply_balance_delta(session, oid, str(pocket_id or "").strip(), cur, delta, missing_msg)

    if row is not None:
        row.data = _normalize_treasury_data(row.data)


def _normalize_treasury_data(raw: Any) -> dict[str, Any]:
    base = default_treasury()
    base["version"] = 2
    if not isinstance(raw, dict):
        return base
    if isinstance(raw.get("display_currency"), str):
        base["display_currency"] = raw["display_currency"].strip().upper() or "USD"
    pockets = raw.get("pockets")
    if isinstance(pockets, list):
        base["pockets"] = [_normalize_pocket(x) for x in pockets if isinstance(x, dict)]
    return base


def _account_to_pocket(
    account: FinanceAccount,
    balances: list[AccountBalance],
    owner_names: dict[str, str] | None = None,
    access_names: dict[str, list[dict[str, str]]] | None = None,
) -> dict[str, Any]:
    owner_employee_id = str(account.owner_employee_id or "").strip()
    access_employees = list((access_names or {}).get(str(account.id), []))
    return {
        "id": account.id,
        "template_id": account.kind or "custom",
        "label": account.name,
        "note": account.note or "",
        "icon": account.icon or "",
        "owner_employee_id": owner_employee_id,
        "owner_employee_name": (owner_names or {}).get(owner_employee_id, "") if owner_employee_id else "",
        "access_employees": access_employees,
        "access_employee_ids": [row["id"] for row in access_employees],
        "access_employee_names": [row["name"] for row in access_employees],
        "entries": [
            {
                "id": row.id,
                "currency": row.currency,
                "amount": float(row.amount or 0),
            }
            for row in sorted(balances, key=lambda x: x.currency)
        ],
    }


def _to_decimal(raw: Any) -> Decimal:
    try:
        return Decimal(str(raw or "0")).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise TreasuryPostingError("Неверная сумма операции") from exc


def _courier_extra_income_postings(
    raw_data: dict[str, Any],
    currency: str,
    sign: Decimal,
) -> list[tuple[str | None, Decimal, str, str]]:
    breakdown = raw_data.get("courier_breakdown")
    if (
        not raw_data.get("courier_payment")
        or not raw_data.get("courier_balance_posting")
        or raw_data.get("courier_split_children")
        or not isinstance(breakdown, dict)
    ):
        return []
    rows: list[tuple[str | None, Decimal, str, str]] = []
    for amount_key, account_key in (
        ("transfer", "transfer_account_id"),
        ("terminal", "terminal_account_id"),
    ):
        account_id = str(breakdown.get(account_key) or "").strip()
        if not account_id:
            continue
        try:
            amount = _to_decimal(breakdown.get(amount_key))
        except TreasuryPostingError:
            continue
        if amount <= 0:
            continue
        rows.append((account_id, amount * sign, currency, "Выберите счёт для зачисления"))
    return rows


def _upsert_account(session: Session, workspace_owner_id: str, pocket: dict[str, Any]) -> FinanceAccount:
    account_id = str(pocket.get("id") or "").strip() or str(uuid.uuid4())
    account = session.get(FinanceAccount, account_id)
    if account is None or account.workspace_owner_id != workspace_owner_id:
        account = FinanceAccount(id=account_id, workspace_owner_id=workspace_owner_id, name=pocket["label"])
        session.add(account)
    account.name = str(pocket.get("label") or "Место хранения").strip() or "Место хранения"
    account.kind = str(pocket.get("template_id") or "custom").strip() or "custom"
    account.icon = str(pocket.get("icon") or "").strip()
    account.note = str(pocket.get("note") or "").strip()
    account.owner_employee_id = _valid_account_owner_employee_id(
        session,
        workspace_owner_id,
        pocket.get("owner_employee_id"),
    )
    account.is_active = True
    session.flush()
    return account


def _valid_account_owner_employee_id(session: Session, workspace_owner_id: str, raw: Any) -> str | None:
    eid = str(raw or "").strip()
    if not eid:
        return None
    row = session.get(User, eid)
    if row is None or not row.employer_user_id:
        return None
    org_id = str(row.organization_id or "").strip()
    if org_id == workspace_owner_id:
        return eid
    linked = session.scalar(
        select(EmployeeOrganization.employee_id).where(
            EmployeeOrganization.employee_id == eid,
            EmployeeOrganization.organization_id == workspace_owner_id,
        ),
    )
    if linked:
        return eid
    if not org_id and str(row.employer_user_id or "").strip() == workspace_owner_id:
        return eid
    return None


def _replace_account_balances(session: Session, account_id: str, entries: list[dict[str, Any]]) -> None:
    existing = {
        row.currency: row
        for row in session.execute(
            select(AccountBalance).where(AccountBalance.account_id == account_id)
        ).scalars().all()
    }
    seen: set[str] = set()
    for entry in entries:
        currency = str(entry.get("currency") or "").strip().upper()
        if not _CURRENCY_RE.match(currency):
            continue
        seen.add(currency)
        row = existing.get(currency)
        if row is None:
            row = AccountBalance(id=str(entry.get("id") or uuid.uuid4()), account_id=account_id, currency=currency)
            session.add(row)
        row.amount = _to_decimal(entry.get("amount"))
    for currency, row in existing.items():
        if currency not in seen:
            session.delete(row)


def _apply_balance_delta(
    session: Session,
    workspace_owner_id: str,
    account_id: str,
    currency: str,
    delta: Decimal,
    missing_msg: str,
) -> None:
    if not account_id:
        raise TreasuryPostingError(missing_msg)
    account = session.get(FinanceAccount, account_id)
    if account is None or account.workspace_owner_id != workspace_owner_id or not account.is_active:
        raise TreasuryPostingError("Выбранный счёт не найден")
    balance = session.execute(
        select(AccountBalance)
        .where(AccountBalance.account_id == account_id, AccountBalance.currency == currency)
        .with_for_update()
    ).scalar_one_or_none()
    if balance is None:
        balance = AccountBalance(id=str(uuid.uuid4()), account_id=account_id, currency=currency, amount=Decimal("0.00"))
        session.add(balance)
        session.flush()
    next_amount = _to_decimal(balance.amount) + delta
    balance.amount = next_amount.quantize(Decimal("0.01"))


def delete_treasury(workspace_owner_id: str) -> None:
    oid = (workspace_owner_id or "").strip()
    if not valid_workspace_owner_id(oid):
        return
    with session_scope() as session:
        session.execute(delete(Treasury).where(Treasury.workspace_owner_id == oid))


def _normalize_pocket(raw: dict[str, Any]) -> dict[str, Any]:
    pid = str(raw.get("id") or "").strip() or str(uuid.uuid4())
    template_id = str(raw.get("template_id") or "custom").strip() or "custom"
    label = str(raw.get("label") or "").strip() or "Место хранения"
    note = str(raw.get("note") or "").strip()
    icon = str(raw.get("icon") or "").strip()
    owner_employee_id = str(raw.get("owner_employee_id") or "").strip()
    entries_in = raw.get("entries")
    entries: list[dict[str, Any]] = []
    if isinstance(entries_in, list):
        for e in entries_in:
            if not isinstance(e, dict):
                continue
            cur = str(e.get("currency") or "").strip().upper()
            if not _CURRENCY_RE.match(cur):
                continue
            try:
                amt = float(e.get("amount", 0))
            except (TypeError, ValueError):
                amt = 0.0
            if amt < 0:
                amt = 0.0
            eid = str(e.get("id") or "").strip() or str(uuid.uuid4())
            entries.append({"id": eid, "currency": cur, "amount": amt})
    return {
        "id": pid,
        "template_id": template_id,
        "label": label,
        "note": note,
        "icon": icon,
        "owner_employee_id": owner_employee_id,
        "entries": entries,
    }

def validate_and_clean_treasury(raw: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    """Грубая валидация тела PUT; возвращает (data, '') или (None, error)."""
    if not isinstance(raw, dict):
        return None, "Неверный формат"
    dc = str(raw.get("display_currency") or "USD").strip().upper()
    if not _CURRENCY_RE.match(dc):
        return None, "Неверная валюта отображения"
    pockets_in = raw.get("pockets")
    if not isinstance(pockets_in, list):
        return None, "Ожидался массив pockets"
    if len(pockets_in) > 48:
        return None, "Слишком много мест хранения"
    pockets: list[dict[str, Any]] = []
    for p in pockets_in:
        if not isinstance(p, dict):
            continue
        cleaned = _normalize_pocket(p)
        if len(cleaned["entries"]) > 24:
            return None, "Слишком много строк в одном месте"
        
        # Check for duplicate currencies in this pocket
        seen = set()
        for e in cleaned["entries"]:
            ccy = e["currency"]
            if ccy in seen:
                return None, f"Валюта {ccy} уже добавлена в счете '{cleaned['label']}'"
            seen.add(ccy)
            
        pockets.append(cleaned)
    return {
        "version": 2,
        "display_currency": dc,
        "pockets": pockets,
    }, ""


def _treasury_pockets_totals_by_currency(pockets: list[dict[str, Any]] | None) -> dict[str, float]:
    out: dict[str, float] = {}
    for pocket in pockets or []:
        if not isinstance(pocket, dict):
            continue
        for entry in pocket.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            ccy = str(entry.get("currency") or "").strip().upper()
            if not _CURRENCY_RE.match(ccy):
                continue
            try:
                amt = float(entry.get("amount") or 0)
            except (TypeError, ValueError):
                amt = 0.0
            out[ccy] = round(out.get(ccy, 0.0) + amt, 2)
    return out


def aggregate_director_treasury(
    owner_user_id: str,
    *,
    organization_id: str | None = None,
    display_currency: str | None = None,
) -> dict[str, Any]:
    """
    Консолидированные остатки по счетам всех организаций владельца.
    Редактирование счёта — только внутри конкретной организации.
    """
    owner_id = (owner_user_id or "").strip()
    allowed = list_organization_ids(owner_id)
    if not allowed:
        return {
            "organizations": [],
            "consolidated_totals_by_currency": {},
            "display_currency": "USD",
            "approx_total_in_display": None,
            "fx_missing_currencies": [],
            "fx": {"stale": False, "as_of": None},
        }

    oid_filter = (organization_id or "").strip()
    if oid_filter and oid_filter not in allowed:
        raise ValueError("organization_not_allowed")

    org_rows_meta = list_organizations(owner_id)
    if oid_filter:
        org_rows_meta = [o for o in org_rows_meta if str(o.get("id")) == oid_filter]

    dc = str(display_currency or "USD").strip().upper()
    if not _CURRENCY_RE.match(dc):
        dc = "USD"

    consolidated: dict[str, float] = {}
    org_payload: list[dict[str, Any]] = []

    for org in org_rows_meta:
        wid = str(org.get("id") or "")
        if not wid:
            continue
        treas = load_treasury(wid)
        pockets_in = treas.get("pockets") or []
        pocket_views: list[dict[str, Any]] = []
        for p in pockets_in:
            if not isinstance(p, dict):
                continue
            entries_clean = []
            for e in p.get("entries") or []:
                if not isinstance(e, dict):
                    continue
                ccy = str(e.get("currency") or "").strip().upper()
                if not _CURRENCY_RE.match(ccy):
                    continue
                try:
                    amt = float(e.get("amount") or 0)
                except (TypeError, ValueError):
                    amt = 0.0
                entries_clean.append({"currency": ccy, "amount": round(amt, 2)})
            pocket_views.append(
                {
                    "label": str(p.get("label") or ""),
                    "template_id": str(p.get("template_id") or "custom"),
                    "icon": str(p.get("icon") or ""),
                    "entries": entries_clean,
                },
            )

        totals = _treasury_pockets_totals_by_currency(pockets_in if isinstance(pockets_in, list) else [])
        for ccy, amt in totals.items():
            consolidated[ccy] = round(consolidated.get(ccy, 0.0) + amt, 2)

        org_payload.append(
            {
                "organization_id": wid,
                "organization_name": str(org.get("name") or ""),
                "display_currency": str(treas.get("display_currency") or "USD").upper(),
                "totals_by_currency": totals,
                "pockets": pocket_views,
                "pocket_count": len(pocket_views),
            },
        )

    fx_pack = get_usd_rates()
    rates_raw = fx_pack.get("rates") if isinstance(fx_pack.get("rates"), dict) else {}
    rates: dict[str, float] = {}
    for rk, rv in rates_raw.items():
        if not isinstance(rk, str):
            continue
        try:
            fv = float(rv)
        except (TypeError, ValueError):
            continue
        if fv <= 0:
            continue
        code = rk.strip().upper()
        if len(code) == 3:
            rates[code] = fv
    approx: float | None = 0.0
    fx_missing: list[str] = []
    for ccy, amt in consolidated.items():
        conv = convert_through_usd(float(amt), ccy, dc, rates)
        if conv is None:
            fx_missing.append(ccy)
            approx = None
        elif approx is not None:
            approx = round(approx + float(conv), 2)

    return {
        "organizations": sorted(
            org_payload,
            key=lambda x: (str(x.get("organization_name") or "").lower(), str(x.get("organization_id") or "")),
        ),
        "consolidated_totals_by_currency": dict(sorted(consolidated.items(), key=lambda kv: kv[0])),
        "display_currency": dc,
        "approx_total_in_display": approx,
        "fx_missing_currencies": sorted(set(fx_missing)),
        "fx": {
            "stale": bool(fx_pack.get("stale")),
            "as_of": fx_pack.get("as_of"),
            "base": fx_pack.get("base") or "USD",
        },
    }
