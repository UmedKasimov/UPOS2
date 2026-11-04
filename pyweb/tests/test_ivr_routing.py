import unittest

from upos.ivr_routing import validate_ivr_form


class IvrRoutingTests(unittest.TestCase):
    def test_internal_queue_external_and_fallback_are_canonical(self):
        rules = validate_ivr_form({
            "public_number": "+998 55 701 60 60", "greeting_text": "Нажмите 1, 2 или 3",
            "route_1_kind": "internal", "route_1_target": "210",
            "route_2_kind": "queue", "route_2_target": "210, 211, 210",
            "route_2_strategy": "round_robin", "route_2_wait": "45",
            "route_2_fallback": "+998 90 123 45 67",
            "route_2_chain": "220, 230, +998 93 456 78 90",
            "route_3_kind": "external", "route_3_target": "+998 91 234 56 78",
            "default_kind": "internal", "default_target": "210",
        })
        self.assertEqual(rules["public_number"], "+998557016060")
        self.assertEqual(rules["routes"][1]["target"], ["210", "211"])
        self.assertEqual(rules["routes"][1]["fallback"]["target"], "+998901234567")
        self.assertEqual([step["target"] for step in rules["routes"][1]["forward_chain"]],
                         ["220", "230", "+998934567890"])
        self.assertTrue(all(step["wait_seconds"] == 5 for step in rules["routes"][1]["forward_chain"]))
        self.assertEqual(rules["default_route"]["target"], "210")

    def test_rejects_loop_back_to_public_number(self):
        with self.assertRaisesRegex(ValueError, "тот же рабочий номер"):
            validate_ivr_form({"public_number": "+998557016060",
                               "route_1_kind": "external", "route_1_target": "+998557016060"})

    def test_rejects_invalid_queue_members(self):
        with self.assertRaisesRegex(ValueError, "Кнопка 1"):
            validate_ivr_form({"public_number": "+998557016060",
                               "route_1_kind": "queue", "route_1_target": "210, unknown"})

    def test_rejects_forwarding_loop_and_duplicate(self):
        with self.assertRaisesRegex(ValueError, "тот же рабочий номер"):
            validate_ivr_form({"public_number": "+998557016060",
                               "route_1_kind": "internal", "route_1_target": "210",
                               "route_1_chain": "220, +998557016060"})
        with self.assertRaisesRegex(ValueError, "повторяться"):
            validate_ivr_form({"public_number": "+998557016060",
                               "route_1_kind": "internal", "route_1_target": "210",
                               "route_1_chain": "220, 220"})


if __name__ == "__main__":
    unittest.main()
