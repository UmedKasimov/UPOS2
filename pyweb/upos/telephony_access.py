from __future__ import annotations

from typing import Any


def sip_account_owner_id(user: dict[str, Any], workspace_owner_id: str) -> str:
    """The login owner's ID may differ from the active organization's ID."""
    return str(user.get("account_owner_id") or user.get("user_id") or workspace_owner_id).strip()


def sip_provider_assigned_to(
    provider: dict[str, Any], employee_user_id: str, employee_name: str = "", owner_user_id: str = "",
    legacy_owner_workspace_id: str = "",
) -> bool:
    """Only the assigned employee may receive this SIP account's credentials."""
    if not employee_user_id:
        return True
    assigned_id = str(provider.get("employee_user_id") or "").strip()
    if assigned_id:
        return assigned_id == employee_user_id or bool(
            employee_user_id == owner_user_id and assigned_id == legacy_owner_workspace_id
        )
    # Older installations stored the employee's name instead of a stable ID.
    assigned_name = str(provider.get("employee") or "").strip().casefold()
    if not assigned_name and employee_user_id == owner_user_id:
        return True
    return bool(assigned_name and assigned_name == employee_name.strip().casefold())


def has_assigned_sip_line(
    providers: Any, employee_user_id: str, employee_name: str = "", owner_user_id: str = "",
    legacy_owner_workspace_id: str = "",
) -> bool:
    """Show the phone only when this account has a configured SIP line."""
    if not isinstance(providers, list):
        return False
    return any(
        isinstance(provider, dict)
        and sip_provider_assigned_to(
            provider, employee_user_id, employee_name, owner_user_id, legacy_owner_workspace_id
        )
        and str(provider.get("host") or provider.get("endpoint") or "").strip()
        and str(provider.get("login") or provider.get("account") or provider.get("extension") or "").strip()
        and str(provider.get("password") or "").strip()
        for provider in providers
    )
