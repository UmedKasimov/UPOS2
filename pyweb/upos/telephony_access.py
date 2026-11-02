from __future__ import annotations

from typing import Any


def sip_provider_assigned_to(
    provider: dict[str, Any], employee_user_id: str, employee_name: str = "", owner_user_id: str = ""
) -> bool:
    """Only the assigned employee may receive this SIP account's credentials."""
    if not employee_user_id:
        return True
    assigned_id = str(provider.get("employee_user_id") or "").strip()
    if assigned_id:
        return assigned_id == employee_user_id
    # Older installations stored the employee's name instead of a stable ID.
    assigned_name = str(provider.get("employee") or "").strip().casefold()
    if not assigned_name and employee_user_id == owner_user_id:
        return True
    return bool(assigned_name and assigned_name == employee_name.strip().casefold())
