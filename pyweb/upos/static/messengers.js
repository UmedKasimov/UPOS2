(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readThreads(root) {
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

  function renderMessages(panel, thread) {
    var box = panel.querySelector("[data-messenger-thread-messages]");
    if (!box) return;
    var messages = Array.isArray(thread.messages) ? thread.messages : [];
    if (!messages.length) {
      box.innerHTML = '<div class="messenger-empty">История пока пустая. Начните диалог из поля ниже.</div>';
      return;
    }
    box.innerHTML = messages
      .map(function (message) {
        var kind = String(message.kind || "in").toLowerCase();
        return (
          '<div class="messenger-thread-message messenger-thread-message--' +
          escapeHtml(kind) +
          '"><strong>' +
          escapeHtml(message.author || (kind === "out" ? "Вы" : thread.contact || thread.channel)) +
          "</strong><span>" +
          escapeHtml(message.text || "") +
          "</span></div>"
        );
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function selectThread(root, thread) {
    if (!thread) return;
    root.querySelectorAll("[data-messenger-thread-id]").forEach(function (item) {
      item.classList.toggle("active", item.getAttribute("data-messenger-thread-id") === String(thread.id));
    });
    var title = root.querySelector("[data-messenger-thread-title]");
    var meta = root.querySelector("[data-messenger-thread-meta]");
    if (title) title.textContent = thread.contact || "Диалог";
    if (meta) {
      meta.textContent =
        (thread.channel || "Канал") +
        " · " +
        (thread.topic || thread.status_label || "обращение") +
        (thread.client ? " · клиент: " + thread.client : "");
    }
    renderMessages(root, thread);
    root.dataset.selectedThreadId = thread.id || "";
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
    var threads = readThreads(root);
    var templates = readTemplates();
    var byId = {};
    threads.forEach(function (thread) {
      byId[String(thread.id)] = thread;
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
    if (threads.length) selectThread(root, threads[0]);

    var sendToCrm = root.querySelector("[data-messenger-attach-client]");
    if (sendToCrm) {
      sendToCrm.addEventListener("click", function () {
        var current = currentThread();
        if (!current) return;
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
        current.messages = Array.isArray(current.messages) ? current.messages : [];
        current.messages.push({ author: "Вы", text: value, kind: "out" });
        text.value = "";
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
