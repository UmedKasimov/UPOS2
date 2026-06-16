"""Telegram notification delivery."""

from __future__ import annotations

import logging
import html
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from upos.storage import load_workspace_settings
from upos.telegram_client import TelegramApiError, send_message
from upos.telegram_reports import (
    format_balance_snapshot,
    format_daily_digest,
    format_digest,
    format_transaction_deleted_message,
    format_transaction_message,
    sample_transaction,
)
from upos.telegram_store import (
    delivery_targets,
    get_bot_config_with_token,
    get_bot_token,
    get_notification_prefs,
    log_delivery,
    should_send_dedupe,
    workspace_display_name,
)
from upos.timezones import normalize_workspace_timezone
from upos.treasury_store import load_treasury
from upos.transactions_store import list_transactions

logger = logging.getLogger(__name__)

TEST_KINDS = frozenset(
    {
        "tx_income",
        "tx_expense",
        "tx_transfer",
        "tx_real_last",
        "daily_today",
        "daily_yesterday",
        "daily_empty",
        "month_to_date",
        "balance_snapshot",
        "weekly",
    },
)

_REPORT_ACTION_KEYS = frozenset(
    {
        "income",
        "courier_payment",
        "expense",
        "transfer",
        "daily",
        "weekly",
        "monthly",
    }
)


def _report_key_for_kind(kind: str) -> str | None:
    k = (kind or "").strip().lower()
    if k.startswith("test:"):
        return None
    if k in ("transaction", "transaction_deleted") or k.startswith("tx"):
        return "transactions"
    if k == "hr_attendance":
        return "hr_attendance"
    if k == "daily":
        return "daily"
    if k == "weekly":
        return "weekly"
    if k == "month":
        return "monthly"
    if "balance" in k:
        return "balance"
    return None


def _prefs_allow(workspace_owner_id: str, report_key: str) -> bool:
    prefs = get_notification_prefs(workspace_owner_id)
    reports = prefs.get("reports") if isinstance(prefs.get("reports"), dict) else {}
    return bool(reports.get(report_key, True))


def _bot_username(workspace_owner_id: str) -> str:
    cfg, _ = get_bot_config_with_token(workspace_owner_id)
    return str((cfg or {}).get("bot_username") or "").strip()


def _default_report_keyboard(workspace_owner_id: str, report_key: str | None) -> dict[str, Any] | None:
    return None


def _template_time_context(workspace_owner_id: str) -> dict[str, str]:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    now_local = datetime.now(ZoneInfo(tz))
    return {
        "organization": html.escape(workspace_display_name(workspace_owner_id), quote=False),
        "date": now_local.strftime("%d.%m.%Y"),
        "time": now_local.strftime("%H:%M"),
    }


def _apply_template(
    workspace_owner_id: str,
    report_key: str | None,
    text: str,
    *,
    context: dict[str, Any] | None = None,
) -> str:
    if not report_key:
        return text
    if report_key in {"income", "expense", "transfer"}:
        return text[:4096]
    prefs = get_notification_prefs(workspace_owner_id)
    templates = prefs.get("templates") if isinstance(prefs.get("templates"), dict) else {}
    template = str(templates.get(report_key) or "{text}").strip() or "{text}"
    if (
        report_key in {"income", "expense", "transfer"}
        and "{text}" in template
        and "{balances}" in template
        and "Подробности" in template
    ):
        header = template.split("{text}", 1)[0].rstrip()
        template = f"{header}\n\n{{text}}\n\n<b>Остаток в кассе</b>\n{{balance_table}}"
    if template == "{text}":
        if report_key in {"income", "expense", "transfer"}:
            return f"{text}\n\n<b>Остаток в кассе</b>\n{_workspace_balance_table(workspace_owner_id)}"[:4096]
        return text
    values = _template_time_context(workspace_owner_id)
    values["text"] = text
    values["report"] = html.escape(str(report_key or ""), quote=False)
    for key, value in (context or {}).items():
        if key == "text":
            continue
        values[str(key)] = html.escape(str(value or ""), quote=False)
    out = template
    if report_key in {"income", "expense", "transfer"}:
        balances = values.get("balances") or html.escape(_workspace_balance_summary(workspace_owner_id), quote=False)
        values["balances"] = balances
        values["balance_table"] = _workspace_balance_table(workspace_owner_id)
        if "{balances}" not in out and "{balance_table}" not in out:
            out = f"{out}\n\n<b>Остаток в кассе</b>\n{{balance_table}}"
    for key, value in values.items():
        out = out.replace("{" + key + "}", value)
    return out[:4096]


