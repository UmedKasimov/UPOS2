"""Создание таблиц в PostgreSQL из моделей SQLAlchemy (идемпотентно).

Docker/Railway: из каталога /app выполните:
  python -m upos.ensure_pg_schema

Локально (pyweb как cwd):
  cd pyweb && python -m upos.ensure_pg_schema
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from upos.db import get_engine, init_db, list_public_tables


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    init_db()
    eng = get_engine()
    with eng.connect() as conn:
        conn.execute(text("SELECT 1"))
    names = list_public_tables()
    logging.info("[upos] public tables: %s", ", ".join(names) if names else "(нет)")


if __name__ == "__main__":
    main()
