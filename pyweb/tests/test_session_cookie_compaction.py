from upos.users_store import compact_employee_permissions, compact_session_organizations


def test_large_role_rules_do_not_enter_session_cookie():
    permissions = {
        "crm": True,
        "messengers": False,
        "button_access": {"crm": {f"action_{i}": True for i in range(500)}},
        "category_access": {"enabled": True, "category_ids": [str(i) for i in range(500)]},
    }

    compact = compact_employee_permissions(permissions)

    assert compact == {"crm": True, "messengers": False}
    assert "button_access" in permissions
    assert "category_access" in permissions


def test_organization_switcher_keeps_only_its_fields_in_session():
    organizations = [{"id": "org-1", "name": "Market", "note": "Main", "settings": {"blob": "x" * 8000}}]

    assert compact_session_organizations(organizations) == [
        {"id": "org-1", "name": "Market", "note": "Main"}
    ]
