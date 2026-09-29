from upos import organizations_store


def setup_function():
    organizations_store.reset_cache_for_tests()


def test_cached_organizations_are_copied_before_return():
    original = [{"id": "org-1", "name": "UPOS", "is_default": True}]
    first = organizations_store._store_organizations("owner-1", original)
    first[0]["name"] = "changed in caller"

    second = organizations_store._cached_organizations("owner-1")

    assert second == [{"id": "org-1", "name": "UPOS", "is_default": True}]


def test_organization_cache_can_be_invalidated():
    organizations_store._store_organizations(
        "owner-1",
        [{"id": "org-1", "name": "UPOS", "is_default": True}],
    )

    organizations_store.invalidate_organizations_cache("owner-1")

    assert organizations_store._cached_organizations("owner-1") is None
