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

  function renderMessages(panel, thread) {
    var box = panel.querySelector("[data-messenger-thread-messages]");
    if (!box) return;
    var messages = threadMessages(thread);
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
      '</span><i class="messenger-presence-dot messenger-presence-dot--' +
      classToken(thread.presence, "offline") +
      '" aria-hidden="true"></i></span><span class="messenger-dialog-main"><span class="messenger-dialog-name-line"><strong>' +
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

  function selectThread(root, thread) {
    if (!thread) return;
    root.querySelectorAll("[data-messenger-thread-id]").forEach(function (item) {
      item.classList.toggle("active", item.getAttribute("data-messenger-thread-id") === String(thread.id));
    });
    updateThreadHeader(root, thread);
    renderMessages(root, thread);
    root.dataset.selectedThreadId = thread.id || "";
    try {
      window.localStorage && window.localStorage.setItem(SELECTED_THREAD_KEY, thread.id || "");
    } catch (err) {
      return;
    }
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

    root.querySelectorAll("[data-messenger-thread-id]").forEach(function (item) {
      item.addEventListener("click", function () {
        selectThread(root, byId[String(item.getAttribute("data-messenger-thread-id"))]);
        renderTemplatePicker();
      });
    });

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
    });

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
        if (!current || !value) return;
        current.messages = threadMessages(current).slice();
        current.messages.push({ author: "Вы", text: value, kind: "out", created_at: new Date().toISOString() });
        text.value = "";
        rememberThread(current);
        renderMessages(root, current);
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
