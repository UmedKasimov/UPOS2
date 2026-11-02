from types import SimpleNamespace

from upos import auth_sessions_store


def setup_function():
    auth_sessions_store.reset_cache_for_tests()


def test_validation_reuses_recent_result(monkeypatch):
    calls = {"count": 0}

    def load(_session_id):
        calls["count"] += 1
        return SimpleNamespace(user_id="user-1", blocked_at=None, revoked_at=None)

    monkeypatch.setattr(auth_sessions_store, "get_auth_session", load)

    assert auth_sessions_store.validate_auth_session("session-1", "user-1") == (True, None)
    assert auth_sessions_store.validate_auth_session("session-1", "user-1") == (True, None)
    assert calls["count"] == 1


def test_session_cache_invalidation_forces_reload(monkeypatch):
    calls = {"count": 0}

    def load(_session_id):
        calls["count"] += 1
        return SimpleNamespace(user_id="user-1", blocked_at=None, revoked_at=None)

    monkeypatch.setattr(auth_sessions_store, "get_auth_session", load)
    assert auth_sessions_store.validate_auth_session("session-1", "user-1") == (True, None)

    auth_sessions_store._invalidate_session_cache("session-1")

    assert auth_sessions_store.validate_auth_session("session-1", "user-1") == (True, None)
    assert calls["count"] == 2
