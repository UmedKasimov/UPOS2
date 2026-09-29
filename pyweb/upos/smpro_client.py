from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import httpx


class SMProError(RuntimeError):
    pass


@dataclass(frozen=True)
class SMProResource:
    key: str
    path: str
    directory: str = ""
    requires_filial: bool = True


RESOURCES: dict[str, tuple[SMProResource, ...]] = {
    "directories": (
        SMProResource("filials", "api/integration/core/directory/filial", requires_filial=False),
        SMProResource("clients", "api/integration/core/directory", "outlet_client"),
        SMProResource("contracts", "api/integration/core/directory", "outlet_contract"),
        SMProResource("offices", "api/integration/core/directory", "filial_office"),
        SMProResource("users", "api/integration/core/directory", "user_user"),
        SMProResource("teams", "api/integration/core/directory", "user_team"),
        SMProResource("currencies", "api/integration/core/directory", "core_currency"),
        SMProResource("warehouses", "api/integration/core/directory", "core_warehouse"),
        SMProResource("payment_types", "api/integration/core/directory", "core_payment_type"),
        SMProResource("tags", "api/integration/core/directory", "core_tag"),
    ),
    "products": (
        SMProResource("products", "api/integration/core/directory", "product_product"),
        SMProResource("price_types", "api/integration/core/directory", "product_price_type"),
        SMProResource("product_groups", "api/integration/core/directory", "product_group"),
        SMProResource("product_categories", "api/integration/core/directory", "product_category"),
        SMProResource("product_folders", "api/integration/core/directory", "product_folder_tree"),
    ),
    "stock": (
        SMProResource("stock_selection", "api/integration/document/stock/selection"),
    ),
    "sales": (
        SMProResource("orders", "api/integration/document/order/list"),
        SMProResource("shipments", "api/integration/document/shipment/list"),
        SMProResource("returns", "api/integration/document/return/list"),
    ),
    "purchases": (
        SMProResource("purchases", "api/integration/document/purchase/list"),
        SMProResource("supplier_returns", "api/integration/document/supplier-return/list"),
    ),
    "payments": (
        SMProResource("payments_received", "api/integration/document/payment-received/list"),
        SMProResource("payments_made", "api/integration/document/payment-made/list"),
        SMProResource(
            "payments_received_from_organizations",
            "api/integration/document/payment-received-from-organization/list",
        ),
        SMProResource(
            "payments_made_to_organizations",
            "api/integration/document/payment-made-to-organization/list",
        ),
        SMProResource("payment_transfers", "api/integration/document/payment-transfer/list"),
    ),
    "salary": (
        SMProResource("salary", "api/integration/document/salary/list"),
    ),
    "currency": (
        SMProResource(
            "currency_exchange",
            "api/integration/document/currency-exchange/list",
            requires_filial=False,
        ),
    ),
    "organization_shipments": (
        SMProResource(
            "shipments_received_from_organizations",
            "api/integration/document/shipment-received-from-organization/list",
        ),
        SMProResource(
            "shipments_sent_to_organizations",
            "api/integration/document/shipment-sent-to-organization/list",
        ),
    ),
}

DEFAULT_MODULES = tuple(RESOURCES)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _base_url(value: Any) -> str:
    base = _clean(value)
    if not base:
        raise SMProError("Укажите адрес API IBOX / SMPro")
    if not base.startswith(("http://", "https://")):
        base = "https://" + base
    return base.rstrip("/") + "/"


def _dict_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return _dict_items(payload)
    if not isinstance(payload, dict):
        return []
    for key in ("data", "items", "results", "rows", "list"):
        value = payload.get(key)
        if isinstance(value, list):
            return _dict_items(value)
        if isinstance(value, dict):
            nested = _extract_items(value)
            if nested:
                return nested
    return []


