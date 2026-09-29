from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from upos.db import session_scope
from upos.db_models import (
    Branch,
    Counterparty,
    ExpenseDocument,
    ExternalRecord,
    IntegrationSyncRun,
    PaymentDocument,
    Product,
    PurchaseDocument,
    SaleDocument,
    Transaction,
    Warehouse,
)
from upos.greenwhite_client import GreenWhiteClient, GreenWhiteError
from upos.storage import load_workspace_settings, save_workspace_settings
from upos.transactions_store import _ensure_branch, _ensure_category, _ensure_counterparty

INTEGRATION = "greenwhite"
# Пользовательское имя продукта; в коде/API/БД сохраняем ключ `greenwhite`.
SMARTUP_LABEL = "Smartup"

_STORE_ORDER = (
    "system_session",
    "organizations",
    "workspaces",
    "customers",
    "natural_persons",
    "suppliers",
    "products",
    "warehouses",
    "sales",
    "sales_returns",
    "purchases",
    "warehouse_receipts",
    "finance_customer_payments",
    "finance_expenses",
    "finance_cash_operations",
    "finance_bank_operations",
    "inventory_balances",
    "sync_limits",
    "sync_warnings",
)


def _json_copy(data: Any) -> Any:
    return json.loads(json.dumps(data, ensure_ascii=False, default=str))


def _payload_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _external_id(item: dict[str, Any], entity_type: str = "") -> str:
    if entity_type == "inventory_balances":
        parts = [
            item.get("date"),
            item.get("warehouse_code") or item.get("warehouse_id"),
            item.get("product_code") or item.get("product_id"),
            item.get("card_code"),
            item.get("serial_number"),
            item.get("batch_number"),
            item.get("inventory_kind"),
        ]
        key = "|".join(str(x).strip() for x in parts if x not in (None, ""))
        if key:
            return key

    for key in (
        "id",
        "guid",
        "uuid",
        "cashin_id",
        "operation_id",
        "deal_id",
        "purchase_id",
        "input_id",
        "product_id",
        "person_id",
        "room_id",
        "warehouse_id",
        "code",
        "room_code",
        "warehouse_code",
        "number",
        "doc_id",
        "document_id",
        "external_id",
    ):
        val = item.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return _payload_hash(item)


