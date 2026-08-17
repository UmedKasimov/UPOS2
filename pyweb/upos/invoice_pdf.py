"""Накладная в PDF — то, что отправляют клиенту в мессенджер.

Клиент просит «пришлите накладную», и сотруднику незачем идти в журнал
продаж, печатать и сканировать: документ собирается здесь из тех же
данных, что показаны в карточке продажи.

Шрифт берём из самого reportlab (Bitstream Vera): в нём есть кириллица,
и он едет вместе с библиотекой, поэтому на сервере не нужно ставить
системные шрифты и следить за их наличием.
"""

from __future__ import annotations

import io
import os
from decimal import Decimal
from typing import Any

import reportlab
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_REGULAR = "UposSans"
FONT_BOLD = "UposSans-Bold"
_FONTS_READY = False


def _ensure_fonts() -> None:
    global _FONTS_READY
    if _FONTS_READY:
        return
    base = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    pdfmetrics.registerFont(TTFont(FONT_REGULAR, os.path.join(base, "Vera.ttf")))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, os.path.join(base, "VeraBd.ttf")))
    _FONTS_READY = True


def _money(value: Any, currency: str = "UZS") -> str:
    try:
        amount = Decimal(str(value or "0"))
    except Exception:
        amount = Decimal("0")
    quantized = amount.quantize(Decimal("0.01"))
    whole, _, frac = f"{quantized:f}".partition(".")
    sign = ""
    if whole.startswith("-"):
        sign, whole = "-", whole[1:]
    groups = []
    while whole:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    text = sign + " ".join(groups)
    if frac and frac.rstrip("0"):
        text += "," + frac.rstrip("0")
    return f"{text} {currency}".strip()


def _fit(text: str, font: str, size: float, width: float) -> str:
    """Обрезает длинное название, чтобы оно не залезло в соседнюю колонку."""
    value = str(text or "")
    if pdfmetrics.stringWidth(value, font, size) <= width:
        return value
    while value and pdfmetrics.stringWidth(value + "…", font, size) > width:
        value = value[:-1]
    return value + "…"


def build_invoice_pdf(document: dict[str, Any]) -> bytes:
    """Собирает накладную. `document` — данные продажи из журнала."""
    _ensure_fonts()
    buffer = io.BytesIO()
    page = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    left = 18 * mm
    right = width - 18 * mm
    y = height - 20 * mm

    currency = str(document.get("currency") or "UZS").upper()
    title = str(document.get("title") or "Накладная")
    number = str(document.get("number") or "")
    page.setTitle(f"{title} {number}".strip())

    page.setFont(FONT_BOLD, 16)
    page.drawString(left, y, f"{title} № {number}" if number else title)
    y -= 8 * mm

    page.setFont(FONT_REGULAR, 10)
    for label, value in (
        ("Организация", document.get("organization")),
        ("Дата", document.get("date")),
        ("Клиент", document.get("client")),
        ("Телефон", document.get("phone")),
        ("Статус", document.get("status")),
    ):
        text = str(value or "").strip()
        if not text:
            continue
        page.setFillColorRGB(0.42, 0.45, 0.5)
        page.drawString(left, y, f"{label}:")
        page.setFillColorRGB(0.1, 0.12, 0.16)
        page.drawString(left + 28 * mm, y, text)
        y -= 5.5 * mm

    y -= 3 * mm
    page.setStrokeColorRGB(0.85, 0.87, 0.9)
    page.line(left, y, right, y)
    y -= 7 * mm

    columns = [
        ("№", left, 8 * mm, "left"),
        ("Наименование", left + 10 * mm, 74 * mm, "left"),
        ("Кол-во", left + 86 * mm, 18 * mm, "right"),
        ("Цена", left + 106 * mm, 30 * mm, "right"),
        ("Сумма", left + 138 * mm, 36 * mm, "right"),
    ]
    page.setFont(FONT_BOLD, 9)
    page.setFillColorRGB(0.42, 0.45, 0.5)
    for label, x, col_width, align in columns:
        if align == "right":
            page.drawRightString(x + col_width, y, label)
        else:
            page.drawString(x, y, label)
    y -= 4 * mm
    page.line(left, y, right, y)
    y -= 6 * mm

    page.setFillColorRGB(0.1, 0.12, 0.16)
    lines = document.get("lines") if isinstance(document.get("lines"), list) else []
    for index, line in enumerate(lines, start=1):
        if y < 40 * mm:
            page.showPage()
            _ensure_fonts()
            y = height - 20 * mm
        page.setFont(FONT_REGULAR, 9)
        page.drawString(columns[0][1], y, str(index))
        page.drawString(
            columns[1][1],
            y,
            _fit(line.get("product"), FONT_REGULAR, 9, columns[1][2]),
        )
        page.drawRightString(columns[2][1] + columns[2][2], y, str(line.get("quantity") or ""))
        page.drawRightString(columns[3][1] + columns[3][2], y, _money(line.get("price"), currency))
        page.drawRightString(columns[4][1] + columns[4][2], y, _money(line.get("total"), currency))
        y -= 5.5 * mm

    if not lines:
        page.setFont(FONT_REGULAR, 9)
        page.setFillColorRGB(0.42, 0.45, 0.5)
        page.drawString(left, y, "В документе нет позиций.")
        y -= 6 * mm
        page.setFillColorRGB(0.1, 0.12, 0.16)

    y -= 2 * mm
    page.setStrokeColorRGB(0.85, 0.87, 0.9)
    page.line(left, y, right, y)
    y -= 8 * mm

    totals = [("Итого", document.get("amount"))]
    if document.get("paid") is not None:
        totals.append(("Оплачено", document.get("paid")))
    if document.get("debt") is not None:
        totals.append(("Долг", document.get("debt")))
    for label, value in totals:
        page.setFont(FONT_BOLD if label == "Итого" else FONT_REGULAR, 11 if label == "Итого" else 10)
        page.drawRightString(right - 40 * mm, y, f"{label}:")
        page.drawRightString(right, y, _money(value, currency))
        y -= 6 * mm

    note = str(document.get("note") or "").strip()
    if note:
        y -= 4 * mm
        page.setFont(FONT_REGULAR, 9)
        page.setFillColorRGB(0.42, 0.45, 0.5)
        page.drawString(left, y, _fit("Комментарий: " + note, FONT_REGULAR, 9, right - left))

    page.setFont(FONT_REGULAR, 8)
    page.setFillColorRGB(0.55, 0.58, 0.62)
    page.drawString(left, 14 * mm, "Документ сформирован в U-POS")

    page.showPage()
    page.save()
    return buffer.getvalue()
