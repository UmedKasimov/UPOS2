/* Софтфон установщика: SIP-звонки из браузера через WebSocket (JsSIP).
 *
 * Браузер не умеет обычный SIP по UDP/TCP, поэтому голос идёт по SIP-over-WSS.
 * Если у аккаунта нет ws_url или сервер недоступен — телефония работает в
 * режиме набора через SIM (это делает installer.js), а этот модуль просто
 * сообщает, что регистрация не удалась.
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
  // Модуль общий для установщика и плавающего телефона в вебе: элемент для
  // входящего звука у них разный, поэтому он настраивается.
  let audioElementId = "installer-call-audio";

  const audio = () => document.getElementById(audioElementId);

  function attachRemoteAudio() {
    if (!session || !session.connection) return;
    const stream = new MediaStream();
    session.connection.getReceivers().forEach((receiver) => {
      if (receiver.track) stream.addTrack(receiver.track);
    });
    const el = audio();
    if (el) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }

  function wireSession(newSession, direction) {
    session = newSession;
    session.on("progress", () => emit("progress", {direction}));
    session.on("accepted", () => { attachRemoteAudio(); emit("accepted", {direction}); });
    session.on("confirmed", () => { attachRemoteAudio(); emit("accepted", {direction}); });
    session.on("ended", (e) => { emit("ended", {cause: e && e.cause}); session = null; });
    session.on("failed", (e) => { emit("failed", {cause: e && e.cause}); session = null; });
    session.on("peerconnection", (e) => {
      const pc = e && e.peerconnection;
      if (pc) pc.addEventListener("track", attachRemoteAudio);
    });
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

    // Подключение к SIP-серверу по данным аккаунта из /api/installer/sip.
    connect(acc) {
      if (!softphone.available()) return Promise.reject(new Error("Библиотека софтфона не загрузилась"));
      if (!acc || !acc.ws_url || !acc.sip_uri) return Promise.reject(new Error("no_ws"));
      if (ua && account && account.id === acc.id && registered) return Promise.resolve();
      softphone.disconnect();
      account = acc;
      return new Promise((resolve, reject) => {
        let settled = false;
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
          };
          if (acc.realm) configuration.realm = String(acc.realm).trim();
          if (acc.registrar_server) configuration.registrar_server = registrarUri(acc.registrar_server);
          ua = new window.JsSIP.UA(configuration);
          ua.on("registered", () => {
            registered = true;
            emit("registered", {account: acc});
            if (!settled) { settled = true; resolve(); }
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
            if (!settled) {
              settled = true;
              const error = new Error(detail.cause);
              error.statusCode = detail.statusCode;
              error.reasonPhrase = detail.reasonPhrase;
              reject(error);
            }
          });
          ua.on("disconnected", () => {
            registered = false;
            emit("disconnected", {});
            if (!settled) { settled = true; reject(new Error("disconnected")); }
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
        } catch (error) {
          if (!settled) { settled = true; reject(error); }
        }
      });
    },

    call(number) {
      if (!ua || !registered) return false;
      const target = `sip:${String(number).replace(/[^\d+*#]/g, "")}@${account.host}`;
      const options = {
        mediaConstraints: {audio: true, video: false},
        pcConfig: {rtcpMuxPolicy: "require", iceServers: []},
      };
      const newSession = ua.call(target, options);
      wireSession(newSession, "outgoing");
      return true;
    },

    answer() {
      if (!session) return false;
      session.answer({mediaConstraints: {audio: true, video: false}});
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

    sendDtmf(tone) {
      if (session) { try { session.sendDTMF(tone); } catch (_e) { /* нет активной сессии */ } }
    },

    disconnect() {
      softphone.hangup();
      if (ua) { try { ua.stop(); } catch (_e) { /* уже остановлен */ } }
      ua = null;
      registered = false;
    },
  };

  // Историческое имя оставляем: на нём завязано приложение установщика.
  window.InstallerSoftphone = softphone;
  window.UposSoftphone = softphone;
})();