def _transaction_report_key(tx: dict[str, Any]) -> str:
    data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
    if data.get("courier_payment"):
        return "courier_payment"
    tx_type = str(tx.get("type") or "").strip().lower()
    if tx_type in {"income", "expense", "transfer"}:
        return tx_type
    return "transactions"


def _template_amount(raw: Any) -> str:
    try:
        value = Decimal(str(raw or "0").replace(" ", "").replace("\u202f", "").replace(",", "."))
    except (InvalidOperation, ValueError):
        value = Decimal("0")
    rounded = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if rounded == rounded.to_integral_value():
        return f"{int(rounded):,}".replace(",", " ")
    return f"{rounded:,.2f}".replace(",", " ").replace(".", ",").rstrip("0").rstrip(",")


def _workspace_balance_summary(workspace_owner_id: str) -> str:
    totals: dict[str, Decimal] = {}
    treasury = load_treasury(workspace_owner_id)
    for pocket in treasury.get("pockets") or []:
        for entry in pocket.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            currency = str(entry.get("currency") or "UZS").strip().upper() or "UZS"
            try:
                amount = Decimal(str(entry.get("amount") or "0"))
            except (InvalidOperation, ValueError):
                amount = Decimal("0")
            totals[currency] = totals.get(currency, Decimal("0")) + amount
    if not totals:
        return "0 UZS"
    order = {"UZS": 0, "USD": 1, "EUR": 2, "RUB": 3}
    parts = [
        f"{_template_amount(amount)} {currency}"
        for currency, amount in sorted(totals.items(), key=lambda item: (order.get(item[0], 50), item[0]))
        if amount != 0
    ]
    return ", ".join(parts) if parts else "0 UZS"


def _workspace_balance_table(workspace_owner_id: str) -> str:
    totals: dict[str, Decimal] = {}
    treasury = load_treasury(workspace_owner_id)
    for pocket in treasury.get("pockets") or []:
        for entry in pocket.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            currency = str(entry.get("currency") or "UZS").strip().upper() or "UZS"
            try:
                amount = Decimal(str(entry.get("amount") or "0"))
            except (InvalidOperation, ValueError):
                amount = Decimal("0")
            totals[currency] = totals.get(currency, Decimal("0")) + amount
    rows = [
        (currency, f"{_template_amount(amount)} {currency}")
        for currency, amount in sorted(totals.items(), key=lambda item: ({"UZS": 0, "USD": 1, "EUR": 2, "RUB": 3}.get(item[0], 50), item[0]))
        if amount != 0
    ] or [("UZS", "0 UZS")]
    ccy_width = max(len("Вал"), *(len(currency) for currency, _ in rows))
    amount_width = max(len("Остаток"), *(len(amount) for _, amount in rows))
    lines = [
        f"{'Вал':<{ccy_width}}  {'Остаток':>{amount_width}}",
        f"{'-' * ccy_width}  {'-' * amount_width}",
    ]
    lines.extend(f"{currency:<{ccy_width}}  {amount:>{amount_width}}" for currency, amount in rows)
    return f"<pre>{html.escape(chr(10).join(lines), quote=False)}</pre>"


