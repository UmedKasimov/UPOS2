import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "upos"
EXTENSION = ROOT / "chrome_extension"


class ChromePhoneExtensionTests(unittest.TestCase):
    def test_background_phone_is_packaged_without_remote_scripts(self):
        manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["manifest_version"], 3)
        self.assertIn("offscreen", manifest["permissions"])
        self.assertIn("storage", manifest["permissions"])
        self.assertEqual(manifest["action"]["default_popup"], "popup.html")
        for filename in ("background.js", "offscreen.js", "offscreen.html", "popup.js", "popup.css", "popup.html", "icon.png"):
            self.assertTrue((EXTENSION / filename).is_file(), filename)
        self.assertEqual((EXTENSION / "jssip.min.js").read_bytes(), (ROOT / "static" / "jssip.min.js").read_bytes())
        self.assertEqual((EXTENSION / "softphone.js").read_bytes(), (ROOT / "static" / "installer-softphone.js").read_bytes())
        self.assertIn("WEB_RTC", (EXTENSION / "background.js").read_text(encoding="utf-8"))
        self.assertNotIn('"AUDIO_PLAYBACK"', (EXTENSION / "background.js").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
