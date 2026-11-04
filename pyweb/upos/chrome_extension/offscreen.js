(() => {
  "use strict";
  const softphone = window.UposSoftphone;
  let credentials = null;
  let currentCall = null;
  let recorder = null;
  let ringContext = null;
  let ringTimer = null;
  let state = {phase: "offline", phone: "", message: ""};

  function publish(next) {
    state = {...state, ...next};
    void chrome.runtime.sendMessage({target: "background", type: "state", state}).catch(() => {});
  }

  function stopRing() {
    clearInterval(ringTimer);
    ringTimer = null;
    if (ringContext) void ringContext.close().catch(() => {});
    ringContext = null;
  }

  function startRing() {
    stopRing();
    try {
      ringContext = new AudioContext();
      const tone = () => {
        if (!ringContext || ringContext.state === "closed") return;
        void ringContext.resume().catch(() => {});
        const oscillator = ringContext.createOscillator();
        const gain = ringContext.createGain();
        oscillator.frequency.value = 440;
        gain.gain.value = 0.12;
        oscillator.connect(gain).connect(ringContext.destination);
        oscillator.start();
        oscillator.stop(ringContext.currentTime + 0.35);
      };
      tone();
      ringTimer = setInterval(tone, 1100);
    } catch (_) { /* Notification remains available if audio is blocked. */ }
  }

  function makeCall(direction, phone) {
    currentCall = {
      call_id: crypto.randomUUID(), phone: String(phone || ""), direction,
      started_at: new Date().toISOString(), answeredAt: 0,
    };
    void syncCall("planned", currentCall);
  }

  async function syncCall(status, call) {
    if (!credentials?.token || !call) return;
    try {
      await fetch("https://app.u-pos.uz/api/telephony/calls/ingest", {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-UPOS-SIP-Token": credentials.token},
        body: JSON.stringify({workspace_owner_id: credentials.workspaceId,
          provider_id: credentials.account.id, device_id: credentials.deviceId || "",
          call_id: call.call_id, phone: call.phone, direction: call.direction,
          started_at: call.started_at, status,
          duration: call.answeredAt ? Math.floor((Date.now() - call.answeredAt) / 1000) : 0,
          source: "chrome-extension"}),
      });
    } catch (_) { /* SIP call must continue if call logging is unavailable. */ }
  }

  async function uploadRecording(call, blob, uploadCredentials) {
    if (!uploadCredentials?.token || !blob.size || blob.size > 50 * 1024 * 1024) return;
    const body = new FormData();
    body.set("workspace_owner_id", uploadCredentials.workspaceId);
    body.set("provider_id", String(uploadCredentials.account.id || ""));
    body.set("call_id", call.call_id);
    body.set("phone", call.phone);
    body.set("direction", call.direction);
    body.set("started_at", call.started_at);
    body.set("status", "answered");
    body.set("source", "chrome-extension");
    body.set("file", blob, "call.webm");
    try {
      const response = await fetch("https://app.u-pos.uz/api/telephony/recordings/upload", {
        method: "POST", headers: {"X-UPOS-SIP-Token": uploadCredentials.token}, body,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (_) { publish({message: "Запись не удалось отправить в U-POS"}); }
  }

  function startRecording() {
    if (recorder || !currentCall?.answeredAt || !window.MediaRecorder) return;
    const tracks = softphone.recordingTracks();
    if (!tracks.local.length || !tracks.remote.length) return;
    if (!MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return;
    let context;
    try {
      context = new AudioContext();
      const output = context.createMediaStreamDestination();
      const sources = [tracks.local[0], tracks.remote[0]].map((track) => {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(output);
        return source;
      });
      const call = {...currentCall};
      const uploadCredentials = credentials;
      const chunks = [];
      const recording = new MediaRecorder(output.stream, {mimeType: "audio/webm;codecs=opus"});
      recording.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recording.onstop = () => {
        sources.forEach((source) => source.disconnect());
        output.stream.getTracks().forEach((track) => track.stop());
        void context.close();
        const blob = new Blob(chunks, {type: "audio/webm;codecs=opus"});
        if (blob.size) void uploadRecording(call, blob, uploadCredentials);
      };
      recording.start(1000);
      void context.resume().catch(() => {});
      recorder = recording;
    } catch (_) {
      if (context) void context.close();
      publish({message: "Не удалось начать запись"});
    }
  }

  function finishCall(status) {
    stopRing();
    const call = currentCall;
    currentCall = null;
    if (recorder?.state === "recording") recorder.stop();
    recorder = null;
    if (call) void syncCall(status || (call.answeredAt ? "answered" : "missed"), call);
    publish({phase: softphone.isRegistered() ? "ready" : "offline", phone: "", muted: false});
  }

  softphone.on("registered", () => publish({phase: "ready", message: "Линия подключена"}));
  softphone.on("unregistered", () => publish({phase: "offline", message: "SIP отключён"}));
  softphone.on("disconnected", () => publish({phase: "offline", message: "Связь с АТС потеряна"}));
  softphone.on("registrationFailed", () => publish({phase: "error", message: "Ошибка регистрации SIP"}));
  softphone.on("incoming", (event) => {
    makeCall("incoming", event.from || "");
    publish({phase: "incoming", phone: event.from || "", message: event.name || "Входящий вызов"});
    startRing();
  });
  softphone.on("progress", () => publish({phase: "dialing", message: "Вызов идёт"}));
  softphone.on("accepted", () => {
    stopRing();
    if (currentCall) currentCall.answeredAt = Date.now();
    publish({phase: "active", message: "Разговор", muted: false});
    void softphone.resumeRemoteAudio();
    startRecording();
  });
  softphone.on("remoteTrack", startRecording);
  softphone.on("ended", () => finishCall());
  softphone.on("failed", () => finishCall("missed"));

  async function command(message) {
    switch (message.type) {
      case "connect":
        credentials = message.session;
        if (!credentials?.account) throw new Error("Нет SIP-аккаунта");
        if (softphone.isRegistered() && softphone.account()?.id === credentials.account.id) return {ok: true};
        publish({phase: "connecting", message: "Подключение к АТС"});
        await softphone.connect(credentials.account);
        publish({phase: "ready", message: "Линия подключена"});
        return {ok: true};
      case "dial": {
        const phone = String(message.phone || "").replace(/[^\d+*#]/g, "");
        if (!/^\+?\d{2,15}$/.test(phone)) throw new Error("Проверьте номер");
        if (!softphone.isRegistered()) throw new Error("SIP ещё не подключён");
        if (softphone.inCall()) throw new Error("Уже есть активный звонок");
        await softphone.prepareAudio();
        makeCall("outgoing", phone);
        try {
          if (!softphone.call(phone)) throw new Error("Не удалось набрать номер");
        } catch (error) {
          finishCall("missed");
          throw error;
        }
        publish({phase: "dialing", phone, message: "Набор номера"});
        return {ok: true};
      }
      case "answer":
        stopRing();
        return {ok: await softphone.answer()};
      case "reject":
        stopRing();
        return {ok: softphone.reject()};
      case "redirect":
        return {ok: softphone.redirectIncoming(message.phone), error: "АТС не разрешила переадресацию"};
      case "transfer":
        return {ok: softphone.transferActive(message.phone), error: "АТС не приняла запрос перевода"};
      case "hangup":
        softphone.hangup();
        return {ok: true};
      case "dtmf":
        return {ok: softphone.sendDtmf(message.digit)};
      case "mute":
        if (!softphone.inCall()) throw new Error("Нет активного разговора");
        softphone.setMuted(Boolean(message.muted));
        publish({muted: Boolean(message.muted)});
        return {ok: true, muted: Boolean(message.muted)};
      case "disconnect":
        stopRing();
        softphone.disconnect();
        credentials = null;
        currentCall = null;
        publish({phase: "offline", phone: "", muted: false, message: "Отключено"});
        return {ok: true};
      default:
        throw new Error("Неизвестное действие");
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "offscreen") return;
    command(message).then(sendResponse, (error) => sendResponse({ok: false, error: error?.message || "Ошибка SIP"}));
    return true;
  });
})();
