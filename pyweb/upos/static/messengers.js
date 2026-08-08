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

  function messageKey(message) {
    return String((message && message.kind) || "") + "\u0000" + String((message && message.text) || "");
  }

  function mergeThreadMessages(local, incoming) {
    /* Сервер — источник правды по доставленным сообщениям, но только что
       отправленное ещё не успело до него доехать. Раньше ответ сервера
       затирал переписку целиком, и свежие реплики пропадали на глазах.
       Поэтому держим их локально, пока сервер их не подтвердит. */
    if (!incoming.length) return local.slice();
    var pending = local.filter(function (message) {
      return message && message.pending;
    });
    if (!pending.length) return incoming.slice();
    var keys = incoming.map(messageKey);
    var merged = incoming.slice();
    pending.forEach(function (message) {
      var at = keys.indexOf(messageKey(message));
      if (at !== -1) {
        // Сервер уже знает это сообщение — второй раз не показываем.
        keys[at] = "\u0000matched";
        return;
      }
      merged.push(message);
    });
    return merged;
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
      telegram_url: thread.telegram_url || "",
      messages: threadMessages(thread).slice(-200),
    };
    // Кеш переписки не укорачиваем: сервер мог ответить обрезанным списком
    // (или вовсе заглушкой), и раньше это стирало историю насовсем.
    var stored = readJsonStorage(storageKey(thread.id), null);
    var storedMessages = stored && Array.isArray(stored.messages) ? stored.messages : [];
    if (storedMessages.length > payload.messages.length) {
      payload.messages = storedMessages;
    }
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
        // Файл в UPOS не хранится, поэтому вложение — подписанная ссылка,
        // которая открывает этот же диалог в Telegram.
        var attachmentLabel = String(message.attachment_label || "");
        var attachmentUrl = String(message.attachment_url || thread.telegram_url || "");
        var attachment = "";
        if (attachmentLabel || message.attachment_url) {
          var label = attachmentLabel || "Вложение";
          attachment = attachmentUrl
            ? '<a class="messenger-message-attachment" href="' + escapeHtml(attachmentUrl) +
              '" target="_blank" rel="noopener" title="Открыть переписку в Telegram">' +
              escapeHtml(label) + "</a>"
            : '<span class="messenger-message-attachment">' + escapeHtml(label) + "</span>";
        }
        // Отправленный клиенту заказ показываем карточкой: видно номер,
        // сумму и чем открыть — накладной или самим документом.
        var sale = message.sale_document && message.sale_document.id ? message.sale_document : null;
        var saleCard = sale
          ? '<span class="messenger-message-sale">' +
            '<span class="messenger-message-sale-head">' +
            escapeHtml((sale.title || "Документ") + " " + (sale.number || "")) +
            "</span>" +
            (Number(sale.amount || 0)
              ? '<span class="messenger-message-sale-sum">' + moneyText(sale.amount, sale.currency) + "</span>"
              : "") +
            '<a class="messenger-message-sale-link" href="/api/sales/' + escapeHtml(sale.id) +
            '/invoice.pdf" target="_blank" rel="noopener">Открыть накладную</a>' +
            "</span>"
          : "";
        var body = String(message.text || "");
        if (sale && attachment) attachment = "";
        return (
          '<div class="messenger-thread-message messenger-thread-message--' +
          escapeHtml(kind) +
          '"><strong>' +
          escapeHtml(message.author || (kind === "out" ? "Вы" : thread.contact || thread.channel)) +
          "</strong>" +
          (body && !saleCard ? "<span>" + escapeHtml(body) + "</span>" : "") +
          saleCard +
          attachment +
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
      // Подпись статуса убрана: «Активный» стоял почти у всех диалогов и
      // ничего не сообщал — время и счётчик непрочитанных полезнее.
      '</small></span><span class="messenger-dialog-side">' +
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
    // Старую подпись статуса убираем и у диалогов, отрисованных шаблоном.
    item.querySelectorAll(".messenger-dialog-side em").forEach(function (node) {
      node.remove();
    });

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

  /** Итог оформления заказа: подтверждение и кнопка отправки накладной. */
  function showOrderCreated(root, saleId) {
    var box = root.querySelector("[data-messenger-order-created]");
    if (!box) {
      showSendStatus(root, "Заказ оформлен. Он появится в карточке клиента.", "ok");
      return;
    }
    var label = box.querySelector("[data-messenger-order-created-text]");
    if (label) {
      label.textContent = saleId
        ? "Заказ оформлен и добавлен в карточку клиента."
        : "Заказ оформлен.";
    }
    box.dataset.saleId = saleId || "";
    var invoiceButton = box.querySelector("[data-messenger-order-invoice]");
    if (invoiceButton) {
      // Без номера документа отправлять нечего: у формы не было saved_id.
      invoiceButton.hidden = !saleId;
      invoiceButton.disabled = false;
      invoiceButton.textContent = "Отправить накладную клиенту";
    }
    box.hidden = false;
    showSendStatus(root, "");
  }

  function hideOrderCreated(root) {
    var box = root.querySelector("[data-messenger-order-created]");
    if (box) {
      box.hidden = true;
      box.dataset.saleId = "";
    }
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

  // Разделы карточки клиента повторяют журнал продаж: тот же порядок, те же
  // значки и та же логика отбора — «Рассрочки» смотрят на состояние оплаты,
  // «Архив» на статус, остальные вкладки на тип документа.
  var CLIENT_DOC_TABS = [
    { key: "", label: "Все", logo: "ВС", brand: "all" },
    { key: "order", label: "Заказы", logo: "ЗК", brand: "order" },
    { key: "sale", label: "Продажи", logo: "ПР", brand: "sale" },
    { key: "partial", label: "Рассрочки", logo: "РС", brand: "installment" },
    { key: "return", label: "Возвраты", logo: "ВЗ", brand: "return" },
    { key: "archived", label: "Архив", logo: "АР", brand: "archive" },
  ];

  var CLIENT_DOC_TYPE_FILTERS = [
    { value: "order", label: "Заказ" },
    { value: "sale", label: "Продажа" },
    { value: "return", label: "Возврат" },
  ];

  var CLIENT_PAYMENT_FILTERS = [
    { value: "paid", label: "Оплачен" },
    { value: "partial", label: "Частично" },
    { value: "unpaid", label: "Не оплачен" },
  ];

  function docType(doc) {
    return String(doc.doc_type || doc.group || "sale");
  }

  function docMatchesTab(doc, key) {
    if (!key) return true;
    if (key === "partial") return String(doc.payment_status || "") === "partial";
    if (key === "archived") return String(doc.status_key || "") === "archived";
    return docType(doc) === key;
  }

  function rowMatchesTab(row, key) {
    if (!key) return true;
    if (key === "partial") return row.getAttribute("data-doc-payment") === "partial";
    if (key === "archived") return row.getAttribute("data-doc-status") === "archived";
    return row.getAttribute("data-doc-type") === key;
  }

  // Цвет статуса считаем по тем же правилам, что и шапка журнала продаж.
  function docStatusStyle(doc) {
    var status = String(doc.status_key || "");
    if (docType(doc) === "return") return "rejected";
    if (status === "completed" || status === "archived") return "confirmed";
    if (status === "shipped" || status === "installation") return "pending";
    return "draft";
  }

  function amountNumber(value) {
    var raw = String(value == null ? "" : value)
      .replace(/[\s ]/g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    var number = Number(raw);
    return isFinite(number) ? number : 0;
  }

  function clientSortValue(row, columnIndex, kind) {
    var cell = row.cells[columnIndex];
    if (!cell) return kind === "text" ? "" : 0;
    var raw = cell.dataset.sortValue || cell.textContent || "";
    if (kind === "number") return amountNumber(raw);
    if (kind === "date") {
      var timestamp = Date.parse(String(raw).trim());
      return isFinite(timestamp) ? timestamp : 0;
    }
    return String(raw).trim().toLocaleLowerCase("ru-RU");
  }

  function activateClientView(box, view) {
    box.querySelectorAll("[data-client-view]").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-client-view") === view);
    });
    var journal = box.querySelector("[data-messenger-client-journal]");
    var docView = box.querySelector("[data-messenger-client-doc-view]");
    if (journal) journal.hidden = view !== "journal";
    if (docView) docView.hidden = view === "journal";
  }

  function bindClientViewTabs(box) {
    var strip = box.querySelector("[data-messenger-client-views]");
    if (!strip) return;
    strip.addEventListener("click", function (event) {
      var close = event.target.closest("[data-client-view-close]");
      if (close) {
        event.stopPropagation();
        var holder = close.closest("[data-client-view]");
        var wasActive = holder && holder.classList.contains("active");
        if (holder) holder.remove();
        var docView = box.querySelector("[data-messenger-client-doc-view]");
        if (docView) docView.innerHTML = "";
        if (wasActive || !strip.querySelector('[data-client-view]:not([data-client-view="journal"])')) {
          activateClientView(box, "journal");
        }
        return;
      }
      var tab = event.target.closest("[data-client-view]");
      if (!tab) return;
      var view = tab.getAttribute("data-client-view") || "journal";
      if (view !== "journal") {
        openClientDocumentTab(box, view, tab.dataset.docLabel || "");
        return;
      }
      activateClientView(box, "journal");
    });
  }

  function documentTable(document_) {
    var lines = Array.isArray(document_.lines) ? document_.lines : [];
    if (!lines.length) return '<p class="messenger-empty">В документе нет позиций.</p>';
    return (
      '<div class="products-table-wrap products-table-wrap--catalog org-ops-table-wrap org-ops-table-wrap--excel messenger-client-table-wrap">' +
      '<table class="products-table products-catalog-table sales-table sales-journal-table">' +
      "<thead><tr><th>№</th><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>" +
      lines
        .map(function (line, index) {
          return (
            '<tr><td class="sales-journal-row-index">' + (index + 1) + "</td>" +
            "<td>" + escapeHtml(line.product || "") + "</td>" +
            "<td>" + escapeHtml(line.quantity || "0") + "</td>" +
            "<td>" + moneyText(line.price, document_.currency) + "</td>" +
            "<td>" + moneyText(line.total, document_.currency) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function paymentsTable(document_) {
    var payments = Array.isArray(document_.payments) ? document_.payments : [];
    if (!payments.length) return '<p class="messenger-empty">Оплат по документу нет.</p>';
    var total = payments.reduce(function (sum, payment) {
      return sum + amountNumber(payment.amount);
    }, 0);
    return (
      '<div class="products-table-wrap products-table-wrap--catalog org-ops-table-wrap org-ops-table-wrap--excel messenger-client-table-wrap">' +
      '<table class="products-table products-catalog-table sales-table sales-journal-table">' +
      "<thead><tr><th>№</th><th>Счёт</th><th>Способ</th><th>Дата</th><th>Сумма</th></tr></thead><tbody>" +
      payments
        .map(function (payment, index) {
          return (
            '<tr><td class="sales-journal-row-index">' + (index + 1) + "</td>" +
            "<td>" + escapeHtml(payment.account || "-") + "</td>" +
            "<td>" + escapeHtml(payment.type || "-") + "</td>" +
            "<td>" + escapeHtml(payment.date || "-") + "</td>" +
            "<td>" + moneyText(payment.amount, payment.currency || document_.currency) + "</td></tr>"
          );
        })
        .join("") +
      '<tr class="messenger-client-doc-total"><td></td><td colspan="3">Итого оплачено</td><td>' +
      moneyText(total, document_.currency) +
      "</td></tr>" +
      "</tbody></table></div>"
    );
  }

  function renderClientDocument(box, document_) {
    var view = box.querySelector("[data-messenger-client-doc-view]");
    if (!view) return;
    var facts = [
      ["Дата", document_.date || "-"],
      ["Статус", document_.status || "-"],
      ["Клиент", document_.client || "-"],
      ["Сумма", moneyText(document_.amount, document_.currency)],
      ["Оплачено", moneyText(document_.paid, document_.currency)],
      ["Долг", moneyText(document_.debt, document_.currency)],
    ];
    view.innerHTML =
      '<header class="products-panel-head sales-journal-head messenger-client-journal-head">' +
      '<div class="products-panel-title"><h2>' +
      escapeHtml((document_.title || "Документ") + " " + (document_.number || "")) +
      "</h2><span>" + escapeHtml(document_.organization || "") + "</span></div>" +
      '<a class="btn sales-journal-create-btn" href="/api/sales/' + escapeHtml(document_.document_id || "") +
      '/invoice.pdf" target="_blank" rel="noopener">Накладная PDF</a>' +
      "</header>" +
      '<div class="messenger-client-facts messenger-client-doc-facts">' +
      facts
        .map(function (pair) {
          return "<span>" + escapeHtml(pair[0]) + ": <b>" + escapeHtml(pair[1]) + "</b></span>";
        })
        .join("") +
      "</div>" +
      '<h4 class="messenger-client-doc-subtitle">Позиции</h4>' +
      documentTable(document_) +
      '<h4 class="messenger-client-doc-subtitle">Оплаты</h4>' +
      paymentsTable(document_) +
      (document_.note ? '<p class="messenger-client-note">' + escapeHtml(document_.note) + "</p>" : "");
  }

  /** Открывает документ вкладкой рядом с журналом, не уходя из переписки. */
  function openClientDocumentTab(box, documentId, label) {
    if (!documentId) return;
    var strip = box.querySelector("[data-messenger-client-views]");
    var view = box.querySelector("[data-messenger-client-doc-view]");
    if (!strip || !view) return;
    var tab = strip.querySelector('[data-client-view="' + documentId.replace(/"/g, "") + '"]');
    if (!tab) {
      tab = document.createElement("span");
      tab.className = "general-module-tab general-module-tab--report";
      tab.setAttribute("data-client-view", documentId);
      tab.dataset.docLabel = label || "Документ";
      tab.innerHTML =
        '<button type="button" class="general-module-tab-activate">' + escapeHtml(label || "Документ") + "</button>" +
        '<button type="button" class="general-module-tab-close" data-client-view-close aria-label="Закрыть вкладку">×</button>';
      strip.appendChild(tab);
    }
    activateClientView(box, documentId);
    view.innerHTML = '<p class="messenger-empty">Загружаем документ…</p>';
    window
      .fetch("/api/sales/" + encodeURIComponent(documentId) + "/document", { credentials: "same-origin" })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok || !body.ok || !body.document) throw new Error(body.error || "Документ недоступен");
          return body.document;
        });
      })
      .then(function (payload) {
        renderClientDocument(box, payload);
      })
      .catch(function (error) {
        view.innerHTML =
          '<p class="messenger-client-note messenger-client-note--error">' +
          escapeHtml(error.message || "Не удалось открыть документ") +
          "</p>";
      });
  }

  /** Вкладки, фильтры и сортировка карточки клиента — как в журнале продаж. */
  function bindClientJournal(scope) {
    var body = scope.querySelector("[data-messenger-client-table] tbody");
    if (!body) return;
    var rows = Array.from(body.querySelectorAll("[data-messenger-client-row]"));
    var counter = scope.querySelector("[data-messenger-client-count]");
    var search = scope.querySelector("[data-client-doc-search]");
    var typeSelect = scope.querySelector("[data-client-doc-type]");
    var paymentSelect = scope.querySelector("[data-client-doc-payment]");
    var statusSelect = scope.querySelector("[data-client-doc-status]");
    var state = { tab: "", q: "", type: "", payment: "", status: "" };

    rows.forEach(function (row, index) {
      row.dataset.clientOriginalIndex = String(index);
    });

    function applyFilters() {
      var query = state.q.trim().toLocaleLowerCase("ru-RU");
      var shown = 0;
      rows.forEach(function (row) {
        var visible =
          rowMatchesTab(row, state.tab) &&
          (!state.type || row.getAttribute("data-doc-type") === state.type) &&
          (!state.payment || row.getAttribute("data-doc-payment") === state.payment) &&
          (!state.status || row.getAttribute("data-doc-status-label") === state.status) &&
          (!query || row.textContent.toLocaleLowerCase("ru-RU").indexOf(query) !== -1);
        row.hidden = !visible;
        if (!visible) return;
        shown += 1;
        var indexCell = row.querySelector(".sales-journal-row-index");
        if (indexCell) indexCell.textContent = String(shown);
      });
      if (counter) counter.textContent = "Всего: " + shown;
    }

    scope.querySelectorAll("[data-client-group]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        state.tab = tab.getAttribute("data-client-group") || "";
        scope.querySelectorAll("[data-client-group]").forEach(function (node) {
          node.classList.toggle("active", node === tab);
          if (node === tab) node.setAttribute("aria-current", "page");
          else node.removeAttribute("aria-current");
        });
        applyFilters();
      });
    });

    var filterForm = scope.querySelector("[data-messenger-client-filter]");
    if (filterForm) {
      filterForm.addEventListener("submit", function (event) {
        event.preventDefault();
      });
    }
    if (search) {
      search.addEventListener("input", function () {
        state.q = search.value || "";
        applyFilters();
      });
    }
    [
      [typeSelect, "type"],
      [paymentSelect, "payment"],
      [statusSelect, "status"],
    ].forEach(function (pair) {
      var node = pair[0];
      if (!node) return;
      node.addEventListener("change", function () {
        state[pair[1]] = node.value || "";
        applyFilters();
      });
    });

    var table = scope.querySelector("[data-messenger-client-table]");
    var numericColumns = new Set([5, 6, 7]);
    var dateColumns = new Set([2]);
    scope.querySelectorAll("thead .messenger-client-sort-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        var header = button.closest("th");
        if (!header || !table) return;
        var columnIndex = header.cellIndex;
        var kind =
          header.dataset.sortKind ||
          (numericColumns.has(columnIndex) ? "number" : dateColumns.has(columnIndex) ? "date" : "text");
        var direction = header.getAttribute("aria-sort") === "descending" ? "ascending" : "descending";

        rows.sort(function (left, right) {
          var leftValue = clientSortValue(left, columnIndex, kind);
          var rightValue = clientSortValue(right, columnIndex, kind);
          var result =
            kind === "text"
              ? leftValue.localeCompare(rightValue, "ru-RU", { numeric: true, sensitivity: "base" })
              : leftValue - rightValue;
          if (result === 0) {
            result = Number(left.dataset.clientOriginalIndex) - Number(right.dataset.clientOriginalIndex);
          }
          return direction === "ascending" ? result : -result;
        });

        table.querySelectorAll("thead th[aria-sort]").forEach(function (item) {
          item.setAttribute("aria-sort", item === header ? direction : "none");
          var arrow = item.querySelector(".org-shipments-sort-arrow");
          if (arrow) arrow.textContent = item === header ? (direction === "ascending" ? "↑" : "↓") : "↕";
        });
        rows.forEach(function (row) {
          body.appendChild(row);
        });
        applyFilters();
      });
    });

    applyFilters();
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

    var tabs =
      '<nav class="messenger-channel-tabs sales-document-tabs messenger-client-doc-tabs" aria-label="Разделы документов клиента">' +
      '<span class="sales-document-tabs-title">Разделы клиента</span>' +
      CLIENT_DOC_TABS.map(function (tab) {
        var count = docs.filter(function (doc) {
          return docMatchesTab(doc, tab.key);
        }).length;
        return (
          '<button type="button" class="messenger-channel-tab sales-document-tab' +
          (tab.key === "" ? " active" : "") +
          '" data-channel-brand="' + tab.brand + '" data-client-group="' + tab.key + '"' +
          (tab.key === "" ? ' aria-current="page"' : "") + ">" +
          '<span class="messenger-channel-logo" aria-hidden="true">' + tab.logo + "</span>" +
          '<span class="messenger-channel-label">' + escapeHtml(tab.label) + "</span>" +
          "<b>" + count + "</b></button>"
        );
      }).join("") +
      "</nav>";

    var statusLabels = [];
    docs.forEach(function (doc) {
      var label = String(doc.status || "").trim();
      if (label && statusLabels.indexOf(label) === -1) statusLabels.push(label);
    });

    function selectField(label, attribute, options) {
      return (
        '<label class="sales-journal-filter-field"><span>' + escapeHtml(label) + "</span>" +
        '<select class="messenger-client-filter-select" ' + attribute + '><option value="">Все</option>' +
        options
          .map(function (option) {
            return '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + "</option>";
          })
          .join("") +
        "</select></label>"
      );
    }

    var filterBar =
      '<form class="products-catalog-filter sales-filter-bar sales-journal-filter messenger-client-journal-filter" data-messenger-client-filter>' +
      '<label class="products-catalog-search sales-journal-filter-field sales-journal-filter-search">' +
      "<span>Поиск</span>" +
      '<input type="search" data-client-doc-search placeholder="Номер, склад, статус" />' +
      "</label>" +
      selectField("Тип документа", "data-client-doc-type", CLIENT_DOC_TYPE_FILTERS) +
      selectField("Оплата", "data-client-doc-payment", CLIENT_PAYMENT_FILTERS) +
      selectField(
        "Статус",
        "data-client-doc-status",
        statusLabels.map(function (label) {
          return { value: label, label: label };
        })
      ) +
      "</form>";

    var journalHead =
      '<header class="products-panel-head sales-journal-head messenger-client-journal-head">' +
      '<div class="products-panel-title"><h2>Заказы и история</h2>' +
      '<span data-messenger-client-count>Всего: ' + docs.length + "</span></div>" +
      filterBar +
      "</header>";

    function sortHead(label, kind) {
      return (
        '<th data-column-label="' + escapeHtml(label) + '"' +
        (kind ? ' data-sort-kind="' + kind + '"' : "") + ' aria-sort="none">' +
        '<button type="button" class="org-shipments-sort-btn products-sort-btn sales-journal-sort-btn messenger-client-sort-btn">' +
        "<span>" + escapeHtml(label) + '</span><span class="org-shipments-sort-arrow" aria-hidden="true">&#8597;</span>' +
        "</button></th>"
      );
    }

    var tableRows = docs
      .map(function (doc, index) {
        var type = docType(doc);
        var progress = Math.max(0, Math.min(100, Number(doc.payment_progress || 0)));
        var hasDebt = doc.has_debt != null ? Boolean(doc.has_debt) : amountNumber(doc.debt) > 0;
        return (
          '<tr class="sales-table-row--' + escapeHtml(type) + '" data-messenger-client-row' +
          ' data-doc-group="' + escapeHtml(String(doc.group || type)) + '"' +
          ' data-doc-type="' + escapeHtml(type) + '"' +
          ' data-doc-payment="' + escapeHtml(String(doc.payment_status || "")) + '"' +
          ' data-doc-status="' + escapeHtml(String(doc.status_key || "")) + '"' +
          ' data-doc-status-label="' + escapeHtml(String(doc.status || "")) + '">' +
          '<td class="sales-journal-row-index">' + (index + 1) + "</td>" +
          '<td class="sales-journal-id-cell" data-sort-value="' + escapeHtml(doc.number || "") + '"' +
          ' data-doc-open="' + escapeHtml(doc.id || "") + '"' +
          ' data-doc-label="' + escapeHtml((doc.doc_type_label || doc.kind || "Документ") + " " + (doc.number || "")) + '"' +
          ' role="button" tabindex="0" title="Открыть вкладкой">' +
          "<strong>" + escapeHtml(doc.number || "") + "</strong>" +
          "<small>" + escapeHtml(doc.manager || "Без ответственного") + "</small></td>" +
          '<td data-sort-value="' + escapeHtml(doc.date || "") + '">' + escapeHtml(doc.date || "-") + "</td>" +
          '<td class="sales-journal-doc-type-cell">' + escapeHtml(doc.doc_type_label || doc.kind || "") + "</td>" +
          "<td>" + escapeHtml(doc.warehouse || "-") + "</td>" +
          '<td data-sort-value="' + amountNumber(doc.amount) + '">' + moneyText(doc.amount, doc.currency) + "</td>" +
          '<td class="sales-journal-payment-progress" data-payment-progress="' + progress + '"' +
          ' data-sort-value="' + amountNumber(doc.paid) + '"' +
          ' style="--sales-payment-progress: ' + progress + '%;" title="Оплачено: ' + progress + '%">' +
          "<span>" + moneyText(doc.paid, doc.currency) + "</span></td>" +
          '<td class="sales-journal-debt-cell' + (hasDebt ? " has-debt" : "") + '"' +
          ' data-sort-value="' + amountNumber(doc.debt) + '">' +
          (hasDebt
            ? '<span class="sales-journal-debt-badge"><span class="sales-journal-debt-amount">-' +
              moneyText(doc.debt, doc.currency) + "</span></span>"
            : '<span class="sales-journal-no-debt">-</span>') +
          "</td>" +
          '<td><span class="kassa-status-select kassa-status-select--' + docStatusStyle(doc) +
          ' messenger-client-status">' + escapeHtml(doc.status || "") + "</span></td>" +
          '<td class="products-row-actions messenger-client-docs-actions">' +
          '<a class="messenger-client-doc-link" href="/api/sales/' + escapeHtml(doc.id || "") +
          '/invoice.pdf" target="_blank" rel="noopener">PDF</a>' +
          '<button type="button" class="messenger-client-doc-send" data-send-invoice="' +
          escapeHtml(doc.id || "") + '">Отправить</button>' +
          "</td></tr>"
        );
      })
      .join("");

    // Заказ открывается вкладкой прямо здесь: уводить со страницы посреди
    // переписки нельзя — оператор терял диалог.
    var cardTabs =
      '<nav class="general-module-tabs messenger-client-doc-views" data-messenger-client-views>' +
      '<button type="button" class="general-module-tab general-module-tab--report active"' +
      ' data-client-view="journal"><span class="general-module-tab-activate">Заказы и история</span></button>' +
      "</nav>";

    var history = docs.length
      ? journalHead + tabs +
        '<div class="products-table-wrap products-table-wrap--catalog org-ops-table-wrap org-ops-table-wrap--excel messenger-client-table-wrap">' +
        '<table class="products-table products-catalog-table sales-table sales-journal-table messenger-client-journal-table"' +
        ' id="messenger-client-journal-table" data-messenger-client-table data-upos-column-controls>' +
        "<thead><tr>" +
        '<th data-column-label="№">№</th>' +
        sortHead("ID") +
        sortHead("Дата", "date") +
        sortHead("Тип") +
        sortHead("Склад") +
        sortHead("Сумма", "number") +
        sortHead("Оплачено", "number") +
        sortHead("Долг", "number") +
        sortHead("Статус") +
        '<th data-column-label="Действия" class="products-actions-head"></th>' +
        "</tr></thead><tbody>" + tableRows + "</tbody></table></div>"
      : journalHead + tabs + '<p class="messenger-empty">Заказов и продаж пока нет.</p>';

    box.innerHTML =
      '<div class="messenger-client-head">' + head + "</div>" + form +
      cardTabs +
      '<section class="messenger-client-journal" data-messenger-client-journal>' + history + "</section>" +
      '<section class="messenger-client-doc-view" data-messenger-client-doc-view hidden></section>' +
      '<p class="messenger-client-note" data-messenger-invoice-status hidden></p>';

    box.querySelectorAll("[data-doc-open]").forEach(function (cell) {
      function open() {
        openClientDocumentTab(box, cell.getAttribute("data-doc-open") || "", cell.getAttribute("data-doc-label") || "");
      }
      cell.addEventListener("click", open);
      cell.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
    });

    bindClientViewTabs(box);

    var journalNode = box.querySelector("[data-messenger-client-journal]");
    if (journalNode) bindClientJournal(journalNode);

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

    // Оформление заказа как в CRM: полная форма продажи в модальном окне,
    // клиент подставляется из переписки — оператор не уходит из диалога.
    var orderButton = root.querySelector("[data-messenger-order-button]");
    var orderDialog = document.querySelector("[data-messenger-order-dialog]");
    var orderFrame = orderDialog ? orderDialog.querySelector("[data-messenger-order-dialog-frame]") : null;

    function closeOrderDialog() {
      if (!orderDialog) return;
      if (orderDialog.open && typeof orderDialog.close === "function") orderDialog.close();
      else orderDialog.removeAttribute("open");
      if (orderFrame) orderFrame.src = "about:blank";
    }

    if (orderButton && orderDialog && orderFrame) {
      orderButton.addEventListener("click", function () {
        var current = currentThread();
        if (!current) {
          showSendStatus(root, "Сначала выберите диалог в списке слева.", "error");
          return;
        }
        var clientName = String(current.client || current.contact || "").trim();
        var url = new URL("/sales", window.location.origin);
        url.searchParams.set("embed", "1");
        url.searchParams.set("doc_type", "order");
        if (clientName) url.searchParams.set("client", clientName);
        url.hash = "sales-form";
        var caption = orderDialog.querySelector("[data-messenger-order-dialog-client]");
        if (caption) caption.textContent = clientName ? "Клиент: " + clientName : "Полная форма заказа";
        orderFrame.src = url.toString();
        if (typeof orderDialog.showModal === "function") orderDialog.showModal();
        else orderDialog.setAttribute("open", "");
      });

      orderDialog.querySelectorAll("[data-messenger-order-dialog-close]").forEach(function (button) {
        button.addEventListener("click", closeOrderDialog);
      });
      orderDialog.addEventListener("cancel", function (event) {
        event.preventDefault();
        closeOrderDialog();
      });
      orderDialog.addEventListener("click", function (event) {
        if (event.target === orderDialog) closeOrderDialog();
      });
      window.addEventListener("message", function (event) {
        if (event.origin !== window.location.origin || event.source !== orderFrame.contentWindow) return;
        if (!event.data || typeof event.data.type !== "string") return;
        if (event.data.type === "upos:sales-order-cancel") {
          closeOrderDialog();
          return;
        }
        if (event.data.type === "upos:sales-order-saved") {
          // Страницу не перезагружаем: оператор потерял бы открытый диалог.
          closeOrderDialog();
          showOrderCreated(root, String(event.data.saleId || ""));
        }
      });
    }

    var orderCreatedBox = root.querySelector("[data-messenger-order-created]");
    if (orderCreatedBox) {
      orderCreatedBox.querySelector("[data-messenger-order-created-close]")?.addEventListener("click", function () {
        hideOrderCreated(root);
      });
      var invoiceButton = orderCreatedBox.querySelector("[data-messenger-order-invoice]");
      invoiceButton?.addEventListener("click", function () {
        var current = currentThread();
        var saleId = orderCreatedBox.dataset.saleId || "";
        if (!current || !saleId) return;
        invoiceButton.disabled = true;
        invoiceButton.textContent = "Отправляем…";
        window
          .fetch("/api/messengers/threads/" + encodeURIComponent(current.id) + "/invoice", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
            body: JSON.stringify({ document_id: saleId }),
          })
          .then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
              if (!response.ok || !body.ok) throw new Error(body.error || "Не удалось отправить накладную");
              return body;
            });
          })
          .then(function (body) {
            hideOrderCreated(root);
            showSendStatus(root, "Накладная отправлена клиенту: " + (body.caption || ""), "ok");
          })
          .catch(function (error) {
            invoiceButton.disabled = false;
            invoiceButton.textContent = "Отправить накладную клиенту";
            showSendStatus(root, sendErrorText(error.message), "error");
          });
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
              // pending — сообщение уже ушло клиенту, но в ответе сервера
              // появится только на следующем круге обновления.
              current.messages.push({
                author: root.dataset.messengerAuthor || "Вы",
                text: value,
                kind: "out",
                created_at: new Date().toISOString(),
                pending: true,
              });
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
            // Сравниваем состав, а не длину: подтверждение отправленного
            // сообщения её не меняет, но перерисовать переписку нужно.
            var before = threadMessages(existing).map(messageKey).join("\n");
            var fresh = mergeThreadMessages(threadMessages(existing), threadMessages(incoming));
            existing.messages = fresh;
            existing.telegram_url = incoming.telegram_url || existing.telegram_url;
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
            if (id === selectedId && fresh.map(messageKey).join("\n") !== before) {
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
