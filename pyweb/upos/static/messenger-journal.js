(function () {
  function initMessageJournals() {
    document.querySelectorAll("[data-messenger-message-journal]").forEach(function (root) {
      if (root.dataset.messengerJournalReady === "true") return;
      root.dataset.messengerJournalReady = "true";

      var rows = Array.prototype.slice.call(root.querySelectorAll("[data-messenger-journal-row]"));
      if (!rows.length) {
        var ids;
        try { ids = JSON.parse(localStorage.getItem("upos.messenger.threadIndex") || "[]"); }
        catch (_error) { ids = []; }
        if (Array.isArray(ids)) {
          var cached = [];
          ids.slice(-100).forEach(function (id) {
            var thread;
            try { thread = JSON.parse(localStorage.getItem("upos.messenger.thread." + String(id)) || "null"); }
            catch (_error) { thread = null; }
            if (!thread || !Array.isArray(thread.messages)) return;
            thread.messages.forEach(function (message) {
              if (!message || (message.kind !== "in" && message.kind !== "out")) return;
              var at = Date.parse(message.created_at || "");
              if (!Number.isFinite(at)) return;
              cached.push({ thread: thread, message: message, at: at });
            });
          });
          cached.sort(function (a, b) { return b.at - a.at; });
          var list = root.querySelector(".messenger-journal-list");
          cached.forEach(function (entry) {
            var thread = entry.thread;
            var message = entry.message;
            var row = document.createElement("article");
            row.className = "messenger-journal-row";
            row.tabIndex = 0;
            row.setAttribute("role", "link");
            row.dataset.messengerJournalRow = "";
            row.dataset.channel = String(thread.channel || "").toLowerCase();
            row.dataset.search = [thread.contact, message.author, message.text, thread.channel].join(" ").toLowerCase();
            row.dataset.threadUrl = "/messengers?channel=" + encodeURIComponent(thread.channel || "Telegram") + "&thread=" + encodeURIComponent(thread.id || "") + "#inbox";
            var direction = document.createElement("span");
            direction.className = "messenger-journal-direction messenger-journal-direction--" + message.kind;
            direction.textContent = message.kind === "in" ? "Входящее" : "Исходящее";
            var body = document.createElement("div");
            var name = document.createElement("strong");
            name.textContent = thread.contact || "Клиент";
            var text = document.createElement("p");
            text.textContent = message.text || message.attachment_label || "Вложение";
            body.append(name, text);
            var meta = document.createElement("small");
            meta.textContent = (thread.channel || "Чат") + " · " + new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(entry.at);
            row.append(direction, body, meta);
            list.appendChild(row);
            rows.push(row);
          });
        }
      }
      var buttons = Array.prototype.slice.call(root.querySelectorAll("[data-messenger-journal-channel]"));
      var search = root.querySelector("[data-messenger-journal-search]");
      var summary = root.querySelector("[data-messenger-journal-summary]");
      var empty = root.querySelector("[data-messenger-journal-empty]");
      var params = new URLSearchParams(window.location.search);
      var activeChannel = String(params.get("journal_channel") || "").toLowerCase();
      var initialQuery = String(params.get("journal_q") || "");

      if (search && initialQuery) search.value = initialQuery;

      function applyFilters() {
        var query = String((search && search.value) || "").trim().toLowerCase();
        var visible = 0;
        rows.forEach(function (row) {
          var channelMatches = !activeChannel || row.dataset.channel === activeChannel;
          var searchMatches = !query || String(row.dataset.search || "").indexOf(query) !== -1;
          var matches = channelMatches && searchMatches;
          row.hidden = !matches;
          if (matches) visible += 1;
        });
        if (summary) summary.textContent = "Показано сообщений: " + visible + " из " + rows.length;
        if (empty) empty.hidden = visible !== 0;
      }

      buttons.forEach(function (button) {
        button.addEventListener("click", function () {
          activeChannel = String(button.dataset.messengerJournalChannel || "").toLowerCase();
          buttons.forEach(function (item) {
            var active = item === button;
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", active ? "true" : "false");
          });
          applyFilters();
        });
      });
      if (activeChannel) {
        buttons.forEach(function (button) {
          var active = String(button.dataset.messengerJournalChannel || "").toLowerCase() === activeChannel;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }
      if (search) search.addEventListener("input", applyFilters);
      rows.forEach(function (row) {
        function openThread(event) {
          if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
          if (event.target.closest("a, button, input, select, textarea")) return;
          var url = row.dataset.threadUrl;
          if (!url) return;
          event.preventDefault();
          window.location.href = url;
        }
        row.addEventListener("click", openThread);
        row.addEventListener("keydown", openThread);
      });
      applyFilters();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMessageJournals);
  } else {
    initMessageJournals();
  }
})();
