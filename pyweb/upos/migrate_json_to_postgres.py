from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path
from typing import Any

from upos.db import init_db, session_scope
from upos.db_models import GlobalSetting, Treasury, User, WorkspaceSetting
from upos.paths import get_data_dir
from upos.storage import valid_workspace_owner_id


def _read_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _add_or_update(session, row, *, overwrite: bool) -> str:
    primary_key = (
        getattr(row, "id", None)
        or getattr(row, "key", None)
        or getattr(row, "workspace_owner_id", None)
    )
    existing = session.get(type(row), primary_key)
    if existing is None:
        session.add(row)
        return "created"
    if not overwrite:
        return "skipped"
    if isinstance(row, User):
        for attr in (
            "username",
            "email",
            "password_hash",
            "name",
            "role",
            "superuser",
            "employer_user_id",
            "position",
            "staff_role",
        ):
            setattr(existing, attr, getattr(row, attr))
    else:
        existing.data = row.data
    return "updated"


def migrate_users(data_dir: Path, overwrite: bool) -> dict[str, int]:
    raw = _read_json(data_dir / "users.json")
    users = raw.get("users") if isinstance(raw, dict) else []
    stats = {"created": 0, "updated": 0, "skipped": 0}
    if not isinstance(users, list):
        return stats
    with session_scope() as session:
        id_map: dict[str, str] = {}
        for item in users:
            if not isinstance(item, dict):
                continue
            old_id = str(item.get("id") or "").strip()
            new_id = old_id if valid_workspace_owner_id(old_id) else str(uuid.uuid4())
            if old_id:
                id_map[old_id] = new_id

        for item in users:
            if not isinstance(item, dict):
                continue
            username = str(item.get("username") or "").strip()
            password_hash = str(item.get("password_hash") or "").strip()
            if not username or not password_hash:
                continue
            old_id = str(item.get("id") or "").strip()
            user_id = id_map.get(old_id) or str(uuid.uuid4())
            email = str(item.get("email") or "").strip().lower() or None
            employer_old = str(item.get("employer_user_id") or "").strip()
            employer_id = id_map.get(employer_old) if employer_old else None
            status = _add_or_update(
                session,
                User(
                    id=user_id,
                    username=username,
                    email=email,
                    password_hash=password_hash,
                    name=str(item.get("name") or username).strip() or username,
                    role=str(item.get("role") or "user"),
                    superuser=bool(item.get("superuser")),
                    employer_user_id=employer_id,
                    position=str(item.get("position") or ""),
                    staff_role=str(item.get("staff_role") or "viewer"),
                ),
                overwrite=overwrite,
            )
            stats[status] += 1
    return stats


def migrate_global_settings(data_dir: Path, overwrite: bool) -> dict[str, int]:
    raw = _read_json(data_dir / "app_settings.json")
    stats = {"created": 0, "updated": 0, "skipped": 0}
    if not isinstance(raw, dict):
        return stats
    with session_scope() as session:
        status = _add_or_update(
            session,
            GlobalSetting(key="app_settings", data=raw),
            overwrite=overwrite,
        )
        stats[status] += 1
    return stats


def migrate_workspace_json_dir(
    data_dir: Path,
    *,
    dirname: str,
    model,
    overwrite: bool,
) -> dict[str, int]:
    stats = {"created": 0, "updated": 0, "skipped": 0}
    folder = data_dir / dirname
    if not folder.is_dir():
        return stats
    with session_scope() as session:
        for path in folder.glob("*.json"):
            owner_id = path.stem.strip()
            if not valid_workspace_owner_id(owner_id):
                continue
            if session.get(User, owner_id) is None:
                continue
            raw = _read_json(path)
            if not isinstance(raw, dict):
                continue
            status = _add_or_update(
                session,
                model(workspace_owner_id=owner_id, data=raw),
                overwrite=overwrite,
            )
            stats[status] += 1
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import legacy pyweb/data JSON files into PostgreSQL.",
    )
    parser.add_argument("--overwrite", action="store_true", help="Update existing rows")
    args = parser.parse_args()

    init_db()
    data_dir = get_data_dir()
    results = {
        "users": migrate_users(data_dir, args.overwrite),
        "global_settings": migrate_global_settings(data_dir, args.overwrite),
        "workspace_settings": migrate_workspace_json_dir(
            data_dir,
            dirname="workspaces",
            model=WorkspaceSetting,
            overwrite=args.overwrite,
        ),
        "treasuries": migrate_workspace_json_dir(
            data_dir,
            dirname="treasury",
            model=Treasury,
            overwrite=args.overwrite,
        ),
    }
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
