/* Софтфон установщика: SIP-звонки из браузера через WebSocket (JsSIP).
 *
 * Браузер не умеет обычный SIP по UDP/TCP, поэтому голос идёт по SIP-over-WSS.
 * Если у аккаунта нет ws_url или сервер недоступен, модуль сообщает точную
 * ошибку. Звонки установщика всегда остаются внутри SIP.
 */
(() => {
  "use strict";

  const listeners = {};
  function emit(event, detail) {
    (listeners[event] || []).forEach((fn) => {
      try { fn(detail); } catch (_e) { /* игнорируем ошибки подписчика */ }
    });
  }

  let ua = null;
  let session = null;
  let account = null;
  let registered = false;
  let connecting = null;
  let connectingAccountId = "";
  let microphoneStream = null;
  let remoteStream = null;
  let speakerEnabled = true;
  // Модуль общий для установщика и плавающего телефона в вебе: элемент для
  // входящего звука у них разный, поэтому он настраивается.
  let audioElementId = "installer-call-audio";

  const audio = () => document.getElementById(audioElementId);

  function liveMicrophoneStream() {
    if (!microphoneStream) return null;
    return microphoneStream.getAudioTracks().some((track) => track.readyState === "live")
      ? microphoneStream
      : null;
  }

  function releaseMicrophone() {
    if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
  }

  function clearRemoteAudio() {
    const el = audio();
    if (el) {
      el.pause();
      el.srcObject = null;
    }
    remoteStream = null;
  }

  async function playRemoteAudio() {
    const el = audio();
    const tracks = remoteStream ? remoteStream.getAudioTracks().filter((track) => track.readyState === "live") : [];
    if (!el || !tracks.length) {
      emit("audioWaiting", {});
      return false;
    }
    el.playsInline = true;
    el.autoplay = true;
    el.volume = 1;
    el.muted = !speakerEnabled;
    if (!speakerEnabled) {
      emit("speakerChanged", {enabled: false});
      return true;
    }
    try {
      await el.play();
      emit("audioPlaying", {tracks: tracks.length});
      return true;
    } catch (error) {
      emit("audioBlocked", {error});
      return false;
    }
  }

  function addRemoteTrack(track) {
    if (!track || track.kind !== "audio") return;
    if (!remoteStream) remoteStream = new MediaStream();
    if (!remoteStream.getTracks().some((item) => item.id === track.id)) remoteStream.addTrack(track);
    track.addEventListener("unmute", playRemoteAudio);
    track.addEventListener("ended", () => emit("audioEnded", {}));
  }

  function attachRemoteAudio(event) {
    const pc = session && session.connection;
    if (!pc) {
      emit("audioWaiting", {});
      return;
    }
    const eventStream = event && event.streams && event.streams[0];
    if (eventStream) eventStream.getAudioTracks().forEach(addRemoteTrack);
    if (event && event.track) addRemoteTrack(event.track);
    pc.getReceivers().forEach((receiver) => addRemoteTrack(receiver.track));
    const el = audio();
    if (el && remoteStream && el.srcObject !== remoteStream) el.srcObject = remoteStream;
    playRemoteAudio();
  }

  function wirePeerConnection(pc) {
    if (!pc || pc.__uposSoftphoneWired) return;
    pc.__uposSoftphoneWired = true;
    pc.addEventListener("track", attachRemoteAudio);
    pc.addEventListener("connectionstatechange", () => {
      emit("connectionState", {state: pc.connectionState || ""});
      if (pc.connectionState === "connected") attachRemoteAudio();
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      emit("iceState", {state: pc.iceConnectionState || ""});
    });
    attachRemoteAudio();
  }

  function wireSession(newSession, direction) {
    session = newSession;
    remoteStream = null;
    let accepted = false;
    const markAccepted = () => {
      attachRemoteAudio();
      if (accepted) return;
      accepted = true;
      emit("accepted", {direction});
      window.setTimeout(attachRemoteAudio, 250);
      window.setTimeout(attachRemoteAudio, 1000);
    };
    const finish = (event, detail) => {
      emit(event, detail);
      clearRemoteAudio();
      releaseMicrophone();
      session = null;
    };
    session.on("connecting", () => emit("sessionConnecting", {direction}));
    session.on("progress", (e) => emit("progress", {
      direction,
      statusCode: e && e.response && e.response.status_code,
    }));
    session.on("accepted", markAccepted);
    session.on("confirmed", markAccepted);
    session.on("ended", (e) => finish("ended", {cause: e && e.cause}));
    session.on("failed", (e) => finish("failed", {cause: e && e.cause}));
    session.on("peerconnection", (e) => {
      const pc = e && e.peerconnection;
      wirePeerConnection(pc);
    });
    wirePeerConnection(session.connection);
  }

  function registrarUri(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return /^sips?:/i.test(raw) ? raw : `sip:${raw}`;
  }

  const softphone = {
    configure(options) {
      if (options && options.audioId) audioElementId = String(options.audioId);
    },

    account() {
      return account;
    },

    inCall() {
      return Boolean(session);
    },

    available() {
      return typeof window.JsSIP !== "undefined";
    },

    isRegistered() {
      return registered;
    },

    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
    },

    async prepareAudio() {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        const error = new Error("microphone_unavailable");
        error.code = "microphone_unavailable";
        throw error;
      }
      try {
        const current = liveMicrophoneStream();
        if (current) return current;
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        emit("microphoneReady", {});
        return microphoneStream;
      } catch (error) {
        if (error && !error.code) error.code = "microphone_denied";
        emit("microphoneFailed", {error});
        throw error;
      }
    },

    // Подключение к SIP-серверу по данным аккаунта из /api/installer/sip.
    connect(acc) {
      if (!softphone.available()) return Promise.reject(new Error("Библиотека софтфона не загрузилась"));
      if (!acc || !acc.ws_url || !acc.sip_uri) return Promise.reject(new Error("no_ws"));
      if (ua && account && account.id === acc.id && registered) return Promise.resolve();
      if (connecting && connectingAccountId === String(acc.id || "")) return connecting;
      // Пользователь уже разрешил микрофон жестом на кнопке «Позвонить».
      // При переподключении SIP сохраняем этот поток: повторный запрос после
      // асинхронной регистрации часто блокируется мобильными браузерами.
      softphone.disconnect({preserveMicrophone: true});
      account = acc;
      connectingAccountId = String(acc.id || "");
      const pending = new Promise((resolve, reject) => {
        let settled = false;
        let registrationTimer = null;
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(registrationTimer);
          callback(value);
        };
        try {
          const socket = new window.JsSIP.WebSocketInterface(acc.ws_url);
          const configuration = {
            sockets: [socket],
            uri: acc.sip_uri,
            authorization_user: acc.auth_id || acc.extension,
            password: acc.password || "",
            display_name: acc.display_name || acc.extension,
            register: true,
            register_expires: Number(acc.register_expires || acc.expire_time || 300),
            session_timers: false,
            user_agent: "U-POS Integrator / JsSIP",
          };
          if (acc.realm) configuration.realm = String(acc.realm).trim();
          if (acc.registrar_server) configuration.registrar_server = registrarUri(acc.registrar_server);
          ua = new window.JsSIP.UA(configuration);
          ua.on("registered", () => {
            registered = true;
            emit("registered", {account: acc});
            settle(resolve);
          });
          ua.on("registrationFailed", (e) => {
            registered = false;
            const response = e && e.response;
            const detail = {
              cause: (e && e.cause) || "registration_failed",
              statusCode: (response && response.status_code) || 0,
              reasonPhrase: (response && response.reason_phrase) || "",
            };
            emit("registrationFailed", detail);
            const error = new Error(detail.cause);
            error.statusCode = detail.statusCode;
            error.reasonPhrase = detail.reasonPhrase;
            settle(reject, error);
          });
          ua.on("disconnected", () => {
            registered = false;
            emit("disconnected", {});
            settle(reject, new Error("disconnected"));
          });
          ua.on("newRTCSession", (data) => {
            if (data.originator === "remote") {
              wireSession(data.session, "incoming");
              emit("incoming", {
                from: data.request && data.request.from && data.request.from.uri && data.request.from.uri.user,
                name: data.request && data.request.from && data.request.from.display_name,
              });
            }
          });
          ua.start();
          registrationTimer = window.setTimeout(() => {
            settle(reject, new Error("registration_timeout"));
          }, 15000);
        } catch (error) {
          settle(reject, error);
        }
      });
      connecting = pending;
      pending.then(
        () => {
          if (connecting === pending) connecting = null;
        },
        () => {
          if (connecting === pending) connecting = null;
        },
      );
      return pending;
    },

    call(number) {
      if (!ua || !registered) return false;
      const target = `sip:${String(number).replace(/[^\d+*#]/g, "")}@${account.host}`;
      const options = {
        mediaConstraints: {audio: true, video: false},
        mediaStream: liveMicrophoneStream() || undefined,
        // Совпадает с рабочим WebRTC-клиентом MySputnik: ICE определяет АТС.
        pcConfig: {},
      };
      const newSession = ua.call(target, options);
      wireSession(newSession, "outgoing");
      attachRemoteAudio();
      return true;
    },

    async answer() {
      if (!session) return false;
      const stream = await softphone.prepareAudio();
      session.answer({
        mediaConstraints: {audio: true, video: false},
        mediaStream: stream,
        pcConfig: {},
      });
      return true;
    },

    reject() {
      if (!session) return false;
      try { session.terminate({status_code: 486, reason_phrase: "Busy Here"}); } catch (_e) { session = null; }
      return true;
    },

    hangup() {
      if (session) { try { session.terminate(); } catch (_e) { /* уже завершён */ } session = null; }
    },

    setMuted(muted) {
      if (!session) return;
      if (muted) session.mute({audio: true});
      else session.unmute({audio: true});
    },

    setSpeaker(enabled) {
      speakerEnabled = Boolean(enabled);
      const el = audio();
      if (el) el.muted = !speakerEnabled;
      emit("speakerChanged", {enabled: speakerEnabled});
      if (speakerEnabled) playRemoteAudio();
      return speakerEnabled;
    },

    resumeRemoteAudio() {
      speakerEnabled = true;
      return playRemoteAudio();
    },

    sendDtmf(tone) {
      if (session) { try { session.sendDTMF(tone); } catch (_e) { /* нет активной сессии */ } }
    },

    disconnect(options) {
      const preserveMicrophone = Boolean(options && options.preserveMicrophone);
      softphone.hangup();
      if (ua) { try { ua.stop(); } catch (_e) { /* уже остановлен */ } }
      ua = null;
      registered = false;
      connecting = null;
      connectingAccountId = "";
      clearRemoteAudio();
      if (!preserveMicrophone) releaseMicrophone();
    },
  };

  // Историческое имя оставляем: на нём завязано приложение установщика.
  window.InstallerSoftphone = softphone;
  window.UposSoftphone = softphone;
})();
