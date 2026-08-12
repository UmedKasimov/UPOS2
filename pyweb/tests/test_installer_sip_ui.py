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
        self.assertIn("unlockAudio()", script)
        self.assertIn("window.AudioContext || window.webkitAudioContext", script)
        self.assertIn('diagnostic("remote_audio_playing"', script)

    def test_installer_has_modal_call_experience(self):
        template = (ROOT / "upos" / "templates" / "installer.html").read_text(encoding="utf-8")
        script = (ROOT / "upos" / "static" / "installer.js").read_text(encoding="utf-8")

        self.assertIn('<dialog class="installer-call-screen" id="installer-call-screen">', template)
        self.assertIn('id="installer-call-audio-state"', template)
        self.assertIn('id="installer-call-speaker"', template)
        self.assertIn("callScreen.showModal()", script)
        self.assertIn('sip.on("audioPlaying"', script)
        self.assertIn('document.getElementById("installer-call-speaker")', script)

    def test_installer_remembers_sip_account_and_reports_diagnostics(self):
        script = (ROOT / "upos" / "static" / "installer.js").read_text(encoding="utf-8")

        self.assertIn('const SIP_ACCOUNT_STORAGE_KEY = "upos.installer.sipAccount"', script)
        self.assertIn('/api/installer/sip/diagnostics', script)
        self.assertIn('await sip.unlockAudio?.()', script)

    def test_pwa_cache_uses_current_installer_assets(self):
        template = (ROOT / "upos" / "templates" / "installer.html").read_text(encoding="utf-8")
        service_worker = (ROOT / "upos" / "static" / "installer-sw.js").read_text(encoding="utf-8")

        for asset in (
            "/static/installer.css?v=25",
            "/static/installer.js?v=25",
            "/static/installer-softphone.js?v=5",
        ):
            self.assertIn(asset, template)
            self.assertIn(asset, service_worker)


if __name__ == "__main__":
    unittest.main()
