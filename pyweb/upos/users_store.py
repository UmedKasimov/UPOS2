"""Учётные записи в PostgreSQL: владельцы бизнеса, админы и сотрудники."""

from __future__ import annotations

import re
import secrets
import string
import uuid
from typing import Any

from passlib.context import CryptContext
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from upos.db import session_scope
from upos.db_models import EmployeeAccountAccess, EmployeeOrganization, FinanceAccount, Organization, Role, User
from upos.storage import delete_workspace_settings
from upos.treasury_store import delete_treasury
from upos.user_cache import invalidate_username

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{2,64}$")
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9][a-zA-Z0-9._%+-]{0,63}@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$"
)
ACCOUNT_ID_START = 21000

# Роль сотрудника в команде (дальше — ограничение экранов по этому полю).
STAFF_ROLE_LABELS = {
    "viewer": "Просмотр",
    "editor": "Редактирование",
    "manager": "Руководитель",
}


ROLE_PERMISSION_KEYS = ("kassa", "schet", "reports", "adjustments", "shipments", "hr", "employees", "settings", "dictionary")
ROLE_PERMISSION_LABELS = {
    "kassa": "Касса",
    "schet": "Счёт",
    "reports": "Отчёты",
    "adjustments": "Корректировки",
    "shipments": "Отгрузки",
    "hr": "HR",
    "employees": "Сотрудники",
    "settings": "Настройки",
    "dictionary": "Справочники",
}
ROLE_BUTTON_PERMISSION_LABELS = {
    "kassa": {
        "create": "Добавить операцию",
        "edit": "Редактировать",
        "delete": "Удалить",
        "confirm": "Подтвердить",
        "transfer": "Перевод",
        "sms_report": "SMS отчёт",
        "export": "Экспорт",
        "columns": "Колонки",
    },
    "schet": {
        "create": "Добавить счёт",
        "edit": "Редактировать счёт",
        "delete": "Удалить счёт",
        "balance": "Изменить баланс",
        "template": "Шаблоны",
    },
    "reports": {
        "debts": "Долги доставщиков",
        "balance": "Баланс доставщиков",
        "act": "Акт сверки",
        "shipments": "Отгрузки",
        "journal": "Журнал отгрузок",
        "export": "Экспорт",
    },
    "adjustments": {
        "employees": "Сотрудники",
        "accounts": "Счета",
        "couriers": "Доставщики",
        "suppliers": "Поставщики",
        "save": "Сохранить",
    },
    "shipments": {
        "create": "Создать отгрузки",
        "save": "Сохранить изменения",
        "confirm": "Подтвердить",
        "delete": "Удалить документ",
        "templates": "Шаблоны",
        "open": "Открыть документ",
    },
    "hr": {
        "create": "Добавить сотрудника",
        "edit": "Редактировать сотрудника",
        "dismiss": "Уволить",
        "restore": "Восстановить",
        "delete": "Удалить",
        "attendance": "Табель",
        "attendance_report": "Отчёт табеля",
        "salary_act": "Акт зарплаты",
        "salary_adjustment": "Корректировка зарплаты",
    },
    "employees": {
        "create": "Добавить сотрудника",
        "edit": "Редактировать сотрудника",
        "reset_password": "Сбросить пароль",
        "delete": "Удалить доступ",
        "devices": "Устройства",
    },
    "settings": {
        "profile": "Профиль",
        "preferences": "Настройки интерфейса",
        "integrations": "Интеграции",
        "telegram": "Telegram",
        "roles": "Роли",
    },
    "dictionary": {
        "currency": "Валюты",
        "category_create": "Добавить категорию",
        "category_edit": "Редактировать категорию",
        "category_delete": "Удалить категорию",
        "subcategory": "Подкатегории",
    },
}
DEFAULT_EMPLOYEE_ROLES = (
    {
        "key": "general_director",
        "name": "Ген. директор",
        "permissions": {key: True for key in ROLE_PERMISSION_KEYS},
    },
    {
        "key": "administrator",
        "name": "Администратор",
        "permissions": {key: True for key in ROLE_PERMISSION_KEYS},
    },
    {
        "key": "hr_manager",
        "name": "HR",
        "permissions": {
            "kassa": False,
            "schet": False,
            "reports": False,
            "adjustments": False,
            "shipments": False,
            "hr": True,
            "employees": True,
            "settings": True,
            "dictionary": True,
        },
    },
    {
        "key": "accountant",
        "name": "Бухгалтер",
        "permissions": {
            "kassa": True,
            "schet": True,
            "reports": True,
            "adjustments": True,
            "shipments": True,
            "hr": False,
            "employees": False,
            "settings": False,
            "dictionary": True,
        },
    },
    {
        "key": "cashier",
        "name": "Кассир",
        "permissions": {
            "kassa": True,
            "schet": False,
            "reports": False,
            "adjustments": False,
            "shipments": True,
            "hr": False,
            "employees": False,
            "settings": False,
            "dictionary": False,
        },
    },
)
STAFF_ROLE_TO_EMPLOYEE_ROLE = {
    "viewer": "cashier",
    "editor": "accountant",
    "manager": "administrator",
}
EMPLOYEE_ROLE_TO_STAFF_ROLE = {
    "general_director": "manager",
    "administrator": "manager",
    "hr_manager": "manager",
    "accountant": "editor",
    "cashier": "viewer",
}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def email_valid(raw: str) -> bool:
    s = raw.strip()
    return bool(s and _EMAIL_RE.match(s))


def staff_role_valid(role: str) -> bool:
    return role in STAFF_ROLE_LABELS


