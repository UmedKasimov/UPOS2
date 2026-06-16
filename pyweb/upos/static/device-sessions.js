(function () {
  "use strict";

  var D = "div";

  function t(key, fallback, prefix) {
    var bag = window.upos_i18n || {};
    var pfx = prefix || "settings.devices.";
    var k = key.indexOf(".") >= 0 ? key : pfx + key;
    return bag[k] || fallback || key;
  }

  function csrf() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.getAttribute("content") : "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString(undefined, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function osIconSvg(os) {
    var key = String(os || "unknown").toLowerCase();
    if (key === "windows") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.5 10.5 4.4v7.1H3V5.5Zm8.5-.9L21 3v8.2h-9.5V4.6ZM3 12.4h7.5v7.2L3 18.5v-6.1Zm9.5 0H21V21l-8.5-1.2v-7.4Z"/></svg>';
    }
    if (key === "android") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 3 6.5 5.5h11L16 3h-2l1 2H9L10 3H8Zm-2 4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1v2h2v-2h6v2h2v-2h1a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6Z"/></svg>';
    }
    if (key === "ios") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.7 13.3c-.1-1.2.9-1.8 1-1.9-.5-.8-1.4-1.3-2.3-1.3-1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6c-1.1 0-2.2.7-2.8 1.7-1.2 2.1-.3 5.2.8 6.9.6.8 1.2 1.7 2.1 1.6.8 0 1.1-.5 2.1-.5s1.3.5 2.1.5 1.5-.8 2.1-1.6.9-1.2 1.2-2.4 1.2-2.5-.1 0-2.3-.9-2.3-3.5ZM14.2 5.2c.5-.6.8-1.4.7-2.2-.7 0-1.6.5-2.1 1.1-.5.6-.9 1.4-.8 2.2.8.1 1.7-.4 2.2-1.1Z"/></svg>';
    }
    if (key === "mac") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.7 15.5c-.4 1.2.9 1.7.9 1.7s-1.1.5-2.2-.3c-1-.7-1.8-2.4-3.1-2.3-1.3.1-1.6 1-3.2 1-1.6 0-2.1-.9-3.2-1-1.1-.1-2 1.5-3.3 3.1-1.1 1.5-2.3 3-4.1 3-1.7 0-2.7-1.1-2.7-3.2 0-2.4 1.3-4.6 3.3-4.6 1.3 0 2.1.9 3.2.9 1.1 0 1.7-.9 3.1-.9 1.3 0 2.2.7 2.9 1.7-2.5 1.4-2.1 4.9-.8 6.1Z"/></svg>';
    }
    if (key === "linux") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3c-3.3 0-6 2.5-6 6.2 0 2 .9 3.2 1.6 3.8-.2.6-.4 1.2-.4 1.9 0 1.5.9 2.8 2.2 3.4l-.4 1.9h1.5l.3-1.5h1.6l.3 1.5h1.5l-.4-1.9c1.3-.6 2.2-1.9 2.2-3.4 0-.7-.2-1.3-.4-1.9.7-.6 1.6-1.8 1.6-3.8C18 5.5 15.3 3 12 3Z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8" stroke="currentColor" stroke-width="2"/></svg>';
  }

  function el(tag, cls, inner) {
    return "<" + tag + (cls ? ' class="' + cls + '"' : "") + ">" + inner + "</" + tag + ">";
  }

  function deviceRowHtml(d, opts) {
    var i18nPrefix = (opts && opts.i18nPrefix) || "settings.devices.";
    var showCurrent = !opts || opts.showCurrentDevice !== false;
    var badges = "";
    if (showCurrent && d.is_current) {
      badges += el(
        "span",
        "device-session-badge device-session-badge--current",
        escapeHtml(t("current", "Это устройство", i18nPrefix)),
      );
    } else if (d.is_online) {
      badges += el(
        "span",
        "device-session-badge device-session-badge--online",
        escapeHtml(t("online", "Онлайн", i18nPrefix)),
      );
    }
    var meta = [];
    if (d.ip_address) meta.push(t("ip", "IP", i18nPrefix) + ": " + escapeHtml(d.ip_address));
    if (d.geo_label) meta.push(escapeHtml(d.geo_label));
    if (d.browser_family) meta.push(escapeHtml(d.browser_family));
    var last = d.last_seen_at
      ? t("last_seen", "Был онлайн: {time}", i18nPrefix).replace("{time}", formatTime(d.last_seen_at))
      : t("never", "Ещё не было активности", i18nPrefix);
    var actions = "";
    var hideActions = opts && opts.hideCurrentActions && d.is_current;
    if (!hideActions && !d.is_revoked && !d.is_blocked && (!showCurrent || !d.is_current)) {
      actions =
        el(
          D,
          "device-session-actions",
          '<button type="button" class="btn btn-secondary btn-sm" data-device-revoke="' +
            escapeHtml(d.id) +
            '">' +
            escapeHtml(t("revoke", "Выйти", i18nPrefix)) +
            '</button><button type="button" class="btn btn-ghost btn-sm" data-device-block="' +
            escapeHtml(d.id) +
            '">' +
            escapeHtml(t("block", "Заблокировать", i18nPrefix)) +
            "</button>",
        );
    }
    var iconCls = "device-session-icon device-session-icon--" + escapeHtml(d.os_family || "unknown");
    var main =
      el(D, "device-session-top", "<strong>" + escapeHtml(d.device_label || "—") + "</strong>" + badges) +
      el("p", "device-session-meta", meta.join(" · ")) +
      el("p", "device-session-last", escapeHtml(last)) +
      actions;
    return el(
      "article",
      "device-session-row" + (showCurrent && d.is_current ? " is-current" : ""),
      el(D, iconCls, osIconSvg(d.os_family)) + el(D, "device-session-main", main),
    );
  }

  function renderList(listEl, devices, opts) {
    if (!listEl) return;
    var i18nPrefix = (opts && opts.i18nPrefix) || "settings.devices.";
    if (!devices || !devices.length) {
      listEl.innerHTML =
        '<p class="device-session-empty">' + escapeHtml(t("empty", "Нет записанных устройств", i18nPrefix)) + "</p>";
      return;
    }
    listEl.innerHTML = devices.map(function (d) {
      return deviceRowHtml(d, opts);
    }).join("");
  }

  function fetchDevices(apiBase) {
    return fetch(apiBase, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("load");
      return r.json();
    });
  }

  function postAction(path, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return Promise.resolve(null);
    return fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": csrf(), "Content-Type": "application/json" },
      body: "{}",
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.error ? data.error : "action");
        return data;
      });
    });
  }

  function sendHeartbeat() {
    var meta = {
      language: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      platform: navigator.platform || "",
    };
    fetch("/api/me/devices/heartbeat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_meta: meta }),
    }).catch(function () {});
  }

  function initDevicesDialog(cfg) {
    var dialog = cfg.dialog;
    var listEl = cfg.listEl;
    var apiBase = cfg.apiBase;
    var i18nPrefix = cfg.i18nPrefix || "settings.devices.";
    var showCurrentDevice = cfg.showCurrentDevice !== false;
    var titleEl = cfg.titleEl;
    var getApiBase = cfg.getApiBase;
    var lastTrigger = null;

    if (!dialog || !listEl) return;

    function resolveApiBase() {
      if (typeof getApiBase === "function") return getApiBase(lastTrigger);
      return apiBase;
    }

    function loadList() {
      var base = resolveApiBase();
      if (!base) return Promise.resolve();
      listEl.textContent = "…";
      return fetchDevices(base)
        .then(function (data) {
          renderList(listEl, data.devices || [], {
            i18nPrefix: i18nPrefix,
            showCurrentDevice: showCurrentDevice,
          });
        })
        .catch(function () {
          listEl.innerHTML =
            '<p class="device-session-empty device-session-empty--err">' +
            escapeHtml(t("load_err", "Не удалось загрузить список устройств", i18nPrefix)) +
            "</p>";
        });
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
    }

    if (cfg.openTriggers) {
      cfg.openTriggers.forEach(function (trigger) {
        trigger.addEventListener("click", function () {
          lastTrigger = trigger;
          if (titleEl && cfg.getTitle) {
            titleEl.textContent = cfg.getTitle(trigger) || titleEl.getAttribute("data-default-title") || "";
          }
          if (typeof dialog.showModal === "function") dialog.showModal();
          loadList();
        });
      });
    }

    (cfg.closeTriggers || []).forEach(function (btn) {
      btn.addEventListener("click", closeDialog);
    });

    dialog.addEventListener("click", function (ev) {
      if (ev.target === dialog) closeDialog();
    });

    listEl.addEventListener("click", function (ev) {
      var revokeBtn = ev.target.closest("[data-device-revoke]");
      var blockBtn = ev.target.closest("[data-device-block]");
      var base = resolveApiBase();
      if (!base) return;
      if (revokeBtn) {
        var rid = revokeBtn.getAttribute("data-device-revoke");
        postAction(
          base + "/" + encodeURIComponent(rid) + "/revoke",
          t("revoke_confirm", "Завершить сессию на этом устройстве?", i18nPrefix),
        )
          .then(function () {
            return loadList();
          })
          .catch(function () {
            window.alert(t("action_err", "Не удалось выполнить действие", i18nPrefix));
          });
      }
      if (blockBtn) {
        var bid = blockBtn.getAttribute("data-device-block");
        postAction(
          base + "/" + encodeURIComponent(bid) + "/block",
          t(
            "block_confirm",
            "Заблокировать это устройство? Повторный вход с него будет невозможен.",
            i18nPrefix,
          ),
        )
          .then(function (data) {
            if (data && data.logged_out) {
              window.location.href = "/auth";
              return;
            }
            return loadList();
          })
          .catch(function () {
            window.alert(t("action_err", "Не удалось выполнить действие", i18nPrefix));
          });
      }
    });

    return { loadList: loadList, closeDialog: closeDialog };
  }

  function initSettings() {
    if (document.body && document.body.getAttribute("data-device-heartbeat") === "1") {
      sendHeartbeat();
      setInterval(sendHeartbeat, 60000);
    }

    var dialog = document.getElementById("settings-devices-dialog");
    var openBtn = document.querySelector("[data-settings-devices-open]");
    var listEl = document.querySelector("[data-devices-list]");
    if (!dialog || !openBtn || !listEl) return;

    initDevicesDialog({
      dialog: dialog,
      listEl: listEl,
      apiBase: "/api/me/devices",
      i18nPrefix: "settings.devices.",
      showCurrentDevice: true,
      openTriggers: [openBtn],
      closeTriggers: document.querySelectorAll("[data-settings-devices-close]"),
    });
  }

  window.uposDeviceSessions = {
    initDevicesDialog: initDevicesDialog,
    renderList: renderList,
    fetchDevices: fetchDevices,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSettings);
  } else {
    initSettings();
  }
})();
