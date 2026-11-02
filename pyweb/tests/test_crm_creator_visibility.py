"""Check creator matching without starting the database-backed ASGI app."""

import ast
import unittest
from pathlib import Path
from typing import Any


MAIN = Path(__file__).resolve().parents[1] / "upos" / "main.py"


def load_visibility_helpers():
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    app_factory = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "create_app")
    helpers = [node for node in app_factory.body if isinstance(node, ast.FunctionDef) and node.name in {
        "_crm_can_view_all_deals", "_crm_created_by_user"
    }]
    namespace = {
        "Any": Any,
        "_session_user_id": lambda user: str(user.get("user_id") or ""),
        "_employee_role_key": lambda user: str(user.get("employee_role_key") or ""),
    }
    exec(compile(ast.Module(body=helpers, type_ignores=[]), str(MAIN), "exec"), namespace)
    return namespace


class CrmCreatorVisibilityTests(unittest.TestCase):
    def test_saved_creator_id_takes_precedence_over_name(self):
        matches = load_visibility_helpers()["_crm_created_by_user"]
        card = {"created_by_user_id": "alice-id", "created_by_name": "Bob"}
        self.assertTrue(matches(card, {"user_id": "alice-id", "name": "Alice"}))
        self.assertFalse(matches(card, {"user_id": "bob-id", "name": "Bob"}))

    def test_legacy_creation_event_and_unknown_creator(self):
        matches = load_visibility_helpers()["_crm_created_by_user"]
        user = {"user_id": "alice-id", "name": "Алиса"}
        card = {"activity_log": [{"action": "Карточка создана", "actor": "АЛИСА"}]}
        self.assertTrue(matches(card, user))
        self.assertFalse(matches(card, {"user_id": "bob-id", "name": "Боб"}))
        self.assertFalse(matches({"activity_log": []}, user))

    def test_only_administrator_sees_everyones_deals(self):
        can_view_all = load_visibility_helpers()["_crm_can_view_all_deals"]
        self.assertTrue(can_view_all({"is_employee": True, "employee_role_key": "administrator"}))
        self.assertFalse(can_view_all({"is_employee": True, "employee_role_key": "general_director"}))
        self.assertFalse(can_view_all({"role": "user", "is_employee": False}))


if __name__ == "__main__":
    unittest.main()
