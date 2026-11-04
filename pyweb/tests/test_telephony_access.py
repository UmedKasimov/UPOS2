from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from upos.telephony_access import has_assigned_sip_line, sip_account_owner_id, sip_provider_assigned_to


class SipProviderAccessTests(unittest.TestCase):
    def test_assigned_extension_is_only_visible_to_its_employee(self):
        provider = {"employee_user_id": "employee-210", "employee": "Operator"}
        self.assertTrue(sip_provider_assigned_to(provider, "employee-210", "Operator"))
        self.assertFalse(sip_provider_assigned_to(provider, "employee-220", "Operator"))

    def test_unassigned_extension_is_hidden_from_employees(self):
        self.assertFalse(sip_provider_assigned_to({}, "employee-210", "Operator", "owner"))
        self.assertTrue(sip_provider_assigned_to({}, "owner", "Owner", "owner"))
        self.assertTrue(sip_provider_assigned_to({}, ""))

    def test_legacy_name_assignment_remains_available(self):
        provider = {"employee": "Амир Акбаралиев"}
        self.assertTrue(sip_provider_assigned_to(provider, "employee-210", "амир акбаралиев"))
        self.assertFalse(sip_provider_assigned_to(provider, "employee-220", "Другой сотрудник"))

    def test_phone_icon_requires_a_complete_line_assigned_to_this_account(self):
        providers = [
            {"host": "sip.example", "login": "210", "password": "secret", "employee_user_id": "employee-210"},
            {"host": "sip.example", "login": "220", "password": "secret", "employee_user_id": "employee-220"},
        ]
        self.assertTrue(has_assigned_sip_line(providers, "employee-210", "Operator", "owner"))
        self.assertFalse(has_assigned_sip_line(providers, "employee-230", "Operator", "owner"))
        self.assertFalse(has_assigned_sip_line([{"host": "sip.example", "login": "230", "employee_user_id": "employee-230"}], "employee-230", "Operator", "owner"))
        self.assertFalse(has_assigned_sip_line([], "employee-210", "Operator", "owner"))

    def test_unassigned_line_belongs_to_account_owner_not_organization_id(self):
        owner = {"user_id": "owner", "account_owner_id": "owner", "workspace_owner_id": "org"}
        employee = {"user_id": "employee-210", "account_owner_id": "owner", "workspace_owner_id": "org"}
        providers = [{"host": "sip.example", "login": "210", "password": "secret"}]
        self.assertEqual(sip_account_owner_id(owner, "org"), "owner")
        self.assertTrue(has_assigned_sip_line(providers, "owner", "Owner", sip_account_owner_id(owner, "org")))
        self.assertFalse(has_assigned_sip_line(providers, "employee-210", "Operator", sip_account_owner_id(employee, "org")))

    def test_old_owner_binding_to_organization_id_still_works_for_owner_only(self):
        provider = {"host": "sip.example", "login": "210", "password": "secret", "employee_user_id": "org"}
        self.assertTrue(has_assigned_sip_line([provider], "owner", "Owner", "owner", "org"))
        self.assertFalse(has_assigned_sip_line([provider], "employee-210", "Operator", "owner", "org"))


if __name__ == "__main__":
    unittest.main()
