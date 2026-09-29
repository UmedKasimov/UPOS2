from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from upos.db import session_scope
from upos.db_models import Organization, User
from upos.storage import load_workspace_settings, save_workspace_settings, valid_workspace_owner_id

DEFAULT_ORGANIZATION_NAME = "Организация"
ORG_USER_ROLE = "org"
ORG_USER_PREFIX = "__org_"
COMMON_SETTING_KEYS = (
    "theme",
    "locale",
    "timezone",
    "available_currencies",
    "enabled_currencies",
)


def _clean_name(raw: str) -> str:
    name = (raw or "").strip()
    if not name:
        return DEFAULT_ORGANIZATION_NAME
    return name[:160]


def _clean_note(raw: str) -> str:
    return (raw or "").strip()[:1000]


def _hidden_username(org_id: str) -> str:
    return f"{ORG_USER_PREFIX}{org_id.replace('-', '')}"[:64]


def _org_to_dict(org: Organization) -> dict[str, Any]:
    return {
        "id": org.id,
        "owner_user_id": org.owner_user_id,
        "name": org.name or DEFAULT_ORGANIZATION_NAME,
        "note": org.note or "",
        "is_default": bool(org.is_default),
        "is_active": bool(org.is_active),
    }


def _is_business_owner(user: User | None) -> bool:
    return bool(
        user
        and not user.employer_user_id
        and str(user.role or "") == "user"
    )


def ensure_default_organization(owner_user_id: str) -> dict[str, Any] | None:
    owner_id = (owner_user_id or "").strip()
    if not valid_workspace_owner_id(owner_id):
        return None
    with session_scope() as session:
        owner = session.get(User, owner_id)
        if not _is_business_owner(owner):
            return None

        orgs = session.scalars(
            select(Organization)
            .where(Organization.owner_user_id == owner_id, Organization.is_active.is_(True))
            .order_by(Organization.is_default.desc(), Organization.created_at, Organization.name),
        ).all()
        if orgs:
            current = next((org for org in orgs if org.is_default), None)
            preferred = next((org for org in orgs if org.id == owner_id), None) or current or orgs[0]
            for org in orgs:
                org.is_default = org.id == preferred.id
            if not preferred.name:
                preferred.name = DEFAULT_ORGANIZATION_NAME
            return _org_to_dict(preferred)

        org = Organization(
            id=owner_id,
            owner_user_id=owner_id,
            name=DEFAULT_ORGANIZATION_NAME,
            note="",
            is_default=True,
            is_active=True,
        )
        session.add(org)
        session.execute(
            update(User)
            .where(User.employer_user_id == owner_id, User.organization_id.is_(None))
            .values(organization_id=owner_id),
        )
        return _org_to_dict(org)


def ensure_organizations_for_existing_owners() -> None:
    with session_scope() as session:
        owners = session.scalars(
            select(User)
            .where(
                User.employer_user_id.is_(None),
                User.role == "user",
            )
            .order_by(User.created_at, func.lower(User.username)),
        ).all()
        for owner in owners:
            exists = session.scalar(
                select(Organization.id).where(
                    Organization.owner_user_id == owner.id,
                    Organization.is_active.is_(True),
                ),
            )
            if not exists:
                session.add(
                    Organization(
                        id=owner.id,
                        owner_user_id=owner.id,
                        name=DEFAULT_ORGANIZATION_NAME,
                        note="",
                        is_default=True,
                        is_active=True,
                    ),
                )
            session.execute(
                update(User)
                .where(User.employer_user_id == owner.id, User.organization_id.is_(None))
                .values(organization_id=owner.id),
            )


def list_organizations(owner_user_id: str) -> list[dict[str, Any]]:
    owner_id = (owner_user_id or "").strip()
    ensure_default_organization(owner_id)
    with session_scope() as session:
        rows = session.scalars(
            select(Organization)
            .where(Organization.owner_user_id == owner_id, Organization.is_active.is_(True))
            .order_by(Organization.is_default.desc(), func.lower(Organization.name)),
        ).all()
        return [_org_to_dict(org) for org in rows]


