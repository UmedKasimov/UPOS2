from __future__ import annotations

import sys
import types
import unittest
from datetime import timezone


db_stub = types.ModuleType("upos.db")
db_stub.session_scope = lambda: None
models_stub = types.ModuleType("upos.db_models")
for model_name in (
    "Counterparty",
    "InstallationEvent",
    "InstallationOrder",
    "InstallationPushSubscription",
    "InstallationTask",
    "InstallationTaskTemplate",
    "Role",
    "SaleDocument",
    "User",
):
    setattr(models_stub, model_name, type(model_name, (), {}))
users_store_stub = types.ModuleType("upos.users_store")
users_store_stub.list_employees_safe = lambda workspace_owner_id, organization_id="": []
sys.modules["upos.db"] = db_stub
sys.modules["upos.db_models"] = models_stub
sys.modules["upos.users_store"] = users_store_stub

from upos.installations_store import (
    InstallationError,
    _is_installer_profile,
    _parse_scheduled_at,
    can_transition,
)


class InstallationsStoreTests(unittest.TestCase):
    def test_installer_role_is_accepted(self) -> None:
        self.assertTrue(_is_installer_profile(role_key="installer"))
        self.assertTrue(_is_installer_profile(permissions={"installations": True}))
        self.assertTrue(_is_installer_profile(position="Старший установщик"))

    def test_unrelated_employee_role_is_rejected(self) -> None:
        self.assertFalse(
            _is_installer_profile(
                role_key="cashier",
                role_name="Кассир",
                position="Продавец",
                permissions={"sales": True},
            )
        )

    def test_local_tashkent_time_is_stored_as_utc(self) -> None:
        parsed = _parse_scheduled_at("2026-07-30T15:30", "Asia/Tashkent")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.tzinfo, timezone.utc)
        self.assertEqual(parsed.isoformat(), "2026-07-30T10:30:00+00:00")

    def test_invalid_status_transition_is_rejected(self) -> None:
        self.assertFalse(can_transition("pending", "completed"))

    def test_valid_status_transition_is_allowed(self) -> None:
        self.assertTrue(can_transition("pending", "accepted"))

    def test_invalid_schedule_is_rejected(self) -> None:
        with self.assertRaisesRegex(InstallationError, "корректные дату и время"):
            _parse_scheduled_at("завтра вечером")


if __name__ == "__main__":
    unittest.main()
