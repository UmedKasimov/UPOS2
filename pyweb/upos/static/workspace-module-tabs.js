(() => {
  "use strict";

  const controllers = new WeakMap();

  function normalize(value) {
    return String(value || "").trim();
  }

  function splitViews(value) {
    return normalize(value).split(/\s+/).filter(Boolean);
  }

  function unique(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function emptyState() {
    return {
      openTabs: [],
      activeTab: "",
      lastActiveTab: "",
      meta: {},
      tabState: {},
    };
  }

  function parseState(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      return {
        openTabs: Array.isArray(raw.openTabs) ? raw.openTabs : [],
        activeTab: typeof raw.activeTab === "string" ? raw.activeTab : "",
        lastActiveTab: typeof raw.lastActiveTab === "string" ? raw.lastActiveTab : "",
        meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
        tabState: raw.tabState && typeof raw.tabState === "object" ? raw.tabState : {},
      };
    } catch {
      return emptyState();
    }
  }

  function resolveTabId(source) {
    return normalize(
      source?.dataset.workspaceTabId ||
        source?.dataset.workspaceCard ||
        source?.dataset.workspaceTrigger ||
        source?.dataset.workspaceOpenTab
    );
  }

  function resolveViewId(source, fallback = "") {
    return normalize(
      source?.dataset.workspaceViewId ||
        source?.dataset.workspaceCard ||
        source?.dataset.workspaceTrigger ||
        fallback
    );
  }

  function createController(root) {
    const existingController = controllers.get(root);
    if (existingController) {
      existingController.refresh();
      return existingController;
    }
    if (root.dataset.workspaceTabsReady === "1") return null;

    const key = normalize(root.dataset.workspaceKey);
    const tabsShell = root.querySelector("[data-workspace-open-tabs]");
    const homeTab = root.querySelector("[data-workspace-home-tab]");
    const launcher = root.querySelector("[data-workspace-launcher]");
    if (!key || !tabsShell || !homeTab) return null;
    root.dataset.workspaceTabsReady = "1";

    const storageKey = `upos.${key}.openTabs`;
    const tabMeta = new Map();
    let openTabs = [];
    let activeTab = "";
    let lastActiveTab = "";
    let tabState = {};
    let lastSerializedState = "";

    function homeUrl() {
      const href = root.dataset.workspaceHomeHref || homeTab.getAttribute("href") || "";
      return href ? new URL(href, window.location.href) : new URL(window.location.href);
    }

    function registerMeta(source) {
      const tabId = resolveTabId(source);
      if (!tabId) return "";
      const existing = tabMeta.get(tabId) || {};
      const viewId = resolveViewId(source) || existing.viewId || tabId;
      const title =
        normalize(source.dataset.workspaceTabTitle) ||
        normalize(source.dataset.workspaceTitle) ||
        normalize(source.querySelector?.("[data-workspace-activate-tab]")?.textContent) ||
        normalize(source.textContent) ||
        existing.title ||
        tabId;
      const hash = normalize(
        source.dataset.workspaceTabHash || source.dataset.workspaceHash || existing.hash || tabId
      ).replace(/^#/, "");
      const href = normalize(
        source.dataset.workspaceTabHref ||
          source.getAttribute("href") ||
          existing.href ||
          source.dataset.workspaceSyncUrl ||
          ""
      );
      tabMeta.set(tabId, { id: tabId, viewId, title, hash, href });
      return tabId;
    }

    function collectMeta() {
      root
        .querySelectorAll("[data-workspace-card], [data-workspace-trigger], [data-workspace-open-tab]")
        .forEach(registerMeta);
    }

    function hydrateSavedMeta(savedMeta) {
      Object.entries(savedMeta || {}).forEach(([tabId, item]) => {
        if (!tabId || !item || typeof item !== "object") return;
        tabMeta.set(tabId, {
          id: tabId,
          viewId: normalize(item.viewId) || tabId,
          title: normalize(item.title) || tabId,
          hash: normalize(item.hash) || tabId,
          href: normalize(item.href),
        });
      });
    }

    function canonicalTabUrl(tabId) {
      const meta = tabMeta.get(tabId);
      if (!meta) return null;
      const base = meta.href || `${window.location.pathname}${window.location.search}`;
      const url = new URL(base, window.location.href);
      if (meta.hash) url.hash = meta.hash;
      return url;
    }

    function rememberedTabUrl(tabId) {
      const remembered = normalize(tabState[tabId]?.url);
      if (!remembered) return null;
      try {
        const url = new URL(remembered, window.location.origin);
        const meta = tabMeta.get(tabId);
        const expectedHash = normalize(meta?.hash).replace(/^#/, "");
        const rememberedHash = normalize(url.hash).replace(/^#/, "");
        if (expectedHash && rememberedHash !== expectedHash) {
          delete tabState[tabId];
          return null;
        }
        if (key === "sales" && tabId === "journal" && !url.searchParams.has("view")) {
          url.searchParams.set("view", "journal");
        }
        return url.origin === window.location.origin ? url : null;
      } catch {
        return null;
      }
    }

    function tabUrl(tabId) {
      return rememberedTabUrl(tabId) || canonicalTabUrl(tabId);
    }

    function matchesLocation(url, includeHash = false) {
      if (!url) return false;
      if (url.pathname !== window.location.pathname || url.search !== window.location.search) return false;
      return !includeHash || normalize(url.hash) === normalize(window.location.hash);
    }

    function tabFromLocation() {
      const hash = normalize(window.location.hash).replace(/^#/, "");
      const aliasMap = { telephony: { providers: "integrations" } };
      const aliasTab = aliasMap[key]?.[hash];
      if (aliasTab && tabMeta.has(aliasTab)) return aliasTab;

      if (key === "products" && hash === "price-type-detail") {
        const priceTypeId = new URLSearchParams(window.location.search).get("price_type");
        const priceTab = priceTypeId ? `price-type-${priceTypeId}` : "";
        if (priceTab && tabMeta.has(priceTab)) return priceTab;
      }

      if (hash && tabMeta.has(hash)) return hash;
      if (hash) {
        for (const [tabId, meta] of tabMeta.entries()) {
          if (meta.hash === hash) return tabId;
        }
      }
      for (const tabId of tabMeta.keys()) {
        if (matchesLocation(tabUrl(tabId), true)) return tabId;
      }
      if (!hash) return "";
      return "";
    }

    function ensureOpen(tabId) {
      if (tabId && !openTabs.includes(tabId)) openTabs.push(tabId);
    }

    function currentUrl() {
      return `${window.location.pathname}${window.location.search}${window.location.hash}`;
    }

    function rememberTab(tabId) {
      if (!tabId || !tabMeta.has(tabId)) return;
      const meta = tabMeta.get(tabId);
      const expectedHash = normalize(meta?.hash).replace(/^#/, "");
      const currentHash = normalize(window.location.hash).replace(/^#/, "");
      if (expectedHash && currentHash !== expectedHash) return;
      tabState[tabId] = { url: currentUrl() };
    }

    function saveState() {
      try {
        const meta = {};
        openTabs.forEach((tabId) => {
          const item = tabMeta.get(tabId);
          if (!item) return;
          meta[tabId] = {
            title: item.title,
            hash: item.hash,
            href: item.href,
            viewId: item.viewId,
          };
        });
        const serialized = JSON.stringify({ openTabs, activeTab, lastActiveTab, meta, tabState });
        if (serialized === lastSerializedState) return;
        localStorage.setItem(storageKey, serialized);
        lastSerializedState = serialized;
      } catch {}
    }

    function loadState() {
      const saved = parseState(storageKey);
      hydrateSavedMeta(saved.meta);
      collectMeta();
      openTabs = unique(saved.openTabs.filter((tabId) => tabMeta.has(tabId)));
      tabState = saved.tabState;

      const storedActive = tabMeta.has(saved.activeTab) ? saved.activeTab : "";
      lastActiveTab = tabMeta.has(saved.lastActiveTab) ? saved.lastActiveTab : storedActive;
      const defaultTab = normalize(root.dataset.workspaceDefaultTab);
      const forceTab = normalize(root.dataset.workspaceForceTab);
      const closeTabsOnLoad = splitViews(root.dataset.workspaceCloseTabsOnLoad);
      const hashTab = tabFromLocation();
      const hasLocationHash = Boolean(normalize(window.location.hash).replace(/^#/, ""));

      if (closeTabsOnLoad.length) {
        openTabs = openTabs.filter((tabId) => !closeTabsOnLoad.includes(tabId));
      }
      if (forceTab && tabMeta.has(forceTab)) {
        activeTab = forceTab;
      } else if (hashTab) {
        activeTab = hashTab;
      } else if (defaultTab && tabMeta.has(defaultTab)) {
        activeTab = defaultTab;
      } else if (hasLocationHash && storedActive && matchesLocation(tabUrl(storedActive))) {
        activeTab = storedActive;
      } else {
        activeTab = "";
      }

      if (activeTab) {
        lastActiveTab = activeTab;
        ensureOpen(activeTab);
      }
    }

    function syncLocalUrl(url) {
      if (!window.history?.replaceState || !url) return;
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      if (activeTab) rememberTab(activeTab);
      saveState();
    }

    function renderViews() {
      const currentView = activeTab ? tabMeta.get(activeTab)?.viewId || activeTab : "home";
      if (launcher) launcher.hidden = Boolean(activeTab);
      root.querySelectorAll("[data-workspace-view]").forEach((node) => {
        const views = splitViews(node.dataset.workspaceView);
        node.hidden = views.length ? !views.includes(currentView) : false;
      });
      root.querySelectorAll("[data-workspace-card]").forEach((card) => {
        const isActive = Boolean(activeTab) && normalize(card.dataset.workspaceCard) === currentView;
        card.classList.toggle("active", isActive);
        if (isActive) card.setAttribute("aria-current", "page");
        else card.removeAttribute("aria-current");
      });
    }

    function buildTabNode(tabId) {
      const holder = document.createElement("span");
      holder.className = "general-module-tab general-module-tab--report";
      holder.dataset.workspaceOpenTab = tabId;

      const syncButton = document.createElement("button");
      syncButton.type = "button";
      syncButton.className = "general-module-tab-sync";
      syncButton.title = "\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c";
      syncButton.setAttribute(
        "aria-label",
        "\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c"
      );
      syncButton.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3 12a9 9 0 0 1 14.7-7" /><path d="M17.7 5H13" /><path d="M17.7 5v4.7" />' +
        '<path d="M21 12a9 9 0 0 1-14.7 7" /><path d="M6.3 19H11" /><path d="M6.3 19v-4.7" /></svg>';

      const activateButton = document.createElement("button");
      activateButton.type = "button";
      activateButton.className = "general-module-tab-activate";
      activateButton.dataset.workspaceActivateTab = tabId;

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "general-module-tab-close";
      closeButton.dataset.workspaceCloseTab = tabId;
      closeButton.textContent = "\u00d7";

      holder.append(syncButton, activateButton, closeButton);
      return holder;
    }

    function renderTabs() {
      const homeActive = !activeTab;
      homeTab.classList.toggle("active", homeActive);
      homeTab.setAttribute("aria-current", homeActive ? "page" : "false");

      const existing = new Map();
      tabsShell.querySelectorAll("[data-workspace-open-tab]").forEach((node) => {
        const tabId = normalize(node.dataset.workspaceOpenTab);
        if (tabId && !existing.has(tabId)) existing.set(tabId, node);
        else node.remove();
      });

      let previous = homeTab;
      openTabs.forEach((tabId) => {
        const meta = tabMeta.get(tabId);
        if (!meta) return;
        let holder = existing.get(tabId);
        if (holder) existing.delete(tabId);
        else holder = buildTabNode(tabId);

        holder.classList.toggle("active", tabId === activeTab);
        holder.dataset.workspaceHash = meta.hash;
        const url = tabUrl(tabId);
        if (url) holder.dataset.workspaceSyncUrl = url.toString();
        const activate = holder.querySelector("[data-workspace-activate-tab]");
        if (activate) activate.textContent = meta.title;
        holder
          .querySelector("[data-workspace-close-tab]")
          ?.setAttribute("aria-label", `\u0417\u0430\u043a\u0440\u044b\u0442\u044c ${meta.title}`);

        if (previous.nextElementSibling !== holder) previous.after(holder);
        previous = holder;
      });
      existing.forEach((node) => node.remove());
    }

    function render() {
      renderTabs();
      renderViews();
    }

    function openTab(tabId, options = {}) {
      if (!tabMeta.has(tabId)) return;
      if (activeTab) rememberTab(activeTab);
      ensureOpen(tabId);
      activeTab = tabId;
      lastActiveTab = tabId;
      saveState();

      const url = options.url ? new URL(options.url, window.location.href) : tabUrl(tabId);
      if (options.navigate !== false && url && !matchesLocation(url)) {
        render();
        window.location.assign(url.toString());
        return;
      }
      render();
      if (url) syncLocalUrl(url);
    }

    function goHome(options = {}) {
      const homeTabId = normalize(root.dataset.workspaceHomeTabId);
      if (homeTabId && tabMeta.has(homeTabId)) {
        openTab(homeTabId, options);
        return;
      }
      if (activeTab) rememberTab(activeTab);
      activeTab = "";
      saveState();
      const url = homeUrl();
      if (options.navigate !== false && (!matchesLocation(url) || window.location.hash)) {
        window.location.assign(url.toString());
        return;
      }
      render();
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    function closeTab(tabId) {
      const index = openTabs.indexOf(tabId);
      if (index >= 0) openTabs.splice(index, 1);
      if (activeTab === tabId) activeTab = openTabs[index] || openTabs[index - 1] || "";
      delete tabState[tabId];
      if (lastActiveTab === tabId) lastActiveTab = activeTab;
      saveState();

      const url = activeTab ? tabUrl(activeTab) : homeUrl();
      if (url && (!matchesLocation(url) || normalize(url.hash) !== normalize(window.location.hash))) {
        window.location.assign(url.toString());
        return;
      }
      render();
      if (url) syncLocalUrl(url);
    }

    function bind() {
      homeTab.addEventListener("click", (event) => {
        event.preventDefault();
        goHome({ navigate: true });
      });

      root.addEventListener("click", (event) => {
        const homeTrigger = event.target.closest("[data-workspace-home-trigger]");
        if (homeTrigger && root.contains(homeTrigger)) {
          event.preventDefault();
          goHome({ navigate: true });
          return;
        }
        const trigger = event.target.closest("[data-workspace-card], [data-workspace-trigger]");
        if (!trigger || !root.contains(trigger)) return;
        const tabId = registerMeta(trigger);
        if (!tabId) return;
        event.preventDefault();
        openTab(tabId, {
          navigate: true,
          url: normalize(trigger.dataset.workspaceNavigateHref),
        });
      });

      tabsShell.addEventListener("click", (event) => {
        const closeButton = event.target.closest("[data-workspace-close-tab]");
        if (closeButton) {
          event.preventDefault();
          event.stopPropagation();
          closeTab(normalize(closeButton.dataset.workspaceCloseTab));
          return;
        }
        const activateButton = event.target.closest("[data-workspace-activate-tab]");
        if (!activateButton) return;
        event.preventDefault();
        openTab(normalize(activateButton.dataset.workspaceActivateTab), { navigate: true });
      });

      root.addEventListener(
        "submit",
        (event) => {
          const form = event.target;
          if (!(form instanceof HTMLFormElement)) return;
          if ((form.getAttribute("method") || "get").toLowerCase() !== "get" || !activeTab) return;
          const meta = tabMeta.get(activeTab);
          if (!meta?.hash) return;
          try {
            const url = new URL(form.getAttribute("action") || window.location.href, window.location.href);
            form.setAttribute("action", `${url.pathname}${url.search}#${meta.hash}`);
          } catch {}
        },
        true
      );

      window.addEventListener("hashchange", () => {
        const nextTab = tabFromLocation();
        const hasHash = Boolean(normalize(window.location.hash).replace(/^#/, ""));
        if (nextTab) {
          ensureOpen(nextTab);
          activeTab = nextTab;
          lastActiveTab = nextTab;
          rememberTab(nextTab);
          saveState();
          render();
        } else if (!hasHash) {
          activeTab = "";
          saveState();
          render();
        }
      });

      window.addEventListener("pagehide", () => {
        if (activeTab) rememberTab(activeTab);
        saveState();
      });
    }

    loadState();
    bind();
    render();
    saveState();
    if (activeTab) {
      const url = tabUrl(activeTab);
      if (url && matchesLocation(url)) syncLocalUrl(url);
    }

    const controller = {
      openTab,
      goHome,
      refresh() {
        collectMeta();
        render();
      },
    };
    controllers.set(root, controller);
    return controller;
  }

  function init(scope = document) {
    scope.querySelectorAll("[data-workspace-tabs]").forEach(createController);
  }

  window.initWorkspaceModuleTabs = init;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init(), { once: true });
  } else {
    init();
  }
})();
