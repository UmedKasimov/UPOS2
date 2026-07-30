from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from upos.db import session_scope
from upos.db_models import (
    AccountBalance,
    Branch,
    Counterparty,
    ExpenseDocument,
    ExternalRecord,
    FinanceAccount,
    IntegrationSyncRun,
    PaymentDocument,
    Product,
    PurchaseDocument,
    SaleDocument,
    Warehouse,
)
from upos.smpro_client import DEFAULT_MODULES, SMProClient, SMProError
from upos.storage import load_workspace_settings, save_workspace_settings


INTEGRATION = "ibox"


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _payload_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _walk(item: Any, *keys: str) -> Any:
    wanted = {key.lower() for key in keys}
    queue = [item]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            for key, value in current.items():
                if key.lower() in wanted and value not in (None, "", [], {}):
                    return value
            queue.extend(current.values())
        elif isinstance(current, list):
            queue.extend(current)
    return None


def _text(item: dict[str, Any], *keys: str) -> str:
    value = _walk(item, *keys)
    if isinstance(value, dict):
        value = _walk(value, "name", "title", "label", "value")
    return str(value or "").strip()


def _scalar(item: dict[str, Any], *keys: str) -> str:
    value = _walk(item, *keys)
    if isinstance(value, (dict, list)):
        return ""
    return str(value or "").strip()


def _decimal_value(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _decimal_text(value: Any) -> str:
    number = _decimal_value(value)
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _bool_value(value: Any, default: bool = True) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "off", "inactive"}


def _ibox_price_type_id(filial_id: Any, remote_id: Any) -> str:
    filial = str(filial_id or "default").strip() or "default"
    remote = str(remote_id or "").strip()
    return f"ibox:{filial}:{remote}" if remote else ""


