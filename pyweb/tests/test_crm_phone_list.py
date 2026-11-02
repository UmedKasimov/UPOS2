"""Check CRM phone validation and deduplication without starting the app."""

import ast
import re
import unittest
from pathlib import Path
from typing import Any


MAIN = Path(__file__).resolve().parents[1] / "upos" / "main.py"


def load_phone_list():
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    app_factory = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "create_app")
    helpers = [node for node in app_factory.body if isinstance(node, ast.FunctionDef) and node.name in {
        "_identity_phone", "_crm_phone_list", "_crm_phone_from_label"
    }]
    namespace = {"Any": Any, "re": re}
    exec(compile(ast.Module(body=helpers, type_ignores=[]), str(MAIN), "exec"), namespace)
    return namespace


class CrmPhoneListTests(unittest.TestCase):
    def test_keeps_distinct_phone_numbers_and_ignores_names(self):
        phones = load_phone_list()["_crm_phone_list"](
            "+998 90 123 45 67", "901234567", "Имя клиента", ["+998 91 765 43 21", "@telegram"]
        )
        self.assertEqual(phones, ["+998 90 123 45 67", "+998 91 765 43 21"])

    def test_limits_to_ten_and_rejects_short_or_long_numbers(self):
        phones = load_phone_list()["_crm_phone_list"](["123", "1" * 16] + [f"90{i:07d}" for i in range(11)])
        self.assertEqual(len(phones), 10)
        self.assertNotIn("123", phones)

    def test_phone_marked_in_legacy_client_name(self):
        from_label = load_phone_list()["_crm_phone_from_label"]
        self.assertEqual(from_label("📞 +998 97 939 66 55 👤 Abror"), "+998 97 939 66 55")
        self.assertEqual(from_label("+998 97-188-20-20 Достон ака"), "+998 97-188-20-20")
        self.assertEqual(from_label("2026-10-20 Сделка"), "")


if __name__ == "__main__":
    unittest.main()
