"""Telegram report formatting."""

from __future__ import annotations

import html
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from upos.db import session_scope
from upos.db_models import FinanceAccount, Organization, Transaction, User
from upos.storage import load_workspace_settings
from upos.telegram_store import workspace_display_name
from upos.timezones import normalize_workspace_timezone
from upos.treasury_store import load_treasury
from upos.transactions_store import get_pnl_data


def _esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=False)


def _fmt_amount(amount: Any, currency: str) -> str:
    try:
        number = float(amount)
    except (TypeError, ValueError):
        number = 0.0
    cur = (currency or "UZS").strip().upper()
    if number == int(number):
        body = f"{int(number):,}".replace(",", " ")
    else:
        body = f"{number:,.2f}".replace(",", " ").replace(".", ",").rstrip("0").rstrip(",")
    return f"{body} {cur}"


def _plain(value: Any, fallback: str = "—") -> str:
    text = " ".join(str(value or "").split())
    return text or fallback


def _clip(value: Any, max_len: int) -> str:
    text = _plain(value)
    if len(text) <= max_len:
        return text
    return text[: max(max_len - 1, 1)] + "…"


def _pre_table(headers: tuple[str, ...], rows: list[tuple[Any, ...]], *, right: set[int] | None = None) -> str:
    right = right or set()
    body = [tuple(_plain(cell) for cell in row) for row in rows]
    if not body:
        body = [tuple("—" for _ in headers)]
    widths = [
        max(len(headers[idx]), *(len(row[idx]) for row in body))
        for idx in range(len(headers))
    ]
    lines = [
        "  ".join(
            f"{header:>{widths[idx]}}" if idx in right else f"{header:<{widths[idx]}}"
            for idx, header in enumerate(headers)
        ),
        "  ".join("-" * width for width in widths),
    ]
    for row in body:
        lines.append(
            "  ".join(
                f"{row[idx]:>{widths[idx]}}" if idx in right else f"{row[idx]:<{widths[idx]}}"
                for idx in range(len(headers))
            )
        )
    return f"<pre>{_esc(chr(10).join(lines))}</pre>"


def _kv_table(rows: list[tuple[str, Any]]) -> str:
    filtered = [(label, _clip(value, 34)) for label, value in rows if _plain(value, "") != ""]
    if not filtered:
        return "<pre>—</pre>"
    label_width = max(len(label) for label, _ in filtered)
    value_width = max(len(str(value)) for _, value in filtered)
    lines = [
        f"{label:<{label_width}}  {value:<{value_width}}"
        for label, value in filtered
    ]
    return f"<pre>{_esc(chr(10).join(lines))}</pre>"


def _type_label(tx_type: str) -> tuple[str, str]:
    value = (tx_type or "").strip().lower()
    if value == "income":
        return "📈 Доход", "income"
    if value == "expense":
        return "📉 Расход", "expense"
    if value == "transfer":
        return "🔄 Перевод", "transfer"
    return "💼 Операция", value


_ACCOUNT_CACHE_TTL_SEC = 60.0
_account_cache_lock = Lock()
_account_cache: dict[str, tuple[float, dict[str, str]]] = {}


def _account_name_map(workspace_owner_id: str) -> dict[str, str]:
    wid = (workspace_owner_id or "").strip()
    now = time.monotonic()
    with _account_cache_lock:
        entry = _account_cache.get(wid)
        if entry is not None and now - entry[0] < _ACCOUNT_CACHE_TTL_SEC:
            return dict(entry[1])
    treasury = load_treasury(wid)
    names: dict[str, str] = {}
    for pocket in treasury.get("pockets") or []:
        pid = str(pocket.get("id") or "").strip()
        if pid:
            names[pid] = str(pocket.get("label") or pocket.get("name") or pocket.get("title") or pid)
    with session_scope() as session:
        rows = session.execute(
            select(FinanceAccount).where(FinanceAccount.workspace_owner_id == wid),
        ).scalars().all()
        for account in rows:
            names[str(account.id)] = str(account.name or account.id)
    with _account_cache_lock:
        _account_cache[wid] = (now, dict(names))
    return names


