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
        self.assertIn("navigator.mediaDevices.getUserMedia", script)
        self.assertIn("echoCancellation: true", script)
        self.assertIn("mediaStream: liveMicrophoneStream() || undefined", script)
        self.assertIn("disconnect({preserveMicrophone: true})", script)

    def test_softphone_connects_remote_voice_and_speaker_control(self):
        script = (ROOT / "upos" / "static" / "installer-softphone.js").read_text(encoding="utf-8")

        self.assertIn('pc.addEventListener("track", attachRemoteAudio)', script)
        self.assertIn("el.srcObject = remoteStream", script)
        self.assertIn("setSpeaker(enabled)", script)
        self.assertIn("resumeRemoteAudio()", script)

    def test_installer_has_modal_call_experience(self):
        template = (ROOT / "upos" / "templates" / "installer.html").read_text(encoding="utf-8")
        script = (ROOT / "upos" / "static" / "installer.js").read_text(encoding="utf-8")

        self.assertIn('<dialog class="installer-call-screen" id="installer-call-screen">', template)
        self.assertIn('id="installer-call-audio-state"', template)
        self.assertIn('id="installer-call-speaker"', template)
        self.assertIn("callScreen.showModal()", script)
        self.assertIn('sip.on("audioPlaying"', script)
        self.assertIn('document.getElementById("installer-call-speaker")', script)


if __name__ == "__main__":
    unittest.main()