def _courier_breakdown_template_context(tx: dict[str, Any]) -> dict[str, Any]:
    data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
    breakdown = data.get("courier_breakdown") if isinstance(data.get("courier_breakdown"), dict) else {}
    currency = str(tx.get("currency") or "UZS").strip().upper() or "UZS"
    courier_name = str(data.get("courier_name") or tx.get("supplier") or tx.get("client") or "").strip()
    expense_type = str(breakdown.get("expense_type") or "").strip()
    def amount(key: str, fallback: Any = 0) -> str:
        return _template_amount(breakdown.get(key, fallback))

    table_rows = [
        ("Отгружено", amount("shipment_total")),
        ("Тек. долг", amount("debt_base")),
        ("Перечисление", amount("transfer")),
        ("Терминал", amount("terminal")),
        ("Возврат", amount("return_goods")),
        ("Скидка", amount("discount")),
        ("Долги", amount("current_debt")),
        ("Старый долг", amount("old_debt")),
        ("Расходы", amount("expense")),
        ("Наличка", amount("cash", tx.get("amount"))),
    ]
    label_width = 12
    amount_header = f"Сумма {currency}"
    amount_width = max(len(amount_header), 10, *(len(value) for _, value in table_rows), len(amount("difference")))
    separator = "-" * (label_width + 1 + amount_width)
    table_lines = [
        f"{'Показатель':<{label_width}} {amount_header:>{amount_width}}",
        separator,
    ]
    table_lines.extend(f"{label:<{label_width}} {value:>{amount_width}}" for label, value in table_rows)
    if expense_type:
        table_lines.append(f"Тип расхода: {expense_type}")
    table_lines.extend(
        [
            separator,
            f"{'Разница':<{label_width}} {amount('difference'):>{amount_width}}",
        ]
    )
    return {
        "courier_name": courier_name,
        "courier_table": "\n".join(table_lines),
        "shipment_total": amount("shipment_total"),
        "debt_base": amount("debt_base"),
        "transfer": amount("transfer"),
        "terminal": amount("terminal"),
        "return_goods": amount("return_goods"),
        "discount": amount("discount"),
        "current_debt": amount("current_debt"),
        "old_debt": amount("old_debt"),
        "expense": amount("expense"),
        "expense_type": expense_type,
        "cash": amount("cash", tx.get("amount")),
        "difference": amount("difference"),
        "expected_cash": amount("expected_cash"),
    }


def _transaction_template_context(tx: dict[str, Any]) -> dict[str, Any]:
    data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
    credit_amount = data.get("transfer_credit_amount")
    if credit_amount in (None, ""):
        credit_amount = tx.get("amount")
    context = {
        "number": tx.get("number") or "",
        "type": tx.get("type") or "",
        "amount": _template_amount(tx.get("amount")),
        "currency": tx.get("currency") or "",
        "credit_amount": _template_amount(credit_amount),
        "credit_currency": data.get("transfer_credit_currency") or tx.get("currency") or "",
        "category": tx.get("category") or "",
        "counterparty": tx.get("client") or tx.get("supplier") or "",
        "from_account": tx.get("from_account_name") or "",
        "to_account": tx.get("to_account_name") or "",
        "note": tx.get("note") or "",
    }
    if data.get("courier_payment"):
        context.update(_courier_breakdown_template_context(tx))
    return context


