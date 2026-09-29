"""Интерфейсные переводы (ru / en / uz). Сообщения — в messages.json (ключ → {ru,en,uz})."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from upos.storage import load_legacy_settings, load_workspace_settings, valid_workspace_owner_id

logger = logging.getLogger(__name__)

LOCALE_COOKIE = "upos_locale"
SUPPORTED_LOCALES = frozenset({"ru", "en", "uz"})
DEFAULT_LOCALE = "ru"

CLIENT_PREFIXES = (
    "kassa.",
    "schet.",
    "settings.js.",
    "settings.profile.",
    "settings.prefs_",
    "settings.tg.",
    "settings.devices.",
    "settings.cat.",
    "general.",
    "employees.devices.",
    "avatar.",
    "num.",
    "period.",
)


@lru_cache
def _messages_raw() -> dict[str, dict[str, str]]:
    path = Path(__file__).resolve().parent / "messages.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("[i18n] failed to load messages.json")
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for k, v in data.items():
        if not isinstance(k, str) or not isinstance(v, dict):
            continue
        ru = str(v.get("ru") or "")
        en = str(v.get("en") or "")
        uz = str(v.get("uz") or "")
        out[k] = {"ru": ru or k, "en": en or ru or k, "uz": uz or ru or k}
    return out


def normalize_locale(code: str | None) -> str:
    if not code or not isinstance(code, str):
        return DEFAULT_LOCALE
    c = code.strip().lower().replace("-", "_")
    if c.startswith("uz_"):
        c = "uz"
    if c in SUPPORTED_LOCALES:
        return c
    if c.startswith("en"):
        return "en"
    if c.startswith("ru"):
        return "ru"
    return DEFAULT_LOCALE


def html_lang(locale: str) -> str:
    return normalize_locale(locale)


def translate(locale: str, key: str, **kwargs: Any) -> str:
    loc = normalize_locale(locale)
    row = _messages_raw().get(key)
    if not row:
        logger.debug("[i18n] missing key: %s", key)
        text = key
    else:
        text = row.get(loc) or row.get("ru") or key
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, ValueError):
            return text
    return text


def client_bundle(locale: str) -> dict[str, str]:
    loc = normalize_locale(locale)
    raw = _messages_raw()
    out: dict[str, str] = {}
    for key, row in raw.items():
        if not any(key.startswith(p) for p in CLIENT_PREFIXES):
            continue
        out[key] = row.get(loc) or row.get("ru") or key
    return out


def resolve_locale(request: Request, user: Mapping[str, Any] | None) -> str:
    stored: str | None = None
    if user:
        if str(user.get("role") or "") == "admin":
            try:
                raw_loc = load_legacy_settings().get("locale")
                if raw_loc:
                    stored = normalize_locale(str(raw_loc))
            except Exception:
                logger.exception("[i18n] load_legacy_settings for locale")
        else:
            wid = str(
                (
                    user.get("account_owner_id")
                    if user.get("org_scope") == "general"
                    else None
                )
                or user.get("workspace_owner_id")
                or user.get("user_id")
                or "",
            ).strip()
            if valid_workspace_owner_id(wid):
                try:
                    raw_loc = load_workspace_settings(wid).get("locale")
                    if raw_loc:
                        stored = normalize_locale(str(raw_loc))
                except Exception:
                    logger.exception("[i18n] load_workspace_settings for locale")
    cookie_raw = request.cookies.get(LOCALE_COOKIE)
    cookie = normalize_locale(cookie_raw) if cookie_raw else None
    if stored:
        return stored
    if cookie:
        return cookie
    return DEFAULT_LOCALE


def apply_locale_cookie(response: Response, locale: str) -> None:
    loc = normalize_locale(locale)
    response.set_cookie(
        LOCALE_COOKIE,
        loc,
        max_age=365 * 24 * 3600,
        path="/",
        samesite="lax",
        httponly=False,
    )


def redirect_with_locale(url: str, locale: str, *, status_code: int = 302) -> RedirectResponse:
    r = RedirectResponse(url=url, status_code=status_code)
    apply_locale_cookie(r, locale)
    return r


def context_i18n(locale: str) -> dict[str, Any]:
    loc = normalize_locale(locale)

    def _(key: str, **kwargs: Any) -> str:
        return translate(loc, key, **kwargs)

    return {
        "_": _,
        "locale": loc,
        "html_lang": html_lang(loc),
        "upos_i18n": client_bundle(loc),
    }


def localized_timezone_groups(locale: str) -> list[dict[str, Any]]:
    from upos.timezones import TIMEZONE_GROUPS as raw

    loc = normalize_locale(locale)
    out: list[dict[str, Any]] = []
    for grp in raw:
        glabel_key = str(grp.get("label_key") or "")
        label = translate(loc, glabel_key) if glabel_key else str(grp.get("label") or "")
        opts: list[tuple[str, str]] = []
        for zone, default_caption in grp.get("options") or []:
            zk = f"tz.zone.{str(zone).replace('/', '__')}"
            caption = translate(loc, zk)
            if caption == zk:
                caption = str(default_caption)
            opts.append((str(zone), caption))
        out.append({"label": label, "label_key": glabel_key, "options": opts})
    return out


def localize_treasury_templates(locale: str, templates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    loc = normalize_locale(locale)
    result: list[dict[str, Any]] = []
    for item in templates:
        tid = str(item.get("id") or "")
        row = dict(item)
        if tid:
            tk = f"tpl.{tid}.title"
            sk = f"tpl.{tid}.subtitle"
            t_title = translate(loc, tk)
            t_sub = translate(loc, sk)
            row["title"] = t_title if t_title != tk else str(item.get("title") or "")
            row["subtitle"] = t_sub if t_sub != sk else str(item.get("subtitle") or "")
        result.append(row)
    return result
