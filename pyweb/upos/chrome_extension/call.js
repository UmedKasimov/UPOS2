(() => {
  "use strict";
  const APP_URL = "https://app.u-pos.uz";
  const $ = (id) => document.getElementById(id);
  const card = document.querySelector(".card");
  let state = {};
  let callerPhone = "";
  let client = null;
  let lookupPhone = "";
  let busy = false;
  let lastCall = null;
  let errorUntil = 0;

  async function request(type, extra = {}) {
    const result = await chrome.runtime.sendMessage({target: "background", type, ...extra});
    if (!result?.ok) throw new Error(result?.error || "Действие не выполнено");
    return result;
  }

  function showError(error) {
    $("error").textContent = error?.message || "Ошибка связи";
    $("error").hidden = false;
    errorUntil = Date.now() + 10000;
  }

  function validPhone(value) {
    return /^\d{7,15}$/.test(String(value || "").replace(/\D/g, ""));
  }

  function render() {
    const phase = state.phase || "offline";
    const live = ["incoming", "active"].includes(phase);
    const visualPhase = live ? phase : "ended";
    const phone = live ? state.phone : lastCall?.phone || callerPhone;
    if (phone) callerPhone = phone;
    card.dataset.phase = visualPhase;
    $("line").textContent = phase === "offline" ? "Линия отключена" : "SIP-линия U-POS";
    $("eyebrow").textContent = phase === "incoming" ? "Входящий звонок" :
      phase === "active" ? "Идёт разговор" : lastCall?.status === "missed" ? "Пропущенный звонок" : "Вызов завершён";
    $("caller").textContent = client?.name || phone || "Неизвестный номер";
    $("phone").textContent = client?.name && phone ? phone : "";
    $("description").textContent = phase === "incoming" ? "Вызов на SIP-линию U-POS" :
      phase === "active" ? "Звонок подключён" : (state.message || "Вызов завершён");
    $("incoming-actions").hidden = phase !== "incoming";
    $("active-actions").hidden = phase !== "active";
    $("ended-actions").hidden = live;
    $("redial").disabled = phase !== "ready" || !validPhone(phone);
    $("incoming-transfer").hidden = phase !== "incoming";
    $("timer").hidden = phase !== "active";
    if (phase === "active") {
      const seconds = Number(state.answeredAt) > 0 ?
        Math.max(0, Math.floor((Date.now() - state.answeredAt) / 1000)) : 0;
      $("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }
    $("mute").textContent = state.muted ? "Включить микрофон" : "Микрофон выкл.";
    $("mute").setAttribute("aria-pressed", String(Boolean(state.muted)));
    $("hold").textContent = state.held ? "Вернуть клиента" : "Удержать";
    $("hold").setAttribute("aria-pressed", String(Boolean(state.held)));
    $("contact-actions").hidden = !validPhone(phone);
    $("open-client").hidden = !client;
    $("show-contact").hidden = Boolean(client) || !validPhone(phone);
    if (!live) { $("transfer-form").hidden = true; $("keypad").hidden = true; }
    if (errorUntil <= Date.now()) $("error").hidden = true;
  }

  async function siteJson(path, options = {}) {
    const response = await fetch(`${APP_URL}${path}`, {credentials: "include", cache: "no-store", ...options});
    if (response.status === 401 || (response.redirected && new URL(response.url).pathname === "/auth")) {
      throw new Error("Войдите в U-POS для работы с контактами");
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

  async function lookup(phone) {
    try {
      const data = await siteJson(`/api/telephony/lookup?phone=${encodeURIComponent(phone)}`);
      if (lookupPhone !== phone) return;
      client = data.client?.href?.startsWith("/clients?") ? data.client : null;
      render();
    } catch (_) { /* The call still works without CRM access. */ }
  }

  async function refresh() {
    try {
      const result = await request("getState");
      state = result.state || {};
      if (state.lastCall) lastCall = state.lastCall;
      const phone = ["incoming", "active"].includes(state.phase) ? state.phone : lastCall?.phone;
      if (phone && phone !== lookupPhone) {
        lookupPhone = phone;
        client = null;
        void lookup(phone);
      }
      render();
    } catch (error) { showError(error); }
  }

  async function act(type, extra = {}) {
    if (busy) return;
    busy = true;
    try { await request(type, extra); await refresh(); }
    catch (error) { showError(error); }
    finally { busy = false; }
  }

  function toggle(id) { $(id).hidden = !$(id).hidden; }
  function openClient() {
    if (client?.href?.startsWith("/clients?")) void chrome.tabs.create({url: `${APP_URL}${client.href}`});
  }
  function closeWindow() { window.close(); }

  $("answer").addEventListener("click", () => void act("answer"));
  $("reject").addEventListener("click", () => void act("reject"));
  $("hangup").addEventListener("click", () => void act("hangup"));
  $("mute").addEventListener("click", () => void act("mute", {muted: !state.muted}));
  $("hold").addEventListener("click", () => void act("hold", {held: !state.held}));
  $("show-keypad").addEventListener("click", () => toggle("keypad"));
  $("show-transfer").addEventListener("click", () => toggle("transfer-form"));
  $("incoming-transfer").addEventListener("click", () => toggle("transfer-form"));
  $("cancel-transfer").addEventListener("click", () => { $("transfer-form").hidden = true; });
  $("keypad").addEventListener("click", (event) => {
    const digit = event.target.closest("[data-key]")?.dataset.key;
    if (digit && state.phase === "active") void act("dtmf", {digit});
  });
  $("transfer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const phone = $("transfer-phone").value.trim();
    if (!/^\+?\d{2,15}$/.test(phone)) { showError(new Error("Введите корректный номер")); return; }
    if (state.phase === "incoming") void act("redirect", {phone});
    else if (state.phase === "active") void act("transfer", {phone});
  });
  $("redial").addEventListener("click", async () => {
    if (state.phase !== "ready" || !validPhone(callerPhone) || busy) return;
    busy = true;
    try { await request("dial", {phone: callerPhone}); closeWindow(); }
    catch (error) { showError(error); }
    finally { busy = false; }
  });
  $("close").addEventListener("click", closeWindow);
  $("open-phone").addEventListener("click", () => void act("openWindow"));
  $("open-client").addEventListener("click", openClient);
  $("show-contact").addEventListener("click", () => {
    $("contact-phone").value = callerPhone;
    $("contact-name").value = "";
    $("contact-form").hidden = false;
    $("contact-name").focus();
  });
  $("cancel-contact").addEventListener("click", () => { $("contact-form").hidden = true; });
  $("contact-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("contact-name").value.trim();
    const phone = $("contact-phone").value.trim();
    if (!name || !validPhone(phone)) { showError(new Error("Укажите имя и корректный номер")); return; }
    const button = $("contact-form").querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const csrf = await csrfToken();
      const data = await siteJson("/api/telephony/quick-contact", {
        method: "POST", headers: {"Content-Type": "application/json", "X-CSRF-Token": csrf},
        body: JSON.stringify({name, phone}),
      });
      client = data.contact?.href?.startsWith("/clients?") ? data.contact : null;
      $("contact-form").hidden = true;
      render();
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  });

  void chrome.storage.local.get("transferTargets").then((settings) => {
    const targets = Array.isArray(settings.transferTargets) ? settings.transferTargets : ["210", "220", "230"];
    for (const number of [...new Set(targets)].filter((value) => /^\+?\d{2,15}$/.test(value)).slice(0, 10)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = number;
      button.addEventListener("click", () => { $("transfer-phone").value = number; });
      $("transfer-presets").append(button);
    }
  });
  void refresh();
  setInterval(() => { void refresh(); }, 1000);
})();