def _broadcast(
    workspace_owner_id: str,
    text: str,
    *,
    kind: str,
    dedupe_key: str = "",
    dedupe_window_seconds: int = 60,
    report_key: str | None = None,
    target_report_key: str | None = None,
    apply_template: bool = True,
    template_context: dict[str, Any] | None = None,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    token = get_bot_token(workspace_owner_id)
    if not token:
        return {"ok": False, "error": "not_connected", "sent": 0}

    report_key = report_key if report_key is not None else _report_key_for_kind(kind)
    pref_key = report_key or target_report_key
    if pref_key and not _prefs_allow(workspace_owner_id, pref_key):
        return {"ok": True, "skipped": "disabled", "sent": 0}

    if dedupe_key and not should_send_dedupe(
        workspace_owner_id,
        dedupe_key,
        window_seconds=dedupe_window_seconds,
    ):
        return {"ok": True, "sent": 0, "skipped": "dedupe"}

    if reply_markup is None:
        reply_markup = _default_report_keyboard(workspace_owner_id, report_key)

    targets = delivery_targets(workspace_owner_id, target_report_key if target_report_key is not None else report_key)
    if not targets:
        return {"ok": False, "error": "no_targets", "sent": 0}

    if apply_template:
        text = _apply_template(workspace_owner_id, report_key, text, context=template_context)

    sent = 0
    errors: list[str] = []
    for chat_id in targets:
        try:
            send_message(token, chat_id, text, reply_markup=reply_markup)
            log_delivery(
                workspace_owner_id,
                kind=kind,
                target_chat_id=chat_id,
                dedupe_key=dedupe_key,
                ok=True,
            )
            sent += 1
        except TelegramApiError as exc:
            err = str(exc)
            errors.append(err)
            log_delivery(
                workspace_owner_id,
                kind=kind,
                target_chat_id=chat_id,
                dedupe_key=dedupe_key,
                ok=False,
                error=err,
            )
            logger.warning("[telegram] send to %s failed: %s", chat_id, err)

    return {"ok": sent > 0, "sent": sent, "errors": errors[:3]}


def notify_transaction_created(workspace_owner_id: str, tx: dict[str, Any]) -> dict[str, Any]:
    if not tx.get("is_confirmed"):
        return {"ok": False, "skipped": "not_confirmed"}
    text = format_transaction_message(workspace_owner_id, tx)
    dedupe = f"tx:{tx.get('id') or tx.get('number')}"
    return _broadcast(
        workspace_owner_id,
        text,
        kind="transaction",
        report_key=_transaction_report_key(tx),
        template_context=_transaction_template_context(tx),
        dedupe_key=dedupe,
        dedupe_window_seconds=300,
    )


def notify_transaction_limit_approval_required(workspace_owner_id: str, tx: dict[str, Any]) -> dict[str, Any]:
    data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
    approval = data.get("telegram_limit_approval") if isinstance(data.get("telegram_limit_approval"), dict) else {}
    token = str(approval.get("token") or "").strip()
    tx_id = str(tx.get("id") or "").strip()
    if not token or not tx_id:
        return {"ok": False, "error": "approval_token_missing", "sent": 0}
    tx_type = str(tx.get("type") or "").strip().lower()
    type_label = "Расход" if tx_type == "expense" else "Приход"
    actor_name = str(
        tx.get("actor_name")
        or data.get("author")
        or data.get("author_username")
        or "Сотрудник"
    ).strip()
    amount = f"{_template_amount(tx.get('amount'))} {str(tx.get('currency') or 'UZS').strip().upper() or 'UZS'}"
    rows = [
        ("Сотрудник", actor_name),
        ("Операция", type_label),
        ("Сумма", amount),
        ("Категория", tx.get("category") or "Без категории"),
        ("Комментарий", tx.get("note") or "—"),
    ]
    table = "\n".join(f"{label:<12} {value}" for label, value in rows)
    text = (
        "<b>Операция выше лимита</b>\n\n"
        f"<pre>{html.escape(table, quote=False)}</pre>\n\n"
        "Вы подтверждаете данную операцию?"
    )
    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "Да", "callback_data": f"upos:lim:y:{tx_id}:{token}"},
                {"text": "Нет", "callback_data": f"upos:lim:n:{tx_id}:{token}"},
            ],
        ],
    }
    return _broadcast(
        workspace_owner_id,
        text,
        kind="limit_approval",
        report_key="limits",
        target_report_key="limits",
        apply_template=False,
        reply_markup=reply_markup,
        dedupe_key=f"tx_limit:{tx_id}",
        dedupe_window_seconds=300,
    )


def notify_transaction_deleted(workspace_owner_id: str, tx: dict[str, Any]) -> dict[str, Any]:
    text = format_transaction_deleted_message(workspace_owner_id, tx)
    dedupe = f"tx_del:{tx.get('id') or tx.get('number')}"
    return _broadcast(
        workspace_owner_id,
        text,
        kind="transaction_deleted",
        report_key="transaction_deleted",
        target_report_key="transaction_deleted",
        template_context=_transaction_template_context(tx),
        dedupe_key=dedupe,
        dedupe_window_seconds=300,
    )


def send_hr_attendance_report(workspace_owner_id: str, report: dict[str, Any]) -> dict[str, Any]:
    day = str(report.get("work_date") or "")
    total = int(report.get("total") or 0)
    present_count = int(report.get("present_count") or 0)
    absent_count = int(report.get("absent_count") or 0)
    lines = [
        f"HR перекличка за {day}",
        f"Всего сотрудников: {total}",
        f"Пришли: {present_count}",
        f"Не пришли: {absent_count}",
        "",
        "Пришли:",
    ]
    present = report.get("present") if isinstance(report.get("present"), list) else []
    absent = report.get("absent") if isinstance(report.get("absent"), list) else []
    present_list = "\n".join(
        f"• {str(item.get('name') or 'Без имени')}" for item in present
    ) or "• нет"
    absent_list = "\n".join(
        f"• {str(item.get('name') or 'Без имени')}: {str(item.get('reason') or 'Причина не указана')}"
        for item in absent
    ) or "• нет"
    if present:
        lines.extend(f"- {str(item.get('name') or 'Без имени')}" for item in present)
    else:
        lines.append("- нет")
    lines.extend(["", "Не пришли:"])
    if absent:
        for item in absent:
            reason = str(item.get("reason") or "Причина не указана")
            lines.append(f"- {str(item.get('name') or 'Без имени')}: {reason}")
    else:
        lines.append("- нет")
    dedupe = f"hr_attendance:{workspace_owner_id}:{day}:{present_count}:{absent_count}"
    return _broadcast(
        workspace_owner_id,
        "\n".join(lines),
        kind="hr_attendance",
        template_context={
            "date": day,
            "total": total,
            "present": present_count,
            "absent": absent_count,
            "present_list": present_list,
            "absent_list": absent_list,
        },
        dedupe_key=dedupe,
        dedupe_window_seconds=30,
    )


