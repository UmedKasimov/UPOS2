from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def _amount(value: Any) -> Decimal:
    text = str(value or "").strip().replace(" ", "").replace(",", ".")
    if not text:
        return Decimal("0")
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return Decimal("0")


def build_purchase_cash_transaction_payloads(
    *,
    purchase_id: str,
    purchase_number: str,
    data: dict[str, Any],
    currency: str,
    created_at: str,
    employee_id: str = "",
    actor_name: str = "",
) -> list[dict[str, Any]]:
    """Build finance journal rows for purchase payments and landed-cost expenses."""
    clean_currency = str(currency or "UZS").strip().upper() or "UZS"
    supplier = str(data.get("supplier") or "").strip()
    result: list[dict[str, Any]] = []

    payments = data.get("payment_lines") if isinstance(data.get("payment_lines"), list) else []
    for index, payment in enumerate(payments, start=1):
        if not isinstance(payment, dict):
            continue
        amount = _amount(payment.get("amount"))
        if amount <= 0:
            continue
        account_id = str(payment.get("account_id") or "").strip()
        payment_currency = str(payment.get("currency") or clean_currency).strip().upper() or clean_currency
        payload: dict[str, Any] = {
            "amount": amount,
            "currency": payment_currency,
            "type": "expense",
            "status": "confirmed",
            "is_confirmed": True,
            "category": "Закупка товара",
            "supplier": supplier,
            "employee_id": employee_id,
            "created_at": str(payment.get("date") or created_at).strip() or created_at,
            "note": f"Оплата закупки {purchase_number}",
            "data": {
                "source": "purchase",
                "purchase_document_id": purchase_id,
                "purchase_number": purchase_number,
                "purchase_entry_kind": "payment",
                "payment_index": index,
                "payment_type": str(payment.get("type") or "Оплата").strip() or "Оплата",
                "payment_account_id": account_id,
                "payment_account": str(payment.get("account") or "").strip(),
                "manager": actor_name,
            },
        }
        if account_id:
            payload["from_pocket_id"] = account_id
            payload["from_account_id"] = account_id
        result.append(payload)

    expenses = data.get("extra_expenses") if isinstance(data.get("extra_expenses"), list) else []
    for index, expense in enumerate(expenses, start=1):
        if not isinstance(expense, dict):
            continue
        amount = _amount(expense.get("amount"))
        if amount <= 0:
            continue
        name = str(expense.get("name") or "Дополнительный расход").strip() or "Дополнительный расход"
        account_id = str(expense.get("account_id") or "").strip()
        payload = {
            "amount": amount,
            "currency": str(expense.get("currency") or clean_currency).strip().upper() or clean_currency,
            "type": "expense",
            "status": "confirmed",
            "is_confirmed": True,
            "category": name,
            "supplier": supplier,
            "employee_id": employee_id,
            "created_at": str(expense.get("date") or created_at).strip() or created_at,
            "note": f"{name} по закупке {purchase_number}",
            "data": {
                "source": "purchase",
                "purchase_document_id": purchase_id,
                "purchase_number": purchase_number,
                "purchase_entry_kind": "extra_expense",
                "expense_index": index,
                "expense_name": name,
                "payment_account_id": account_id,
                "payment_account": str(expense.get("account") or "").strip(),
                "manager": actor_name,
            },
        }
        if account_id:
            payload["from_pocket_id"] = account_id
            payload["from_account_id"] = account_id
        result.append(payload)

    return result
