"""Загрузка клиентов из файла Excel.

Рассчитана на выгрузку 2GIS и на любой похожий файл: колонки узнаются по
названию, поэтому порядок и лишние столбцы значения не имеют. Повторная
загрузка того же файла новых записей не создаёт — клиент опознаётся по
номеру карточки 2GIS, телефону или названию с адресом.
"""

from __future__ import annotations

import logging
import re
import uuid
from io import BytesIO
from typing import Any, Iterable

from sqlalchemy import select

from upos.db import session_scope
from upos.db_models import Counterparty

logger = logging.getLogger("upos.clients_import")

EXTERNAL_SOURCE = "excel-import"

# Названия колонок в нижнем регистре без пробелов по краям.
COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "name": ("наименование", "название", "клиент", "компания", "name"),
    "official_name": ("юридическое название", "юр. название", "полное название"),
    "category": ("рубрики", "рубрика", "категория", "категории"),
    "address": ("адрес", "address"),
    "address_note": ("комментарий к адресу", "ориентир"),
    "city": ("город", "city"),
    "region": ("область", "регион"),
    "country": ("страна", "country"),
    "postcode": ("почтовый индекс", "индекс"),
    "hours": ("часы работы", "режим работы"),
    "rating": ("рейтинг",),
    "reviews": ("количество отзывов", "отзывы"),
    "email": ("e-mail", "email", "e-mail 1", "почта"),
    "site": ("веб-сайт", "сайт", "веб-сайт 1", "website"),
    "instagram": ("instagram", "инстаграм"),
    "facebook": ("facebook",),
    "whatsapp": ("whatsapp",),
    "telegram": ("telegram", "telegram 1", "телеграм"),
    "youtube": ("youtube",),
    "latitude": ("широта", "latitude", "lat"),
    "longitude": ("долгота", "longitude", "lon", "lng"),
    "external_url": ("2gis url", "2гис url", "ссылка"),
}
PHONE_COLUMNS = ("телефон", "телефон 1", "телефон 2", "телефон 3", "phone", "телефоны")


