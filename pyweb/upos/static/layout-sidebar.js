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
