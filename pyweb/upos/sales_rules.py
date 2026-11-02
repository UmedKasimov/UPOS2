from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


SALES_DEFAULT_WORKFLOW_STATUSES = frozenset({"new", "shipped", "installation", "completed"})


def decimal_value(raw: Any) -> Decimal:
    if raw is None or raw == "":
        return Decimal("0")
    if isinstance(raw, Decimal):
        return raw
    text = str(raw).strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if not text:
        return Decimal("0")
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        raise ValueError("Некорректное число") from None


def currency_amount(raw: Any, currency: Any) -> Decimal:
    """Round monetary values exactly as the sales UI displays them."""
    quantum = Decimal("1") if str(currency or "UZS").strip().upper() == "UZS" else Decimal("0.01")
    return decimal_value(raw).quantize(quantum, rounding=ROUND_HALF_UP)


def sales_default_status(settings: Any, doc_type: Any) -> str:
    """Return a safe configured initial workflow status for sales documents."""
    source = settings if isinstance(settings, dict) else {}
    defaults = source.get("sales_default_statuses")
    defaults = defaults if isinstance(defaults, dict) else {}
    kind = "order" if str(doc_type or "").strip().lower() == "order" else "sale"
    status = str(defaults.get(kind) or "new").strip().lower()
    return status if status in SALES_DEFAULT_WORKFLOW_STATUSES else "new"


def calculate_sales_line(
    quantity: Any,
    unit_price: Any,
    discount_mode: Any = "discount",
    discount_value: Any = 0,
    discount_unit: Any = "percent",
) -> dict[str, Decimal | str]:
    """Return a canonical server-side total for one sales line."""
    qty = decimal_value(quantity)
    price = decimal_value(unit_price)
    value = decimal_value(discount_value)
    if qty < 0:
        raise ValueError("Количество не может быть отрицательным")
    if price < 0:
        raise ValueError("Цена не может быть отрицательной")
    if value < 0:
        raise ValueError("Скидка или наценка не может быть отрицательной")

    mode = "markup" if str(discount_mode or "").strip().lower() == "markup" else "discount"
    unit = "amount" if str(discount_unit or "").strip().lower() == "amount" else "percent"
    if mode == "discount" and unit == "percent" and value > 100:
        raise ValueError("Скидка не может быть больше 100%")

    subtotal = qty * price
    adjustment = value if unit == "amount" else subtotal * value / Decimal("100")
    if mode == "discount":
        adjustment = min(adjustment, subtotal)
        total = subtotal - adjustment
    else:
        total = subtotal + adjustment
    return {
        "subtotal": subtotal,
        "adjustment": adjustment,
        "total": total,
        "discount_mode": mode,
        "discount_value": value,
        "discount_unit": unit,
    }


def calculate_installment(
    base_total: Any,
    months: Any,
    initial: Any,
    markup_percent: Any,
    currency: Any = "USD",
) -> dict[str, Decimal | int]:
    """Calculate the final receivable for installment terms."""
    raw_total = decimal_value(base_total)
    if raw_total < 0:
        raise ValueError("Сумма рассрочки не может быть отрицательной")
    total = currency_amount(raw_total, currency)
    try:
        months_decimal = decimal_value(months) or Decimal("1")
        if months_decimal != months_decimal.to_integral_value() or months_decimal < 1:
            raise ValueError
        months_value = int(months_decimal)
    except (ValueError, OverflowError):
        raise ValueError("Некорректный срок рассрочки") from None
    initial_value = decimal_value(initial)
    markup = decimal_value(markup_percent)
    if initial_value < 0:
        raise ValueError("Первоначальный взнос не может быть отрицательным")
    if markup < 0:
        raise ValueError("Наценка рассрочки не может быть отрицательной")
    initial_value = min(currency_amount(initial_value, currency), total)
    rest = total - initial_value
    profit = currency_amount(rest * markup / Decimal("100"), currency)
    rest_total = currency_amount(rest + profit, currency)
    grand_total = currency_amount(initial_value + rest_total, currency)
    return {
        "months": months_value,
        "initial": initial_value,
        "markup_percent": markup,
        "rest": rest,
        "profit": profit,
        "rest_total": rest_total,
        "total": grand_total,
        "monthly": currency_amount(rest_total / Decimal(months_value), currency),
    }
