(function () {
  var tgAssetsPromise = null;

  function loadTelegramAssets(root) {
    if (tgAssetsPromise) return tgAssetsPromise;
    tgAssetsPromise = new Promise(function (resolve, reject) {
      var cssHref =
        (root && root.getAttribute("data-tg-css-href")) || "/static/telegram-settings.css?v=9";
      var jsSrc =
        (root && root.getAttribute("data-tg-js-src")) || "/static/telegram-settings.js?v=4";

      if (!document.querySelector('link[data-tg-stylesheet="1"]')) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssHref;
        link.setAttribute("data-tg-stylesheet", "1");
        document.head.appendChild(link);
      }

      if (window.uposInitTelegramSettings) {
        var tgRoot = document.querySelector("[data-telegram-settings]");
        if (tgRoot && typeof tgRoot._uposTelegramActive === "function") {
          tgRoot._uposTelegramActive();
        }
        resolve();
        return;
      }

      var script = document.createElement("script");
      script.src = jsSrc;
      script.defer = true;
      script.onload = function () {
        if (typeof window.uposInitTelegramSettings === "function") {
          window.uposInitTelegramSettings();
        }
        resolve();
      };
      script.onerror = function () {
        reject(new Error("telegram-settings.js"));
      };
      document.body.appendChild(script);
    });
    return tgAssetsPromise;
  }

  function init(root) {
    var triggers = root.querySelectorAll("[data-settings-tab]");
    var panels = root.querySelectorAll("[data-settings-panel]");
    var tabField = document.querySelector("#settings-active-tab-input");
    if (!triggers.length || !panels.length) return;

    function show(tabId) {
      triggers.forEach(function (btn) {
        var on = btn.getAttribute("data-settings-tab") === tabId;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach(function (panel) {
        var on = panel.getAttribute("data-settings-panel") === tabId;
        panel.hidden = !on;
      });
      if (tabField) tabField.value = tabId;
      if (tabId === "telegram") {
        loadTelegramAssets(root).catch(function () {
          /* assets failed — panel still visible */
        });
      }
      try {
        root.dispatchEvent(
          new CustomEvent("upos-settings-tab", { detail: { tab: tabId }, bubbles: true }),
        );
      } catch (e) {
        /* CustomEvent is available in supported browsers. */
      }
    }

    var initial = root.getAttribute("data-settings-default") || "general";
    if (tabField) tabField.value = initial;
    show(initial);

    triggers.forEach(function (btn) {
      btn.addEventListener("click", function () {
        show(btn.getAttribute("data-settings-tab"));
      });
    });
  }

  function boot() {
    document.querySelectorAll("[data-settings-tabs]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