def _first_value(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def _money_decimal(item: dict[str, Any]) -> Decimal:
    raw = _first_value(item, "amount", "total_amount", "sold_amount", "sum", "total", "payment_sum", "value")
    try:
        return abs(Decimal(str(raw or "0")).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def _amount(item: dict[str, Any]) -> float:
    """Совместимость: сумма как float."""
    return float(_money_decimal(item))


def _currency(item: dict[str, Any]) -> str:
    raw = str(_first_value(item, "currency", "currency_code", "currencyCode") or "UZS").strip().upper()
    numeric_map = {"860": "UZS", "840": "USD", "643": "RUB", "978": "EUR"}
    return numeric_map.get(raw, raw or "UZS")[:3]


def _created_at(item: dict[str, Any]) -> datetime | None:
    raw = _first_value(
        item,
        "created_at",
        "created_on",
        "date",
        "cashin_time",
        "cashin_date",
        "operation_date",
        "deal_time",
        "delivery_date",
        "return_date",
        "input_time",
        "purchase_time",
        "payment_date",
        "doc_date",
        "createdAt",
    )
    if raw is None:
        return None
    s = str(raw).strip()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in ("%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _text(item: dict[str, Any], *keys: str) -> str | None:
    val = _first_value(item, *keys)
    if isinstance(val, dict):
        val = _first_value(val, "name", "title", "label")
    if isinstance(val, list):
        val = ",".join(str(x).strip() for x in val if str(x).strip())
    value = str(val or "").strip()
    return value or None


def _person_name(payload: dict[str, Any]) -> str | None:
    direct = _text(payload, "name", "title", "person_name", "client_name", "supplier_name", "short_name")
    if direct:
        return direct
    parts = [
        _text(payload, "last_name"),
        _text(payload, "first_name"),
        _text(payload, "middle_name"),
    ]
    value = " ".join(part for part in parts if part)
    return value or None


def _doc_number(item: dict[str, Any]) -> str:
    raw = _first_value(
        item,
        "number",
        "doc_number",
        "document_number",
        "order_number",
        "cashin_number",
        "operation_number",
        "delivery_number",
        "purchase_number",
        "input_number",
        "invoice_number",
        "code",
    )
    return str(raw or "").strip()


def _ref_external_id(payload: dict[str, Any]) -> str | None:
    for key in ("id", "guid", "uuid", "code", "person_code", "client_code", "supplier_code", "room_code", "filial_code"):
        val = payload.get(key)
        if val is None or isinstance(val, (dict, list)):
            continue
        s = str(val).strip()
        if s:
            return s[:180]
    return None


def _lookup_counterparty_id(session, workspace_owner_id: str, ext_key: str | None) -> str | None:
    if not ext_key:
        return None
    stmt = (
        select(Counterparty.id)
        .where(
            Counterparty.workspace_owner_id == workspace_owner_id,
            Counterparty.external_source == INTEGRATION,
            Counterparty.external_id == ext_key[:180],
        )
        .limit(1)
    )
    return session.execute(stmt).scalar_one_or_none()


def _lookup_branch_id(session, workspace_owner_id: str, ext_key: str | None) -> str | None:
    if not ext_key:
        return None
    stmt = (
        select(Branch.id)
        .where(
            Branch.workspace_owner_id == workspace_owner_id,
            Branch.external_source == INTEGRATION,
            Branch.external_id == ext_key[:180],
        )
        .limit(1)
    )
    return session.execute(stmt).scalar_one_or_none()


def _counterparty_keys(item: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    for block in ("customer", "client", "buyer"):
        blk = item.get(block)
        if isinstance(blk, dict):
            ref = _ref_external_id(blk)
            if ref:
                keys.append(ref)
                break
    for key_field in (
        "customer_id",
        "client_id",
        "buyer_id",
        "supplier_id",
        "supplier_code",
        "client_code",
        "person_id",
        "person_code",
        "legal_person_code",
        "natural_person_code",
    ):
        val = item.get(key_field)
        if val not in (None, ""):
            keys.append(str(val).strip())
    nm = _text(item, "client", "customer", "customer_name", "client_name", "person_name", "supplier_name", "supplier")
    if nm:
        keys.append(f"name:{nm.strip().lower()}")
    return keys


def _branch_keys(item: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    for block in ("branch", "organization"):
        blk = item.get(block)
        if isinstance(blk, dict):
            ref = _ref_external_id(blk)
            if ref:
                keys.append(ref)
                break
    for key_field in ("branch_id", "organization_id", "org_id", "filial_id", "filial_code", "room_code"):
        val = item.get(key_field)
        if val not in (None, ""):
            keys.append(str(val).strip())
    nm = _text(item, "branch", "organization", "organization_name", "room_name", "filial_name")
    if nm:
        keys.append(f"name:{nm.strip().lower()}")
    return keys


def _resolve_counterparty_id(session, workspace_owner_id: str, item: dict[str, Any]) -> str | None:
    for k in _counterparty_keys(item):
        cid = _lookup_counterparty_id(session, workspace_owner_id, k)
        if cid:
            return cid
    return None


def _resolve_branch_id(session, workspace_owner_id: str, item: dict[str, Any]) -> str | None:
    for k in _branch_keys(item):
        bid = _lookup_branch_id(session, workspace_owner_id, k)
        if bid:
            return bid
    return None


def last_greenwhite_status(workspace_owner_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        stmt = (
            select(IntegrationSyncRun)
            .where(
                IntegrationSyncRun.workspace_owner_id == workspace_owner_id,
                IntegrationSyncRun.integration == INTEGRATION,
            )
            .order_by(IntegrationSyncRun.started_at.desc())
            .limit(1)
        )
        run = session.execute(stmt).scalar_one_or_none()
        if run is None:
            return None
        return _run_dict(run)


def test_greenwhite_connection(workspace_owner_id: str) -> dict[str, Any]:
    cfg = load_workspace_settings(workspace_owner_id).get("integrations", {}).get(INTEGRATION, {})
    return GreenWhiteClient(cfg).test_connection()


def sync_greenwhite(workspace_owner_id: str) -> dict[str, Any]:
    cfg = load_workspace_settings(workspace_owner_id).get("integrations", {}).get(INTEGRATION, {})
    run_id = str(uuid.uuid4())
    started = datetime.now(UTC)
    with session_scope() as session:
        run = IntegrationSyncRun(
            id=run_id,
            workspace_owner_id=workspace_owner_id,
            integration=INTEGRATION,
            status="running",
            started_at=started,
            data={},
        )
        session.add(run)

    try:
        client = GreenWhiteClient(cfg)
        entities = client.fetch_available_entities()
        export_keys = set(entities) - {"system_session", "sync_limits", "sync_warnings"}
        if not export_keys and client.warnings:
            sample = "; ".join(x.get("error", "") for x in client.warnings[:3] if x.get("error"))
            raise GreenWhiteError(f"Сессия Smartup доступна, но export endpoints не вернули данные. {sample}")
        imported_count = _store_entities(workspace_owner_id, entities)
        status = "partial" if client.warnings else "ok"
        _finish_run(
            run_id,
            status,
            imported_count,
            data={
                "entities": {k: len(v) for k, v in entities.items()},
                "sync_window": client.sync_window(),
                "warnings": client.warnings,
            },
        )
        _mark_last_sync(workspace_owner_id)
    except GreenWhiteError as exc:
        _finish_run(run_id, "error", 0, error=str(exc))
        raise

    status = last_greenwhite_status(workspace_owner_id)
    return status or {"status": "ok", "imported_count": imported_count}


def _ordered_entity_keys(entities: dict[str, list[dict[str, Any]]]) -> list[str]:
    def sort_key(k: str) -> tuple[int, str]:
        try:
            idx = _STORE_ORDER.index(k)
        except ValueError:
            idx = 99
        return (idx, k)

    return sorted(entities.keys(), key=sort_key)


def _store_entities(workspace_owner_id: str, entities: dict[str, list[dict[str, Any]]]) -> int:
    total = 0
    with session_scope() as session:
        for entity_type in _ordered_entity_keys(entities):
            items = entities.get(entity_type) or []
            for item in items:
                payload = _json_copy(item)
                ext_id = _external_id(payload, entity_type)
                stmt = insert(ExternalRecord).values(
                    id=str(uuid.uuid4()),
                    workspace_owner_id=workspace_owner_id,
                    integration=INTEGRATION,
                    entity_type=entity_type,
                    external_id=ext_id[:180],
                    payload=payload,
                    payload_hash=_payload_hash(payload),
                )
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_external_records_identity",
                    set_={
                        "payload": payload,
                        "payload_hash": _payload_hash(payload),
                        "synced_at": func.now(),
                    },
                )
                session.execute(stmt)
                total += 1

                _normalize_entity_row(session, workspace_owner_id, entity_type, ext_id, payload)

                if entity_type in {"finance_customer_payments", "finance_cash_operations", "finance_bank_operations"}:
                    tx = _upsert_financial_transaction(session, workspace_owner_id, entity_type, ext_id, payload)
                    if _financial_direction(payload, entity_type) == "in":
                        _upsert_payment_document(session, workspace_owner_id, ext_id, payload, tx)
                    else:
                        _upsert_expense_document(session, workspace_owner_id, ext_id, payload, tx)
                elif entity_type == "finance_expenses":
                    tx = _upsert_financial_transaction(session, workspace_owner_id, entity_type, ext_id, payload)
                    _upsert_expense_document(session, workspace_owner_id, ext_id, payload, tx)
    return total


def _normalize_entity_row(
    session,
    workspace_owner_id: str,
    entity_type: str,
    ext_id: str,
    payload: dict[str, Any],
) -> None:
    if entity_type in {"customers", "natural_persons"}:
        _normalize_counterparty(session, workspace_owner_id, ext_id, _counterparty_kind(payload), payload)
    elif entity_type == "suppliers":
        _normalize_counterparty(session, workspace_owner_id, ext_id, "supplier", payload)
    elif entity_type in {"organizations", "workspaces"}:
        _normalize_branch(session, workspace_owner_id, ext_id, payload)
    elif entity_type == "products":
        _normalize_product(session, workspace_owner_id, ext_id, payload)
    elif entity_type == "inventory_balances":
        _normalize_warehouse_from_balance(session, workspace_owner_id, payload)
    elif entity_type == "warehouses":
        _normalize_warehouse(session, workspace_owner_id, ext_id, payload)
    elif entity_type == "sales":
        _normalize_sale_document(session, workspace_owner_id, ext_id, payload)
    elif entity_type == "purchases":
        _normalize_purchase_document(session, workspace_owner_id, ext_id, payload)
    elif entity_type == "system_session":
        pass


def _counterparty_kind(payload: dict[str, Any]) -> str:
    is_client = str(payload.get("is_client") or "").upper()
    is_supplier = str(payload.get("is_supplier") or "").upper()
    if is_supplier == "Y" and is_client != "Y":
        return "supplier"
    return "client"


def _normalize_counterparty(
    session, workspace_owner_id: str, ext_id: str, kind: str, payload: dict[str, Any],
) -> None:
    name = _person_name(payload) or ext_id[:120]
    phone = (_text(payload, "phone", "mobile", "main_phone") or "")[:64]
    tax_id = (_text(payload, "tax_id", "inn", "tax_number", "tin") or "")[:64]
    row = session.execute(
        select(Counterparty).where(
            Counterparty.workspace_owner_id == workspace_owner_id,
            Counterparty.external_source == INTEGRATION,
            Counterparty.external_id == ext_id[:180],
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            Counterparty(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                kind=kind,
                name=name,
                tax_id=tax_id or "",
                phone=phone or "",
                external_source=INTEGRATION,
                external_id=ext_id[:180],
            )
        )
        return
    row.name = name
    if kind in {"client", "supplier"}:
        row.kind = kind
    row.tax_id = tax_id or row.tax_id
    row.phone = phone or row.phone


def _normalize_branch(session, workspace_owner_id: str, ext_id: str, payload: dict[str, Any]) -> None:
    name = _text(payload, "name", "title", "organization_name", "room_name", "filial_name", "company_name") or ext_id[:120]
    row = session.execute(
        select(Branch).where(
            Branch.workspace_owner_id == workspace_owner_id,
            Branch.external_source == INTEGRATION,
            Branch.external_id == ext_id[:180],
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            Branch(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                name=name,
                external_source=INTEGRATION,
                external_id=ext_id[:180],
            )
        )
        return
    row.name = name


def _normalize_product(session, workspace_owner_id: str, ext_id: str, payload: dict[str, Any]) -> None:
    name = _text(payload, "name", "title", "product_name", "short_name") or ext_id[:120]
    sku = (_text(payload, "sku", "article", "article_code", "code", "product_code") or "")[:100]
    barcode = (_text(payload, "barcode", "barcodes", "ean", "gtin") or "")[:100]
    row = session.execute(
        select(Product).where(
            Product.workspace_owner_id == workspace_owner_id,
            Product.external_source == INTEGRATION,
            Product.external_id == ext_id[:180],
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            Product(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                name=name,
                sku=sku or "",
                barcode=barcode or "",
                external_source=INTEGRATION,
                external_id=ext_id[:180],
                data=payload,
            )
        )
        return
    row.name = name
    row.sku = sku or row.sku
    row.barcode = barcode or row.barcode
    row.data = payload


def _normalize_warehouse(session, workspace_owner_id: str, ext_id: str, payload: dict[str, Any]) -> None:
    name = _text(payload, "name", "title", "warehouse_name", "warehouse_code") or ext_id[:120]
    branch_id = None
    org_block = payload.get("organization") or payload.get("branch")
    ref = None
    if isinstance(org_block, dict):
        ref = _ref_external_id(org_block)
    else:
        ref = _text(payload, "branch_id", "filial_code", "room_code")
    if ref:
        branch_id = _lookup_branch_id(session, workspace_owner_id, ref)
    row = session.execute(
        select(Warehouse).where(
            Warehouse.workspace_owner_id == workspace_owner_id,
            Warehouse.external_source == INTEGRATION,
            Warehouse.external_id == ext_id[:180],
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            Warehouse(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                name=name,
                branch_id=branch_id,
                external_source=INTEGRATION,
                external_id=ext_id[:180],
                data=payload,
            )
        )
        return
    row.name = name
    if branch_id is not None:
        row.branch_id = branch_id
    row.data = payload


def _normalize_warehouse_from_balance(session, workspace_owner_id: str, payload: dict[str, Any]) -> None:
    ext_id = _text(payload, "warehouse_code", "warehouse_id")
    if not ext_id:
        return
    _normalize_warehouse(
        session,
        workspace_owner_id,
        ext_id[:180],
        {
            "warehouse_code": ext_id,
            "warehouse_id": payload.get("warehouse_id"),
            "filial_code": payload.get("filial_code"),
            "source": "inventory_balances",
        },
    )


def _normalize_sale_document(session, workspace_owner_id: str, ext_id: str, payload: dict[str, Any]) -> None:
    amt = _money_decimal(payload)
    cur = _currency(payload)
    num = (_doc_number(payload) or "")[:100]
    cid = _resolve_counterparty_id(session, workspace_owner_id, payload)
    bid = _resolve_branch_id(session, workspace_owner_id, payload)
    created = _created_at(payload)
    row = session.execute(
        select(SaleDocument).where(
            SaleDocument.workspace_owner_id == workspace_owner_id,
            SaleDocument.external_source == INTEGRATION,
            SaleDocument.external_id == ext_id[:180],
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            SaleDocument(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                number=num,
                amount=amt,
                currency=cur,
                counterparty_id=cid,
                branch_id=bid,
                external_source=INTEGRATION,
                external_id=ext_id[:180],
                data=payload,
                created_at=created or datetime.now(UTC),
            )
        )
        return
    row.amount = amt
    row.currency = cur
    row.number = num or row.number
    if cid:
        row.counterparty_id = cid
    if bid:
        row.branch_id = bid
    row.data = payload


def _normalize_purchase_document(session, workspace_owner_id: str, ext_id: str, payload: dict[str, Any]) -> None:
    amt = _money_decimal(payload)
    cur = _currency(payload)
    num = (_doc_number(payload) or "")[:100]
    cid = _resolve_counterparty_id(session, workspace_owner_id, payload)
    bid = _resolve_branch_id(session, workspace_owner_id, payload)
    created = _created_at(payload)
    row = session.execute(
        select(PurchaseDocument).where(
            PurchaseDocument.workspace_owner_id == workspace_owner_id,
            PurchaseDocument.external_source == INTEGRATION,
            PurchaseDocument.external_id == ext_id[:180],
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            PurchaseDocument(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                number=num,
                amount=amt,
                currency=cur,
                counterparty_id=cid,
                branch_id=bid,
                external_source=INTEGRATION,
                external_id=ext_id[:180],
                data=payload,
                created_at=created or datetime.now(UTC),
            )
        )
        return
    row.amount = amt
    row.currency = cur
    row.number = num or row.number
    if cid:
        row.counterparty_id = cid
    if bid:
        row.branch_id = bid
    row.data = payload


def _financial_direction(item: dict[str, Any], entity_type: str) -> str:
    if entity_type == "finance_customer_payments":
        return "in"
    raw = str(_first_value(item, "cashflow_kind", "direction", "operation_kind", "type") or "").strip().lower()
    out_values = {"out", "output", "expense", "expenses", "pay", "payment", "minus", "-", "o", "p", "e"}
    in_values = {"in", "input", "income", "receipt", "plus", "+", "i", "r"}
    if raw in out_values:
        return "out"
    if raw in in_values:
        return "in"
    reason = str(_first_value(item, "cashflow_reason_code", "corr_coa_code") or "").lower()
    if any(token in reason for token in ("expense", "cost", "расход", "xarajat")):
        return "out"
    return "in"


def _upsert_financial_transaction(
    session,
    workspace_owner_id: str,
    entity_type: str,
    external_id: str,
    item: dict[str, Any],
) -> Transaction | None:
    external_key = external_id[:180]
    source_filter = Transaction.data.op("->>")("source") == INTEGRATION
    external_filter = Transaction.data.op("->>")("external_id") == external_key
    stmt = select(Transaction).where(
        Transaction.workspace_owner_id == workspace_owner_id,
        source_filter,
        external_filter,
    )
    tx = session.execute(stmt).scalar_one_or_none()
    tx_type = "income" if _financial_direction(item, entity_type) == "in" else "expense"
    amount = _money_decimal(item)
    if amount <= Decimal("0.00"):
        return tx
    cc = _currency(item)

    cat_type = tx_type if tx_type in {"income", "expense"} else "expense"
    category_id = _ensure_category(session, workspace_owner_id, SMARTUP_LABEL, cat_type)

    br_text = _text(item, "branch", "organization", "organization_name", "room_name", "filial_code")
    branch_id = _resolve_branch_id(session, workspace_owner_id, item) or (
        _ensure_branch(session, workspace_owner_id, br_text) if br_text else None
    )

    cl_text = _text(item, "client", "customer", "customer_name", "client_name", "person_name", "corr_person_code")
    sup_text = _text(item, "supplier", "supplier_name", "corr_person_code")
    counterparty_id = _resolve_counterparty_id(session, workspace_owner_id, item) or _ensure_counterparty(
        session, workspace_owner_id, cl_text, sup_text, tx_type
    )

    data = {
        "source": INTEGRATION,
        "external_id": external_key,
        "external_entity_type": entity_type,
        "raw_ref": {
            "number": _doc_number(item),
            "status": _first_value(item, "status", "state", "posted"),
        },
    }

    def _patch_tx_fields(target: Transaction) -> None:
        target.amount = amount
        target.currency = cc
        target.type = tx_type
        target.category_id = category_id or target.category_id
        target.branch_id = branch_id or target.branch_id
        target.counterparty_id = counterparty_id or target.counterparty_id

    if tx is None:
        next_number = (
            session.execute(
                select(func.coalesce(func.max(Transaction.number), 0) + 1).where(
                    Transaction.workspace_owner_id == workspace_owner_id,
                ),
            ).scalar_one()
            or 1
        )
        created_at = _created_at(item)
        tx = Transaction(
            id=str(uuid.uuid4()),
            workspace_owner_id=workspace_owner_id,
            number=int(next_number),
            amount=amount,
            currency=cc,
            type=tx_type,
            is_confirmed=False,
            category=SMARTUP_LABEL,
            category_id=category_id,
            branch_id=branch_id,
            counterparty_id=counterparty_id,
            client=cl_text,
            supplier=sup_text,
            branch=br_text,
            note=_text(item, "note", "comment", "description", "purpose"),
            data=data,
            created_at=created_at if created_at is not None else datetime.now(UTC),
        )
        session.add(tx)
        session.flush()
        return tx

    merged = dict(tx.data or {})
    merged.update(data)
    tx.data = merged
    if not tx.is_confirmed:
        _patch_tx_fields(tx)
        tx.category = tx.category or SMARTUP_LABEL
        tx.client = tx.client or cl_text
        tx.supplier = tx.supplier or sup_text
        tx.branch = tx.branch or br_text
        tx.note = tx.note or _text(item, "note", "comment", "description", "purpose")
        session.flush()
    return tx


def _upsert_payment_document(
    session,
    workspace_owner_id: str,
    external_id: str,
    item: dict[str, Any],
    tx_row: Transaction | None,
) -> None:
    ext_key = external_id[:180]
    amt = _money_decimal(item)
    if amt <= Decimal("0.00"):
        return
    cur = _currency(item)
    num = (_doc_number(item) or "")[:100]
    cp = _resolve_counterparty_id(session, workspace_owner_id, item)
    tid = tx_row.id if tx_row else None
    created = _created_at(item)

    row = session.execute(
        select(PaymentDocument).where(
            PaymentDocument.workspace_owner_id == workspace_owner_id,
            PaymentDocument.external_source == INTEGRATION,
            PaymentDocument.external_id == ext_key,
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            PaymentDocument(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                number=num,
                amount=amt,
                currency=cur,
                counterparty_id=cp,
                transaction_id=tid,
                direction="in",
                external_source=INTEGRATION,
                external_id=ext_key,
                data=item,
                created_at=created or datetime.now(UTC),
            )
        )
        return
    row.amount = amt
    row.currency = cur
    row.number = num or row.number
    if cp:
        row.counterparty_id = cp
    if tid:
        row.transaction_id = tid
    row.data = item


def _ensure_expense_category(session, workspace_owner_id: str, name: str) -> str | None:
    trimmed = name.strip()
    if not trimmed:
        return None
    return _ensure_category(session, workspace_owner_id, trimmed, "expense")


def _upsert_expense_document(
    session,
    workspace_owner_id: str,
    external_id: str,
    item: dict[str, Any],
    tx_row: Transaction | None,
) -> None:
    ext_key = external_id[:180]
    amt = _money_decimal(item)
    if amt <= Decimal("0.00"):
        return
    cur = _currency(item)
    num = (_doc_number(item) or "")[:100]
    cp = _resolve_counterparty_id(session, workspace_owner_id, item)
    tid = tx_row.id if tx_row else None
    cat_name = _text(item, "category", "cost_type", "cashflow_reason_code", "payment_code")
    cat_id = _ensure_expense_category(session, workspace_owner_id, cat_name) if cat_name else None
    created = _created_at(item)

    row = session.execute(
        select(ExpenseDocument).where(
            ExpenseDocument.workspace_owner_id == workspace_owner_id,
            ExpenseDocument.external_source == INTEGRATION,
            ExpenseDocument.external_id == ext_key,
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            ExpenseDocument(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                number=num,
                amount=amt,
                currency=cur,
                category_id=cat_id,
                counterparty_id=cp,
                transaction_id=tid,
                external_source=INTEGRATION,
                external_id=ext_key,
                data=item,
                created_at=created or datetime.now(UTC),
            )
        )
        return
    row.amount = amt
    row.currency = cur
    row.number = num or row.number
    if cat_id:
        row.category_id = cat_id
    if cp:
        row.counterparty_id = cp
    if tid:
        row.transaction_id = tid
    row.data = item


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
        if run is None:
            return
        run.status = status
        run.finished_at = datetime.now(UTC)
        run.imported_count = imported_count
        run.error = error
        run.data = data or {}


def _mark_last_sync(workspace_owner_id: str) -> None:
    settings = load_workspace_settings(workspace_owner_id)
    greenwhite = settings.setdefault("integrations", {}).setdefault(INTEGRATION, {})
    greenwhite["last_sync_at"] = datetime.now(UTC).isoformat()
    save_workspace_settings(workspace_owner_id, settings)


def _run_dict(run: IntegrationSyncRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "integration": run.integration,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "imported_count": run.imported_count,
        "error": run.error,
        "data": run.data,
    }