def invalidate_account_name_cache(workspace_owner_id: str) -> None:
    wid = (workspace_owner_id or "").strip()
    with _account_cache_lock:
        _account_cache.pop(wid, None)


def _employee_name(employee_id: str | None) -> str:
    eid = (employee_id or "").strip()
    if not eid:
        return ""
    with session_scope() as session:
        user = session.get(User, eid)
        if user and (user.name or "").strip():
            return user.name.strip()
    return ""


def _format_local_time(iso_ts: str | None, tz_name: str) -> str:
    if not iso_ts:
        return "—"
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone(ZoneInfo(tz_name))
        return local.strftime("%d.%m.%Y %H:%M")
    except Exception:
        return str(iso_ts or "—")


def _local_date_label(dt: datetime, tz_name: str) -> str:
    local = dt.astimezone(ZoneInfo(tz_name))
    return local.strftime("%d.%m.%Y")


def _organization_title(workspace_owner_id: str, tx: dict[str, Any]) -> str:
    name = str(tx.get("organization_name") or "").strip()
    if name:
        return name
    wid = (workspace_owner_id or "").strip()
    if wid:
        with session_scope() as session:
            org = session.get(Organization, wid)
            if org and (org.name or "").strip():
                return org.name.strip()
    return workspace_display_name(workspace_owner_id)


def _transaction_actor_name(tx: dict[str, Any]) -> str:
    data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
    raw = (
        tx.get("actor_name")
        or data.get("author")
        or _employee_name(tx.get("employee_id"))
        or ""
    )
    return _plain(raw)


def _transaction_detail_rows(workspace_owner_id: str, tx: dict[str, Any]) -> list[tuple[str, str]]:
    accounts = _account_name_map(workspace_owner_id)
    type_label, _ = _type_label(str(tx.get("type") or ""))
    tx_type = str(tx.get("type") or "").lower()
    data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
    amount_line = _fmt_amount(tx.get("amount"), str(tx.get("currency") or "UZS"))
    if tx_type == "transfer":
        credit_currency = str(data.get("transfer_credit_currency") or tx.get("currency") or "UZS")
        credit_amount = data.get("transfer_credit_amount")
        if credit_amount not in (None, "") and credit_currency.upper() != str(tx.get("currency") or "").upper():
            amount_line = f"{amount_line} → {_fmt_amount(credit_amount, credit_currency)}"

    category = _plain(tx.get("category"))
    counterparty = _plain(tx.get("client") or tx.get("supplier"), "")
    branch = _plain(tx.get("branch"), "")
    note = _plain(tx.get("note"), "")
    actor = _transaction_actor_name(tx)

    from_id = str(tx.get("from_account_id") or tx.get("from_pocket_id") or "")
    to_id = str(tx.get("to_account_id") or tx.get("to_pocket_id") or "")
    from_name = _plain(tx.get("from_account_name") or accounts.get(from_id) or ("—" if not from_id else from_id[:8]))
    to_name = _plain(tx.get("to_account_name") or accounts.get(to_id) or ("—" if not to_id else to_id[:8]))

    if tx_type == "transfer":
        account_line = f"{from_name} → {to_name}"
    elif tx_type == "income":
        account_line = f"→ {to_name}" if to_id else to_name
    else:
        account_line = f"{from_name} →" if from_id else from_name

    body_rows = [
        ("Тип", type_label),
        ("Сумма", amount_line),
        ("Категория", category),
        ("Движение", account_line),
    ]
    if counterparty:
        body_rows.append(("Контрагент", counterparty))
    if branch:
        body_rows.append(("Филиал", branch))
    if note:
        body_rows.append(("Комментарий", note))
    return body_rows


