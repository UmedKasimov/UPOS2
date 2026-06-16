from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from collections.abc import Iterable
from typing import Any

from sqlalchemy import text

from upos.db import get_engine

BACKUP_VERSION = 1

IMPORT_TABLE_ORDER = (
    "users",
    "organizations",
    "positions",
    "roles",
    "workspace_settings",
    "treasuries",
    "finance_categories",
    "counterparties",
    "branches",
    "hr_employees",
    "hr_attendance",
    "delivery_shipments",
    "delivery_shipment_items",
    "finance_accounts",
    "account_balances",
    "employee_organizations",
    "employee_account_access",
    "transactions",
    "transaction_entries",
    "external_records",
    "integration_sync_runs",
    "products",
    "warehouses",
    "sale_documents",
    "purchase_documents",
    "payment_documents",
    "expense_documents",
    "telegram_bot_configs",
    "telegram_chats",
    "telegram_subscribers",
    "telegram_delivery_log",
)

TABLE_CONFLICT_KEYS: dict[str, tuple[str, ...]] = {
    "employee_organizations": ("employee_id", "organization_id"),
    "employee_account_access": ("employee_id", "account_id"),
    "workspace_settings": ("workspace_owner_id",),
    "treasuries": ("workspace_owner_id",),
    "telegram_bot_configs": ("workspace_owner_id",),
}

WORKSPACE_TABLES = (
    "telegram_delivery_log",
    "telegram_subscribers",
    "telegram_chats",
    "telegram_bot_configs",
    "integration_sync_runs",
    "external_records",
    "sale_documents",
    "purchase_documents",
    "payment_documents",
    "expense_documents",
    "products",
    "warehouses",
    "delivery_shipments",
    "hr_attendance",
    "hr_employees",
    "finance_categories",
    "counterparties",
    "branches",
    "roles",
    "treasuries",
    "workspace_settings",
    "finance_accounts",
    "transactions",
)


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _json_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: _json_value(value) for key, value in row.items()}


def _fetch_rows(conn, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    rows = conn.execute(text(sql), params).mappings().all()
    return [_json_row(dict(row)) for row in rows]


def _table_columns(conn, table: str, cache: dict[str, list[str]]) -> list[str]:
    if table not in cache:
        cache[table] = [
            str(row)
            for row in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = :table "
                    "ORDER BY ordinal_position"
                ),
                {"table": table},
            ).scalars()
        ]
    return cache[table]


def _delete_rows_by_column(conn, table: str, column: str, value: str) -> int:
    clean = str(value or "").strip()
    if not clean:
        return 0
    return int(
        conn.execute(
            text(f'DELETE FROM public."{table}" WHERE "{column}" = :value'),
            {"value": clean},
        ).rowcount
        or 0
    )


def _workspace_ids_for_owner(conn, owner_id: str) -> list[str]:
    owner = str(owner_id or "").strip()
    if not owner:
        raise ValueError("workspace_owner_id_required")
    ids = [owner]
    rows = conn.execute(
        text('SELECT id FROM public."organizations" WHERE owner_user_id = :owner'),
        {"owner": owner},
    ).scalars()
    for row in rows:
        value = str(row or "").strip()
        if value and value not in ids:
            ids.append(value)
    return ids


def _sum_count(target: dict[str, int], key: str, value: Any) -> None:
    target[key] = int(target.get(key) or 0) + int(value or 0)


def _count_workspace_rows(conn, table: str, workspace_id: str) -> int:
    return int(
        conn.execute(
            text(f'SELECT COUNT(*) FROM public."{table}" WHERE workspace_owner_id = :workspace_id'),
            {"workspace_id": workspace_id},
        ).scalar()
        or 0
    )


def _delete_workspace_rows(conn, table: str, workspace_id: str) -> int:
    return int(
        conn.execute(
            text(f'DELETE FROM public."{table}" WHERE workspace_owner_id = :workspace_id'),
            {"workspace_id": workspace_id},
        ).rowcount
        or 0
    )


