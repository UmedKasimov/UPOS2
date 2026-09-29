(function () {
  "use strict";

  var script = document.currentScript || document.querySelector('script[src*="site-chat-widget"]');
  var apiBase = (script && script.getAttribute("data-api-base")) || "";
  var proxyBase = (script && script.getAttribute("data-proxy")) || "";
  var workspace = (script && script.getAttribute("data-workspace")) || "u-pos.uz";
  var storageKey = "upos.siteChat." + workspace;
  var storageVersion = 3;
  var state = readState();
  if (state.storage_version !== storageVersion) {
    state = {
      storage_version: storageVersion,
      name: String(state.name || "").trim(),
      phone: String(state.phone || "").trim(),
      session_id: "",
      messages: [],
    };
    saveState();
  }
  if (!state.session_id) state.messages = [];
  if (!Array.isArray(state.messages)) state.messages = [];
  var pollTimer = null;
  var singletonKey = "__uposSiteChatWidget";
  if (window[singletonKey] && typeof window[singletonKey].destroy === "function") {
    window[singletonKey].destroy();
  }
  window[singletonKey] = {
    destroy: function () {
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      document.querySelectorAll(".upos-chat-panel,.upos-chat-button").forEach(function (node) {
        node.remove();
      });
      var style = document.getElementById("upos-site-chat-style");
      if (style) style.remove();
    },
  };

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
    } catch (err) {
      return {};
    }
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (err) {
      return false;
    }
    return true;
  }

  function hasIdentity() {
    return Boolean(String(state.name || "").trim() && String(state.phone || "").trim());
  }

  function newId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return prefix + "-" + window.crypto.randomUUID();
    }
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function ensureSession() {
    if (!state.session_id) {
      state.session_id = newId("site-session");
      state.messages = [];
      state.storage_version = storageVersion;
      saveState();
    }
    return state.session_id;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function api(path, query) {
    var proxy = proxyBase || (location.hostname === "u-pos.uz" || location.hostname === "www.u-pos.uz" ? "/upos-site-chat-proxy.php" : "");
    if (proxy) {
      var endpoint = String(path || "").split("/").pop();
      return proxy + "?path=" + encodeURIComponent(endpoint) + (query ? "&" + query : "");
    }
    var base = apiBase.replace(/\/$/, "");
    return base + path + (query ? "?" + query : "");
  }

  function mountStyles() {
    if (document.getElementById("upos-site-chat-style")) return;
    var style = document.createElement("style");
    style.id = "upos-site-chat-style";
    style.textContent = [
      ".upos-chat-button{position:fixed;right:22px;bottom:22px;z-index:2147483000;width:64px;height:64px;border:0;border-radius:50%;background:#2563eb;color:#fff;box-shadow:0 18px 40px rgba(37,99,235,.35);font:800 14px/1 system-ui;cursor:pointer}",
      ".upos-chat-button:after{content:'';position:absolute;right:4px;top:4px;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #fff}",
      ".upos-chat-panel{position:fixed;right:22px;bottom:96px;z-index:2147483000;width:min(390px,calc(100vw - 28px));height:min(660px,calc(100vh - 116px));display:none;flex-direction:column;background:#fff;border:1px solid #c8d7f1;border-radius:16px;box-shadow:0 22px 70px rgba(15,23,42,.24);overflow:hidden;font:14px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a}",
      ".upos-chat-panel.is-open{display:flex}",
      ".upos-chat-head{padding:15px 16px;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px}",
      ".upos-chat-head strong{display:block;font-size:16px}.upos-chat-head span{display:flex;align-items:center;gap:6px;color:#dbeafe;font-size:12px;margin-top:3px}.upos-chat-head span:before{content:'';width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}",
      ".upos-chat-close{border:0;background:rgba(255,255,255,.16);color:#fff;border-radius:10px;width:32px;height:32px;cursor:pointer}",
      ".upos-chat-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;padding:12px;background:#fff}",
      ".upos-chat-history{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;overflow:auto;padding:10px;background:#f8fafc;border:1px solid #dbe6f7;border-radius:12px}",
      ".upos-chat-msg{max-width:88%;padding:9px 11px;border-radius:13px;background:#e8eef8;color:#0f172a;white-space:pre-wrap;word-break:break-word}.upos-chat-msg.is-out,.upos-chat-msg.is-pending{align-self:flex-end;background:#2563eb;color:#fff}.upos-chat-msg.is-pending{opacity:.72}",
      ".upos-chat-msg-text{display:block}.upos-chat-checks{display:flex;align-items:center;justify-content:flex-end;gap:0;margin-top:4px;font-size:12px;font-weight:900;line-height:1;color:rgba(255,255,255,.7);letter-spacing:-3px}.upos-chat-checks.is-read{color:#60a5fa}.upos-chat-checks span{display:inline-block}.upos-chat-checks span+span{margin-left:-2px}",
      ".upos-chat-intro{font-size:13px;color:#475569;margin:0 0 2px}.upos-chat-identity{display:grid;gap:9px}.upos-chat-identity.is-hidden{display:none}",
      ".upos-chat-field{display:flex;flex-direction:column;gap:5px}.upos-chat-field span{font-size:12px;font-weight:700;color:#475569}.upos-chat-field input,.upos-chat-field textarea{width:100%;box-sizing:border-box;border:1px solid #cbd8ee;border-radius:10px;padding:10px 11px;font:inherit;outline:none}.upos-chat-field textarea{min-height:82px;max-height:140px;resize:vertical}",
      ".upos-chat-composer{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}.upos-chat-composer textarea{min-height:44px;max-height:120px}.upos-chat-composer.is-first{display:block}.upos-chat-send{border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:800;padding:11px 14px;cursor:pointer}.upos-chat-send:disabled{opacity:.65;cursor:wait}",
      ".upos-chat-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:18px}.upos-chat-status{color:#64748b;font-size:12px}.upos-chat-status.is-error{color:#dc2626}.upos-chat-edit{border:0;background:transparent;color:#2563eb;font-size:12px;font-weight:700;cursor:pointer;padding:0}",
      "@media(max-width:520px){.upos-chat-button{right:16px;bottom:16px}.upos-chat-panel{right:10px;bottom:88px;width:calc(100vw - 20px);height:min(640px,calc(100vh - 100px));border-radius:14px}}",
    ].join("");
    document.head.appendChild(style);
  }

  function mount() {
    window[singletonKey].destroy();
    mountStyles();
    var panel = document.createElement("section");
    panel.className = "upos-chat-panel";
    panel.dataset.uposSiteChat = "1";
    panel.innerHTML =
      '<header class="upos-chat-head"><div><strong>U-POS чат</strong><span>В сети · Обычно отвечаем быстро</span></div><button class="upos-chat-close" type="button" aria-label="Закрыть">×</button></header>' +
      '<div class="upos-chat-body">' +
      '<div class="upos-chat-history" data-upos-chat-history><div class="upos-chat-msg">Здравствуйте! Чем можем помочь?</div></div>' +
      '<div class="upos-chat-identity" data-upos-chat-identity><p class="upos-chat-intro">Оставьте имя и телефон один раз, дальше здесь будет обычный чат.</p><label class="upos-chat-field"><span>Имя</span><input data-upos-chat-name autocomplete="name" placeholder="Ваше имя"></label><label class="upos-chat-field"><span>Телефон</span><input data-upos-chat-phone autocomplete="tel" placeholder="+998"></label></div>' +
      '<label class="upos-chat-field upos-chat-composer" data-upos-chat-composer><span class="upos-chat-composer-label">Сообщение</span><textarea data-upos-chat-message placeholder="Напишите сообщение"></textarea><button class="upos-chat-send" type="button" data-upos-chat-send>Начать чат</button></label>' +
      '<div class="upos-chat-meta"><button class="upos-chat-edit" type="button" data-upos-chat-edit hidden>Изменить данные</button><div class="upos-chat-status" data-upos-chat-status></div></div>' +
      "</div>";
    var button = document.createElement("button");
    button.className = "upos-chat-button";
    button.dataset.uposSiteChat = "1";
    button.type = "button";
    button.setAttribute("aria-label", "Открыть чат");
    button.textContent = "Чат";
    document.body.appendChild(panel);
    document.body.appendChild(button);

    var name = panel.querySelector("[data-upos-chat-name]");
    var phone = panel.querySelector("[data-upos-chat-phone]");
    var message = panel.querySelector("[data-upos-chat-message]");
    var send = panel.querySelector("[data-upos-chat-send]");
    var edit = panel.querySelector("[data-upos-chat-edit]");
    if (state.name) name.value = state.name;
    if (state.phone) phone.value = state.phone;
    syncMode(panel);
    render(state.messages);

    button.addEventListener("click", function () {
      panel.classList.add("is-open");
      render(state.messages);
      refresh();
      pollTimer = pollTimer || window.setInterval(refresh, 7000);
      message.focus();
    });
    panel.querySelector(".upos-chat-close").addEventListener("click", function () {
      panel.classList.remove("is-open");
    });
    edit.addEventListener("click", function () {
      panel.dataset.editingIdentity = "1";
      syncMode(panel);
      name.focus();
    });
    message.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage(panel);
      }
    });
    send.addEventListener("click", function () {
      sendMessage(panel);
    });
  }

  function syncMode(panel) {
    var identity = panel.querySelector("[data-upos-chat-identity]");
    var send = panel.querySelector("[data-upos-chat-send]");
    var edit = panel.querySelector("[data-upos-chat-edit]");
    var composer = panel.querySelector("[data-upos-chat-composer]");
    var editing = panel.dataset.editingIdentity === "1";
    var known = hasIdentity() && !editing;
    identity.classList.toggle("is-hidden", known);
    edit.hidden = !hasIdentity();
    send.textContent = known ? "Отправить" : "Начать чат";
    composer.classList.toggle("is-first", !known);
  }

  function json(response) {
    return response.json().catch(function () { return {}; }).then(function (payload) {
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Ошибка связи");
      return payload;
    });
  }

  function status(text, error) {
    var node = document.querySelector("[data-upos-chat-status]");
    if (!node) return;
    node.textContent = text || "";
    node.classList.toggle("is-error", !!error);
  }

  function currentMessages() {
    var box = document.querySelector("[data-upos-chat-history]");
    return box && box._messages ? box._messages.slice() : [];
  }

  function messageKey(message) {
    if (message && message.id) return "id:" + message.id;
    if (message && message.client_message_id) return "client:" + message.client_message_id;
    if (message && message.temp_id) return "temp:" + message.temp_id;
    return [
      String(message && message.direction || ""),
      String(message && message.author || ""),
      String(message && message.sent_at || ""),
      String(message && message.text || ""),
    ].join("|");
  }

  function mergeMessages(localMessages, serverMessages) {
    var merged = [];
    var seen = {};
    (Array.isArray(serverMessages) ? serverMessages : []).forEach(function (message) {
      if (message && message.client_message_id) {
        message.pending = false;
        message.stage = "saved";
      }
      var key = messageKey(message);
      seen[key] = true;
      merged.push(message);
    });
    (Array.isArray(localMessages) ? localMessages : []).forEach(function (message) {
      if (!message) return;
      var exists = merged.some(function (serverMessage) {
        if (message.client_message_id && serverMessage.client_message_id) {
          return message.client_message_id === serverMessage.client_message_id;
        }
        return String(serverMessage.direction || "") === "in"
          && String(serverMessage.text || "") === String(message.text || "")
          && Math.abs(Date.parse(serverMessage.sent_at || 0) - Date.parse(message.sent_at || 0)) < 30000;
      });
      if (!exists && !seen[messageKey(message)]) merged.push(message);
    });
    merged.sort(function (left, right) {
      return (Date.parse(left && left.sent_at || "") || 0) - (Date.parse(right && right.sent_at || "") || 0);
    });
    return merged;
  }

  function isClientMessageRead(messages, index) {
    var message = messages[index];
    if (!message || message.pending || String(message.direction || "") !== "in") return false;
    var sentAt = Date.parse(message.sent_at || "");
    for (var i = index + 1; i < messages.length; i += 1) {
      var next = messages[i];
      if (!next || String(next.direction || "") !== "out") continue;
      var nextAt = Date.parse(next.sent_at || "");
      if (!sentAt || !nextAt || nextAt >= sentAt) return true;
    }
    return false;
  }

  function messageChecks(message, read) {
    if (String(message.direction || "") !== "in") return "";
    var count = message.pending || message.stage === "sending" ? 1 : 2;
    var ticks = '<span>✓</span>' + (count > 1 ? '<span>✓</span>' : "");
    return '<span class="upos-chat-checks ' + (read ? "is-read" : "") + '" aria-label="' + (read ? "Прочитано" : message.pending ? "Отправляется" : "Доставлено") + '">' + ticks + "</span>";
  }

  function render(messages) {
    var box = document.querySelector("[data-upos-chat-history]");
    if (!box || !Array.isArray(messages) || !messages.length) return;
    var stableMessages = messages.slice(-120);
    state.messages = stableMessages;
    saveState();
    box._messages = stableMessages.slice();
    box.innerHTML = stableMessages.map(function (message, index) {
      var fromClient = String(message.direction || "") === "in";
      var pending = Boolean(message.pending);
      return '<div class="upos-chat-msg ' + (fromClient || pending ? "is-out " : "") + (pending ? "is-pending" : "") + '"><span class="upos-chat-msg-text">' + escapeHtml(message.text || "") + "</span>" + messageChecks(message, isClientMessageRead(stableMessages, index)) + "</div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  function sendMessage(panel) {
    var name = panel.querySelector("[data-upos-chat-name]");
    var phone = panel.querySelector("[data-upos-chat-phone]");
    var message = panel.querySelector("[data-upos-chat-message]");
    var send = panel.querySelector("[data-upos-chat-send]");
    var text = String(message.value || "").trim();
    if (!hasIdentity() || panel.dataset.editingIdentity === "1") {
      state.name = String(name.value || "").trim();
      state.phone = String(phone.value || "").trim();
      if (!state.name || !state.phone) {
        status("Введите имя и телефон", true);
        (!state.name ? name : phone).focus();
        return;
      }
      ensureSession();
      saveState();
    }
    if (!text) {
      status("Введите сообщение", true);
      message.focus();
      return;
    }
    var pending = currentMessages();
    ensureSession();
    var clientMessageId = newId("site-msg");
    pending.push({ temp_id: clientMessageId, client_message_id: clientMessageId, direction: "in", text: text, pending: true, stage: "sending", sent_at: new Date().toISOString() });
    render(pending);
    message.value = "";
    send.disabled = true;
    status("Отправляем...", false);
    fetch(api("/api/site-chat/message"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: workspace,
        session_id: state.session_id,
        client_message_id: clientMessageId,
        name: state.name,
        phone: state.phone,
        message: text,
        page_url: location.href,
        referrer: document.referrer || "",
      }),
    })
      .then(json)
      .then(function (payload) {
        state.session_id = payload.session_id || state.session_id;
        panel.dataset.editingIdentity = "";
        saveState();
        syncMode(panel);
        var settled = pending.map(function (item) {
          if (item && item.client_message_id === clientMessageId) {
            return Object.assign({}, item, { pending: false, stage: "saved" });
          }
          return item;
        });
        render(mergeMessages(settled, payload.messages || []));
        status("Отправлено", false);
      })
      .catch(function (err) {
        status(err.message || "Ошибка отправки", true);
      })
      .then(function () {
        send.disabled = false;
      });
  }

  function refresh() {
    if (!state.session_id) return;
    fetch(api("/api/site-chat/history", "workspace=" + encodeURIComponent(workspace) + "&session_id=" + encodeURIComponent(state.session_id)))
      .then(json)
      .then(function (payload) { render(mergeMessages(currentMessages(), payload.messages || [])); })
      .catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