def normalize_role_permissions(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {key: bool(src.get(key)) for key in ROLE_PERMISSION_KEYS}
    if "shipments" not in src:
        out["shipments"] = bool(src.get("kassa") or src.get("reports"))
    if "hr" not in src:
        out["hr"] = bool(src.get("employees"))
    raw_button_access = src.get("button_access")
    button_access_src = raw_button_access if isinstance(raw_button_access, dict) else {}
    button_access: dict[str, dict[str, bool]] = {}
    for section, actions in ROLE_BUTTON_PERMISSION_LABELS.items():
        raw_section = button_access_src.get(section)
        section_src = raw_section if isinstance(raw_section, dict) else {}
        button_access[section] = {
            action: bool(section_src[action]) if action in section_src else True
            for action in actions
        }
    out["button_access"] = button_access
    raw_access = src.get("category_access")
    access = raw_access if isinstance(raw_access, dict) else {}
    if access.get("enabled"):
        category_ids: list[str] = []
        seen: set[str] = set()
        for raw_id in access.get("category_ids", []):
            cat_id = str(raw_id or "").strip()
            if cat_id and cat_id not in seen:
                seen.add(cat_id)
                category_ids.append(cat_id)
        raw_subcats = access.get("subcategories")
        subcat_src = raw_subcats if isinstance(raw_subcats, dict) else {}
        subcategories: dict[str, list[str]] = {}
        for cat_id, values in subcat_src.items():
            clean_id = str(cat_id or "").strip()
            if not clean_id:
                continue
            clean_values: list[str] = []
            seen_values: set[str] = set()
            for raw_name in values if isinstance(values, list) else []:
                name = str(raw_name or "").strip()
                key = name.casefold()
                if name and key not in seen_values:
                    seen_values.add(key)
                    clean_values.append(name)
            if clean_values:
                subcategories[clean_id] = clean_values
        out["category_access"] = {
            "enabled": True,
            "category_ids": category_ids,
            "subcategories": subcategories,
        }
    return out


def _role_to_dict(role: Role | None) -> dict[str, Any] | None:
    if role is None:
        return None
    return {
        "id": role.id,
        "workspace_owner_id": role.workspace_owner_id,
        "key": role.key,
        "name": role.name,
        "permissions": normalize_role_permissions(role.permissions),
        "is_system": bool(role.is_system),
    }


def _organization_to_dict(org: Organization) -> dict[str, Any]:
    return {
        "id": org.id,
        "owner_user_id": org.owner_user_id,
        "name": org.name or "",
        "note": org.note or "",
        "is_default": bool(org.is_default),
        "is_active": bool(org.is_active),
    }


def _ensure_default_roles_in_session(session: Session, workspace_owner_id: str) -> list[Role]:
    wid = (workspace_owner_id or "").strip()
    if not wid:
        return []
    existing = {
        str(role.key): role
        for role in session.scalars(select(Role).where(Role.workspace_owner_id == wid)).all()
    }
    changed = False
    for spec in DEFAULT_EMPLOYEE_ROLES:
        key = str(spec["key"])
        role = existing.get(key)
        if role is None:
            role = Role(
                id=str(uuid.uuid4()),
                workspace_owner_id=wid,
                key=key,
                name=str(spec["name"]),
                permissions=normalize_role_permissions(spec.get("permissions")),
                is_system=True,
            )
            session.add(role)
            existing[key] = role
            changed = True
        else:
            if not role.name:
                role.name = str(spec["name"])
                changed = True
            current_permissions = role.permissions if isinstance(role.permissions, dict) else {}
            if role.is_system:
                current_permissions = {
                    **normalize_role_permissions(spec.get("permissions")),
                    **current_permissions,
                }
            perms = normalize_role_permissions(current_permissions)
            if role.permissions != perms:
                role.permissions = perms
                changed = True
    if changed:
        session.flush()
    return sorted(existing.values(), key=lambda r: [x["key"] for x in DEFAULT_EMPLOYEE_ROLES].index(r.key) if r.key in {x["key"] for x in DEFAULT_EMPLOYEE_ROLES} else 99)


def ensure_default_roles(workspace_owner_id: str) -> list[dict[str, Any]]:
    with session_scope() as session:
        rows = _ensure_default_roles_in_session(session, workspace_owner_id)
        return [_role_to_dict(row) for row in rows if row is not None]


def list_roles_safe(workspace_owner_id: str) -> list[dict[str, Any]]:
    wid = (workspace_owner_id or "").strip()
    if not wid:
        return []
    with session_scope() as session:
        rows = _ensure_default_roles_in_session(session, wid)
        return [_role_to_dict(row) for row in rows if row is not None]


def get_role_safe(workspace_owner_id: str, role_id: str) -> dict[str, Any] | None:
    wid = (workspace_owner_id or "").strip()
    rid = (role_id or "").strip()
    if not wid or not rid:
        return None
    with session_scope() as session:
        row = session.scalar(select(Role).where(Role.workspace_owner_id == wid, Role.id == rid))
        return _role_to_dict(row)


def _default_role_key_for_staff(staff_role: str) -> str:
    return STAFF_ROLE_TO_EMPLOYEE_ROLE.get(staff_role, "cashier")


def _staff_role_for_employee_role(role_key: str) -> str:
    return EMPLOYEE_ROLE_TO_STAFF_ROLE.get(role_key, "viewer")


def _resolve_role_for_write(
    session: Session,
    workspace_owner_id: str,
    role_id: str = "",
    staff_role: str = "viewer",
) -> Role | None:
    wid = (workspace_owner_id or "").strip()
    if not wid:
        return None
    roles = _ensure_default_roles_in_session(session, wid)
    if role_id:
        selected = next((role for role in roles if role.id == role_id), None)
        if selected is not None:
            return selected
    key = _default_role_key_for_staff(staff_role)
    return next((role for role in roles if role.key == key), None) or (roles[0] if roles else None)


def _ordered_unique(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = str(raw or "").strip()
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def _owner_org_ids_in_session(session: Session, owner_user_id: str) -> list[str]:
    owner_id = (owner_user_id or "").strip()
    if not owner_id:
        return []
    return [
        str(x)
        for x in session.scalars(
            select(Organization.id)
            .where(Organization.owner_user_id == owner_id, Organization.is_active.is_(True))
            .order_by(Organization.is_default.desc(), func.lower(Organization.name)),
        ).all()
    ]


def _normalize_employee_organization_ids(
    session: Session,
    owner_user_id: str,
    raw_ids: list[str] | tuple[str, ...] | None,
    fallback_id: str = "",
) -> list[str]:
    allowed = _owner_org_ids_in_session(session, owner_user_id)
    allowed_set = set(allowed)
    selected = _ordered_unique([str(x) for x in (raw_ids or []) if str(x or "").strip() in allowed_set])
    fallback = str(fallback_id or "").strip()
    if not selected and fallback in allowed_set:
        selected = [fallback]
    if not selected and allowed:
        selected = [allowed[0]]
    return selected


def _normalize_employee_account_ids(
    session: Session,
    owner_user_id: str,
    raw_ids: list[str] | tuple[str, ...] | None,
    organization_ids: list[str] | tuple[str, ...] | None = None,
) -> list[str]:
    selected_raw = _ordered_unique([str(x) for x in (raw_ids or [])])
    if not selected_raw:
        return []
    owner_id = (owner_user_id or "").strip()
    org_set = set(_normalize_employee_organization_ids(session, owner_id, list(organization_ids or [])))
    rows = session.scalars(
        select(FinanceAccount)
        .where(
            FinanceAccount.id.in_(selected_raw),
            FinanceAccount.workspace_owner_id.in_(list(org_set)),
            FinanceAccount.is_active.is_(True),
        )
        .order_by(FinanceAccount.created_at.asc()),
    ).all()
    valid = {str(row.id) for row in rows}
    return [account_id for account_id in selected_raw if account_id in valid]


def _sync_employee_access(
    session: Session,
    employee_id: str,
    owner_user_id: str,
    organization_ids: list[str] | tuple[str, ...] | None,
    account_ids: list[str] | tuple[str, ...] | None,
) -> tuple[list[str], list[str]]:
    org_ids = _normalize_employee_organization_ids(session, owner_user_id, list(organization_ids or []))
    account_ids_clean = _normalize_employee_account_ids(session, owner_user_id, list(account_ids or []), org_ids)

    current_orgs = {
        str(row.organization_id)
        for row in session.scalars(
            select(EmployeeOrganization).where(EmployeeOrganization.employee_id == employee_id),
        ).all()
    }
    target_orgs = set(org_ids)
    for org_id in target_orgs - current_orgs:
        session.add(EmployeeOrganization(employee_id=employee_id, organization_id=org_id))
    if current_orgs - target_orgs:
        session.execute(
            delete(EmployeeOrganization).where(
                EmployeeOrganization.employee_id == employee_id,
                EmployeeOrganization.organization_id.in_(list(current_orgs - target_orgs)),
            ),
        )

    current_accounts = {
        str(row.account_id)
        for row in session.scalars(
            select(EmployeeAccountAccess).where(EmployeeAccountAccess.employee_id == employee_id),
        ).all()
    }
    target_accounts = set(account_ids_clean)
    for account_id in target_accounts - current_accounts:
        session.add(EmployeeAccountAccess(employee_id=employee_id, account_id=account_id))
    if current_accounts - target_accounts:
        session.execute(
            delete(EmployeeAccountAccess).where(
                EmployeeAccountAccess.employee_id == employee_id,
                EmployeeAccountAccess.account_id.in_(list(current_accounts - target_accounts)),
            ),
        )
    return org_ids, account_ids_clean


def _employee_access_maps(
    session: Session,
    employee_ids: list[str],
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    ids = [str(x) for x in employee_ids if str(x or "").strip()]
    if not ids:
        return {}, {}
    orgs: dict[str, list[str]] = {eid: [] for eid in ids}
    accounts: dict[str, list[str]] = {eid: [] for eid in ids}
    for row in session.scalars(
        select(EmployeeOrganization)
        .where(EmployeeOrganization.employee_id.in_(ids))
        .order_by(EmployeeOrganization.created_at.asc()),
    ).all():
        orgs.setdefault(str(row.employee_id), []).append(str(row.organization_id))
    for row in session.scalars(
        select(EmployeeAccountAccess)
        .where(EmployeeAccountAccess.employee_id.in_(ids))
        .order_by(EmployeeAccountAccess.created_at.asc()),
    ).all():
        accounts.setdefault(str(row.employee_id), []).append(str(row.account_id))
    return orgs, accounts


def list_employee_organizations_safe(owner_user_id: str, employee_id: str) -> list[dict[str, Any]]:
    owner_id = (owner_user_id or "").strip()
    eid = (employee_id or "").strip()
    if not owner_id or not eid:
        return []
    with session_scope() as session:
        emp = session.get(User, eid)
        if emp is None or str(emp.employer_user_id or "") != owner_id:
            return []
        org_ids_map, _accounts_map = _employee_access_maps(session, [eid])
        org_ids = org_ids_map.get(eid) or ([str(emp.organization_id)] if emp.organization_id else [])
        org_ids = _normalize_employee_organization_ids(session, owner_id, org_ids, str(emp.organization_id or ""))
        if not org_ids:
            return []
        rows = session.scalars(
            select(Organization)
            .where(
                Organization.owner_user_id == owner_id,
                Organization.is_active.is_(True),
                Organization.id.in_(org_ids),
            )
            .order_by(Organization.is_default.desc(), func.lower(Organization.name)),
        ).all()
        by_id = {str(row.id): row for row in rows}
        return [_organization_to_dict(by_id[oid]) for oid in org_ids if oid in by_id]


def list_employee_account_ids_safe(owner_user_id: str, employee_id: str, organization_id: str = "") -> list[str]:
    owner_id = (owner_user_id or "").strip()
    eid = (employee_id or "").strip()
    org_id = (organization_id or "").strip()
    if not owner_id or not eid:
        return []
    with session_scope() as session:
        emp = session.get(User, eid)
        if emp is None or str(emp.employer_user_id or "") != owner_id:
            return []
        rows = session.scalars(
            select(FinanceAccount.id)
            .join(EmployeeAccountAccess, EmployeeAccountAccess.account_id == FinanceAccount.id)
            .where(
                EmployeeAccountAccess.employee_id == eid,
                FinanceAccount.is_active.is_(True),
            ),
        ).all()
        out = [str(x) for x in rows]
        if org_id:
            valid = {
                str(x)
                for x in session.scalars(
                    select(FinanceAccount.id).where(
                        FinanceAccount.workspace_owner_id == org_id,
                        FinanceAccount.is_active.is_(True),
                    ),
                ).all()
            }
            out = [x for x in out if x in valid]
        return out


def _employee_role_payload(rec: dict[str, Any]) -> dict[str, Any] | None:
    emp = str(rec.get("employer_user_id") or "").strip()
    if not emp:
        return None
    workspace_owner_id = str(rec.get("organization_id") or emp).strip()
    role_id = str(rec.get("employee_role_id") or "").strip()
    roles = list_roles_safe(workspace_owner_id)
    if role_id:
        role = next((row for row in roles if str(row.get("id") or "") == role_id), None)
        if role:
            return role
    fallback_key = _default_role_key_for_staff(str(rec.get("staff_role") or "viewer"))
    return next((row for row in roles if str(row.get("key") or "") == fallback_key), None)


def update_role_permissions(workspace_owner_id: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    wid = (workspace_owner_id or "").strip()
    if not wid:
        return []
    changed_role_ids: set[str] = set()
    affected_usernames: list[str] = []
    with session_scope() as session:
        roles = _ensure_default_roles_in_session(session, wid)
        by_id = {role.id: role for role in roles}
        for role_id, raw in (payload or {}).items():
            role = by_id.get(str(role_id))
            if role is None or not isinstance(raw, dict):
                continue
            role.permissions = normalize_role_permissions(raw)
            changed_role_ids.add(str(role.id))
        if changed_role_ids:
            affected_usernames = [
                str(username or "")
                for username in session.scalars(
                    select(User.username).where(User.employee_role_id.in_(changed_role_ids))
                ).all()
                if str(username or "").strip()
            ]
        session.flush()
        out = [_role_to_dict(role) for role in sorted(by_id.values(), key=lambda r: r.name.lower()) if role is not None]
    for username in affected_usernames:
        invalidate_username(username)
    return out


def _empty_store() -> dict[str, Any]:
    return {"users": []}


def _user_to_dict(u: User) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": u.id,
        "account_id": u.account_id or "",
        "username": u.username,
        "email": u.email or "",
        "name": u.name,
        "role": u.role,
        "superuser": bool(u.superuser),
        "is_frozen": bool(u.is_frozen),
        "organization_id": u.organization_id or "",
        "position": u.position or "",
        "staff_role": u.staff_role or "viewer",
        "employee_role_id": u.employee_role_id or "",
        "avatar_path": u.avatar_path,
    }
    if u.employer_user_id:
        out["employer_user_id"] = u.employer_user_id
    return out


def _get_by_id(session: Session, user_id: str) -> User | None:
    uid = (user_id or "").strip()
    if not uid:
        return None
    return session.get(User, uid)


def _get_by_username(session: Session, username: str) -> User | None:
    un = (username or "").strip()
    if not un:
        return None
    return session.scalar(select(User).where(func.lower(User.username) == un.lower()))


def _next_account_id_in_session(session: Session) -> str:
    used: set[int] = set()
    rows = session.scalars(select(User.account_id).where(User.account_id.is_not(None))).all()
    for raw in rows:
        value = str(raw or "").strip()
        if value.isdigit():
            used.add(int(value))
    current = ACCOUNT_ID_START
    while current in used:
        current += 1
    if current > 99999:
        raise ValueError("No free 5-digit account IDs left.")
    return str(current)


def ensure_account_ids() -> None:
    with session_scope() as session:
        rows = session.scalars(
            select(User)
            .where(User.role == "user", User.employer_user_id.is_(None), User.account_id.is_(None))
            .order_by(User.created_at, func.lower(User.username)),
        ).all()
        for row in rows:
            row.account_id = _next_account_id_in_session(session)
            session.flush()
        try:
            session.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ux_users_account_id_not_null "
                    "ON users (account_id) WHERE account_id IS NOT NULL",
                ),
            )
        except Exception:
            pass


def _get_by_email(session: Session, email: str) -> User | None:
    key = normalize_email(email)
    if not key:
        return None
    return session.scalar(select(User).where(func.lower(User.email) == key))


def _username_exists(session: Session, username: str, *, exclude_id: str = "") -> bool:
    stmt = select(User.id).where(func.lower(User.username) == username.strip().lower())
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    return session.scalar(stmt) is not None


def _email_exists(session: Session, email: str, *, exclude_id: str = "") -> bool:
    key = normalize_email(email)
    if not key:
        return False
    stmt = select(User.id).where(func.lower(User.email) == key)
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    return session.scalar(stmt) is not None


def load_raw() -> dict[str, Any]:
    with session_scope() as session:
        rows = session.scalars(select(User).order_by(User.created_at, User.username)).all()
        return {"users": [_user_to_dict(u) for u in rows]}


def save_raw(data: dict[str, Any]) -> None:
    """Compatibility helper used by migration/debug tooling."""
    users = list(data.get("users") or [])
    with session_scope() as session:
        session.execute(delete(User))
        for raw in users:
            if not isinstance(raw, dict):
                continue
            username = str(raw.get("username") or "").strip()
            password_hash = str(raw.get("password_hash") or "")
            if not username or not password_hash:
                continue
            email_raw = str(raw.get("email") or "").strip()
            session.add(
                User(
                    id=str(raw.get("id") or uuid.uuid4()),
                    username=username,
                    email=normalize_email(email_raw) if email_raw else None,
                    password_hash=password_hash,
                    name=str(raw.get("name") or username).strip() or username,
                    role=str(raw.get("role") or "user"),
                    superuser=bool(raw.get("superuser")),
                    employer_user_id=(
                        str(raw.get("employer_user_id") or "").strip() or None
                    ),
                    organization_id=(str(raw.get("organization_id") or "").strip() or None),
                    position=str(raw.get("position") or ""),
                    staff_role=str(raw.get("staff_role") or "viewer"),
                    employee_role_id=(str(raw.get("employee_role_id") or "").strip() or None),
                ),
            )


def ensure_all_user_ids() -> None:
    """PostgreSQL requires ids at insert time; JSON import handles old missing ids."""
    return None


def user_count() -> int:
    with session_scope() as session:
        return int(session.scalar(select(func.count(User.id)).where(User.role != "org")) or 0)


def get_by_id(user_id: str) -> dict[str, Any] | None:
    with session_scope() as session:
        row = _get_by_id(session, user_id)
        return _user_to_dict(row) if row else None


def list_users_safe() -> list[dict[str, Any]]:
    """Учётки для админ-панели: без паролей, без сотрудников (они у владельца на вкладке «Сотрудники»)."""
    with session_scope() as session:
        rows = session.scalars(
            select(User)
            .where(User.employer_user_id.is_(None))
            .where(User.role != "org")
            .order_by(func.lower(User.username)),
        ).all()
        return [
            {
                "id": u.id,
                "account_id": u.account_id or "",
                "username": u.username,
                "email": u.email or "",
                "name": u.name or u.username,
                "role": u.role or "user",
                "superuser": bool(u.superuser),
            }
            for u in rows
        ]


def _employee_org_clause(owner_user_id: str, organization_id: str):
    org_id = (organization_id or "").strip()
    if not org_id:
        return None
    if org_id == owner_user_id:
        return or_(User.organization_id == org_id, User.organization_id.is_(None))
    return User.organization_id == org_id


def list_employees_safe(owner_user_id: str, organization_id: str = "") -> list[dict[str, Any]]:
    oid = (owner_user_id or "").strip()
    workspace_owner_id = (organization_id or oid).strip()
    with session_scope() as session:
        roles = _ensure_default_roles_in_session(session, workspace_owner_id) if workspace_owner_id else []
        roles_by_id = {role.id: role for role in roles}
        roles_by_key = {role.key: role for role in roles}
        rows = session.scalars(
            select(User).where(User.employer_user_id == oid).order_by(func.lower(User.username)),
        ).all()
        employee_ids = [str(u.id) for u in rows]
        org_map, account_map = _employee_access_maps(session, employee_ids)
        org_filter = str(organization_id or "").strip()
        if org_filter:
            filtered_rows = []
            for u in rows:
                org_ids = org_map.get(str(u.id)) or ([str(u.organization_id)] if u.organization_id else [])
                if org_filter == oid and (not org_ids or org_filter in org_ids):
                    filtered_rows.append(u)
                elif org_filter in org_ids:
                    filtered_rows.append(u)
            rows = filtered_rows
        out: list[dict[str, Any]] = []
        for u in rows:
            org_ids = _normalize_employee_organization_ids(
                session,
                oid,
                org_map.get(str(u.id)) or ([str(u.organization_id)] if u.organization_id else []),
                str(u.organization_id or ""),
            )
            account_ids = _normalize_employee_account_ids(session, oid, account_map.get(str(u.id)) or [], org_ids)
            role = roles_by_id.get(str(u.employee_role_id or ""))
            if role is None:
                role = roles_by_key.get(_default_role_key_for_staff(u.staff_role or "viewer"))
                if role is not None and not u.employee_role_id:
                    u.employee_role_id = role.id
            role_payload = _role_to_dict(role)
            out.append(
                {
                    "id": u.id,
                    "username": u.username,
                    "email": u.email or "",
                    "name": u.name or u.username,
                    "position": (u.position or "").strip(),
                    "staff_role": u.staff_role or "viewer",
                    "employee_role_id": u.employee_role_id or "",
                    "employee_role": role_payload or {},
                    "employee_role_key": str((role_payload or {}).get("key") or ""),
                    "employee_role_name": str((role_payload or {}).get("name") or ""),
                    "employee_permissions": (role_payload or {}).get("permissions") or {},
                    "organization_id": u.organization_id or "",
                    "organization_ids": org_ids,
                    "account_ids": account_ids,
                    "is_frozen": bool(u.is_frozen),
                },
            )
        return out


def get_employee_for_owner(
    owner_user_id: str,
    employee_id: str,
    organization_id: str = "",
) -> dict[str, Any] | None:
    oid = (owner_user_id or "").strip()
    eid = (employee_id or "").strip()
    if not oid or not eid:
        return None
    with session_scope() as session:
        row = session.execute(
            select(User).where(
                User.id == eid,
                User.employer_user_id == oid,
            ),
        ).scalar_one_or_none()
        if row is None:
            return None
        org_map, account_map = _employee_access_maps(session, [eid])
        org_ids = _normalize_employee_organization_ids(
            session,
            oid,
            org_map.get(eid) or ([str(row.organization_id)] if row.organization_id else []),
            str(row.organization_id or ""),
        )
        org_filter = str(organization_id or "").strip()
        if org_filter and org_filter not in org_ids and not (org_filter == oid and not org_ids):
            return None
        account_ids = _normalize_employee_account_ids(session, oid, account_map.get(eid) or [], org_ids)
        roles = _ensure_default_roles_in_session(session, row.organization_id or oid)
        roles_by_id = {role.id: role for role in roles}
        roles_by_key = {role.key: role for role in roles}
        role = roles_by_id.get(str(row.employee_role_id or ""))
        if role is None:
            role = roles_by_key.get(_default_role_key_for_staff(row.staff_role or "viewer"))
            if role is not None and not row.employee_role_id:
                row.employee_role_id = role.id
        role_payload = _role_to_dict(role)
        return {
            "id": row.id,
            "username": row.username,
            "email": row.email or "",
            "name": row.name or row.username,
            "position": (row.position or "").strip(),
            "staff_role": row.staff_role or "viewer",
            "employee_role_id": row.employee_role_id or "",
            "employee_role": role_payload or {},
            "employee_role_key": str((role_payload or {}).get("key") or ""),
            "employee_role_name": str((role_payload or {}).get("name") or ""),
            "employee_permissions": (role_payload or {}).get("permissions") or {},
            "organization_id": row.organization_id or "",
            "organization_ids": org_ids,
            "account_ids": account_ids,
            "is_frozen": bool(row.is_frozen),
        }


def get_by_email(email: str) -> dict[str, Any] | None:
    with session_scope() as session:
        row = _get_by_email(session, email)
        return _user_to_dict(row) if row else None


def get_by_username(username: str) -> dict[str, Any] | None:
    with session_scope() as session:
        row = _get_by_username(session, username)
        return _user_to_dict(row) if row else None


def resolve_user_for_login(identifier: str) -> dict[str, Any] | None:
    s = identifier.strip()
    if not s:
        return None
    u = get_by_username(s)
    if u:
        if str(u.get("role") or "") == "org":
            return None
        return u
    return None


def workspace_owner_id_for_record(rec: dict[str, Any]) -> str:
    """Идентификатор владельца данных (файл workspace): у сотрудника — id работодателя."""
    emp = rec.get("employer_user_id")
    if emp:
        return str(emp)
    return str(rec.get("id") or "")


def session_payload(rec: dict[str, Any]) -> dict[str, Any]:
    uid = str(rec.get("id") or "")
    emp = rec.get("employer_user_id")
    workspace = workspace_owner_id_for_record(rec)
    account_owner_id = str(emp or uid)
    out: dict[str, Any] = {
        "username": str(rec["username"]),
        "name": str(rec.get("name") or rec["username"]),
        "role": str(rec.get("role") or "user"),
        "email": str(rec.get("email") or ""),
        "user_id": uid,
        "account_owner_id": account_owner_id,
        "workspace_owner_id": workspace,
        "organization_id": str(rec.get("organization_id") or ""),
        "staff_role": str(rec.get("staff_role") or "viewer"),
        "is_employee": bool(emp),
    }
    if emp:
        employee_orgs = list_employee_organizations_safe(str(emp), uid)
        out["organization_ids"] = [str(org.get("id") or "") for org in employee_orgs if str(org.get("id") or "").strip()]
        out["account_ids"] = list_employee_account_ids_safe(str(emp), uid)
        role_payload = _employee_role_payload(rec)
        if role_payload:
            out["employee_role_id"] = str(role_payload.get("id") or "")
            out["employee_role_key"] = str(role_payload.get("key") or "")
            out["employee_role_name"] = str(role_payload.get("name") or "")
            out["employee_permissions"] = role_payload.get("permissions") or {}
        owner = get_by_id(str(emp))
        if owner:
            out["workspace_owner_name"] = str(
                owner.get("name") or owner.get("username") or "",
            )
    return out


def verify_login(identifier: str, password: str, account_id: str = "") -> dict[str, Any] | None:
    s = (identifier or "").strip()
    if not s:
        return None
    uid = (account_id or "").strip()
    with session_scope() as session:
        user = _get_by_username(session, s)
        if not user or str(user.role or "") == "org":
            return None
        allowed_ids = {str(user.account_id or user.id)}
        if user.employer_user_id:
            owner = session.get(User, str(user.employer_user_id))
            if owner is not None:
                allowed_ids.add(str(owner.id))
                if owner.account_id:
                    allowed_ids.add(str(owner.account_id))
        if uid and uid not in allowed_ids:
            return None
        if not user.password_hash:
            return None
        if user.employer_user_id and user.is_frozen:
            return None
        if not _pwd.verify(password, user.password_hash):
            return None
        rec = _user_to_dict(user)
    return session_payload(rec)


def add_user(
    username: str,
    password: str,
    name: str,
    *,
    role: str,
    email: str = "",
    superuser: bool = False,
    require_email: bool = True,
) -> tuple[bool, str]:
    username = username.strip()
    name = name.strip() or username
    if not _USERNAME_RE.match(username):
        return False, "Логин: 2–64 символа, латиница, цифры, ._-"
    if len(password) < 8:
        return False, "Пароль не короче 8 символов."
    if role not in {"user", "admin"}:
        return False, "Недопустимая роль."

    email_norm = normalize_email(email) if email.strip() else ""
    if require_email:
        if not email_norm:
            return False, "Укажите электронную почту."
        if not email_valid(email):
            return False, "Некорректный адрес электронной почты."
    elif email_norm and not email_valid(email):
        return False, "Некорректный адрес электронной почты."

    try:
        with session_scope() as session:
            if _username_exists(session, username):
                return False, "Пользователь с таким логином уже существует."
            if email_norm and _email_exists(session, email_norm):
                return False, "Пользователь с таким адресом электронной почты уже существует."
            employee_id = str(uuid.uuid4())
            session.add(
                User(
                    id=employee_id,
                    username=username,
                    email=email_norm or None,
                    password_hash=_pwd.hash(password),
                    name=name,
                    role=role,
                    superuser=superuser,
                ),
            )
        return True, ""
    except IntegrityError:
        return False, "Пользователь с таким логином или почтой уже существует."


def add_billing_account(
    username: str,
    password: str,
    name: str,
    email: str = "",
) -> tuple[bool, str, dict[str, Any] | None]:
    username = username.strip()
    name = name.strip() or username
    if not _USERNAME_RE.match(username):
        return False, "Логин: 2-64 символа, латиница, цифры, ._-", None
    if len(password) < 8:
        return False, "Пароль не короче 8 символов.", None

    email_norm = normalize_email(email) if email.strip() else ""
    if email_norm and not email_valid(email):
        return False, "Некорректный адрес электронной почты.", None

    try:
        with session_scope() as session:
            if _username_exists(session, username):
                return False, "Пользователь с таким логином уже существует.", None
            if email_norm and _email_exists(session, email_norm):
                return False, "Пользователь с таким адресом электронной почты уже существует.", None
            user_id = str(uuid.uuid4())
            rec = User(
                id=user_id,
                account_id=_next_account_id_in_session(session),
                username=username,
                email=email_norm or None,
                password_hash=_pwd.hash(password),
                name=name,
                role="user",
                superuser=False,
            )
            session.add(rec)
            session.flush()
            return True, "", _user_to_dict(rec)
    except IntegrityError:
        return False, "Пользователь с таким логином или почтой уже существует.", None


def update_billing_account_name(user_id: str, name: str) -> tuple[bool, str]:
    uid = (user_id or "").strip()
    clean_name = (name or "").strip()
    if not uid:
        return False, "Account ID is required."
    if len(clean_name) > 160:
        return False, "Name must be 160 characters or shorter."
    with session_scope() as session:
        rec = session.get(User, uid)
        if rec is None or rec.role != "user" or rec.employer_user_id:
            return False, "Client account was not found."
        rec.name = clean_name or rec.username
        username = rec.username
    invalidate_username(username)
    return True, ""


def reset_billing_account_password(user_id: str) -> tuple[bool, str, str]:
    uid = (user_id or "").strip()
    if not uid:
        return False, "Account ID is required.", ""
    alphabet = string.ascii_letters + string.digits
    temp_password = "".join(secrets.choice(alphabet) for _ in range(12))
    with session_scope() as session:
        rec = session.get(User, uid)
        if rec is None or rec.role != "user" or rec.employer_user_id:
            return False, "Client account was not found.", ""
        rec.password_hash = _pwd.hash(temp_password)
        username = rec.username
    invalidate_username(username)
    return True, "", temp_password


def set_billing_account_password(user_id: str, password: str) -> tuple[bool, str, str]:
    uid = (user_id or "").strip()
    pw = (password or "").strip()
    if not uid:
        return False, "Account ID is required.", ""
    if len(pw) < 8:
        return False, "Пароль не короче 8 символов.", ""
    with session_scope() as session:
        rec = session.get(User, uid)
        if rec is None or rec.role != "user" or rec.employer_user_id:
            return False, "Client account was not found.", ""
        rec.password_hash = _pwd.hash(pw)
        username = rec.username
    invalidate_username(username)
    return True, "", pw


def add_employee(
    owner_user_id: str,
    username: str,
    password: str,
    email: str,
    name: str,
    position: str,
    staff_role: str,
    organization_id: str = "",
    employee_role_id: str = "",
    organization_ids: list[str] | tuple[str, ...] | None = None,
    account_ids: list[str] | tuple[str, ...] | None = None,
) -> tuple[bool, str]:
    owner = get_by_id(owner_user_id.strip())
    if not owner:
        return False, "Владелец не найден."
    if owner.get("employer_user_id"):
        return False, "Нельзя добавлять сотрудников к учётке сотрудника."
    if str(owner.get("role") or "") != "user":
        return False, "Сотрудников можно добавлять только к учётке бизнеса."
    if not staff_role_valid(staff_role):
        return False, "Недопустимая роль сотрудника."

    username = username.strip()
    name = (name.strip() or username)
    position = position.strip()
    if len(position) > 160:
        return False, "Должность не длиннее 160 символов."
    if not _USERNAME_RE.match(username):
        return False, "Логин: 2–64 символа, латиница, цифры, ._-"
    if len(password) < 8:
        return False, "Пароль не короче 8 символов."
    email_norm = normalize_email(email) if email.strip() else ""
    if email_norm and not email_valid(email):
        return False, "Укажите корректную электронную почту."

    try:
        with session_scope() as session:
            if _username_exists(session, username):
                return False, "Пользователь с таким логином уже существует."
            org_ids = _normalize_employee_organization_ids(
                session,
                owner_user_id.strip(),
                list(organization_ids or []),
                organization_id.strip() or owner_user_id.strip(),
            )
            primary_org_id = org_ids[0] if org_ids else (organization_id.strip() or owner_user_id.strip())
            employee_role = _resolve_role_for_write(
                session,
                primary_org_id,
                employee_role_id.strip(),
                staff_role,
            )
            if employee_role is None:
                return False, "РќРµРґРѕРїСѓСЃС‚РёРјР°СЏ СЂРѕР»СЊ СЃРѕС‚СЂСѓРґРЅРёРєР°."
            staff_role = _staff_role_for_employee_role(employee_role.key)
            if email_norm and _email_exists(session, email_norm):
                return False, "Пользователь с таким адресом электронной почты уже существует."
            employee_id = str(uuid.uuid4())
            session.add(
                User(
                    id=employee_id,
                    username=username,
                    email=email_norm or None,
                    password_hash=_pwd.hash(password),
                    name=name,
                    role="user",
                    employer_user_id=owner_user_id.strip(),
                    organization_id=primary_org_id,
                    position=position,
                    staff_role=staff_role,
                    employee_role_id=employee_role.id,
                ),
            )
            session.flush()
            _sync_employee_access(session, employee_id, owner_user_id.strip(), org_ids, account_ids or [])
        return True, ""
    except IntegrityError:
        return False, "Пользователь с таким логином или почтой уже существует."


def update_employee(
    owner_user_id: str,
    old_username: str,
    *,
    organization_id: str = "",
    new_username: str,
    new_password: str = "",
    new_email: str,
    new_name: str,
    position: str,
    staff_role: str,
    employee_role_id: str = "",
    organization_ids: list[str] | tuple[str, ...] | None = None,
    account_ids: list[str] | tuple[str, ...] | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    oid = owner_user_id.strip()
    ou = old_username.strip()
    if not staff_role_valid(staff_role):
        return False, "Недопустимая роль сотрудника.", None

    nu = new_username.strip()
    if not nu:
        return False, "Укажите логин.", None
    if not _USERNAME_RE.match(nu):
        return False, "Логин: 2–64 символа, латиница, цифры, ._-", None
    em_raw = new_email.strip()
    if em_raw and not email_valid(em_raw):
        return False, "Некорректный адрес электронной почты.", None
    em_norm = normalize_email(em_raw) if em_raw else ""

    pos = position.strip()
    if len(pos) > 160:
        return False, "Должность не длиннее 160 символов.", None

    pw = new_password.strip()
    if pw:
        if len(pw) < 8:
            return False, "Пароль не короче 8 символов.", None

    try:
        with session_scope() as session:
            rec = session.scalar(
                select(User).where(
                    User.employer_user_id == oid,
                    func.lower(User.username) == ou.lower(),
                ),
            )
            if rec is None:
                return False, "Сотрудник не найден.", None
            if _username_exists(session, nu, exclude_id=rec.id):
                return False, "Пользователь с таким логином уже существует.", None
            if em_norm and _email_exists(session, em_norm, exclude_id=rec.id):
                return (
                    False,
                    "Пользователь с таким адресом электронной почты уже существует.",
                    None,
                )
            org_ids = _normalize_employee_organization_ids(
                session,
                oid,
                list(organization_ids or []),
                organization_id.strip() or rec.organization_id or oid,
            )
            primary_org_id = org_ids[0] if org_ids else (organization_id.strip() or rec.organization_id or oid)
            employee_role = _resolve_role_for_write(
                session,
                primary_org_id,
                employee_role_id.strip(),
                staff_role,
            )
            if employee_role is None:
                return False, "РќРµРґРѕРїСѓСЃС‚РёРјР°СЏ СЂРѕР»СЊ СЃРѕС‚СЂСѓРґРЅРёРєР°.", None
            staff_role = _staff_role_for_employee_role(employee_role.key)
            rec.username = nu
            rec.email = em_norm or None
            rec.name = new_name.strip() or nu
            rec.position = pos
            rec.staff_role = staff_role
            rec.employee_role_id = employee_role.id
            _org_ids_saved, _account_ids_saved = _sync_employee_access(
                session,
                rec.id,
                oid,
                org_ids,
                account_ids or [],
            )
            rec.organization_id = primary_org_id
            if pw:
                rec.password_hash = _pwd.hash(pw)
            sess = session_payload(_user_to_dict(rec))
        invalidate_username(ou)
        if nu.lower() != ou.lower():
            invalidate_username(nu)
        return True, "", sess
    except IntegrityError:
        return False, "Пользователь с таким логином или почтой уже существует.", None


def delete_employee(owner_user_id: str, username: str, organization_id: str = "") -> tuple[bool, str]:
    oid = owner_user_id.strip()
    un = username.strip()
    with session_scope() as session:
        rec = session.scalar(
            select(User).where(
                User.employer_user_id == oid,
                func.lower(User.username) == un.lower(),
            ),
        )
        if rec is None:
            return False, "Сотрудник не найден."
        session.delete(rec)
    invalidate_username(un)
    return True, ""


def set_employee_frozen(owner_user_id: str, username: str, frozen: bool) -> tuple[bool, str]:
    oid = owner_user_id.strip()
    un = username.strip()
    if not oid or not un:
        return False, "Сотрудник не найден."
    with session_scope() as session:
        rec = session.scalar(
            select(User).where(
                User.employer_user_id == oid,
                func.lower(User.username) == un.lower(),
            ),
        )
        if rec is None:
            return False, "Сотрудник не найден."
        rec.is_frozen = bool(frozen)
        session.flush()
    invalidate_username(un)
    return True, ""


def delete_user(username: str) -> tuple[bool, str]:
    un = username.strip()
    with session_scope() as session:
        if int(session.scalar(select(func.count(User.id)).where(User.role != "org")) or 0) <= 1:
            return False, "Нельзя удалить единственную учётную запись."
        deleted = _get_by_username(session, un)
        if deleted is None:
            return False, "Пользователь не найден."
        if deleted.superuser:
            return False, "Главного администратора нельзя удалить."
        if deleted.role == "admin":
            other_admins = int(
                session.scalar(
                    select(func.count(User.id)).where(
                        User.role == "admin",
                        User.id != deleted.id,
                    ),
                )
                or 0,
            )
            if other_admins <= 0:
                return False, "Нельзя удалить последнего администратора."
        deleted_id = deleted.id
        is_business_owner = not deleted.employer_user_id and deleted.role == "user"
        workspace_ids = [deleted_id]
        if is_business_owner:
            workspace_ids = [
                str(x)
                for x in session.scalars(
                    select(Organization.id).where(Organization.owner_user_id == deleted_id),
                ).all()
            ] or [deleted_id]
            hidden_ids = [x for x in workspace_ids if x != deleted_id]
            if hidden_ids:
                session.execute(delete(User).where(User.id.in_(hidden_ids), User.role == "org"))
        session.execute(delete(User).where(User.employer_user_id == deleted_id))
        session.delete(deleted)

    if is_business_owner:
        for wid in workspace_ids:
            delete_workspace_settings(wid)
            delete_treasury(wid)
    invalidate_username(un)
    return True, ""


def save_user_avatar(user_id: str, avatar_path: str) -> dict[str, Any] | None:
    with session_scope() as session:
        u = _get_by_id(session, user_id)
        if not u:
            return None
        u.avatar_path = avatar_path
        return session_payload(_user_to_dict(u))


def update_user(
    old_username: str,
    *,
    new_username: str,
    new_password: str = "",
    new_name: str | None = None,
    new_role: str | None = None,
    new_email: str | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """Обновить учётную запись (админ-панель). Сотрудников здесь не редактируем."""

    ou = old_username.strip()
    nu = new_username.strip()
    if not nu:
        return False, "Укажите логин.", None
    if not _USERNAME_RE.match(nu):
        return False, "Логин: 2–64 символа, латиница, цифры, ._-", None

    em_norm: str | None = None
    if new_email is not None:
        em_raw = new_email.strip()
        if not em_raw:
            return False, "Укажите электронную почту.", None
        if not email_valid(em_raw):
            return False, "Некорректный адрес электронной почты.", None
        em_norm = normalize_email(em_raw)

    pw = new_password.strip()
    if pw:
        if len(pw) < 8:
            return False, "Пароль не короче 8 символов.", None

    try:
        with session_scope() as session:
            rec = _get_by_username(session, ou)
            if rec is None:
                return False, "Пользователь не найден.", None
            if rec.employer_user_id:
                return (
                    False,
                    "Сотрудников редактирует владелец на вкладке «Сотрудники».",
                    None,
                )
            if _username_exists(session, nu, exclude_id=rec.id):
                return False, "Пользователь с таким логином уже существует.", None
            if em_norm and _email_exists(session, em_norm, exclude_id=rec.id):
                return (
                    False,
                    "Пользователь с таким адресом электронной почты уже существует.",
                    None,
                )

            is_sup = bool(rec.superuser)
            rec.username = nu
            if em_norm is not None:
                rec.email = em_norm
            if pw:
                rec.password_hash = _pwd.hash(pw)

            if not is_sup:
                if new_name is not None:
                    rec.name = new_name.strip() or rec.username
                if new_role is not None:
                    if new_role not in {"user", "admin"}:
                        return False, "Недопустимая роль.", None
                    if rec.role == "admin" and new_role == "user":
                        other_admin = int(
                            session.scalar(
                                select(func.count(User.id)).where(
                                    User.role == "admin",
                                    User.id != rec.id,
                                ),
                            )
                            or 0,
                        )
                        if other_admin <= 0:
                            return (
                                False,
                                "Нельзя снять роль с последнего администратора.",
                                None,
                            )
                    rec.role = new_role
            sess = session_payload(_user_to_dict(rec))
        invalidate_username(ou)
        if nu.lower() != ou.lower():
            invalidate_username(nu)
        return True, "", sess
    except IntegrityError:
        return False, "Пользователь с таким логином или почтой уже существует.", None


def update_self_account(
    user_id: str,
    *,
    username: str,
    name: str,
    current_password: str,
    new_password: str = "",
    new_password_confirm: str = "",
    email: str | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    uid = (user_id or "").strip()
    uname = username.strip()
    if not uid:
        return False, "Сессия не найдена.", None
    if not uname:
        return False, "Укажите логин.", None
    if not _USERNAME_RE.match(uname):
        return False, "Логин: 2-64 символа, латиница, цифры, ._-", None
    npw = new_password.strip()
    npw_c = new_password_confirm.strip()
    if npw or npw_c:
        if len(npw) < 8:
            return False, "Пароль не короче 8 символов.", None
        if npw != npw_c:
            return False, "Пароли не совпадают.", None
    try:
        with session_scope() as session:
            rec = _get_by_id(session, uid)
            if rec is None or str(rec.role or "") == "org":
                return False, "Пользователь не найден.", None
            if not _pwd.verify(current_password or "", rec.password_hash or ""):
                return False, "Текущий пароль неверный.", None
            if _username_exists(session, uname, exclude_id=rec.id):
                return False, "Пользователь с таким логином уже существует.", None
            email_norm: str | None = None
            if email is not None:
                raw_email = email.strip()
                if raw_email:
                    if not email_valid(raw_email):
                        return False, "Некорректный адрес электронной почты.", None
                    email_norm = normalize_email(raw_email)
                    if _email_exists(session, email_norm, exclude_id=rec.id):
                        return False, "Пользователь с такой почтой уже существует.", None
                rec.email = email_norm
            old_username = rec.username
            rec.username = uname
            rec.name = name.strip() or uname
            if npw:
                rec.password_hash = _pwd.hash(npw)
            sess = session_payload(_user_to_dict(rec))
        invalidate_username(old_username)
        if uname.lower() != old_username.lower():
            invalidate_username(uname)
        return True, "", sess
    except IntegrityError:
        return False, "Пользователь с таким логином или почтой уже существует.", None


def reset_employee_password(
    owner_user_id: str,
    employee_id: str,
    organization_id: str = "",
) -> tuple[bool, str, str]:
    oid = owner_user_id.strip()
    eid = employee_id.strip()
    if not oid or not eid:
        return False, "Сотрудник не найден.", ""
    alphabet = string.ascii_letters + string.digits
    temp_password = "".join(secrets.choice(alphabet) for _ in range(12))
    with session_scope() as session:
        stmt = select(User).where(User.id == eid, User.employer_user_id == oid)
        org_clause = _employee_org_clause(oid, organization_id)
        if org_clause is not None:
            stmt = stmt.where(org_clause)
        rec = session.scalar(stmt)
        if rec is None:
            return False, "Сотрудник не найден.", ""
        rec.password_hash = _pwd.hash(temp_password)
        username = rec.username
    invalidate_username(username)
    return True, "", temp_password


def migrate_legacy_superuser_flag() -> None:
    with session_scope() as session:
        users = session.scalars(select(User)).all()
        if len(users) != 1 or any(u.superuser for u in users):
            return
        users[0].superuser = True


def bootstrap_from_env(username: str, password: str, display_name: str) -> None:
    if user_count() > 0:
        return
    u = username.strip()
    p = password.strip()
    if not u or not p:
        return
    add_user(
        u,
        p,
        display_name.strip() or "Администратор",
        role="admin",
        email="",
        superuser=True,
        require_email=False,
    )
