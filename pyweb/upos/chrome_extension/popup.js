(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const phaseLabels = {offline: "Отключён", connecting: "Подключение", ready: "На линии",
    dialing: "Набор", incoming: "Входящий", active: "Разговор", error: "Ошибка"};
  let busy = false;
  let manualOpen = false;
  let errorText = "";
  let errorUntil = 0;

  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({target: "background", type, ...extra});
    if (!response?.ok) throw new Error(response?.error || "Действие не выполнено");
    return response;
  }

  function showError(error) {
    errorText = error?.message || "Ошибка связи";
    errorUntil = Date.now() + 10000;
    $("message").textContent = errorText;
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
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    stream.getTracks().forEach((track) => track.stop());
  }

  $("show-manual").addEventListener("click", () => {
    manualOpen = !manualOpen;
    $("login-form").hidden = !manualOpen;
    $("show-manual").textContent = manualOpen ? "Скрыть ручной ввод" : "Ввести SIP-данные вручную";
  });

  $("pair-site").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    $("pair-site").disabled = true;
    try {
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
  void refresh();
  setInterval(() => { if (!busy) void refresh(); }, 1000);
})();
