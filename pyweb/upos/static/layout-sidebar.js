(function () {
  var RAIL_STORAGE = "upos.sidebarRail";

  function isMobileNav() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function readRailPref() {
    try {
      return window.localStorage.getItem(RAIL_STORAGE) === "1";
    } catch (e) {
      return false;
    }
  }

  function writeRailPref(on) {
    try {
      if (on) window.localStorage.setItem(RAIL_STORAGE, "1");
      else window.localStorage.removeItem(RAIL_STORAGE);
    } catch (e) {}
  }

  /** Desktop-only: narrow icon rail vs full sidebar width */
  function applySidebarRail(collapsed) {
    document.body.classList.toggle("sidebar-rail", collapsed);
    var btn = document.querySelector("[data-sidebar-rail-toggle]");
    if (btn) {
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.setAttribute(
        "aria-label",
        collapsed ? "Развернуть боковое меню" : "Свернуть боковое меню",
      );
      btn.title = collapsed ? "Развернуть меню" : "Свернуть меню";
    }
  }

  function syncRailForViewport() {
    if (isMobileNav()) {
      applySidebarRail(false);
      return;
    }
    applySidebarRail(readRailPref());
  }

  function bootSidebarRail() {
    var btn = document.querySelector("[data-sidebar-rail-toggle]");
    syncRailForViewport();
    if (btn) {
      btn.addEventListener("click", function () {
        if (isMobileNav()) return;
        var next = !document.body.classList.contains("sidebar-rail");
        applySidebarRail(next);
        writeRailPref(next);
      });
    }
    window.addEventListener("resize", syncRailForViewport);
  }

  function sidebarCsrfToken() {
    var input = document.querySelector('input[name="csrf_token"]');
    return input ? String(input.value || "") : "";
  }

  function readJsonResponse(response) {
    return response.text().then(function (text) {
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {
        body = {};
      }
      if (!response.ok) {
        throw new Error(body.error || body.message || "Не удалось выполнить синхронизацию");
      }
      return body;
    });
  }

  function bootSidebarIboxSync() {
    var button = document.querySelector("[data-sidebar-ibox-sync]");
    if (!button) return;
    var statusNode = button.querySelector("[data-sidebar-ibox-sync-status]");
    var liveNode = document.querySelector("[data-sidebar-ibox-sync-live]");
    var lastSyncNode = button.querySelector("[data-sidebar-ibox-sync-last]");
    var pollTimer = 0;
    var resetTimer = 0;
    var MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

    function formatSyncMoment(value) {
      var raw = String(value || "").trim();
      if (!raw) return "";
      var moment = new Date(raw);
      if (isNaN(moment.getTime())) return "";
      var time =
        String(moment.getHours()).padStart(2, "0") + ":" + String(moment.getMinutes()).padStart(2, "0");
      var today = new Date();
      var sameDay = function (a, b) {
        return (
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate()
        );
      };
      if (sameDay(moment, today)) return "сегодня в " + time;
      var yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      if (sameDay(moment, yesterday)) return "вчера в " + time;
      var date = moment.getDate() + " " + MONTHS[moment.getMonth()];
      if (moment.getFullYear() !== today.getFullYear()) date += " " + moment.getFullYear();
      return date + ", " + time;
    }

    function showLastSync(value) {
      if (!lastSyncNode) return;
      var text = formatSyncMoment(value);
      lastSyncNode.textContent = text ? "Обновлено " + text : "";
      lastSyncNode.hidden = !text;
    }

    function setState(state, message, detail) {
      button.dataset.state = state;
      button.disabled = state === "running";
      if (statusNode) statusNode.textContent = message;
      button.title = detail || message;
      button.setAttribute("aria-label", detail || message);
      if (liveNode) liveNode.textContent = detail || message;
    }

    function resetCompletedState() {
      clearTimeout(resetTimer);
      resetTimer = window.setTimeout(function () {
        setState("idle", "Синхронизировать вручную", "Ручная синхронизация с IBOX");
      }, 5000);
    }

    function applyStatus(status, announce) {
      if (!status) {
        setState("idle", "Синхронизировать вручную", "Ручная синхронизация с IBOX");
        return false;
      }
      if (status.status === "running") {
        setState("running", "Синхронизация…", "IBOX: синхронизация выполняется");
        return true;
      }
      if (status.status === "error") {
        setState("error", "Ошибка синхронизации", status.error || "IBOX: ошибка синхронизации");
        return false;
      }
      if (status.status === "partial") {
        var warnings = status.data && Array.isArray(status.data.warnings)
          ? status.data.warnings.length
          : 0;
        var partialDetail =
          "IBOX: импортировано " +
          String(status.imported_count || 0) +
          ", недоступных разделов " +
          String(warnings);
        setState("partial", "Синхронизировано частично", partialDetail);
        if (announce) resetCompletedState();
        return false;
      }
      var detail = "IBOX: импортировано записей " + String(status.imported_count || 0);
      setState(announce ? "success" : "idle", announce ? "Данные обновлены" : "Синхронизировать вручную", detail);
      if (announce) resetCompletedState();
      return false;
    }

    function pollStatus(announce) {
      clearTimeout(pollTimer);
      fetch("/api/integrations/ibox/status", {
        headers: { Accept: "application/json" },
      })
        .then(readJsonResponse)
        .then(function (body) {
          showLastSync(body.last_sync_at);
          if (applyStatus(body.status, announce)) {
            pollTimer = window.setTimeout(function () {
              pollStatus(true);
            }, 1800);
          }
        })
        .catch(function (error) {
          setState("error", "Ошибка синхронизации", error.message || "IBOX недоступен");
        });
    }

    button.addEventListener("click", function () {
      if (button.disabled) return;
      clearTimeout(resetTimer);
      setState("running", "Запускаю…", "IBOX: запускаю полную синхронизацию");
      fetch("/api/integrations/ibox/sync", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": sidebarCsrfToken(),
        },
      })
        .then(readJsonResponse)
        .then(function (body) {
          if (applyStatus(body.status, true)) {
            pollTimer = window.setTimeout(function () {
              pollStatus(true);
            }, 1200);
          } else {
            pollStatus(false);
          }
        })
        .catch(function (error) {
          setState("error", "Ошибка синхронизации", error.message || "Не удалось запустить синхронизацию IBOX");
        });
    });

    pollStatus(false);
  }

  function setOpen(on) {
    var body = document.body;
    var toggle = document.querySelector("[data-sidebar-toggle]");
    var backdrop = document.querySelector("[data-sidebar-backdrop]");
    body.classList.toggle("layout-nav-open", on);
    if (toggle) {
      toggle.setAttribute("aria-expanded", on ? "true" : "false");
    }
    if (backdrop) {
      backdrop.hidden = !on;
      backdrop.setAttribute("aria-hidden", on ? "false" : "true");
    }
  }

  function boot() {
    bootSidebarRail();
    bootSidebarIboxSync();

    var toggle = document.querySelector("[data-sidebar-toggle]");
    var backdrop = document.querySelector("[data-sidebar-backdrop]");
    var sidebar = document.getElementById("app-sidebar");
    if (!toggle) return;

    toggle.addEventListener("click", function () {
      setOpen(!document.body.classList.contains("layout-nav-open"));
    });

    if (backdrop) {
      backdrop.addEventListener("click", function () {
        setOpen(false);
      });
    }

    if (sidebar) {
      sidebar.addEventListener(
        "click",
        function (ev) {
          var el = ev.target;
          if (!el || !el.closest) return;
          var a = el.closest("a[href]");
          if (!a) return;
          var href = a.getAttribute("href") || "";
          if (!href || href === "#") return;
          if (!isMobileNav()) return;
          setOpen(false);
        },
        true,
      );
    }

    window.addEventListener(
      "keydown",
      function (ev) {
        if (ev.key === "Escape" && document.body.classList.contains("layout-nav-open")) {
          setOpen(false);
          toggle.focus();
        }
      },
      true,
    );

    window.addEventListener("resize", function () {
      // Совпадает с CSS: мобильный drawer только при max-width 768px.
      if (window.matchMedia("(min-width: 769px)").matches) {
        setOpen(false);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