def _day_bounds(workspace_owner_id: str, *, offset_days: int = 0) -> tuple[datetime, datetime, str]:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    now_local = datetime.now(ZoneInfo(tz))
    day_local = (now_local + timedelta(days=offset_days)).replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = day_local.astimezone(timezone.utc)
    end_utc = (day_local + timedelta(days=1)).astimezone(timezone.utc)
    return start_utc, end_utc, day_local.date().isoformat()


def _date_bounds(workspace_owner_id: str, day_key: str) -> tuple[datetime, datetime, str, str]:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    clean = str(day_key or "").strip()[:10]
    try:
        day = datetime.strptime(clean, "%Y-%m-%d")
    except ValueError:
        day = datetime.now(ZoneInfo(tz))
    day_local = day.replace(tzinfo=ZoneInfo(tz), hour=0, minute=0, second=0, microsecond=0)
    start_utc = day_local.astimezone(timezone.utc)
    end_utc = (day_local + timedelta(days=1)).astimezone(timezone.utc)
    return start_utc, end_utc, day_local.date().isoformat(), tz


def _parse_tx_created_at(raw: Any) -> datetime | None:
    value = str(raw or "").strip()
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _money_decimal(raw: Any) -> Decimal:
    try:
        return Decimal(str(raw or "0").replace(" ", "").replace("\u202f", "").replace(",", "."))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _add_money(bucket: dict[str, Decimal], currency: Any, raw: Any) -> None:
    ccy = str(currency or "UZS").strip().upper() or "UZS"
    amount = _money_decimal(raw)
    if amount:
        bucket[ccy] = bucket.get(ccy, Decimal("0")) + amount


def _money_rows(title: str, values: dict[str, Decimal]) -> list[tuple[str, str, str]]:
    if not values:
        return [(title, "UZS", "0")]
    return [
        (title, currency, _template_amount(amount))
        for currency, amount in sorted(values.items(), key=lambda item: ({"UZS": 0, "USD": 1, "EUR": 2, "RUB": 3}.get(item[0], 50), item[0]))
    ]


def _report_table(rows: list[tuple[str, str, str]]) -> str:
    label_title = "Статья"
    label_width = min(max(len(label_title), *(len(row[0]) for row in rows)), 26)
    ccy_width = max(len("Вал"), *(len(row[1]) for row in rows))
    amount_width = max(len("Сумма"), *(len(row[2]) for row in rows))
    lines = [
        f"{label_title:<{label_width}} {'Вал':<{ccy_width}} {'Сумма':>{amount_width}}",
        f"{'-' * label_width} {'-' * ccy_width} {'-' * amount_width}",
    ]
    for label, currency, amount in rows:
        clean_label = label if len(label) <= label_width else label[: max(label_width - 1, 1)] + "…"
        lines.append(f"{clean_label:<{label_width}} {currency:<{ccy_width}} {amount:>{amount_width}}")
    return f"<pre>{html.escape(chr(10).join(lines), quote=False)}</pre>"


def _confirmed_day_transactions(workspace_owner_id: str, day_key: str) -> tuple[list[dict[str, Any]], str]:
    start_utc, end_utc, clean_day, _tz = _date_bounds(workspace_owner_id, day_key)
    result: list[dict[str, Any]] = []
    for tx in list_transactions(workspace_owner_id, limit=5000):
        created = _parse_tx_created_at(tx.get("created_at"))
        if created is None or created < start_utc or created >= end_utc:
            continue
        if not tx.get("is_confirmed", True):
            continue
        result.append(tx)
    return result, clean_day


def _day_label(clean_day: str) -> str:
    return datetime.strptime(clean_day, "%Y-%m-%d").strftime("%d.%m.%Y")


