(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const phaseLabels = {offline: "Отключён", connecting: "Подключение", ready: "На линии",
    dialing: "Набор", incoming: "Входящий", active: "Разговор", error: "Ошибка"};
  let busy = false;

  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({target: "background", type, ...extra});
    if (!response?.ok) throw new Error(response?.error || "Действие не выполнено");
    return response;
  }

  function showError(error) { $("message").textContent = error?.message || "Ошибка связи"; }

  async function refresh() {
    try {
      const result = await request("getState");
      const state = result.state || {};
      const phase = state.phase || "offline";
      $("phase").className = "phase " + phase;
      $("phase").textContent = phaseLabels[phase] || phase;
      $("login-form").hidden = result.connected;
      $("phone").hidden = !result.connected;
      $("line-label").textContent = result.label || "";
      $("message").textContent = state.message || (result.connected ? "Линия подключена" : "Подключите SIP-линию для работы без вкладки U-POS.");
      $("incoming").hidden = phase !== "incoming";
      $("call-actions").hidden = !["dialing", "active"].includes(phase);
      $("redirect-form").hidden = phase !== "incoming";
      $("dial").disabled = busy || phase !== "ready";
      if (state.phone && ["incoming", "dialing", "active"].includes(phase)) $("number").value = state.phone;
    } catch (error) { showError(error); }
  }

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = $("login-form").querySelector("button");
    button.disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      stream.getTracks().forEach((track) => track.stop());
      const existing = await chrome.storage.local.get("deviceId");
      const deviceId = existing.deviceId || crypto.randomUUID();
      if (!existing.deviceId) await chrome.storage.local.set({deviceId});
      await request("login", {accountId: $("account-id").value, login: $("sip-login").value,
        password: $("sip-password").value, deviceId});
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
  void refresh();
  setInterval(() => { if (!busy) void refresh(); }, 1000);
})();
