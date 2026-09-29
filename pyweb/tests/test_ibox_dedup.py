"""Повторная выгрузка IBOX не должна создавать дубликаты."""

from __future__ import annotations

import sys
import types
import unittest

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
sys.modules.setdefault("upos.db", db_stub)
sys.modules.setdefault("upos.db_models", models_stub)
sys.modules.setdefault("upos.storage", storage_stub)

from upos.smpro_store import _external_id


class ExternalIdTests(unittest.TestCase):
    def test_свой_номер_записи_используется_как_есть(self):
        self.assertEqual(_external_id({"id": "12345"}, "payments_received"), "12345")

    def test_номер_не_зависит_от_остального_содержимого(self):
        first = _external_id({"id": "777", "status": "new", "amount": "100"}, "purchases")
        second = _external_id({"id": "777", "status": "paid", "amount": "150"}, "purchases")
        self.assertEqual(first, second)

    def test_запись_без_номера_узнаётся_по_опознавательным_полям(self):
        item = {"_ibox_filial_id": "F1", "name": "Kassa", "date": "2026-08-05"}
        self.assertEqual(_external_id(item, "stock_selection"), _external_id(dict(item), "stock_selection"))

    def test_изменение_суммы_не_создаёт_новую_запись(self):
        # Раньше ключ считался по всему содержимому: пересчитанный остаток
        # превращал ту же строку в новую и порождал дубликат.
        base = {"_ibox_filial_id": "F1", "name": "Kassa", "date": "2026-08-05"}
        first = _external_id({**base, "amount": "100", "status": "new"}, "stock_selection")
        second = _external_id({**base, "amount": "250", "status": "closed"}, "stock_selection")
        self.assertEqual(first, second)

    def test_разные_записи_остаются_разными(self):
        first = _external_id({"_ibox_filial_id": "F1", "name": "Kassa"}, "stock_selection")
        second = _external_id({"_ibox_filial_id": "F2", "name": "Kassa"}, "stock_selection")
        third = _external_id({"_ibox_filial_id": "F1", "name": "Sklad"}, "stock_selection")
        self.assertNotEqual(first, second)
        self.assertNotEqual(first, third)

    def test_разные_разделы_не_смешиваются(self):
        item = {"_ibox_filial_id": "F1", "name": "Kassa"}
        self.assertNotEqual(_external_id(item, "stock_selection"), _external_id(item, "salary"))

    def test_совсем_безымянная_запись_всё_равно_получает_ключ(self):
        value = _external_id({"amount": "100"}, "salary")
        self.assertTrue(value.startswith("salary:"))
        self.assertLessEqual(len(value), 180)

    def test_ключ_не_длиннее_допустимого(self):
        item = {"name": "x" * 500, "_ibox_filial_id": "y" * 500}
        self.assertLessEqual(len(_external_id(item, "purchases")), 180)


if __name__ == "__main__":
    unittest.main()
