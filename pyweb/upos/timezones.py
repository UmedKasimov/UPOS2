"""Часовые пояса воркспейса (IANA): выбор в настройках, границы отчётов, разбор дат операций."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, available_timezones

# Узбекистан не переходит на летнее время — удобный дефолт для целевой аудитории.
DEFAULT_WORKSPACE_TIMEZONE = "Asia/Tashkent"

# Подмножество IANA для выпадающего списка (остальные зоны всё равно можно принять при POST, см. normalize).
TIMEZONE_GROUPS: list[dict[str, Any]] = [
    {
        "label_key": "tz.group.uz_neighbors",
        "label": "Узбекистан и соседи",
        "options": [
            ("Asia/Tashkent", "Ташкент — UTC+5"),
            ("Asia/Samarkand", "Самарканд — UTC+5"),
            ("Asia/Dushanbe", "Душанбе — UTC+5"),
            ("Asia/Bishkek", "Бишкек — UTC+6"),
            ("Asia/Almaty", "Алматы — UTC+5"),
        ],
    },
    {
        "label_key": "tz.group.russia",
        "label": "Россия",
        "options": [
            ("Europe/Moscow", "Москва — UTC+3"),
            ("Europe/Samara", "Самара — UTC+4"),
            ("Asia/Yekaterinburg", "Екатеринбург — UTC+5"),
            ("Asia/Omsk", "Омск — UTC+6"),
            ("Asia/Krasnoyarsk", "Красноярск — UTC+7"),
            ("Asia/Novosibirsk", "Новосибирск — UTC+7"),
            ("Asia/Irkutsk", "Иркутск — UTC+8"),
            ("Asia/Vladivostok", "Владивосток — UTC+10"),
        ],
    },
    {
        "label_key": "tz.group.europe_us",
        "label": "Европа и США",
        "options": [
            ("UTC", "UTC"),
            ("Europe/Kaliningrad", "Калининград — UTC+2"),
            ("Europe/Berlin", "Берлин — UTC+1/+2"),
            ("Europe/London", "Лондон — UTC+0/+1"),
            ("America/New_York", "Нью-Йорк — восток США"),
            ("America/Los_Angeles", "Лос-Анджелес — запад США"),
        ],
    },
    {
        "label_key": "tz.group.asia",
        "label": "Азия",
        "options": [
            ("Asia/Dubai", "Дубай — UTC+4"),
            ("Asia/Karachi", "Карачи — UTC+5"),
            ("Asia/Kolkata", "Индия — UTC+5:30"),
            ("Asia/Bangkok", "Бангкок — UTC+7"),
            ("Asia/Singapore", "Сингапур — UTC+8"),
            ("Asia/Tokyo", "Токио — UTC+9"),
            ("Asia/Seoul", "Сеул — UTC+9"),
            ("Asia/Shanghai", "Шанхай — UTC+8"),
        ],
    },
]


_VALID_CACHE: frozenset[str] | None = None


def _all_valid() -> frozenset[str]:
    global _VALID_CACHE
    if _VALID_CACHE is None:
        _VALID_CACHE = available_timezones()
    return _VALID_CACHE


def normalize_workspace_timezone(name: str | None) -> str:
    """Безопасное имя зоны для zoneinfo; неизвестное — дефолт."""
    s = (name or "").strip()
    if not s:
        return DEFAULT_WORKSPACE_TIMEZONE
    if s in _all_valid():
        return s
    return DEFAULT_WORKSPACE_TIMEZONE


def current_month_local_bounds_utc(tz_name: str) -> tuple[datetime, datetime, datetime]:
    """
    Границы «текущего календарного месяца» в зоне воркспейса.
    Возвращает (start_utc_inclusive, end_utc_exclusive, now_local_for_labels) — все aware UTC кроме now_local (aware in tz).
    """
    tz = ZoneInfo(normalize_workspace_timezone(tz_name))
    now_local = datetime.now(tz)
    start_local = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now_local.month == 12:
        end_local = datetime(now_local.year + 1, 1, 1, tzinfo=tz)
    else:
        end_local = datetime(now_local.year, now_local.month + 1, 1, tzinfo=tz)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    return start_utc, end_utc, now_local


def period_local_bounds_utc(
    tz_name: str,
    preset: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> tuple[datetime | None, datetime | None, datetime, str, str | None, str | None]:
    """
    Period boundaries in workspace local dates converted to UTC.
    Returns (start_utc inclusive, end_utc exclusive, now_local, normalized_preset, start_label, end_label).
    """
    tz = ZoneInfo(normalize_workspace_timezone(tz_name))
    now_local = datetime.now(tz)
    today = now_local.date()
    mode = (preset or "today").strip().lower()
    if mode not in {"today", "month", "all", "custom"}:
        mode = "today"

    def _parse_local_date(raw: str | None) -> date | None:
        value = (raw or "").strip()
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return None

    if mode == "all":
        return None, None, now_local, "all", None, None

    if mode == "month":
        start_day = today.replace(day=1)
        end_day = today
    elif mode == "custom":
        start_day = _parse_local_date(date_from) or today
        end_day = _parse_local_date(date_to) or start_day
    else:
        start_day = today
        end_day = today

    if end_day < start_day:
        start_day, end_day = end_day, start_day

    start_local = datetime.combine(start_day, time.min, tzinfo=tz)
    end_local = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=tz)
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc),
        now_local,
        mode,
        start_day.isoformat(),
        end_day.isoformat(),
    )


def parse_created_at_for_workspace(raw: Any, workspace_tz: str) -> datetime | None:
    """
    Разбор даты создания операции для сохранения в БД (UTC).

    - ISO с Z или смещением (+05:00) — переводим в UTC.
    - Наивная строка из datetime-local (YYYY-MM-DDTHH:mm) — «настенные часы» в часовом поясе воркспейса.
    """
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    tz_id = normalize_workspace_timezone(workspace_tz)

    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc)

    # Наивная дата — интерпретируем как local wall time воркспейса
    try:
        z = ZoneInfo(tz_id)
    except Exception:
        z = ZoneInfo(DEFAULT_WORKSPACE_TIMEZONE)
    localized = dt.replace(tzinfo=z)
    return localized.astimezone(timezone.utc)


def curated_zone_ids() -> frozenset[str]:
    s: set[str] = set()
    for g in TIMEZONE_GROUPS:
        for z, _ in g["options"]:
            s.add(z)
    return frozenset(s)
