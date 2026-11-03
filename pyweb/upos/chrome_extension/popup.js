(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const phaseLabels = {offline: "Отключён", connecting: "Подключение", ready: "На линии",
    dialing: "Набор", incoming: "Входящий", active: "Разговор", error: "Ошибка"};
  const params = new URLSearchParams(location.search);
  const setupWindow = params.has("setup");
  document.body.dataset.setup = setupWindow ? "true" : "false";
  let busy = false;
  let manualOpen = params.has("manual");
  let errorText = "";
  let errorUntil = 0;

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
      $("phase").className = "phase " + phase;
      $("phase").textContent = phaseLabels[phase] || phase;
      $("pair-panel").hidden = result.connected;
      $("login-form").hidden = result.connected || !manualOpen;
      $("phone").hidden = !result.connected;
      $("retry").hidden = !result.connected || !["offline", "error"].includes(phase);
      $("phone").dataset.phase = phase;
      $("line-label").textContent = result.label || "";
      $("message").textContent = errorUntil > Date.now() ? errorText :
        (state.message || (result.connected ? "Линия подключена" : "Подключите линию из U-POS."));
      $("incoming").hidden = phase !== "incoming";
      $("incoming-phone").textContent = state.phone || "Неизвестный номер";
      $("call-actions").hidden = !["dialing", "active"].includes(phase);
      $("redirect-form").hidden = phase !== "incoming";
      $("dial").disabled = busy || phase !== "ready";
      if (state.phone && ["incoming", "dialing", "active"].includes(phase)) $("number").value = state.phone;
    } catch (error) { showError(error); }
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
})();