def _operation_account_balance_block(workspace_owner_id: str, tx: dict[str, Any]) -> str:
    tx_type = str(tx.get("type") or "").lower()
    account_id = ""
    if tx_type == "income":
        account_id = str(tx.get("to_account_id") or tx.get("to_pocket_id") or "").strip()
    else:
        account_id = str(tx.get("from_account_id") or tx.get("from_pocket_id") or "").strip()
    if not account_id:
        return ""
    treasury = load_treasury(workspace_owner_id)
    for pocket in treasury.get("pockets") or []:
        if str(pocket.get("id") or "").strip() != account_id:
            continue
        name = _plain(pocket.get("label") or pocket.get("name") or "Счёт")
        rows = [name]
        for entry in pocket.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            currency = str(entry.get("currency") or "UZS").strip().upper() or "UZS"
            rows.append(_fmt_amount(entry.get("amount"), currency))
        if len(rows) == 1:
            rows.append("0 UZS")
        return f"<b>Остаток в кассе</b>\n<pre>{_esc(chr(10).join(rows))}</pre>"
    return ""


def _transaction_details_lines(tx: dict[str, Any]) -> list[str]:
    data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
    tx_type = str(tx.get("type") or "").lower()
    amount = _fmt_amount(tx.get("amount"), str(tx.get("currency") or "UZS"))
    if tx_type == "transfer":
        credit_currency = str(data.get("transfer_credit_currency") or tx.get("currency") or "UZS")
        credit_amount = data.get("transfer_credit_amount")
        if credit_amount not in (None, "") and credit_currency.upper() != str(tx.get("currency") or "").upper():
            amount = f"{amount} → {_fmt_amount(credit_amount, credit_currency)}"
    rows = [
        f"• Номер: {_esc(tx.get('number') or '—')}",
        f"• Сумма: {_esc(amount)}",
        f"• Категория: {_esc(tx.get('category') or '—')}",
    ]
    counterparty = _plain(tx.get("client") or tx.get("supplier"), "")
    note = _plain(tx.get("note"), "")
    if counterparty:
        rows.append(f"• Контрагент: {_esc(counterparty)}")
    if note:
        rows.append(f"• Комментарий: {_esc(note)}")
    return rows


def format_transaction_message(workspace_owner_id: str, tx: dict[str, Any]) -> str:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    tx_number = tx.get("number") or "—"
    body_rows = _transaction_detail_rows(workspace_owner_id, tx)
    balance_block = _operation_account_balance_block(workspace_owner_id, tx)
    lines = [
        f"🕐 <b>Дата и время:</b> {_format_local_time(tx.get('created_at'), tz)}",
        f"<b>Организация:</b> {_esc(_organization_title(workspace_owner_id, tx))}",
        f"<b>Кто сделал:</b> {_esc(_transaction_actor_name(tx))}",
        "",
        f"💰 <b>{_esc(_organization_title(workspace_owner_id, tx))} · операция #{_esc(tx_number)}</b>",
        "━━━━━━━━━━━━━━━━",
        "",
        _kv_table(body_rows),
    ]
    if balance_block:
        lines.extend(["", balance_block])
    lines.extend(["", "<b>Подробности операции</b>", "\n".join(_transaction_details_lines(tx))])
    return "\n".join(lines)


def format_transaction_deleted_message(workspace_owner_id: str, tx: dict[str, Any]) -> str:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    tx_number = tx.get("number") or "—"
    deleted_by = _esc(tx.get("deleted_by_name") or "—")
    deleted_at = tx.get("deleted_at") or tx.get("updated_at")
    created_by = _transaction_actor_name(tx)
    body_rows = _transaction_detail_rows(workspace_owner_id, tx)
    meta_rows = [
        ("Кто удалил", deleted_by),
        ("Удалено", _format_local_time(deleted_at, tz)),
        ("Создал", created_by),
    ]
    lines = [
        f"🗑 <b>{_esc(_organization_title(workspace_owner_id, tx))} · операция удалена #{_esc(tx_number)}</b>",
        f"🕐 Создана: {_format_local_time(tx.get('created_at'), tz)}",
        "━━━━━━━━━━━━━━━━",
        "",
        _kv_table(meta_rows),
        "",
        _kv_table(body_rows),
    ]
    return "\n".join(lines)