def _clear_transactions_for_workspaces(conn, workspace_ids: Iterable[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for workspace_id in [str(value or "").strip() for value in workspace_ids if str(value or "").strip()]:
        _sum_count(counts, "transactions", _count_workspace_rows(conn, "transactions", workspace_id))
        _sum_count(
            counts,
            "transaction_entries",
            conn.execute(
                text(
                    'SELECT COUNT(*) FROM public."transaction_entries" AS e '
                    'JOIN public."transactions" AS t ON t.id = e.transaction_id '
                    "WHERE t.workspace_owner_id = :workspace_id"
                ),
                {"workspace_id": workspace_id},
            ).scalar(),
        )
        _sum_count(counts, "payment_documents", _count_workspace_rows(conn, "payment_documents", workspace_id))
        _sum_count(counts, "expense_documents", _count_workspace_rows(conn, "expense_documents", workspace_id))
        _sum_count(
            counts,
            "account_balances",
            conn.execute(
                text(
                    'SELECT COUNT(*) FROM public."account_balances" AS b '
                    'JOIN public."finance_accounts" AS a ON a.id = b.account_id '
                    "WHERE a.workspace_owner_id = :workspace_id"
                ),
                {"workspace_id": workspace_id},
            ).scalar(),
        )

        conn.execute(
            text('DELETE FROM public."payment_documents" WHERE workspace_owner_id = :workspace_id'),
            {"workspace_id": workspace_id},
        )
        conn.execute(
            text('DELETE FROM public."expense_documents" WHERE workspace_owner_id = :workspace_id'),
            {"workspace_id": workspace_id},
        )
        conn.execute(
            text(
                'DELETE FROM public."transaction_entries" AS e '
                'USING public."transactions" AS t '
                "WHERE t.id = e.transaction_id AND t.workspace_owner_id = :workspace_id"
            ),
            {"workspace_id": workspace_id},
        )
        conn.execute(
            text('DELETE FROM public."transactions" WHERE workspace_owner_id = :workspace_id'),
            {"workspace_id": workspace_id},
        )
        conn.execute(
            text(
                'DELETE FROM public."account_balances" AS b '
                'USING public."finance_accounts" AS a '
                "WHERE a.id = b.account_id AND a.workspace_owner_id = :workspace_id"
            ),
            {"workspace_id": workspace_id},
        )
    return counts


def clear_workspace_transactions(workspace_owner_id: str) -> dict[str, Any]:
    owner = str(workspace_owner_id or "").strip()
    if not owner:
        raise ValueError("workspace_owner_id_required")

    with get_engine().begin() as conn:
        workspace_ids = _workspace_ids_for_owner(conn, owner)
        counts = _clear_transactions_for_workspaces(conn, workspace_ids)
        counts["workspaces"] = len(workspace_ids)

    return counts


def _clear_workspace_database_for_owner(
    conn,
    owner: str,
    extra_workspace_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    workspace_ids = _workspace_ids_for_owner(conn, owner)
    for value in extra_workspace_ids or ():
        clean = str(value or "").strip()
        if clean and clean not in workspace_ids:
            workspace_ids.append(clean)
    counts = _clear_transactions_for_workspaces(conn, workspace_ids)

    for workspace_id in workspace_ids:
        _sum_count(
            counts,
            "delivery_shipment_items",
            conn.execute(
                text(
                    'DELETE FROM public."delivery_shipment_items" AS item '
                    'USING public."delivery_shipments" AS shipment '
                    "WHERE shipment.id = item.shipment_id AND shipment.workspace_owner_id = :workspace_id"
                ),
                {"workspace_id": workspace_id},
            ).rowcount,
        )
        for table in (
            "telegram_delivery_log",
            "telegram_subscribers",
            "telegram_chats",
            "telegram_bot_configs",
            "integration_sync_runs",
            "external_records",
            "sale_documents",
            "purchase_documents",
            "products",
            "warehouses",
            "delivery_shipments",
            "hr_attendance",
            "hr_employees",
            "finance_categories",
            "counterparties",
            "branches",
            "roles",
            "treasuries",
            "workspace_settings",
        ):
            _sum_count(counts, table, _delete_workspace_rows(conn, table, workspace_id))

        _sum_count(
            counts,
            "employee_account_access",
            conn.execute(
                text(
                    'DELETE FROM public."employee_account_access" AS access '
                    'USING public."finance_accounts" AS account '
                    "WHERE account.id = access.account_id AND account.workspace_owner_id = :workspace_id"
                ),
                {"workspace_id": workspace_id},
            ).rowcount,
        )
        _sum_count(counts, "finance_accounts", _delete_workspace_rows(conn, "finance_accounts", workspace_id))

    _sum_count(
        counts,
        "positions",
        conn.execute(
            text(
                'DELETE FROM public."positions" AS pos '
                'USING public."organizations" AS org '
                "WHERE org.id = pos.organization_id AND org.owner_user_id = :owner"
            ),
            {"owner": owner},
        ).rowcount,
    )
    _sum_count(
        counts,
        "employee_organizations",
        conn.execute(
            text(
                'DELETE FROM public."employee_organizations" AS rel '
                'USING public."organizations" AS org '
                "WHERE org.id = rel.organization_id AND org.owner_user_id = :owner"
            ),
            {"owner": owner},
        ).rowcount,
    )
    for workspace_id in workspace_ids:
        if workspace_id == owner:
            continue
        _sum_count(counts, "positions", _delete_rows_by_column(conn, "positions", "organization_id", workspace_id))
        _sum_count(
            counts,
            "employee_organizations",
            _delete_rows_by_column(conn, "employee_organizations", "organization_id", workspace_id),
        )
    _sum_count(
        counts,
        "user_auth_sessions",
        conn.execute(
            text(
                'DELETE FROM public."user_auth_sessions" AS auth '
                'USING public."users" AS employee '
                "WHERE employee.id = auth.user_id AND employee.employer_user_id = :owner"
            ),
            {"owner": owner},
        ).rowcount,
    )
    _sum_count(
        counts,
        "employees",
        conn.execute(
            text('DELETE FROM public."users" WHERE employer_user_id = :owner'),
            {"owner": owner},
        ).rowcount,
    )
    _sum_count(
        counts,
        "organizations",
        conn.execute(
            text('DELETE FROM public."organizations" WHERE owner_user_id = :owner'),
            {"owner": owner},
        ).rowcount,
    )
    for workspace_id in workspace_ids:
        if workspace_id == owner:
            continue
        _sum_count(counts, "organizations", _delete_rows_by_column(conn, "organizations", "id", workspace_id))
    counts["workspaces"] = len(workspace_ids)

    return counts


def clear_workspace_database(workspace_owner_id: str) -> dict[str, Any]:
    owner = str(workspace_owner_id or "").strip()
    if not owner:
        raise ValueError("workspace_owner_id_required")

    with get_engine().begin() as conn:
        counts = _clear_workspace_database_for_owner(conn, owner)

    return counts


def export_workspace_database(workspace_owner_id: str) -> dict[str, Any]:
    owner = str(workspace_owner_id or "").strip()
    if not owner:
        raise ValueError("workspace_owner_id_required")

    with get_engine().connect() as conn:
        owner_rows = _fetch_rows(
            conn,
            'SELECT * FROM public."users" WHERE id = :owner AND role = :role AND employer_user_id IS NULL',
            {"owner": owner, "role": "user"},
        )
        if not owner_rows:
            raise ValueError("account_not_found")
        workspace_ids = _workspace_ids_for_owner(conn, owner)
        tables: dict[str, list[dict[str, Any]]] = {}
        tables["users"] = _fetch_rows(
            conn,
            'SELECT * FROM public."users" WHERE id = :owner OR employer_user_id = :owner ORDER BY employer_user_id NULLS FIRST, username',
            {"owner": owner},
        )
        tables["organizations"] = _fetch_rows(
            conn,
            'SELECT * FROM public."organizations" WHERE owner_user_id = :owner ORDER BY created_at, name',
            {"owner": owner},
        )
        tables["employee_organizations"] = _fetch_rows(
            conn,
            'SELECT rel.* FROM public."employee_organizations" AS rel '
            'JOIN public."organizations" AS org ON org.id = rel.organization_id '
            "WHERE org.owner_user_id = :owner ORDER BY rel.organization_id, rel.employee_id",
            {"owner": owner},
        )
        tables["employee_account_access"] = _fetch_rows(
            conn,
            'SELECT access.* FROM public."employee_account_access" AS access '
            'JOIN public."finance_accounts" AS account ON account.id = access.account_id '
            "WHERE account.workspace_owner_id = ANY(:workspace_ids) ORDER BY access.account_id, access.employee_id",
            {"workspace_ids": workspace_ids},
        )
        tables["positions"] = _fetch_rows(
            conn,
            'SELECT pos.* FROM public."positions" AS pos '
            'JOIN public."organizations" AS org ON org.id = pos.organization_id '
            "WHERE org.owner_user_id = :owner ORDER BY pos.organization_id, pos.name",
            {"owner": owner},
        )
        for table in WORKSPACE_TABLES:
            tables[table] = _fetch_rows(
                conn,
                f'SELECT * FROM public."{table}" WHERE workspace_owner_id = ANY(:workspace_ids)',
                {"workspace_ids": workspace_ids},
            )
        tables["account_balances"] = _fetch_rows(
            conn,
            'SELECT balance.* FROM public."account_balances" AS balance '
            'JOIN public."finance_accounts" AS account ON account.id = balance.account_id '
            "WHERE account.workspace_owner_id = ANY(:workspace_ids) ORDER BY balance.account_id, balance.currency",
            {"workspace_ids": workspace_ids},
        )
        tables["transaction_entries"] = _fetch_rows(
            conn,
            'SELECT entry.* FROM public."transaction_entries" AS entry '
            'JOIN public."transactions" AS tx ON tx.id = entry.transaction_id '
            "WHERE tx.workspace_owner_id = ANY(:workspace_ids) ORDER BY entry.transaction_id, entry.created_at",
            {"workspace_ids": workspace_ids},
        )
        tables["delivery_shipment_items"] = _fetch_rows(
            conn,
            'SELECT item.* FROM public."delivery_shipment_items" AS item '
            'JOIN public."delivery_shipments" AS shipment ON shipment.id = item.shipment_id '
            "WHERE shipment.workspace_owner_id = ANY(:workspace_ids) ORDER BY item.shipment_id, item.created_at",
            {"workspace_ids": workspace_ids},
        )

    return {
        "format": "upos-finance-account-backup",
        "version": BACKUP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "owner_id": owner,
            "account_id": owner_rows[0].get("account_id") or owner,
            "username": owner_rows[0].get("username") or "",
            "name": owner_rows[0].get("name") or "",
        },
        "workspace_ids": workspace_ids,
        "tables": {table: tables.get(table, []) for table in IMPORT_TABLE_ORDER},
        "row_counts": {table: len(tables.get(table, [])) for table in IMPORT_TABLE_ORDER},
    }


def _upsert_rows(conn, table: str, rows: list[dict[str, Any]], column_cache: dict[str, list[str]]) -> int:
    if not rows:
        return 0
    columns = _table_columns(conn, table, column_cache)
    conflict_keys = TABLE_CONFLICT_KEYS.get(table, ("id",))
    saved = 0
    for row in rows:
        clean = {key: row.get(key) for key in columns if key in row}
        if not clean or any(key not in clean for key in conflict_keys):
            continue
        insert_columns = list(clean.keys())
        col_sql = ", ".join(f'"{key}"' for key in insert_columns)
        value_sql = ", ".join(f":{key}" for key in insert_columns)
        conflict_sql = ", ".join(f'"{key}"' for key in conflict_keys)
        update_columns = [key for key in insert_columns if key not in conflict_keys]
        if update_columns:
            update_sql = ", ".join(f'"{key}" = EXCLUDED."{key}"' for key in update_columns)
            conflict_action = f"DO UPDATE SET {update_sql}"
        else:
            conflict_action = "DO NOTHING"
        conn.execute(
            text(
                f'INSERT INTO public."{table}" ({col_sql}) '
                f"VALUES ({value_sql}) ON CONFLICT ({conflict_sql}) {conflict_action}"
            ),
            clean,
        )
        saved += 1
    return saved


def restore_workspace_database(workspace_owner_id: str, backup: dict[str, Any]) -> dict[str, Any]:
    owner = str(workspace_owner_id or "").strip()
    if not owner:
        raise ValueError("workspace_owner_id_required")
    if not isinstance(backup, dict) or backup.get("format") != "upos-finance-account-backup":
        raise ValueError("backup_format")
    if int(backup.get("version") or 0) != BACKUP_VERSION:
        raise ValueError("backup_version")
    source = backup.get("source") if isinstance(backup.get("source"), dict) else {}
    source_owner = str(source.get("owner_id") or "").strip()
    if source_owner != owner:
        raise ValueError("backup_account_mismatch")
    tables = backup.get("tables")
    if not isinstance(tables, dict):
        raise ValueError("backup_tables")
    backup_workspace_ids = [
        str(value or "").strip()
        for value in (backup.get("workspace_ids") if isinstance(backup.get("workspace_ids"), list) else [])
        if str(value or "").strip()
    ]
    inserted: dict[str, int] = {}

    with get_engine().begin() as conn:
        current_owner = conn.execute(
            text(
                'SELECT id, account_id FROM public."users" '
                "WHERE id = :owner AND role = :role AND employer_user_id IS NULL"
            ),
            {"owner": owner, "role": "user"},
        ).mappings().first()
        if current_owner is None:
            raise ValueError("account_not_found")
        source_account_id = str(source.get("account_id") or "").strip()
        current_account_id = str(current_owner.get("account_id") or owner)
        if source_account_id and current_account_id != source_account_id:
            raise ValueError("backup_account_mismatch")

        cleared = _clear_workspace_database_for_owner(conn, owner, backup_workspace_ids)
        column_cache: dict[str, list[str]] = {}
        for table in IMPORT_TABLE_ORDER:
            rows_raw = tables.get(table, [])
            if not isinstance(rows_raw, list):
                raise ValueError("backup_tables")
            rows = [dict(row) for row in rows_raw if isinstance(row, dict)]
            if table == "finance_categories":
                category_rows = [{**row, "parent_id": None} for row in rows]
                inserted[table] = _upsert_rows(conn, table, category_rows, column_cache)
                for row in rows:
                    cat_id = str(row.get("id") or "").strip()
                    parent_id = str(row.get("parent_id") or "").strip()
                    if cat_id and parent_id:
                        conn.execute(
                            text('UPDATE public."finance_categories" SET parent_id = :parent_id WHERE id = :cat_id'),
                            {"cat_id": cat_id, "parent_id": parent_id},
                        )
                continue
            inserted[table] = _upsert_rows(conn, table, rows, column_cache)

    return {"cleared": cleared, "inserted": inserted, "rows": sum(inserted.values())}
