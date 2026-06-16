from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import urljoin

import httpx


class GreenWhiteError(RuntimeError):
    pass


DEFAULT_PROJECT_CODE = "trade"
DEFAULT_SYNC_DAYS = 7
DEFAULT_EXPORT_TIMEOUT = 25.0
MAX_SMARTUP_DAY_RANGE = 7


@dataclass(frozen=True)
class SmartupExport:
    entity_type: str
    path: str
    result_key: str
    date_fields: tuple[str, str] | None = None
    body_defaults: dict[str, Any] | None = None


EXPORTS: tuple[SmartupExport, ...] = (
    SmartupExport(
        "finance_customer_payments",
        "b/trade/txs/tcs/cashin$export",
        "cashin",
        ("begin_cashin_date", "end_cashin_date"),
    ),
    SmartupExport(
        "finance_cash_operations",
        "b/anor/mxsx/mkcs/cash_operation$export",
        "cash_operation",
        ("begin_operation_date", "end_operation_date"),
    ),
    SmartupExport(
        "finance_bank_operations",
        "b/anor/mxsx/mkcs/bank_operation$export",
        "bank_operation",
        ("begin_operation_date", "end_operation_date"),
    ),
    SmartupExport("sales", "b/trade/txs/tdeal/order$export", "order", ("begin_deal_date", "end_deal_date")),
    SmartupExport(
        "sales_returns",
        "b/anor/mxsx/mdeal/return$export",
        "return",
        ("begin_return_date", "end_return_date"),
    ),
    SmartupExport(
        "purchases",
        "b/anor/mxsx/mkw/purchase$export",
        "purchase",
        ("begin_purchase_date", "end_purchase_date"),
    ),
    SmartupExport(
        "warehouse_receipts",
        "b/anor/mxsx/mkw/input$export",
        "input",
        ("begin_input_date", "end_input_date"),
    ),
    SmartupExport("inventory_balances", "b/anor/mxsx/mkw/balance$export", "balance", ("begin_date", "end_date")),
    SmartupExport("workspaces", "b/anor/mxsx/mrf/room$export", "room", ("begin_modified_on", "end_modified_on")),
    SmartupExport("products", "b/anor/mxsx/mr/inventory$export", "inventory", ("begin_modified_on", "end_modified_on")),
    SmartupExport(
        "customers",
        "b/anor/mxsx/mr/legal_person$export",
        "legal_person",
        ("begin_modified_on", "end_modified_on"),
        {"state": "A"},
    ),
    SmartupExport(
        "natural_persons",
        "b/anor/mxsx/mr/natural_person$export",
        "natural_person",
        ("begin_modified_on", "end_modified_on"),
    ),
)


def _base_url(raw: str) -> str:
    base = str(raw or "").strip()
    if not base:
        raise GreenWhiteError("Укажите Base URL сервера Smartup")
    if not base.startswith(("http://", "https://")):
        base = "https://" + base
    return base.rstrip("/") + "/"


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _smartup_date(value: date) -> str:
    return value.strftime("%d.%m.%Y")


