"""Обращения к Instagram через Graph API.

Разговоры и заявки приходят к нам веб-хуком от Meta, а отправка ответа и
дочитывание данных заявки идут обычными запросами к graph.facebook.com.
Здесь только сеть и разбор ответов: ничего не пишется в базу.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

logger = logging.getLogger("upos.instagram")

GRAPH_VERSION = "v21.0"
GRAPH_BASE_URL = f"https://graph.facebook.com/{GRAPH_VERSION}/"
REQUEST_TIMEOUT = 20.0


class InstagramError(RuntimeError):
    """Instagram отказал в запросе или недоступен."""


def signature_valid(app_secret: str, raw_body: bytes, header_value: str) -> bool:
    """Проверяет подпись веб-хука.

    Meta подписывает тело запроса секретом приложения. Без этой проверки
    в программу мог бы написать кто угодно, зная адрес веб-хука.
    """
    secret = str(app_secret or "").strip()
    provided = str(header_value or "").strip()
    if not secret or not provided:
        return False
    if provided.startswith("sha256="):
        provided = provided[len("sha256="):]
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


def _request(
    method: str,
    path: str,
    *,
    token: str,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    transport: Any = None,
) -> dict[str, Any]:
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover - httpx есть в зависимостях
        raise InstagramError("Не установлен пакет httpx") from exc

    query = dict(params or {})
    query["access_token"] = str(token or "").strip()
    if not query["access_token"]:
        raise InstagramError("Не указан токен доступа Instagram")

    url = GRAPH_BASE_URL + str(path or "").lstrip("/")
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT, transport=transport) as client:
            response = client.request(method, url, params=query, json=json_body)
    except httpx.HTTPError as exc:
        raise InstagramError(f"Instagram недоступен: {exc}") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 400:
        detail = ""
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                detail = str(error.get("message") or "").strip()
        suffix = f": {detail}" if detail else ""
        raise InstagramError(f"Instagram вернул ошибку {response.status_code}{suffix}")
    return payload if isinstance(payload, dict) else {}


def send_message(
    *,
    token: str,
    ig_user_id: str,
    recipient_id: str,
    text: str,
    transport: Any = None,
) -> dict[str, Any]:
    """Отправляет текстовый ответ собеседнику."""
    body = str(text or "").strip()
    if not body:
        raise InstagramError("Пустое сообщение отправить нельзя")
    account = str(ig_user_id or "").strip()
    if not account:
        raise InstagramError("Не указан аккаунт Instagram")
    recipient = str(recipient_id or "").strip()
    if not recipient:
        raise InstagramError("Не указан получатель")
    return _request(
        "POST",
        f"{account}/messages",
        token=token,
        json_body={"recipient": {"id": recipient}, "message": {"text": body}},
        transport=transport,
    )


def fetch_profile(*, token: str, igsid: str, transport: Any = None) -> dict[str, str]:
    """Имя и аватар собеседника — Instagram отдаёт их отдельным запросом."""
    person = str(igsid or "").strip()
    if not person:
        return {}
    try:
        payload = _request(
            "GET",
            person,
            token=token,
            params={"fields": "name,username,profile_pic"},
            transport=transport,
        )
    except InstagramError as exc:
        # Профиль — украшение переписки: без него работать можно.
        logger.info("[instagram] профиль %s недоступен: %s", person, exc)
        return {}
    return {
        "name": str(payload.get("name") or "").strip(),
        "username": str(payload.get("username") or "").strip(),
        "avatar_url": str(payload.get("profile_pic") or "").strip(),
    }


def fetch_lead(*, token: str, leadgen_id: str, transport: Any = None) -> dict[str, Any]:
    """Забирает поля заявки: в веб-хуке приходит только её номер."""
    lead_id = str(leadgen_id or "").strip()
    if not lead_id:
        raise InstagramError("Не указан номер заявки")
    return _request(
        "GET",
        lead_id,
        token=token,
        params={"fields": "id,created_time,ad_id,ad_name,form_id,campaign_name,field_data"},
        transport=transport,
    )


PHONE_KEYS = ("phone_number", "phone", "telefon", "telephone", "mobile", "нომერ", "телефон")
EMAIL_KEYS = ("email", "e_mail", "почта")
NAME_KEYS = ("full_name", "name", "имя", "фио")


def parse_lead_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """Раскладывает поля формы заявки на имя, телефон, почту и остальное.

    Названия полей задаёт тот, кто собирал форму, поэтому известные ключи
    узнаём по списку, а всё прочее складываем как есть.
    """
    raw = payload.get("field_data") if isinstance(payload, dict) else None
    fields: dict[str, str] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            key = str(item.get("name") or "").strip().lower()
            values = item.get("values")
            value = ""
            if isinstance(values, list) and values:
                value = str(values[0] or "").strip()
            elif values is not None:
                value = str(values or "").strip()
            if key:
                fields[key] = value

    def pick(keys: tuple[str, ...]) -> str:
        for key in keys:
            if fields.get(key):
                return fields[key]
        for key, value in fields.items():
            if any(part in key for part in keys) and value:
                return value
        return ""

    # Сначала целое имя, затем имя с фамилией по отдельности: если брать
    # first_name сразу, фамилия из формы теряется.
    full_name = ""
    for key in NAME_KEYS:
        if fields.get(key):
            full_name = fields[key]
            break
    if not full_name:
        first = fields.get("first_name") or ""
        last = fields.get("last_name") or ""
        full_name = " ".join(part for part in (first, last) if part).strip()
    if not full_name:
        full_name = pick(NAME_KEYS)

    return {
        "external_id": str(payload.get("id") or "").strip(),
        "form_id": str(payload.get("form_id") or "").strip(),
        "form_name": str(payload.get("form_name") or "").strip(),
        "ad_id": str(payload.get("ad_id") or "").strip(),
        "campaign_name": str(payload.get("campaign_name") or payload.get("ad_name") or "").strip(),
        "full_name": full_name,
        "phone": pick(PHONE_KEYS),
        "email": pick(EMAIL_KEYS),
        "fields": fields,
        "created_time": str(payload.get("created_time") or "").strip(),
    }


def parse_webhook(body: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Разбирает тело веб-хука на сообщения и заявки.

    Meta присылает события пачкой и в разных обёртках: переписка лежит в
    messaging, заявки — в changes с полем leadgen.
    """
    messages: list[dict[str, Any]] = []
    leads: list[dict[str, Any]] = []
    entries = body.get("entry") if isinstance(body, dict) else None
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict):
            continue
        account_id = str(entry.get("id") or "").strip()
        for item in entry.get("messaging") if isinstance(entry.get("messaging"), list) else []:
            if not isinstance(item, dict):
                continue
            message = item.get("message")
            if not isinstance(message, dict) or message.get("is_deleted"):
                continue
            sender = item.get("sender") if isinstance(item.get("sender"), dict) else {}
            recipient = item.get("recipient") if isinstance(item.get("recipient"), dict) else {}
            sender_id = str(sender.get("id") or "").strip()
            recipient_id = str(recipient.get("id") or "").strip()
            # Эхо приходит на наши же ответы, отправленные из другого места.
            outgoing = bool(message.get("is_echo")) or (account_id and sender_id == account_id)
            attachments = message.get("attachments")
            messages.append(
                {
                    "account_id": account_id,
                    "external_id": str(message.get("mid") or "").strip(),
                    "direction": "out" if outgoing else "in",
                    "contact_id": recipient_id if outgoing else sender_id,
                    "text": str(message.get("text") or "").strip(),
                    "timestamp": item.get("timestamp"),
                    "attachments": attachments if isinstance(attachments, list) else [],
                }
            )
        for change in entry.get("changes") if isinstance(entry.get("changes"), list) else []:
            if not isinstance(change, dict) or str(change.get("field") or "") != "leadgen":
                continue
            value = change.get("value") if isinstance(change.get("value"), dict) else {}
            leadgen_id = str(value.get("leadgen_id") or "").strip()
            if not leadgen_id:
                continue
            leads.append(
                {
                    "account_id": account_id,
                    "leadgen_id": leadgen_id,
                    "form_id": str(value.get("form_id") or "").strip(),
                    "ad_id": str(value.get("ad_id") or "").strip(),
                    "page_id": str(value.get("page_id") or "").strip(),
                    "created_time": value.get("created_time"),
                }
            )
    return {"messages": messages, "leads": leads}
