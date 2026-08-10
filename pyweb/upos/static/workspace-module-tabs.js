(() => {
  const controllers = new WeakMap();

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
      const hash = normalize(window.location.hash).replace(/^#/, "");
      const aliasMap = {
        telephony: {
          providers: "integrations",
        },
      };
      const aliasTab = aliasMap[key]?.[hash];
      if (aliasTab && tabMeta.has(aliasTab)) return aliasTab;
      if (key === "products" && hash === "price-type-detail") {
        const priceTypeId = new URLSearchParams(window.location.search).get("price_type");
        const priceTab = priceTypeId ? `price-type-${priceTypeId}` : "";
        if (priceTab && tabMeta.has(priceTab)) return priceTab;
      }
      if (hash && tabMeta.has(hash)) return hash;
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
        // Подписи вкладок храним рядом с составом: ранний скрипт рисует панель
        // из этого же ключа, до разбора остальной страницы.
        const meta = {};
        openTabs.forEach((tabId) => {
          const item = tabMeta.get(tabId);
          if (item) meta[tabId] = { title: item.title, hash: item.hash };
        });
        localStorage.setItem(storageKey, JSON.stringify({ openTabs, activeTab, meta }));
      } catch {}
    }

    function loadState() {
      collectMeta();
      const saved = parseState(storageKey);
      openTabs = unique(saved.openTabs.filter((tabId) => tabMeta.has(tabId)));
      const storedActive = tabMeta.has(saved.activeTab) ? saved.activeTab : "";
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
        ensureOpen(forceTab);
        return;
      }
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
      if (!hasLocationHash) {
        activeTab = "";
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
      // Раньше страница прокручивалась к якорю вкладки и уезжала вниз: шапка
      // раздела оставалась выше экрана. Вкладку открываем с самого верха.
      window.scrollTo({ top: 0 });
    }

    function renderViews() {
      const currentView = activeTab ? tabMeta.get(activeTab)?.viewId || activeTab : "home";
      if (launcher) launcher.hidden = Boolean(activeTab);
      root.querySelectorAll("[data-workspace-view]").forEach((node) => {
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

    function buildTabNode(tabId) {
      const holder = document.createElement("span");
      holder.className = "general-module-tab general-module-tab--report";
      holder.dataset.workspaceOpenTab = tabId;

      // Кнопку синхронизации создаём сразу вместе с вкладкой, а не отдельным
      // проходом (module-tabs-sync.js) — иначе при каждой перезагрузке ⟳
      // заметно «исчезает и появляется». Обработчик клика навешивает
      // module-tabs-sync.js на уже готовую кнопку.
      const syncButton = document.createElement("button");
      syncButton.type = "button";
      syncButton.className = "general-module-tab-sync";
      syncButton.title = "Синхронизировать";
      syncButton.setAttribute("aria-label", "Синхронизировать");
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
      closeButton.textContent = "×";

      holder.append(syncButton, activateButton, closeButton);
      return holder;
    }

    function renderTabs() {
      const homeActive = !activeTab;
      homeTab.classList.toggle("active", homeActive);
      homeTab.setAttribute("aria-current", homeActive ? "page" : "false");

      // Узлы вкладок переиспользуются: раньше панель каждый раз собиралась
      // заново, и вкладки заметно мигали на каждом переходе.
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
        if (holder.dataset.workspaceHash !== meta.hash) holder.dataset.workspaceHash = meta.hash;
        const syncUrl = tabUrl(tabId);
        const syncValue = syncUrl ? syncUrl.toString() : "";
        if (syncValue && holder.dataset.workspaceSyncUrl !== syncValue) {
          holder.dataset.workspaceSyncUrl = syncValue;
        }
        const activateButton = holder.querySelector("[data-workspace-activate-tab]");
        if (activateButton && activateButton.textContent !== meta.title) {
          activateButton.textContent = meta.title;
        }
        const closeButton = holder.querySelector("[data-workspace-close-tab]");
        closeButton?.setAttribute("aria-label", `Закрыть ${meta.title}`);

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
      const meta = tabMeta.get(tabId);
      if (!meta) return;
      ensureOpen(tabId);
      activeTab = tabId;
      saveState();
      const url = tabUrl(tabId);
      if (options.navigate !== false && url && !matchesLocation(url)) {
        // Show the already-rendered panel immediately while the new URL loads.
        render();
        window.location.assign(url.toString());
        return;
      }
      render();
      if (url) syncLocalUrl(url);
    }

    function goHome(options = {}) {
      // У раздела без домашнего экрана кнопка раздела открывает главную
      // вкладку: в продажах карточек больше нет, и «домой» вело в пустоту.
      const homeTabId = normalize(root.dataset.workspaceHomeTabId);
      if (homeTabId && tabMeta.has(homeTabId)) {
        openTab(homeTabId, options);
        return;
      }
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

      // Фильтры, сортировка и размер страницы отправляют обычную форму с
      // жёстким якорем вида «#clients». После перезагрузки открывался не тот
      // раздел: сначала мелькала домашняя кнопка, потом возвращалась вкладка.
      // Подставляем в адрес формы якорь текущей вкладки — страница
      // возвращается ровно туда, где нажали.
      root.addEventListener("submit", (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        if ((form.getAttribute("method") || "get").toLowerCase() !== "get") return;
        if (!activeTab) return;
        const meta = tabMeta.get(activeTab);
        if (!meta || !meta.hash) return;
        try {
          const url = new URL(form.getAttribute("action") || window.location.href, window.location.href);
          form.setAttribute("action", `${url.pathname}${url.search}#${meta.hash}`);
        } catch {}
      }, true);

      window.addEventListener("hashchange", () => {
        const nextTab = tabFromLocation();
        const hasHash = Boolean(normalize(window.location.hash).replace(/^#/, ""));
        if (nextTab) {
          ensureOpen(nextTab);
          activeTab = nextTab;
          saveState();
          render();
        } else if (!hasHash) {
          activeTab = "";
          saveState();
          render();
        }
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
