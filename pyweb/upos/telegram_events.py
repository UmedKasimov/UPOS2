"""In-process pub/sub for live Telegram settings updates."""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any


class TelegramEventHub:
    def __init__(self) -> None:
        self._queues: dict[str, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[str]]]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def subscribe(self, workspace_owner_id: str) -> asyncio.Queue[str]:
        wid = (workspace_owner_id or "").strip()
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=64)
        loop = asyncio.get_running_loop()
        async with self._lock:
            self._queues[wid].append((loop, queue))
        return queue

    async def unsubscribe(self, workspace_owner_id: str, queue: asyncio.Queue[str]) -> None:
        wid = (workspace_owner_id or "").strip()
        async with self._lock:
            current = self._queues.get(wid) or []
            self._queues[wid] = [(loop, q) for loop, q in current if q is not queue]
            if not self._queues[wid]:
                self._queues.pop(wid, None)

    def publish(self, workspace_owner_id: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
        wid = (workspace_owner_id or "").strip()
        if not wid:
            return
        msg = json.dumps(
            {
                "type": event_type,
                "ts": datetime.now(timezone.utc).isoformat(),
                "data": payload or {},
            },
            ensure_ascii=False,
        )
        for loop, queue in list(self._queues.get(wid) or []):
            if not loop.is_closed():
                loop.call_soon_threadsafe(self._put_nowait, queue, msg)

    @staticmethod
    def _put_nowait(queue: asyncio.Queue[str], msg: str) -> None:
        try:
            queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass


hub = TelegramEventHub()