def _pagination(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    for key in ("meta", "pagination", "paginate"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    data = payload.get("data")
    if isinstance(data, dict):
        return _pagination(data)
    return payload


def _ascii_identifier(value: Any) -> str:
    if isinstance(value, bool) or isinstance(value, (dict, list)):
        return ""
    text = _clean(value)
    if not text or len(text) > 180 or "\r" in text or "\n" in text:
        return ""
    try:
        text.encode("ascii")
    except UnicodeEncodeError:
        return ""
    return text


def extract_filial_identifiers(filials: list[dict[str, Any]]) -> list[str]:
    identifiers: list[str] = []
    for filial in filials:
        fields = {str(key).lower(): value for key, value in filial.items()}
        for key in ("id", "filial_id", "uuid", "guid", "code", "value"):
            identifier = _ascii_identifier(fields.get(key))
            if identifier:
                if identifier not in identifiers:
                    identifiers.append(identifier)
                break
    return identifiers


def extract_filial_identifier(filials: list[dict[str, Any]]) -> str:
    identifiers = extract_filial_identifiers(filials)
    return identifiers[0] if identifiers else ""


def _header_value(value: Any, *, label: str) -> str:
    text = _clean(value)
    if not text:
        return ""
    try:
        text.encode("ascii")
    except UnicodeEncodeError as exc:
        raise SMProError(f"{label} содержит недопустимые символы") from exc
    if "\r" in text or "\n" in text:
        raise SMProError(f"{label} содержит недопустимые символы")
    return text


class SMProClient:
    def __init__(self, config: dict[str, Any], *, transport: httpx.BaseTransport | None = None):
        self.base_url = _base_url(config.get("api_url"))
        self.api_key = _clean(config.get("api_key"))
        self.filial_id = _clean(config.get("filial_id") or config.get("terminal_id"))
        raw_filial_ids = config.get("filial_ids")
        configured_filial_ids = raw_filial_ids if isinstance(raw_filial_ids, list) else []
        self.filial_ids = [
            identifier
            for identifier in dict.fromkeys(
                _ascii_identifier(item)
                for item in configured_filial_ids + ([self.filial_id] if self.filial_id else [])
            )
            if identifier
        ]
        try:
            self.timeout = max(5.0, min(float(config.get("timeout") or 30), 120.0))
        except (TypeError, ValueError):
            self.timeout = 30.0
        if not self.api_key:
            raise SMProError("Укажите API-ключ IBOX / SMPro")
        self._transport = transport
        self.warnings: list[dict[str, str]] = []

    def _headers(self, *, require_filial: bool, filial_id: str = "") -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {_header_value(self.api_key, label='API-ключ IBOX')}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if require_filial:
            selected_filial_id = _clean(filial_id or self.filial_id)
            if not selected_filial_id:
                raise SMProError("Выберите филиал SMPro")
            headers["Filial-Id"] = _header_value(
                selected_filial_id,
                label="Технический ID филиала IBOX",
            )
        return headers

    def _request(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        require_filial: bool = True,
        filial_id: str = "",
    ) -> Any:
        url = urljoin(self.base_url, path.lstrip("/"))
        try:
            with httpx.Client(timeout=self.timeout, follow_redirects=True, transport=self._transport) as client:
                response = client.get(
                    url,
                    params=params,
                    headers=self._headers(
                        require_filial=require_filial,
                        filial_id=filial_id,
                    ),
                )
        except httpx.HTTPError as exc:
            raise SMProError(f"SMPro недоступен: {exc}") from exc
        if response.status_code >= 400:
            detail = ""
            try:
                payload = response.json()
                if isinstance(payload, dict):
                    detail = _clean(payload.get("message") or payload.get("error"))
            except ValueError:
                detail = ""
            suffix = f": {detail}" if detail else ""
            raise SMProError(f"SMPro вернул ошибку {response.status_code}{suffix}")
        try:
            return response.json()
        except ValueError as exc:
            raise SMProError("SMPro вернул ответ не в формате JSON") from exc

    def test_connection(self) -> dict[str, Any]:
        payload = self._request(
            "api/integration/core/directory/filial",
            params={"per_page": 100, "page": 1},
            require_filial=False,
        )
        filials = _extract_items(payload)
        filial_ids = extract_filial_identifiers(filials)
        return {
            "ok": True,
            "filials": filials,
            "filial_count": len(filials),
            "filial_id": filial_ids[0] if filial_ids else "",
            "filial_ids": filial_ids,
        }

    def fetch_resource(
        self,
        resource: SMProResource,
        *,
        full_history: bool,
        since: str = "",
        filial_id: str = "",
        extra_params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        # SMPro document endpoints reject values above 100 with HTTP 422.
        per_page = 100
        page = 1
        result: list[dict[str, Any]] = []
        while page <= 10000:
            params: dict[str, Any] = {"per_page": per_page, "page": page}
            if resource.directory:
                params["data"] = resource.directory
            if resource.key == "stock_selection":
                params["search_by[]"] = "name"
            if extra_params:
                params.update(extra_params)
            if not full_history and since:
                params["period[from]"] = since[:10]
            payload = self._request(
                resource.path,
                params=params,
                require_filial=resource.requires_filial,
                filial_id=filial_id,
            )
            items = _extract_items(payload)
            result.extend(items)
            meta = _pagination(payload)
            last_page = meta.get("last_page") or meta.get("lastPage")
            current_page = meta.get("current_page") or meta.get("currentPage") or page
            next_url = meta.get("next_page_url") or meta.get("nextPageUrl")
            try:
                if last_page is not None:
                    if int(current_page) >= int(last_page):
                        break
                    page += 1
                    continue
            except (TypeError, ValueError):
                pass
            if not items or (len(items) < per_page and not next_url):
                break
            page += 1
        return result

    def fetch_modules(
        self,
        modules: list[str] | tuple[str, ...],
        *,
        full_history: bool,
        since: str = "",
        context: dict[str, list[dict[str, Any]]] | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        """Забирает указанные модули.

        Остатки перебираются по типам цен, а типы цен приходят в модуле
        товаров. Когда модули запрашиваются по одному, ранее полученные типы
        цен передаются через context.
        """
        entities: dict[str, list[dict[str, Any]]] = {}
        for module in modules:
            for resource in RESOURCES.get(module, ()):
                filial_ids = self.filial_ids if resource.requires_filial else [""]
                if resource.requires_filial and not filial_ids:
                    filial_ids = [self.filial_id]
                merged: list[dict[str, Any]] = []
                for filial_id in filial_ids:
                    variants: list[tuple[str, str]] = [("", "")]
                    if resource.key == "stock_selection":
                        known_price_types = entities.get("price_types") or (context or {}).get("price_types") or []
                        remote_price_types = [
                            item
                            for item in known_price_types
                            if not filial_id
                            or str(item.get("_ibox_filial_id") or "") == filial_id
                        ]
                        variants = [
                            (str(item.get("id") or ""), str(item.get("name") or ""))
                            for item in remote_price_types
                            if str(item.get("id") or "").strip()
                        ] or [("", "")]
                    for price_type_id, price_type_name in variants:
                        try:
                            rows = self.fetch_resource(
                                resource,
                                full_history=full_history,
                                since=since,
                                filial_id=filial_id,
                                extra_params=(
                                    {"price_type_id": price_type_id}
                                    if price_type_id
                                    else None
                                ),
                            )
                            for row in rows:
                                normalized = dict(row)
                                if filial_id:
                                    normalized.setdefault("_ibox_filial_id", filial_id)
                                if price_type_id:
                                    normalized["_ibox_price_type_id"] = price_type_id
                                    normalized["_ibox_price_type_name"] = price_type_name
                                merged.append(normalized)
                        except SMProError as exc:
                            self.warnings.append(
                                {
                                    "resource": resource.key,
                                    "filial_id": filial_id,
                                    "error": str(exc),
                                }
                            )
                entities[resource.key] = merged
        return entities
