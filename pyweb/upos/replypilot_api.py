"""Внешний API для AI-агента ReplyPilot.

Агент отвечает клиентам в мессенджерах и для этого должен знать три вещи:
что мы продаём и по какой цене, кто этот клиент и что у него с покупками,
и куда записать заявку по итогу разговора. Здесь ровно эти три запроса.

Отличие от остальных `/api/*` маршрутов программы: там за запросом стоит
живой сотрудник с cookie-сессией и CSRF-токеном, а тут — чужая программа,
у которой ни того, ни другого нет. Поэтому вход по ключу в заголовке
`X-ReplyPilot-Key`, а ключ выдаёт карточка интеграции в настройках. Ключ
привязан к рабочему пространству, и всё, что отдаётся дальше, ограничено
этим пространством — ровно как сессия сотрудника ограничивает его.

Маршруты только читают учётные данные и заводят заявку. Ничего не
списывают, не проводят и не меняют в кассе: у AI-агента нет причин иметь
такие права, а если ключ утечёт, цена ошибки должна остаться небольшой.
"""

from __future__ import annotations

import hmac
import logging
import re
import secrets
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from upos.db import session_scope
from upos.db_models import Counterparty, Product, SaleDocument, WorkspaceSetting
from upos.messenger_store import save_lead

logger = logging.getLogger("upos.replypilot")

INTEGRATION_KEY = "replypilot"

# Ограничение выдачи каталога за один запрос. Агенту нужен обзор
# ассортимента, а не выгрузка базы: если товаров больше, он запросит
# следующую страницу через offset.
PRODUCTS_PAGE_LIMIT = 500

# Сколько последних продаж показывать в карточке клиента. Разговор в
# мессенджере опирается на недавнее ("а где мой заказ?"), а не на всю
# историю за годы.
CLIENT_PURCHASES_LIMIT = 10


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _digits(value: Any) -> str:
    """Оставляет от телефона только цифры.

    Один и тот же номер приходит как +998 90 123-45-67, 998901234567 и
    901234567 — сравнивать их как строки бесполезно.
    """
    return re.sub(r"\D+", "", str(value or ""))


def _phone_matches(left: str, right: str) -> bool:
    """Сравнивает телефоны по последним девяти цифрам.

    Девять — длина узбекского номера без кода страны. Так 998901234567 и
    901234567 совпадут, а два разных абонента — нет.
    """
    a, b = _digits(left), _digits(right)
    if not a or not b:
        return False
    return a[-9:] == b[-9:]


def find_workspace_by_api_key(api_key: str) -> tuple[str, dict[str, Any]] | None:
    """Ищет рабочее пространство по ключу интеграции.

    Сравнение через `compare_digest`, а не `==`: обычное сравнение строк
    выходит из цикла на первом несовпавшем символе, и по времени ответа
    ключ можно подобрать посимвольно.
    """
    key = str(api_key or "").strip()
    if not key:
        return None
    with session_scope() as session:
        rows = session.execute(select(WorkspaceSetting)).scalars().all()
        for row in rows:
            data = row.data if isinstance(row.data, dict) else {}
            config = (data.get("integrations") or {}).get(INTEGRATION_KEY)
            config = dict(config) if isinstance(config, dict) else {}
            stored = str(config.get("api_key") or "").strip()
            if stored and hmac.compare_digest(stored, key):
                return str(row.workspace_owner_id), config
    return None


def generate_api_key() -> str:
    """Новый ключ интеграции. Показывается в карточке настроек."""
    return f"rp_{secrets.token_urlsafe(32)}"


