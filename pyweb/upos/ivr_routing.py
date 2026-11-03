"""Validated, provider-neutral IVR routing rules saved by the telephony settings page."""

from __future__ import annotations

import re
from collections.abc import Mapping


def _phone(value: object) -> str:
    raw = str(value or "").strip()
    if not re.fullmatch(r"\+?[\d\s()-]+", raw):
        raise ValueError("Укажите корректный телефонный номер")
    digits = re.sub(r"\D", "", raw)
    if not 7 <= len(digits) <= 15:
        raise ValueError("Телефонный номер должен содержать от 7 до 15 цифр")
    return ("+" if raw.startswith("+") else "") + digits


def _extension(value: object) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"\d{2,6}", text):
        raise ValueError("Внутренняя линия должна содержать от 2 до 6 цифр")
    return text


def _destination(kind: str, target: object, public_number: str) -> str | list[str]:
    if kind == "internal":
        return _extension(target)
    if kind == "external":
        number = _phone(target)
        if re.sub(r"\D", "", number) == re.sub(r"\D", "", public_number):
            raise ValueError("Нельзя переадресовать вызов на тот же рабочий номер")
        return number
    if kind == "queue":
        members = [_extension(item) for item in re.split(r"[,;\s]+", str(target or "").strip()) if item]
        members = list(dict.fromkeys(members))
        if not 1 <= len(members) <= 20:
            raise ValueError("Укажите от 1 до 20 внутренних линий очереди")
        return members
    raise ValueError("Выберите тип направления")


def validate_ivr_form(form: Mapping[str, object]) -> dict:
    """Return a canonical configuration; no rule here changes a live PBX route."""
    public_number = _phone(form.get("public_number"))
    greeting = str(form.get("greeting_text") or "").strip()[:1000]
    routes = []
    for digit in "0123456789":
        prefix = f"route_{digit}_"
        kind = str(form.get(prefix + "kind") or "").strip()
        if not kind:
            continue
        if kind not in {"internal", "external", "queue"}:
            raise ValueError(f"Кнопка {digit}: неизвестный тип направления")
        try:
            target = _destination(kind, form.get(prefix + "target"), public_number)
            wait_seconds = int(str(form.get(prefix + "wait") or "30"))
            if not 5 <= wait_seconds <= 120:
                raise ValueError("время ожидания должно быть от 5 до 120 секунд")
            fallback_raw = str(form.get(prefix + "fallback") or "").strip()
            fallback = None
            if fallback_raw:
                fallback_kind = "internal" if re.fullmatch(r"\d{2,6}", fallback_raw) else "external"
                fallback = {"kind": fallback_kind, "target": _destination(fallback_kind, fallback_raw, public_number)}
        except ValueError as exc:
            raise ValueError(f"Кнопка {digit}: {exc}") from exc
        strategy = str(form.get(prefix + "strategy") or "ring_all").strip()
        if strategy not in {"ring_all", "round_robin"}:
            raise ValueError(f"Кнопка {digit}: неизвестная стратегия очереди")
        routes.append({"digit": digit, "kind": kind, "target": target,
                       "wait_seconds": wait_seconds, "fallback": fallback,
                       "strategy": strategy if kind == "queue" else ""})
    default_kind = str(form.get("default_kind") or "").strip()
    default_target = str(form.get("default_target") or "").strip()
    default_route = None
    if default_kind or default_target:
        if default_kind not in {"internal", "external", "queue"}:
            raise ValueError("Укажите тип направления без выбора кнопки")
        default_route = {"kind": default_kind,
                         "target": _destination(default_kind, default_target, public_number)}
    return {"public_number": public_number, "greeting_text": greeting,
            "routes": routes, "default_route": default_route,
            "state": "awaiting_provider_route"}