def send_kassa_sms_daily_courier_report(workspace_owner_id: str, day_key: str, *, actor_name: str = "") -> dict[str, Any]:
    start_utc, end_utc, clean_day, tz = _date_bounds(workspace_owner_id, day_key)
    rows = list_transactions(workspace_owner_id, limit=5000)
    income: dict[str, Decimal] = {}
    expense: dict[str, Decimal] = {}
    courier_total: dict[str, Decimal] = {}
    courier_cash: dict[str, Decimal] = {}
    courier_transfer: dict[str, Decimal] = {}
    courier_terminal: dict[str, Decimal] = {}
    count = 0
    courier_count = 0
    for tx in rows:
        created = _parse_tx_created_at(tx.get("created_at"))
        if created is None or created < start_utc or created >= end_utc:
            continue
        if not tx.get("is_confirmed", True):
            continue
        count += 1
        tx_type = str(tx.get("type") or "").strip().lower()
        ccy = str(tx.get("currency") or "UZS").strip().upper() or "UZS"
        amount = tx.get("amount")
        if tx_type == "income":
            _add_money(income, ccy, amount)
        elif tx_type == "expense":
            _add_money(expense, ccy, amount)
        data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
        is_courier = bool(data.get("courier_payment")) or str(tx.get("category") or "").strip() == "Оплата от доставщиков"
        if not is_courier:
            continue
        courier_count += 1
        breakdown = data.get("courier_breakdown") if isinstance(data.get("courier_breakdown"), dict) else {}
        cash = breakdown.get("cash", amount)
        transfer = breakdown.get("transfer", 0)
        terminal = breakdown.get("terminal", 0)
        _add_money(courier_cash, ccy, cash)
        _add_money(courier_transfer, ccy, transfer)
        _add_money(courier_terminal, ccy, terminal)
        total_bucket: dict[str, Decimal] = {}
        _add_money(total_bucket, ccy, cash)
        _add_money(total_bucket, ccy, transfer)
        _add_money(total_bucket, ccy, terminal)
        total = total_bucket.get(ccy, Decimal("0"))
        _add_money(courier_total, ccy, total)

    local_label = datetime.strptime(clean_day, "%Y-%m-%d").strftime("%d.%m.%Y")
    table_rows: list[tuple[str, str, str]] = []
    table_rows.extend(_money_rows("Общие доходы", income))
    table_rows.extend(_money_rows("Общие расходы", expense))
    table_rows.extend(_money_rows("Оплата доставщиков", courier_total))
    table_rows.extend(_money_rows("Наличные", courier_cash))
    table_rows.extend(_money_rows("Перечисление", courier_transfer))
    table_rows.extend(_money_rows("Терминал", courier_terminal))
    text = "\n".join(
        [
            "📨 <b>СМС отчёт кассы</b>",
            f"Организация: {html.escape(workspace_display_name(workspace_owner_id), quote=False)}",
            f"Дата: {html.escape(local_label, quote=False)}",
            f"Операций: {count}; оплат от доставщиков: {courier_count}",
            f"Кто отправил: {html.escape(str(actor_name or '—'), quote=False)}",
            "",
            _report_table(table_rows),
        ]
    )
    return _broadcast(
        workspace_owner_id,
        text,
        kind="kassa_sms_daily_couriers",
        report_key=None,
        target_report_key="courier_payment",
        apply_template=False,
        dedupe_key="",
    )


def send_kassa_sms_daily_expense_report(workspace_owner_id: str, day_key: str, *, actor_name: str = "") -> dict[str, Any]:
    rows, clean_day = _confirmed_day_transactions(workspace_owner_id, day_key)
    totals: dict[str, Decimal] = {}
    by_category: dict[tuple[str, str], Decimal] = {}
    counts: dict[tuple[str, str], int] = {}
    count = 0
    for tx in rows:
        if str(tx.get("type") or "").strip().lower() != "expense":
            continue
        count += 1
        ccy = str(tx.get("currency") or "UZS").strip().upper() or "UZS"
        amount = _money_decimal(tx.get("amount"))
        if amount:
            totals[ccy] = totals.get(ccy, Decimal("0")) + amount
        category = str(tx.get("category") or "Без категории").strip() or "Без категории"
        key = (category, ccy)
        by_category[key] = by_category.get(key, Decimal("0")) + amount
        counts[key] = counts.get(key, 0) + 1

    table_rows: list[tuple[str, str, str]] = []
    table_rows.extend(_money_rows("Итого расходы", totals))
    for (category, ccy), amount in sorted(by_category.items(), key=lambda item: (-abs(item[1]), item[0][0].lower(), item[0][1])):
        suffix = f" · {counts.get((category, ccy), 0)} оп."
        table_rows.append((f"{category}{suffix}", ccy, _template_amount(amount)))

    text = "\n".join(
        [
            "📨 <b>СМС отчёт по расходам</b>",
            f"Организация: {html.escape(workspace_display_name(workspace_owner_id), quote=False)}",
            f"Дата: {html.escape(_day_label(clean_day), quote=False)}",
            f"Расходных операций: {count}",
            f"Кто отправил: {html.escape(str(actor_name or '—'), quote=False)}",
            "",
            _report_table(table_rows),
        ]
    )
    return _broadcast(
        workspace_owner_id,
        text,
        kind="kassa_sms_daily_expenses",
        report_key=None,
        target_report_key="expense",
        apply_template=False,
        dedupe_key="",
    )


