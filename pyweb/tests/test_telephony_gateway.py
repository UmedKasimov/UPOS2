import os
import unittest
from unittest.mock import patch

from upos.telephony_gateway import browser_gateway_account


class BrowserGatewayAccountTests(unittest.TestCase):
    def test_only_selected_account_is_rewritten(self):
        original = {
            "id": "selected", "provider_id": "selected", "extension": "210",
            "host": "call.mysputnik.uz", "ws_url": "wss://call.mysputnik.uz:8089/ws",
            "password": "provider-secret", "auth_id": "210",
        }
        settings = {
            "UPOS_GATEWAY_ENABLED": "1",
            "UPOS_GATEWAY_PROVIDER_ID": "selected",
            "UPOS_GATEWAY_BROWSER_HOST": "app.u-pos.uz",
            "UPOS_GATEWAY_BROWSER_WSS": "wss://app.u-pos.uz/sip/ws",
            "UPOS_GATEWAY_BROWSER_PASSWORD": "browser-secret",
        }
        with patch.dict(os.environ, settings):
            changed = browser_gateway_account(original)
            self.assertEqual(changed["host"], "app.u-pos.uz")
            self.assertEqual(changed["password"], "browser-secret")
            self.assertEqual(changed["ws_url"], "wss://app.u-pos.uz/sip/ws")
            self.assertEqual(original["host"], "call.mysputnik.uz")
            self.assertEqual(original["password"], "provider-secret")
            other = browser_gateway_account({**original, "id": "other", "provider_id": "other"})
            self.assertEqual(other["host"], "call.mysputnik.uz")


    def test_incomplete_or_insecure_config_is_ignored(self):
        account = {"id": "selected", "extension": "210", "host": "call.mysputnik.uz"}
        settings = {
            "UPOS_GATEWAY_ENABLED": "1", "UPOS_GATEWAY_PROVIDER_ID": "selected",
            "UPOS_GATEWAY_BROWSER_HOST": "app.u-pos.uz",
            "UPOS_GATEWAY_BROWSER_WSS": "ws://app.u-pos.uz/sip/ws",
            "UPOS_GATEWAY_BROWSER_PASSWORD": "browser-secret",
        }
        with patch.dict(os.environ, settings):
            self.assertIs(browser_gateway_account(account), account)


if __name__ == "__main__":
    unittest.main()
