from __future__ import annotations

import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / ".deps"))

from sqlalchemy import select

from upos.db import init_db, session_scope
from upos.db_models import (
    AccountBalance,
    Counterparty,
    CrmRecord,
    FinanceAccount,
    FinanceCategory,
    Product,
    PurchaseDocument,
    SaleDocument,
    Transaction,
    User,
    Warehouse,
    WarehouseOperation,
)


SOURCE = "demo_seed"
OWNER_LOGIN = "12345678"
PRODUCT_COUNT = 500
CLIENT_COUNT = 500


def new_id() -> str:
    return str(uuid.uuid4())


def money(value: int | float | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def quantity(value: int | float | Decimal) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.001"))


def get_or_create_by_external(session, model, workspace_id: str, external_id: str, defaults: dict):
    row = session.execute(
        select(model).where(
            model.workspace_owner_id == workspace_id,
            model.external_source == SOURCE,
            model.external_id == external_id,
        )
    ).scalar_one_or_none()
    if row is None:
        row = model(id=new_id(), workspace_owner_id=workspace_id, external_source=SOURCE, external_id=external_id)
        session.add(row)
    for key, value in defaults.items():
        setattr(row, key, value)
    return row


def get_or_create_account(session, workspace_id: str, name: str, kind: str, icon: str = "") -> FinanceAccount:
    row = session.execute(
        select(FinanceAccount).where(FinanceAccount.workspace_owner_id == workspace_id, FinanceAccount.name == name)
    ).scalar_one_or_none()
    if row is None:
        row = FinanceAccount(id=new_id(), workspace_owner_id=workspace_id, name=name)
        session.add(row)
    row.kind = kind
    row.icon = icon
    row.note = "Demo account"
    row.is_active = True
    return row


def get_or_create_category(session, workspace_id: str, name: str, cat_type: str) -> FinanceCategory:
    row = session.execute(
        select(FinanceCategory).where(
            FinanceCategory.workspace_owner_id == workspace_id,
            FinanceCategory.name == name,
            FinanceCategory.type == cat_type,
        )
    ).scalar_one_or_none()
    if row is None:
        row = FinanceCategory(id=new_id(), workspace_owner_id=workspace_id, name=name, type=cat_type)
        session.add(row)
    row.is_active = True
    return row


def main() -> None:
    random.seed(20260707)
    init_db()
    now = datetime.now(timezone.utc)
    today = now.date()

    product_names = [
        "Coffee beans", "Green tea", "Black tea", "Chocolate bar", "Mineral water",
        "Orange juice", "Apple juice", "Energy drink", "Croissant", "Sandwich",
        "Notebook", "Pen", "Marker", "USB cable", "Power bank",
        "Phone case", "Headphones", "Keyboard", "Mouse", "Desk lamp",
    ]
    categories = ["Drinks", "Food", "Office", "Electronics", "Accessories", "Household", "Service"]
    brands = ["Upos", "Atlas", "Navo", "Ziyo", "Bunyod", "Metro", "Prime"]
    client_types = ["Retail", "Wholesale", "VIP", "Corporate", "Online"]
    warehouses = ["Office Polka", "Main Warehouse", "Showroom", "Reserve Stock"]
    stages = [
        ("leads", "Leads"),
        ("qualification", "Qualification"),
        ("negotiation", "Negotiation"),
        ("invoice", "Invoice"),
        ("won", "Won"),
        ("lost", "Lost"),
    ]

    with session_scope() as session:
        owner = session.execute(select(User).where(User.username == OWNER_LOGIN)).scalar_one_or_none()
        if owner is None:
            raise RuntimeError(f"User {OWNER_LOGIN!r} was not found")
        workspace_id = str(owner.id)

        warehouse_rows: list[Warehouse] = []
        for idx, name in enumerate(warehouses, start=1):
            row = get_or_create_by_external(
                session,
                Warehouse,
                workspace_id,
                f"warehouse-{idx:02d}",
                {
                    "name": name,
                    "branch_id": None,
                    "data": {"status": "active", "manager": "Demo Manager", "note": "Demo warehouse"},
                },
            )
            warehouse_rows.append(row)

        cash = get_or_create_account(session, workspace_id, "Demo Cash", "cash", "wallet")
        bank = get_or_create_account(session, workspace_id, "Demo Bank", "bank", "bank")
        sales_cat = get_or_create_category(session, workspace_id, "Demo Sales", "income")
        returns_cat = get_or_create_category(session, workspace_id, "Demo Returns", "expense")
        purchase_cat = get_or_create_category(session, workspace_id, "Demo Purchases", "expense")
        session.flush()

        products: list[Product] = []
        for idx in range(1, PRODUCT_COUNT + 1):
            base = product_names[(idx - 1) % len(product_names)]
            category = categories[(idx - 1) % len(categories)]
            brand = brands[(idx - 1) % len(brands)]
            cost = 5_000 + (idx % 80) * 1_250
            sale = int(cost * Decimal("1.35")) + (idx % 7) * 500
            stock_rows = []
            for wh_idx, wh in enumerate(warehouses, start=1):
                qty = 8 + ((idx * wh_idx) % 95)
                price = cost + wh_idx * 200
                stock_rows.append(
                    {
                        "warehouse": wh,
                        "quantity": str(qty),
                        "price": str(price),
                        "date": str(today - timedelta(days=(idx + wh_idx) % 45)),
                    }
                )
            row = get_or_create_by_external(
                session,
                Product,
                workspace_id,
                f"product-{idx:04d}",
                {
                    "name": f"{base} Demo {idx:04d}",
                    "sku": f"SKU-{idx:04d}",
                    "barcode": f"478{idx:010d}"[:13],
                    "data": {
                        "kind": "product",
                        "category": category,
                        "brand": brand,
                        "unit": "pcs",
                        "status": "active",
                        "min_stock": str(5 + idx % 10),
                        "prices": [{"name": "Retail", "price": str(sale), "currency": "UZS"}],
                        "stocks": stock_rows,
                        "purchase_history": [
                            {
                                "date": str(today - timedelta(days=idx % 60)),
                                "warehouse": warehouses[idx % len(warehouses)],
                                "quantity": str(20 + idx % 50),
                                "price": str(cost),
                                "supplier": f"Demo Supplier {(idx % 30) + 1:02d}",
                            }
                        ],
                    },
                },
            )
            products.append(row)

        suppliers: list[Counterparty] = []
        for idx in range(1, 31):
            row = get_or_create_by_external(
                session,
                Counterparty,
                workspace_id,
                f"supplier-{idx:03d}",
                {
                    "kind": "supplier",
                    "name": f"Demo Supplier {idx:02d}",
                    "tax_id": f"SUP{idx:06d}",
                    "phone": f"+99890123{idx:04d}",
                    "data": {"segment": "Demo", "note": "Seed supplier"},
                },
            )
            suppliers.append(row)

        clients: list[Counterparty] = []
        for idx in range(1, CLIENT_COUNT + 1):
            row = get_or_create_by_external(
                session,
                Counterparty,
                workspace_id,
                f"client-{idx:04d}",
                {
                    "kind": "client",
                    "name": f"Demo Client {idx:04d}",
                    "tax_id": f"CL{idx:07d}",
                    "phone": f"+9989{idx % 9 + 1}{idx:07d}"[:13],
                    "data": {
                        "segment": client_types[idx % len(client_types)],
                        "address": f"Tashkent demo street {idx}",
                        "crm_status": ["new_lead", "in_work", "our_client", "paused"][idx % 4],
                        "source": ["Site", "Instagram", "Telegram", "Call"][idx % 4],
                    },
                },
            )
            clients.append(row)
        session.flush()

        for idx in range(1, 51):
            line_count = 3 + idx % 4
            lines = []
            total = Decimal("0")
            for step in range(line_count):
                product = products[(idx * 7 + step) % len(products)]
                pdata = product.data or {}
                price = Decimal(str((pdata.get("prices") or [{}])[0].get("price") or 0))
                qty = Decimal(str(1 + ((idx + step) % 5)))
                line_total = price * qty
                lines.append(
                    {
                        "product": product.name,
                        "product_id": product.id,
                        "warehouse": warehouses[(idx + step) % len(warehouses)],
                        "quantity": str(qty.normalize()),
                        "price": str(price.normalize()),
                        "total": str(line_total.normalize()),
                    }
                )
                total += line_total
            doc_type = "return" if idx % 7 == 0 else "sale"
            paid = total if doc_type == "return" or idx % 5 else total * Decimal("0.45")
            client = clients[(idx * 11) % len(clients)]
            sale_doc = get_or_create_by_external(
                session,
                SaleDocument,
                workspace_id,
                f"sale-{idx:04d}",
                {
                    "number": f"DEMO-SALE-{idx:04d}",
                    "amount": money(total),
                    "currency": "UZS",
                    "counterparty_id": client.id,
                    "branch_id": None,
                    "data": {
                        "doc_type": doc_type,
                        "date": str(today - timedelta(days=idx % 35)),
                        "client": client.name,
                        "warehouse": warehouses[idx % len(warehouses)],
                        "manager": owner.name,
                        "paid_amount": str(money(paid)),
                        "payment_type": "cash" if idx % 2 else "bank",
                        "status": "return" if doc_type == "return" else ("paid" if paid >= total else "partial"),
                        "note": "Demo sale document",
                        "lines": lines,
                    },
                },
            )
            tx_type = "expense" if doc_type == "return" else "income"
            tx_category = returns_cat if doc_type == "return" else sales_cat
            tx = session.execute(
                select(Transaction).where(Transaction.workspace_owner_id == workspace_id, Transaction.number == 70_000 + idx)
            ).scalar_one_or_none()
            if tx is None:
                tx = Transaction(id=new_id(), workspace_owner_id=workspace_id, number=70_000 + idx)
                session.add(tx)
            tx.amount = money(total)
            tx.currency = "UZS"
            tx.type = tx_type
            tx.status = "confirmed"
            tx.is_confirmed = True
            tx.requires_confirmation = False
            tx.category = tx_category.name
            tx.category_id = tx_category.id
            tx.counterparty_id = client.id
            tx.client = client.name
            tx.note = f"Demo transaction for {sale_doc.number}"
            tx.data = {"source": SOURCE, "sale_document_id": sale_doc.id, "payment_account": cash.name if idx % 2 else bank.name}

        for idx in range(1, 21):
            lines = []
            total = Decimal("0")
            supplier = suppliers[idx % len(suppliers)]
            for step in range(5):
                product = products[(idx * 13 + step) % len(products)]
                cost = Decimal(str((product.data or {}).get("purchase_history", [{}])[0].get("price") or 6000))
                qty = Decimal(str(10 + ((idx + step) % 20)))
                line_total = cost * qty
                lines.append(
                    {
                        "product": product.name,
                        "product_id": product.id,
                        "quantity": str(qty.normalize()),
                        "price": str(cost.normalize()),
                        "total": str(line_total.normalize()),
                    }
                )
                total += line_total
            purchase = get_or_create_by_external(
                session,
                PurchaseDocument,
                workspace_id,
                f"purchase-{idx:04d}",
                {
                    "number": f"DEMO-PUR-{idx:04d}",
                    "amount": money(total),
                    "currency": "UZS",
                    "counterparty_id": supplier.id,
                    "branch_id": None,
                    "data": {
                        "date": str(today - timedelta(days=idx % 40)),
                        "supplier": supplier.name,
                        "warehouse": warehouses[idx % len(warehouses)],
                        "paid_amount": str(money(total if idx % 3 else total * Decimal("0.5"))),
                        "payment_type": "bank",
                        "status": "paid" if idx % 3 else "partial",
                        "note": "Demo purchase document",
                        "lines": lines,
                    },
                },
            )
            tx = session.execute(
                select(Transaction).where(Transaction.workspace_owner_id == workspace_id, Transaction.number == 71_000 + idx)
            ).scalar_one_or_none()
            if tx is None:
                tx = Transaction(id=new_id(), workspace_owner_id=workspace_id, number=71_000 + idx)
                session.add(tx)
            tx.amount = money(total)
            tx.currency = "UZS"
            tx.type = "expense"
            tx.status = "confirmed"
            tx.is_confirmed = True
            tx.category = purchase_cat.name
            tx.category_id = purchase_cat.id
            tx.supplier = supplier.name
            tx.counterparty_id = supplier.id
            tx.note = f"Demo transaction for {purchase.number}"
            tx.data = {"source": SOURCE, "purchase_document_id": purchase.id, "payment_account": bank.name}

        for idx in range(1, 61):
            product = products[(idx * 17) % len(products)]
            wh = warehouse_rows[idx % len(warehouse_rows)]
            op_type = ["in", "out", "adjustment", "transfer"][idx % 4]
            qty = Decimal(str(2 + idx % 15))
            amount = qty * Decimal(str(4_000 + idx * 350))
            op = session.execute(
                select(WarehouseOperation).where(
                    WarehouseOperation.workspace_owner_id == workspace_id,
                    WarehouseOperation.number == f"DEMO-WH-{idx:04d}",
                )
            ).scalar_one_or_none()
            if op is None:
                op = WarehouseOperation(id=new_id(), workspace_owner_id=workspace_id, number=f"DEMO-WH-{idx:04d}")
                session.add(op)
            op.operation_type = op_type
            op.warehouse_id = wh.id
            op.product_id = product.id
            op.quantity = quantity(qty)
            op.amount = money(amount)
            op.currency = "UZS"
            op.data = {
                "date": str(today - timedelta(days=idx % 25)),
                "operation_type": op_type,
                "warehouse": wh.name,
                "from_warehouse": warehouses[(idx + 1) % len(warehouses)] if op_type == "transfer" else "",
                "to_warehouse": wh.name if op_type == "transfer" else "",
                "product": product.name,
                "responsible": owner.name,
                "note": "Demo warehouse operation",
            }

        for idx in range(1, 181):
            client = clients[(idx * 5) % len(clients)]
            stage_id, stage_title = stages[idx % len(stages)]
            item_type = "deal" if idx % 3 else "task" if idx % 3 == 1 else "history"
            status = "won" if stage_id == "won" else "lost" if stage_id == "lost" else "in_progress" if idx % 2 else "new"
            rec = session.execute(
                select(CrmRecord).where(
                    CrmRecord.workspace_owner_id == workspace_id,
                    CrmRecord.title == f"Demo CRM {idx:04d}",
                )
            ).scalar_one_or_none()
            if rec is None:
                rec = CrmRecord(id=new_id(), workspace_owner_id=workspace_id, title=f"Demo CRM {idx:04d}")
                session.add(rec)
            rec.item_type = item_type
            rec.counterparty_id = client.id
            rec.status = status
            rec.due_date = str(today + timedelta(days=(idx % 18) - 5))
            rec.amount = money(100_000 + idx * 12_500)
            rec.currency = "UZS"
            rec.data = {
                "item_type": item_type,
                "client": client.name,
                "responsible": owner.name,
                "date": str(today - timedelta(days=idx % 30)),
                "due_date": rec.due_date,
                "stage": stage_title,
                "stage_id": stage_id,
                "lead_source": ["Site", "Instagram", "Telegram", "Call"][idx % 4],
                "contact_type": ["Call", "Message", "Visit", "Email"][idx % 4],
                "service_type": ["Consulting", "Delivery", "Support", "Implementation"][idx % 4],
                "priority": ["low", "normal", "high", "urgent"][idx % 4],
                "next_step": f"Demo next step {idx}",
                "probability": str((idx * 7) % 100),
                "note": "Demo CRM record for testing filters, kanban and tables",
            }

        for account, amount in ((cash, Decimal("85000000")), (bank, Decimal("210000000"))):
            balance = session.execute(
                select(AccountBalance).where(AccountBalance.account_id == account.id, AccountBalance.currency == "UZS")
            ).scalar_one_or_none()
            if balance is None:
                balance = AccountBalance(id=new_id(), account_id=account.id, currency="UZS")
                session.add(balance)
            balance.amount = money(amount)

    print(
        "Demo data ready: "
        f"{PRODUCT_COUNT} products, {CLIENT_COUNT} clients, 50 sales/returns, "
        "20 purchases, 60 warehouse ops, 180 CRM records."
    )


if __name__ == "__main__":
    main()