def sample_transaction(kind: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    org_test = "Организация (тест)"
    if kind == "tx_expense":
        return {
            "number": "TEST",
            "type": "expense",
            "amount": 450000,
            "currency": "UZS",
            "category": "Аренда (тест)",
            "branch": "Главный офис",
            "note": "Тестовое уведомление",
            "organization_name": org_test,
            "actor_name": "U-POS FINANCE",
            "from_account_name": "Основная касса",
            "created_at": now,
        }
    if kind == "tx_transfer":
        return {
            "number": "TEST",
            "type": "transfer",
            "amount": 1000,
            "currency": "USD",
            "category": "Перевод (тест)",
            "note": "Тестовый перевод между счетами",
            "organization_name": org_test,
            "actor_name": "U-POS FINANCE",
            "from_account_name": "Касса USD",
            "to_account_name": "Банк USD",
            "created_at": now,
        }
    return {
        "number": "TEST",
        "type": "income",
        "amount": 1250000,
        "currency": "UZS",
        "category": "Продажа (тест)",
        "client": "ООО «Пример»",
        "branch": "Ташкент-1",
        "note": "Тестовое уведомление",
        "organization_name": org_test,
        "actor_name": "U-POS FINANCE",
        "to_account_name": "Основная касса",
        "created_at": now,
    }


def format_digest(
    workspace_owner_id: str,
    *,
    start_utc: datetime,
    end_utc: datetime,
    title_label: str,
    empty: bool = False,
) -> str:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    if empty:
        return (
            f"📊 <b>{_esc(_org_label(workspace_owner_id))} · {title_label}</b>\n"
            "━━━━━━━━━━━━━━━━\n"
            "Операций за период не было."
        )

    pnl = get_pnl_data(workspace_owner_id, start_utc, end_utc)
    income_rows = list(pnl.get("income") or [])
    expense_rows = list(pnl.get("expense") or [])

    inc_by_ccy: dict[str, float] = {}
    exp_by_ccy: dict[str, float] = {}
    inc_count = 0
    exp_count = 0
    for row in income_rows:
        currency = str(row.get("currency") or "UZS").upper()
        inc_by_ccy[currency] = inc_by_ccy.get(currency, 0.0) + float(row.get("amount") or 0)
        inc_count += int(row.get("count") or 0)
    for row in expense_rows:
        currency = str(row.get("currency") or "UZS").upper()
        exp_by_ccy[currency] = exp_by_ccy.get(currency, 0.0) + float(row.get("amount") or 0)
        exp_count += int(row.get("count") or 0)

    with session_scope() as session:
        tx_count = session.scalar(
            select(func.count(Transaction.id)).where(
                Transaction.workspace_owner_id == workspace_owner_id,
                Transaction.is_confirmed.is_(True),
                Transaction.created_at >= start_utc,
                Transaction.created_at < end_utc,
            ),
        ) or 0

    total_rows = [
        ("Операций", int(tx_count)),
        ("Доходных", inc_count),
        ("Расходных", exp_count),
    ]
    currency_rows: list[tuple[str, str, str, str]] = []
    all_ccy = set(inc_by_ccy) | set(exp_by_ccy)
    for currency in sorted(all_ccy):
        income = inc_by_ccy.get(currency, 0.0)
        expense = exp_by_ccy.get(currency, 0.0)
        net = income - expense
        currency_rows.append((
            currency,
            _fmt_amount(income, currency),
            _fmt_amount(expense, currency),
            _fmt_amount(net, currency),
        ))

    lines = [
        f"📊 <b>{_esc(_org_label(workspace_owner_id))} · {title_label}</b>",
        "━━━━━━━━━━━━━━━━",
        _kv_table(total_rows),
        "",
        "<b>Итоги по валютам</b>",
    ]
    lines.append(_pre_table(("Вал", "Доход", "Расход", "Итог"), currency_rows, right={1, 2, 3}))

    top_inc = sorted(income_rows, key=lambda row: -float(row.get("amount") or 0))[:3]
    top_exp = sorted(expense_rows, key=lambda row: -float(row.get("amount") or 0))[:3]
    if top_inc:
        lines.append("")
        lines.append("<b>Топ доходов</b>")
        lines.append(_pre_table(
            ("Категория", "Сумма"),
            [(_clip(row.get("name"), 24), _fmt_amount(row.get("amount"), row.get("currency"))) for row in top_inc],
            right={1},
        ))
    if top_exp:
        lines.append("")
        lines.append("<b>Топ расходов</b>")
        lines.append(_pre_table(
            ("Категория", "Сумма"),
            [(_clip(row.get("name"), 24), _fmt_amount(row.get("amount"), row.get("currency"))) for row in top_exp],
            right={1},
        ))

    lines.append("")
    lines.append(f"Период: {_local_date_label(start_utc, tz)} - {_local_date_label(end_utc, tz)}")
    return "\n".join(lines)


def format_daily_digest(
    workspace_owner_id: str,
    *,
    start_utc: datetime,
    end_utc: datetime,
    empty: bool = False,
    title_label: str | None = None,
) -> str:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    label = title_label or f"Итоги за {_local_date_label(start_utc, tz)}"
    return format_digest(workspace_owner_id, start_utc=start_utc, end_utc=end_utc, title_label=label, empty=empty)


def format_balance_snapshot(workspace_owner_id: str) -> str:
    treasury = load_treasury(workspace_owner_id)
    lines = [
        f"🏦 <b>{_esc(_org_label(workspace_owner_id))} · Остатки по счетам</b>",
    ]
    pockets = treasury.get("pockets") or []
    if not pockets:
        lines.append("Счета не настроены.")
        return "\n".join(lines)

    rows: list[tuple[str, str, str]] = []
    for pocket in pockets[:30]:
        account = str(pocket.get("label") or pocket.get("name") or "Счёт").strip() or "Счёт"
        entries = [entry for entry in (pocket.get("entries") or []) if isinstance(entry, dict)]
        if not entries:
            rows.append((account, "-", "0"))
            continue
        for entry in entries:
            currency = str(entry.get("currency") or "UZS").strip().upper() or "UZS"
            rows.append((account, currency, _fmt_amount(entry.get("amount"), currency)))

    account_width = min(max(len("Счет"), *(len(row[0]) for row in rows)), 24)
    currency_width = max(len("Вал"), *(len(row[1]) for row in rows))
    amount_width = max(len("Остаток"), *(len(row[2]) for row in rows))
    table = [
        f"{'Счет':<{account_width}} {'Вал':<{currency_width}} {'Остаток':>{amount_width}}",
        f"{'-' * account_width} {'-' * currency_width} {'-' * amount_width}",
    ]
    for account, currency, amount in rows:
        short = account if len(account) <= account_width else account[: max(account_width - 1, 1)] + "…"
        table.append(f"{short:<{account_width}} {currency:<{currency_width}} {amount:>{amount_width}}")
    lines.append(f"<pre>{_esc(chr(10).join(table))}</pre>")
    if len(pockets) > 30:
        lines.append(f"…ещё {len(pockets) - 30} счетов")
    return "\n".join(lines)


def _bot_command(command: str, bot_username: str | None = None) -> str:
    username = str(bot_username or "").strip().lstrip("@")
    if username:
        return f"{command}@{username}"
    return command


def balance_report_keyboard(bot_username: str | None = None) -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [{"text": "Остаток", "callback_data": "upos:balance"}],
        ],
    }
