import unittest
from upos.telephony_browser_status import browser_status_event


class BrowserSipStatusTests(unittest.TestCase):
    def test_registration_failure_keeps_only_safe_fields(self):
        self.assertEqual(browser_status_event("registration_failed", "403", "Forbidden\nsecret"),
                         ("registration_failed", 403, "Forbidden secret"))

    def test_unknown_event_is_rejected(self):
        with self.assertRaises(ValueError):
            browser_status_event("send_password", 200, "")


if __name__ == "__main__":
    unittest.main()
