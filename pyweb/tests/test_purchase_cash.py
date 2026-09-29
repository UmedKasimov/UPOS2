from __future__ import annotations

import unittest
from decimal import Decimal

from upos.purchase_cash import build_purchase_cash_transaction_payloads


class PurchaseCashPayloadTests(unittest.TestCase):
    def test_payment_is_expense_from_selected_account(self) -> None:
        rows = build_purchase_cash_transaction_payloads(
            purchase_id="purchase-1",
            purchase_number="P-101",
            data={
                "supplier": "Поставщик",
                "payment_lines": [
                    {
                        "amount": "125000",
                        "currency": "UZS",
                        "account_id": "cash-1",
                        "account": "Наличные",
                        "type": "Наличные",
                    }
                ],
            },
            currency="UZS",
            created_at="2026-08-10T12:00:00",
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["type"], "expense")
        self.assertEqual(rows[0]["category"], "Закупка товара")
        self.assertEqual(rows[0]["amount"], Decimal("125000"))
        self.assertEqual(rows[0]["from_account_id"], "cash-1")
        self.assertEqual(rows[0]["data"]["purchase_document_id"], "purchase-1")

    def test_additional_expense_gets_own_cash_journal_row(self) -> None:
        rows = build_purchase_cash_transaction_payloads(
            purchase_id="purchase-2",
            purchase_number="P-102",
            data={
                "supplier": "Поставщик",
                "payment_lines": [],
                "extra_expenses": [{"name": "Доставка", "amount": "50000"}],
            },
            currency="UZS",
            created_at="2026-08-10T12:00:00",
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["category"], "Доставка")
        self.assertEqual(rows[0]["data"]["purchase_entry_kind"], "extra_expense")
        self.assertNotIn("from_account_id", rows[0])

    def test_additional_expense_payment_can_be_split_between_accounts(self) -> None:
        rows = build_purchase_cash_transaction_payloads(
            purchase_id="purchase-2",
            purchase_number="P-102",
            data={
                "supplier": "Поставщик",
                "payment_lines": [],
                "extra_expenses": [{"name": "Доставка", "amount": "50000"}],
                "expense_payment_lines": [
                    {
                        "amount": "25000",
                        "currency": "UZS",
                        "account_id": "cash-1",
                        "account": "Наличные",
                    },
                    {
                        "amount": "2",
                        "currency": "USD",
                        "account_id": "card-1",
                        "account": "Карта",
                    },
                ],
            },
            currency="UZS",
            created_at="2026-08-10T12:00:00",
        )

        self.assertEqual(len(rows), 2)
        self.assertEqual([row["amount"] for row in rows], [Decimal("25000"), Decimal("2")])
        self.assertEqual([row["currency"] for row in rows], ["UZS", "USD"])
        self.assertEqual([row["from_account_id"] for row in rows], ["cash-1", "card-1"])
        self.assertTrue(all(row["category"] == "Дополнительные расходы" for row in rows))
        self.assertTrue(all(row["data"]["purchase_entry_kind"] == "extra_expense" for row in rows))

    def test_zero_rows_are_not_written_to_cash_journal(self) -> None:
        rows = build_purchase_cash_transaction_payloads(
            purchase_id="purchase-3",
            purchase_number="P-103",
            data={
                "payment_lines": [{"amount": "0", "account_id": "cash-1"}],
                "extra_expenses": [{"name": "Доставка", "amount": "-1"}],
            },
            currency="USD",
            created_at="2026-08-10T12:00:00",
        )

        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
