"""Lightweight scheduler for daily Telegram reports."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from upos.storage import load_workspace_settings
from upos.telegram_notifier import send_daily_digest_for_workspace
from upos.telegram_store import get_notification_prefs, list_active_configs
from upos.timezones import normalize_workspace_timezone

logger = logging.getLogger(__name__)

_task: asyncio.Task[None] | None = None
_sent_today: set[str] = set()


def _daily_key(workspace_owner_id: str, tz_name: str) -> tuple[str, bool]:
    prefs = get_notification_prefs(workspace_owner_id)
    reports = prefs.get("reports") if isinstance(prefs.get("reports"), dict) else {}
    if not reports.get("daily", True):
        return f"{workspace_owner_id}:{datetime.now(ZoneInfo(tz_name)).date().isoformat()}", False
    schedule = prefs.get("schedule") if isinstance(prefs.get("schedule"), dict) else {}
    try:
        daily_hour = int(schedule.get("daily_hour", 21))
    except (TypeError, ValueError):
        daily_hour = 21
    daily_hour = max(0, min(23, daily_hour))
    now_local = datetime.now(ZoneInfo(tz_name))
    due = now_local.hour >= daily_hour
    return f"{workspace_owner_id}:{now_local.date().isoformat()}", due


async def _scheduler_loop() -> None:
    while True:
        try:
            for cfg in list_active_configs():
                wid = str(cfg.get("workspace_owner_id") or "").strip()
                if not wid:
                    continue
                ws = load_workspace_settings(wid)
                tz_name = normalize_workspace_timezone(str(ws.get("timezone") or ""))
                try:
                    ZoneInfo(tz_name)
                except Exception:
                    tz_name = "Asia/Tashkent"
                key, due = _daily_key(wid, tz_name)
                if not due or key in _sent_today:
                    continue
                result = await asyncio.to_thread(send_daily_digest_for_workspace, wid, dedupe=True)
                logger.info("[telegram] daily digest %s: %s", wid, result)
                if result.get("ok") or result.get("skipped") == "dedupe":
                    _sent_today.add(key)
            if len(_sent_today) > 1000:
                _sent_today.clear()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[telegram] daily scheduler tick failed")
        await asyncio.sleep(60)


def ensure_scheduler_running() -> None:
    """Start daily digest loop when first bot is connected."""
    start_scheduler()


def start_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("[telegram] scheduler start skipped: no running event loop")
        return
    _task = loop.create_task(_scheduler_loop(), name="upos-telegram-daily")


def stop_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        _task.cancel()
    _task = None


def reschedule_workspace(workspace_owner_id: str) -> None:
    _sent_today.discard(str(workspace_owner_id or "").strip())
