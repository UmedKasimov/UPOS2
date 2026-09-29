from upos import telegram_client


def test_read_business_message_calls_telegram_business_api(monkeypatch):
    captured = {}

    def fake_api_call(token, method, **kwargs):
        captured.update(token=token, method=method, **kwargs)
        return True

    monkeypatch.setattr(telegram_client, "_api_call", fake_api_call)

    assert telegram_client.read_business_message("bot-token", "connection-1", 42, 77) is True
    assert captured["token"] == "bot-token"
    assert captured["method"] == "readBusinessMessage"
    assert captured["json_body"] == {
        "business_connection_id": "connection-1",
        "chat_id": 42,
        "message_id": 77,
    }