def list_organization_ids(owner_user_id: str) -> list[str]:
    return [str(org["id"]) for org in list_organizations(owner_user_id)]


def get_organization(owner_user_id: str, organization_id: str) -> dict[str, Any] | None:
    owner_id = (owner_user_id or "").strip()
    org_id = (organization_id or "").strip()
    if not valid_workspace_owner_id(owner_id) or not valid_workspace_owner_id(org_id):
        return None
    ensure_default_organization(owner_id)
    with session_scope() as session:
        org = session.scalar(
            select(Organization).where(
                Organization.owner_user_id == owner_id,
                Organization.id == org_id,
                Organization.is_active.is_(True),
            ),
        )
        return _org_to_dict(org) if org else None


def default_organization(owner_user_id: str) -> dict[str, Any] | None:
    return ensure_default_organization(owner_user_id)


def _seed_workspace_common_settings(owner_user_id: str, organization_id: str) -> None:
    owner_settings = load_workspace_settings(owner_user_id)
    org_settings = load_workspace_settings(organization_id)
    for key in COMMON_SETTING_KEYS:
        if key in owner_settings:
            org_settings[key] = owner_settings[key]
    save_workspace_settings(organization_id, org_settings)


def create_organization(owner_user_id: str, name: str, note: str = "") -> tuple[bool, str, dict[str, Any] | None]:
    owner_id = (owner_user_id or "").strip()
    if not ensure_default_organization(owner_id):
        return False, "Владелец не найден.", None

    org_id = str(uuid.uuid4())
    clean_name = _clean_name(name)
    clean_note = _clean_note(note)
    try:
        with session_scope() as session:
            owner = session.get(User, owner_id)
            if not _is_business_owner(owner):
                return False, "Владелец не найден.", None
            session.add(
                User(
                    id=org_id,
                    username=_hidden_username(org_id),
                    email=None,
                    password_hash="!",
                    name=clean_name,
                    role=ORG_USER_ROLE,
                    superuser=False,
                ),
            )
            org = Organization(
                id=org_id,
                owner_user_id=owner_id,
                name=clean_name,
                note=clean_note,
                is_default=False,
                is_active=True,
            )
            session.add(org)
            out = _org_to_dict(org)
        _seed_workspace_common_settings(owner_id, org_id)
        return True, "", out
    except IntegrityError:
        return False, "Организация с таким названием уже существует.", None


def update_organization(
    owner_user_id: str,
    organization_id: str,
    *,
    name: str,
    note: str = "",
) -> tuple[bool, str, dict[str, Any] | None]:
    owner_id = (owner_user_id or "").strip()
    org_id = (organization_id or "").strip()
    if not valid_workspace_owner_id(owner_id) or not valid_workspace_owner_id(org_id):
        return False, "Организация не найдена.", None
    clean_name = _clean_name(name)
    clean_note = _clean_note(note)
    try:
        with session_scope() as session:
            org = session.scalar(
                select(Organization).where(
                    Organization.owner_user_id == owner_id,
                    Organization.id == org_id,
                    Organization.is_active.is_(True),
                ),
            )
            if org is None:
                return False, "Организация не найдена.", None
            org.name = clean_name
            org.note = clean_note
            identity = session.get(User, org_id)
            if identity and identity.role == ORG_USER_ROLE:
                identity.name = clean_name
            return True, "", _org_to_dict(org)
    except IntegrityError:
        return False, "Организация с таким названием уже существует.", None


def sync_common_settings(owner_user_id: str, source_data: dict[str, Any]) -> None:
    owner_id = (owner_user_id or "").strip()
    common = {key: source_data[key] for key in COMMON_SETTING_KEYS if key in source_data}
    if not common:
        return
    for org_id in list_organization_ids(owner_id):
        data = load_workspace_settings(org_id)
        data.update(common)
        save_workspace_settings(org_id, data)
