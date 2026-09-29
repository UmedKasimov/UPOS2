from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator
from urllib.parse import quote_plus

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from upos.config import db_connect_timeout_seconds, get_settings, schema_align_on_startup
from upos.db_models import Base
from upos.pg_schema_align import apply_required_column_patches, sync_missing_public_columns

logger = logging.getLogger(__name__)

_startup_timings_ms: dict[str, float] = {}


def _compose_url_from_pg_env() -> str | None:
    """Собирает строку подключения из переменных, как у Railway Postgres (PG* или POSTGRES_*)."""
    host = (os.getenv("PGHOST") or "").strip()
    if not host:
        return None
    user = (os.getenv("PGUSER") or os.getenv("POSTGRES_USER") or "").strip()
    password = (
        os.getenv("PGPASSWORD") or os.getenv("POSTGRES_PASSWORD") or ""
    ).strip()
    database = (
        os.getenv("PGDATABASE") or os.getenv("POSTGRES_DB") or ""
    ).strip()
    port = (os.getenv("PGPORT") or "5432").strip() or "5432"
    if not user or not database:
        return None
    u = quote_plus(user)
    p = quote_plus(password)
    db = quote_plus(database)
    auth = f"{u}:{p}@" if password else f"{u}@"
    return f"postgresql+psycopg://{auth}{host}:{port}/{db}"


def _database_url() -> str:
    raw = (get_settings().database_url or "").strip()
    if not raw:
        raw = (_compose_url_from_pg_env() or "").strip()
    if not raw:
        raise RuntimeError(
            "DATABASE_URL is missing. On Railway: Web service → Variables → "
            "New variable → Variable reference → ваш PostgreSQL → выберите "
            "`DATABASE_URL` (внутренний доступ). Альтернатива: добавьте вручную "
            "`DATABASE_URL` или пару DATABASE_PUBLIC_URL, либо PGHOST + PGUSER + "
            "PGPASSWORD + PGDATABASE (+ PGPORT).",
        )
    if raw.startswith("postgres://"):
        raw = "postgresql+psycopg://" + raw[len("postgres://") :]
    elif raw.startswith("postgresql://"):
        raw = "postgresql+psycopg://" + raw[len("postgresql://") :]
    return raw


def startup_timings_ms() -> dict[str, float]:
    return dict(_startup_timings_ms)


@lru_cache
def get_engine() -> Engine:
    connect_timeout = db_connect_timeout_seconds()
    engine = create_engine(
        _database_url(),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        connect_args={"connect_timeout": connect_timeout},
    )

    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_connection, _connection_record):
        with dbapi_connection.cursor() as cur:
            cur.execute("SET TIME ZONE 'UTC'")

    return engine


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = _session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def list_public_tables() -> list[str]:
    """Таблицы в схеме `public` (диагностика и health-db)."""
    eng = get_engine()
    return sorted(inspect(eng).get_table_names(schema="public"))


def current_database_name() -> str:
    eng = get_engine()
    with eng.connect() as conn:
        raw = conn.execute(text("SELECT current_database()")).scalar_one()
    return str(raw)


def _record_timing(key: str, started: float) -> None:
    _startup_timings_ms[key] = round((time.perf_counter() - started) * 1000.0, 2)


