from upos import telegram_inbox


def test_private_message_is_persisted_with_stable_external_id(monkeypatch):
    calls = []
    monkeypatch.setattr(telegram_inbox, "upsert_thread", lambda *args, **kwargs: {"id": "thread-1"})

    def add(*args, **kwargs):
        calls.append(kwargs)
        return {"duplicate": len(calls) > 1}

    monkeypatch.setattr(telegram_inbox, "add_message", add)
    message = {
        "message_id": 42,
        "date": 1_700_000_000,
        "chat": {"id": 123, "type": "private"},
        "from": {"id": 123, "first_name": "Ali", "last_name": "Karimov"},
        "text": "Здравствуйте",
    }
    assert telegram_inbox.save_incoming("workspace", message, bot_id=999)
    assert not telegram_inbox.save_incoming("workspace", message, bot_id=999)
    assert calls[0]["external_id"] == "123:42"
    assert calls[0]["channel"] == "telegram_bot"
    assert calls[0]["author"] == "Ali Karimov"


def test_group_and_bot_messages_are_not_saved(monkeypatch):
    monkeypatch.setattr(telegram_inbox, "upsert_thread", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("unexpected write")))
    assert not telegram_inbox.save_incoming("workspace", {"message_id": 1, "chat": {"id": -123, "type": "group"}})
    assert not telegram_inbox.save_incoming("workspace", {
        "message_id": 2, "chat": {"id": 123, "type": "private"}, "from": {"id": 999},
    }, bot_id=999)
