(function () {
  var THREAD_STORE_PREFIX = "upos.messenger.thread.";
  var THREAD_INDEX_KEY = "upos.messenger.threadIndex";
  var SELECTED_THREAD_KEY = "upos.messenger.selectedThread";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function classToken(value, fallback) {
    return String(value || fallback || "offline").replace(/[^a-z0-9_-]/gi, "") || fallback || "offline";
  }

  function readJsonStorage(key, fallback) {
    try {
      var raw = window.localStorage && window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function writeJsonStorage(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      return false;
    }
    return true;
  }

  function storageKey(threadOrId) {
    var id = typeof threadOrId === "object" ? threadOrId && threadOrId.id : threadOrId;
    return THREAD_STORE_PREFIX + String(id || "");
  }

  function readThreads() {
    var script = document.querySelector("[data-messenger-thread-json]");
    if (!script) return [];
    try {
      var rows = JSON.parse(script.textContent || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      return [];
    }
  }

  function readTemplates() {
    var script = document.querySelector("[data-messenger-template-json]");
    if (!script) return [];
    try {
      var rows = JSON.parse(script.textContent || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      return [];
    }
  }

  function channelKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function threadMessages(thread) {
    return Array.isArray(thread && thread.messages) ? thread.messages : [];
  }

  function initialsFor(thread) {
    var source = String((thread && thread.contact) || (thread && thread.channel) || "TE").trim();
    var words = source.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    return source.slice(0, 2).toUpperCase() || "TE";
  }

  function avatarMarkup(thread) {
    if (thread && thread.avatar_url) {
      return '<img src="' + escapeHtml(thread.avatar_url) + '" alt="" loading="lazy" />';
    }
    return "<span>" + escapeHtml(initialsFor(thread)) + "</span>";
  }

  function normalizeThread(thread) {
    var copy = Object.assign({}, thread || {});
    copy.id = String(copy.id || "");
    copy.messages = threadMessages(copy).slice();
    copy.avatar_ttl_days = Number(copy.avatar_ttl_days || 5) || 5;
    copy.presence = copy.presence || (copy.status === "waiting" ? "waiting" : "offline");
    copy.presence_label = copy.presence_label || (copy.presence === "waiting" ? "Ожидает" : "Не в сети");
    return copy;
  }

  function rememberThread(thread) {
    if (!thread || !thread.id) return;
    var payload = {
      id: thread.id,
      // Без источника и идентификатора чата восстановленный из кеша диалог
      // терял связь с каналом, и отправка отвечала «канал не подключён».
      source: thread.source || "",
      chat_id: thread.chat_id || "",
      thread_id: thread.thread_id || "",
      channel: thread.channel || "",
      contact: thread.contact || "",
      client: thread.client || "",
      topic: thread.topic || "",
      username: thread.username || "",
      phone: thread.phone || "",
      status: thread.status || "",
      status_label: thread.status_label || "",
      presence: thread.presence || "",
      presence_label: thread.presence_label || "",
      avatar_url: thread.avatar_url || "",
      avatar_saved_at: thread.avatar_url ? Date.now() : 0,
      avatar_ttl_days: Number(thread.avatar_ttl_days || 5) || 5,
      is_new: Boolean(thread.is_new),
      messages: threadMessages(thread).slice(-200),
    };
    writeJsonStorage(storageKey(thread.id), payload);
    var index = readJsonStorage(THREAD_INDEX_KEY, []);
    if (!Array.isArray(index)) index = [];
    if (index.indexOf(thread.id) === -1) {
      index.push(thread.id);
      writeJsonStorage(THREAD_INDEX_KEY, index.slice(-100));
    }
  }

  function mergeStoredState(thread) {
    if (!thread || !thread.id) return thread;
    var saved = readJsonStorage(storageKey(thread.id), null);
    if (!saved || typeof saved !== "object") {
      rememberThread(thread);
      return thread;
    }
    var savedMessages = Array.isArray(saved.messages) ? saved.messages : [];
    if (savedMessages.length > threadMessages(thread).length) {
      thread.messages = savedMessages;
    }
    var savedAvatar = String(saved.avatar_url || "").trim();
    var savedAt = Number(saved.avatar_saved_at || 0);
    var ttl = Number(saved.avatar_ttl_days || thread.avatar_ttl_days || 5) * 24 * 60 * 60 * 1000;
    if (!thread.avatar_url && savedAvatar && savedAt && Date.now() - savedAt <= ttl) {
      thread.avatar_url = savedAvatar;
    }
    rememberThread(thread);
    return thread;
  }

  function loadStoredThreads(existingIds, activeChannel) {
    var index = readJsonStorage(THREAD_INDEX_KEY, []);
    if (!Array.isArray(index)) return [];
    return index
      .map(function (id) {
        if (existingIds[String(id)]) return null;
        var saved = readJsonStorage(storageKey(id), null);
        if (!saved || !saved.id) return null;
        if (activeChannel && channelKey(saved.channel) !== activeChannel) return null;
        saved.restored = true;
        return normalizeThread(saved);
      })
      .filter(Boolean);
  }

  function timeLabelFor(message) {
    if (message.time_label) return String(message.time_label);
    var raw = String(message.created_at || "");
    if (!raw) return "";
    var moment = new Date(raw);
    if (isNaN(moment.getTime())) return "";
    return ("0" + moment.getHours()).slice(-2) + ":" + ("0" + moment.getMinutes()).slice(-2);
  }

  function messageFooter(message, kind) {
    /* Время и статус доставки: одна галочка — отправлено, две — прочитано. */
    var time = timeLabelFor(message);
    var ticks = "";
    if (kind === "out") {
      var read = String(message.status || "sent") === "read";
      ticks =
        '<i class="messenger-message-ticks' +
        (read ? " messenger-message-ticks--read" : "") +
        '" aria-label="' +
        (read ? "Прочитано" : "Отправлено") +
        '" title="' +
        (read ? "Прочитано" : "Отправлено") +
        '"><svg viewBox="0 0 20 12" aria-hidden="true">' +
        '<path d="M1.5 6.6 4.6 9.8 11 2.6" />' +
        (read ? '<path d="M7.6 9.8 14 2.6" />' : "") +
        "</svg></i>";
    }
    if (!time && !ticks) return "";
    return '<span class="messenger-message-meta">' + (time ? "<time>" + escapeHtml(time) + "</time>" : "") + ticks + "</span>";
  }

  function applyDeliveryStatus(messages) {
    /* Ответ собеседника означает, что всё отправленное до него прочитано. */
    var lastIn = 0;
    messages.forEach(function (message) {
      if (String(message.kind || "") !== "in") return;
      var moment = Date.parse(message.created_at || "");
      if (moment && moment > lastIn) lastIn = moment;
    });
    messages.forEach(function (message) {
      if (String(message.kind || "") !== "out") return;
      if (String(message.status || "") === "read") return;
      var moment = Date.parse(message.created_at || "");
      message.status = lastIn && moment && moment <= lastIn ? "read" : "sent";
    });
    return messages;
  }

  function renderMessages(panel, thread) {
    var box = panel.querySelector("[data-messenger-thread-messages]");
    if (!box) return;
    var messages = applyDeliveryStatus(threadMessages(thread));
    if (!messages.length) {
      box.innerHTML = '<div class="messenger-empty">История пока пустая. Начните диалог из поля ниже.</div>';
      return;
    }
    box.innerHTML = messages
      .map(function (message) {
        var kind = classToken(String(message.kind || "in").toLowerCase(), "in");
        var photo = message.photo_url
          ? '<img class="messenger-message-photo" src="' + escapeHtml(message.photo_url) + '" alt="" loading="lazy" />'
          : "";
        return (
          '<div class="messenger-thread-message messenger-thread-message--' +
          escapeHtml(kind) +
          '"><strong>' +
          escapeHtml(message.author || (kind === "out" ? "Вы" : thread.contact || thread.channel)) +
          "</strong><span>" +
          escapeHtml(message.text || "") +
          "</span>" +
          photo +
          messageFooter(message, kind) +
          "</div>"
        );
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function threadSearchText(thread) {
    return [
      thread.contact,
      thread.topic,
      thread.channel,
      thread.status_label,
      thread.last_message,
      thread.username,
      thread.phone,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function hasThreadItem(root, id) {
    var found = false;
    root.querySelectorAll("[data-messenger-thread-id]").forEach(function (item) {
      if (item.getAttribute("data-messenger-thread-id") === String(id)) found = true;
    });
    return found;
  }

  function ensureThreadListItem(root, thread) {
    if (!thread || !thread.id || hasThreadItem(root, thread.id)) {
      return;
    }
    var list = root.querySelector("[data-messenger-thread-list]");
    if (!list) return;
    list.querySelectorAll(".messenger-empty:not([data-messenger-dialog-search-empty])").forEach(function (item) {
      item.hidden = true;
    });
    var button = document.createElement("button");
    var count = threadMessages(thread).length;
    button.type = "button";
    button.className = "messenger-dialog-item messenger-dialog-item--restored";
    button.setAttribute("data-messenger-thread-id", thread.id);
    button.setAttribute("data-messenger-search", threadSearchText(thread));
    button.setAttribute("data-messenger-avatar-url", thread.avatar_url || "");
    button.setAttribute("data-messenger-presence", thread.presence || "offline");
    button.setAttribute("data-messenger-presence-label", thread.presence_label || "Не в сети");
    button.setAttribute("data-messenger-is-new", thread.is_new ? "1" : "0");
    button.innerHTML =
      '<span class="messenger-dialog-avatar-wrap" data-messenger-avatar-open="' +
      escapeHtml(thread.id) +
      '"><span class="messenger-dialog-channel">' +
      avatarMarkup(thread) +
      "</span>" +
      // Точка присутствия — только для тех, кто в сети.
      (classToken(thread.presence, "offline") === "online"
        ? '<i class="messenger-presence-dot messenger-presence-dot--online" aria-hidden="true"></i>'
        : "") +
      '</span><span class="messenger-dialog-main"><span class="messenger-dialog-name-line"><strong>' +
      escapeHtml(thread.contact || "Диалог") +
      "</strong>" +
      (thread.is_new ? '<mark class="messenger-new-badge">NEW</mark>' : "") +
      "</span><small>" +
      escapeHtml(thread.topic || thread.last_message || thread.channel || "") +
      '</small></span><span class="messenger-dialog-side"><em>' +
      escapeHtml(thread.status_label || thread.presence_label || "") +
      "</em>" +
      (count ? "<b>" + escapeHtml(count) + "</b>" : "") +
      "</span>";
    var searchEmpty = root.querySelector("[data-messenger-dialog-search-empty]");
    list.insertBefore(button, searchEmpty || null);
  }

  function updateThreadListItem(root, thread) {
    /* Обновляет строку списка на месте: пересборка убила бы выделение
       выбранного диалога и позицию прокрутки. */
    var item = root.querySelector(
      '[data-messenger-thread-id="' + String(thread.id).replace(/"/g, '\\"') + '"]'
    );
    if (!item) return;
    var name = item.querySelector(".messenger-dialog-name-line strong");
    if (name) name.textContent = thread.contact || "Диалог";
    var preview = item.querySelector(".messenger-dialog-main small");
    if (preview) preview.textContent = thread.topic || thread.last_message || thread.channel || "";
    var timeNode = item.querySelector(".messenger-dialog-time");
    if (timeNode && thread.time_label) timeNode.textContent = thread.time_label;
    var statusNode = item.querySelector(".messenger-dialog-side em");
    if (statusNode) statusNode.textContent = thread.status_label || thread.presence_label || "";

    var badge = item.querySelector("[data-messenger-unread]");
    var unread = Number(thread.unread || 0);
    var selected = String(root.dataset.selectedThreadId || "") === String(thread.id);
    if (badge) {
      var show = unread > 0 && !selected;
      badge.hidden = !show;
      badge.textContent = show ? String(unread) : "";
    }

    var dot = item.querySelector(".messenger-presence-dot");
    var online = classToken(thread.presence, "offline") === "online";
    if (online && !dot) {
      var wrap = item.querySelector(".messenger-dialog-avatar-wrap");
      if (wrap) {
        var mark = document.createElement("i");
        mark.className = "messenger-presence-dot messenger-presence-dot--online";
        mark.setAttribute("aria-hidden", "true");
        wrap.appendChild(mark);
      }
    } else if (!online && dot) {
      dot.remove();
    }
    item.setAttribute("data-messenger-presence", thread.presence || "offline");
    item.setAttribute("data-messenger-search", threadSearchText(thread));
  }

  function updateThreadHeader(root, thread) {
    var title = root.querySelector("[data-messenger-thread-title]");
    var meta = root.querySelector("[data-messenger-thread-meta]");
    var presence = root.querySelector("[data-messenger-thread-presence]");
    var avatar = root.querySelector("[data-messenger-thread-avatar]");
    if (title) title.textContent = thread.contact || "Диалог";
    if (meta) {
      meta.textContent =
        (thread.channel || "Канал") +
        " · " +
        (thread.topic || thread.status_label || "обращение") +
        (thread.client ? " · клиент: " + thread.client : "");
    }
    if (presence) {
      var token = classToken(thread.presence, "offline");
      presence.className = "messenger-thread-presence messenger-thread-presence--" + token;
      presence.textContent = thread.presence_label || "Не в сети";
    }
    if (avatar) {
      avatar.innerHTML = avatarMarkup(thread);
      avatar.setAttribute("data-messenger-avatar-open", thread.id || "");
    }
  }

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  function showSendStatus(root, message, kind) {
    var node = root.querySelector("[data-messenger-send-status]");
    if (!node) return;
    if (!message) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.textContent = message;
    node.className = "messenger-send-status messenger-send-status--" + (kind || "error");
  }

  function sendErrorText(code) {
    /* Коды Telegram и Meta сами по себе ничего не говорят сотруднику. */
    var known = {
      not_connected: "Бот Telegram не подключён. Откройте Настройки → Телеграм и привяжите бота.",
      business_not_connected:
        "Telegram Business не подключён. Нужен Telegram Premium, а в настройках Telegram → Telegram для бизнеса → Чат-боты надо выбрать вашего бота.",
      business_reply_denied:
        "Боту не разрешено отвечать за вас. В Telegram → Telegram для бизнеса → Чат-боты включите право отвечать на сообщения.",
      bot_not_admin: "Бот не администратор в этом чате — добавьте его администратором.",
      forbidden: "Нет прав на отправку сообщений. Попросите директора выдать доступ к Телеграму.",
      csrf: "Сессия устарела. Обновите страницу и попробуйте снова.",
      unauthorized: "Сессия завершена. Войдите заново.",
      message_required: "Введите текст сообщения.",
      chat_required: "У переписки нет чата Telegram.",
      not_found: "Переписка не найдена — обновите список диалогов.",
    };
    var raw = String(code || "").trim();
    if (known[raw]) return known[raw];
    if (raw.indexOf("Не указан аккаунт Instagram") === 0) {
      return "Instagram не подключён: в Настройки → Соцсети укажите Instagram Business ID и токен доступа.";
    }
    if (raw.indexOf("Не указан получатель") === 0) {
      return "У этой переписки нет получателя Instagram — обновите список диалогов.";
    }
    if (raw.indexOf("BUSINESS_CONNECTION_INVALID") >= 0) {
      return "Подключение Telegram Business устарело. В Мессенджеры → Телеграм нажмите «Переподключить».";
    }
    if (raw.indexOf("business connection") >= 0 || raw.indexOf("BUSINESS") >= 0) {
      return "Telegram отклонил ответ за владельца: проверьте в Telegram → Telegram для бизнеса → Чат-боты, что бот выбран и ему разрешено отвечать. Ответ Telegram: " + raw;
    }
    return raw || "Не удалось отправить сообщение";
  }

  function dropChannelUnread(count) {
    /* Цифра на вкладке канала — сумма непрочитанных его диалогов. */
    if (!count) return;
    var tab = document.querySelector(".messenger-channel-tab.active");
    var badge = tab ? tab.querySelector("b") : null;
    if (!badge) return;
    var left = (parseInt(badge.textContent, 10) || 0) - count;
    if (left > 0) {
      badge.textContent = String(left);
    } else {
      badge.remove();
    }
  }

  function clearUnread(root, thread) {
    /* Счётчик гасим сразу, не дожидаясь ответа сервера: диалог уже открыт. */
    var item = root.querySelector('[data-messenger-thread-id="' + String(thread.id).replace(/"/g, '\\"') + '"]');
    if (item) {
      var badge = item.querySelector("[data-messenger-unread]");
      if (badge) {
        if (!badge.hidden) dropChannelUnread(parseInt(badge.textContent, 10) || 0);
        badge.textContent = "";
        badge.hidden = true;
      }
      var mark = item.querySelector(".messenger-new-badge");
      if (mark) mark.remove();
      item.setAttribute("data-messenger-is-new", "0");
    }
    thread.unread = 0;
    thread.is_new = false;
    if (!thread.id || thread.restored) return;
    try {
      window.fetch("/api/messengers/threads/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
        credentials: "same-origin",
        body: JSON.stringify({ thread_id: thread.id }),
      });
    } catch (err) {
      /* отметка прочтения не должна мешать работе с диалогом */
    }
  }

  function selectThread(root, thread) {
    if (!thread) return;
    root.querySelectorAll("[data-messenger-thread-id]").forEach(function (item) {
      item.classList.toggle("active", item.getAttribute("data-messenger-thread-id") === String(thread.id));
    });
    clearUnread(root, thread);
    updateThreadHeader(root, thread);
    renderMessages(root, thread);
    root.dataset.selectedThreadId = thread.id || "";
    try {
      window.localStorage && window.localStorage.setItem(SELECTED_THREAD_KEY, thread.id || "");
    } catch (err) {
      return;
    }
  }

  function moneyText(value, currency) {
    var amount = Number(value || 0);
    if (!isFinite(amount)) amount = 0;
    return amount.toLocaleString("ru-RU") + " " + (currency || "UZS");
  }

  function renderClientCard(root, card) {
    var box = root.querySelector("[data-messenger-client-body]");
    if (!box) return;
    var client = card && card.client;
    var docs = (card && card.documents) || [];
    var totals = (card && card.totals) || {};
    var head = client
      ? '<p class="settings-ios-footnote">Клиент в базе</p><h3>' +
        escapeHtml(client.name) +
        "</h3>" +
        '<div class="messenger-client-facts">' +
        (client.phone ? "<span>Телефон: <b>" + escapeHtml(client.phone) + "</b></span>" : "") +
        (client.category ? "<span>Категория: <b>" + escapeHtml(client.category) + "</b></span>" : "") +
        "<span>Документов: <b>" + docs.length + "</b></span>" +
        "<span>Оборот: <b>" + moneyText(totals.amount) + "</b></span>" +
        "<span>Долг: <b>" + moneyText(totals.debt) + "</b></span>" +
        "</div>" +
        '<a class="btn btn-secondary" href="' + escapeHtml(client.url || "#") + '">Открыть карточку клиента</a>'
      : '<p class="settings-ios-footnote">Клиента нет в базе</p><h3>' +
        escapeHtml((card && card.contact) || "Новый контакт") +
        "</h3><p>Заведите карточку, чтобы видеть заказы и историю этого собеседника.</p>";

    var form =
      '<form class="messenger-client-form" data-messenger-client-form>' +
      '<label><span>Имя клиента</span><input name="name" value="' +
      escapeHtml((client && client.name) || (card && card.contact) || "") +
      '" required /></label>' +
      '<label><span>Телефон</span><input name="phone" value="' +
      escapeHtml((client && client.phone) || (card && card.phone) || "") +
      '" placeholder="+998 90 123 45 67" /></label>' +
      '<label><span>Заметка</span><input name="comment" value="' +
      escapeHtml((client && client.comment) || "") +
      '" placeholder="Что важно помнить о клиенте" /></label>' +
      '<input type="hidden" name="client_id" value="' + escapeHtml((client && client.id) || "") + '" />' +
      '<button type="submit" class="btn">' + (client ? "Сохранить" : "Создать клиента") + "</button>" +
      "</form>";

    var groups = [
      { key: "all", label: "Все" },
      { key: "sale", label: "Продажи" },
      { key: "order", label: "Заказы" },
      { key: "return", label: "Возвраты" },
      { key: "installment", label: "Рассрочки" },
    ];
    var tabs =
      '<nav class="messenger-client-groups" data-messenger-client-groups>' +
      groups
        .map(function (group) {
          var count =
            group.key === "all"
              ? docs.length
              : docs.filter(function (doc) {
                  return String(doc.group || doc.kind) === group.key;
                }).length;
          return (
            '<button type="button" class="messenger-client-group' +
            (group.key === "all" ? " active" : "") +
            '" data-client-group="' + group.key + '">' +
            escapeHtml(group.label) + " <b>" + count + "</b></button>"
          );
        })
        .join("") +
      "</nav>";

    var history = docs.length
      ? tabs +
        '<table class="messenger-client-docs"><thead><tr><th>Дата</th><th>№</th><th>Тип</th><th>Статус</th><th>Сумма</th><th>Долг</th><th></th></tr></thead><tbody>' +
        docs
          .map(function (doc) {
            return (
              '<tr data-doc-group="' + escapeHtml(String(doc.group || "sale")) + '">' +
              '<td data-doc-url="' + escapeHtml(doc.url || "") + '">' + escapeHtml(doc.date || "") + "</td>" +
              '<td data-doc-url="' + escapeHtml(doc.url || "") + '">' + escapeHtml(doc.number || "") + "</td>" +
              "<td>" + escapeHtml(doc.kind || "") + (String(doc.group) === "installment" ? " · рассрочка" : "") + "</td>" +
              "<td>" + escapeHtml(doc.status || "") + "</td>" +
              "<td>" + moneyText(doc.amount, doc.currency) + "</td>" +
              "<td>" + moneyText(doc.debt, doc.currency) + "</td>" +
              '<td class="messenger-client-docs-actions">' +
              '<a class="messenger-client-doc-link" href="/api/sales/' + escapeHtml(doc.id || "") + '/invoice.pdf" target="_blank" rel="noopener">PDF</a>' +
              '<button type="button" class="messenger-client-doc-send" data-send-invoice="' + escapeHtml(doc.id || "") + '">Отправить</button>' +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : '<p class="messenger-empty">Заказов и продаж пока нет.</p>';

    box.innerHTML =
      '<div class="messenger-client-head">' + head + "</div>" + form +
      '<h4 class="messenger-client-subtitle">Заказы и история</h4>' + history +
      '<p class="messenger-client-note" data-messenger-invoice-status hidden></p>';

    box.querySelectorAll("[data-doc-url]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        var url = cell.getAttribute("data-doc-url");
        if (url) window.location.assign(url);
      });
    });

    box.querySelectorAll("[data-client-group]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var key = tab.getAttribute("data-client-group");
        box.querySelectorAll("[data-client-group]").forEach(function (node) {
          node.classList.toggle("active", node === tab);
        });
        box.querySelectorAll("[data-doc-group]").forEach(function (rowNode) {
          rowNode.hidden = key !== "all" && rowNode.getAttribute("data-doc-group") !== key;
        });
      });
    });

    box.querySelectorAll("[data-send-invoice]").forEach(function (button) {
      button.addEventListener("click", function () {
        var status = box.querySelector("[data-messenger-invoice-status]");
        var docId = button.getAttribute("data-send-invoice");
        if (!docId) return;
        button.disabled = true;
        if (status) {
          status.hidden = false;
          status.className = "messenger-client-note";
          status.textContent = "Отправляем накладную…";
        }
        window
          .fetch("/api/messengers/threads/" + encodeURIComponent(card.thread_id) + "/invoice", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
            body: JSON.stringify({ document_id: docId }),
          })
          .then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
              if (!response.ok || !body.ok) throw new Error(body.error || "Не удалось отправить накладную");
              return body;
            });
          })
          .then(function (body) {
            if (status) {
              status.className = "messenger-client-note messenger-client-note--ok";
              status.textContent = "Накладная отправлена клиенту: " + (body.caption || "");
            }
          })
          .catch(function (error) {
            if (status) {
              status.className = "messenger-client-note messenger-client-note--error";
              status.textContent = sendErrorText(error.message);
            }
          })
          .then(function () {
            button.disabled = false;
          });
      });
    });

    var formNode = box.querySelector("[data-messenger-client-form]");
    if (formNode) {
      formNode.addEventListener("submit", function (event) {
        event.preventDefault();
        var button = formNode.querySelector("button[type=submit]");
        if (button) button.disabled = true;
        var payload = {
          name: String(formNode.elements.name.value || "").trim(),
          phone: String(formNode.elements.phone.value || "").trim(),
          comment: String(formNode.elements.comment.value || "").trim(),
          client_id: String(formNode.elements.client_id.value || "").trim(),
        };
        window
          .fetch("/api/messengers/threads/" + encodeURIComponent(card.thread_id) + "/client", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
            body: JSON.stringify(payload),
          })
          .then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
              if (!response.ok || !body.ok) throw new Error(body.error || "Не удалось сохранить клиента");
              return body;
            });
          })
          .then(function (body) {
            renderClientCard(root, body.card || card);
          })
          .catch(function (error) {
            window.alert(error.message || "Не удалось сохранить клиента");
          })
          .then(function () {
            if (button) button.disabled = false;
          });
      });
    }
  }

  function openClientDialog(root, thread) {
    var dialog = root.querySelector("[data-messenger-client-dialog]");
    if (!dialog || !thread || !thread.id) return;
    var box = root.querySelector("[data-messenger-client-body]");
    if (box) box.innerHTML = '<p class="messenger-empty">Загружаем карточку…</p>';
    dialog.hidden = false;
    window
      .fetch("/api/messengers/threads/" + encodeURIComponent(thread.id) + "/client", { credentials: "same-origin" })
      .then(function (response) {
        return response.json().catch(function () { return {}; });
      })
      .then(function (body) {
        if (!body || !body.card) throw new Error("Карточка недоступна");
        renderClientCard(root, body.card);
      })
      .catch(function () {
        if (box) box.innerHTML = '<p class="messenger-empty">Не удалось загрузить карточку клиента.</p>';
      });
  }

  function closeClientDialog(root) {
    var dialog = root.querySelector("[data-messenger-client-dialog]");
    if (dialog) dialog.hidden = true;
  }

  function openPhotoDialog(root, thread) {
    var dialog = root.querySelector("[data-messenger-photo-dialog]");
    if (!dialog || !thread) return;
    var preview = dialog.querySelector("[data-messenger-photo-preview]");
    var title = dialog.querySelector("[data-messenger-photo-title]");
    var subtitle = dialog.querySelector("[data-messenger-photo-subtitle]");
    if (preview) preview.innerHTML = avatarMarkup(thread);
    if (title) title.textContent = thread.contact || "Контакт";
    if (subtitle) {
      subtitle.textContent =
        (thread.topic ? thread.topic + " · " : "") +
        (thread.presence_label || "Не в сети") +
        ". Фото хранится 5 дней; после этого UPOS сможет скачать его заново.";
    }
    dialog.hidden = false;
  }

  function closePhotoDialog(root) {
    var dialog = root.querySelector("[data-messenger-photo-dialog]");
    if (dialog) dialog.hidden = true;
  }

  function crmUrlForThread(thread) {
    var client = thread.client || thread.contact || "";
    var channel = thread.channel || "Telegram";
    var topic = thread.topic || thread.last_message || "";
    var title = "Сделка: " + (client || "новый клиент");
    var note = "Диалог из мессенджера";
    if (topic) note += ": " + topic;

    var params = new URLSearchParams();
    params.set("crm_open", "deal");
    params.set("crm_title", title);
    params.set("crm_client", client);
    params.set("crm_stage", "leads");
    params.set("crm_status", "new");
    params.set("crm_source", channel);
    params.set("crm_contact_type", channel === "Telegram" ? "Чат Telegram" : "Чат");
    params.set("crm_chat_ref", thread.username || thread.topic || thread.id || "");
    params.set("crm_note", note);
    return "/crm?" + params.toString() + "#tasks";
  }

  function boot(root) {
    var threads = readThreads().map(normalizeThread);
    var channelInput = document.querySelector("[data-messenger-channel-input]");
    var activeChannel = channelKey(channelInput && channelInput.value);
    var serverIds = {};
    threads.forEach(function (thread) {
      serverIds[String(thread.id)] = true;
      mergeStoredState(thread);
    });
    threads = threads.concat(loadStoredThreads(serverIds, activeChannel));

    var templates = readTemplates();
    var byId = {};
    threads.forEach(function (thread) {
      byId[String(thread.id)] = thread;
      ensureThreadListItem(root, thread);
    });

    function currentThread() {
      return byId[String(root.dataset.selectedThreadId || "")];
    }

    // Делегирование, а не обработчик на каждой строке: список обновляется
    // сам, и новые диалоги должны открываться без перезагрузки страницы.
    var listNode = root.querySelector("[data-messenger-thread-list]");
    if (listNode) {
      listNode.addEventListener("click", function (event) {
        var item = event.target.closest("[data-messenger-thread-id]");
        if (!item || !listNode.contains(item)) return;
        if (event.target.closest("[data-messenger-avatar-open]")) return;
        selectThread(root, byId[String(item.getAttribute("data-messenger-thread-id"))]);
        renderTemplatePicker();
      });
    }

    root.addEventListener("click", function (event) {
      var avatarTarget = event.target.closest("[data-messenger-avatar-open]");
      if (avatarTarget && root.contains(avatarTarget)) {
        var id = avatarTarget.getAttribute("data-messenger-avatar-open") || root.dataset.selectedThreadId || "";
        var thread = byId[String(id)];
        if (thread) openPhotoDialog(root, thread);
      }
      if (event.target.closest("[data-messenger-photo-close]")) {
        closePhotoDialog(root);
      }
      if (event.target.closest("[data-messenger-client-close]")) {
        closeClientDialog(root);
      }
    });

    // Двойной клик по шапке переписки открывает карточку собеседника.
    var chatTop = root.querySelector(".messenger-dialog-chat-top");
    if (chatTop) {
      chatTop.addEventListener("dblclick", function (event) {
        if (event.target.closest("button, a")) return;
        var thread = currentThread();
        if (thread) openClientDialog(root, thread);
      });
    }

    var clientOpen = root.querySelector("[data-messenger-client-open]");
    if (clientOpen) {
      clientOpen.addEventListener("click", function () {
        var thread = currentThread();
        if (thread) openClientDialog(root, thread);
      });
    }

    var initialId = "";
    try {
      initialId = window.localStorage ? window.localStorage.getItem(SELECTED_THREAD_KEY) || "" : "";
    } catch (err) {
      initialId = "";
    }
    var initialThread = byId[String(initialId)] || threads[0];
    if (initialThread) selectThread(root, initialThread);

    var sendToCrm = root.querySelector("[data-messenger-attach-client]");
    if (sendToCrm) {
      sendToCrm.addEventListener("click", function () {
        var current = currentThread();
        if (!current) return;
        rememberThread(current);
        window.location.assign(crmUrlForThread(current));
      });
    }

    var text = root.querySelector("[data-messenger-compose-text]");
    var send = root.querySelector("[data-messenger-send-button]");
    if (text && send) {
      send.addEventListener("click", function () {
        var current = currentThread();
        var value = String(text.value || "").trim();
        // Раньше кнопка молча ничего не делала, и выглядело это как поломка.
        if (!current) {
          showSendStatus(root, "Сначала выберите диалог в списке слева.", "error");
          return;
        }
        if (!value) {
          showSendStatus(root, "Введите текст сообщения.", "error");
          text.focus();
          return;
        }
        showSendStatus(root, "");

        // Telegram Business, чаты бота и Instagram Direct уходят клиенту
        // по-настоящему. Каналы без интеграции честно об этом сообщают:
        // раньше ответ появлялся в окне, но никуда не отправлялся.
        var isTelegram = current.source === "telegram_business" && current.chat_id;
        var isInstagram = current.source === "instagram" && current.thread_id;
        var isTelegramBot = current.source === "telegram_bot" && current.id;
        if (!isTelegram && !isInstagram && !isTelegramBot) {
          showSendStatus(
            root,
            "Канал «" +
              (current.channel || "") +
              "» ещё не подключён к отправке сообщений. Подключите его в разделе Настройки → Соцсети.",
            "error"
          );
          return;
        }
        showSendStatus(root, "Отправляем…", "pending");

        var csrfInput = document.querySelector('input[name="csrf_token"]');
        var csrfMeta = document.querySelector('meta[name="csrf-token"]');
        var csrf = csrfInput ? csrfInput.value : csrfMeta ? csrfMeta.content : "";
        send.disabled = true;
        var sendUrl = isInstagram
          ? "/api/messengers/instagram/send"
          : isTelegramBot
          ? "/api/messengers/telegram/send"
          : "/api/telegram/business/send";
        var sendBody = isInstagram
          ? { thread_id: current.thread_id, text: value }
          : isTelegramBot
          ? { thread_id: current.id, text: value }
          : { chat_id: current.chat_id, text: value };
        fetch(sendUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          },
          body: JSON.stringify(sendBody),
        })
          .then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
              if (!response.ok || !payload.ok) throw new Error(payload.error || "Не удалось отправить");
              return payload;
            });
          })
          .then(function (payload) {
            // Instagram возвращает ленту целиком — берём её, чтобы порядок и
            // отметки совпадали с сохранённой перепиской.
            if (isInstagram && Array.isArray(payload && payload.messages)) {
              current.messages = payload.messages.map(function (message) {
                return {
                  author: String(message.author || current.contact || "Instagram"),
                  text: String(message.text || ""),
                  kind: String(message.direction || "") === "out" ? "out" : "in",
                  created_at: String(message.sent_at || ""),
                };
              });
            } else {
              current.messages = threadMessages(current).slice();
              current.messages.push({ author: "Вы", text: value, kind: "out", created_at: new Date().toISOString() });
            }
            text.value = "";
            rememberThread(current);
            renderMessages(root, current);
            showSendStatus(root, "Сообщение отправлено клиенту.", "ok");
          })
          .catch(function (error) {
            showSendStatus(root, sendErrorText(error.message), "error");
          })
          .then(function () {
            send.disabled = false;
          });
      });
    }

    var templateButton = root.querySelector("[data-messenger-template-button]");
    var templatePicker = root.querySelector("[data-messenger-template-picker]");
    function renderTemplatePicker() {
      if (!templatePicker || !text) return;
      var current = currentThread();
      var activeChannel = channelKey(current && current.channel);
      var scopedTemplates = activeChannel
        ? templates.filter(function (template) {
            return channelKey(template.channel) === activeChannel;
          })
        : templates.slice();
      if (!scopedTemplates.length) scopedTemplates = templates.slice();
      templatePicker.innerHTML = "";
      if (scopedTemplates.length) {
        scopedTemplates.forEach(function (template) {
          var item = document.createElement("button");
          item.type = "button";
          item.className = "messenger-template-choice";
          item.innerHTML =
            "<strong>" +
            escapeHtml(template.title || "Шаблон") +
            "</strong><small>" +
            escapeHtml(template.preview || template.text || "") +
            "</small>";
          item.addEventListener("click", function () {
            text.value = template.text || template.preview || "";
            templatePicker.hidden = true;
            text.focus();
          });
          templatePicker.appendChild(item);
        });
      } else {
        templatePicker.innerHTML = '<div class="messenger-empty">Для этого канала пока нет шаблонов.</div>';
      }
    }
    if (templateButton && templatePicker && text) {
      renderTemplatePicker();
      templateButton.addEventListener("click", function () {
        renderTemplatePicker();
        templatePicker.hidden = !templatePicker.hidden;
      });
      document.addEventListener("click", function (event) {
        if (templatePicker.hidden) return;
        if (templatePicker.contains(event.target) || templateButton.contains(event.target)) return;
        templatePicker.hidden = true;
      });
    }

    var dialogSearch = root.querySelector("[data-messenger-dialog-search]");
    var visibleCount = root.querySelector("[data-messenger-dialog-visible-count]");
    var searchEmpty = root.querySelector("[data-messenger-dialog-search-empty]");
    if (dialogSearch) {
      dialogSearch.addEventListener("input", function () {
        var query = String(dialogSearch.value || "").trim().toLowerCase();
        var firstVisible = null;
        var visible = 0;
        root.querySelectorAll("[data-messenger-thread-id]").forEach(function (item) {
          var haystack = String(item.getAttribute("data-messenger-search") || item.textContent || "").toLowerCase();
          var match = !query || haystack.indexOf(query) !== -1;
          item.hidden = !match;
          if (match) {
            visible += 1;
            if (!firstVisible) firstVisible = item;
          }
        });
        if (visibleCount) visibleCount.textContent = String(visible);
        if (searchEmpty) searchEmpty.hidden = visible > 0;
        var active = root.querySelector("[data-messenger-thread-id].active");
        if (query && active && active.hidden && firstVisible) {
          selectThread(root, byId[String(firstVisible.getAttribute("data-messenger-thread-id"))]);
        }
      });
    }

    // Окно переписки обновляется само: новые сообщения приходят от клиента
    // в любой момент, а сотрудник не должен обновлять страницу руками.
    var refreshing = false;
    function refreshThreads() {
      if (refreshing || document.hidden) return;
      refreshing = true;
      window
        .fetch("/api/messengers/threads?channel=" + encodeURIComponent(activeChannel || ""), {
          credentials: "same-origin",
        })
        .then(function (response) {
          return response.json().catch(function () { return {}; });
        })
        .then(function (payload) {
          if (!payload || !Array.isArray(payload.threads)) return;
          var selectedId = String(root.dataset.selectedThreadId || "");
          payload.threads.forEach(function (raw) {
            var incoming = normalizeThread(raw);
            var id = String(incoming.id || "");
            if (!id) return;
            var existing = byId[id];
            if (!existing) {
              byId[id] = incoming;
              ensureThreadListItem(root, incoming);
              updateThreadListItem(root, incoming);
              rememberThread(incoming);
              return;
            }
            var before = threadMessages(existing).length;
            var fresh = threadMessages(incoming);
            existing.messages = fresh;
            existing.contact = incoming.contact || existing.contact;
            existing.last_message = incoming.last_message;
            existing.topic = incoming.topic || existing.topic;
            existing.status = incoming.status;
            existing.status_label = incoming.status_label;
            existing.presence = incoming.presence;
            existing.presence_label = incoming.presence_label;
            existing.time_label = incoming.time_label;
            existing.unread = incoming.unread;
            existing.client = incoming.client || existing.client;
            updateThreadListItem(root, existing);
            rememberThread(existing);
            if (id === selectedId && fresh.length !== before) {
              renderMessages(root, existing);
              updateThreadHeader(root, existing);
            }
          });
        })
        .catch(function () {
          /* сеть моргнула — попробуем на следующем круге */
        })
        .then(function () {
          refreshing = false;
        });
    }

    window.setInterval(refreshThreads, 12000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refreshThreads();
    });
  }

  function initChannelTabs() {
    document.querySelectorAll("[data-messenger-channel-form]").forEach(function (form) {
      var input = form.querySelector("[data-messenger-channel-input]");
      form.querySelectorAll("[data-messenger-channel-choice]").forEach(function (button) {
        button.addEventListener("click", function () {
          if (input) input.value = button.getAttribute("data-messenger-channel-choice") || "";
          form.querySelectorAll("[data-messenger-channel-choice]").forEach(function (item) {
            var active = item === button;
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", active ? "true" : "false");
          });
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
          } else {
            form.submit();
          }
        });
      });
    });
  }

  function start() {
    document.querySelectorAll("[data-messenger-inbox]").forEach(boot);
    initChannelTabs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
