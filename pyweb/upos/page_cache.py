"""Short-lived Redis cache for expensive authenticated HTML pages.

The cache is scoped to an authentication session and a workspace. A shared
workspace generation is bumped after every mutating request, so a prefetched
page cannot survive a successful write.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
import zlib
from collections import OrderedDict
from pathlib import Path

try:
    import redis
except ImportError:  # Local development can run without Redis.
    redis = None


def _build_fingerprint() -> str:
    configured = (os.getenv("UPOS_BUILD_VERSION") or "").strip()
    if configured:
        return hashlib.sha256(configured.encode("utf-8", errors="ignore")).hexdigest()[:12]

    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for folder_name, suffixes in (
        ("templates", {".html"}),
        ("static", {".css", ".js"}),
    ):
        folder = root / folder_name
        if not folder.exists():
            continue
        for path in sorted(item for item in folder.rglob("*") if item.suffix.lower() in suffixes):
            try:
                stat = path.stat()
            except OSError:
                continue
            digest.update(path.relative_to(root).as_posix().encode("utf-8", errors="ignore"))
            digest.update(f":{stat.st_size}:{stat.st_mtime_ns}".encode("ascii"))
    return digest.hexdigest()[:12]


_PREFIX = f"upos:page-cache:v14:{_build_fingerprint()}"
_TTL_SECONDS = max(5, int(os.getenv("UPOS_PAGE_CACHE_TTL", "600") or "600"))
_MAX_PAYLOAD_BYTES = max(
    256 * 1024,
    int(os.getenv("UPOS_PAGE_CACHE_MAX_BYTES", str(20 * 1024 * 1024)) or str(20 * 1024 * 1024)),
)
_MEMORY_LIMIT = 24
_GENERATION_CACHE_TTL_SECONDS = 1.0
_memory_lock = threading.Lock()
_memory_cache: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
_memory_versions: dict[str, int] = {}
_generation_cache: dict[str, tuple[float, int]] = {}
_redis_client = None
_redis_lock = threading.Lock()


def _client():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    redis_url = (os.getenv("REDIS_URL") or "").strip()
    if not redis_url or redis is None:
        return None
    with _redis_lock:
        if _redis_client is None:
            _redis_client = redis.Redis.from_url(
                redis_url,
                decode_responses=False,
                socket_connect_timeout=0.35,
                socket_timeout=0.5,
                health_check_interval=30,
            )
    return _redis_client


def _version_key(workspace_id: str) -> str:
    return f"{_PREFIX}:generation:{workspace_id}"


def _generation(workspace_id: str) -> int:
    now = time.monotonic()
    with _memory_lock:
        cached = _generation_cache.get(workspace_id)
        if cached is not None and cached[0] > now:
            return cached[1]
    client = _client()
    if client is not None:
        try:
            value = client.get(_version_key(workspace_id))
            generation = int(value or 0)
            with _memory_lock:
                _generation_cache[workspace_id] = (
                    now + _GENERATION_CACHE_TTL_SECONDS,
                    generation,
                )
            return generation
        except Exception:
            pass
    with _memory_lock:
        generation = _memory_versions.get(workspace_id, 0)
        _generation_cache[workspace_id] = (
            now + _GENERATION_CACHE_TTL_SECONDS,
            generation,
        )
        return generation


def _cache_key(workspace_id: str, session_id: str, url: str) -> str:
    digest = hashlib.sha256(url.encode("utf-8", errors="ignore")).hexdigest()
    generation = _generation(workspace_id)
    return f"{_PREFIX}:page:{workspace_id}:{generation}:{session_id}:{digest}"


def get_page(workspace_id: str, session_id: str, url: str) -> bytes | None:
    key = _cache_key(workspace_id, session_id, url)
    now = time.monotonic()
    with _memory_lock:
        cached = _memory_cache.get(key)
        if cached is not None:
            expires_at, payload = cached
            if expires_at > now:
                _memory_cache[key] = (now + _TTL_SECONDS, payload)
                _memory_cache.move_to_end(key)
                try:
                    return zlib.decompress(payload)
                except zlib.error:
                    _memory_cache.pop(key, None)
            else:
                _memory_cache.pop(key, None)

    client = _client()
    if client is not None:
        try:
            payload = client.get(key)
            if payload:
                client.expire(key, _TTL_SECONDS)
                value = zlib.decompress(payload)
                with _memory_lock:
                    _memory_cache[key] = (now + _TTL_SECONDS, payload)
                    _memory_cache.move_to_end(key)
                    while len(_memory_cache) > _MEMORY_LIMIT:
                        _memory_cache.popitem(last=False)
                return value
        except Exception:
            pass
    return None


def set_page(workspace_id: str, session_id: str, url: str, payload: bytes) -> bool:
    if not payload or len(payload) > _MAX_PAYLOAD_BYTES:
        return False
    key = _cache_key(workspace_id, session_id, url)
    compressed = zlib.compress(payload, level=3)
    with _memory_lock:
        _memory_cache[key] = (time.monotonic() + _TTL_SECONDS, compressed)
        _memory_cache.move_to_end(key)
        while len(_memory_cache) > _MEMORY_LIMIT:
            _memory_cache.popitem(last=False)
    client = _client()
    if client is not None:
        try:
            client.setex(key, _TTL_SECONDS, compressed)
            return True
        except Exception:
            pass
    return True


def invalidate_workspace(workspace_id: str) -> None:
    generation = None
    client = _client()
    if client is not None:
        try:
            generation = int(client.incr(_version_key(workspace_id)))
        except Exception:
            pass
    with _memory_lock:
        if generation is None:
            generation = _memory_versions.get(workspace_id, 0) + 1
        _memory_versions[workspace_id] = generation
        _generation_cache[workspace_id] = (
            time.monotonic() + _GENERATION_CACHE_TTL_SECONDS,
            generation,
        )
        prefix = f"{_PREFIX}:page:{workspace_id}:"
        for key in list(_memory_cache):
            if key.startswith(prefix):
                _memory_cache.pop(key, None)


def current_generation(workspace_id: str) -> int:
    """Return the generation shared by server and browser warmup state."""
    if not workspace_id:
        return 0
    return _generation(workspace_id)


def reset_for_tests() -> None:
    global _redis_client
    with _memory_lock:
        _memory_cache.clear()
        _memory_versions.clear()
        _generation_cache.clear()
    _redis_client = None
