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

  function boot(root) {
    var threads = readThreads(root);
    var byId = {};
    threads.forEach(function (thread) {
      byId[String(thread.id)] = thread;
    });
    root.querySelectorAll("[data-messenger-thread-id]").forEach(function (item) {
      item.addEventListener("click", function () {
        selectThread(root, byId[String(item.getAttribute("data-messenger-thread-id"))]);
      });
    });
    if (threads.length) selectThread(root, threads[0]);

    var text = root.querySelector("[data-messenger-compose-text]");
    var send = root.querySelector("[data-messenger-send-button]");
    if (text && send) {
      send.addEventListener("click", function () {
        var current = byId[String(root.dataset.selectedThreadId || "")];
        var value = String(text.value || "").trim();
        if (!current || !value) return;
        current.messages = Array.isArray(current.messages) ? current.messages : [];
        current.messages.push({ author: "Вы", text: value, kind: "out" });
        text.value = "";
        renderMessages(root, current);
      });
    }
  }

  function start() {
    document.querySelectorAll("[data-messenger-inbox]").forEach(boot);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
