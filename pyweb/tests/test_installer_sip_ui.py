from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class InstallerSipUiTests(unittest.TestCase):
    def test_installer_calls_only_through_sip(self):
        script = (ROOT / "upos" / "static" / "installer.js").read_text(encoding="utf-8")

        self.assertNotIn("tel:", script)
        self.assertIn("await sip.prepareAudio()", script)
        self.assertIn("await sip.connect(account)", script)

    def test_softphone_uses_mysputnik_compatible_rtc_options(self):
        script = (ROOT / "upos" / "static" / "installer-softphone.js").read_text(encoding="utf-8")

        self.assertIn("pcConfig: {}", script)
        self.assertNotIn('rtcpMuxPolicy: "require"', script)
        self.assertIn("getUserMedia({audio: true, video: false})", script)


if __name__ == "__main__":
    unittest.main()
