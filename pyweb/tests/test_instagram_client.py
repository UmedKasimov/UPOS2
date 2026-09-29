"""Разбор событий Instagram: подпись, переписка и заявки из рекламы."""

from __future__ import annotations

import hashlib
import hmac
import json
import unittest

from upos.instagram_client import (
    parse_lead_fields,
    parse_webhook,
    signature_valid,
)


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class SignatureTests(unittest.TestCase):
    def test_правильная_подпись_принимается(self):
        body = json.dumps({"object": "instagram"}).encode("utf-8")
        self.assertTrue(signature_valid("секрет", body, sign("секрет", body)))

    def test_подпись_без_приставки_тоже_принимается(self):
        body = b'{"a":1}'
        digest = sign("секрет", body)[len("sha256="):]
        self.assertTrue(signature_valid("секрет", body, digest))

    def test_чужая_подпись_отклоняется(self):
        body = b'{"a":1}'
        self.assertFalse(signature_valid("секрет", body, sign("другой", body)))

    def test_изменённое_тело_отклоняется(self):
        signature = sign("секрет", b'{"a":1}')
        self.assertFalse(signature_valid("секрет", b'{"a":2}', signature))

    def test_без_секрета_или_подписи_отклоняем(self):
        body = b'{"a":1}'
        self.assertFalse(signature_valid("", body, sign("секрет", body)))
        self.assertFalse(signature_valid("секрет", body, ""))


class WebhookParseTests(unittest.TestCase):
    def входящее(self):
        return {
            "object": "instagram",
            "entry": [
                {
                    "id": "17841400000000000",
                    "messaging": [
                        {
                            "sender": {"id": "IGSID-CLIENT"},
                            "recipient": {"id": "17841400000000000"},
                            "timestamp": 1754500000000,
                            "message": {"mid": "mid.111", "text": "Здравствуйте, сколько стоит?"},
                        }
                    ],
                }
            ],
        }

    def test_входящее_сообщение_разбирается(self):
        parsed = parse_webhook(self.входящее())
        self.assertEqual(len(parsed["messages"]), 1)
        item = parsed["messages"][0]
        self.assertEqual(item["direction"], "in")
        self.assertEqual(item["contact_id"], "IGSID-CLIENT")
        self.assertEqual(item["external_id"], "mid.111")
        self.assertEqual(item["text"], "Здравствуйте, сколько стоит?")
        self.assertEqual(item["account_id"], "17841400000000000")

    def test_наш_ответ_из_другого_приложения_помечается_исходящим(self):
        body = self.входящее()
        body["entry"][0]["messaging"][0]["sender"] = {"id": "17841400000000000"}
        body["entry"][0]["messaging"][0]["recipient"] = {"id": "IGSID-CLIENT"}
        item = parse_webhook(body)["messages"][0]
        self.assertEqual(item["direction"], "out")
        self.assertEqual(item["contact_id"], "IGSID-CLIENT")

    def test_эхо_нашего_сообщения_тоже_исходящее(self):
        body = self.входящее()
        body["entry"][0]["messaging"][0]["message"]["is_echo"] = True
        self.assertEqual(parse_webhook(body)["messages"][0]["direction"], "out")

    def test_удалённое_сообщение_пропускается(self):
        body = self.входящее()
        body["entry"][0]["messaging"][0]["message"]["is_deleted"] = True
        self.assertEqual(parse_webhook(body)["messages"], [])

    def test_вложение_без_текста_сохраняется(self):
        body = self.входящее()
        message = body["entry"][0]["messaging"][0]["message"]
        message.pop("text")
        message["attachments"] = [{"type": "image", "payload": {"url": "https://example.test/a.jpg"}}]
        item = parse_webhook(body)["messages"][0]
        self.assertEqual(item["text"], "")
        self.assertEqual(len(item["attachments"]), 1)

    def test_заявка_из_рекламы_разбирается(self):
        body = {
            "object": "page",
            "entry": [
                {
                    "id": "PAGE-1",
                    "changes": [
                        {
                            "field": "leadgen",
                            "value": {
                                "leadgen_id": "LEAD-1",
                                "form_id": "FORM-1",
                                "ad_id": "AD-1",
                                "page_id": "PAGE-1",
                                "created_time": 1754500000,
                            },
                        }
                    ],
                }
            ],
        }
        parsed = parse_webhook(body)
        self.assertEqual(len(parsed["leads"]), 1)
        self.assertEqual(parsed["leads"][0]["leadgen_id"], "LEAD-1")
        self.assertEqual(parsed["leads"][0]["account_id"], "PAGE-1")

    def test_посторонние_события_не_ломают_разбор(self):
        parsed = parse_webhook({"entry": [{"id": "1", "changes": [{"field": "feed", "value": {}}]}]})
        self.assertEqual(parsed["messages"], [])
        self.assertEqual(parsed["leads"], [])

    def test_пустое_тело_не_ломает_разбор(self):
        self.assertEqual(parse_webhook({}), {"messages": [], "leads": []})


class LeadFieldsTests(unittest.TestCase):
    def test_имя_телефон_и_почта_вытаскиваются(self):
        lead = parse_lead_fields(
            {
                "id": "LEAD-1",
                "form_id": "FORM-1",
                "campaign_name": "Летняя реклама",
                "created_time": "2026-08-06T10:00:00+0000",
                "field_data": [
                    {"name": "full_name", "values": ["Алишер Каримов"]},
                    {"name": "phone_number", "values": ["+998 90 111 22 33"]},
                    {"name": "email", "values": ["a@example.test"]},
                    {"name": "какой_товар", "values": ["Кассовый аппарат"]},
                ],
            }
        )
        self.assertEqual(lead["full_name"], "Алишер Каримов")
        self.assertEqual(lead["phone"], "+998 90 111 22 33")
        self.assertEqual(lead["email"], "a@example.test")
        self.assertEqual(lead["campaign_name"], "Летняя реклама")
        self.assertEqual(lead["fields"]["какой_товар"], "Кассовый аппарат")

    def test_имя_собирается_из_двух_полей(self):
        lead = parse_lead_fields(
            {
                "id": "LEAD-2",
                "field_data": [
                    {"name": "first_name", "values": ["Алишер"]},
                    {"name": "last_name", "values": ["Каримов"]},
                ],
            }
        )
        self.assertEqual(lead["full_name"], "Алишер Каримов")

    def test_нестандартное_название_поля_телефона_узнаётся(self):
        lead = parse_lead_fields(
            {"id": "LEAD-3", "field_data": [{"name": "ваш_телефон", "values": ["901112233"]}]}
        )
        self.assertEqual(lead["phone"], "901112233")

    def test_пустая_форма_не_ломает_разбор(self):
        lead = parse_lead_fields({"id": "LEAD-4"})
        self.assertEqual(lead["external_id"], "LEAD-4")
        self.assertEqual(lead["full_name"], "")
        self.assertEqual(lead["fields"], {})


if __name__ == "__main__":
    unittest.main()
