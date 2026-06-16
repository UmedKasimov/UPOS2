"""Small Telegram Bot API client used by notification workflows."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/{method}"
DEFAULT_ALLOWED_UPDATES = ["message", "my_chat_member", "callback_query"]
_MAX_MESSAGE_LEN = 4096

_client: httpx.Client | None = None


class TelegramApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def _http_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=httpx.Timeout(10.0, connect=4.0))
    return _client


def _retry_after_seconds(payload: Any, status_code: int | None) -> float | None:
    if status_code == 429:
        if isinstance(payload, dict):
            params = payload.get("parameters")
            if isinstance(params, dict) and params.get("retry_after") is not None:
                try:
                    return float(params["retry_after"])
                except (TypeError, ValueError):
                    pass
        return 2.0
    desc = ""
    if isinstance(payload, dict):
        desc = str(payload.get("description") or "").lower()
    if "retry after" in desc or "too many requests" in desc:
        return 2.0
    return None


def _api_call(
    token: str,
    method: str,
    *,
    json_body: dict[str, Any] | None = None,
    timeout: float = 10.0,
    max_attempts: int = 3,
) -> Any:
    clean_token = (token or "").strip()
    if not clean_token:
        raise TelegramApiError("Telegram token is empty")
    url = TELEGRAM_API.format(token=clean_token, method=method)
    last_exc: TelegramApiError | None = None
    for attempt in range(max(1, max_attempts)):
        try:
            resp = _http_client().post(url, json=json_body or {}, timeout=timeout)
        except httpx.TimeoutException as exc:
            last_exc = TelegramApiError("Telegram API timeout")
            if attempt + 1 >= max_attempts:
                raise last_exc from exc
            time.sleep(0.5 * (attempt + 1))
            continue
        except httpx.HTTPError as exc:
            raise TelegramApiError(f"Telegram network error: {exc}") from exc
        try:
            data = resp.json()
        except Exception as exc:
            raise TelegramApiError(f"Invalid Telegram response ({resp.status_code})") from exc
        if data.get("ok"):
            return data.get("result")
        desc = str(data.get("description") or "Telegram API error")
        wait = _retry_after_seconds(data, resp.status_code)
        err = TelegramApiError(desc, status_code=resp.status_code, payload=data)
        if wait is not None and attempt + 1 < max_attempts:
            logger.warning("[telegram] %s — retry in %.1fs (attempt %s)", desc, wait, attempt + 1)
            time.sleep(wait)
            last_exc = err
            continue
        raise err
    if last_exc:
        raise last_exc
    raise TelegramApiError("Telegram API error")


def get_me(token: str) -> dict[str, Any]:
    result = _api_call(token, "getMe", timeout=8.0)
    if not isinstance(result, dict):
        raise TelegramApiError("getMe returned unexpected payload")
    if not result.get("is_bot"):
        raise TelegramApiError("Token belongs to a non-bot account")
    return result


def set_webhook(
    token: str,
    url: str,
    *,
    secret_token: str | None = None,
    drop_pending_updates: bool = True,
    allowed_updates: list[str] | None = None,
) -> bool:
    body: dict[str, Any] = {
        "url": url,
        "drop_pending_updates": bool(drop_pending_updates),
        "allowed_updates": allowed_updates or DEFAULT_ALLOWED_UPDATES,
    }
    if secret_token:
        body["secret_token"] = secret_token
    result = _api_call(token, "setWebhook", json_body=body, timeout=8.0)
    return bool(result)


def delete_webhook(token: str) -> bool:
    result = _api_call(token, "deleteWebhook", json_body={"drop_pending_updates": False}, timeout=8.0)
    return bool(result)


def get_webhook_info(token: str) -> dict[str, Any]:
    result = _api_call(token, "getWebhookInfo", timeout=8.0)
    return result if isinstance(result, dict) else {}


def get_updates(
    token: str,
    *,
    offset: int | None = None,
    timeout_seconds: int = 0,
    allowed_updates: list[str] | None = None,
) -> list[dict[str, Any]]:
    body: dict[str, Any] = {
        "timeout": max(0, int(timeout_seconds)),
        "allowed_updates": allowed_updates or DEFAULT_ALLOWED_UPDATES,
    }
    if offset is not None:
        body["offset"] = int(offset)
    result = _api_call(token, "getUpdates", json_body=body, timeout=10.0, max_attempts=1)
    return result if isinstance(result, list) else []


def _split_text(text: str, limit: int = _MAX_MESSAGE_LEN) -> list[str]:
    raw = str(text or "")
    if len(raw) <= limit:
        return [raw] if raw else [""]
    parts: list[str] = []
    rest = raw
    while rest:
        if len(rest) <= limit:
            parts.append(rest)
            break
        cut = rest.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = limit
        parts.append(rest[:cut])
        rest = rest[cut:].lstrip("\n")
    return parts


def send_message(
    token: str,
    chat_id: int,
    text: str,
    *,
    parse_mode: str = "HTML",
    disable_web_page_preview: bool = True,
    reply_markup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    chunks = _split_text(text)
    last: dict[str, Any] = {}
    for idx, chunk in enumerate(chunks):
        body: dict[str, Any] = {
            "chat_id": int(chat_id),
            "text": chunk,
            "parse_mode": parse_mode,
            "disable_web_page_preview": disable_web_page_preview,
        }
        if reply_markup and idx == 0:
            body["reply_markup"] = reply_markup
        result = _api_call(token, "sendMessage", json_body=body, timeout=10.0)
        last = result if isinstance(result, dict) else {}
    return last


def get_chat_member(token: str, chat_id: int, user_id: int) -> dict[str, Any]:
    result = _api_call(
        token,
        "getChatMember",
        json_body={"chat_id": int(chat_id), "user_id": int(user_id)},
        timeout=8.0,
    )
    return result if isinstance(result, dict) else {}


def answer_callback_query(token: str, callback_query_id: str, text: str = "") -> bool:
    body: dict[str, Any] = {"callback_query_id": str(callback_query_id or "")}
    if text:
        body["text"] = str(text)[:200]
    result = _api_call(token, "answerCallbackQuery", json_body=body, timeout=3.0, max_attempts=1)
    return bool(result)


def edit_message_text(
    token: str,
    chat_id: int,
    message_id: int,
    text: str,
    *,
    parse_mode: str = "HTML",
    reply_markup: dict[str, Any] | None = None,
) -> bool:
    body: dict[str, Any] = {
        "chat_id": int(chat_id),
        "message_id": int(message_id),
        "text": str(text or "")[:_MAX_MESSAGE_LEN],
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        body["reply_markup"] = reply_markup
    result = _api_call(token, "editMessageText", json_body=body, timeout=8.0)
    return bool(result)


def edit_message_reply_markup(
    token: str,
    chat_id: int,
    message_id: int,
    reply_markup: dict[str, Any] | None = None,
) -> bool:
    body: dict[str, Any] = {
        "chat_id": int(chat_id),
        "message_id": int(message_id),
        "reply_markup": reply_markup if reply_markup is not None else {"inline_keyboard": []},
    }
    result = _api_call(token, "editMessageReplyMarkup", json_body=body, timeout=8.0)
    return bool(result)


def bot_is_admin(member: dict[str, Any]) -> bool:
    status = str(member.get("status") or "").lower()
    return status in {"administrator", "creator"}


def contact_request_keyboard() -> dict[str, Any]:
    return {
        "keyboard": [[{"text": "📱 Поделиться контактом", "request_contact": True}]],
        "resize_keyboard": True,
        "one_time_keyboard": True,
        "input_field_placeholder": "Отправьте контакт для заявки",
    }


def remove_keyboard() -> dict[str, Any]:
    return {"remove_keyboard": True}