def _clean(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def _digits(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _coordinate(value: Any, *, limit: float) -> str:
    raw = _clean(value).replace(",", ".")
    if not raw:
        return ""
    try:
        number = float(raw)
    except ValueError:
        return ""
    if not (-limit <= number <= limit) or number == 0:
        return ""
    return f"{number:.6f}".rstrip("0").rstrip(".")


def _first_segment(value: str) -> str:
    """Из «Кафе; Кофейня» берём первое — оно и есть основная рубрика."""
    for part in re.split(r"[;,]", value):
        cleaned = _clean(part)
        if cleaned:
            return cleaned
    return ""


def _external_key(row: dict[str, str]) -> str:
    """Номер карточки 2GIS — самый надёжный признак того же заведения."""
    url = row.get("external_url") or ""
    match = re.search(r"/firm/(\d+)", url)
    if match:
        return f"2gis:{match.group(1)}"
    return ""


def _header_map(header: Iterable[Any]) -> dict[int, str]:
    """Сопоставляет столбцы файла с полями карточки клиента."""
    mapping: dict[int, str] = {}
    for index, title in enumerate(header):
        key = _clean(title).lower()
        if not key:
            continue
        if key in PHONE_COLUMNS or key.startswith("телефон"):
            mapping[index] = "phone"
            continue
        for field, aliases in COLUMN_ALIASES.items():
            if key in aliases:
                mapping[index] = field
                break
    return mapping


def read_clients_file(content: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    """Разбирает файл в список карточек. Второе значение — замечания."""
    try:
        import openpyxl
    except ImportError as exc:  # pragma: no cover - пакет есть в зависимостях
        raise RuntimeError("Не установлен пакет openpyxl") from exc

    notes: list[str] = []
    workbook = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True)
    rows: list[dict[str, Any]] = []
    try:
        sheet = workbook.worksheets[0]
        iterator = sheet.iter_rows(values_only=True)
        try:
            header = next(iterator)
        except StopIteration:
            return [], ["Файл пустой"]
        mapping = _header_map(header)
        if "name" not in mapping.values():
            return [], ["В файле нет колонки с названием клиента"]

        for line_number, raw in enumerate(iterator, start=2):
            values: dict[str, str] = {}
            phones: list[str] = []
            for index, cell in enumerate(raw):
                field = mapping.get(index)
                if not field:
                    continue
                text = _clean(cell)
                if not text:
                    continue
                if field == "phone":
                    phones.append(text)
                elif field not in values:
                    values[field] = text

            name = values.get("name") or ""
            if not name:
                continue
            phone_list: list[str] = []
            for item in phones:
                for part in re.split(r"[;,]", item):
                    digits = _digits(part)
                    if digits and digits not in {_digits(x) for x in phone_list}:
                        phone_list.append(_clean(part))

            rows.append(
                {
                    "line": line_number,
                    "name": name,
                    "official_name": values.get("official_name", ""),
                    "phone": phone_list[0] if phone_list else "",
                    "extra_phones": phone_list[1:],
                    "category": _first_segment(values.get("category", "")),
                    "category_full": values.get("category", ""),
                    "address": values.get("address", ""),
                    "address_note": values.get("address_note", ""),
                    "city": values.get("city", ""),
                    "region": values.get("region", ""),
                    "country": values.get("country", ""),
                    "postcode": values.get("postcode", ""),
                    "hours": values.get("hours", ""),
                    "rating": values.get("rating", ""),
                    "reviews": values.get("reviews", ""),
                    "email": values.get("email", ""),
                    "site": values.get("site", ""),
                    "instagram": values.get("instagram", ""),
                    "facebook": values.get("facebook", ""),
                    "whatsapp": values.get("whatsapp", ""),
                    "telegram": values.get("telegram", ""),
                    "youtube": values.get("youtube", ""),
                    "latitude": _coordinate(values.get("latitude"), limit=90),
                    "longitude": _coordinate(values.get("longitude"), limit=180),
                    "external_url": values.get("external_url", ""),
                }
            )
    finally:
        workbook.close()

    without_coords = sum(1 for row in rows if not (row["latitude"] and row["longitude"]))
    if without_coords:
        notes.append(f"Без координат: {without_coords}")
    return rows, notes


def _client_payload(row: dict[str, Any]) -> dict[str, Any]:
    """Собирает данные карточки клиента из строки файла."""
    address_parts = [row["address"], row["address_note"]]
    address = ", ".join(part for part in address_parts if part)
    if not address:
        address = ", ".join(part for part in (row["city"], row["region"]) if part)

    payload = {
        "address": address,
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "category": row["category"],
        "client_type": "company",
        "industry": row["category"],
        "email": row["email"],
        "site": row["site"],
        "instagram": row["instagram"],
        "facebook": row["facebook"],
        "whatsapp": row["whatsapp"],
        "telegram": row["telegram"],
        "youtube": row["youtube"],
        "city": row["city"],
        "region": row["region"],
        "country": row["country"],
        "postcode": row["postcode"],
        "work_hours": row["hours"],
        "rating": row["rating"],
        "reviews_count": row["reviews"],
        "source": "Загрузка из файла",
        "external_url": row["external_url"],
    }
    if row["extra_phones"]:
        payload["extra_phones"] = row["extra_phones"]
    if row["category_full"] and row["category_full"] != row["category"]:
        payload["category_list"] = row["category_full"]
    return {key: value for key, value in payload.items() if value not in ("", None, [])}


def import_clients(
    workspace_owner_id: str,
    rows: list[dict[str, Any]],
    *,
    update_existing: bool = True,
) -> dict[str, int]:
    """Заводит клиентов из разобранных строк.

    Уже заведённого клиента не дублируем: ищем по номеру карточки 2GIS,
    затем по телефону, затем по названию с адресом.
    """
    created = 0
    updated = 0
    skipped = 0

    with session_scope() as session:
        existing = session.execute(
            select(Counterparty).where(Counterparty.workspace_owner_id == workspace_owner_id)
        ).scalars().all()

        by_external: dict[str, Counterparty] = {}
        by_phone: dict[str, Counterparty] = {}
        by_name_address: dict[str, Counterparty] = {}
        for item in existing:
            data = item.data if isinstance(item.data, dict) else {}
            if item.external_id:
                by_external.setdefault(str(item.external_id), item)
            phone_digits = _digits(item.phone or data.get("phone"))
            if len(phone_digits) >= 9:
                by_phone.setdefault(phone_digits[-9:], item)
            name_key = _clean(item.name).lower()
            if name_key:
                address_key = _clean(data.get("address")).lower()
                by_name_address.setdefault(f"{name_key}|{address_key}", item)

        for row in rows:
            payload = _client_payload(row)
            external_key = _external_key(row)
            phone_digits = _digits(row["phone"])
            name_key = _clean(row["name"]).lower()
            address_key = _clean(payload.get("address")).lower()

            found = None
            if external_key:
                found = by_external.get(external_key)
            if found is None and len(phone_digits) >= 9:
                found = by_phone.get(phone_digits[-9:])
            if found is None:
                found = by_name_address.get(f"{name_key}|{address_key}")

            if found is not None:
                if not update_existing:
                    skipped += 1
                    continue
                data = dict(found.data if isinstance(found.data, dict) else {})
                changed = False
                for key, value in payload.items():
                    # Уже заполненное вручную не затираем.
                    if not str(data.get(key) or "").strip():
                        data[key] = value
                        changed = True
                if not str(found.phone or "").strip() and row["phone"]:
                    found.phone = row["phone"][:64]
                    changed = True
                if external_key and not str(found.external_id or "").strip():
                    found.external_source = EXTERNAL_SOURCE
                    found.external_id = external_key[:180]
                    changed = True
                if changed:
                    found.data = data
                    updated += 1
                else:
                    skipped += 1
                continue

            client = Counterparty(
                id=str(uuid.uuid4()),
                workspace_owner_id=workspace_owner_id,
                kind="client",
                name=row["name"][:255],
                phone=row["phone"][:64],
                external_source=EXTERNAL_SOURCE if external_key else "",
                external_id=external_key[:180] if external_key else "",
                data=payload,
            )
            session.add(client)
            created += 1
            if external_key:
                by_external[external_key] = client
            if len(phone_digits) >= 9:
                by_phone[phone_digits[-9:]] = client
            by_name_address[f"{name_key}|{address_key}"] = client

    return {"created": created, "updated": updated, "skipped": skipped, "total": len(rows)}