# Индексы под горячие запросы (страницы schet/kassa/sales и отчёты).
# CREATE INDEX IF NOT EXISTS — идемпотентно, безопасно выполняется на каждом старте.
_PERFORMANCE_INDEXES: tuple[str, ...] = (
    # transactions: фильтр по workspace + диапазон/сортировка по дате
    "CREATE INDEX IF NOT EXISTS ix_transactions_ws_created"
    " ON transactions (workspace_owner_id, created_at DESC)",
    # transactions: PnL/отчёты — фильтр по типу и подтверждению
    "CREATE INDEX IF NOT EXISTS ix_transactions_ws_type_confirmed"
    " ON transactions (workspace_owner_id, type, is_confirmed, created_at)",
    # transactions: видимость по счетам для сотрудников (OR from/to)
    "CREATE INDEX IF NOT EXISTS ix_transactions_from_account"
    " ON transactions (from_account_id) WHERE from_account_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS ix_transactions_to_account"
    " ON transactions (to_account_id) WHERE to_account_id IS NOT NULL",
    # transaction_entries: пересчёт/сторнирование проводок по транзакции
    "CREATE INDEX IF NOT EXISTS ix_transaction_entries_tx"
    " ON transaction_entries (transaction_id)",
    "CREATE INDEX IF NOT EXISTS ix_transaction_entries_account"
    " ON transaction_entries (account_id)",
    # sale/purchase documents: журналы сортируются по updated_at DESC
    "CREATE INDEX IF NOT EXISTS ix_sale_documents_ws_updated"
    " ON sale_documents (workspace_owner_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_purchase_documents_ws_updated"
    " ON purchase_documents (workspace_owner_id, updated_at DESC)",
    # sale_documents: балансы клиентов группируются по контрагенту
    "CREATE INDEX IF NOT EXISTS ix_sale_documents_ws_counterparty"
    " ON sale_documents (workspace_owner_id, counterparty_id)",
    # crm_records: журнал продаж строит индекс CRM по workspace
    "CREATE INDEX IF NOT EXISTS ix_crm_records_ws_updated"
    " ON crm_records (workspace_owner_id, updated_at DESC)",
)


def _ensure_performance_indexes(engine: Engine) -> None:
    for ddl in _PERFORMANCE_INDEXES:
        try:
            with engine.begin() as conn:
                conn.execute(text(ddl))
        except Exception as exc:
            logger.warning("[upos] index skipped (%s): %s", ddl.split(" ON ")[0], exc)


def init_db() -> None:
    global _startup_timings_ms
    _startup_timings_ms = {}
    t_total = time.perf_counter()

    t0 = time.perf_counter()
    engine = get_engine()
    _record_timing("engine", t0)

    t0 = time.perf_counter()
    Base.metadata.create_all(bind=engine, checkfirst=True)
    _record_timing("create_all", t0)

    t0 = time.perf_counter()
    if engine.dialect.name == "postgresql":
        apply_required_column_patches(engine)
    _record_timing("required_patches", t0)

    if schema_align_on_startup():
        t0 = time.perf_counter()
        sync_missing_public_columns(engine)
        _record_timing("schema_align", t0)
    else:
        logger.info(
            "[upos] pg_schema_align skipped (UPOS_SKIP_SCHEMA_ALIGN or production default). "
            "Set UPOS_SCHEMA_ALIGN_ON_START=1 to force on next boot.",
        )

    # DROP legacy incorrect constraint transactions_number_key if it exists
    if engine.dialect.name == "postgresql":
        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_number_key"))
            logger.info("[upos] Dropped legacy constraint transactions_number_key if it existed.")
        except Exception as exc:
            logger.warning("[upos] Failed to drop legacy transactions_number_key: %s", exc)

    if engine.dialect.name == "postgresql":
        t0 = time.perf_counter()
        _ensure_performance_indexes(engine)
        _record_timing("perf_indexes", t0)

    cn = ""
    try:
        cn = current_database_name()
    except Exception:
        cn = "?"

    required = frozenset(
        {
            "users",
            "roles",
            "organizations",
            "employee_organizations",
            "employee_account_access",
            "positions",
            "hr_employees",
            "hr_attendance",
            "delivery_shipments",
            "delivery_shipment_items",
            "workspace_settings",
            "treasuries",
            "global_settings",
            "transactions",
            "finance_accounts",
            "account_balances",
            "finance_categories",
            "counterparties",
            "branches",
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
        },
    )
    names = frozenset(list_public_tables())
    present = sorted(required & names)
    missing = sorted(required - names)
    logger.info(
        "[upos] PostgreSQL DDL checked; database=%s; tables in `public`: %s",
        cn,
        ", ".join(present),
    )
    if missing:
        logger.warning(
            "[upos] После create_all отсутствуют таблицы: %s. "
            "Сервис продолжит старт, а точная диагностика доступна в /health/db. "
            "Если таблицы не появились, примените `upos/schema_postgres.sql` через Query в Railway "
            "или проверьте, что DATABASE_URL указывает на нужный Postgres.",
            ", ".join(missing),
        )
    t0 = time.perf_counter()
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    _record_timing("ping", t0)
    _record_timing("init_db_total", t_total)
    logger.info("[upos] init_db timings (ms): %s", _startup_timings_ms)
