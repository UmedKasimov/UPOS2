from upos.auth_landing import employee_landing_path, prevent_auth_redirect_loop
from upos.users_store import ROLE_PERMISSION_KEYS


def employee_with_only(permission: str | None) -> dict:
    return {
        "is_employee": True,
        "employee_permissions": {key: key == permission for key in ROLE_PERMISSION_KEYS},
    }


def test_crm_only_employee_uses_crm_instead_of_auth():
    user = employee_with_only("crm")
    assert employee_landing_path(user) == "/crm"
    assert prevent_auth_redirect_loop("/auth", "/crm") == "/crm"


def test_existing_role_missing_new_permissions_gets_available_module():
    user = {"is_employee": True, "employee_permissions": {"schet": False, "kassa": False}}
    assert employee_landing_path(user) == "/dashboard"


def test_employee_without_any_permissions_gets_access_message():
    user = employee_with_only(None)
    assert employee_landing_path(user) == "/auth/no-access"
    assert prevent_auth_redirect_loop("/auth?error=session", "/auth/no-access") == "/auth/no-access"
