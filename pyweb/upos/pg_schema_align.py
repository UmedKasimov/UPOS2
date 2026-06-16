"""Добавление отсутствующих столбцов после create_all — только ADD COLUMN IF NOT EXISTS.

Приложение ни при каком деплое не вызывает DROP/TRUNCATE таблиц. Данные в существующих
строках сохраняются; повторная установка добавляет недостающие столбцы (например, после
смены моделей). Для тяжёлой эволюции схемы по-прежнему можно использовать SQL из
schema_postgres.sql или внешние миграции.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateColumn

from upos.db_models import Base

logger = logging.getLogger(__name__)

PUBLIC = "public"

# Явные фрагменты для NOT NULL столбцов без server_default в ORM-модели.
_MANUAL_MISSING_COL_TYPE: dict[tuple[str, str], str] = {
    ("users", "role"): "VARCHAR(16) NOT NULL DEFAULT 'user'",
    ("users", "account_id"): "VARCHAR(5) NULL",
    ("users", "superuser"): "BOOLEAN NOT NULL DEFAULT false",
    ("users", "is_frozen"): "BOOLEAN NOT NULL DEFAULT false",
    ("users", "position"): "VARCHAR(160) NOT NULL DEFAULT ''",
    ("users", "avatar_path"): "VARCHAR(255) NULL",
    ("users", "staff_role"): "VARCHAR(32) NOT NULL DEFAULT 'viewer'",
    ("users", "employee_role_id"): "VARCHAR(36) NULL",
    ("users", "organization_id"): "VARCHAR(36) NULL",
    ("users", "employer_user_id"): "VARCHAR(36) REFERENCES users (id) ON DELETE CASCADE",
    ("organizations", "owner_user_id"): "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE",
    ("organizations", "name"): "VARCHAR(160) NOT NULL DEFAULT ''",
    ("organizations", "note"): "TEXT NOT NULL DEFAULT ''",
    ("organizations", "is_default"): "BOOLEAN NOT NULL DEFAULT false",
    ("organizations", "is_active"): "BOOLEAN NOT NULL DEFAULT true",
    ("roles", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("roles", "key"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("roles", "name"): "VARCHAR(120) NOT NULL DEFAULT ''",
    ("roles", "permissions"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("roles", "is_system"): "BOOLEAN NOT NULL DEFAULT true",
    ("positions", "organization_id"): "VARCHAR(36) NOT NULL REFERENCES organizations (id) ON DELETE CASCADE",
    ("positions", "name"): "VARCHAR(160) NOT NULL DEFAULT ''",
    ("hr_employees", "position_id"): "VARCHAR(36) REFERENCES positions (id) ON DELETE SET NULL",
    ("hr_employees", "is_courier"): "BOOLEAN NOT NULL DEFAULT false",
    ("workspace_settings", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("workspace_settings", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("treasuries", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("treasuries", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("global_settings", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("transactions", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("transactions", "number"): "INTEGER NOT NULL DEFAULT 0",
    ("transactions", "amount"): "NUMERIC(18, 2) NOT NULL DEFAULT 0",
    ("transactions", "currency"): "VARCHAR(3) NOT NULL DEFAULT 'USD'",
    ("transactions", "type"): "VARCHAR(20) NOT NULL DEFAULT 'income'",
    ("transactions", "is_confirmed"): "BOOLEAN NOT NULL DEFAULT true",
    ("transactions", "status"): "VARCHAR(20) NOT NULL DEFAULT 'confirmed'",
    ("transactions", "requires_confirmation"): "BOOLEAN NOT NULL DEFAULT false",
    ("transactions", "confirmed_by"): "VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL",
    ("transactions", "confirmed_at"): "TIMESTAMP WITH TIME ZONE NULL",
    ("delivery_shipments", "doc_status"): "VARCHAR(20) NOT NULL DEFAULT 'new'",
    ("transactions", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("transactions", "from_account_id"): "VARCHAR(36) REFERENCES finance_accounts (id) ON DELETE SET NULL",
    ("transactions", "to_account_id"): "VARCHAR(36) REFERENCES finance_accounts (id) ON DELETE SET NULL",
    ("transactions", "category_id"): "VARCHAR(36) REFERENCES finance_categories (id) ON DELETE SET NULL",
    ("transactions", "counterparty_id"): "VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL",
    ("transactions", "branch_id"): "VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL",
    ("finance_accounts", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("finance_accounts", "name"): "VARCHAR(160) NOT NULL DEFAULT ''",
    ("finance_accounts", "kind"): "VARCHAR(40) NOT NULL DEFAULT 'custom'",
    ("finance_accounts", "icon"): "VARCHAR(80) NOT NULL DEFAULT ''",
    ("finance_accounts", "note"): "TEXT NOT NULL DEFAULT ''",
    ("finance_accounts", "owner_employee_id"): "VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL",
    ("finance_accounts", "is_active"): "BOOLEAN NOT NULL DEFAULT true",
    ("account_balances", "account_id"): (
        "VARCHAR(36) NOT NULL REFERENCES finance_accounts (id) ON DELETE CASCADE"
    ),
    ("account_balances", "currency"): "VARCHAR(3) NOT NULL DEFAULT 'UZS'",
    ("account_balances", "amount"): "NUMERIC(18, 2) NOT NULL DEFAULT 0",
    ("finance_categories", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("finance_categories", "name"): "VARCHAR(160) NOT NULL DEFAULT ''",
    ("finance_categories", "type"): "VARCHAR(20) NOT NULL DEFAULT 'expense'",
    ("finance_categories", "parent_id"): "VARCHAR(36) REFERENCES finance_categories (id) ON DELETE SET NULL",
    ("finance_categories", "is_active"): "BOOLEAN NOT NULL DEFAULT true",
    ("counterparties", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("counterparties", "kind"): "VARCHAR(20) NOT NULL DEFAULT 'client'",
    ("counterparties", "name"): "VARCHAR(255) NOT NULL DEFAULT ''",
    ("counterparties", "tax_id"): "VARCHAR(64) NOT NULL DEFAULT ''",
    ("counterparties", "phone"): "VARCHAR(64) NOT NULL DEFAULT ''",
    ("counterparties", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("counterparties", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("branches", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("branches", "name"): "VARCHAR(255) NOT NULL DEFAULT ''",
    ("branches", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("branches", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("transaction_entries", "transaction_id"): (
        "VARCHAR(36) NOT NULL REFERENCES transactions (id) ON DELETE CASCADE"
    ),
    ("transaction_entries", "account_id"): (
        "VARCHAR(36) NOT NULL REFERENCES finance_accounts (id) ON DELETE CASCADE"
    ),
    ("transaction_entries", "direction"): "VARCHAR(10) NOT NULL DEFAULT 'in'",
    ("transaction_entries", "currency"): "VARCHAR(3) NOT NULL DEFAULT 'UZS'",
    ("transaction_entries", "amount"): "NUMERIC(18, 2) NOT NULL DEFAULT 0",
    ("external_records", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("external_records", "integration"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("external_records", "entity_type"): "VARCHAR(80) NOT NULL DEFAULT ''",
    ("external_records", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("external_records", "payload"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("external_records", "payload_hash"): "VARCHAR(64) NOT NULL DEFAULT ''",
    ("integration_sync_runs", "workspace_owner_id"): (
        "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE"
    ),
    ("integration_sync_runs", "integration"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("integration_sync_runs", "status"): "VARCHAR(20) NOT NULL DEFAULT 'running'",
    ("integration_sync_runs", "imported_count"): "INTEGER NOT NULL DEFAULT 0",
    ("integration_sync_runs", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("products", "workspace_owner_id"): "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE",
    ("products", "name"): "VARCHAR(255) NOT NULL DEFAULT ''",
    ("products", "sku"): "VARCHAR(100) NOT NULL DEFAULT ''",
    ("products", "barcode"): "VARCHAR(100) NOT NULL DEFAULT ''",
    ("products", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("products", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("products", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("warehouses", "workspace_owner_id"): "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE",
    ("warehouses", "name"): "VARCHAR(255) NOT NULL DEFAULT ''",
    ("warehouses", "branch_id"): "VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL",
    ("warehouses", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("warehouses", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("warehouses", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("sale_documents", "workspace_owner_id"): "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE",
    ("sale_documents", "number"): "VARCHAR(100) NOT NULL DEFAULT ''",
    ("sale_documents", "amount"): "NUMERIC(18, 2) NOT NULL DEFAULT 0",
    ("sale_documents", "currency"): "VARCHAR(3) NOT NULL DEFAULT 'UZS'",
    ("sale_documents", "counterparty_id"): "VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL",
    ("sale_documents", "branch_id"): "VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL",
    ("sale_documents", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("sale_documents", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("sale_documents", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("purchase_documents", "workspace_owner_id"): "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE",
    ("purchase_documents", "number"): "VARCHAR(100) NOT NULL DEFAULT ''",
    ("purchase_documents", "amount"): "NUMERIC(18, 2) NOT NULL DEFAULT 0",
    ("purchase_documents", "currency"): "VARCHAR(3) NOT NULL DEFAULT 'UZS'",
    ("purchase_documents", "counterparty_id"): "VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL",
    ("purchase_documents", "branch_id"): "VARCHAR(36) REFERENCES branches (id) ON DELETE SET NULL",
    ("purchase_documents", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("purchase_documents", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("purchase_documents", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("payment_documents", "workspace_owner_id"): "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE",
    ("payment_documents", "number"): "VARCHAR(100) NOT NULL DEFAULT ''",
    ("payment_documents", "amount"): "NUMERIC(18, 2) NOT NULL DEFAULT 0",
    ("payment_documents", "currency"): "VARCHAR(3) NOT NULL DEFAULT 'UZS'",
    ("payment_documents", "counterparty_id"): "VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL",
    ("payment_documents", "transaction_id"): "VARCHAR(36) REFERENCES transactions (id) ON DELETE SET NULL",
    ("payment_documents", "direction"): "VARCHAR(10) NOT NULL DEFAULT 'in'",
    ("payment_documents", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("payment_documents", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("payment_documents", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("expense_documents", "workspace_owner_id"): "VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE",
    ("expense_documents", "number"): "VARCHAR(100) NOT NULL DEFAULT ''",
    ("expense_documents", "amount"): "NUMERIC(18, 2) NOT NULL DEFAULT 0",
    ("expense_documents", "currency"): "VARCHAR(3) NOT NULL DEFAULT 'UZS'",
    ("expense_documents", "category_id"): "VARCHAR(36) REFERENCES finance_categories (id) ON DELETE SET NULL",
    ("expense_documents", "counterparty_id"): "VARCHAR(36) REFERENCES counterparties (id) ON DELETE SET NULL",
    ("expense_documents", "transaction_id"): "VARCHAR(36) REFERENCES transactions (id) ON DELETE SET NULL",
    ("expense_documents", "external_source"): "VARCHAR(40) NOT NULL DEFAULT ''",
    ("expense_documents", "external_id"): "VARCHAR(180) NOT NULL DEFAULT ''",
    ("expense_documents", "data"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
    ("telegram_bot_configs", "notification_prefs"): "JSONB NOT NULL DEFAULT '{}'::jsonb",
}


def _align_table_order(names: Iterable[str]) -> list[str]:
    lst = sorted(names)
    if "users" in lst:
        return ["users"] + [x for x in lst if x != "users"]
    return lst


def sync_missing_public_columns(engine: Engine) -> None:
    dialect = engine.dialect
    preparer = dialect.identifier_preparer

    inspector = inspect(engine)
    aligned = []

    def q(ident: str) -> str:
        return preparer.quote(ident)

    def fq_table(tbl_key: str) -> str:
        return f"{q(PUBLIC)}.{q(tbl_key)}"

    for table_key in _align_table_order(Base.metadata.tables.keys()):
        sa_table = Base.metadata.tables[table_key]
        if not inspector.has_table(sa_table.name, schema=PUBLIC):
            continue
        existing = {str(c["name"]) for c in inspector.get_columns(sa_table.name, schema=PUBLIC)}
        for col in sa_table.columns:
            if col.primary_key:
                continue
            name = col.name
            if name in existing:
                continue

            triple = (sa_table.name, name)

            manual = _MANUAL_MISSING_COL_TYPE.get(triple)
            if manual is not None:
                stmt = text(
                    f"ALTER TABLE ONLY {fq_table(sa_table.name)} "
                    f"ADD COLUMN IF NOT EXISTS {preparer.quote(name)} {manual}",
                )
            elif col.nullable:
                ctype = col.type.compile(dialect=dialect)
                stmt = text(
                    f"ALTER TABLE ONLY {fq_table(sa_table.name)} "
                    f"ADD COLUMN IF NOT EXISTS {preparer.quote(name)} {ctype} NULL",
                )
            elif col.server_default is not None:
                colspec = str(CreateColumn(col).compile(dialect=dialect))
                stmt = text(
                    f"ALTER TABLE ONLY {fq_table(sa_table.name)} "
                    f"ADD COLUMN IF NOT EXISTS {colspec}",
                )
            else:
                logger.warning(
                    "[upos] Отсутствует столбец %s.%s (NOT NULL, без DDL по умолчанию). "
                    "Дополните upos/pg_schema_align._MANUAL_MISSING_COL_TYPE или выполните "
                    "`upos/schema_postgres.sql` после бэкапа.",
                    sa_table.name,
                    name,
                )
                continue

            try:
                with engine.begin() as conn:
                    conn.execute(stmt)
                aligned.append(f"{sa_table.name}.{name}")
            except Exception as exc:
                logger.warning(
                    "[upos] ADD COLUMN не применился (%s.%s): %s",
                    sa_table.name,
                    name,
                    exc,
                )

    if aligned:
        logger.info("[upos] Инкрементально добавлены столбцы (IF NOT EXISTS): %s", ", ".join(aligned))


# Минимальные DDL-патчи, которые должны применяться даже когда полный pg_schema_align
# отключён на production (RAILWAY_ENVIRONMENT=production).
_REQUIRED_COLUMN_PATCHES: tuple[tuple[str, str], ...] = (
    (
        "users.account_id",
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS account_id VARCHAR(5) NULL",
    ),
    (
        "users.employee_role_id",
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS employee_role_id VARCHAR(36) NULL",
    ),
    (
        "users.is_frozen",
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT false",
    ),
    (
        "finance_accounts.owner_employee_id",
        "ALTER TABLE finance_accounts "
        "ADD COLUMN IF NOT EXISTS owner_employee_id VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL",
    ),
    (
        "hr_employees.position_id",
        "ALTER TABLE hr_employees "
        "ADD COLUMN IF NOT EXISTS position_id VARCHAR(36) REFERENCES positions (id) ON DELETE SET NULL",
    ),
    (
        "hr_employees.is_courier",
        "ALTER TABLE hr_employees "
        "ADD COLUMN IF NOT EXISTS is_courier BOOLEAN NOT NULL DEFAULT false",
    ),
    (
        "transactions.status",
        "ALTER TABLE transactions "
        "ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'confirmed'",
    ),
    (
        "transactions.requires_confirmation",
        "ALTER TABLE transactions "
        "ADD COLUMN IF NOT EXISTS requires_confirmation BOOLEAN NOT NULL DEFAULT false",
    ),
    (
        "transactions.confirmed_by",
        "ALTER TABLE transactions "
        "ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR(36) REFERENCES users (id) ON DELETE SET NULL",
    ),
    (
        "transactions.confirmed_at",
        "ALTER TABLE transactions "
        "ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE NULL",
    ),
    (
        "delivery_shipments.doc_status",
        "ALTER TABLE delivery_shipments "
        "ADD COLUMN IF NOT EXISTS doc_status VARCHAR(20) NOT NULL DEFAULT 'new'",
    ),
    (
        "telegram_bot_configs.notification_prefs",
        "ALTER TABLE telegram_bot_configs "
        "ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb",
    ),
)


def apply_required_column_patches(engine: Engine) -> list[str]:
    applied: list[str] = []
    for label, stmt_sql in _REQUIRED_COLUMN_PATCHES:
        try:
            with engine.begin() as conn:
                conn.execute(text(stmt_sql))
            applied.append(label)
        except Exception as exc:
            logger.warning("[upos] required column patch failed (%s): %s", label, exc)
    if applied:
        logger.info("[upos] Required column patches applied: %s", ", ".join(applied))
    return applied
