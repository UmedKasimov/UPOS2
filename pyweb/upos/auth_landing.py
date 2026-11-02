"""Choose a safe first page for an authenticated employee."""

from upos.users_store import ROLE_PERMISSION_DEFAULT_ON


EMPLOYEE_LANDING_PAGES = (
    ("schet", "/schet"),
    ("kassa", "/kassa"),
    ("reports", "/reports"),
    ("shipments", "/shipments"),
    ("employees", "/settings?tab=employees"),
    ("dictionary", "/settings?tab=dictionary"),
    ("settings", "/settings"),
    ("installations", "/installer"),
    ("earnings", "/earnings"),
    ("dashboard", "/dashboard"),
    ("sales", "/sales"),
    ("finance", "/finance"),
    ("products", "/products"),
    ("warehouse", "/warehouse"),
    ("clients", "/clients"),
    ("suppliers", "/suppliers"),
    ("crm", "/crm"),
    ("telephony", "/telephony"),
    ("messengers", "/messengers"),
)


def employee_landing_path(user: dict | None) -> str:
    raw = (user or {}).get("employee_permissions")
    permissions = raw if isinstance(raw, dict) else {}
    for key, path in EMPLOYEE_LANDING_PAGES:
        allowed = bool(permissions[key]) if key in permissions else key in ROLE_PERMISSION_DEFAULT_ON
        if key == "shipments" and key not in permissions:
            allowed = bool(permissions.get("kassa") or permissions.get("reports"))
        if allowed:
            return path
    return "/auth/no-access"


def prevent_auth_redirect_loop(target: str, default: str) -> str:
    return default if target.split("?", 1)[0].split("#", 1)[0] == "/auth" else target
