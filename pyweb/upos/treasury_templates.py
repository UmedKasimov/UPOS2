"""Шаблоны «мест хранения» для песочницы казны (приоритет Узбекистан + международные)."""

from __future__ import annotations

from typing import Any

# icon: ключ для SVG в UI (см. schet-page.js)
TREASURY_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "cash_uz",
        "title": "Наличные",
        "subtitle": "Касса, сейф, оборотная касса",
        "icon": "cash",
        "region": "uz",
        "sort": 10,
    },
    {
        "id": "bank_settlement_uz",
        "title": "Расчётный счёт",
        "subtitle": "Юрлицо в банке Узбекистана",
        "icon": "bank",
        "region": "uz",
        "sort": 20,
    },
    {
        "id": "transit_company_uz",
        "title": "Транзит / лицевой счёт",
        "subtitle": "Счёт компании для перечислений",
        "icon": "building",
        "region": "uz",
        "sort": 30,
    },
    {
        "id": "plastic_uz",
        "title": "Банковская карта",
        "subtitle": "Humo, Uzcard, Visa, Mastercard",
        "icon": "card",
        "region": "uz",
        "sort": 40,
    },
    {
        "id": "mobile_uz",
        "title": "Мобильные кошельки",
        "subtitle": "Payme, Click, Uzum Bank и др.",
        "icon": "smartphone",
        "region": "uz",
        "sort": 50,
    },
    {
        "id": "foreign_currency_uz",
        "title": "Валютный счёт",
        "subtitle": "USD / EUR в узбекском банке",
        "icon": "globe",
        "region": "uz",
        "sort": 60,
    },
    {
        "id": "safe",
        "title": "Сейф / резерв",
        "subtitle": "Заначка, запас наличных",
        "icon": "vault",
        "region": "intl",
        "sort": 70,
    },
    {
        "id": "cash_intl",
        "title": "Наличные (общее)",
        "subtitle": "Личные / офисные средства",
        "icon": "cash",
        "region": "intl",
        "sort": 80,
    },
    {
        "id": "bank_corporate",
        "title": "Корпоративный банк",
        "subtitle": "Основной банковский счёт",
        "icon": "bank",
        "region": "intl",
        "sort": 90,
    },
    {
        "id": "broker",
        "title": "Брокер / инвестиции",
        "subtitle": "Ценные бумаги, депозитарий",
        "icon": "chart",
        "region": "intl",
        "sort": 100,
    },
    {
        "id": "crypto",
        "title": "Криптоактивы",
        "subtitle": "Биржа, холодный кошелёк",
        "icon": "crypto",
        "region": "intl",
        "sort": 110,
    },
    {
        "id": "receivable",
        "title": "Дебиторка",
        "subtitle": "Долги перед вами",
        "icon": "handshake",
        "region": "intl",
        "sort": 120,
    },
    {
        "id": "custom",
        "title": "Своё место",
        "subtitle": "Произвольное название и заметка",
        "icon": "custom",
        "region": "intl",
        "sort": 999,
    },
]

TREASURE_BY_ID: dict[str, dict[str, Any]] = {t["id"]: t for t in TREASURY_TEMPLATES}


def list_templates_public() -> list[dict[str, Any]]:
    """Для API/шаблона: без изменения исходных объектов."""
    return sorted(TREASURY_TEMPLATES, key=lambda x: (x.get("sort", 0), x["title"]))