def send_kassa_sms_daily_transfer_report(workspace_owner_id: str, day_key: str, *, actor_name: str = "") -> dict[str, Any]:
    rows, clean_day = _confirmed_day_transactions(workspace_owner_id, day_key)
    debit_totals: dict[str, Decimal] = {}
    credit_totals: dict[str, Decimal] = {}
    route_debit: dict[tuple[str, str, str], Decimal] = {}
    route_credit: dict[tuple[str, str, str], Decimal] = {}
    route_counts: dict[tuple[str, str, str], int] = {}
    count = 0
    for tx in rows:
        if str(tx.get("type") or "").strip().lower() != "transfer":
            continue
        count += 1
        data = tx.get("data") if isinstance(tx.get("data"), dict) else {}
        debit_ccy = str(tx.get("currency") or "UZS").strip().upper() or "UZS"
        debit_amount = _money_decimal(tx.get("amount"))
        credit_ccy = str(data.get("transfer_credit_currency") or debit_ccy).strip().upper() or debit_ccy
        credit_amount = _money_decimal(data.get("transfer_credit_amount") if data.get("transfer_credit_amount") not in (None, "") else tx.get("amount"))
        if debit_amount:
            debit_totals[debit_ccy] = debit_totals.get(debit_ccy, Decimal("0")) + debit_amount
        if credit_amount:
            credit_totals[credit_ccy] = credit_totals.get(credit_ccy, Decimal("0")) + credit_amount
        from_name = str(tx.get("from_account_name") or tx.get("from_pocket_id") or "—").strip() or "—"
        to_name = str(tx.get("to_account_name") or tx.get("to_pocket_id") or "—").strip() or "—"
        route = (from_name, to_name, f"{debit_ccy}->{credit_ccy}")
        route_debit[route] = route_debit.get(route, Decimal("0")) + debit_amount
        route_credit[route] = route_credit.get(route, Decimal("0")) + credit_amount
        route_counts[route] = route_counts.get(route, 0) + 1

    table_rows: list[tuple[str, str, str]] = []
    table_rows.extend(_money_rows("Итого списано", debit_totals))
    table_rows.extend(_money_rows("Итого зачислено", credit_totals))
    for route, amount in sorted(route_debit.items(), key=lambda item: (-abs(item[1]), item[0])):
        from_name, to_name, _ccy_pair = route
        debit_ccy, credit_ccy = _ccy_pair.split("->", 1)
        route_label = f"{from_name} → {to_name} · {route_counts.get(route, 0)} оп."
        table_rows.append((f"{route_label} списано", debit_ccy, _template_amount(amount)))
        table_rows.append((f"{route_label} зачислено", credit_ccy, _template_amount(route_credit.get(route, Decimal("0")))))

    text = "\n".join(
        [
            "📨 <b>СМС отчёт по перемещениям</b>",
            f"Организация: {html.escape(workspace_display_name(workspace_owner_id), quote=False)}",
            f"Дата: {html.escape(_day_label(clean_day), quote=False)}",
            f"Перемещений: {count}",
            f"Кто отправил: {html.escape(str(actor_name or '—'), quote=False)}",
            "",
            _report_table(table_rows),
        ]
    )
    return _broadcast(
        workspace_owner_id,
        text,
        kind="kassa_sms_daily_transfers",
        report_key=None,
        target_report_key="transfer",
        apply_template=False,
        dedupe_key="",
    )


