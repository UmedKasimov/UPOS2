"""Курсы валют к USD (сколько единиц валюты за 1 USD) с кэшем и офлайн-запасом."""

from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

# Запас, если API недоступен (порядок величин для UX, не для торговли).
_FALLBACK_RATES: dict[str, float] = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "UZS": 12_500.0,
    "RUB": 92.0,
    "KZT": 520.0,
    "CNY": 7.25,
    "TRY": 38.0,
    "CHF": 0.88,
    "JPY": 155.0,
    "AED": 3.67,
    "KRW": 1380.0,
}

_CACHE: dict[str, Any] = {"ts": 0.0, "rates": None, "as_of": None}
_CACHE_TTL_SEC = 600.0
_LOCK = Lock()


def _normalize_rates(raw: dict[str, Any]) -> dict[str, float] | None:
    rates = raw.get("rates")
    if not isinstance(rates, dict):
        return None
    out: dict[str, float] = {}
    for k, v in rates.items():
        if not isinstance(k, str):
            continue
        code = k.strip().upper()
        if len(code) != 3:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f <= 0:
            continue
        out[code] = f
    out["USD"] = 1.0
    if len(out) < 5:
        return None
    return out


def fetch_usd_rates_live() -> tuple[dict[str, float] | None, str | None]:
    """Загрузка с open.er-api.com (база USD: EUR = сколько EUR за 1 USD)."""
    try:
        import httpx
    except ImportError:
        logger.warning("[fx] httpx не установлен, используются запасные курсы")
        return None, None
    url = "https://open.er-api.com/v6/latest/USD"
    try:
        with httpx.Client(timeout=12.0) as client:
            r = client.get(url)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.info("[fx] live fetch failed: %s", e)
        return None, None
    if not isinstance(data, dict) or data.get("result") != "success":
        return None, None
    rates = _normalize_rates(data)
    as_of = data.get("time_last_update_utc")
    if rates is None:
        return None, None
    return rates, str(as_of) if as_of else None


def get_usd_rates() -> dict[str, Any]:
    """Возвращает { rates, base, as_of, stale }."""
    now = time.monotonic()
    with _LOCK:
        cached_rates = _CACHE.get("rates")
        if (
            isinstance(cached_rates, dict)
            and now - float(_CACHE.get("ts") or 0) < _CACHE_TTL_SEC
        ):
            return {
                "base": "USD",
                "rates": cached_rates,
                "as_of": _CACHE.get("as_of"),
                "stale": False,
            }

    live, as_of = fetch_usd_rates_live()
    with _LOCK:
        if live is not None:
            _CACHE["rates"] = live
            _CACHE["as_of"] = as_of
            _CACHE["ts"] = time.monotonic()
            return {
                "base": "USD",
                "rates": live,
                "as_of": as_of,
                "stale": False,
            }
        if isinstance(_CACHE.get("rates"), dict):
            return {
                "base": "USD",
                "rates": _CACHE["rates"],
                "as_of": _CACHE.get("as_of"),
                "stale": True,
            }
        merged = dict(_FALLBACK_RATES)
        return {
            "base": "USD",
            "rates": merged,
            "as_of": None,
            "stale": True,
        }


def convert_through_usd(
    amount: float,
    from_ccy: str,
    to_ccy: str,
    rates: dict[str, float],
) -> float | None:
    """Конвертация при курсе 'сколько единиц валюты за 1 USD'."""
    fro = (from_ccy or "").strip().upper()
    to = (to_ccy or "").strip().upper()
    if fro == to:
        return amount
    rf = rates.get(fro)
    rt = rates.get(to)
    if rf is None or rt is None or rf <= 0 or rt <= 0:
        return None
    if fro == "USD":
        usd = amount
    else:
        usd = amount / rf
    if to == "USD":
        return usd
    return usd * rt
