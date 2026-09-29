(function () {
  function csrfToken() {
    var input = document.querySelector('input[name="csrf_token"]');
    if (input && input.value) return input.value;
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortDate(value) {
    if (!value) return "-";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function api(method, url, body) {
    var headers = { "X-CSRF-Token": csrfToken() };
    var opts = { method: method, headers: headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    return fetch(url, opts).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (payload) {
          if (!res.ok || payload.error) {
            throw new Error(payload.error || "Ошибка запроса");
          }
          return payload;
        });
    });
  }

  function boot(root) {
    var statusEl = root.querySelector("[data-messenger-tg-status]");
    var tokenEl = root.querySelector("[data-messenger-tg-token]");
    var refreshBtn = root.querySelector("[data-messenger-tg-refresh]");
    var repairBtn = root.querySelector("[data-messenger-tg-repair]");
    var listEl = root.querySelector("[data-messenger-tg-chat-list]");
    var countEl = root.querySelector("[data-messenger-tg-count]");
    var emptyEl = root.querySelector("[data-messenger-tg-empty]");
    var detailTitle = root.querySelector("[data-messenger-tg-detail-title]");
    var detailMeta = root.querySelector("[data-messenger-tg-detail-meta]");
    var enabledBox = root.querySelector("[data-messenger-tg-enabled]");
    var logEl = root.querySelector("[data-messenger-tg-log]");
    var messageEl = root.querySelector("[data-messenger-tg-message]");
    var sendBtn = root.querySelector("[data-messenger-tg-send]");
    var subscribersEl = root.querySelector("[data-messenger-tg-subscribers]");
    var state = { chats: [], selectedId: "", canManage: false, connected: false };

    function setBusy(button, busy, text) {
      if (!button) return;
      if (busy) {
        button.dataset.originalText = button.textContent || "";
        button.textContent = text || "Загрузка...";
      } else if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
      }
      button.disabled = !!busy;
    }

    function selectedChat() {
      return state.chats.find(function (chat) {
        return String(chat.id) === String(state.selectedId);
      }) || null;
    }

    function canSendToChat(chat) {
      return !!chat && (String(chat.chat_type || "").toLowerCase() === "private" || chat.bot_is_admin !== false);
    }

    function setStatus(snapshot) {
      var cfg = snapshot.config || {};
      state.connected = !!snapshot.connected;
      state.canManage = !!snapshot.can_manage;
      if (tokenEl) {
        var tokenLabel = cfg.bot_username ? "@" + cfg.bot_username : cfg.bot_first_name || "@Uposchatbot";
        tokenEl.textContent = tokenLabel + " · токен скрыт";
      }
      if (!statusEl) return;
      if (!state.connected) {
        statusEl.textContent = "Telegram не подключен. Укажите токен в соцсетях.";
        statusEl.setAttribute("data-variant", "warn");
        return;
      }
      var username = cfg.bot_username ? "@" + cfg.bot_username : cfg.bot_first_name || "бот";
      var enabled = snapshot.enabled_chats_count || 0;
      var total = snapshot.admin_chats_count || 0;
      statusEl.textContent = "Подключен " + username + ". Активных чатов: " + enabled + " из " + total + ".";
      statusEl.setAttribute("data-variant", cfg.last_error ? "warn" : "ok");
    }

    function renderChatBody(chat) {
      if (!detailTitle || !detailMeta || !enabledBox || !messageEl || !sendBtn || !logEl) return;
      if (!chat) {
        detailTitle.textContent = "Telegram";
        detailMeta.textContent = "Выберите чат слева";
        enabledBox.checked = false;
        enabledBox.disabled = true;
        messageEl.value = "";
        messageEl.disabled = true;
        sendBtn.disabled = true;
        logEl.innerHTML =
          '<div class="messenger-telegram-placeholder">Здесь будет рабочее место для выбранного Telegram-чата: статус, отправка сообщений и связь с клиентами.</div>';
        return;
      }
      var isPrivate = String(chat.chat_type || "").toLowerCase() === "private";
      var canSend = canSendToChat(chat);
      detailTitle.textContent = chat.title || String(chat.chat_id || "Telegram");
      detailMeta.textContent =
        (isPrivate ? "Личный Telegram-чат" : chat.chat_type || "chat") +
        " · ID " +
        (chat.chat_id || "-") +
        " · Обновлен " +
        shortDate(chat.last_seen_at || chat.discovered_at);
      enabledBox.checked = !!chat.is_enabled;
      enabledBox.disabled = !state.canManage || !canSend;
      messageEl.disabled = !state.canManage || !state.connected || !canSend;
      sendBtn.disabled = messageEl.disabled || !String(messageEl.value || "").trim();
      logEl.innerHTML =
        '<div class="messenger-telegram-message messenger-telegram-message--system">' +
        '<strong>' +
        escapeHtml(isPrivate ? "Личный чат клиента" : chat.bot_is_admin ? "Бот администратор" : "Боту нужны права администратора") +
        "</strong>" +
        "<span>" +
        escapeHtml(isPrivate ? "Можно отвечать клиенту прямо из U-POS через подключенного Telegram-бота." : chat.is_enabled ? "Чат включен для уведомлений и ручных сообщений." : "Чат найден, но пока выключен.") +
        "</span>" +
        "</div>";
    }

    function renderChats() {
      if (!listEl) return;
      listEl.innerHTML = "";
      var chats = state.chats || [];
      if (countEl) countEl.textContent = String(chats.length);
      if (emptyEl) emptyEl.hidden = chats.length > 0;
      chats.forEach(function (chat) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "messenger-telegram-chat";
        if (String(chat.id) === String(state.selectedId)) button.classList.add("active");
        button.setAttribute("data-chat-id", chat.id || "");
        button.innerHTML =
          '<span class="messenger-telegram-chat-icon">TG</span>' +
          '<span class="messenger-telegram-chat-main"><strong>' +
          escapeHtml(chat.title || chat.chat_id || "Telegram") +
          "</strong><small>" +
          escapeHtml((String(chat.chat_type || "").toLowerCase() === "private" ? "клиент" : chat.chat_type || "chat") + " · " + (chat.is_enabled ? "активен" : "выключен")) +
          "</small></span>" +
          '<span class="messenger-telegram-dot" data-enabled="' +
          (chat.is_enabled ? "1" : "0") +
          '"></span>';
        button.addEventListener("click", function () {
          state.selectedId = chat.id || "";
          renderChats();
          renderChatBody(chat);
        });
        listEl.appendChild(button);
      });
      if (!selectedChat() && chats.length) state.selectedId = chats[0].id || "";
      renderChatBody(selectedChat());
    }

    function renderSubscribers(snapshot) {
      if (!subscribersEl) return;
      var pending = Array.isArray(snapshot.pending) ? snapshot.pending : [];
      var approved = Array.isArray(snapshot.approved) ? snapshot.approved : [];
      var rows = pending.concat(approved);
      if (!rows.length) {
        subscribersEl.innerHTML = '<tr><td colspan="4">Заявок и подписчиков пока нет.</td></tr>';
        return;
      }
      subscribersEl.innerHTML = rows
        .map(function (row) {
          var name = row.display_name || row.phone || row.telegram_user_id || "-";
          var username = row.username ? "@" + row.username : "-";
          var status = row.status === "approved" ? "Одобрен" : row.status === "pending" ? "Ожидает" : row.status || "-";
          return (
            "<tr><td><strong>" +
            escapeHtml(name) +
            "</strong><small>" +
            escapeHtml(row.phone || "") +
            "</small></td><td>" +
            escapeHtml(username) +
            "</td><td>" +
            escapeHtml(status) +
            "</td><td>" +
            escapeHtml(shortDate(row.requested_at || row.decided_at)) +
            "</td></tr>"
          );
        })
        .join("");
    }

    function load() {
      return api("GET", "/api/telegram/snapshot")
        .then(function (snapshot) {
          state.chats = Array.isArray(snapshot.chats) ? snapshot.chats : [];
          if (!selectedChat() && state.chats.length) state.selectedId = state.chats[0].id || "";
          setStatus(snapshot);
          renderChats();
          renderSubscribers(snapshot);
        })
        .catch(function (err) {
          if (statusEl) {
            statusEl.textContent = err.message || "Не удалось загрузить Telegram";
            statusEl.setAttribute("data-variant", "err");
          }
        });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        setBusy(refreshBtn, true, "Обновляем...");
        api("POST", "/api/telegram/chats/refresh")
          .then(function (payload) {
            state.chats = Array.isArray(payload.chats) ? payload.chats : state.chats;
            renderChats();
            return load();
          })
          .catch(function (err) {
            alert(err.message || "Не удалось обновить чаты");
          })
          .finally(function () {
            setBusy(refreshBtn, false);
          });
      });
    }

    if (repairBtn) {
      repairBtn.addEventListener("click", function () {
        setBusy(repairBtn, true, "Переподключаем...");
        api("POST", "/api/telegram/webhook/repair")
          .then(function () {
            return load();
          })
          .catch(function (err) {
            alert(err.message || "Не удалось переподключить Telegram");
          })
          .finally(function () {
            setBusy(repairBtn, false);
          });
      });
    }

    if (enabledBox) {
      enabledBox.addEventListener("change", function () {
        var chat = selectedChat();
        if (!chat) return;
        enabledBox.disabled = true;
        api("PATCH", "/api/telegram/chats/" + encodeURIComponent(chat.id), {
          is_enabled: enabledBox.checked,
        })
          .then(function (payload) {
            var updated = payload.chat || {};
            state.chats = state.chats.map(function (item) {
              return String(item.id) === String(updated.id) ? updated : item;
            });
            renderChats();
          })
          .catch(function (err) {
            enabledBox.checked = !!chat.is_enabled;
            alert(err.message || "Не удалось изменить чат");
          })
          .finally(function () {
            renderChatBody(selectedChat());
          });
      });
    }

    if (messageEl && sendBtn) {
      messageEl.addEventListener("input", function () {
        var chat = selectedChat();
        sendBtn.disabled = !canSendToChat(chat) || !state.canManage || !state.connected || !String(messageEl.value || "").trim();
      });
      sendBtn.addEventListener("click", function () {
        var chat = selectedChat();
        var text = String(messageEl.value || "").trim();
        if (!chat || !text) return;
        setBusy(sendBtn, true, "Отправляем...");
        api("POST", "/api/telegram/chats/" + encodeURIComponent(chat.id) + "/send", { text: text })
          .then(function () {
            var bubble = document.createElement("div");
            bubble.className = "messenger-telegram-message messenger-telegram-message--out";
            bubble.innerHTML = "<strong>Вы</strong><span>" + escapeHtml(text) + "</span>";
            if (logEl) logEl.appendChild(bubble);
            messageEl.value = "";
          })
          .catch(function (err) {
            alert(err.message || "Сообщение не отправлено");
          })
          .finally(function () {
            setBusy(sendBtn, false);
            sendBtn.disabled = true;
          });
      });
    }

    load();
    try {
      var events = new EventSource("/api/telegram/events");
      events.addEventListener("message", function () {
        load();
      });
    } catch (err) {
      // EventSource is optional; manual refresh remains available.
    }
  }

  function start() {
    document.querySelectorAll("[data-messenger-telegram]").forEach(boot);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
