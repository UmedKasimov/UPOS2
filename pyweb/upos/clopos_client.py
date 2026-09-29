from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx

from upos.integrations import CLOPOS_DEFAULT_API_BASE_URL


class CloposError(RuntimeError):
    pass


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _base_url(raw: Any) -> str:
    base = _clean(raw) or CLOPOS_DEFAULT_API_BASE_URL
    if not base.startswith(("http://", "https://")):
        base = "https://" + base
    base = base.rstrip("/")
    if base.endswith("/auth"):
        base = base[: -len("/auth")]
    return base + "/"


class CloposClient:
    def __init__(self, cfg: dict[str, Any]):
        self.base_url = _base_url(cfg.get("api_base_url"))
        self.client_id = _clean(cfg.get("client_id"))
        self.client_secret = _clean(cfg.get("client_secret"))
        self.brand = _clean(cfg.get("brand"))
        self.integrator_id = _clean(cfg.get("integrator_id"))
        if not all((self.client_id, self.client_secret, self.brand, self.integrator_id)):
            raise CloposError("Укажите Client ID, Client Secret, Brand и Integrator ID Clopos")

    def _url(self, path: str) -> str:
        return urljoin(self.base_url, path.lstrip("/"))

    def authenticate(self) -> dict[str, Any]:
        try:
            res = httpx.post(
                self._url("auth"),
                json={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "brand": self.brand,
                    "integrator_id": self.integrator_id,
                },
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=12.0,
            )
        except httpx.TimeoutException as exc:
            raise CloposError("Clopos не ответил вовремя") from exc
        except httpx.HTTPError as exc:
            raise CloposError(f"Не удалось подключиться к Clopos: {exc}") from exc

        if res.status_code in {401, 403}:
            raise CloposError("Clopos отклонил доступ. Проверьте client_id, client_secret, brand и integrator_id.")
        if res.status_code >= 400:
            raise CloposError(f"Clopos вернул HTTP {res.status_code}: {res.text[:180]}")
        try:
            payload = res.json()
        except ValueError as exc:
            raise CloposError("Clopos вернул не JSON-ответ") from exc
        if not isinstance(payload, dict):
            raise CloposError("Clopos вернул некорректный ответ")
        if not payload.get("token"):
            message = _clean(payload.get("message")) or "Clopos не вернул JWT-токен"
            raise CloposError(message)
        return payload


def test_clopos_connection(cfg: dict[str, Any]) -> dict[str, Any]:
    return CloposClient(cfg).authenticate()
