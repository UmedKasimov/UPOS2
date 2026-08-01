from __future__ import annotations

import unittest
from decimal import Decimal

from upos.earnings_store import service_bonus_for_order


class _FakeSale:
    workspace_owner_id = "ws1"
    data = {
        "lines": [
            {"product_id": "svc-1", "product": "Монтаж кондиционера", "total": "200000"},
            {"product_id": "prod-9", "product": "Кабель", "total": "50000"},
            {"product_id": "svc-2", "product": "Настройка", "price": "100000", "quantity": "2"},
        ]
    }


class _FakeSession:
    def get(self, model, key):
        return _FakeSale()


class _FakeOrder:
    workspace_owner_id = "ws1"
    sale_document_id = "sale-1"


class ServiceBonusTests(unittest.TestCase):
    def test_bonus_only_for_attached_services(self) -> None:
        bonus, details = service_bonus_for_order(
            _FakeSession(),
            _FakeOrder(),
            {"svc-1": "10", "svc-2": "5"},
        )
        # 10% от 200 000 + 5% от 200 000 (100 000 × 2)
        self.assertEqual(bonus, Decimal("30000.00"))
        self.assertEqual(len(details), 2)
        self.assertEqual(details[0]["product"], "Монтаж кондиционера")
        self.assertEqual(details[1]["bonus"], "10000.00")

    def test_no_rules_no_bonus(self) -> None:
        bonus, details = service_bonus_for_order(_FakeSession(), _FakeOrder(), {})
        self.assertEqual(bonus, Decimal("0.00"))
        self.assertEqual(details, [])


if __name__ == "__main__":
    unittest.main()
