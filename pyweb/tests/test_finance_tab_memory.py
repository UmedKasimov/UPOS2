from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class FinanceTabMemoryTests(unittest.TestCase):
    def test_finance_landing_does_not_clear_last_tab(self):
        script = (ROOT / "upos" / "static" / "workspace-section-reset.js").read_text(encoding="utf-8")

        self.assertIn('lastUrlKey: "upos.finance.lastUrl"', script)
        self.assertNotIn("localStorage.removeItem(route.lastUrlKey)", script)

    def test_finance_landing_restores_remembered_route_early(self):
        template = (ROOT / "upos" / "templates" / "home_finance.html").read_text(encoding="utf-8")

        self.assertIn('var key = "upos.finance.lastUrl"', template)
        self.assertIn('window.location.replace(target.pathname + target.search + target.hash)', template)
        self.assertIn('["/schet", "/kassa", "/earnings"]', template)

    def test_finance_home_and_close_are_explicit_actions(self):
        template = (ROOT / "upos" / "templates" / "_finance_module_tabs.html").read_text(encoding="utf-8")

        self.assertIn("?finance_home=1", template)
        self.assertIn("?finance_reset=1", template)


if __name__ == "__main__":
    unittest.main()
