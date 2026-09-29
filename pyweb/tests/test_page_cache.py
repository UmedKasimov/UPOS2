from upos import page_cache


def setup_function():
    page_cache.reset_for_tests()


def test_page_cache_round_trip_without_redis(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    payload = b"<html>cached</html>"

    assert page_cache.set_page("workspace", "session", "/clients", payload)
    assert page_cache.get_page("workspace", "session", "/clients") == payload
    assert page_cache.get_page("workspace", "other-session", "/clients") is None


def test_page_cache_invalidation_changes_workspace_generation(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    page_cache.set_page("workspace", "session", "/reports", b"old")

    page_cache.invalidate_workspace("workspace")

    assert page_cache.get_page("workspace", "session", "/reports") is None


def test_page_cache_rejects_oversized_payload(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setattr(page_cache, "_MAX_PAYLOAD_BYTES", 4)

    assert not page_cache.set_page("workspace", "session", "/sales", b"12345")


def test_memory_cache_keeps_compressed_payload(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    payload = b"a" * 10000

    assert page_cache.set_page("workspace", "session", "/clients", payload)
    assert page_cache.get_page("workspace", "session", "/clients") == payload
    assert all(len(cached) < len(payload) for _expires, cached in page_cache._memory_cache.values())
