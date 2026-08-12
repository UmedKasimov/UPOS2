(() => {
  "use strict";

  const routes = [
    { path: "/organizations/reports", keys: ["upos.generalReports.openTabs"] },
    { path: "/organizations/settings", keys: ["upos.orgSettings.openTabs"] },
    { path: "/organizations/users", keys: ["upos.orgSettings.openTabs"] },
    { path: "/settings", keys: ["upos.orgSettings.openTabs"] },
    { path: "/organizations/shipments", keys: ["upos.shipments.openTabs"] },
    { path: "/organizations/hr", keys: ["upos.hr.openTabs"] },
    { path: "/sales", keys: ["upos.sales.openTabs"] },
    {
      path: "/finance",
      keys: [],
      allowedPaths: ["/finance", "/schet", "/kassa", "/earnings"],
      lastUrlKey: "upos.finance.lastUrl",
    },
    { path: "/products", keys: ["upos.products.openTabs"] },
    { path: "/warehouse", keys: ["upos.warehouse.openTabs"] },
    { path: "/clients", keys: ["upos.clients.openTabs"] },
    { path: "/suppliers", keys: ["upos.suppliers.openTabs"] },
    { path: "/crm", keys: ["upos.crm.openTabs"] },
    { path: "/telephony", keys: ["upos.telephony.openTabs"] },
    { path: "/messengers", keys: ["upos.messengers.openTabs"] },
    { path: "/reports", keys: ["upos.homeReports.openTabs"] },
    { path: "/shipments", keys: ["upos.shipments.openTabs"] },
    { path: "/hr", keys: ["upos.hr.openTabs"] },
  ];

  function routeForHref(href) {
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return routes.find((route) => url.pathname === route.path) || null;
    } catch {
      return null;
    }
  }

  function rememberedUrl(route) {
    try {
      if (route.lastUrlKey) {
        const stored = normalizeTabId(localStorage.getItem(route.lastUrlKey));
        if (stored) {
          const url = new URL(stored, window.location.origin);
          if (url.origin === window.location.origin && routeAllowsPath(route, url.pathname)) {
            return `${url.pathname}${url.search}${url.hash}`;
          }
        }
      }
      for (const key of route.keys) {
        const saved = JSON.parse(localStorage.getItem(key) || "{}");
        const tabId = normalizeTabId(saved.activeTab || saved.lastActiveTab);
        if (!tabId) continue;
        const storedUrl = normalizeTabId(saved.tabState?.[tabId]?.url);
        const meta = saved.meta?.[tabId];
        const fallback = normalizeTabId(meta?.href) || (meta?.hash ? `${route.path}#${meta.hash}` : "");
        const url = new URL(storedUrl || fallback, window.location.origin);
        if (route.path === "/sales" && tabId === "journal" && !url.searchParams.has("view")) {
          url.searchParams.set("view", "journal");
        }
        if (url.origin === window.location.origin && routeAllowsPath(route, url.pathname)) {
          return `${url.pathname}${url.search}${url.hash}`;
        }
      }
    } catch {}
    return "";
  }

  function normalizeTabId(value) {
    return String(value || "").trim();
  }

  function routeAllowsPath(route, pathname) {
    return (route.allowedPaths || [route.path]).includes(pathname);
  }

  function rememberCurrentSection() {
    routes.forEach((route) => {
      if (!route.lastUrlKey || !routeAllowsPath(route, window.location.pathname)) return;
      // Стартовая страница модуля не должна стирать последнюю рабочую вкладку.
      // Память очищается только явной кнопкой закрытия самой вкладки.
      if (window.location.pathname === route.path) return;
      localStorage.setItem(
        route.lastUrlKey,
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      );
    });
  }

  function restoreSidebarLinks(scope = document) {
    scope.querySelectorAll("a.nav-link[href], a.nav-sublink[href]").forEach((link) => {
      const baseHref = link.dataset.workspaceBaseHref || link.getAttribute("href");
      const route = routeForHref(baseHref);
      if (!route) return;
      link.dataset.workspaceBaseHref = baseHref;
      const target = rememberedUrl(route);
      link.setAttribute("href", target || baseHref);
    });
  }

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a.nav-link[href], a.nav-sublink[href]");
      if (!link) return;
      const baseHref = link.dataset.workspaceBaseHref || link.getAttribute("href");
      const route = routeForHref(baseHref);
      if (!route) return;
      link.dataset.workspaceBaseHref = baseHref;
      const target = rememberedUrl(route);
      if (target) link.setAttribute("href", target);
    },
    true
  );

  window.addEventListener("storage", () => restoreSidebarLinks());

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        rememberCurrentSection();
        restoreSidebarLinks();
      },
      { once: true }
    );
  } else {
    rememberCurrentSection();
    restoreSidebarLinks();
  }
})();
