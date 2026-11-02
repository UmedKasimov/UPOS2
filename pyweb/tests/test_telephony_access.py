from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from upos.telephony_access import sip_provider_assigned_to


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


if __name__ == "__main__":
    unittest.main()
