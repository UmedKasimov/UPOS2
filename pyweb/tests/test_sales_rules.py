from __future__ import annotations

import unittest
from decimal import Decimal

from upos.sales_rules import (
    calculate_installment,
    calculate_sales_line,
    currency_amount,
    sales_default_status,
)


class SalesLineRulesTests(unittest.TestCase):
    def test_percent_discount_changes_saved_total(self) -> None:
        result = calculate_sales_line("2", "100", "discount", "10", "percent")
        self.assertEqual(result["subtotal"], Decimal("200"))
        self.assertEqual(result["adjustment"], Decimal("20"))
        self.assertEqual(result["total"], Decimal("180"))

    def test_fixed_markup_changes_saved_total(self) -> None:
        result = calculate_sales_line("3", "50", "markup", "25", "amount")
        self.assertEqual(result["total"], Decimal("175"))

    def test_discount_cannot_make_line_negative(self) -> None:
        result = calculate_sales_line("1", "100", "discount", "150", "amount")
        self.assertEqual(result["total"], Decimal("0"))

    def test_discount_over_one_hundred_percent_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "100%"):
            calculate_sales_line("1", "100", "discount", "101", "percent")


class InstallmentRulesTests(unittest.TestCase):
    def test_markup_is_part_of_final_document_amount(self) -> None:
        result = calculate_installment("1000", "3", "200", "10")
        self.assertEqual(result["rest"], Decimal("800"))
        self.assertEqual(result["profit"], Decimal("80.00"))
        self.assertEqual(result["total"], Decimal("1080.00"))
        self.assertEqual(result["monthly"], Decimal("293.33"))

    def test_initial_payment_is_clamped_to_base_total(self) -> None:
        result = calculate_installment("1000", "2", "1500", "20")
        self.assertEqual(result["initial"], Decimal("1000"))
        self.assertEqual(result["total"], Decimal("1000.00"))

    def test_uzs_installment_matches_whole_sum_display(self) -> None:
        result = calculate_installment("1005", "3", "0", "10", "UZS")
        self.assertEqual(result["profit"], Decimal("101"))
        self.assertEqual(result["total"], Decimal("1106"))
        self.assertEqual(result["monthly"], Decimal("369"))

    def test_fractional_month_count_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "срок"):
            calculate_installment("100", "1.5", "0", "0")


class CurrencyRulesTests(unittest.TestCase):
    def test_currency_rounding(self) -> None:
        self.assertEqual(currency_amount("10.5", "UZS"), Decimal("11"))
        self.assertEqual(currency_amount("10.555", "USD"), Decimal("10.56"))


class SalesDefaultStatusTests(unittest.TestCase):
    def test_sale_and_order_defaults_are_independent(self) -> None:
        settings = {
            "sales_default_statuses": {
                "sale": "completed",
                "order": "installation",
            }
        }
        self.assertEqual(sales_default_status(settings, "sale"), "completed")
        self.assertEqual(sales_default_status(settings, "order"), "installation")

    def test_invalid_or_archived_default_falls_back_to_new(self) -> None:
        settings = {"sales_default_statuses": {"sale": "archived", "order": "unknown"}}
        self.assertEqual(sales_default_status(settings, "sale"), "new")
        self.assertEqual(sales_default_status(settings, "order"), "new")


if __name__ == "__main__":
    unittest.main()
