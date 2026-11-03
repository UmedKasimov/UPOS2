"""Route one browser SIP account through the optional local media gateway.

The provider credentials remain in workspace settings for native SIP clients.
Only browser-facing responses are rewritten, after the gateway is activated.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse


def browser_gateway_account(account: dict) -> dict:
    if os.getenv("UPOS_GATEWAY_ENABLED") != "1":
        return account
    provider_id = os.getenv("UPOS_GATEWAY_PROVIDER_ID", "").strip()
    password = os.getenv("UPOS_GATEWAY_BROWSER_PASSWORD", "")
    host = os.getenv("UPOS_GATEWAY_BROWSER_HOST", "").strip()
    ws_url = os.getenv("UPOS_GATEWAY_BROWSER_WSS", "").strip()
    if not provider_id or str(account.get("provider_id") or account.get("id") or "") != provider_id:
        return account
    parsed = urlparse(ws_url)
    if not password or not host or parsed.scheme != "wss" or parsed.hostname != host:
        return account
    result = dict(account)
    result.update({
        "host": host,
        "server": host,
        "port": "443",
        "transport": "WSS",
        "ws_url": ws_url,
        "auth_id": str(account.get("extension") or ""),
        "password": password,
        "realm": "",
        "registrar_server": "",
    })
    return result