def send_daily_digest_for_workspace(
    workspace_owner_id: str,
    *,
    offset_days: int = 0,
    force_empty: bool = False,
    dedupe: bool = True,
) -> dict[str, Any]:
    start_utc, end_utc, day_key = _day_bounds(workspace_owner_id, offset_days=offset_days)
    text = format_daily_digest(
        workspace_owner_id,
        start_utc=start_utc,
        end_utc=end_utc,
        empty=force_empty,
    )
    dedupe_key = f"daily:{workspace_owner_id}:{day_key}" if dedupe and not force_empty else ""
    return _broadcast(
        workspace_owner_id,
        text,
        kind="daily",
        dedupe_key=dedupe_key,
        dedupe_window_seconds=36 * 3600,
    )


def send_month_to_date_for_workspace(workspace_owner_id: str, *, dedupe: bool = False) -> dict[str, Any]:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    now_local = datetime.now(ZoneInfo(tz))
    start_local = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = now_local.astimezone(timezone.utc)
    label = f"Итоги месяца на {now_local.strftime('%d.%m.%Y')}"
    text = format_digest(
        workspace_owner_id,
        start_utc=start_utc,
        end_utc=end_utc,
        title_label=label,
        empty=False,
    )
    dedupe_key = f"month:{workspace_owner_id}:{now_local.strftime('%Y-%m')}" if dedupe else ""
    return _broadcast(
        workspace_owner_id,
        text,
        kind="month",
        dedupe_key=dedupe_key,
        dedupe_window_seconds=36 * 3600,
    )


def send_test_report(workspace_owner_id: str, report_kind: str) -> dict[str, Any]:
    kind = (report_kind or "").strip().lower()
    if kind not in TEST_KINDS:
        return {"ok": False, "error": "unknown_kind"}

    if kind in {"tx_income", "tx_expense", "tx_transfer"}:
        tx = sample_transaction(kind)
        text = format_transaction_message(workspace_owner_id, tx)
        report_key = {"tx_income": "income", "tx_expense": "expense", "tx_transfer": "transfer"}[kind]
        return _broadcast(
            workspace_owner_id,
            text,
            kind=f"test:{kind}",
            report_key=report_key,
            template_context=_transaction_template_context(tx),
        )
    if kind == "tx_real_last":
        txs = list_transactions(workspace_owner_id, limit=1)
        if not txs:
            return {"ok": False, "error": "no_transactions"}
        text = format_transaction_message(workspace_owner_id, txs[0])
        return _broadcast(workspace_owner_id, text, kind="test:tx_real_last")
    if kind == "daily_today":
        return send_daily_digest_for_workspace(workspace_owner_id, dedupe=False)
    if kind == "daily_yesterday":
        return send_daily_digest_for_workspace(workspace_owner_id, offset_days=-1, dedupe=False)
    if kind == "daily_empty":
        return send_daily_digest_for_workspace(workspace_owner_id, force_empty=True, dedupe=False)
    if kind == "month_to_date":
        return send_month_to_date_for_workspace(workspace_owner_id, dedupe=False)
    if kind == "balance_snapshot":
        return _broadcast(
            workspace_owner_id,
            format_balance_snapshot(workspace_owner_id),
            kind="test:balance_snapshot",
            report_key="balance",
        )
    if kind == "weekly":
        return send_weekly_digest_for_workspace(workspace_owner_id, dedupe=False)

    return {"ok": False, "error": "unknown_kind"}


def send_weekly_digest_for_workspace(workspace_owner_id: str, *, dedupe: bool = False) -> dict[str, Any]:
    ws = load_workspace_settings(workspace_owner_id)
    tz = normalize_workspace_timezone(str(ws.get("timezone") or ""))
    now_local = datetime.now(ZoneInfo(tz))
    end_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    start_local = end_local - timedelta(days=7)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    label = f"Итоги недели ({start_local.strftime('%d.%m')}–{(end_local - timedelta(days=1)).strftime('%d.%m.%Y')})"
    text = format_digest(
        workspace_owner_id,
        start_utc=start_utc,
        end_utc=end_utc,
        title_label=label,
        empty=False,
    )
    dedupe_key = f"weekly:{workspace_owner_id}:{start_local.date().isoformat()}" if dedupe else ""
    return _broadcast(
        workspace_owner_id,
        text,
        kind="weekly",
        dedupe_key=dedupe_key,
        dedupe_window_seconds=36 * 3600,
    )
