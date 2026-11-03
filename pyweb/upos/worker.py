"""Dedicated background process for UPOS scheduled integrations."""

from __future__ import annotations

import asyncio
import logging

from upos.db import init_db
from upos.smpro_scheduler import start_scheduler as start_ibox_scheduler
from upos.smpro_scheduler import stop_scheduler as stop_ibox_scheduler
from upos.telegram_routes import reregister_webhooks_on_startup
from upos.telegram_scheduler import start_scheduler as start_telegram_scheduler
from upos.telegram_scheduler import stop_scheduler as stop_telegram_scheduler
from upos.telephony_recording_delivery import process_due_recordings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("upos.worker")


async def _recording_delivery_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(process_due_recordings)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[worker] recording delivery tick failed")
        await asyncio.sleep(15)


async def run() -> None:
    init_db()
    await asyncio.to_thread(reregister_webhooks_on_startup)
    start_telegram_scheduler()
    start_ibox_scheduler()
    recording_task = asyncio.create_task(_recording_delivery_loop(), name="upos-recording-delivery")
    logger.info("[worker] Telegram and IBOX schedulers started")
    try:
        await asyncio.Event().wait()
    finally:
        recording_task.cancel()
        await asyncio.gather(recording_task, return_exceptions=True)
        stop_telegram_scheduler()
        stop_ibox_scheduler()


if __name__ == "__main__":
    asyncio.run(run())
