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
        self.assertIn("noiseSuppression: false", script)
        self.assertIn("autoGainControl: false", script)
        self.assertIn("channelCount: {ideal: 1}", script)
        self.assertNotIn("latency: {ideal: 0.02}", script)
        self.assertIn('const SOFTPHONE_VERSION = "12"', script)
        self.assertIn("softphoneVersion: SOFTPHONE_VERSION", script)
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
        self.assertNotIn("createMediaStreamDestination", script)
        self.assertNotIn("startRingback", script)
        self.assertIn('diagnostic(`session_${event}`', script)
        self.assertIn('diagnostic("session_no_response"', script)
        self.assertIn('diagnostic("transport_lost"', script)
        self.assertIn('diagnostic("remote_audio_playing"', script)
        self.assertIn("audioContext.createMediaStreamSource(remoteStream)", script)
        self.assertIn("remoteAudioGain.connect(audioContext.destination)", script)
        self.assertIn("await ensureAudioContext()", script)
        self.assertIn('diagnostic("remote_audio_fallback"', script)
        self.assertIn('diagnostic("media_quality"', script)
        self.assertIn('track.contentHint = "speech"', script)
        self.assertIn("if (!speakerEnabled) closeAudioContext()", script)
        self.assertIn("el.muted = false", script)
        self.assertIn('diagnostic("audio_unlocked", {mode: "direct"})', script)
        self.assertIn("if (!streamChanged && !el.paused", script)
        self.assertNotIn("window.setTimeout(attachRemoteAudio", script)

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
        self.assertIn("sip.setSpeaker(false)", script)
        self.assertIn("await window.InstallerSoftphone?.unlockAudio?.()", script)
        self.assertIn('event: "call_button_pressed"', script)
        self.assertIn('registeredAccountId !== String(account.id || "")', script)
        self.assertIn("if (sip.inCall()) return Promise.resolve(true);", script)
        self.assertIn('String(account.extension || "").trim() === "210"', script)

    def test_pwa_cache_uses_current_installer_assets(self):
        template = (ROOT / "upos" / "templates" / "installer.html").read_text(encoding="utf-8")
        script = (ROOT / "upos" / "static" / "installer.js").read_text(encoding="utf-8")
        service_worker = (ROOT / "upos" / "static" / "installer-sw.js").read_text(encoding="utf-8")

        for asset in (
            "/static/installer.css?v=32",
            "/static/installer.js?v=32",
            "/static/installer-softphone.js?v=12",
        ):
            self.assertIn(asset, template)
            self.assertIn(asset, service_worker)

        self.assertIn('client.navigate(url.href)', service_worker)
        self.assertIn('url.searchParams.set("pwa_v", INSTALLER_BUILD)', service_worker)
        self.assertIn('fetch(event.request, {cache: "no-store"})', service_worker)

        self.assertIn('addEventListener("controllerchange"', script)
        self.assertIn('register("/installer-sw.js?v=32"', script)

    def test_service_worker_update_is_public_and_not_cached(self):
        main = (ROOT / "upos" / "main.py").read_text(encoding="utf-8")

        self.assertIn('"/installer-sw.js"', main)
        self.assertIn('"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"', main)


if __name__ == "__main__":
    unittest.main()
