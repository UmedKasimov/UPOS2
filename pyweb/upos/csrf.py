"""Простая защита от CSRF для форм с cookie-сессией (double-submit в сессии)."""

from __future__ import annotations

import secrets

from starlette.requests import Request


def ensure_csrf_token(request: Request) -> str:
    tok = request.session.get("_csrf")
    if not isinstance(tok, str) or len(tok) < 16:
        tok = secrets.token_urlsafe(32)
        request.session["_csrf"] = tok
    return tok


def rotate_csrf_token(request: Request) -> str:
    tok = secrets.token_urlsafe(32)
    request.session["_csrf"] = tok
    return tok


def csrf_matches_session(request: Request, submitted: str) -> bool:
    expected = request.session.get("_csrf")
    if not isinstance(expected, str) or not submitted:
        return False
    return secrets.compare_digest(expected, submitted)
