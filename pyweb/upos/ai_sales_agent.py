from __future__ import annotations

import os
from typing import Any

import httpx


SUPPORTED_CHANNELS = {"site", "telegram", "instagram", "whatsapp", "facebook"}


def agent_enabled(settings: dict[str, Any], channel: str) -> bool:
    config = settings.get("messenger_auto_reply") if isinstance(settings.get("messenger_auto_reply"), dict) else {}
    if not bool(config.get("ai_enabled")):
        return False
    channels = config.get("ai_channels") if isinstance(config.get("ai_channels"), dict) else {}
    return bool(channels.get(str(channel or "").strip().lower()))


def _lead_stage(messages: list[dict[str, Any]], phone: str) -> str:
    text = " ".join(str(item.get("text") or "") for item in messages).lower()
    if not phone:
        return "phone"
    if not any(word in text for word in ("магазин", "кафе", "ресторан", "аптека", "склад", "бизнес", "do'kon", "dukoni", "kafe")):
        return "business"
    if not any(word in text for word in ("самарканд", "ташкент", "город", "shahar", "samarqand", "toshkent")):
        return "city"
    return "lead"


def _api_key() -> str:
    return (os.getenv("UPOS_AI_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()


def _unavailable() -> dict[str, Any]:
    # An unavailable AI must stay silent instead of impersonating it with canned replies.
    return {"text": "", "lead_ready": False, "source": "unavailable"}


async def generate_reply(
    *,
    settings: dict[str, Any],
    channel: str,
    name: str,
    phone: str,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    config = settings.get("messenger_auto_reply") if isinstance(settings.get("messenger_auto_reply"), dict) else {}
    knowledge = str(config.get("ai_knowledge") or "").strip()
    key = _api_key()
    if not key:
        return _unavailable()

    transcript = "\n".join(
        f"{'Клиент' if str(item.get('direction') or item.get('kind') or '') == 'in' else 'Оператор'}: {str(item.get('text') or '')[:1000]}"
        for item in messages[-20:]
    )
    system = (
        "Ты AI-продавец U-POS. Отвечай кратко, дружелюбно, на русском или узбекском по языку клиента. "
        "Цель: помочь клиенту, собрать имя, телефон, город, тип бизнеса и довести до лида. "
        "Не обещай скидки, кредит, точные сроки и юридические условия без подтверждения менеджера. "
        "Если вопрос сложный, скажи что подключишь менеджера."
    )
    if knowledge:
        system += "\nБаза знаний U-POS:\n" + knowledge[:6000]
    payload = {
        "model": os.getenv("UPOS_AI_MODEL", "gpt-4o-mini"),
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": f"Канал: {channel}\nИмя: {name or '-'}\nТелефон: {phone or '-'}\nИстория:\n{transcript}\n\nСформируй следующий ответ клиенту.",
            },
        ],
        "temperature": 0.35,
        "max_tokens": 280,
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                os.getenv("UPOS_AI_BASE_URL", "https://api.openai.com/v1").rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
    except Exception:
        return _unavailable()
    text = str(data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    if not text:
        return _unavailable()
    return {"text": text[:4000], "lead_ready": _lead_stage(messages, phone) == "lead", "source": "ai"}
