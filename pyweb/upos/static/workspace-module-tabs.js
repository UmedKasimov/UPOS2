(() => {
  function parseState(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "{}");
      return {
        openTabs: Array.isArray(raw.openTabs) ? raw.openTabs : [],
        activeTab: typeof raw.activeTab === "string" ? raw.activeTab : "",
      };
    } catch {
      return { openTabs: [], activeTab: "" };
    }
  }

  function normalize(value) {
    return String(value || "").trim();
  }

  function splitViews(value) {
    return String(value || "")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function unique(items) {
    return Array.from(new Set(items.filter(Boolean)));
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
    const key = normalize(root.dataset.workspaceKey);
    const tabsShell = root.querySelector("[data-workspace-open-tabs]");
    const homeTab = root.querySelector("[data-workspace-home-tab]");
    const launcher = root.querySelector("[data-workspace-launcher]");
    const viewNodes = Array.from(root.querySelectorAll("[data-workspace-view]"));
    if (!key || !tabsShell || !homeTab) return null;

    const storageKey = `upos.${key}.openTabs`;
    const tabMeta = new Map();
    let openTabs = [];
    let activeTab = "";

    function homeUrl() {
      const href = root.dataset.workspaceHomeHref || homeTab.getAttribute("href") || "";
      return href ? new URL(href, window.location.href) : new URL(window.location.href);
    }

    function registerMeta(source) {
      const tabId = resolveTabId(source);
      if (!tabId) return "";
      const viewId = resolveViewId(source, tabId);
      const title =
        normalize(source.dataset.workspaceTabTitle) ||
        normalize(source.dataset.workspaceTitle) ||
        normalize(source.textContent);
      const hash = normalize(source.dataset.workspaceTabHash || source.dataset.workspaceHash || tabId).replace(/^#/, "");
      const href = normalize(
        source.dataset.workspaceTabHref || source.dataset.workspaceSyncUrl || source.getAttribute("href") || ""
      );
      tabMeta.set(tabId, { id: tabId, viewId, title: title || tabId, hash, href });
      return tabId;
    }

    function collectMeta() {
      root
        .querySelectorAll("[data-workspace-card], [data-workspace-trigger]")
        .forEach(registerMeta);
    }

    function tabUrl(tabId) {
      const meta = tabMeta.get(tabId);
      if (!meta) return null;
      const base = meta.href || `${window.location.pathname}${window.location.search}`;
      const url = new URL(base, window.location.href);
      if (meta.hash) url.hash = meta.hash;
      return url;
    }

    function matchesLocation(url) {
      if (!url) return false;
      return url.pathname === window.location.pathname && url.search === window.location.search;
    }

    function tabFromLocation() {
      for (const tabId of tabMeta.keys()) {
        const url = tabUrl(tabId);
        if (!url) continue;
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search &&
          normalize(url.hash) === normalize(window.location.hash)
        ) {
          return tabId;
        }
      }
      const hash = normalize(window.location.hash).replace(/^#/, "");
      if (!hash) return "";
      for (const [tabId, meta] of tabMeta.entries()) {
        if (meta.hash === hash) return tabId;
      }
      return "";
    }

    function ensureOpen(tabId) {
      if (tabId && !openTabs.includes(tabId)) openTabs.push(tabId);
    }

    function saveState() {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ openTabs, activeTab }));
      } catch {}
    }

    function loadState() {
      collectMeta();
      const saved = parseState(storageKey);
      openTabs = unique(saved.openTabs.filter((tabId) => tabMeta.has(tabId)));
      const storedActive = tabMeta.has(saved.activeTab) ? saved.activeTab : "";
      const defaultTab = normalize(root.dataset.workspaceDefaultTab);
      const hashTab = tabFromLocation();

      if (hashTab) {
        activeTab = hashTab;
        ensureOpen(hashTab);
        return;
      }
      if (defaultTab && tabMeta.has(defaultTab)) {
        activeTab = defaultTab;
        ensureOpen(defaultTab);
        return;
      }
      if (storedActive) {
        const currentUrl = tabUrl(storedActive);
        if (!currentUrl || matchesLocation(currentUrl)) {
          activeTab = storedActive;
          ensureOpen(storedActive);
          return;
        }
      }
      activeTab = "";
    }

    function syncLocalUrl(url) {
      if (!window.history?.replaceState || !url) return;
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(null, "", next);
      if (url.hash) {
        const target = document.getElementById(url.hash.slice(1));
        target?.scrollIntoView({ block: "start" });
      }
    }

    function renderViews() {
      const currentView = activeTab ? tabMeta.get(activeTab)?.viewId || activeTab : "home";
      if (launcher) launcher.hidden = Boolean(activeTab);
      viewNodes.forEach((node) => {
        const views = splitViews(node.dataset.workspaceView);
        node.hidden = views.length ? !views.includes(currentView) : false;
      });
      root.querySelectorAll("[data-workspace-card]").forEach((card) => {
        const cardId = normalize(card.dataset.workspaceCard);
        const isActive = Boolean(activeTab) && cardId === currentView;
        card.classList.toggle("active", isActive);
        if (isActive) {
          card.setAttribute("aria-current", "page");
        } else {
          card.removeAttribute("aria-current");
        }
      });
    }

    function renderTabs() {
      tabsShell.querySelectorAll("[data-workspace-open-tab]").forEach((node) => node.remove());
      const homeActive = !activeTab;
      homeTab.classList.toggle("active", homeActive);
      homeTab.setAttribute("aria-current", homeActive ? "page" : "false");

      openTabs.forEach((tabId) => {
        const meta = tabMeta.get(tabId);
        if (!meta) return;
        const holder = document.createElement("span");
        holder.className = `general-module-tab general-module-tab--report${tabId === activeTab ? " active" : ""}`;
        holder.dataset.workspaceOpenTab = tabId;
        holder.dataset.workspaceHash = meta.hash;
        const syncUrl = tabUrl(tabId);
        if (syncUrl) holder.dataset.workspaceSyncUrl = syncUrl.toString();

        const activateButton = document.createElement("button");
        activateButton.type = "button";
        activateButton.className = "general-module-tab-activate";
        activateButton.dataset.workspaceActivateTab = tabId;
        activateButton.textContent = meta.title;

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "general-module-tab-close";
        closeButton.dataset.workspaceCloseTab = tabId;
        closeButton.setAttribute("aria-label", `Закрыть ${meta.title}`);
        closeButton.textContent = "×";

        holder.append(activateButton, closeButton);
        tabsShell.append(holder);
      });
    }

    function render() {
      renderTabs();
      renderViews();
    }

    function openTab(tabId, options = {}) {
      const meta = tabMeta.get(tabId);
      if (!meta) return;
      ensureOpen(tabId);
      activeTab = tabId;
      saveState();
      const url = tabUrl(tabId);
      if (options.navigate !== false && url && !matchesLocation(url)) {
        window.location.assign(url.toString());
        return;
      }
      render();
      if (url) syncLocalUrl(url);
    }

    function goHome(options = {}) {
      activeTab = "";
      saveState();
      const url = homeUrl();
      if (options.navigate !== false && (!matchesLocation(url) || window.location.hash)) {
        window.location.assign(url.toString());
        return;
      }
      render();
      syncLocalUrl(url);
    }

    function closeTab(tabId) {
      const index = openTabs.indexOf(tabId);
      if (index >= 0) openTabs.splice(index, 1);
      if (activeTab === tabId) {
        activeTab = openTabs[index] || openTabs[index - 1] || "";
      }
      saveState();
      if (activeTab) {
        const nextUrl = tabUrl(activeTab);
        if (nextUrl && !matchesLocation(nextUrl)) {
          window.location.assign(nextUrl.toString());
          return;
        }
      } else {
        const url = homeUrl();
        if (!matchesLocation(url) || window.location.hash) {
          window.location.assign(url.toString());
          return;
        }
      }
      render();
      syncLocalUrl(activeTab ? tabUrl(activeTab) : homeUrl());
    }

    function handleTrigger(source, tabId) {
      registerMeta(source);
      openTab(tabId, { navigate: true });
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
        const tabId = resolveTabId(trigger);
        if (!tabId) return;
        event.preventDefault();
        handleTrigger(trigger, tabId);
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
    }

    loadState();
    bind();
    render();
    saveState();
    if (activeTab) {
      const url = tabUrl(activeTab);
      if (url && matchesLocation(url)) syncLocalUrl(url);
    }
    return { openTab, goHome };
  }

  function init() {
    document.querySelectorAll("[data-workspace-tabs]").forEach(createController);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
