"""Durable delivery of uploaded call recordings to a Telegram channel."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import and_, or_, select

from upos.db import session_scope
from upos.db_models import TelephonyRecordingDelivery

logger = logging.getLogger(__name__)
# httpx INFO lines include the full Bot API URL and therefore the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)
_UPLOAD_ROOT = Path(__file__).resolve().parent / "static" / "uploads" / "telephony"
_URL_PREFIX = "/static/uploads/telephony/"


def _config() -> tuple[str, str, str]:
    return (
        os.getenv("UPOS_RECORDING_TELEGRAM_WORKSPACE_ID", "").strip(),
        os.getenv("UPOS_RECORDING_TELEGRAM_CHAT_ID", "").strip(),
        os.getenv("UPOS_RECORDING_TELEGRAM_TOKEN", "").strip(),
    )


def _local_path(workspace_owner_id: str, recording_url: str) -> Path | None:
    if not recording_url.startswith(_URL_PREFIX):
        return None
    workspace_dir = re.sub(r"[^a-zA-Z0-9_-]", "_", workspace_owner_id)
    expected = (_UPLOAD_ROOT / workspace_dir).resolve()
    candidate = (_UPLOAD_ROOT / recording_url[len(_URL_PREFIX):]).resolve()
    if candidate.parent != expected or candidate.suffix.lower() not in {
        ".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"
    }:
        return None
    return candidate


def enqueue_recording(workspace_owner_id: str, recording_url: str, call: dict) -> bool:
    """Queue one recording per call; delivery remains pending across restarts."""
    if _local_path(workspace_owner_id, recording_url) is None:
        return False
    call_key = str(call.get("external_id") or call.get("id") or recording_url).strip()
    delivery_id = hashlib.sha256(f"{workspace_owner_id}\0{call_key}".encode("utf-8")).hexdigest()
    with session_scope() as session:
        existing = session.get(TelephonyRecordingDelivery, delivery_id)
        if existing is not None:
            if existing.status == "pending":
                existing.recording_path = recording_url
                existing.client_name = str(call.get("client") or existing.client_name).strip()[:160]
            return False
        session.add(TelephonyRecordingDelivery(
            id=delivery_id,
            workspace_owner_id=workspace_owner_id,
            recording_path=recording_url,
            client_name=str(call.get("client") or "").strip()[:160],
            phone=str(call.get("phone") or "").strip()[:64],
            started_at=str(call.get("started_at") or "").strip()[:64],
            status="pending",
            attempts=0,
        ))
    return True


def _caption(row: TelephonyRecordingDelivery) -> tuple[str, str]:
    client = row.client_name or row.phone or "Неизвестный клиент"
    parts = ["Звонок от Коллцентра", f"Клиент: {client}"]
    if row.phone and row.phone != client:
        parts.append(f"Номер: {row.phone}")
    date_label = ""
    try:
        moment = datetime.fromisoformat(row.started_at.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        date_label = moment.astimezone(ZoneInfo("Asia/Tashkent")).strftime("%d.%m.%Y %H:%M")
        parts.append(f"Дата: {date_label} (Ташкент)")
    except ValueError:
        pass
    safe_name = re.sub(r"[^\w-]+", "_", client, flags=re.UNICODE).strip("_")[:60] or "Клиент"
    return "\n".join(parts)[:1024], f"Звонок_{safe_name}_{date_label.replace('.', '-').replace(':', '-') or 'запись'}"


def _send(row: TelephonyRecordingDelivery, chat_id: str, token: str) -> int:
    path = _local_path(row.workspace_owner_id, row.recording_path)
    if path is None or not path.is_file():
        raise FileNotFoundError("recording file is unavailable")
    if path.stat().st_size > 50 * 1024 * 1024:
        raise ValueError("recording exceeds Telegram upload limit")
    caption, filename = _caption(row)
    with tempfile.TemporaryDirectory(prefix="upos-voice-") as temp_dir:
        voice_path = Path(temp_dir) / (filename + ".ogg")
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(path), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "48000",
                 "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", str(voice_path)],
                capture_output=True, check=True, timeout=120,
            )
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"recording voice conversion failed: {type(exc).__name__}") from None
        if not voice_path.is_file() or voice_path.stat().st_size > 50 * 1024 * 1024:
            raise ValueError("converted voice is unavailable or exceeds Telegram upload limit")
        try:
            with voice_path.open("rb") as stream:
                response = httpx.post(
                    f"https://api.telegram.org/bot{token}/sendVoice",
                    data={"chat_id": chat_id, "caption": caption},
                    files={"voice": (voice_path.name, stream, "audio/ogg")},
                    timeout=90,
                )
        except httpx.HTTPError as exc:
            # httpx exceptions can contain the URL, which includes the bot token.
            raise RuntimeError(f"Telegram transport error: {type(exc).__name__}") from None
    try:
        payload = response.json()
    except ValueError:
        raise RuntimeError(f"Telegram returned invalid JSON ({response.status_code})") from None
    if not payload.get("ok"):
        reason = str(payload.get("description") or "API error").replace(token, "[redacted]")[:200]
        raise RuntimeError(f"Telegram rejected recording ({response.status_code}): {reason}")
    result = payload.get("result") or {}
    if not result.get("voice"):
        raise RuntimeError("Telegram did not return a voice message")
    return int(result.get("message_id") or 0)


def process_due_recordings(max_items: int = 8) -> int:
    workspace_id, chat_id, token = _config()
    if not all((workspace_id, chat_id, token)):
        return 0
    completed = 0
    for _ in range(max_items):
        now = datetime.now(timezone.utc)
        with session_scope() as session:
            row = session.execute(
                select(TelephonyRecordingDelivery).where(
                    TelephonyRecordingDelivery.workspace_owner_id == workspace_id,
                    or_(
                        and_(
                            TelephonyRecordingDelivery.status == "pending",
                            or_(
                                TelephonyRecordingDelivery.next_attempt_at.is_(None),
                                TelephonyRecordingDelivery.next_attempt_at <= now,
                            ),
                        ),
                        and_(
                            TelephonyRecordingDelivery.status == "sending",
                            TelephonyRecordingDelivery.lease_until <= now,
                        ),
                    ),
                ).order_by(TelephonyRecordingDelivery.next_attempt_at.asc().nullsfirst())
                .limit(1).with_for_update(skip_locked=True)
            ).scalar_one_or_none()
            if row is None:
                break
            row.status = "sending"
            row.attempts += 1
            row.lease_until = now + timedelta(minutes=10)
            delivery_id = row.id
            session.flush()
            session.expunge(row)
        try:
            message_id = _send(row, chat_id, token)
        except Exception as exc:
            logger.warning("[telephony] recording Telegram delivery failed id=%s: %s", delivery_id[:12], exc)
            with session_scope() as session:
                current = session.get(TelephonyRecordingDelivery, delivery_id)
                if current and current.status == "sending":
                    current.status = "pending"
                    current.lease_until = None
                    current.next_attempt_at = datetime.now(timezone.utc) + timedelta(
                        seconds=min(3600, 30 * 2 ** min(current.attempts, 7))
                    )
                    current.last_error = str(exc)[:500]
            continue
        with session_scope() as session:
            current = session.get(TelephonyRecordingDelivery, delivery_id)
            if current:
                current.status = "sent"
                current.sent_at = datetime.now(timezone.utc)
                current.lease_until = None
                current.telegram_message_id = message_id
                current.last_error = ""
        completed += 1
        logger.info("[telephony] recording sent to Telegram id=%s", delivery_id[:12])
        if completed < max_items:
            time.sleep(1.1)
    return completed
