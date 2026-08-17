from __future__ import annotations

import sys
import types
import unittest

# The mapper is pure; keep its unit test independent from the configured database.
db_stub = types.ModuleType("upos.db")
db_stub.session_scope = lambda: None
models_stub = types.ModuleType("upos.db_models")
for model_name in (
    "AccountBalance",
    "Branch",
    "Counterparty",
    "ExpenseDocument",
    "ExternalRecord",
    "FinanceAccount",
    "IntegrationSyncRun",
    "EmployeeOrganization",
    "Organization",
    "PaymentDocument",
    "Product",
    "PurchaseDocument",
    "Role",
    "SaleDocument",
    "User",
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
    _ibox_cashbox_movements,
    _ibox_employee_name,
    _ibox_employee_position,
    _ibox_employee_username,
    _ibox_payment_credit,
    _ibox_product_data,
    _ibox_price_type_rows,
    _ibox_purchase_document_data,
    _ibox_sales_document_data,
    _ibox_shipment_status,
    _shipment_document_data,
)


class SMProStoreTests(unittest.TestCase):
    def test_ibox_employee_username_uses_stable_remote_id(self) -> None:
        payload = {"id": 77, "login": "azamat", "name": "Азамжон Умаров"}

        self.assertEqual(_ibox_employee_username(payload), "ibox_77")

    def test_ibox_employee_name_and_position_from_payload(self) -> None:
        payload = {
            "first_name": "Азамжон",
            "last_name": "Умаров",
            "position": "Отдел продаж",
        }

        self.assertEqual(_ibox_employee_name(payload), "Умаров Азамжон")
        self.assertEqual(_ibox_employee_position(payload), "Отдел продаж")

    def test_ibox_order_keeps_product_names_and_lines(self) -> None:
        document = _ibox_sales_document_data(
            {
                "id": 4286,
                "currency_code": "UZS",
                "outlet_id": 938,
                "outlet_name": "Lux Shop",
                "number": "CLI-741552",
                "date": "2026-04-03T09:37:06.000000Z",
                "status": 43,
                "total": 550000,
                "order_details": [
                    {
                        "id": 2141,
                        "product_id": 354,
                        "warehouse_id": 1,
                        "quantity": 1,
                        "price": 550000,
                        "total": 550000,
                        "product": {
                            "id": 354,
                            "name": "Сканер mp2050b",
                            "storage_unit": {"short_name": "шт"},
                        },
                        "warehouse": {"id": 1, "name": "Офис Склад"},
                    }
                ],
            },
            "orders",
        )

        self.assertEqual(document["doc_type"], "order")
        self.assertEqual(document["status"], "new")
        self.assertEqual(document["client"], "Lux Shop")
        self.assertEqual(document["warehouse"], "Офис Склад")
        self.assertEqual(
            document["lines"][0],
            {
                "product": "Сканер mp2050b",
                "product_id": "354",
                "warehouse": "Офис Склад",
                "warehouse_id": "1",
                "quantity": "1",
                "price": "550000",
                "total": "550000",
                "unit": "шт",
                "source": "ibox",
            },
        )

    def test_ibox_return_reads_purchase_details(self) -> None:
        document = _ibox_sales_document_data(
            {
                "date": "2026-07-28",
                "data": {
                    "purchase_details": [
                        {
                            "product_id": 77,
                            "product_name": "Возвращённый товар",
                            "quantity": 2,
                            "price": 10,
                            "total": 20,
                        }
                    ]
                },
            },
            "returns",
        )

        self.assertEqual(document["doc_type"], "return")
        self.assertEqual(document["status"], "completed")
        self.assertEqual(document["lines"][0]["product"], "Возвращённый товар")
        self.assertEqual(document["lines"][0]["quantity"], "2")

    def test_ibox_purchase_becomes_purchases_board_document(self) -> None:
        # Реальная форма payload из SMPro: поставщик в outlet_name,
        # строки в purchase_details с вложенными product и warehouse.
        document = _ibox_purchase_document_data(
            {
                "id": 8180,
                "date": "2026-06-30T06:35:17.000000Z",
                "total": 1900000,
                "number": "104",
                "status": 13,
                "outlet_id": 1223,
                "outlet_name": "Zigo",
                "currency_code": "UZS",
                "_ibox_filial_id": "1",
                "purchase_details": [
                    {
                        "price": 380000,
                        "total": 1900000,
                        "product": {
                            "id": 2846,
                            "name": "Рация BaoFeng 777",
                            "storage_unit": {"short_name": "шт"},
                        },
                        "quantity": 5,
                        "warehouse": {"id": 1, "name": "Офис Склад"},
                        "product_id": 2846,
                    }
                ],
            },
            "purchases",
        )

        self.assertEqual(document["supplier"], "Zigo")
        self.assertEqual(document["date"], "2026-06-30")
        self.assertEqual(document["status"], "purchased")
        self.assertEqual(document["warehouse"], "Офис Склад")
        self.assertFalse(document["is_supplier_return"])
        self.assertEqual(document["lines"][0]["product"], "Рация BaoFeng 777")
        self.assertEqual(document["lines"][0]["quantity"], "5")
        self.assertEqual(document["lines"][0]["unit"], "шт")

    def test_ibox_supplier_return_is_marked(self) -> None:
        document = _ibox_purchase_document_data(
            {"outlet_name": "Zigo", "total": 100, "currency_code": "UZS"},
            "supplier_returns",
        )
        self.assertTrue(document["is_supplier_return"])
        self.assertIn("Возврат поставщику", document["note"])

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
        self.assertEqual(document["status"], "installation")
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

    def test_ibox_shipment_status_recognizes_debt_until_fully_paid(self) -> None:
        self.assertEqual(_ibox_shipment_status("100", "0"), "installation")
        self.assertEqual(_ibox_shipment_status("100", "40"), "installation")
        self.assertEqual(_ibox_shipment_status("100", "100"), "completed")
        self.assertEqual(_ibox_shipment_status("100", "120"), "completed")

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
        self.assertEqual(product["prices"][0]["price_type_id"], "ibox:7:1")
        self.assertEqual(product["prices"][0]["ibox_price_type_id"], "1")
        self.assertEqual(product["stocks"][0]["quantity"], "12")
        self.assertEqual(product["purchase_price"], "180")

    def test_ibox_price_types_do_not_replace_local_price_lists(self) -> None:
        rows = _ibox_price_type_rows(
            [
                {
                    "id": 1,
                    "name": "Retail",
                    "_ibox_filial_id": "7",
                    "active": 1,
                },
                {
                    "id": 3,
                    "name": "Discount",
                    "_ibox_filial_id": "7",
                    "active": 1,
                },
            ],
            [
                {
                    "_ibox_filial_id": "7",
                    "_ibox_price_type_id": "1",
                    "currency_code": "USD",
                },
                {
                    "_ibox_filial_id": "7",
                    "_ibox_price_type_id": "3",
                    "currency_code": "UZS",
                },
            ],
            [
                {
                    "id": "1",
                    "name": "ПРОДАЖНАЯ ЦЕНА",
                    "sort_order": 1,
                }
            ],
        )

        self.assertEqual([row["id"] for row in rows], ["1", "ibox:7:1", "ibox:7:3"])
        self.assertEqual(rows[0]["name"], "ПРОДАЖНАЯ ЦЕНА")
        self.assertEqual(rows[1]["name"], "IBOX · Retail")
        self.assertEqual(rows[1]["convert_to_currency"], "USD")
        self.assertEqual(rows[1]["created_by"], "IBOX")

    def test_product_replaces_legacy_ibox_price_id(self) -> None:
        product = _ibox_product_data(
            {
                "id": 19,
                "price": 125,
                "currency_code": "USD",
                "_ibox_filial_id": "7",
                "_ibox_price_type_id": "1",
                "_ibox_price_type_name": "Retail",
            },
            {
                "prices": [
                    {
                        "price_type_id": "1",
                        "name": "Retail",
                        "price": "100",
                        "currency": "USD",
                        "ibox_filial_id": "7",
                        "source": "ibox",
                    }
                ]
            },
        )

        self.assertEqual(len(product["prices"]), 1)
        self.assertEqual(product["prices"][0]["price_type_id"], "ibox:7:1")
        self.assertEqual(product["prices"][0]["price"], "125")

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

    def test_cashbox_movements_keep_currencies_and_signed_change(self) -> None:
        movements = _ibox_cashbox_movements(
            "payments_received",
            {
                "filial_id": 1,
                "payment_details": [
                    {
                        "cashbox_id": 5,
                        "amount": 700,
                        "cashbox": {"name": "Cash"},
                        "currency": {"code": "USD"},
                    },
                    {
                        "cashbox_id": 5,
                        "amount": -240000,
                        "cashbox": {"name": "Cash"},
                        "currency": {"code": "UZS"},
                    },
                ],
            },
        )

        self.assertEqual(
            [
                (
                    row["cashbox_id"],
                    row["currency"],
                    str(row["amount"]),
                )
                for row in movements
            ],
            [("5", "USD", "700"), ("5", "UZS", "-240000")],
        )

    def test_made_payment_debits_cashbox(self) -> None:
        movements = _ibox_cashbox_movements(
            "payments_made",
            {
                "filial_id": 1,
                "payment_details": [
                    {
                        "cashbox_id": 5,
                        "amount": 100,
                        "cashbox": {"name": "Cash"},
                        "currency": {"code": "USD"},
                    }
                ],
            },
        )

        self.assertEqual(str(movements[0]["amount"]), "-100")

    def test_transfer_moves_balance_between_ibox_cashboxes(self) -> None:
        movements = _ibox_cashbox_movements(
            "payment_transfers",
            {
                "filial_id": 1,
                "currency_code": "UZS",
                "total": 200000,
                "from_cashbox_id": 4,
                "from_cashbox_name": "Card",
                "to_cashbox_id": 5,
                "to_cashbox_name": "Cash",
            },
        )

        self.assertEqual(
            [
                (
                    row["cashbox_id"],
                    row["currency"],
                    str(row["amount"]),
                )
                for row in movements
            ],
            [("4", "UZS", "-200000"), ("5", "UZS", "200000")],
        )


if __name__ == "__main__":
    unittest.main()
