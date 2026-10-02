(function () {
  function init() {
    document.querySelectorAll("[data-messenger-message-journal]").forEach(function (root) {
      if (root.dataset.messengerJournalReady) return;
      root.dataset.messengerJournalReady = "1";
      var list = root.querySelector(".messenger-journal-list");
      var empty = root.querySelector("[data-messenger-journal-empty]");
      var summary = root.querySelector("[data-messenger-journal-summary]");
      var search = root.querySelector("[data-messenger-journal-search]");
      var buttons = Array.from(root.querySelectorAll("[data-messenger-journal-channel]"));
      var rows = Array.from(root.querySelectorAll("[data-messenger-journal-row]"));
      var params = new URLSearchParams(location.search);
      var activeChannel = String(params.get("journal_channel") || "").toLowerCase();
      var busy = false;
      if (search) search.value = params.get("journal_q") || "";

      function identity(threadId, kind, at, message) {
        return JSON.stringify([String(threadId || ""), String(kind || ""), Date.parse(at || "") || at || "", String(message || "")]);
      }
      var known = new Map(rows.map(function (row) {
        return [identity(row.dataset.threadId, row.dataset.kind, row.dataset.createdAt, row.querySelector("p")?.textContent), row];
      }));
      function setUnread(row, unread) {
        row.dataset.unread = unread ? "1" : "0";
        var meta = row.querySelector("small");
        if (!meta) return;
        var badge = meta.querySelector(".messenger-journal-unread");
        if (unread && !badge) {
          badge = document.createElement("b");
          badge.className = "messenger-journal-unread";
          badge.textContent = "Новое";
          meta.appendChild(badge);
        } else if (!unread && badge) badge.remove();
      }
      function setLocal(row, local) {
        var meta = row.querySelector("small");
        if (!meta) return;
        var badge = meta.querySelector(".messenger-journal-local");
        if (local && !badge) {
          badge = document.createElement("b");
          badge.className = "messenger-journal-local";
          badge.textContent = "История браузера";
          meta.append(document.createElement("br"), badge);
        } else if (!local && badge) badge.remove();
      }
      function add(data) {
        var at = String(data.created_at || "");
        var timestamp = Date.parse(at);
        if (!Number.isFinite(timestamp)) return false;
        var threadId = String(data.thread_id || "");
        var kind = data.kind === "out" ? "out" : "in";
        var message = String(data.message || "Вложение");
        var key = identity(threadId, kind, at, message);
        if (known.has(key)) {
          if (data.server) {
            setUnread(known.get(key), Boolean(data.unread));
            setLocal(known.get(key), false);
          }
          return false;
        }
        var channel = String(data.channel || "Telegram");
        var contact = String(data.contact || "Клиент");
        var row = document.createElement("article");
        row.className = "messenger-journal-row";
        row.tabIndex = 0;
        row.setAttribute("role", "link");
        row.dataset.messengerJournalRow = "";
        row.dataset.threadId = threadId;
        row.dataset.createdAt = at;
        row.dataset.kind = kind;
        row.dataset.channel = channel.toLowerCase();
        row.dataset.search = [contact, data.author || "", message, channel].join(" ").toLowerCase();
        row.dataset.threadUrl = "/messengers?channel=" + encodeURIComponent(channel) + "&thread=" + encodeURIComponent(threadId) + "#inbox";
        var direction = document.createElement("span");
        direction.className = "messenger-journal-direction messenger-journal-direction--" + kind;
        direction.textContent = kind === "in" ? "Входящее" : "Исходящее";
        var body = document.createElement("div");
        var name = document.createElement("strong");
        name.textContent = contact;
        var text = document.createElement("p");
        text.textContent = message;
        body.append(name, text);
        var meta = document.createElement("small");
        meta.append(document.createTextNode(channel), document.createElement("br"), document.createTextNode(data.time_label || new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(timestamp)));
        row.append(direction, body, meta);
        setUnread(row, Boolean(data.unread));
        setLocal(row, !data.server);
        list.insertBefore(row, empty);
        rows.push(row);
        known.set(key, row);
        return true;
      }
      function sortRows() {
        rows.sort(function (a, b) { return (Date.parse(b.dataset.createdAt || "") || 0) - (Date.parse(a.dataset.createdAt || "") || 0); });
        rows.forEach(function (row) { list.insertBefore(row, empty); });
      }
      function filter() {
        var query = String(search?.value || "").trim().toLowerCase();
        var visible = 0;
        rows.forEach(function (row) {
          row.hidden = Boolean((activeChannel && row.dataset.channel !== activeChannel) ||
            (query && !String(row.dataset.search || "").includes(query)));
          if (!row.hidden) visible++;
        });
        if (summary) summary.textContent = "Показано сообщений: " + visible + " из " + rows.length;
        if (empty) empty.hidden = visible !== 0;
      }

      var ids;
      try { ids = JSON.parse(localStorage.getItem("upos.messenger.threadIndex") || "[]"); }
      catch (_error) { ids = []; }
      if (Array.isArray(ids)) ids.slice(-100).forEach(function (id) {
        var thread;
        try { thread = JSON.parse(localStorage.getItem("upos.messenger.thread." + String(id)) || "null"); }
        catch (_error) { thread = null; }
        if (!thread || !Array.isArray(thread.messages)) return;
        thread.messages.forEach(function (message) {
          if (!message || (message.kind !== "in" && message.kind !== "out")) return;
          add({ thread_id: thread.id || id, channel: thread.channel, contact: thread.contact,
            author: message.author, kind: message.kind, message: message.text || message.attachment_label,
            created_at: message.created_at, unread: false });
        });
      });
      sortRows();
      buttons.forEach(function (button) {
        button.addEventListener("click", function () {
          activeChannel = String(button.dataset.messengerJournalChannel || "").toLowerCase();
          buttons.forEach(function (item) {
            var active = item === button;
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", active ? "true" : "false");
          });
          filter();
        });
        if (activeChannel) {
          var active = String(button.dataset.messengerJournalChannel || "").toLowerCase() === activeChannel;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        }
      });
      if (search) search.addEventListener("input", filter);
      function open(event) {
        if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
        var row = event.target.closest("[data-messenger-journal-row]");
        if (!row || !root.contains(row) || event.target.closest("a, button, input, select, textarea")) return;
        if (!row.dataset.threadUrl) return;
        event.preventDefault();
        location.href = row.dataset.threadUrl;
      }
      root.addEventListener("click", open);
      root.addEventListener("keydown", open);
      function refresh() {
        if (busy || root.hidden || document.hidden) return;
        busy = true;
        fetch("/api/messengers/notifications", { credentials: "same-origin" })
          .then(function (response) { if (!response.ok) throw new Error(); return response.json(); })
          .then(function (payload) {
            var added = false;
            (payload.notifications || []).forEach(function (entry) {
              entry.server = true;
              if (add(entry)) added = true;
            });
            if (added) sortRows();
            filter();
          })
          .catch(function () {})
          .finally(function () { busy = false; });
      }
      filter();
      refresh();
      setInterval(refresh, 4000);
      addEventListener("hashchange", function () { setTimeout(refresh, 0); });
      document.addEventListener("visibilitychange", refresh);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