def register_replypilot_api(
    app,
    *,
    product_data: Callable[[Product], dict[str, Any]],
    calculated_product_price: Callable[..., tuple[str, str]],
    workspace_price_types: Callable[[str], list[dict[str, Any]]],
    workspace_usd_rate: Callable[[str], Decimal],
    sales_rollup_all: Callable[[Any, str], tuple[Any, ...]],
    json_object: Callable[[Any], dict[str, Any]],
    sales_decimal: Callable[[Any], Decimal],
) -> None:
    """Подключает маршруты агента к приложению.

    Расчёт цены, разбор карточки товара и свод долгов живут внутри
    `main.py` и завязаны на его замыкание — они передаются сюда как
    функции, а не переписываются заново. Второй экземпляр той же логики
    неизбежно разойдётся с первым, и цена в мессенджере перестанет
    сходиться с ценой на экране продавца.
    """

    def _auth(request: Request) -> tuple[str, dict[str, Any]] | JSONResponse:
        header = (
            request.headers.get("X-ReplyPilot-Key")
            or request.headers.get("x-replypilot-key")
            or ""
        )
        if not header:
            authorization = request.headers.get("Authorization") or ""
            if authorization.lower().startswith("bearer "):
                header = authorization[len("bearer "):]
        found = find_workspace_by_api_key(header)
        if found is None:
            # Ключ в ответ не попадает и в лог тоже: по логам не должно
            # быть видно, какой именно ключ пробовали.
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return found

    def _selected_price_type(
        workspace_owner_id: str, config: dict[str, Any]
    ) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        price_types = [
            pt for pt in workspace_price_types(workspace_owner_id)
            if pt.get("is_active") and pt.get("is_for_sales")
        ]
        if not price_types:
            return None, []
        wanted = str(config.get("price_type_id") or "").strip()
        if wanted:
            for candidate in price_types:
                if str(candidate.get("id") or "") == wanted:
                    return candidate, price_types
        return price_types[0], price_types

    @app.get("/api/replypilot/v1/ping", name="replypilot_ping")
    def replypilot_ping(request: Request):
        """Проверка ключа. ReplyPilot зовёт это при сохранении настроек."""
        auth = _auth(request)
        if isinstance(auth, JSONResponse):
            return auth
        workspace_owner_id, config = auth
        price_type, price_types = _selected_price_type(workspace_owner_id, config)
        return JSONResponse(
            {
                "ok": True,
                "workspace_owner_id": workspace_owner_id,
                "price_type": (price_type or {}).get("name") or "",
                "price_types_available": len(price_types),
                "share_client_history": bool(config.get("share_client_history", True)),
                "create_leads": bool(config.get("create_leads", True)),
                "server_time": _now_iso(),
            }
        )

    @app.get("/api/replypilot/v1/products", name="replypilot_products")
    def replypilot_products(request: Request, limit: int = 200, offset: int = 0):
        """Каталог с ценой и остатком — то, чем агент отвечает на «сколько стоит».

        Цена считается по тому же прайсу, что видит продавец, и приводится
        к одной валюте. Товары без цены отдаются с пустым `price`: пусть
        агент честно скажет «уточню», а не назовёт ноль.
        """
        auth = _auth(request)
        if isinstance(auth, JSONResponse):
            return auth
        workspace_owner_id, config = auth

        try:
            page_limit = max(1, min(int(limit), PRODUCTS_PAGE_LIMIT))
            page_offset = max(0, int(offset))
        except (TypeError, ValueError):
            return JSONResponse({"error": "bad_paging"}, status_code=400)

        price_type, price_types = _selected_price_type(workspace_owner_id, config)
        usd_rate = workspace_usd_rate(workspace_owner_id)

        items: list[dict[str, Any]] = []
        with session_scope() as session:
            rows = session.execute(
                select(Product)
                .where(Product.workspace_owner_id == workspace_owner_id)
                .order_by(Product.name)
                .limit(page_limit)
                .offset(page_offset)
            ).scalars()
            for row in rows:
                item = product_data(row)
                price_text, price_currency = ("", "UZS")
                if price_type is not None:
                    price_text, price_currency = calculated_product_price(
                        item, price_type, price_types, usd_rate
                    )
                stocks = [
                    {
                        "warehouse": str(stock.get("warehouse") or "").strip(),
                        "quantity": str(sales_decimal(stock.get("quantity"))),
                    }
                    for stock in (item.get("stocks") or [])
                    if isinstance(stock, dict)
                ]
                total = sum(
                    (sales_decimal(stock.get("quantity")) for stock in (item.get("stocks") or []) if isinstance(stock, dict)),
                    Decimal("0"),
                )
                items.append(
                    {
                        "id": str(row.id),
                        "name": str(row.name or ""),
                        "sku": str(row.sku or ""),
                        "barcode": str(row.barcode or ""),
                        "description": str(item.get("description") or ""),
                        "unit": str(item.get("unit") or ""),
                        "price": price_text,
                        "currency": price_currency or "UZS",
                        "stock_total": str(total),
                        "in_stock": total > 0,
                        "stocks": stocks,
                        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                    }
                )

        return JSONResponse(
            {
                "products": items,
                "count": len(items),
                "limit": page_limit,
                "offset": page_offset,
                "price_type": (price_type or {}).get("name") or "",
            }
        )

    @app.get("/api/replypilot/v1/clients/lookup", name="replypilot_client_lookup")
    def replypilot_client_lookup(request: Request, phone: str = "", name: str = ""):
        """Карточка клиента по телефону — «где мой заказ» и «сколько я должен».

        Отдаётся только когда в настройках включено `share_client_history`:
        долг и покупки — чувствительные данные, и отправлять их в чат
        должно быть осознанным решением владельца, а не побочным эффектом
        подключения агента.
        """
        auth = _auth(request)
        if isinstance(auth, JSONResponse):
            return auth
        workspace_owner_id, config = auth

        if not bool(config.get("share_client_history", True)):
            return JSONResponse({"found": False, "disabled": True})

        wanted_phone = str(phone or "").strip()
        wanted_name = str(name or "").strip().lower()
        if not wanted_phone and not wanted_name:
            return JSONResponse({"error": "phone_or_name_required"}, status_code=400)

        with session_scope() as session:
            client: Counterparty | None = None
            rows = session.execute(
                select(Counterparty).where(
                    Counterparty.workspace_owner_id == workspace_owner_id
                )
            ).scalars()
            for row in rows:
                if wanted_phone and _phone_matches(row.phone or "", wanted_phone):
                    client = row
                    break
                if wanted_name and str(row.name or "").strip().lower() == wanted_name:
                    client = row
                    break
            if client is None:
                return JSONResponse({"found": False})

            (
                balance_by_id,
                balance_by_name,
                last_date_by_id,
                last_date_by_name,
                balance_currency_by_id,
                balance_currency_by_name,
            ) = sales_rollup_all(session, workspace_owner_id)

            client_id = str(client.id)
            lowered = str(client.name or "").strip().lower()
            debt = balance_by_id.get(client_id)
            if debt is None:
                debt = balance_by_name.get(lowered, Decimal("0"))
            debt_by_currency = balance_currency_by_id.get(client_id) or balance_currency_by_name.get(lowered) or {}
            last_date = last_date_by_id.get(client_id) or last_date_by_name.get(lowered) or ""

            purchases: list[dict[str, Any]] = []
            sales = session.execute(
                select(SaleDocument)
                .where(
                    SaleDocument.workspace_owner_id == workspace_owner_id,
                    SaleDocument.counterparty_id == client_id,
                )
                .order_by(SaleDocument.created_at.desc())
                .limit(CLIENT_PURCHASES_LIMIT)
            ).scalars()
            for sale in sales:
                data = json_object(sale.data)
                purchases.append(
                    {
                        "number": str(sale.number or ""),
                        "date": str(data.get("date") or ""),
                        "amount": str(sales_decimal(sale.amount)),
                        "paid": str(sales_decimal(data.get("paid_amount"))),
                        "currency": str(sale.currency or "UZS"),
                        "status": str(data.get("workflow_status") or data.get("status") or ""),
                        "doc_type": str(data.get("doc_type") or "sale"),
                    }
                )

            return JSONResponse(
                {
                    "found": True,
                    "client": {
                        "id": client_id,
                        "name": str(client.name or ""),
                        "phone": str(client.phone or ""),
                    },
                    "debt_total": str(debt),
                    "debt_by_currency": {k: str(v) for k, v in debt_by_currency.items()},
                    "last_purchase_date": last_date,
                    "purchases": purchases,
                }
            )

    @app.post("/api/replypilot/v1/leads", name="replypilot_create_lead")
    async def replypilot_create_lead(request: Request):
        """Заявка по итогу разговора: клиент в базе и карточка в CRM.

        `external_id` обязателен и служит защитой от дублей — агент может
        прислать одну и ту же заявку повторно (сеть, перезапуск воркера),
        и `save_lead` вернёт существующую запись вместо второй такой же.
        """
        auth = _auth(request)
        if isinstance(auth, JSONResponse):
            return auth
        workspace_owner_id, config = auth

        if not bool(config.get("create_leads", True)):
            return JSONResponse({"error": "leads_disabled"}, status_code=403)

        try:
            payload = await request.json()
        except Exception:
            return JSONResponse({"error": "bad_json"}, status_code=400)
        if not isinstance(payload, dict):
            return JSONResponse({"error": "bad_json"}, status_code=400)

        external_id = str(payload.get("external_id") or "").strip()
        if not external_id:
            # Без него пропадает защита от повторной доставки — лучше
            # отказать, чем завести дубль в CRM.
            return JSONResponse({"error": "external_id_required"}, status_code=400)

        channel = str(payload.get("channel") or "instagram").strip() or "instagram"
        lead = {
            "external_id": external_id,
            "full_name": str(payload.get("full_name") or "").strip(),
            "phone": str(payload.get("phone") or "").strip(),
            "email": str(payload.get("email") or "").strip(),
            "form_name": "ReplyPilot AI",
            "campaign_name": str(payload.get("summary") or "").strip(),
        }

        try:
            result = save_lead(workspace_owner_id, lead, channel=channel)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception:
            logger.exception("replypilot: не удалось сохранить заявку")
            return JSONResponse({"error": "save_failed"}, status_code=500)

        return JSONResponse(
            {
                "ok": True,
                "lead_id": str(result.get("id") or ""),
                "counterparty_id": str(result.get("counterparty_id") or ""),
                "duplicate": bool(result.get("duplicate")),
            }
        )
