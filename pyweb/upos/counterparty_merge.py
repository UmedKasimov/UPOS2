"""Слияние дубликатов контрагентов, порождённых кассой.

Касса создавала контрагентов с external_id вида ``client:<имя>`` /
``supplier:<имя>``, не находя записи раздела «Клиенты» (у тех ключ
``manual:<слаг>``). Такие дубликаты пустые: без телефона, ИНН и адреса,
поэтому их можно слить в старейшую «настоящую» запись с тем же именем,
перевесив все ссылки. Настоящих тёзок (двух разных клиентов с одним
именем, заведённых вручную) слияние не трогает.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_, select, update

from upos.db import session_scope
from upos.db_models import (
    Counterparty,
    CrmRecord,
    ExpenseDocument,
    InstallationOrder,
    PaymentDocument,
    PurchaseDocument,
    SaleDocument,
    TelegramBusinessMessage,
    Transaction,
)

# Все таблицы с FK counterparty_id, которые нужно перевесить на выжившего.
_REFERENCING_MODELS = (
    Transaction,
    SaleDocument,
    PurchaseDocument,
    CrmRecord,
    PaymentDocument,
    ExpenseDocument,
    TelegramBusinessMessage,
    InstallationOrder,
)

# Поля карточки, которые переносим в выжившего, если у него они пустые.
_FILLABLE_COLUMNS = ("phone", "tax_id")


def _is_cash_born(row: Counterparty) -> bool:
    external_id = str(row.external_id or "")
    return (
        str(row.external_source or "") == "manual"
        and (external_id.startswith("client:") or external_id.startswith("supplier:"))
    )


def find_cash_duplicates(workspace_owner_id: str) -> list[dict[str, Any]]:
    """Группы «кассовый дубль → выживший» без изменения данных."""
    groups: list[dict[str, Any]] = []
    with session_scope() as session:
        rows = list(
            session.execute(
                select(Counterparty)
                .where(Counterparty.workspace_owner_id == workspace_owner_id)
                .order_by(Counterparty.created_at.asc())
            ).scalars()
        )
        by_name: dict[str, list[Counterparty]] = {}
        for row in rows:
            by_name.setdefault(row.name.strip().lower(), []).append(row)
        for name, entries in by_name.items():
            if len(entries) < 2:
                continue
            survivors = [row for row in entries if not _is_cash_born(row)]
            duplicates = [row for row in entries if _is_cash_born(row)]
            if not duplicates:
                continue
            # Выживший — старейшая некассовая запись; если все кассовые,
            # оставляем старейшую кассовую (она и есть единственный источник).
            keeper = survivors[0] if survivors else duplicates.pop(0)
            if not duplicates:
                continue
            groups.append(
                {
                    "name": name,
                    "keeper_id": keeper.id,
                    "keeper_external_id": keeper.external_id,
                    "duplicate_ids": [row.id for row in duplicates],
                    "duplicate_external_ids": [row.external_id for row in duplicates],
                }
            )
    return groups


def merge_cash_duplicates(workspace_owner_id: str, *, dry_run: bool = True) -> dict[str, Any]:
    """Слить кассовые дубликаты. При dry_run только отчёт, база не меняется.

    В ответ входит журнал отката ``undo``: полные копии удалённых записей и
    список перевешенных документов — по нему слияние можно развернуть вручную.
    """
    groups = find_cash_duplicates(workspace_owner_id)
    report: dict[str, Any] = {
        "dry_run": dry_run,
        "groups": len(groups),
        "duplicates": sum(len(group["duplicate_ids"]) for group in groups),
        "relinked": 0,
        "deleted": 0,
        "names": [group["name"] for group in groups[:50]],
        "undo": [],
    }
    if dry_run or not groups:
        return report

    with session_scope() as session:
        for group in groups:
            keeper = session.get(Counterparty, group["keeper_id"])
            if keeper is None or keeper.workspace_owner_id != workspace_owner_id:
                continue
            for duplicate_id in group["duplicate_ids"]:
                duplicate = session.get(Counterparty, duplicate_id)
                if duplicate is None or duplicate.workspace_owner_id != workspace_owner_id:
                    continue
                undo_entry: dict[str, Any] = {
                    "keeper_id": keeper.id,
                    "deleted_row": {
                        "id": duplicate.id,
                        "workspace_owner_id": duplicate.workspace_owner_id,
                        "kind": duplicate.kind,
                        "name": duplicate.name,
                        "phone": duplicate.phone,
                        "tax_id": duplicate.tax_id,
                        "external_source": duplicate.external_source,
                        "external_id": duplicate.external_id,
                        "data": duplicate.data if isinstance(duplicate.data, dict) else {},
                        "created_at": duplicate.created_at.isoformat() if duplicate.created_at else "",
                    },
                    "relinked": {},
                }
                for model in _REFERENCING_MODELS:
                    moved_ids = [
                        str(row_id)
                        for (row_id,) in session.execute(
                            select(model.id).where(model.counterparty_id == duplicate.id)
                        )
                    ]
                    if moved_ids:
                        undo_entry["relinked"][model.__tablename__] = moved_ids
                    result = session.execute(
                        update(model)
                        .where(model.counterparty_id == duplicate.id)
                        .values(counterparty_id=keeper.id)
                    )
                    report["relinked"] += int(result.rowcount or 0)
                for column in _FILLABLE_COLUMNS:
                    if not str(getattr(keeper, column) or "").strip():
                        value = str(getattr(duplicate, column) or "").strip()
                        if value:
                            setattr(keeper, column, value)
                # Роль both, если дубль расширял роли (клиент платил и как поставщик).
                keeper_kinds = {keeper.kind, duplicate.kind}
                if keeper_kinds == {"client", "supplier"} or "both" in keeper_kinds:
                    keeper.kind = "both"
                session.delete(duplicate)
                report["deleted"] += 1
                report["undo"].append(undo_entry)
        session.flush()
    return report