def _parse_iso_date(value: str) -> date | None:
    raw = _clean(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _extract_items(payload: Any, key: str) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    val = payload.get(key)
    if isinstance(val, list):
        return [x for x in val if isinstance(x, dict)]
    if isinstance(val, dict):
        return [val]
    return []


class GreenWhiteClient:
    def __init__(self, cfg: dict[str, Any]):
        self.base_url = _base_url(_clean(cfg.get("base_url")))
        self.username = _clean(cfg.get("username"))
        self.password = _clean(cfg.get("password"))
        self.project_code = _clean(cfg.get("project_code")) or DEFAULT_PROJECT_CODE
        self.filial_id = _clean(cfg.get("filial_id") or cfg.get("organization_id"))
        self.filial_code = _clean(cfg.get("filial_code"))
        self.last_sync_at = _clean(cfg.get("last_sync_at"))
        self.sync_days = self._sync_days(cfg.get("sync_days"))
        self.export_timeout = self._export_timeout(cfg.get("export_timeout"))
        self.warnings: list[dict[str, str]] = []
        self._window = self._build_window()

        if not self.username or not self.password:
            raise GreenWhiteError("Укажите логин и пароль Smartup")

    def _sync_days(self, raw: Any) -> int:
        try:
            val = int(raw or DEFAULT_SYNC_DAYS)
        except (TypeError, ValueError):
            val = DEFAULT_SYNC_DAYS
        return max(1, min(val, MAX_SMARTUP_DAY_RANGE))

    def _export_timeout(self, raw: Any) -> float:
        try:
            val = float(raw or DEFAULT_EXPORT_TIMEOUT)
        except (TypeError, ValueError):
            val = DEFAULT_EXPORT_TIMEOUT
        return max(5.0, min(val, 60.0))

    def _build_window(self) -> tuple[date, date]:
        end = datetime.now().date()
        start = end - timedelta(days=self.sync_days - 1)
        last = _parse_iso_date(self.last_sync_at)
        if last is not None:
            start = max(start, last)
        if start > end:
            start = end
        return start, end

    def sync_window(self) -> dict[str, str]:
        start, end = self._window
        return {"begin_date": _smartup_date(start), "end_date": _smartup_date(end)}

    def _headers(self) -> dict[str, str]:
        raw = f"{self.username}:{self.password}".encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Authorization": "Basic " + base64.b64encode(raw).decode("ascii"),
            "project_code": self.project_code,
        }
        if self.filial_id:
            headers["filial_id"] = self.filial_id
        return headers

    def _url(self, path: str) -> str:
        return urljoin(self.base_url, path.lstrip("/"))

    def _request_json(self, client: httpx.Client, method: str, path: str, **kwargs: Any) -> Any:
        try:
            res = client.request(method, self._url(path), headers=self._headers(), **kwargs)
        except httpx.TimeoutException as exc:
            raise GreenWhiteError(f"Smartup не ответил вовремя: {path}") from exc
        except httpx.HTTPError as exc:
            raise GreenWhiteError(f"Не удалось подключиться к Smartup: {exc}") from exc

        if res.status_code in {401, 403}:
            raise GreenWhiteError("Smartup отклонил доступ. Проверьте логин, пароль, project_code и filial_id.")
        if res.status_code == 404:
            raise GreenWhiteError("not_found")
        if res.status_code >= 400:
            raise GreenWhiteError(f"Smartup вернул HTTP {res.status_code}: {res.text[:180]}")
        try:
            return res.json()
        except ValueError as exc:
            raise GreenWhiteError("Smartup вернул не JSON-ответ") from exc

    def _session(self, client: httpx.Client) -> dict[str, Any]:
        payload = self._request_json(client, "GET", "b/biruni/m:session")
        if not isinstance(payload, dict):
            raise GreenWhiteError("Smartup вернул некорректную сессию")
        return payload

    def _export_body(self, spec: SmartupExport) -> dict[str, Any]:
        body = dict(spec.body_defaults or {})
        if self.filial_code:
            body["filial_code"] = self.filial_code
        if spec.date_fields:
            start, end = self._window
            body[spec.date_fields[0]] = _smartup_date(start)
            body[spec.date_fields[1]] = _smartup_date(end)
        return body

    def _export(self, client: httpx.Client, spec: SmartupExport) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        payload = self._request_json(
            client,
            "POST",
            spec.path,
            json=self._export_body(spec),
            timeout=self.export_timeout,
        )
        items = _extract_items(payload, spec.result_key)
        limits = payload.get("limits") if isinstance(payload, dict) and isinstance(payload.get("limits"), dict) else None
        return items, limits

    def test_connection(self) -> dict[str, Any]:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            session = self._session(client)
        projects = session.get("projects") if isinstance(session.get("projects"), list) else []
        filials: list[dict[str, str]] = []
        for project in projects:
            if not isinstance(project, dict) or project.get("code") != self.project_code:
                continue
            for filial in project.get("filials") or []:
                if isinstance(filial, list) and len(filial) >= 2:
                    filials.append({"id": str(filial[0]), "name": str(filial[1])})

        return {
            "ok": True,
            "endpoint": "b/biruni/m:session",
            "project_code": self.project_code,
            "filial_id": self.filial_id,
            "available_filials": filials[:10],
            "company_id": session.get("company_id"),
            "company_name": session.get("company_name"),
        }

    def fetch_available_entities(self) -> dict[str, list[dict[str, Any]]]:
        found: dict[str, list[dict[str, Any]]] = {}
        limits: dict[str, Any] = {}

        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            session = self._session(client)
            found["system_session"] = [session]

            for spec in EXPORTS:
                try:
                    items, spec_limits = self._export(client, spec)
                except GreenWhiteError as exc:
                    if str(exc) == "not_found":
                        continue
                    if "отклонил доступ" in str(exc):
                        raise
                    self.warnings.append({"entity_type": spec.entity_type, "error": str(exc)})
                    continue
                found[spec.entity_type] = items
                if spec_limits:
                    limits[spec.entity_type] = spec_limits

        export_keys = set(found) - {"system_session"}
        if not export_keys:
            self.warnings.append({"entity_type": "exports", "error": "Не найден ни один доступный Smartup export endpoint"})
        if self.warnings:
            found["sync_warnings"] = [dict(x) for x in self.warnings]
        if limits:
            found["sync_limits"] = [{"entity_type": k, "limits": v} for k, v in limits.items()]
        return found
