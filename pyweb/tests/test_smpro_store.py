from __future__ import annotations

import sys
import types
import unittest

# The mapper is pure; keep its unit test independent from the configured database.
db_stub = types.ModuleType("upos.db")
db_stub.session_scope = lambda: None
models_stub = types.ModuleType("upos.db_models")
for model_name in (
    "Branch",
    "Counterparty",
    "ExpenseDocument",
    "ExternalRecord",
    "IntegrationSyncRun",
    "PaymentDocument",
    "Product",
    "PurchaseDocument",
    "SaleDocument",
    "Warehouse",
):
    setattr(models_stub, model_name, type(model_name, (), {}))
storage_stub = types.ModuleType("upos.storage")
storage_stub.load_workspace_settings = lambda workspace_owner_id: {}
storage_stub.save_workspace_settings = lambda workspace_owner_id, settings: None
sys.modules["upos.db"] = db_stub
sys.modules["upos.db_models"] = models_stub
sys.modules["upos.storage"] = storage_stub

from upos.smpro_store import (
    _ibox_payment_credit,
    _ibox_product_data,
    _shipment_document_data,
)


class SMProStoreTests(unittest.TestCase):
    def test_shipment_becomes_sales_journal_document(self) -> None:
        payload = {
            "id": 8583,
            "filial_id": 1,
            "_ibox_filial_id": "1",
            "currency_id": 2,
            "currency_code": "USD",
            "outlet_id": 440,
            "outlet_name": "Zaman Family park",
            "number": "975",
            "date": "2026-07-27T08:32:20.000000Z",
            "status": 24,
            "total": 190,
            "shipment_details": [
                {
                    "id": 1,
                    "product_id": 51,
                    "warehouse_id": 7,
                    "quantity": 2,
                    "price": 95,
                    "total": 190,
                    "product": {
                        "id": 51,
                        "name": "Monoblock",
                        "storage_unit": {"short_name": "шт"},
                    },
                    "warehouse": {"id": 7, "name": "Основной склад"},
                }
            ],
        }

        document = _shipment_document_data(payload)

        self.assertEqual(document["doc_type"], "sale")
        self.assertEqual(document["date"], "2026-07-27")
        self.assertEqual(document["client"], "Zaman Family park")
        self.assertEqual(document["warehouse"], "Основной склад")
        self.assertEqual(document["status"], "shipped")
        self.assertEqual(document["workflow_version"], 2)
        self.assertFalse(document["inventory_applied"])
        self.assertEqual(document["manager"], "IBOX")
        self.assertEqual(document["ibox_document_id"], "8583")
        self.assertEqual(document["ibox_filial_id"], "1")
        self.assertEqual(
            document["lines"][0],
            {
                "product": "Monoblock",
                "product_id": "51",
                "warehouse": "Основной склад",
                "warehouse_id": "7",
                "quantity": "2",
                "price": "95",
                "total": "190",
                "unit": "шт",
                "source": "ibox",
            },
        )

    def test_shipment_line_calculates_missing_total(self) -> None:
        document = _shipment_document_data(
            {
                "id": 9,
                "date": "2026-07-27",
                "shipment_details": [
                    {
                        "product_id": 4,
                        "quantity": "2.500",
                        "price": "12.40",
                    }
                ],
            }
        )

        self.assertEqual(document["lines"][0]["quantity"], "2.5")
        self.assertEqual(document["lines"][0]["price"], "12.4")
        self.assertEqual(document["lines"][0]["total"], "31")

    def test_stock_selection_becomes_product_price_and_stock(self) -> None:
        product = _ibox_product_data(
            {
                "id": 19,
                "type": 1,
                "product_category_name": "Scanners",
                "storage_unit": {"name": "Piece", "short_name": "pc"},
                "available": 12,
                "price": 240,
                "currency_code": "USD",
                "_ibox_filial_id": "7",
                "_ibox_price_type_id": "1",
                "_ibox_price_type_name": "Retail",
                "last_purchase_price": {
                    "price": 180,
                    "currency": {"code": "USD"},
                },
            }
        )

        self.assertEqual(product["category"], "Scanners")
        self.assertEqual(product["unit"], "Piece")
        self.assertEqual(product["prices"][0]["price"], "240")
        self.assertEqual(product["prices"][0]["price_type_id"], "1")
        self.assertEqual(product["stocks"][0]["quantity"], "12")
        self.assertEqual(product["purchase_price"], "180")

    def test_received_payment_uses_document_total_and_cashbox(self) -> None:
        credit = _ibox_payment_credit(
            {
                "id": 8585,
                "filial_id": 1,
                "outlet_id": 440,
                "number": 1263,
                "date": "2026-07-27T09:00:00Z",
                "currency_code": "UZS",
                "total": 8160000,
                "payment_type_name": "Client payment",
                "payment_details": [
                    {
                        "amount": 700,
                        "currency": {"code": "USD"},
                        "cashbox": {"name": "Cash"},
                    },
                    {
                        "amount": -240000,
                        "currency": {"code": "UZS"},
                        "cashbox": {"name": "Cash"},
                    },
                ],
            }
        )

        self.assertIsNotNone(credit)
        self.assertEqual(str(credit["amount"]), "8160000")
        self.assertEqual(credit["currency"], "UZS")
        self.assertEqual(credit["party_key"], ("1", "id:440"))
        self.assertEqual(credit["account"], "Cash")


if __name__ == "__main__":
    unittest.main()
