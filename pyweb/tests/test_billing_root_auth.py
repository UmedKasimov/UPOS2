from unittest.mock import patch

from upos import billing_root_auth


def test_reset_token_is_invalidated_after_password_change(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", "test-secret")
    monkeypatch.setenv("BILLING_ROOT_EMAIL", "owner@example.com")
    billing_root_auth.get_settings.cache_clear()
    state = {"email": "owner@example.com", "password_hash": "first-hash"}

    with patch.object(billing_root_auth, "_load_state", side_effect=lambda: dict(state)):
        token = billing_root_auth.create_reset_token("owner@example.com")
        assert billing_root_auth.validate_reset_token(token)
        state["password_hash"] = "second-hash"
        assert not billing_root_auth.validate_reset_token(token)

    billing_root_auth.get_settings.cache_clear()


def test_password_falls_back_to_environment_value():
    with patch.object(billing_root_auth, "_load_state", return_value={}):
        assert billing_root_auth.verify_password("current-password", "current-password")
        assert not billing_root_auth.verify_password("wrong-password", "current-password")


def test_stored_password_hash_takes_precedence():
    password_hash = billing_root_auth._pwd.hash("new-secure-password")
    with patch.object(billing_root_auth, "_load_state", return_value={"password_hash": password_hash}):
        assert billing_root_auth.verify_password("new-secure-password", "old-password")
        assert not billing_root_auth.verify_password("old-password", "old-password")
