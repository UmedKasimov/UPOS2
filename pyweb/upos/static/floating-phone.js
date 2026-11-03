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
  const tabs = Array.from(root.querySelectorAll("[data-floating-phone-tab]"));
  const views = Array.from(root.querySelectorAll("[data-floating-phone-view]"));
  const keypad = root.querySelector("[data-floating-phone-keypad]") || root.querySelector(".upos-floating-phone-keypad");
  const dtmfHint = root.querySelector("[data-floating-phone-dtmf-hint]");
  const historyList = root.querySelector("[data-floating-phone-history-list]");
  const historyFilters = Array.from(root.querySelectorAll("[data-floating-phone-history-filter]"));
  const historyRefresh = root.querySelector("[data-floating-phone-history-refresh]");
  const saveContactButton = root.querySelector("[data-floating-phone-save-contact]");
  const contactEditor = root.querySelector("[data-floating-phone-contact-editor]");
  const contactCancel = root.querySelector("[data-floating-phone-contact-cancel]");
  const contactMessage = root.querySelector("[data-floating-phone-contact-message]");
  const status = root.querySelector("[data-floating-phone-status]");
  const submitButton = form?.querySelector('button[type="submit"]');
  const hangupButton = root.querySelector("[data-floating-phone-hangup]");
  const callActions = root.querySelector("[data-floating-phone-call-actions]");
  const muteButton = root.querySelector("[data-floating-phone-mute]");
  const incomingPanel = root.querySelector("[data-floating-phone-incoming]");
  const incomingCaller = root.querySelector("[data-floating-phone-caller]");
  const incomingOverlay = document.querySelector("[data-floating-phone-incoming-overlay]");
  const overlayCaller = incomingOverlay?.querySelector("[data-floating-phone-overlay-caller]");
  const overlayMessage = incomingOverlay?.querySelector("[data-floating-phone-overlay-message]");
  const overlayAnswer = incomingOverlay?.querySelector("[data-floating-phone-overlay-answer]");
  const overlayReject = incomingOverlay?.querySelector("[data-floating-phone-overlay-reject]");
  const enableRingButton = incomingOverlay?.querySelector("[data-floating-phone-enable-ring]");
  const clientLink = root.querySelector("[data-floating-phone-client-link]");
  const answerButton = root.querySelector("[data-floating-phone-answer]");
  const rejectButton = root.querySelector("[data-floating-phone-reject]");
  const redirectToggle = root.querySelector("[data-floating-phone-redirect-toggle]");
  const redirectForm = root.querySelector("[data-floating-phone-redirect-form]");
  const redirectInput = redirectForm?.querySelector("input");
  const redirectCancel = root.querySelector("[data-floating-phone-redirect-cancel]");
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
    const phoneRect = root.getBoundingClientRect();
    const spaceAbove = phoneRect.top - edgeGap - 70;
    const spaceBelow = window.innerHeight - phoneRect.bottom - edgeGap - 70;
    const placeAbove = spaceAbove >= 320 || spaceAbove >= spaceBelow;
    panel.style.maxHeight = `${Math.max(180, Math.min(680, placeAbove ? spaceAbove : spaceBelow))}px`;
    panel.style.top = placeAbove ? "auto" : "70px";
    panel.style.bottom = placeAbove ? "70px" : "auto";
    const panelRect = panel.getBoundingClientRect();
    if (phoneRect.left + panelRect.width > window.innerWidth - edgeGap) {
      panel.style.left = "auto";
      panel.style.right = "0";
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
    if (activeView === "history") void loadHistory();
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

  let statusHideTimer = null;
  const hideStatus = () => {
    window.clearTimeout(statusHideTimer);
    statusHideTimer = null;
    if (status) status.hidden = true;
    window.requestAnimationFrame(alignPanel);
  };
  const setStatus = (message, tone = "ready", options = {}) => {
    if (!status) return;
    window.clearTimeout(statusHideTimer);
    statusHideTimer = null;
    status.hidden = false;
    status.dataset.state = tone;
    status.dataset.kind = options.kind || "";
    const dot = status.querySelector("span");
    status.textContent = "";
    if (dot) status.append(dot);
    status.append(document.createTextNode(message));
    if (options.autoHideMs) {
      statusHideTimer = window.setTimeout(hideStatus, options.autoHideMs);
    }
    window.requestAnimationFrame(alignPanel);
  };

  const notifiedConnections = new Set();
  function showConnectedNotice(account) {
    if (inCall) return;
    const accountKey = String(account?.id || account?.extension || "default");
    const storageKey = `upos:floating-phone-connected:${accountKey}`;
    let alreadyShown = notifiedConnections.has(storageKey);
    try { alreadyShown ||= window.sessionStorage.getItem(storageKey) === "1"; } catch (_error) { /* storage may be blocked */ }
    if (alreadyShown) {
      if (status?.dataset.kind === "connection-pending") hideStatus();
      if (status?.dataset.kind === "registration-lost") {
        setStatus("SIP снова на связи — входящие готовы", "ok", {kind: "connection-ready", autoHideMs: 4000});
      }
      return;
    }
    notifiedConnections.add(storageKey);
    try { window.sessionStorage.setItem(storageKey, "1"); } catch (_error) { /* storage may be blocked */ }
    setStatus("SIP на связи — можно звонить", "ok", {kind: "connection-ready", autoHideMs: 4000});
  }

  let activeView = "dial";
  let historyDirection = "all";
  let historyCalls = [];
  let historyLoading = false;

  function switchView(view) {
    activeView = view === "history" ? "history" : "dial";
    tabs.forEach((tab) => {
      const selected = tab.dataset.floatingPhoneTab === activeView;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", selected ? "true" : "false");
    });
    views.forEach((node) => { node.hidden = node.dataset.floatingPhoneView !== activeView; });
    if (activeView === "history") void loadHistory();
    else input?.focus();
    window.requestAnimationFrame(alignPanel);
  }

  function phoneDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function validContactPhone(value) {
    const digits = phoneDigits(value);
    return digits.length >= 7 && digits.length <= 15;
  }

  function openContactEditor(phone, name = "") {
    if (!contactEditor) return;
    const contactPhone = String(phone || "").trim();
    if (!validContactPhone(contactPhone)) {
      setStatus("Введите номер клиента для сохранения", "error");
      switchView("dial");
      input?.focus();
      return;
    }
    const phoneField = contactEditor.elements.namedItem("phone");
    const nameField = contactEditor.elements.namedItem("name");
    phoneField.value = contactPhone;
    nameField.value = /^Контакт \+?\d+$/i.test(String(name || "")) ? "" : String(name || "");
    contactMessage.hidden = true;
    contactMessage.textContent = "";
    contactEditor.hidden = false;
    nameField.focus();
    window.requestAnimationFrame(alignPanel);
  }

  function formatCallTime(value) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(date);
  }

  function renderHistory() {
    if (!historyList) return;
    const counts = {
      all: historyCalls.length,
      incoming: historyCalls.filter((call) => call.direction === "incoming").length,
      outgoing: historyCalls.filter((call) => call.direction === "outgoing").length,
    };
    root.querySelectorAll("[data-floating-phone-count]").forEach((node) => {
      node.textContent = String(counts[node.dataset.floatingPhoneCount] || 0);
    });
    historyFilters.forEach((button) => {
      const selected = button.dataset.floatingPhoneHistoryFilter === historyDirection;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    const shown = historyCalls.filter((call) => historyDirection === "all" || call.direction === historyDirection);
    historyList.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "upos-floating-phone-history-empty";
      empty.textContent = historyCalls.length ? "Для этого направления звонков пока нет." : "Звонков пока нет.";
      historyList.append(empty);
      return;
    }
    shown.forEach((call) => {
      const row = document.createElement("div");
      row.className = "upos-floating-phone-history-item";
      const knownClient = call.client?.href?.startsWith("/clients?") ? call.client : null;
      if (knownClient) row.classList.add("is-known-client");
      const dial = document.createElement(knownClient ? "a" : "button");
      if (knownClient) dial.href = knownClient.href;
      else dial.type = "button";
      dial.className = "upos-floating-phone-history-dial";
      dial.title = knownClient ? "Открыть карточку клиента" : "Подставить номер для звонка";
      const icon = document.createElement("span");
      icon.className = `upos-floating-phone-history-direction is-${call.direction}`;
      icon.textContent = call.direction === "incoming" ? "↙" : "↗";
      const details = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = knownClient?.name || (call.name && !/^Контакт \+?\d+$/i.test(call.name) ? call.name : call.phone);
      const meta = document.createElement("small");
      const statusLabel = {answered: "Отвечен", missed: "Пропущен", planned: "Запланирован", forwarded: "Переадресован"}[call.status] || "Звонок";
      meta.textContent = `${call.phone} · ${formatCallTime(call.started_at)} · ${statusLabel}`;
      details.append(name, meta);
      dial.append(icon, details);
      if (!knownClient) dial.addEventListener("click", () => {
        switchView("dial");
        input.value = call.phone;
        input.focus();
      });
      row.append(dial);
      if (!knownClient && validContactPhone(call.phone)) {
        const save = document.createElement("button");
        save.type = "button";
        save.className = "upos-floating-phone-history-save";
        save.textContent = "+";
        save.title = "Сохранить контакт";
        save.setAttribute("aria-label", `Сохранить контакт ${call.phone}`);
        save.addEventListener("click", () => openContactEditor(call.phone, call.name));
        row.append(save);
      }
      historyList.append(row);
    });
  }

  async function loadHistory() {
    if (!historyList || historyLoading) return;
    historyLoading = true;
    if (!historyCalls.length) historyList.textContent = "Загружаю звонки…";
    try {
      const response = await fetch("/api/telephony/quick-panel", {credentials: "same-origin", cache: "no-store"});
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Не удалось загрузить звонки");
      historyCalls = Array.isArray(payload.calls) ? payload.calls : [];
      renderHistory();
    } catch (_error) {
      historyList.textContent = "История недоступна. Попробуйте обновить.";
    } finally {
      historyLoading = false;
    }
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.floatingPhoneTab)));
  historyFilters.forEach((button) => button.addEventListener("click", () => {
    historyDirection = button.dataset.floatingPhoneHistoryFilter || "all";
    renderHistory();
  }));
  historyRefresh?.addEventListener("click", () => { void loadHistory(); });
  saveContactButton?.addEventListener("click", () => openContactEditor(input?.value));
  contactCancel?.addEventListener("click", () => { contactEditor.hidden = true; window.requestAnimationFrame(alignPanel); });
  function sendTone(tone) {
    if (!inCall || !/^[0-9*#]$/.test(tone)) return;
    if (window.UposSoftphone?.sendDtmf?.(tone)) {
      setStatus("Разговор идёт · сигнал отправлен", "ok");
    } else {
      setStatus("Дождитесь ответа, чтобы нажимать цифры", "pending");
    }
  }
  keypad?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-floating-phone-key]");
    if (!button || !input) return;
    const key = button.dataset.floatingPhoneKey;
    if (inCall) {
      sendTone(key);
      return;
    }
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (key === "backspace") {
      const from = start === end ? Math.max(0, start - 1) : start;
      input.setRangeText("", from, end, "end");
    } else {
      input.setRangeText(key, start, end, "end");
    }
    input.focus();
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  root.addEventListener("keydown", (event) => {
    if (!inCall || panel.hidden || activeView !== "dial" || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!/^[0-9*#]$/.test(event.key) || contactEditor?.contains(event.target)) return;
    event.preventDefault();
    sendTone(event.key);
  });
  contactEditor?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(contactEditor.elements.namedItem("name").value || "").trim();
    const phone = String(contactEditor.elements.namedItem("phone").value || "").trim();
    if (!name || !validContactPhone(phone)) {
      contactMessage.textContent = "Укажите имя и корректный номер.";
      contactMessage.hidden = false;
      return;
    }
    const save = contactEditor.querySelector('button[type="submit"]');
    save.disabled = true;
    try {
      const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
      const response = await fetch("/api/telephony/quick-contact", {
        method: "POST", credentials: "same-origin",
        headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
        body: JSON.stringify({name, phone}),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Не удалось сохранить контакт");
      const savedDigits = phoneDigits(phone);
      const phoneKey = (value) => {
        const digits = phoneDigits(value);
        return digits.length >= 9 ? digits.slice(-9) : digits;
      };
      historyCalls.forEach((call) => {
        if (phoneKey(call.phone) === phoneKey(savedDigits)) {
          call.name = name;
          call.client = payload.contact;
        }
      });
      renderHistory();
      contactMessage.replaceChildren(document.createTextNode("Контакт сохранён · "));
      const link = document.createElement("a");
      link.href = payload.contact.href;
      link.textContent = "Открыть карточку";
      contactMessage.append(link);
      contactMessage.hidden = false;
    } catch (error) {
      contactMessage.textContent = error.message || "Не удалось сохранить контакт";
      contactMessage.hidden = false;
    } finally {
      save.disabled = false;
      window.requestAnimationFrame(alignPanel);
    }
  });
  window.setInterval(() => {
    if (!panel.hidden && activeView === "history" && !document.hidden) void loadHistory();
  }, 20000);

  /* ── Софтфон ───────────────────────────────────────────────────────── */

  let softphoneReady = null;
  let registrationRecovery = null;
  let accounts = [];
  let inCall = false;
  let extensionOwnsLine = document.documentElement?.dataset.uposExtensionPhone === "active";
  let activeCall = null;
  let callSync = Promise.resolve();
  let browserRecording = null;
  let ringTimer = null;
  let ringContext = null;
  let ringOscillators = [];
  let incomingLookupId = 0;
  let redirecting = false;
  let rejecting = false;
  let browserStatusQueue = Promise.resolve();
  let browserTabId = "";
  try {
    browserTabId = window.sessionStorage.getItem("upos:sip-tab-id") || window.crypto.randomUUID();
    window.sessionStorage.setItem("upos:sip-tab-id", browserTabId);
  } catch (_error) { browserTabId = window.crypto?.randomUUID?.() || ""; }

  function reportBrowserStatus(event, details = {}, providerId = "") {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
    const selectedProviderId = String(providerId || selectedAccount()?.id || "");
    if (!csrf || !browserTabId || !selectedProviderId) return;
    browserStatusQueue = browserStatusQueue.catch(() => {}).then(() => fetch("/api/telephony/browser-status", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
      body: JSON.stringify({tab_id: browserTabId, provider_id: selectedProviderId, event,
        status_code: Number(details.statusCode || 0), cause: String(details.cause || details.reason || "").slice(0, 100)}),
    })).catch(() => {});
  }

  function recordBrowserCall(status, call) {
    if (!call) return;
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
    if (!csrf) return;
    const duration = call.answeredAt ? Math.max(0, Math.floor((Date.now() - call.answeredAt) / 1000)) : 0;
    callSync = callSync.catch(() => {}).then(() => fetch("/api/telephony/browser-call", {
      method: "POST",
      credentials: "same-origin",
      keepalive: status !== "planned",
      headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
      body: JSON.stringify({...call, duration, status}),
    })).then(() => {
      if (status !== "planned" && !panel.hidden && activeView === "history") void loadHistory();
    }).catch(() => {});
  }

  function beginBrowserCall(direction, phone) {
    if (!/^\+?\d{2,15}$/.test(String(phone || "").replace(/[\s().-]/g, ""))) {
      activeCall = null;
      return;
    }
    activeCall = {
      call_id: window.crypto?.randomUUID?.() || "",
      provider_id: String(selectedAccount()?.id || ""),
      direction,
      phone: String(phone),
      started_at: new Date().toISOString(),
      answeredAt: 0,
    };
    recordBrowserCall("planned", activeCall);
  }

  function finishBrowserCall(status = "") {
    if (!activeCall) return;
    recordBrowserCall(status || (activeCall.answeredAt ? "answered" : "missed"), activeCall);
    activeCall = null;
  }

  async function uploadBrowserRecording(call, blob, extension) {
    await callSync.catch(() => {});
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
    if (!csrf || !blob.size || blob.size > 50 * 1024 * 1024) {
      setStatus("Запись звонка не сохранена: файл слишком большой или нет доступа", "error");
      return;
    }
    const body = new FormData();
    body.set("call_id", call.call_id);
    body.set("provider_id", call.provider_id);
    body.set("file", blob, `call.${extension}`);
    try {
      const response = await fetch("/api/telephony/browser-recording", {
        method: "POST", credentials: "same-origin", headers: {"X-CSRF-Token": csrf}, body,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!panel.hidden && activeView === "history") void loadHistory();
    } catch (_error) {
      setStatus("Не удалось сохранить запись звонка — проверьте соединение", "error");
    }
  }

  function startBrowserRecording() {
    if (browserRecording || !activeCall?.answeredAt || !window.MediaRecorder) return;
    const tracks = window.UposSoftphone?.recordingTracks?.();
    if (!tracks?.local?.length || !tracks?.remote?.length) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const format = [
      ["audio/webm;codecs=opus", "webm"], ["audio/webm", "webm"], ["audio/mp4", "m4a"],
    ].find(([mime]) => window.MediaRecorder.isTypeSupported?.(mime));
    if (!format) return;
    let context = null;
    try {
      context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const sources = [tracks.local[0], tracks.remote[0]].map((track) => {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        source.connect(destination);
        return source;
      });
      const recorder = new window.MediaRecorder(destination.stream, {mimeType: format[0]});
      const call = {...activeCall};
      const chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        sources.forEach((source) => source.disconnect());
        destination.stream.getTracks().forEach((track) => track.stop());
        void context.close();
        const blob = new Blob(chunks, {type: format[0]});
        if (blob.size) void uploadBrowserRecording(call, blob, format[1]);
      }, {once: true});
      recorder.start(1000);
      void context.resume().catch(() => {});
      browserRecording = recorder;
    } catch (_error) {
      if (context) void context.close();
      setStatus("Браузер не смог начать запись звонка", "error");
    }
  }

  function stopBrowserRecording() {
    const recorder = browserRecording;
    browserRecording = null;
    if (recorder?.state === "recording") recorder.stop();
  }

  function unlockRingtone() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      ringContext = ringContext || new AudioContext();
      if (ringContext.state !== "running") {
        ringContext.resume().then(updateRingSoundButton).catch(() => {});
      }
    } catch (_error) { /* Browser audio may require a later gesture. */ }
  }

  document.addEventListener("pointerdown", unlockRingtone);
  document.addEventListener("keydown", unlockRingtone);

  function updateRingSoundButton() {
    if (enableRingButton && incomingOverlay && !incomingOverlay.hidden) {
      enableRingButton.hidden = Boolean(ringContext && ringContext.state === "running");
    }
  }

  function ringOnce() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      ringContext = ringContext || new AudioContext();
      if (ringContext.state !== "running") ringContext.resume().then(updateRingSoundButton).catch(() => {});
      updateRingSoundButton();
      [0, 0.55].forEach((delay) => {
        const gain = ringContext.createGain();
        let remaining = 2;
        const start = ringContext.currentTime + delay;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.07, start + 0.025);
        gain.gain.setValueAtTime(0.07, start + 0.32);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
        gain.connect(ringContext.destination);
        [440, 480].forEach((frequency) => {
          const oscillator = ringContext.createOscillator();
          oscillator.frequency.value = frequency;
          oscillator.connect(gain);
          oscillator.onended = () => {
            ringOscillators = ringOscillators.filter((item) => item !== oscillator);
            oscillator.disconnect();
            if (--remaining === 0) gain.disconnect();
          };
          ringOscillators.push(oscillator);
          oscillator.start(start);
          oscillator.stop(start + 0.4);
        });
      });
      navigator.vibrate?.([150, 100, 150]);
    } catch (_error) {
      // Some browsers block sound until the first user interaction; visual ringing remains active.
    }
  }

  function startRinging() {
    stopRinging();
    root.classList.add("is-ringing");
    ringOnce();
    ringTimer = window.setInterval(ringOnce, 3000);
  }

  function stopRinging() {
    root.classList.remove("is-ringing");
    navigator.vibrate?.(0);
    window.clearInterval(ringTimer);
    ringTimer = null;
    ringOscillators.forEach((oscillator) => {
      try { oscillator.stop(); } catch (_error) { /* Already stopped. */ }
    });
    ringOscillators = [];
  }

  function setIncomingUi(event = null) {
    const active = Boolean(event);
    if (incomingPanel) incomingPanel.hidden = !active;
    if (incomingOverlay) incomingOverlay.hidden = !active;
    if (active) {
      const caller = event.name || event.from || "Неизвестный номер";
      if (incomingCaller) incomingCaller.textContent = caller;
      if (overlayCaller) overlayCaller.textContent = caller;
      if (overlayMessage) overlayMessage.textContent = "Вызов на SIP-линию U-POS";
      updateRingSoundButton();
      overlayAnswer?.focus();
    } else if (enableRingButton) {
      enableRingButton.hidden = true;
    }
    if (!active && redirectForm) redirectForm.hidden = true;
    if (!active && redirectInput) redirectInput.value = "";
    if (clientLink && (active || !inCall)) clientLink.hidden = true;
    if (submitButton) submitButton.disabled = active || inCall;
    if (!active) {
      if (!inCall) incomingLookupId += 1;
      stopRinging();
    }
  }

  async function lookupIncomingClient(event) {
    const phone = String(event?.from || "").trim();
    if (!/^\+?\d{7,15}$/.test(phone)) return;
    const lookupId = ++incomingLookupId;
    try {
      const response = await fetch(`/api/telephony/lookup?phone=${encodeURIComponent(phone)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok || lookupId !== incomingLookupId || (!inCall && incomingPanel?.hidden) || !result?.client) return;
      if (incomingCaller) incomingCaller.textContent = `${result.client.name} · ${phone}`;
      if (overlayCaller) overlayCaller.textContent = `${result.client.name} · ${phone}`;
      if (clientLink) {
        clientLink.href = result.client.href;
        clientLink.hidden = false;
      }
    } catch (_error) {
      // Caller ID remains visible even if CRM is unavailable.
    }
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
    sip.on("registered", (event) => {
      if (extensionOwnsLine && !inCall) {
        sip.disconnect();
        return;
      }
      showConnectedNotice(event?.account || selectedAccount());
      reportBrowserStatus("registered", {}, event?.account?.id);
    });
    sip.on("registrationFailed", (event) => {
      reportBrowserStatus("registration_failed", event);
      if (extensionOwnsLine) return;
      const statusCode = Number(event?.statusCode || 0);
      const reasonPhrase = String(event?.reasonPhrase || "").trim();
      const details = statusCode ? `${statusCode}${reasonPhrase ? ` ${reasonPhrase}` : ""}` : event?.cause || "ошибка";
      setStatus(`АТС отклонила регистрацию (${details}) — входящие недоступны`, "error", {kind: "registration-lost"});
    });
    sip.on("unregistered", () => {
      reportBrowserStatus("unregistered");
      if (extensionOwnsLine) return;
      if (!inCall) setStatus("SIP-регистрация потеряна — переподключаюсь", "error", {kind: "registration-lost"});
    });
    sip.on("disconnected", () => {
      reportBrowserStatus("disconnected");
      if (extensionOwnsLine) return;
      if (!inCall) setStatus("Связь с АТС потеряна — переподключаюсь", "error", {kind: "registration-lost"});
    });
    sip.on("progress", () => setStatus("Идёт вызов…", "pending"));
    sip.on("accepted", () => {
      inCall = true;
      if (activeCall && !activeCall.answeredAt) {
        activeCall.answeredAt = Date.now();
        recordBrowserCall("answered", activeCall);
      }
      setIncomingUi(null);
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      setStatus("Разговор идёт", "ok");
      setCallUi(true);
      window.requestAnimationFrame(alignPanel);
      hangupButton?.focus();
      startBrowserRecording();
    });
    sip.on("remoteTrack", startBrowserRecording);
    sip.on("incoming", (event) => {
      reportBrowserStatus("incoming");
      inCall = true;
      redirecting = false;
      rejecting = false;
      beginBrowserCall("incoming", event?.from);
      if (input && event?.from) input.value = String(event.from);
      switchView("dial");
      setIncomingUi(event || {});
      void lookupIncomingClient(event);
      startRinging();
      setStatus(`Входящий: ${event?.name || event?.from || "неизвестный"}`, "pending");
    });
    sip.on("ended", () => {
      stopBrowserRecording();
      finishBrowserCall(redirecting ? "forwarded" : "");
      inCall = false;
      setIncomingUi(null);
      setStatus(rejecting ? "Входящий звонок отклонён" : redirecting ? "Запрос переадресации отправлен" : "Звонок завершён", "ready");
      redirecting = false;
      rejecting = false;
      setCallUi(false);
      if (extensionOwnsLine) sip.disconnect();
    });
    sip.on("failed", (event) => {
      stopBrowserRecording();
      finishBrowserCall(redirecting ? "forwarded" : "");
      inCall = false;
      setIncomingUi(null);
      if (rejecting) setStatus("Входящий звонок отклонён", "ready");
      else if (redirecting) setStatus("Запрос переадресации отправлен", "ready");
      else setStatus(`Звонок не состоялся: ${event?.cause || "ошибка"}`, "error");
      redirecting = false;
      rejecting = false;
      setCallUi(false);
      if (extensionOwnsLine) sip.disconnect();
    });
  }

  function setCallUi(active) {
    if (callActions) callActions.hidden = !active;
    if (dtmfHint) dtmfHint.hidden = !active;
    if (input) input.readOnly = active;
    keypad?.querySelectorAll('[data-floating-phone-key="+"], [data-floating-phone-key="backspace"]').forEach((button) => {
      button.disabled = active;
    });
    if (!active && muteButton) {
      muteButton.setAttribute("aria-pressed", "false");
      muteButton.textContent = "Выключить микрофон";
    }
    if (submitButton) submitButton.disabled = active || (incomingPanel && !incomingPanel.hidden);
  }

  function recoverRegistration(sip) {
    if (extensionOwnsLine) return Promise.resolve(null);
    if (!sip || sip.isRegistered() || inCall) return Promise.resolve(sip);
    if (registrationRecovery) return registrationRecovery;
    const account = selectedAccount();
    if (!account) return Promise.resolve(sip);
    setStatus("Подключаюсь к АТС…", "pending", {kind: "registration-lost"});
    reportBrowserStatus("connecting", {}, account.id);
    registrationRecovery = sip.connect(account).then(() => {
      showConnectedNotice(account);
      return sip;
    }, (error) => {
      reportBrowserStatus("registration_failed", {cause: error?.message, statusCode: error?.statusCode}, account.id);
      setStatus(connectErrorText(account, error), "error", {kind: "registration-lost"});
      return sip;
    }).finally(() => { registrationRecovery = null; });
    return registrationRecovery;
  }

  function ensureSoftphone() {
    if (extensionOwnsLine) return Promise.resolve(null);
    if (softphoneReady) return softphoneReady.then(recoverRegistration);
    softphoneReady = (async () => {
      const response = await fetch("/api/telephony/sip", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(response.status === 403 ? "Нет доступа к телефонии" : "Не удалось загрузить SIP-линию", "error");
        return null;
      }
      accounts = Array.isArray(payload.accounts)
        ? payload.accounts.filter((item) => item && item.ws_url && item.sip_uri)
        : [];
      if (!accounts.length) {
        setStatus("SIP-линия не назначена. Администратор может назначить её в Телефонии", "ready");
        return null;
      }
      fillProviders();
      await loadScript("/static/jssip.min.js?v=1");
      await loadScript("/static/installer-softphone.js?v=17");
      const sip = window.UposSoftphone;
      if (!sip || !sip.available()) {
        setStatus("Софтфон не загрузился — вызов уйдёт в приложение", "error");
        return null;
      }
      sip.configure({ audioId: "upos-floating-phone-audio" });
      bindSoftphoneEvents(sip);
      const account = selectedAccount();
      if (!account) return sip;
      if (extensionOwnsLine) return sip;
      setStatus("Подключаюсь к АТС…", "pending", {kind: "connection-pending"});
      reportBrowserStatus("connecting", {}, account.id);
      try {
        await sip.connect(account);
        if (extensionOwnsLine && !inCall) sip.disconnect();
        else showConnectedNotice(account);
      } catch (error) {
        reportBrowserStatus("registration_failed", {cause: error?.message, statusCode: error?.statusCode}, account.id);
        // Регистрация не удалась — остаются мост и набор через SIM.
        setStatus(connectErrorText(account, error), "error", {kind: "registration-lost"});
      }
      return sip;
    })().catch((error) => {
      setStatus(`Телефон недоступен: ${error?.message || "ошибка"}`, "error");
      return null;
    });
    const pending = softphoneReady;
    pending.then((sip) => {
      if (!sip && softphoneReady === pending) softphoneReady = null;
    });
    return pending;
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
    setStatus("Подключаюсь к АТС…", "pending", {kind: "connection-pending"});
    reportBrowserStatus("connecting", {}, account.id);
    try {
      await sip.connect(account);
      showConnectedNotice(account);
    } catch (error) {
      reportBrowserStatus("registration_failed", {cause: error?.message, statusCode: error?.statusCode}, account.id);
      setStatus(connectErrorText(account, error), "error");
    }
  });

  hangupButton?.addEventListener("click", () => {
    stopBrowserRecording();
    window.UposSoftphone?.hangup();
    finishBrowserCall();
    inCall = false;
    setIncomingUi(null);
    setCallUi(false);
    setStatus("Звонок завершён", "ready");
  });

  muteButton?.addEventListener("click", () => {
    if (!inCall || typeof window.UposSoftphone?.setMuted !== "function") return;
    const muted = muteButton.getAttribute("aria-pressed") !== "true";
    window.UposSoftphone.setMuted(muted);
    muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
    muteButton.textContent = muted ? "Включить микрофон" : "Выключить микрофон";
  });

  async function answerIncoming() {
    if (answerButton) answerButton.disabled = true;
    if (overlayAnswer) overlayAnswer.disabled = true;
    try {
      if (!await window.UposSoftphone?.answer()) throw new Error("Нет активного входящего звонка");
      setIncomingUi(null);
      setCallUi(true);
      setStatus(activeCall?.answeredAt ? "Разговор идёт" : "Соединяю разговор…", activeCall?.answeredAt ? "ok" : "pending");
    } catch (_error) {
      setStatus("Не удалось принять звонок — проверьте доступ к микрофону", "error");
      if (overlayMessage) overlayMessage.textContent = "Не удалось принять — проверьте доступ к микрофону";
    } finally {
      if (answerButton) answerButton.disabled = false;
      if (overlayAnswer) overlayAnswer.disabled = false;
    }
  }
  answerButton?.addEventListener("click", answerIncoming);
  overlayAnswer?.addEventListener("click", answerIncoming);

  function rejectIncoming() {
    rejecting = true;
    if (typeof window.UposSoftphone?.reject === "function") window.UposSoftphone.reject();
    else window.UposSoftphone?.hangup();
    finishBrowserCall();
    inCall = false;
    setIncomingUi(null);
    setCallUi(false);
    setStatus("Входящий звонок отклонён", "ready");
  }
  rejectButton?.addEventListener("click", rejectIncoming);
  overlayReject?.addEventListener("click", rejectIncoming);
  enableRingButton?.addEventListener("click", () => {
    unlockRingtone();
    ringOnce();
  });

  redirectToggle?.addEventListener("click", () => {
    if (!redirectForm || !inCall) return;
    redirectForm.hidden = false;
    redirectInput?.focus();
    window.requestAnimationFrame(alignPanel);
  });
  redirectCancel?.addEventListener("click", () => {
    redirectForm.hidden = true;
    window.requestAnimationFrame(alignPanel);
  });
  redirectForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const destination = String(redirectInput?.value || "").trim();
    const normalized = destination.replace(/[\s().-]/g, "");
    if (!/^\+?\d{2,15}$/.test(normalized)) {
      setStatus("Введите внутренний или телефонный номер", "error");
      redirectInput?.focus();
      return;
    }
    redirecting = true;
    if (activeCall) activeCall.forwarded_to = normalized;
    if (!window.UposSoftphone?.redirectIncoming?.(normalized)) {
      redirecting = false;
      if (activeCall) delete activeCall.forwarded_to;
      setStatus("Не удалось переадресовать звонок — проверьте SIP-линию", "error");
      return;
    }
    finishBrowserCall("forwarded");
    inCall = false;
    setIncomingUi(null);
    setCallUi(false);
    setStatus("Запрос переадресации отправлен", "ready");
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

  function callViaExtension(rawPhone) {
    const phone = String(rawPhone || "").replace(/[^\d+]/g, "");
    if (!/^\+?\d{2,15}$/.test(phone)) return Promise.reject(new Error("Проверьте номер"));
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        window.removeEventListener("message", onResult);
        reject(new Error("Расширение не ответило"));
      }, 10000);
      function onResult(event) {
        const data = event.data;
        if (event.source !== window || event.origin !== location.origin ||
          data?.source !== "upos-extension" || data?.type !== "extension-dial-result" ||
          data.requestId !== requestId) return;
        window.clearTimeout(timer);
        window.removeEventListener("message", onResult);
        if (data.ok) resolve();
        else reject(new Error(data.error || "Не удалось набрать номер"));
      }
      window.addEventListener("message", onResult);
      window.postMessage({source: "upos-site", type: "extension-dial", requestId, phone}, location.origin);
    });
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
      if (extensionOwnsLine) {
        setStatus("Набираю через расширение…", "pending");
        try {
          await callViaExtension(phone);
          setStatus("Вызов открыт в расширении Chrome", "ok");
        } catch (error) {
          setStatus(`Расширение: ${error.message || "ошибка"}`, "error");
        }
        return;
      }
      const sip = await ensureSoftphone();
      // Первый путь — звонок прямо из браузера.
      if (sip && sip.isRegistered() && sip.call(phone)) {
        inCall = true;
        beginBrowserCall("outgoing", phone);
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

  // Chrome extension and links from CRM can prepare a number without starting
  // a call. The operator confirms the call in the widget.
  function prepareDial(rawPhone) {
    const phone = String(rawPhone || "").trim();
    if (!/^\+?[\d\s().-]{2,30}$/.test(phone) || !input) return false;
    openPanel();
    switchView("dial");
    input.value = phone;
    input.focus();
    return true;
  }

  window.addEventListener("upos:phone:dial", (event) => {
    prepareDial(event.detail?.phone);
  });
  window.addEventListener("upos:extension-phone-status", () => {
    const active = document.documentElement?.dataset.uposExtensionPhone === "active";
    if (extensionOwnsLine === active) return;
    extensionOwnsLine = active;
    if (active) {
      setStatus("Линия работает в расширении Chrome", "ok");
      if (!inCall) window.UposSoftphone?.disconnect?.();
      void softphoneReady?.then((sip) => {
        if (extensionOwnsLine && !inCall) sip?.disconnect();
      });
    } else if (!inCall) {
      void ensureSoftphone();
    }
  });
  const dialUrl = new URL(window.location.href);
  if (dialUrl.searchParams.has("dial") && prepareDial(dialUrl.searchParams.get("dial"))) {
    dialUrl.searchParams.delete("dial");
    window.history.replaceState(window.history.state, "", dialUrl.pathname + dialUrl.search + dialUrl.hash);
  }

  // A receiver must be registered before the first call arrives, not after the panel is opened.
  window.setTimeout(() => {
    void ensureSoftphone();
  }, 300);
  // JsSIP reconnects its socket; also recover if initial loading or SIP registration failed.
  window.setInterval(() => {
    void ensureSoftphone();
  }, 30000);
  window.setInterval(() => {
    if (window.UposSoftphone?.isRegistered?.()) reportBrowserStatus("heartbeat");
  }, 60000);
  window.addEventListener("online", () => { void ensureSoftphone(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void ensureSoftphone();
  });
})();
