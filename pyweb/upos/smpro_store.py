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
        current["already_running"] = True
        return current
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
        "stock_products",
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
        values = {
            **common,
            "name": name or f"Товар SMPro {ext_id}",
            "sku": _text(payload, "sku", "article", "vendor_code", "code"),
            "barcode": _text(payload, "barcode", "bar_code"),
            "data": payload,
        }
        _upsert_model(
            session,
            Product,
            "uq_products_external",
            values,
            {key: values[key] for key in ("name", "sku", "barcode", "data")},
        )
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
) -> None:
    values = {
        **common,
        "number": _text(payload, "number", "document_number", "code"),
        "amount": _money(payload),
        "currency": _currency(payload),
        "counterparty_id": None,
        "branch_id": target_branch_id,
        "data": payload,
        "created_at": _created_at(payload),
    }
    _upsert_model(
        session,
        model,
        constraint,
        values,
        {
            key: values[key]
            for key in ("number", "amount", "currency", "branch_id", "data", "created_at")
        },
    )


def _upsert_payment(session, common: dict[str, Any], payload: dict[str, Any], direction: str) -> None:
    values = {
        **common,
        "number": _text(payload, "number", "document_number", "code"),
        "amount": _money(payload),
        "currency": _currency(payload),
        "counterparty_id": None,
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
        {key: values[key] for key in ("number", "amount", "currency", "direction", "data", "created_at")},
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
