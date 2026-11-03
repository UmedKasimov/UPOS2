(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const phaseLabels = {offline: "Отключён", connecting: "Подключение", ready: "На линии",
    dialing: "Набор", incoming: "Входящий", active: "Разговор", error: "Ошибка"};
  const params = new URLSearchParams(location.search);
  const setupWindow = params.has("setup");
  const embedded = params.has("embed");
  const fullUi = setupWindow || embedded;
  document.body.dataset.setup = setupWindow ? "true" : "false";
  document.body.dataset.embed = embedded ? "true" : "false";
  let busy = false;
  let manualOpen = params.has("manual");
  let errorText = "";
  let errorUntil = 0;
  let activeView = "dial";
  let historyDirection = "all";
  let historyCalls = [];
  let historyLoading = false;
  let muted = false;
  let incomingClient = null;
  let lookupPhone = "";
  let currentPhase = "offline";
  const APP_URL = "https://app.u-pos.uz";

  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({target: "background", type, ...extra});
    if (!response?.ok) throw new Error(response?.error || "Действие не выполнено");
    return response;
  }

  function showError(error) {
    errorText = error?.message || "Ошибка связи";
    errorUntil = /микрофон|доступ/i.test(errorText) ? Infinity : Date.now() + 10000;
    $("message").textContent = errorText;
  }

  async function openSetupWindow(manual = false) {
    const base = chrome.runtime.getURL("popup.html");
    const windows = await chrome.windows.getAll({populate: true});
    const existing = windows.find((item) => item.type === "popup" &&
      item.tabs?.some((tab) => tab.url?.startsWith(`${base}?setup=1`)));
    if (existing) {
      await chrome.windows.update(existing.id, {focused: true});
      return;
    }
    await chrome.windows.create({url: `${base}?setup=1${manual ? "&manual=1" : ""}`,
      type: "popup", width: 390, height: 600});
  }

  async function refresh() {
    try {
      const result = await request("getState");
      const state = result.state || {};
      const phase = state.phase || "offline";
      currentPhase = phase;
      $("phase").className = "phase " + phase;
      $("phase").textContent = phaseLabels[phase] || phase;
      $("pair-panel").hidden = result.connected;
      $("login-form").hidden = result.connected || !manualOpen;
      $("open-window").hidden = !result.connected || fullUi;
      $("phone").hidden = !fullUi;
      $("retry").hidden = !result.connected || !["offline", "error"].includes(phase);
      $("phone").dataset.phase = phase;
      $("line-label").textContent = result.label || "Не подключена";
      $("message").textContent = errorUntil > Date.now() ? errorText :
        (state.message || (result.connected ? "Линия подключена" : "Подключите линию из U-POS."));
      $("incoming").hidden = phase !== "incoming";
      if (phase === "incoming" && state.phone && lookupPhone !== state.phone) {
        lookupPhone = state.phone;
        incomingClient = null;
        void lookupIncoming(state.phone);
      }
      if (phase !== "incoming") { lookupPhone = ""; incomingClient = null; }
      $("incoming-phone").textContent = incomingClient?.name || state.phone || "Неизвестный номер";
      $("incoming-client").hidden = !incomingClient;
      $("call-actions").hidden = !["dialing", "active"].includes(phase);
      $("redirect-form").hidden = phase !== "incoming";
      $("dial").disabled = busy || phase !== "ready";
      $("number").readOnly = ["incoming", "dialing", "active"].includes(phase);
      muted = phase === "active" && Boolean(state.muted);
      $("mute").setAttribute("aria-pressed", String(muted));
      $("mute").textContent = muted ? "Включить микрофон" : "Выключить микрофон";
      if (state.phone && ["incoming", "dialing", "active"].includes(phase)) $("number").value = state.phone;
    } catch (error) { showError(error); }
  }

  async function siteJson(path, options = {}) {
    const response = await fetch(`${APP_URL}${path}`, {
      credentials: "include", cache: "no-store", ...options,
    });
    if (response.status === 401 || (response.redirected && new URL(response.url).pathname === "/auth")) {
      throw new Error("Войдите в U-POS для истории и контактов");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "U-POS недоступна");
    return data;
  }

  async function csrfToken() {
    const response = await fetch(`${APP_URL}/telephony`, {credentials: "include", cache: "no-store"});
    if (!response.ok || (response.redirected && new URL(response.url).pathname === "/auth")) {
      throw new Error("Войдите в U-POS для сохранения контакта");
    }
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const token = doc.querySelector('meta[name="csrf-token"]')?.content;
    if (!token) throw new Error("Не удалось получить защитный код U-POS");
    return token;
  }

  function openClient(href) {
    if (typeof href !== "string" || !href.startsWith("/clients?")) return;
    void chrome.tabs.create({url: `${APP_URL}${href}`});
  }

  async function lookupIncoming(phone) {
    try {
      const data = await siteJson(`/api/telephony/lookup?phone=${encodeURIComponent(phone)}`);
      if (lookupPhone !== phone) return;
      incomingClient = data.client?.href?.startsWith("/clients?") ? data.client : null;
      $("incoming-phone").textContent = incomingClient?.name || phone;
      $("incoming-client").hidden = !incomingClient;
    } catch (_) { /* The call still works without CRM lookup. */ }
  }

  function switchView(view) {
    activeView = view === "history" ? "history" : "dial";
    $("dial-view").hidden = activeView !== "dial";
    $("history-view").hidden = activeView !== "history";
    for (const name of ["dial", "history"]) {
      $("tab-" + name).classList.toggle("selected", activeView === name);
      $("tab-" + name).setAttribute("aria-pressed", String(activeView === name));
    }
    if (activeView === "history") void loadHistory();
  }

  function phoneDigits(value) { return String(value || "").replace(/\D/g, ""); }
  function validContactPhone(value) { return /^\d{7,15}$/.test(phoneDigits(value)); }
  function formatCallTime(value) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(date);
  }

  function renderHistory() {
    $("count-all").textContent = String(historyCalls.length);
    for (const direction of ["incoming", "outgoing"]) {
      $("count-" + direction).textContent = String(historyCalls.filter((call) => call.direction === direction).length);
    }
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.filter === historyDirection);
    });
    const list = $("history-list");
    list.replaceChildren();
    const shown = historyCalls.filter((call) => historyDirection === "all" || call.direction === historyDirection);
    if (!shown.length) {
      list.textContent = historyCalls.length ? "Для этого направления звонков пока нет." : "Звонков пока нет.";
      return;
    }
    for (const call of shown) {
      const client = call.client?.href?.startsWith("/clients?") ? call.client : null;
      const row = document.createElement("div");
      row.className = `history-row${client ? " known" : ""}`;
      const main = document.createElement("button");
      main.type = "button";
      main.className = "history-main";
      main.title = client ? "Открыть карточку клиента" : "Подставить номер";
      const title = document.createElement("strong");
      title.textContent = `${call.direction === "incoming" ? "↙" : "↗"} ${client?.name ||
        (call.name && !/^Контакт \+?\d+$/i.test(call.name) ? call.name : call.phone)}`;
      const meta = document.createElement("small");
      const status = {answered: "Отвечен", missed: "Пропущен", planned: "Запланирован",
        forwarded: "Переадресован"}[call.status] || "Звонок";
      meta.textContent = `${call.phone} · ${formatCallTime(call.started_at)} · ${status}`;
      main.append(title, meta);
      main.addEventListener("click", () => {
        if (client) openClient(client.href);
        else { $("number").value = call.phone || ""; switchView("dial"); $("number").focus(); }
      });
      row.append(main);
      if (!client && validContactPhone(call.phone)) {
        const save = document.createElement("button");
        save.type = "button";
        save.className = "history-save";
        save.title = "Сохранить контакт";
        save.textContent = "+";
        save.addEventListener("click", () => openContactEditor(call.phone, call.name));
        row.append(save);
      }
      list.append(row);
    }
  }

  async function loadHistory() {
    if (historyLoading) return;
    historyLoading = true;
    if (!historyCalls.length) $("history-list").textContent = "Загружаю звонки…";
    try {
      const data = await siteJson("/api/telephony/quick-panel");
      historyCalls = Array.isArray(data.calls) ? data.calls : [];
      renderHistory();
    } catch (error) { $("history-list").textContent = error.message || "История недоступна"; }
    finally { historyLoading = false; }
  }

  function openContactEditor(phone, name = "") {
    if (!validContactPhone(phone)) { showError(new Error("Введите номер клиента")); return; }
    $("contact-phone").value = String(phone);
    $("contact-name").value = /^Контакт \+?\d+$/i.test(name || "") ? "" : String(name || "");
    $("contact-message").hidden = true;
    $("contact-message").textContent = "";
    $("contact-form").hidden = false;
    $("contact-name").focus();
  }

  async function allowMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Микрофон недоступен в Chrome. Проверьте разрешения браузера и Windows.");
    }
    try {
      const permission = navigator.permissions
        ? await navigator.permissions.query({name: "microphone"}).catch(() => null) : null;
      if (permission?.state === "denied") {
        throw new Error("Доступ к микрофону заблокирован. Откройте chrome://settings/content/microphone и разрешите микрофон для расширения.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      if (/Доступ к микрофону заблокирован/.test(error?.message || "")) throw error;
      if (error?.name === "NotAllowedError" || /permission dismissed/i.test(error?.message || "")) {
        throw new Error("Chrome не получил разрешение на микрофон. Проверьте chrome://settings/content/microphone и повторите подключение в этом окне.");
      }
      if (error?.name === "NotFoundError") throw new Error("Chrome не видит микрофон. Подключите его и повторите попытку.");
      throw error;
    }
  }

  $("show-manual").addEventListener("click", () => {
    if (!setupWindow) { void openSetupWindow(true).catch(showError); return; }
    manualOpen = !manualOpen;
    $("login-form").hidden = !manualOpen;
    $("show-manual").textContent = manualOpen ? "Скрыть ручной ввод" : "Ввести SIP-данные вручную";
  });

  $("pair-site").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    $("pair-site").disabled = true;
    try {
      if (!setupWindow) { await openSetupWindow(); return; }
      await allowMicrophone();
      await request("pairFromSite");
      errorUntil = 0;
      await refresh();
    } catch (error) { showError(error); }
    finally { busy = false; $("pair-site").disabled = false; }
  });

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = $("login-form").querySelector("button");
    button.disabled = true;
    try {
      if (!setupWindow) { await openSetupWindow(true); return; }
      await allowMicrophone();
      const existing = await chrome.storage.local.get("deviceId");
      const deviceId = existing.deviceId || crypto.randomUUID();
      if (!existing.deviceId) await chrome.storage.local.set({deviceId});
      await request("login", {accountId: $("account-id").value, login: $("sip-login").value,
        password: $("sip-password").value, deviceId});
      errorUntil = 0;
      $("sip-password").value = "";
      await refresh();
    } catch (error) { showError(error); }
    finally { busy = false; button.disabled = false; }
  });

  $("open-window").addEventListener("click", async () => {
    try { await request("openWindow"); } catch (error) { showError(error); }
  });
  $("tab-dial").addEventListener("click", () => switchView("dial"));
  $("tab-history").addEventListener("click", () => switchView("history"));
  $("refresh-history").addEventListener("click", () => { void loadHistory(); });
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    historyDirection = button.dataset.filter || "all";
    renderHistory();
  }));
  $("keypad").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-key]");
    if (!button) return;
    const key = button.dataset.key;
    if (currentPhase === "active") {
      if (/^[0-9*#]$/.test(key)) {
        try { await request("dtmf", {digit: key}); } catch (error) { showError(error); }
      }
      return;
    }
    const input = $("number");
    if (input.readOnly) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (key === "backspace") input.setRangeText("", start === end ? Math.max(0, start - 1) : start, end, "end");
    else input.setRangeText(key, start, end, "end");
    input.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (currentPhase !== "active" || event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
      !/^[0-9*#]$/.test(event.key) || !$("contact-form").hidden) return;
    event.preventDefault();
    void request("dtmf", {digit: event.key}).catch(showError);
  });
  $("save-number").addEventListener("click", () => openContactEditor($("number").value));
  $("cancel-contact").addEventListener("click", () => { $("contact-form").hidden = true; });
  $("contact-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("contact-name").value.trim();
    const phone = $("contact-phone").value.trim();
    if (!name || !validContactPhone(phone)) { showError(new Error("Укажите имя и корректный номер")); return; }
    const save = $("contact-form").querySelector('button[type="submit"]');
    save.disabled = true;
    try {
      const csrf = await csrfToken();
      const data = await siteJson("/api/telephony/quick-contact", {
        method: "POST", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
        body: JSON.stringify({name, phone}),
      });
      const key = phoneDigits(phone).slice(-9);
      historyCalls.forEach((call) => {
        if (phoneDigits(call.phone).slice(-9) === key) { call.name = name; call.client = data.contact; }
      });
      renderHistory();
      const message = $("contact-message");
      message.replaceChildren(document.createTextNode("Контакт сохранён · "));
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = "Открыть карточку клиента";
      link.addEventListener("click", (click) => { click.preventDefault(); openClient(data.contact?.href); });
      message.append(link);
      message.hidden = false;
    } catch (error) {
      $("contact-message").textContent = error.message || "Не удалось сохранить контакт";
      $("contact-message").hidden = false;
    } finally { save.disabled = false; }
  });
  $("incoming-client").addEventListener("click", (event) => {
    event.preventDefault();
    openClient(incomingClient?.href);
  });
  $("mute").addEventListener("click", async () => {
    try {
      const result = await request("mute", {muted: !muted});
      muted = result.muted;
      $("mute").setAttribute("aria-pressed", String(muted));
      $("mute").textContent = muted ? "Включить микрофон" : "Выключить микрофон";
    } catch (error) { showError(error); }
  });

  $("dial").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    $("dial").disabled = true;
    try { await request("dial", {phone: $("number").value}); await refresh(); }
    catch (error) { showError(error); }
    finally { busy = false; }
  });
  $("answer").addEventListener("click", async () => {
    try { await request("answer"); await refresh(); } catch (error) { showError(error); }
  });
  $("reject").addEventListener("click", async () => {
    try { await request("reject"); await refresh(); } catch (error) { showError(error); }
  });
  $("hangup").addEventListener("click", async () => {
    try { await request("hangup"); await refresh(); } catch (error) { showError(error); }
  });
  $("redirect-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await request("redirect", {phone: $("redirect-number").value}); await refresh(); }
    catch (error) { showError(error); }
  });
  $("logout").addEventListener("click", async () => {
    try { await request("logout"); await refresh(); } catch (error) { showError(error); }
  });
  $("retry").addEventListener("click", async () => {
    try { await request("retry"); await refresh(); } catch (error) { showError(error); }
  });
  if (!setupWindow) $("pair-site").textContent = "Открыть окно подключения";
  if (manualOpen) {
    $("login-form").hidden = false;
    $("show-manual").textContent = "Скрыть ручной ввод";
  }
  void refresh();
  setInterval(() => { if (!busy) void refresh(); }, 1000);
  setInterval(() => { if (activeView === "history" && fullUi && !$("phone").hidden) void loadHistory(); }, 20000);
})();
