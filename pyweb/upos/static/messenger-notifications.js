(function () {
  var REFRESH_MS = 4000;
  var LEADER_TTL_MS = 12000;
  var MIN_REQUEST_GAP_MS = 2000;
  var RESUME_DEBOUNCE_MS = 180;
  var LEADER_KEY = "upos:messenger-notifications:leader";
  var PAYLOAD_KEY = "upos:messenger-notifications:payload";
  var TAB_ID = String(Date.now()) + ":" + Math.random().toString(36).slice(2);
  var channel = typeof BroadcastChannel === "function"
    ? new BroadcastChannel("upos-messenger-notifications")
    : null;

  function readStored(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_error) { return null; }
  }

  function isForegroundTab() {
    return document.visibilityState !== "hidden" &&
      (typeof document.hasFocus !== "function" || document.hasFocus());
  }

  function claimLeadership(force) {
    var now = Date.now();
    var current = readStored(LEADER_KEY);
    if (!force && current && current.id !== TAB_ID && Number(current.expires || 0) > now) return false;
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, expires: now + LEADER_TTL_MS }));
      var confirmed = readStored(LEADER_KEY);
      return Boolean(confirmed && confirmed.id === TAB_ID);
    } catch (_error) {
      return document.visibilityState !== "hidden";
    }
  }

  function publish(payload) {
    var packet = { at: Date.now(), payload: payload };
    if (channel) channel.postMessage(packet);
    try { localStorage.setItem(PAYLOAD_KEY, JSON.stringify(packet)); } catch (_error) {}
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function journalUrl(row) {
    var params = new URLSearchParams();
    if (row.channel) params.set("journal_channel", row.channel);
    if (row.contact) params.set("journal_q", row.contact);
    var query = params.toString();
    return "/messengers" + (query ? "?" + query : "") + "#sms_journal";
  }

  function createModal() {
    var dialog = document.createElement("dialog");
    dialog.className = "sidebar-messenger-modal";
    dialog.innerHTML =
      '<section class="sidebar-messenger-modal-surface"><header class="sidebar-messenger-modal-head">' +
      '<div><h2>Сообщения новых лидов</h2><p data-messenger-modal-summary>Только непрочитанные</p></div>' +
      '<button type="button" class="settings-profile-modal-close" data-messenger-modal-close aria-label="Закрыть">×</button>' +
      '</header><div class="sidebar-messenger-modal-list" data-messenger-modal-list></div>' +
      '<footer class="sidebar-messenger-modal-foot"><a class="btn btn-secondary" href="/messengers#inbox">Все диалоги</a>' +
      '<a class="btn btn-secondary" href="/messengers#sms_journal">Журнал сообщений</a>' +
      '<button type="button" class="btn" data-messenger-modal-close>Закрыть</button></footer></section>';
    dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
    dialog.querySelectorAll("[data-messenger-modal-close]").forEach(function (button) {
      button.addEventListener("click", function () { dialog.close(); });
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function renderList(list, rows) {
    if (!rows.length) {
      list.innerHTML = '<div class="sidebar-messenger-empty">Новых сообщений от новых лидов пока нет.</div>';
      return;
    }
    list.innerHTML = rows.map(function (row) {
      var unread = Number(row.unread || 0);
      return '<a class="sidebar-messenger-row" href="' + escapeHtml(journalUrl(row)) + '">' +
        '<span class="sidebar-messenger-channel">' + escapeHtml(row.channel || "Чат") + '</span>' +
        '<span class="sidebar-messenger-row-main"><strong>' + escapeHtml(row.contact || "Клиент") + '</strong><small>' + escapeHtml(row.message || "") + '</small></span>' +
        '<span class="sidebar-messenger-row-side">' + (row.time_label ? '<time>' + escapeHtml(row.time_label) + '</time>' : '') +
        (unread ? '<b>' + unread + '</b>' : '') + '</span></a>';
    }).join("");
  }

  function boot() {
    var button = document.querySelector("[data-sidebar-messenger-notifications]");
    if (!button) return;
    var rows = [];
    var modal = null;
    var refreshPromise = null;
    var lastRequestAt = 0;
    var resumeTimer = 0;

    function apply(payload) {
      rows = Array.isArray(payload.notifications)
        ? payload.notifications.filter(function (row) { return Number(row.unread || 0) > 0; })
        : rows;
      var unread = Number(payload.unread_total || 0);
      var status = button.querySelector("[data-sidebar-messenger-status]");
      var count = button.querySelector("[data-sidebar-messenger-count]");
      if (status) status.textContent = unread > 0 ? "Новые сообщения: " + unread : "Нет новых";
      if (count) { count.hidden = unread <= 0; count.textContent = String(unread); }
      button.dataset.state = unread > 0 ? "new" : "idle";
      if (modal && modal.open) renderList(modal.querySelector("[data-messenger-modal-list]"), rows);
    }

    function refresh(force) {
      if (!isForegroundTab()) return Promise.resolve();
      if (refreshPromise) return refreshPromise;
      var now = Date.now();
      if (now - lastRequestAt < MIN_REQUEST_GAP_MS) return Promise.resolve();
      if (!claimLeadership(false)) return Promise.resolve();
      lastRequestAt = now;
      refreshPromise = fetch("/api/messengers/notifications", { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(function (response) { if (!response.ok) throw new Error(); return response.json(); })
        .then(function (payload) {
          apply(payload);
          publish(payload);
        })
        .catch(function () {
          var status = button.querySelector("[data-sidebar-messenger-status]");
          if (status) status.textContent = "Не удалось обновить";
        })
        .finally(function () {
          refreshPromise = null;
        });
      return refreshPromise;
    }

    function scheduleResumeRefresh() {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(function () { refresh(true); }, RESUME_DEBOUNCE_MS);
    }

    button.addEventListener("click", function () {
      if (!modal) modal = createModal();
      renderList(modal.querySelector("[data-messenger-modal-list]"), rows);
      modal.querySelector("[data-messenger-modal-summary]").textContent = rows.length
        ? "Только непрочитанные"
        : "Новых сообщений от новых лидов нет";
      modal.showModal();
      refresh(true);
    });

    function acceptPacket(packet) {
      if (packet && packet.payload) apply(packet.payload);
    }
    if (channel) channel.addEventListener("message", function (event) { acceptPacket(event.data); });
    window.addEventListener("storage", function (event) {
      if (event.key === PAYLOAD_KEY && event.newValue) acceptPacket(readStored(PAYLOAD_KEY));
    });
    var saved = readStored(PAYLOAD_KEY);
    if (saved && Date.now() - Number(saved.at || 0) < LEADER_TTL_MS) {
      acceptPacket(saved);
      lastRequestAt = Number(saved.at || 0);
    }

    refresh();
    window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") scheduleResumeRefresh();
    });
    window.addEventListener("focus", scheduleResumeRefresh);
  }

  function start() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }

  if (document.prerendering) {
    document.addEventListener("prerenderingchange", start, { once: true });
  } else {
    start();
  }
})();
