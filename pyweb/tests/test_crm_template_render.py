"""Catch CRM template scope errors before deploying the page."""

import unittest
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, meta


TEMPLATES = Path(__file__).resolve().parents[1] / "upos" / "templates"


class CrmTemplateRenderTests(unittest.TestCase):
    def test_crm_renders_with_and_without_deals(self):
        env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=True)
        env.globals["url_for"] = lambda endpoint, **kwargs: f"/{endpoint}"
        source = (TEMPLATES / "_business_module_crm.html").read_text(encoding="utf-8")
        context = {name: {} for name in meta.find_undeclared_variables(env.parse(source))}
        context.update(module={"heading": "CRM"}, csrf_token="test")
        template = env.get_template("_business_module_crm.html")

        context["crm_kanban_columns"] = []
        self.assertIn("CRM", template.render(**context))

        row = {
            "id": 1,
            "title": "Test deal",
            "client": "Test client",
            "first_contact_employees": ["Alice", "Bob"],
            "edit_payload": {},
            "tags": [],
            "activity_log": [],
            "related_documents": [],
            "messenger_threads": [],
            "kanban_amount": "100",
            "currency": "UZS",
        }
        context["crm_kanban_columns"] = [
            {"id": 1, "title": "Leads", "hint": "", "outcome": "", "records": [row], "total": "100"}
        ]
        html = template.render(**context)
        self.assertIn("Первый контакт: Alice, Bob", html)

    def test_detail_employee_picker_renders_in_card(self):
        env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=True)
        env.globals["url_for"] = lambda endpoint, **kwargs: f"/{endpoint}"
        source = (TEMPLATES / "_business_module_crm.html").read_text(encoding="utf-8")
        context = {name: {} for name in meta.find_undeclared_variables(env.parse(source))}
        context.update(module={"heading": "CRM"}, csrf_token="test", crm_kanban_columns=[])
        context["crm_options"] = {"contact_employees": ["Амир Акбаралиев"]}
        html = env.get_template("_business_module_crm.html").render(**context)
        self.assertIn('data-crm-card-detail-employees-form hidden', html)
        self.assertIn('name="first_contact_employees" value="Амир Акбаралиев"', html)
        self.assertIn('data-crm-employees-url-template="/crm/__record__/contact-employees"', html)

    def test_program_filter_keeps_selected_client_program(self):
        env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=True)
        env.globals["url_for"] = lambda endpoint, **kwargs: f"/{endpoint}"
        source = (TEMPLATES / "_business_module_crm.html").read_text(encoding="utf-8")
        context = {name: {} for name in meta.find_undeclared_variables(env.parse(source))}
        context.update(module={"heading": "CRM"}, csrf_token="test", crm_kanban_columns=[])
        context["crm_options"] = {"programs": ["YESPOS", "BILLZ"]}
        context["crm_filters"] = {"program": "BILLZ", "status": "all", "priority": "all"}
        html = env.get_template("_business_module_crm.html").render(**context)
        self.assertIn('name="program"', html)
        self.assertIn('value="BILLZ" selected', html)
        self.assertIn("Фильтры · активны", html)


if __name__ == "__main__":
    unittest.main()
