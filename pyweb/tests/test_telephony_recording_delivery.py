from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from upos import telephony_recording_delivery as delivery
from upos.db_models import TelephonyRecordingDelivery


class RecordingDeliveryTests(TestCase):
    def test_recording_path_stays_in_its_workspace(self):
        with TemporaryDirectory() as temp:
            with patch.object(delivery, "_UPLOAD_ROOT", Path(temp)):
                self.assertIsNotNone(delivery._local_path(
                    "workspace-1", "/static/uploads/telephony/workspace-1/call.webm"
                ))
                self.assertIsNone(delivery._local_path(
                    "workspace-1", "/static/uploads/telephony/workspace-2/call.webm"
                ))
                self.assertIsNone(delivery._local_path(
                    "workspace-1", "/static/uploads/telephony/workspace-1/../workspace-2/call.webm"
                ))

    def test_audio_file_has_client_name_and_call_center_caption(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / "workspace-1"
            folder.mkdir()
            (folder / "call.webm").write_bytes(b"recorded audio")
            row = TelephonyRecordingDelivery(
                id="test", workspace_owner_id="workspace-1",
                recording_path="/static/uploads/telephony/workspace-1/call.webm",
                client_name="Алина", phone="+998901234567",
                started_at="2026-11-03T06:00:00+00:00",
            )
            seen = {}

            def fake_post(url, *, data, files, timeout):
                seen["method"] = url.rsplit("/", 1)[-1]
                seen["chat_id"] = data["chat_id"]
                seen["caption"] = data["caption"]
                seen["name"], stream, seen["mime"] = files["document"]
                seen["content"] = stream.read()
                return type("Response", (), {"status_code": 200, "json": lambda self: {
                    "ok": True, "result": {"message_id": 42}
                }})()

            with patch.object(delivery, "_UPLOAD_ROOT", root), patch.object(delivery.httpx, "post", fake_post):
                self.assertEqual(delivery._send(row, "-100123", "test-token"), 42)
            self.assertEqual(seen["chat_id"], "-100123")
            self.assertEqual(seen["method"], "sendDocument")
            self.assertIn("Звонок от Коллцентра", seen["caption"])
            self.assertIn("Клиент: Алина", seen["caption"])
            self.assertIn("03.11.2026 11:00", seen["caption"])
            self.assertIn("Алина", seen["name"])
            self.assertEqual(seen["content"], b"recorded audio")