def _ibox_price_type_rows(
    remote_price_types: list[dict[str, Any]],
    stock_rows: list[dict[str, Any]],
    existing: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    result = [
        dict(item)
        for item in (existing or [])
        if isinstance(item, dict)
    ]
    by_id = {str(item.get("id") or ""): item for item in result}
    stock_currencies: dict[tuple[str, str], str] = {}
    for stock in stock_rows:
        filial_id = _scalar(stock, "_ibox_filial_id", "filial_id") or "default"
        remote_id = _scalar(stock, "_ibox_price_type_id")
        currency = str(stock.get("currency_code") or "").strip().upper()
        if remote_id and currency:
            stock_currencies.setdefault((filial_id, remote_id), currency)

    base_sort_order = max(
        (
            int(str(item.get("sort_order") or "0"))
            for item in result
            if str(item.get("sort_order") or "0").lstrip("-").isdigit()
        ),
        default=0,
    )
    for offset, payload in enumerate(remote_price_types, start=1):
        remote_id = _scalar(payload, "id", "price_type_id")
        filial_id = _scalar(payload, "_ibox_filial_id", "filial_id") or "default"
        local_id = _ibox_price_type_id(filial_id, remote_id)
        if not local_id:
            continue
        currency_data = payload.get("currency")
        currency_data = currency_data if isinstance(currency_data, dict) else {}
        currency = str(
            payload.get("currency_code")
            or payload.get("convert_to_currency")
            or currency_data.get("code")
            or stock_currencies.get((filial_id, remote_id))
            or "UZS"
        ).strip().upper()
        if currency not in {"UZS", "USD"}:
            currency = "UZS"
        previous = by_id.get(local_id, {})
        try:
            sort_order = int(str(payload.get("sort_order") or ""))
        except (TypeError, ValueError):
            sort_order = int(previous.get("sort_order") or base_sort_order + offset)
        remote_name = _text(payload, "name", "title") or str(remote_id)
        row = {
            **previous,
            "id": local_id,
            "name": f"IBOX · {remote_name}",
            "sort_order": sort_order,
            "is_for_sales": _bool_value(
                payload.get("is_for_sales", payload.get("active")),
                True,
            ),
            "is_for_purchases": False,
            "is_active": _bool_value(
                payload.get("is_active", payload.get("active")),
                True,
            ),
            "pricing_method": "manual",
            "created_by": "IBOX",
            "updated_at": str(
                payload.get("updated_at")
                or payload.get("date")
                or datetime.now(UTC).date().isoformat()
            )[:10],
            "base_price_type_id": "",
            "markup_type": "markup",
            "markup_value": "",
            "convert_to_currency": currency,
            "rounding": "1.0",
        }
        by_id[local_id] = row

    imported_ids = list(
        dict.fromkeys(
            _ibox_price_type_id(
                _scalar(payload, "_ibox_filial_id", "filial_id") or "default",
                _scalar(payload, "id", "price_type_id"),
            )
            for payload in remote_price_types
        )
    )
    imported_ids = [item_id for item_id in imported_ids if item_id]
    return [
        *(item for item in result if str(item.get("id") or "") not in imported_ids),
        *(by_id[item_id] for item_id in imported_ids),
    ]


def _sync_ibox_price_types(
    workspace_owner_id: str,
    remote_price_types: list[dict[str, Any]],
    stock_rows: list[dict[str, Any]],
) -> None:
    if not remote_price_types:
        return
    settings = load_workspace_settings(workspace_owner_id)
    existing = (
        settings.get("product_price_types")
        if isinstance(settings.get("product_price_types"), list)
        else []
    )
    settings["product_price_types"] = _ibox_price_type_rows(
        remote_price_types,
        stock_rows,
        existing,
    )
    save_workspace_settings(workspace_owner_id, settings)


def _external_id(item: dict[str, Any], entity_type: str) -> str:
    value = _walk(
        item,
        "id",
        "uuid",
        "guid",
        "document_id",
        "product_id",
        "outlet_id",
        "warehouse_id",
        "filial_id",
        "code",
        "number",
    )
    if value not in (None, "") and not isinstance(value, (dict, list)):
        return str(value).strip()[:180]
    return f"{entity_type}:{_payload_hash(item)}"[:180]


def _money(item: dict[str, Any]) -> Decimal:
    raw = _walk(item, "amount", "total_amount", "total", "sum", "payment_amount", "value")
    try:
        return abs(Decimal(str(raw or "0")).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def _currency(item: dict[str, Any]) -> str:
    raw = _text(item, "currency_code", "currency", "code").upper()
    numeric = {"860": "UZS", "840": "USD", "643": "RUB", "978": "EUR"}
    return numeric.get(raw, raw if len(raw) == 3 else "UZS")


def _created_at(item: dict[str, Any]) -> datetime:
    raw = _text(item, "created_at", "date", "document_date", "operation_date", "createdAt")
    if raw:
        try:
            value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return value if value.tzinfo else value.replace(tzinfo=UTC)
        except ValueError:
            for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y", "%Y-%m-%d"):
                try:
                    return datetime.strptime(raw, fmt).replace(tzinfo=UTC)
                except ValueError:
                    continue
    return datetime.now(UTC)


def _sales_document_details(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in (
        "shipment_details",
        "order_details",
        "purchase_details",
        "return_details",
        "details",
        "lines",
        "items",
        "products",
    ):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    for key in ("data", "document", "shipment", "order", "return"):
        value = payload.get(key)
        if isinstance(value, dict):
            details = _sales_document_details(value)
            if details:
                return details
    return []


def _shipment_lines(payload: dict[str, Any]) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for detail in _sales_document_details(payload):
        product = detail.get("product") if isinstance(detail.get("product"), dict) else {}
        warehouse = detail.get("warehouse") if isinstance(detail.get("warehouse"), dict) else {}
        unit = product.get("storage_unit") if isinstance(product.get("storage_unit"), dict) else {}
        quantity = _decimal_value(
            detail.get("quantity")
            or detail.get("qty")
            or detail.get("count")
        )
        price = _decimal_value(
            detail.get("price")
            or detail.get("sale_price")
            or detail.get("amount")
        )
        total_raw = detail.get("total")
        total = _decimal_value(total_raw) if total_raw not in (None, "") else quantity * price
        product_id = (
            _scalar(product, "id", "product_id")
            or _scalar(detail, "product_id")
        )
        warehouse_id = (
            _scalar(warehouse, "id", "warehouse_id")
            or _scalar(detail, "warehouse_id")
        )
        product_name = (
            _text(product, "name", "title")
            or _text(detail, "product_name", "name")
            or (f"IBOX #{product_id}" if product_id else "Товар IBOX")
        )
        warehouse_name = (
            _text(warehouse, "name", "title")
            or _text(detail, "warehouse_name")
            or "Основной склад"
        )
        lines.append(
            {
                "product": product_name,
                "product_id": product_id,
                "warehouse": warehouse_name,
                "warehouse_id": warehouse_id,
                "quantity": _decimal_text(quantity),
                "price": _decimal_text(price),
                "total": _decimal_text(total),
                "unit": _text(unit, "short_name", "name") or _text(detail, "unit_name", "unit"),
                "source": INTEGRATION,
            }
        )
    return lines


def ibox_sales_document_lines(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Build normalized sale, order, or return lines from a saved IBOX payload."""
    return _shipment_lines(payload)


def _ibox_sales_document_data(
    payload: dict[str, Any],
    entity_type: str,
) -> dict[str, Any]:
    created_at = _created_at(payload)
    lines = ibox_sales_document_lines(payload)
    first_line = lines[0] if lines else {}
    doc_type = {
        "orders": "order",
        "shipments": "sale",
        "returns": "return",
    }.get(entity_type, "sale")
    status = (
        _ibox_shipment_status(_money(payload), Decimal("0"))
        if entity_type == "shipments"
        else "completed"
        if entity_type == "returns"
        else "new"
    )
    due_date = _scalar(
        payload,
        "due_date",
        "payment_due_date",
        "maturity_date",
        "deadline",
    )[:10]
    return {
        "doc_type": doc_type,
        "date": created_at.date().isoformat(),
        "date_to": due_date or created_at.date().isoformat(),
        "client": (
            _text(payload, "outlet_name", "client_name", "counterparty_name")
            or "Клиент IBOX"
        ),
        "warehouse": (
            str(first_line.get("warehouse") or "").strip()
            or _text(payload, "warehouse_name")
            or "Основной склад"
        ),
        "status": status,
        "workflow_version": 2,
        # IBOX remains the stock source of truth for imported shipments.
        "inventory_applied": False,
        "paid_amount": "0",
        "payment_type": "",
        "payment_lines": [],
        "manager": "IBOX",
        "note": "Импортировано из IBOX",
        "price_type_id": "",
        "price_type": "",
        "crm_record_id": "",
        "source_sale_id": "",
        "lines": lines,
        "source": INTEGRATION,
        "ibox_document_id": _scalar(payload, "id", "document_id"),
        "ibox_filial_id": (
            _scalar(payload, "_ibox_filial_id")
            or _scalar(payload, "filial_id")
        ),
        "ibox_status": payload.get("status"),
        "ibox_payload": payload,
    }


def _shipment_document_data(payload: dict[str, Any]) -> dict[str, Any]:
    return _ibox_sales_document_data(payload, "shipments")


def _ibox_shipment_status(amount: Any, paid: Any) -> str:
    total = max(Decimal("0"), _decimal_value(amount))
    paid_amount = max(Decimal("0"), _decimal_value(paid))
    return "completed" if total <= 0 or paid_amount >= total else "installation"


def _shipment_counterparty_id(
    session,
    workspace_owner_id: str,
    payload: dict[str, Any],
) -> str | None:
    outlet_id = _scalar(payload, "outlet_id", "client_id", "counterparty_id")
    if outlet_id:
        counterparty_id = session.execute(
            select(Counterparty.id)
            .where(
                Counterparty.workspace_owner_id == workspace_owner_id,
                Counterparty.external_source == INTEGRATION,
                Counterparty.external_id == outlet_id,
            )
            .limit(1)
        ).scalar_one_or_none()
        if counterparty_id:
            return str(counterparty_id)
    client_name = _text(payload, "outlet_name", "client_name", "counterparty_name")
    if not client_name:
        return None
    counterparty_id = session.execute(
        select(Counterparty.id)
        .where(
            Counterparty.workspace_owner_id == workspace_owner_id,
            func.lower(Counterparty.name) == client_name.lower(),
        )
        .limit(1)
    ).scalar_one_or_none()
    return str(counterparty_id) if counterparty_id else None


def _ibox_product_data(
    payload: dict[str, Any],
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    existing = dict(previous or {})
    storage_unit = payload.get("storage_unit")
    storage_unit = storage_unit if isinstance(storage_unit, dict) else {}
    last_purchase = payload.get("last_purchase_price")
    last_purchase = last_purchase if isinstance(last_purchase, dict) else {}
    purchase_currency = last_purchase.get("currency")
    purchase_currency = purchase_currency if isinstance(purchase_currency, dict) else {}
    filial_id = _scalar(payload, "_ibox_filial_id", "filial_id")
    price_type_id = _scalar(payload, "_ibox_price_type_id")
    price_type_name = _scalar(payload, "_ibox_price_type_name")

    prices = [
        dict(item)
        for item in existing.get("prices", [])
        if isinstance(item, dict)
    ]
    sale_price = payload.get("price")
    sale_currency = str(payload.get("currency_code") or "").strip().upper()
    if price_type_id and sale_price not in (None, "") and sale_currency:
        local_price_type_id = _ibox_price_type_id(filial_id, price_type_id)
        prices = [
            item
            for item in prices
            if not (
                str(item.get("source") or "") == INTEGRATION
                and str(item.get("ibox_filial_id") or "") == filial_id
                and (
                    str(item.get("ibox_price_type_id") or "") == price_type_id
                    or str(item.get("price_type_id") or "")
                    in {price_type_id, local_price_type_id}
                )
            )
        ]
        prices.append(
            {
                "price_type_id": local_price_type_id,
                "name": price_type_name or f"IBOX {price_type_id}",
                "price": _decimal_text(sale_price),
                "currency": sale_currency,
                "ibox_filial_id": filial_id,
                "ibox_price_type_id": price_type_id,
                "source": INTEGRATION,
            }
        )

    stocks = [
        dict(item)
        for item in existing.get("stocks", [])
        if isinstance(item, dict)
    ]
    available = payload.get("available")
    if available is None:
        available = payload.get("stock")
    if available is not None:
        stock_key = filial_id or "default"
        stocks = [
            item
            for item in stocks
            if str(item.get("ibox_filial_id") or "default") != stock_key
        ]
        stocks.append(
            {
                "warehouse": (
                    f"IBOX филиал {filial_id}"
                    if filial_id
                    else "IBOX"
                ),
                "quantity": _decimal_text(available),
                "price": _decimal_text(last_purchase.get("price")),
                "currency": str(purchase_currency.get("code") or "UZS").upper(),
                "date": datetime.now(UTC).date().isoformat(),
                "ibox_filial_id": filial_id,
                "source": INTEGRATION,
            }
        )

    data = {
        **existing,
        "kind": "service" if str(payload.get("type") or "") == "2" else "product",
        "category": str(payload.get("product_category_name") or existing.get("category") or ""),
        "unit": (
            str(storage_unit.get("name") or storage_unit.get("short_name") or "")
            or str(existing.get("unit") or "Штука")
        ),
        "status": "active",
        "batch_tracking": bool(payload.get("batch_tracking")),
        "prices": prices,
        "stocks": stocks,
        "source": INTEGRATION,
        "ibox_product_id": _scalar(payload, "id", "product_id"),
        "ibox_filial_id": filial_id,
        "ibox_payload": payload,
    }
    if last_purchase.get("price") not in (None, ""):
        data["purchase_price"] = _decimal_text(last_purchase.get("price"))
        data["purchase_currency"] = str(purchase_currency.get("code") or "UZS").upper()
    return data


def _ibox_product_barcode(payload: dict[str, Any]) -> str:
    barcode = _scalar(payload, "barcode", "bar_code")
    if barcode:
        return barcode
    rows = payload.get("barcodes")
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and _scalar(row, "barcode", "code"):
                return _scalar(row, "barcode", "code")
    return ""


def _upsert_ibox_product(
    session,
    common: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    existing = session.execute(
        select(Product)
        .where(
            Product.workspace_owner_id == common["workspace_owner_id"],
            Product.external_source == INTEGRATION,
            Product.external_id == common["external_id"],
        )
        .limit(1)
    ).scalar_one_or_none()
    previous_data = existing.data if existing and isinstance(existing.data, dict) else {}
    name = (
        str(payload.get("name") or payload.get("product_name") or "").strip()
        or (str(existing.name or "").strip() if existing else "")
        or f"Товар IBOX {common['external_id']}"
    )
    sku = (
        str(payload.get("sku") or payload.get("article") or "").strip()
        or (str(existing.sku or "").strip() if existing else "")
    )
    barcode = _ibox_product_barcode(payload) or (
        str(existing.barcode or "").strip() if existing else ""
    )
    values = {
        **common,
        "name": name,
        "sku": sku,
        "barcode": barcode,
        "data": _ibox_product_data(payload, previous_data),
    }
    _upsert_model(
        session,
        Product,
        "uq_products_external",
        values,
        {key: values[key] for key in ("name", "sku", "barcode", "data")},
    )


def _resolve_shipment_products(
    session,
    workspace_owner_id: str,
    document_data: dict[str, Any],
) -> dict[str, Any]:
    lines = [
        dict(item)
        for item in document_data.get("lines", [])
        if isinstance(item, dict)
    ]
    remote_ids = {
        str(item.get("product_id") or "").strip()
        for item in lines
        if str(item.get("product_id") or "").strip()
    }
    if not remote_ids:
        document_data["lines"] = lines
        return document_data

    products = session.execute(
        select(Product).where(
            Product.workspace_owner_id == workspace_owner_id,
            Product.external_source == INTEGRATION,
            Product.external_id.in_(remote_ids),
        )
    ).scalars().all()
    products_by_external_id = {
        str(product.external_id or ""): product
        for product in products
    }
    for line in lines:
        remote_id = str(line.get("product_id") or "").strip()
        product = products_by_external_id.get(remote_id)
        if not product:
            continue
        line["ibox_product_id"] = remote_id
        line["product_id"] = str(product.id)
        line["product"] = str(product.name or line.get("product") or "").strip()
        product_data = product.data if isinstance(product.data, dict) else {}
        if not str(line.get("unit") or "").strip():
            line["unit"] = str(product_data.get("unit") or "").strip()
    document_data["lines"] = lines
    return document_data


def _ibox_party_key(payload: dict[str, Any]) -> tuple[str, str]:
    filial_id = _scalar(payload, "_ibox_filial_id", "filial_id")
    outlet_id = _scalar(payload, "outlet_id", "client_id", "counterparty_id")
    if outlet_id:
        return filial_id, f"id:{outlet_id}"
    name = _text(payload, "outlet_name", "client_name", "counterparty_name").casefold()
    return filial_id, f"name:{name}"


def _ibox_payment_credit(payload: dict[str, Any]) -> dict[str, Any] | None:
    amount = _decimal_value(payload.get("total") or payload.get("amount"))
    currency = str(payload.get("currency_code") or "").strip().upper()
    if amount <= 0 or not currency:
        return None
    details = payload.get("payment_details")
    detail_rows = details if isinstance(details, list) else []
    accounts = [
        str((item.get("cashbox") or {}).get("name") or "").strip()
        for item in detail_rows
        if isinstance(item, dict) and isinstance(item.get("cashbox"), dict)
    ]
    return {
        "party_key": _ibox_party_key(payload),
        "currency": currency,
        "amount": amount,
        "remaining": amount,
        "number": _scalar(payload, "number", "document_number"),
        "date": _created_at(payload).date().isoformat(),
        "type": str(payload.get("payment_type_name") or "Оплата IBOX").strip(),
        "account": ", ".join(dict.fromkeys(item for item in accounts if item)) or "IBOX",
        "external_id": _scalar(payload, "id", "document_id"),
    }


def _reconcile_ibox_payments(session, workspace_owner_id: str) -> None:
    payment_rows = session.execute(
        select(PaymentDocument)
        .where(
            PaymentDocument.workspace_owner_id == workspace_owner_id,
            PaymentDocument.external_source == INTEGRATION,
            PaymentDocument.direction == "in",
        )
        .order_by(PaymentDocument.created_at.asc(), PaymentDocument.id.asc())
    ).scalars().all()
    credits: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    fallback_credits: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for payment in payment_rows:
        payload = payment.data if isinstance(payment.data, dict) else {}
        credit = _ibox_payment_credit(payload)
        if not credit:
            continue
        party_key = credit["party_key"]
        key = (party_key[0], party_key[1], credit["currency"])
        credits.setdefault(key, []).append(credit)
        fallback_credits.setdefault((party_key[1], credit["currency"]), []).append(credit)

    shipment_rows = session.execute(
        select(SaleDocument)
        .where(
            SaleDocument.workspace_owner_id == workspace_owner_id,
            SaleDocument.external_source == INTEGRATION,
            SaleDocument.external_id.like("shipments:%"),
        )
        .order_by(SaleDocument.created_at.asc(), SaleDocument.id.asc())
    ).scalars().all()
    for shipment in shipment_rows:
        data = dict(shipment.data) if isinstance(shipment.data, dict) else {}
        payload = data.get("ibox_payload")
        payload = payload if isinstance(payload, dict) else {}
        party_key = _ibox_party_key(payload)
        currency = str(shipment.currency or "UZS").upper()
        candidates = credits.get((party_key[0], party_key[1], currency))
        if candidates is None:
            candidates = fallback_credits.get((party_key[1], currency), [])
        outstanding = max(Decimal("0"), _decimal_value(shipment.amount))
        paid = Decimal("0")
        payment_lines: list[dict[str, Any]] = []
        for credit in candidates:
            remaining = _decimal_value(credit.get("remaining"))
            if remaining <= 0 or paid >= outstanding:
                continue
            allocated = min(remaining, outstanding - paid)
            credit["remaining"] = remaining - allocated
            paid += allocated
            payment_lines.append(
                {
                    "amount": _decimal_text(allocated),
                    "currency": currency,
                    "type": str(credit.get("type") or "Оплата IBOX"),
                    "account": str(credit.get("account") or "IBOX"),
                    "account_id": "",
                    "date": str(credit.get("date") or ""),
                    "number": str(credit.get("number") or ""),
                    "source": INTEGRATION,
                    "external_id": str(credit.get("external_id") or ""),
                }
            )
        data["paid_amount"] = _decimal_text(paid)
        data["payment_lines"] = payment_lines
        data["payment_type"] = ", ".join(
            dict.fromkeys(
                str(item.get("type") or "")
                for item in payment_lines
                if str(item.get("type") or "")
            )
        )
        data["status"] = _ibox_shipment_status(shipment.amount, paid)
        data["payment_status"] = (
            "paid"
            if paid >= outstanding and outstanding > 0
            else "partial"
            if paid > 0
            else "unpaid"
        )
        shipment.data = data


def _ibox_cashbox_movements(
    entity_type: str,
    payload: dict[str, Any],
) -> list[dict[str, Any]]:
    filial_id = _scalar(payload, "_ibox_filial_id", "filial_id") or "default"
    movements: list[dict[str, Any]] = []

    if entity_type == "payment_transfers":
        currency = str(payload.get("currency_code") or "").strip().upper()
        amount = abs(_decimal_value(payload.get("total") or payload.get("amount")))
        if currency and amount > 0:
            for prefix, sign in (("from", Decimal("-1")), ("to", Decimal("1"))):
                cashbox_id = _scalar(payload, f"{prefix}_cashbox_id")
                cashbox_name = _text(payload, f"{prefix}_cashbox_name")
                if cashbox_id or cashbox_name:
                    movements.append(
                        {
                            "filial_id": filial_id,
                            "cashbox_id": cashbox_id or f"name:{cashbox_name.casefold()}",
                            "cashbox_name": cashbox_name or f"IBOX {cashbox_id}",
                            "currency": currency,
                            "amount": amount * sign,
                        }
                    )
        return movements

    if entity_type.startswith("payments_received"):
        sign = Decimal("1")
    elif entity_type.startswith("payments_made") or entity_type == "salary":
        sign = Decimal("-1")
    else:
        return movements

    details = payload.get("payment_details")
    for item in details if isinstance(details, list) else []:
        if not isinstance(item, dict):
            continue
        cashbox = item.get("cashbox")
        cashbox = cashbox if isinstance(cashbox, dict) else {}
        currency_data = item.get("currency")
        currency_data = currency_data if isinstance(currency_data, dict) else {}
        cashbox_id = _scalar(item, "cashbox_id") or _scalar(cashbox, "id")
        cashbox_name = _text(cashbox, "name", "title") or _text(
            item,
            "cashbox_name",
        )
        currency = str(
            currency_data.get("code")
            or item.get("currency_code")
            or ""
        ).strip().upper()
        amount = _decimal_value(item.get("amount"))
        if (cashbox_id or cashbox_name) and currency and amount:
            movements.append(
                {
                    "filial_id": filial_id,
                    "cashbox_id": cashbox_id or f"name:{cashbox_name.casefold()}",
                    "cashbox_name": cashbox_name or f"IBOX {cashbox_id}",
                    "currency": currency,
                    "amount": amount * sign,
                }
            )
    return movements


def _ibox_account_id(
    workspace_owner_id: str,
    filial_id: str,
    cashbox_id: str,
) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"upos:{workspace_owner_id}:ibox:cashbox:{filial_id}:{cashbox_id}",
        )
    )


def _sync_ibox_accounts(session, workspace_owner_id: str) -> None:
    tracked_types = (
        "payments_received",
        "payments_received_from_organizations",
        "payments_made",
        "payments_made_to_organizations",
        "payment_transfers",
        "salary",
    )
    records = session.execute(
        select(ExternalRecord).where(
            ExternalRecord.workspace_owner_id == workspace_owner_id,
            ExternalRecord.integration == INTEGRATION,
            ExternalRecord.entity_type.in_(tracked_types),
        )
    ).scalars().all()

    accounts: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        payload = record.payload if isinstance(record.payload, dict) else {}
        for movement in _ibox_cashbox_movements(record.entity_type, payload):
            filial_id = str(movement["filial_id"])
            cashbox_id = str(movement["cashbox_id"])
            key = (filial_id, cashbox_id)
            account = accounts.setdefault(
                key,
                {
                    "name": str(movement["cashbox_name"]),
                    "balances": {},
                },
            )
            currency = str(movement["currency"])
            balances = account["balances"]
            balances[currency] = (
                _decimal_value(balances.get(currency))
                + _decimal_value(movement["amount"])
            )

    active_account_ids: set[str] = set()
    for (filial_id, cashbox_id), data in accounts.items():
        account_id = _ibox_account_id(
            workspace_owner_id,
            filial_id,
            cashbox_id,
        )
        active_account_ids.add(account_id)
        account = session.get(FinanceAccount, account_id)
        if account is None:
            account = FinanceAccount(
                id=account_id,
                workspace_owner_id=workspace_owner_id,
                name=f"IBOX · {data['name']} · филиал {filial_id}",
            )
            session.add(account)
        account.name = f"IBOX · {data['name']} · филиал {filial_id}"
        account.kind = "cash_uz"
        account.icon = "cash"
        account.note = ""
        account.owner_employee_id = None
        account.is_active = True
        session.flush()

        existing_balances = {
            row.currency: row
            for row in session.execute(
                select(AccountBalance).where(
                    AccountBalance.account_id == account_id,
                )
            ).scalars().all()
        }
        seen_currencies: set[str] = set()
        for currency, amount in data["balances"].items():
            seen_currencies.add(currency)
            balance = existing_balances.get(currency)
            if balance is None:
                balance = AccountBalance(
                    id=str(uuid.uuid4()),
                    account_id=account_id,
                    currency=currency,
                )
                session.add(balance)
            balance.amount = _decimal_value(amount).quantize(Decimal("0.01"))
        for currency, balance in existing_balances.items():
            if currency not in seen_currencies:
                session.delete(balance)

    imported_accounts = session.execute(
        select(FinanceAccount).where(
            FinanceAccount.workspace_owner_id == workspace_owner_id,
            FinanceAccount.name.like("IBOX · %"),
        )
    ).scalars().all()
    for account in imported_accounts:
        if account.id not in active_account_ids:
            account.is_active = False


def _run_dict(run: IntegrationSyncRun) -> dict[str, Any]:
    error = str(run.error or "")
    if "codec can't encode" in error or "ordinal not in range" in error:
        error = (
            "IBOX вернул некорректный технический ID филиала. "
            "Проверьте подключение и повторите синхронизацию."
        )
    return {
        "id": run.id,
        "integration": run.integration,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "imported_count": run.imported_count,
        "error": error or None,
        "data": run.data,
    }


def last_smpro_status(workspace_owner_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        run = session.execute(
            select(IntegrationSyncRun)
            .where(
                IntegrationSyncRun.workspace_owner_id == workspace_owner_id,
                IntegrationSyncRun.integration == INTEGRATION,
            )
            .order_by(IntegrationSyncRun.started_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        return _run_dict(run) if run else None


def test_smpro_connection(workspace_owner_id: str) -> dict[str, Any]:
    config = load_workspace_settings(workspace_owner_id).get("integrations", {}).get(INTEGRATION, {})
    return SMProClient(config).test_connection()


def list_upos_branches(workspace_owner_id: str) -> list[dict[str, str]]:
    with session_scope() as session:
        rows = session.scalars(
            select(Branch)
            .where(Branch.workspace_owner_id == workspace_owner_id)
            .order_by(func.lower(Branch.name), Branch.id)
        ).all()
        if not rows:
            row = Branch(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                name="Основной филиал",
                external_source="manual",
                external_id="main",
            )
            session.add(row)
            session.flush()
            rows = [row]
        return [{"id": str(row.id), "name": str(row.name or "Филиал")} for row in rows]


def start_smpro_sync(workspace_owner_id: str) -> dict[str, Any]:
    current = last_smpro_status(workspace_owner_id)
    if current and current.get("status") == "running":
        started_raw = str(current.get("started_at") or "")
        try:
            started_at = datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=UTC)
        except ValueError:
            started_at = datetime.now(UTC)
        if datetime.now(UTC) - started_at <= timedelta(minutes=5):
            current["already_running"] = True
            return current
        _finish_run(
            str(current.get("id") or ""),
            "error",
            int(current.get("imported_count") or 0),
            error="Предыдущая синхронизация была прервана обновлением сервера. Запущен новый проход.",
        )
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            IntegrationSyncRun(
                id=run_id,
                workspace_owner_id=workspace_owner_id,
                integration=INTEGRATION,
                status="running",
                started_at=datetime.now(UTC),
                data={},
            )
        )
    status = last_smpro_status(workspace_owner_id) or {"id": run_id, "status": "running"}
    status["already_running"] = False
    return status


def run_smpro_sync(workspace_owner_id: str, run_id: str) -> None:
    imported = 0
    try:
        settings = load_workspace_settings(workspace_owner_id)
        config = settings.get("integrations", {}).get(INTEGRATION, {})
        selected = config.get("sync_modules")
        modules = [
            key
            for key in DEFAULT_MODULES
            if not isinstance(selected, dict) or bool(selected.get(key, True))
        ]
        full_history = bool(config.get("full_history", True)) or not bool(config.get("initial_sync_completed"))
        client = SMProClient(config)
        entities = client.fetch_modules(
            modules,
            full_history=full_history,
            since=str(config.get("last_sync_at") or ""),
        )
        if not entities and client.warnings:
            raise SMProError(client.warnings[0]["error"])
        imported = _store_entities(workspace_owner_id, entities)
        summary = {key: len(value) for key, value in entities.items()}
        status = "partial" if client.warnings else "ok"
        _finish_run(
            run_id,
            status,
            imported,
            data={
                "entities": summary,
                "full_history": full_history,
                "warnings": client.warnings,
            },
        )
        fresh_settings = load_workspace_settings(workspace_owner_id)
        block = fresh_settings.setdefault("integrations", {}).setdefault(INTEGRATION, {})
        block["last_sync_at"] = datetime.now(UTC).isoformat()
        block["initial_sync_completed"] = True
        save_workspace_settings(workspace_owner_id, fresh_settings)
    except Exception as exc:
        message = str(exc).strip() or "Ошибка синхронизации IBOX / SMPro"
        _finish_run(run_id, "error", imported, error=message)


def _finish_run(
    run_id: str,
    status: str,
    imported_count: int,
    *,
    error: str | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    with session_scope() as session:
        run = session.get(IntegrationSyncRun, run_id)
        if not run:
            return
        run.status = status
        run.finished_at = datetime.now(UTC)
        run.imported_count = imported_count
        run.error = error
        run.data = data or {}


def _store_entities(workspace_owner_id: str, entities: dict[str, list[dict[str, Any]]]) -> int:
    total = 0
    settings = load_workspace_settings(workspace_owner_id)
    integration = settings.get("integrations", {}).get(INTEGRATION, {})
    target_branch_id = str(integration.get("upos_branch_id") or "").strip() or None
    ordered = (
        "filials",
        "offices",
        "clients",
        "warehouses",
        "products",
        "stock_selection",
        "orders",
        "shipments",
        "returns",
        "purchases",
        "supplier_returns",
        "payments_received",
        "payments_made",
        "salary",
    )
    keys = [key for key in ordered if key in entities]
    keys.extend(key for key in entities if key not in keys)
    with session_scope() as session:
        for entity_type in keys:
            for raw_item in entities.get(entity_type) or []:
                payload = _json_copy(raw_item)
                ext_id = _external_id(payload, entity_type)
                digest = _payload_hash(payload)
                stmt = insert(ExternalRecord).values(
                    id=str(uuid.uuid4()),
                    workspace_owner_id=workspace_owner_id,
                    integration=INTEGRATION,
                    entity_type=entity_type,
                    external_id=ext_id,
                    payload=payload,
                    payload_hash=digest,
                )
                session.execute(
                    stmt.on_conflict_do_update(
                        constraint="uq_external_records_identity",
                        set_={"payload": payload, "payload_hash": digest, "synced_at": func.now()},
                    )
                )
                _normalize(
                    session,
                    workspace_owner_id,
                    entity_type,
                    ext_id,
                    payload,
                    target_branch_id=target_branch_id,
                )
                total += 1
        if "shipments" in entities or "payments_received" in entities:
            _reconcile_ibox_payments(session, workspace_owner_id)
        if any(
            key in entities
            for key in (
                "payments_received",
                "payments_received_from_organizations",
                "payments_made",
                "payments_made_to_organizations",
                "payment_transfers",
                "salary",
            )
        ):
            _sync_ibox_accounts(session, workspace_owner_id)
    _sync_ibox_price_types(
        workspace_owner_id,
        entities.get("price_types") or [],
        entities.get("stock_selection") or [],
    )
    return total


def _upsert_model(session, model, constraint: str, values: dict[str, Any], updates: dict[str, Any]) -> None:
    stmt = insert(model).values(**values)
    session.execute(stmt.on_conflict_do_update(constraint=constraint, set_=updates))


def _normalize(
    session,
    workspace_owner_id: str,
    entity_type: str,
    ext_id: str,
    payload: dict[str, Any],
    *,
    target_branch_id: str | None,
) -> None:
    common = {
        "id": str(uuid.uuid4()),
        "workspace_owner_id": workspace_owner_id,
        "external_source": INTEGRATION,
        "external_id": ext_id,
    }
    name = _text(payload, "name", "title", "product_name", "outlet_name", "warehouse_name")
    if entity_type == "clients":
        values = {
            **common,
            "kind": "client",
            "name": name or f"Клиент SMPro {ext_id}",
            "tax_id": _text(payload, "tin", "inn", "tax_id"),
            "phone": _text(payload, "phone", "phone_number", "mobile"),
            "data": payload,
        }
        _upsert_model(
            session,
            Counterparty,
            "uq_counterparties_external",
            values,
            {key: values[key] for key in ("name", "tax_id", "phone", "data")},
        )
    elif entity_type == "products":
        _upsert_ibox_product(session, common, payload)
    elif entity_type == "stock_selection":
        _upsert_ibox_product(session, common, payload)
    elif entity_type == "warehouses":
        values = {
            **common,
            "name": name or f"Склад SMPro {ext_id}",
            "branch_id": target_branch_id,
            "data": payload,
        }
        _upsert_model(
            session,
            Warehouse,
            "uq_warehouses_external",
            values,
            {
                "name": values["name"],
                "branch_id": target_branch_id,
                "data": payload,
                "updated_at": func.now(),
            },
        )
    elif entity_type in {"orders", "shipments", "returns"}:
        document_common = {**common, "external_id": f"{entity_type}:{ext_id}"[:180]}
        _upsert_document(
            session,
            SaleDocument,
            "uq_sale_documents_external",
            document_common,
            payload,
            target_branch_id=target_branch_id,
            entity_type=entity_type,
        )
    elif entity_type in {"purchases", "supplier_returns"}:
        document_common = {**common, "external_id": f"{entity_type}:{ext_id}"[:180]}
        _upsert_document(
            session,
            PurchaseDocument,
            "uq_purchase_documents_external",
            document_common,
            payload,
            target_branch_id=target_branch_id,
        )
    elif entity_type.startswith("payments_received"):
        payment_common = {**common, "external_id": f"{entity_type}:{ext_id}"[:180]}
        _upsert_payment(session, payment_common, payload, "in")
    elif entity_type.startswith("payments_made") or entity_type == "salary":
        expense_common = {**common, "external_id": f"{entity_type}:{ext_id}"[:180]}
        _upsert_expense(session, expense_common, payload)


def _upsert_document(
    session,
    model,
    constraint: str,
    common: dict[str, Any],
    payload: dict[str, Any],
    *,
    target_branch_id: str | None,
    entity_type: str = "",
) -> None:
    is_ibox_sales_document = model is SaleDocument and entity_type in {
        "orders",
        "shipments",
        "returns",
    }
    document_data = (
        _ibox_sales_document_data(payload, entity_type)
        if is_ibox_sales_document
        else payload
    )
    if is_ibox_sales_document:
        document_data = _resolve_shipment_products(
            session,
            str(common["workspace_owner_id"]),
            document_data,
        )
    counterparty_id = (
        _shipment_counterparty_id(session, str(common["workspace_owner_id"]), payload)
        if is_ibox_sales_document
        else None
    )
    values = {
        **common,
        "number": _text(payload, "number", "document_number", "code"),
        "amount": _money(payload),
        "currency": _currency(payload),
        "counterparty_id": counterparty_id,
        "branch_id": target_branch_id,
        "data": document_data,
        "created_at": _created_at(payload),
    }
    _upsert_model(
        session,
        model,
        constraint,
        values,
        {
            key: values[key]
            for key in (
                "number",
                "amount",
                "currency",
                "counterparty_id",
                "branch_id",
                "data",
                "created_at",
            )
        },
    )


def _upsert_payment(session, common: dict[str, Any], payload: dict[str, Any], direction: str) -> None:
    counterparty_id = (
        _shipment_counterparty_id(
            session,
            str(common["workspace_owner_id"]),
            payload,
        )
        if direction == "in"
        else None
    )
    values = {
        **common,
        "number": _text(payload, "number", "document_number", "code"),
        "amount": _money(payload),
        "currency": _currency(payload),
        "counterparty_id": counterparty_id,
        "transaction_id": None,
        "direction": direction,
        "data": payload,
        "created_at": _created_at(payload),
    }
    _upsert_model(
        session,
        PaymentDocument,
        "uq_payment_documents_external",
        values,
        {
            key: values[key]
            for key in (
                "number",
                "amount",
                "currency",
                "counterparty_id",
                "direction",
                "data",
                "created_at",
            )
        },
    )


def _upsert_expense(session, common: dict[str, Any], payload: dict[str, Any]) -> None:
    values = {
        **common,
        "number": _text(payload, "number", "document_number", "code"),
        "amount": _money(payload),
        "currency": _currency(payload),
        "category_id": None,
        "counterparty_id": None,
        "transaction_id": None,
        "data": payload,
        "created_at": _created_at(payload),
    }
    _upsert_model(
        session,
        ExpenseDocument,
        "uq_expense_documents_external",
        values,
        {key: values[key] for key in ("number", "amount", "currency", "data", "created_at")},
    )
