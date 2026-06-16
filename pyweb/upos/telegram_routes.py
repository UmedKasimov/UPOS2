"""FastAPI routes for Telegram notifications."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import uuid
from typing import Any, Callable
from urllib.parse import urlparse

from fastapi import BackgroundTasks, Request
from fastapi.responses import JSONResponse, StreamingResponse

from upos.config import get_settings
from upos.csrf import csrf_matches_session
from upos.storage import valid_workspace_owner_id
from upos.telegram_client import (
    TelegramApiError,
    answer_callback_query,
    delete_webhook,
    get_me,
    get_updates,
    get_webhook_info,
    send_message as tg_send_message,
    set_webhook,
)
from upos.telegram_events import hub
from upos.telegram_handlers import handle_telegram_update
from upos.telegram_notifier import send_test_report
from upos.telegram_scheduler import ensure_scheduler_running, reschedule_workspace
from upos.telegram_store import (
    decide_subscriber,
    delete_chat,
    delete_subscriber,
    disconnect_bot,
    get_bot_config_with_token,
    get_telegram_dashboard,
    get_chat_by_row_id,
    list_active_configs,
    log_delivery,
    refresh_chats_admin_status,
    save_bot_config,
    save_notification_prefs,
    set_chat_enabled,
    set_config_error,
    status_summary,
)

logger = logging.getLogger(__name__)
_LOCAL_WEBHOOK_HOSTS = {"localhost", "127.0.0.1", "::1"}
_PLACEHOLDER_WEBHOOK_HOSTS = {"your-app.up.railway.app", "your-app.railway.app"}


def _public_base_from_value(raw: str | None) -> str:
    value = str(raw or "").strip().rstrip("/")
    if not value:
        return ""
    if "://" not in value:
        value = f"https://{value}"
    parsed = urlparse(value)
    host = (parsed.hostname or "").strip().lower()
    if parsed.scheme != "https" or not host:
        return ""
    if host in _LOCAL_WEBHOOK_HOSTS or host in _PLACEHOLDER_WEBHOOK_HOSTS:
        return ""
    return f"https://{parsed.netloc}".rstrip("/")


def _public_base_from_request(request: Request | None) -> str:
    if request is None:
        return ""
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc or "").strip()
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").split(",", 1)[0].strip()
    if not host:
        return ""
    return _public_base_from_value(f"{proto or 'https'}://{host}")


def _railway_public_base() -> str:
    for key in ("RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL"):
        base = _public_base_from_value(os.getenv(key))
        if base:
            return base
    return ""


def _webhook_base(request: Request | None = None) -> str:
    return (
        _public_base_from_value(get_settings().auth_url)
        or _public_base_from_request(request)
        or _railway_public_base()
    )


def _webhook_url(workspace_owner_id: str, secret: str, request: Request | None = None) -> str:
    return f"{_webhook_base(request)}/api/telegram/webhook/{workspace_owner_id}/{secret}"


def register_telegram_routes(
    app,
    *,
    treasury_workspace_owner: Callable[[Request], tuple[str | None, JSONResponse | None]],
    is_director: Callable[[dict | None], bool],
    can_manage_telegram: Callable[[dict | None], bool],
) -> None:
    def _validate_public_webhook_base(request: Request | None = None) -> str | None:
        base = _webhook_base(request)
        parsed = urlparse(base)
        if not base or parsed.scheme != "https":
            return "AUTH_URL должен быть публичным HTTPS URL, иначе Telegram не сможет доставлять webhook."
        if parsed.hostname in _LOCAL_WEBHOOK_HOSTS:
            return "AUTH_URL указывает на localhost. Для Telegram нужен публичный HTTPS адрес."
        return None

    def _csrf_or_error(request: Request) -> JSONResponse | None:
        token = request.headers.get("X-CSRF-Token") or request.headers.get("x-csrf-token") or ""
        if not csrf_matches_session(request, token):
            return JSONResponse({"error": "csrf"}, status_code=403)
        return None

    def _permissions(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
        user = request.session.get("user") or {}
        payload["can_manage"] = can_manage_telegram(user)
        payload["can_approve"] = is_director(user)
        return payload

    def _telegram_workspace_owner(request: Request) -> tuple[str | None, JSONResponse | None]:
        organization_id = str(request.query_params.get("organization_id") or "").strip()
        if organization_id and valid_workspace_owner_id(organization_id):
            return organization_id, None
        return treasury_workspace_owner(request)

    def _decorate_webhook_status(
        workspace_owner_id: str,
        webhook: dict[str, Any] | None,
        request: Request | None = None,
    ) -> dict[str, Any]:
        out = dict(webhook or {})
        cfg, _ = get_bot_config_with_token(workspace_owner_id)
        secret = str((cfg or {}).get("webhook_secret") or "").strip()
        if not secret:
            return out
        expected_url = _webhook_url(workspace_owner_id, secret, request)
        actual_url = str(out.get("url") or "").strip()
        out["expected_url"] = expected_url
        out["url_mismatch"] = bool(actual_url and actual_url.rstrip("/") != expected_url)
        return out

    def _apply_webhook_status(
        workspace_owner_id: str,
        payload: dict[str, Any],
        request: Request | None = None,
    ) -> dict[str, Any]:
        if isinstance(payload.get("webhook"), dict):
            payload["webhook"] = _decorate_webhook_status(workspace_owner_id, payload["webhook"], request)
        return payload

    def _collect_pending_updates(workspace_owner_id: str, token: str) -> int:
        updates = get_updates(token, timeout_seconds=0)
        max_update_id: int | None = None
        count = 0
        for update in updates:
            if not isinstance(update, dict):
                continue
            try:
                handle_telegram_update(workspace_owner_id, update)
                count += 1
            except Exception:
                logger.exception("[telegram] pending update handling failed wid=%s", workspace_owner_id)
            try:
                update_id = int(update.get("update_id"))
                max_update_id = update_id if max_update_id is None else max(max_update_id, update_id)
            except (TypeError, ValueError):
                pass
        if max_update_id is not None:
            try:
                get_updates(token, offset=max_update_id + 1, timeout_seconds=0)
            except TelegramApiError as exc:
                logger.warning("[telegram] pending update confirm failed wid=%s: %s", workspace_owner_id, exc)
        return count

    def _repair_webhook(
        workspace_owner_id: str,
        token: str,
        secret: str,
        request: Request | None = None,
    ) -> dict[str, Any]:
        webhook_url = _webhook_url(workspace_owner_id, secret, request)
        pending_updates = 0
        try:
            delete_webhook(token)
            pending_updates = _collect_pending_updates(workspace_owner_id, token)
        except TelegramApiError as exc:
            logger.warning("[telegram] pending update collection failed wid=%s: %s", workspace_owner_id, exc)
        set_webhook(token, webhook_url, secret_token=secret, drop_pending_updates=False)
        try:
            info = get_webhook_info(token)
        except TelegramApiError:
            info = {"url": webhook_url}
        webhook = {
            "url": info.get("url") or webhook_url,
            "pending_update_count": info.get("pending_update_count"),
            "repaired": True,
            "pending_updates_processed": pending_updates,
        }
        return _decorate_webhook_status(workspace_owner_id, webhook)

    @app.post("/api/telegram/webhook/{workspace_owner_id}/{webhook_secret}")
    async def telegram_webhook(
        workspace_owner_id: str,
        webhook_secret: str,
        request: Request,
        background_tasks: BackgroundTasks,
    ):
        wid = (workspace_owner_id or "").strip()
        if not valid_workspace_owner_id(wid):
            return JSONResponse({"ok": True})
        cfg, token = get_bot_config_with_token(wid)
        if not cfg or not token:
            return JSONResponse({"ok": True})
        expected_secret = str(cfg.get("webhook_secret") or "").strip()
        if expected_secret != (webhook_secret or "").strip():
            return JSONResponse({"error": "forbidden"}, status_code=403)
        header_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") or ""
        # Older webhook registrations may not send Telegram's secret header.
        # The URL still contains the per-workspace secret, so accept missing
        # headers while rejecting an explicitly wrong header.
        if header_secret and header_secret != expected_secret:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"ok": True})
        update = body if isinstance(body, dict) else {}
        update_id = update.get("update_id")
        logger.info("[telegram] webhook wid=%s update_id=%s", wid, update_id)
        callback_query = update.get("callback_query") if isinstance(update.get("callback_query"), dict) else None
        if callback_query:
            callback_id = str(callback_query.get("id") or "")
            callback_data = str(callback_query.get("data") or "")
            if callback_id and callback_data.startswith("upos:lim:"):
                try:
                    answer_callback_query(token, callback_id, "Проверяем операцию...")
                    callback_query["_upos_preanswered"] = True
                except Exception as exc:
                    logger.warning("[telegram] callback pre-answer failed wid=%s: %s", wid, exc)
                handle_telegram_update(wid, update)
                return JSONResponse({"ok": True})
        background_tasks.add_task(handle_telegram_update, wid, update)
        return JSONResponse({"ok": True})

    @app.get("/api/telegram/snapshot")
    def api_telegram_snapshot(request: Request):
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        return {"ok": True, **_permissions(request, _apply_webhook_status(oid, get_telegram_dashboard(oid), request))}

    @app.get("/api/telegram/status")
    def api_telegram_status(request: Request):
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        summary = status_summary(oid)
        if request.query_params.get("webhook") == "1":
            token = get_bot_config_with_token(oid)[1]
            if token:
                try:
                    info = get_webhook_info(token)
                    summary["webhook"] = {
                        "url": info.get("url"),
                        "pending_update_count": info.get("pending_update_count"),
                        "last_error_message": info.get("last_error_message"),
                    }
                except TelegramApiError as exc:
                    summary["webhook"] = {"error": str(exc)}
        return {"ok": True, **_permissions(request, _apply_webhook_status(oid, summary, request))}

    @app.post("/api/telegram/webhook/repair")
    def api_telegram_webhook_repair(request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        base_error = _validate_public_webhook_base(request)
        if base_error:
            return JSONResponse({"error": base_error}, status_code=400)
        cfg, token = get_bot_config_with_token(oid)
        if not cfg or not token:
            return JSONResponse({"error": "not_connected"}, status_code=400)
        secret = str(cfg.get("webhook_secret") or "").strip()
        if not secret:
            return JSONResponse({"error": "webhook_secret_missing"}, status_code=400)
        try:
            webhook = _repair_webhook(oid, token, secret, request)
        except TelegramApiError as exc:
            set_config_error(oid, str(exc))
            return JSONResponse({"error": f"webhook: {exc}"}, status_code=400)
        set_config_error(oid, "")
        chats = refresh_chats_admin_status(oid, token, int(cfg.get("bot_id") or 0))
        return {
            "ok": True,
            "webhook": webhook,
            "chats": [chat for chat in chats if chat.get("bot_is_admin")],
        }

    @app.post("/api/telegram/verify")
    async def api_telegram_verify(request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        try:
            body = await request.json()
        except Exception:
            body = {}
        token = str((body or {}).get("token") or "").strip()
        if not token:
            return JSONResponse({"error": "token_required"}, status_code=400)
        if token.lower() in {"test", "тест"}:
            return JSONResponse({"error": "invalid_token"}, status_code=400)

        base_error = _validate_public_webhook_base(request)
        if base_error:
            return JSONResponse({"error": base_error}, status_code=400)

        try:
            me = get_me(token)
        except TelegramApiError as exc:
            set_config_error(oid, str(exc))
            return JSONResponse({"error": str(exc)}, status_code=400)

        secret = str(uuid.uuid4())
        cfg = save_bot_config(
            oid,
            bot_token=token,
            bot_id=int(me.get("id") or 0),
            bot_username=str(me.get("username") or ""),
            bot_first_name=str(me.get("first_name") or ""),
            webhook_secret=secret,
        )
        webhook_url = _webhook_url(oid, secret, request)
        try:
            set_webhook(token, webhook_url, secret_token=secret, drop_pending_updates=False)
        except TelegramApiError as exc:
            disconnect_bot(oid)
            return JSONResponse({"error": f"webhook: {exc}"}, status_code=400)
        ensure_scheduler_running()
        reregister_webhooks_later()
        reschedule_workspace(oid)
        return {"ok": True, "config": cfg, "webhook_url": webhook_url}

    @app.patch("/api/telegram/preferences")
    async def api_telegram_preferences(request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        try:
            body = await request.json()
        except Exception:
            body = {}
        try:
            prefs = save_notification_prefs(oid, body if isinstance(body, dict) else {})
        except ValueError as exc:
            code = str(exc)
            if code == "not_connected":
                return JSONResponse({"error": "not_connected"}, status_code=400)
            return JSONResponse({"error": code}, status_code=400)
        return {"ok": True, "notification_prefs": prefs}

    @app.delete("/api/telegram/disconnect")
    def api_telegram_disconnect(request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        _, token = get_bot_config_with_token(oid)
        if token:
            try:
                delete_webhook(token)
            except TelegramApiError:
                pass
        disconnect_bot(oid)
        return {"ok": True}

    @app.post("/api/telegram/chats/refresh")
    def api_telegram_chats_refresh(request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        cfg, token = get_bot_config_with_token(oid)
        if not cfg or not token:
            return JSONResponse({"error": "not_connected"}, status_code=400)
        chats = refresh_chats_admin_status(oid, token, int(cfg.get("bot_id") or 0))
        return {"ok": True, "chats": [chat for chat in chats if chat.get("bot_is_admin")]}

    @app.patch("/api/telegram/chats/{chat_row_id}")
    async def api_telegram_chat_patch(chat_row_id: str, request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        try:
            body = await request.json()
        except Exception:
            body = {}
        row = set_chat_enabled(oid, chat_row_id, bool((body or {}).get("is_enabled")))
        if row is None:
            return JSONResponse({"error": "not_found"}, status_code=404)
        return {"ok": True, "chat": row}

    @app.delete("/api/telegram/chats/{chat_row_id}")
    def api_telegram_chat_delete(chat_row_id: str, request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        if not delete_chat(oid, chat_row_id):
            return JSONResponse({"error": "not_found"}, status_code=404)
        return {"ok": True}

    @app.post("/api/telegram/chats/{chat_row_id}/send")
    async def api_telegram_chat_send(chat_row_id: str, request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        try:
            body = await request.json()
        except Exception:
            body = {}
        text = str((body or {}).get("text") or "").strip()
        if not text:
            return JSONResponse({"error": "message_required"}, status_code=400)
        text = text[:4000]
        cfg, token = get_bot_config_with_token(oid)
        if not cfg or not token:
            return JSONResponse({"error": "not_connected"}, status_code=400)
        chat = get_chat_by_row_id(oid, chat_row_id)
        if not chat:
            return JSONResponse({"error": "not_found"}, status_code=404)
        if not chat.get("bot_is_admin"):
            return JSONResponse({"error": "bot_not_admin"}, status_code=400)
        target_chat_id = int(chat.get("chat_id") or 0)
        try:
            tg_send_message(token, target_chat_id, text)
        except TelegramApiError as exc:
            log_delivery(
                oid,
                kind="manual_message",
                target_chat_id=target_chat_id,
                dedupe_key=f"manual:{uuid.uuid4()}",
                ok=False,
                error=str(exc),
            )
            return JSONResponse({"error": str(exc)}, status_code=400)
        log_delivery(
            oid,
            kind="manual_message",
            target_chat_id=target_chat_id,
            dedupe_key=f"manual:{uuid.uuid4()}",
            ok=True,
        )
        return {"ok": True, "chat": chat}

    @app.post("/api/telegram/subscribers/{subscriber_id}/approve")
    def api_telegram_subscriber_approve(subscriber_id: str, request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not is_director(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        row = decide_subscriber(
            oid,
            subscriber_id,
            approve=True,
            decided_by_user_id=str(user.get("user_id") or ""),
        )
        if row is None:
            return JSONResponse({"error": "not_found"}, status_code=404)
        _, token = get_bot_config_with_token(oid)
        if token:
            try:
                tg_send_message(token, int(row["chat_id"]), "✅ Вам одобрен доступ к уведомлениям U-POS FINANCE.")
            except TelegramApiError:
                pass
        return {"ok": True, "subscriber": row}

    @app.post("/api/telegram/subscribers/{subscriber_id}/reject")
    def api_telegram_subscriber_reject(subscriber_id: str, request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not is_director(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        row = decide_subscriber(
            oid,
            subscriber_id,
            approve=False,
            decided_by_user_id=str(user.get("user_id") or ""),
        )
        if row is None:
            return JSONResponse({"error": "not_found"}, status_code=404)
        _, token = get_bot_config_with_token(oid)
        if token:
            try:
                tg_send_message(token, int(row["chat_id"]), "❌ Заявка на уведомления отклонена.")
            except TelegramApiError:
                pass
        return {"ok": True, "subscriber": row}

    @app.delete("/api/telegram/subscribers/{subscriber_id}")
    def api_telegram_subscriber_delete(subscriber_id: str, request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        if not delete_subscriber(oid, subscriber_id):
            return JSONResponse({"error": "not_found"}, status_code=404)
        return {"ok": True}

    @app.post("/api/telegram/test/{report_kind}")
    def api_telegram_test(report_kind: str, request: Request):
        csrf_error = _csrf_or_error(request)
        if csrf_error:
            return csrf_error
        user = request.session.get("user") or {}
        if not can_manage_telegram(user):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None
        result = send_test_report(oid, report_kind)
        if result.get("error") and not result.get("ok"):
            return JSONResponse({"error": result.get("error"), "result": result}, status_code=400)
        return {"ok": True, "result": result}

    @app.get("/api/telegram/events")
    async def api_telegram_events(request: Request):
        oid, err = _telegram_workspace_owner(request)
        if err:
            return err
        assert oid is not None

        async def event_stream():
            queue = await hub.subscribe(oid)
            try:
                yield f"data: {json.dumps({'type': 'connected'}, ensure_ascii=False)}\n\n"
                while True:
                    try:
                        message = await asyncio.wait_for(queue.get(), timeout=25.0)
                        yield f"data: {message}\n\n"
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
            except asyncio.CancelledError:
                raise
            finally:
                await hub.unsubscribe(oid, queue)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


def reregister_webhooks_on_startup() -> None:
    base = _webhook_base()
    parsed = urlparse(base)
    if not base or parsed.scheme != "https" or parsed.hostname in _LOCAL_WEBHOOK_HOSTS:
        return
    for cfg in list_active_configs():
        wid = str(cfg.get("workspace_owner_id") or "").strip()
        token = str(cfg.get("bot_token") or "").strip()
        secret = str(cfg.get("webhook_secret") or "").strip()
        if not wid or not token or not secret:
            continue
        url = f"{base}/api/telegram/webhook/{wid}/{secret}"
        try:
            set_webhook(token, url, secret_token=secret, drop_pending_updates=False)
            logger.info("[telegram] webhook refreshed for %s", wid)
        except TelegramApiError as exc:
            logger.warning("[telegram] webhook refresh failed for %s: %s", wid, exc)


async def _reregister_webhooks_async() -> None:
    await asyncio.sleep(2.0)
    await asyncio.to_thread(reregister_webhooks_on_startup)


def reregister_webhooks_later() -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        threading.Thread(target=reregister_webhooks_on_startup, name="upos-telegram-webhooks", daemon=True).start()
        return
    loop.create_task(_reregister_webhooks_async(), name="upos-telegram-webhooks")
