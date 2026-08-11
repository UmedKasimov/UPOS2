/* Плавающий телефон: звонок прямо из браузера.
 *
 * Раньше виджет только отдавал номер десктопному мосту UposSip на
 * 127.0.0.1:5058. На телефоне и в обычном браузере такого моста нет, и вызов
 * навсегда оставался в статусе «Отправляю вызов в SIP…». Теперь звоним через
 * WebRTC (JsSIP по SIP-over-WSS) тем же модулем, что и приложение
 * установщика, а мост и набор через SIM остаются запасными путями.
 *
 * Для приёма входящих JsSIP регистрируется автоматически после загрузки страницы.
 */
(() => {
  "use strict";

  const root = document.querySelector("[data-floating-phone]");
  if (!root) return;

  const toggle = root.querySelector("[data-floating-phone-toggle]");
  const panel = root.querySelector("[data-floating-phone-panel]");
  const close = root.querySelector("[data-floating-phone-close]");
  const head = root.querySelector(".upos-floating-phone-head");
  const form = root.querySelector("[data-floating-phone-form]");
  const input = root.querySelector("[data-floating-phone-input]");
  const providerSelect = root.querySelector("[data-floating-phone-provider]");
  const status = root.querySelector("[data-floating-phone-status]");
  const submitButton = form?.querySelector('button[type="submit"]');
  const hangupButton = root.querySelector("[data-floating-phone-hangup]");
  const incomingPanel = root.querySelector("[data-floating-phone-incoming]");
  const incomingCaller = root.querySelector("[data-floating-phone-caller]");
  const answerButton = root.querySelector("[data-floating-phone-answer]");
  const rejectButton = root.querySelector("[data-floating-phone-reject]");
  const bridgeUrl = root.dataset.floatingPhoneBridge || "http://127.0.0.1:5058/call";

  /* ── Положение и раскрытие панели (поведение прежнее) ───────────────── */

  const storageKey = "upos:floating-phone-position";
  const providerStorageKey = "upos:floating-phone-provider";
  const edgeGap = 8;
  const dragGap = 4;
  let dragState = null;
  let ignoreNextToggleClick = false;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  const alignPanel = () => {
    if (!panel || panel.hidden) return;
    panel.style.left = "0";
    panel.style.right = "auto";
    panel.style.top = "auto";
    panel.style.bottom = "70px";
    const phoneRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (phoneRect.left + panelRect.width > window.innerWidth - edgeGap) {
      panel.style.left = "auto";
      panel.style.right = "0";
    }
    if (phoneRect.top - panelRect.height < edgeGap) {
      panel.style.top = "70px";
      panel.style.bottom = "auto";
    }
  };

  const applyPosition = (position, save = false) => {
    const rect = root.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - edgeGap;
    const maxY = window.innerHeight - rect.height - edgeGap;
    const x = clamp(position.x, edgeGap, maxX);
    const y = clamp(position.y, edgeGap, maxY);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.classList.add("is-positioned");
    alignPanel();
    if (save) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ x, y }));
      } catch (error) {
        // В некоторых режимах браузера localStorage отключён.
      }
    }
  };

  const restorePosition = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) applyPosition(saved);
    } catch (error) {
      window.localStorage.removeItem(storageKey);
    }
  };

  const openPanel = () => {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(() => {
      alignPanel();
      input?.focus();
    });
    ensureSoftphone();
  };

  const closePanel = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  const startDrag = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-floating-phone-close], input, a, select, button[type=submit]")) return;
    const rect = root.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < dragGap) return;
    dragState.moved = true;
    root.classList.add("is-dragging");
    event.preventDefault();
    applyPosition({ x: dragState.originX + dx, y: dragState.originY + dy });
  };

  const endDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const wasMoved = dragState.moved;
    dragState = null;
    root.classList.remove("is-dragging");
    if (wasMoved) {
      const rect = root.getBoundingClientRect();
      applyPosition({ x: rect.left, y: rect.top }, true);
      ignoreNextToggleClick = true;
      window.setTimeout(() => {
        ignoreNextToggleClick = false;
      }, 0);
    }
  };

  restorePosition();
  toggle?.addEventListener("pointerdown", startDrag);
  head?.addEventListener("pointerdown", startDrag);
  document.addEventListener("pointermove", moveDrag);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", () => {
    if (!root.classList.contains("is-positioned")) return;
    const rect = root.getBoundingClientRect();
    applyPosition({ x: rect.left, y: rect.top }, true);
  });
  toggle?.addEventListener("click", (event) => {
    if (ignoreNextToggleClick) {
      event.preventDefault();
      event.stopPropagation();
      ignoreNextToggleClick = false;
      return;
    }
    panel.hidden ? openPanel() : closePanel();
  });
  close?.addEventListener("click", closePanel);
  document.addEventListener("click", (event) => {
    // Во время разговора панель не прячем: из неё кладут трубку.
    if (!panel.hidden && !root.contains(event.target) && !inCall) closePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !inCall) closePanel();
  });

  const setStatus = (message, tone = "ready") => {
    if (!status) return;
    status.dataset.state = tone;
    const dot = status.querySelector("span");
    status.textContent = "";
    if (dot) status.append(dot);
    status.append(document.createTextNode(message));
  };

  /* ── Софтфон ───────────────────────────────────────────────────────── */

  let softphoneReady = null;
  let accounts = [];
  let inCall = false;
  let ringTimer = null;
  let ringContext = null;

  function ringOnce() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      ringContext = ringContext || new AudioContext();
      ringContext.resume().catch(() => {});
      const oscillator = ringContext.createOscillator();
      const gain = ringContext.createGain();
      oscillator.frequency.value = 440;
      gain.gain.setValueAtTime(0.0001, ringContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ringContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ringContext.currentTime + 0.38);
      oscillator.connect(gain);
      gain.connect(ringContext.destination);
      oscillator.start();
      oscillator.stop(ringContext.currentTime + 0.4);
    } catch (_error) {
      // Some browsers block sound until the first user interaction; visual ringing remains active.
    }
  }

  function startRinging() {
    stopRinging();
    root.classList.add("is-ringing");
    navigator.vibrate?.([250, 120, 250]);
    ringOnce();
    ringTimer = window.setInterval(ringOnce, 1800);
  }

  function stopRinging() {
    root.classList.remove("is-ringing");
    navigator.vibrate?.(0);
    window.clearInterval(ringTimer);
    ringTimer = null;
  }

  function setIncomingUi(event = null) {
    const active = Boolean(event);
    if (incomingPanel) incomingPanel.hidden = !active;
    if (incomingCaller && active) incomingCaller.textContent = event.name || event.from || "Неизвестный номер";
    if (submitButton) submitButton.disabled = active || inCall;
    if (!active) stopRinging();
  }

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-phone-src="${src}"]`)) return resolve();
      const node = document.createElement("script");
      node.src = src;
      node.dataset.phoneSrc = src;
      node.onload = () => resolve();
      node.onerror = () => reject(new Error(`Не загрузился ${src}`));
      document.head.appendChild(node);
    });

  function accountById(id) {
    return accounts.find((item) => String(item.id) === String(id)) || null;
  }

  // Типовая ошибка настройки: в адресе АТС указан IP. Сертификат выписывают на
  // домен, поэтому браузер рвёт WSS ещё до SIP — и причина никак не видна.
  function looksLikeIpHost(wsUrl) {
    try {
      const host = new URL(String(wsUrl)).hostname;
      return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
    } catch (error) {
      return false;
    }
  }

  function selectedAccount() {
    const value = providerSelect?.value || "";
    if (!value) return accounts[0] || null;
    return accountById(value);
  }

  function fillProviders() {
    if (!providerSelect || !accounts.length) return;
    // Список провайдеров в шаблоне приходит не на каждой странице, поэтому
    // заполняем его из API — иначе в выборе оставалось одно «Авто».
    const previous = providerSelect.value;
    let savedProvider = "";
    try {
      savedProvider = window.localStorage.getItem(providerStorageKey) || "";
    } catch (error) {
      savedProvider = "";
    }
    providerSelect.textContent = "";
    accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = String(account.id);
      option.textContent = account.label || account.extension || "SIP";
      option.dataset.login = account.extension || "";
      option.dataset.providerName = account.label || account.extension || "SIP";
      providerSelect.append(option);
    });
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Авто (SIP приложение)";
    auto.dataset.providerName = "Авто";
    providerSelect.append(auto);
    const preferredAccount =
      accountById(savedProvider) ||
      accountById(previous) ||
      accounts.find((account) => /^\d+$/.test(String(account.extension || "").trim())) ||
      accounts[0];
    if (preferredAccount) providerSelect.value = String(preferredAccount.id);
  }

  function connectErrorText(account, error) {
    if (account && looksLikeIpHost(account.ws_url)) {
      return "АТС указана по IP — для WSS нужен домен из сертификата. Проверьте адрес в настройках телефонии";
    }
    const cause = String(error?.message || "");
    const statusCode = Number(error?.statusCode || 0);
    const reasonPhrase = String(error?.reasonPhrase || "").trim();
    const responseDetails = statusCode ? ` (${statusCode}${reasonPhrase ? ` ${reasonPhrase}` : ""})` : "";
    // Rejected — связь с АТС есть, но регистрацию не приняли: дело в
    // SIP-аккаунте (WebRTC не включён или пароль не тот), а не в сети.
    if (/rejected|forbidden|authentication/i.test(cause)) {
      return `АТС отклонила регистрацию${responseDetails} — проверьте SIP-аккаунт и WebRTC. Пока звоним через телефон`;
    }
    return `АТС недоступна (${cause || "ошибка"}) — звоним через телефон`;
  }

  function bindSoftphoneEvents(sip) {
    if (sip.__floatingPhoneBound) return;
    sip.__floatingPhoneBound = true;
    sip.on("registered", () => {
      if (!inCall) setStatus("SIP на связи — можно звонить", "ok");
    });
    sip.on("registrationFailed", (event) => {
      const statusCode = Number(event?.statusCode || 0);
      const reasonPhrase = String(event?.reasonPhrase || "").trim();
      const details = statusCode ? `${statusCode}${reasonPhrase ? ` ${reasonPhrase}` : ""}` : event?.cause || "ошибка";
      setStatus(`АТС отклонила регистрацию (${details}) — звоним через телефон`, "error");
    });
    sip.on("progress", () => setStatus("Идёт вызов…", "pending"));
    sip.on("accepted", () => {
      inCall = true;
      setIncomingUi(null);
      setStatus("Разговор идёт", "ok");
      setCallUi(true);
    });
    sip.on("incoming", (event) => {
      inCall = true;
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      setIncomingUi(event || {});
      startRinging();
      window.requestAnimationFrame(alignPanel);
      setStatus(`Входящий: ${event?.name || event?.from || "неизвестный"}`, "pending");
    });
    sip.on("ended", () => {
      inCall = false;
      setIncomingUi(null);
      setStatus("Звонок завершён", "ready");
      setCallUi(false);
    });
    sip.on("failed", (event) => {
      inCall = false;
      setIncomingUi(null);
      setStatus(`Звонок не состоялся: ${event?.cause || "ошибка"}`, "error");
      setCallUi(false);
    });
  }

  function setCallUi(active) {
    if (hangupButton) hangupButton.hidden = !active;
    if (submitButton) submitButton.disabled = active || (incomingPanel && !incomingPanel.hidden);
  }

  function ensureSoftphone() {
    if (softphoneReady) return softphoneReady;
    softphoneReady = (async () => {
      const response = await fetch("/api/telephony/sip", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      accounts = Array.isArray(payload.accounts)
        ? payload.accounts.filter((item) => item && item.ws_url && item.sip_uri)
        : [];
      if (!accounts.length) {
        setStatus("SIP-аккаунт не настроен — вызов уйдёт в приложение", "ready");
        return null;
      }
      fillProviders();
      await loadScript("/static/jssip.min.js?v=1");
      await loadScript("/static/installer-softphone.js?v=4");
      const sip = window.UposSoftphone;
      if (!sip || !sip.available()) {
        setStatus("Софтфон не загрузился — вызов уйдёт в приложение", "error");
        return null;
      }
      sip.configure({ audioId: "upos-floating-phone-audio" });
      bindSoftphoneEvents(sip);
      const account = selectedAccount();
      if (!account) return sip;
      setStatus("Подключаюсь к АТС…", "pending");
      try {
        await sip.connect(account);
      } catch (error) {
        // Регистрация не удалась — остаются мост и набор через SIM.
        setStatus(connectErrorText(account, error), "error");
      }
      return sip;
    })().catch((error) => {
      setStatus(`Телефон недоступен: ${error?.message || "ошибка"}`, "error");
      return null;
    });
    return softphoneReady;
  }

  providerSelect?.addEventListener("change", async () => {
    try {
      window.localStorage.setItem(providerStorageKey, providerSelect.value || "");
    } catch (error) {
      // В некоторых режимах браузера localStorage отключён.
    }
    const sip = await ensureSoftphone();
    const account = selectedAccount();
    if (!sip || !account) return;
    setStatus("Подключаюсь к АТС…", "pending");
    try {
      await sip.connect(account);
    } catch (error) {
      setStatus(connectErrorText(account, error), "error");
    }
  });

  hangupButton?.addEventListener("click", () => {
    window.UposSoftphone?.hangup();
    inCall = false;
    setIncomingUi(null);
    setCallUi(false);
    setStatus("Звонок завершён", "ready");
  });

  answerButton?.addEventListener("click", () => {
    if (!window.UposSoftphone?.answer()) return;
    setIncomingUi(null);
    setCallUi(true);
    setStatus("Соединяю разговор…", "pending");
  });

  rejectButton?.addEventListener("click", () => {
    if (typeof window.UposSoftphone?.reject === "function") window.UposSoftphone.reject();
    else window.UposSoftphone?.hangup();
    inCall = false;
    setIncomingUi(null);
    setCallUi(false);
    setStatus("Входящий звонок отклонён", "ready");
  });

  /* ── Набор номера ──────────────────────────────────────────────────── */

  async function callViaBridge(phone) {
    const selected = providerSelect?.selectedOptions?.[0] || null;
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        provider_id: providerSelect?.value || "",
        provider: selected?.dataset.providerName || "",
        provider_login: selected?.dataset.login || "",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "SIP-приложение не приняло вызов");
    }
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = (input?.value || "").trim();
    if (!phone) {
      input?.focus();
      return;
    }
    submitButton?.setAttribute("disabled", "disabled");
    try {
      const sip = await ensureSoftphone();
      // Первый путь — звонок прямо из браузера.
      if (sip && sip.isRegistered() && sip.call(phone)) {
        inCall = true;
        setCallUi(true);
        setStatus("Набираю…", "pending");
        return;
      }
      // Второй — десктопное SIP-приложение на этом же компьютере.
      setStatus("Отправляю вызов в SIP…", "pending");
      try {
        await callViaBridge(phone);
        setStatus("Вызов отправлен в SIP", "ok");
        return;
      } catch (bridgeError) {
        // Третий — набор средствами самого телефона.
        const clean = phone.replace(/[^\d+*#]/g, "");
        if (clean && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          setStatus("Открываю набор телефона", "ready");
          window.location.href = `tel:${clean}`;
          return;
        }
        setStatus(`Запустите SIP-приложение: ${bridgeError.message || "нет связи"}`, "error");
      }
    } finally {
      if (!inCall) submitButton?.removeAttribute("disabled");
    }
  });

  // A receiver must be registered before the first call arrives, not after the panel is opened.
  window.setTimeout(() => {
    ensureSoftphone();
  }, 300);
})();
