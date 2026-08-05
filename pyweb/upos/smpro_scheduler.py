"""Автоматическая синхронизация IBOX / SMPro.

Раньше данные подтягивались только по кнопке в настройках, а сам проход шёл
фоновой задачей внутри веб-запроса: перезапуск сервера обрывал его, и весь
результат терялся. Здесь синхронизация вынесена в отдельный цикл, который
запускает её по расписанию и подхватывает прерванные проходы с того модуля,
на котором они остановились.
"""

from __future__ import annotations

import asyncio
import logging

from upos.smpro_store import claim_smpro_sync, list_ibox_workspaces, run_smpro_sync

logger = logging.getLogger("upos.smpro")

TICK_SECONDS = 120

_task: asyncio.Task[None] | None = None


async def _scheduler_loop() -> None:
    # Первый круг делаем чуть позже старта: при развёртывании приложение
    # должно сначала принять трафик, а не упереться в тяжёлую выгрузку.
    await asyncio.sleep(30)
    while True:
        try:
            for workspace_owner_id in await asyncio.to_thread(list_ibox_workspaces):
                claim = await asyncio.to_thread(claim_smpro_sync, workspace_owner_id)
                if not claim or not claim.get("id"):
                    continue
                run_id = str(claim["id"])
                logger.info(
                    "[ibox] %s синхронизация %s (%s)",
                    workspace_owner_id,
                    run_id,
                    "продолжение" if claim.get("resumed") else "по расписанию",
                )
                await asyncio.to_thread(run_smpro_sync, workspace_owner_id, run_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[ibox] круг планировщика не удался")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("[ibox] планировщик не запущен: нет цикла событий")
        return
    _task = loop.create_task(_scheduler_loop(), name="upos-ibox-sync")


def stop_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        _task.cancel()
    _task = None
