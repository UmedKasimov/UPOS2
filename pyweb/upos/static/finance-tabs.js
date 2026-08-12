(() => {
  "use strict";

  const shell = document.querySelector("[data-finance-tabs]");
  if (!shell) return;

  const storageKey = "upos.finance.openTabs";
  const lastUrlKey = "upos.finance.lastUrl";
  const definitions = {
    home_account: {
      title: shell.dataset.financeAccountTitle || "Счёт",
      url: shell.dataset.financeAccountUrl || "/schet",
    },
    home_kassa: {
      title: shell.dataset.financeKassaTitle || "Касса",
      url: shell.dataset.financeKassaUrl || "/kassa",
    },
    home_earnings: {
      title: shell.dataset.financeEarningsTitle || "Заработок",
      url: shell.dataset.financeEarningsUrl || "/earnings",
    },
  };
  const allowed = new Set(
    String(shell.dataset.financeAllowed || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => definitions[value])
  );
  const currentTab = allowed.has(shell.dataset.financeCurrent)
    ? shell.dataset.financeCurrent
    : "";

  const normalizeTabs = (tabs) => [
    ...new Set((Array.isArray(tabs) ? tabs : []).filter((tab) => allowed.has(tab))),
  ];

  const readState = () => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        return { openTabs: [...allowed], activeTab: currentTab };
      }
      const raw = JSON.parse(stored || "{}");
      return {
        openTabs: normalizeTabs(raw.openTabs),
        activeTab: allowed.has(raw.activeTab) ? raw.activeTab : "",
      };
    } catch {
      return { openTabs: [], activeTab: "" };
    }
  };

  const writeState = (state) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        openTabs: normalizeTabs(state.openTabs),
        activeTab: allowed.has(state.activeTab) ? state.activeTab : "",
      }));
    } catch {}
  };

  const rememberCurrentTab = () => {
    if (!currentTab) return;
    const state = readState();
    writeState({
      openTabs: [...state.openTabs, currentTab],
      activeTab: currentTab,
    });
  };

  const closeTab = (tabId) => {
    const state = readState();
    const index = state.openTabs.indexOf(tabId);
    const openTabs = state.openTabs.filter((item) => item !== tabId);
    const nextTab = tabId === currentTab
      ? (openTabs[index] || openTabs[index - 1] || "")
      : (currentTab || state.activeTab);
    writeState({ openTabs, activeTab: nextTab });

    if (tabId === currentTab) {
      try {
        if (nextTab) localStorage.setItem(lastUrlKey, definitions[nextTab].url);
        else localStorage.removeItem(lastUrlKey);
      } catch {}
      window.location.assign(nextTab ? definitions[nextTab].url : "/finance?finance_home=1");
      return;
    }
    render();
  };

  const render = () => {
    shell.querySelectorAll("[data-finance-open-tab]").forEach((node) => node.remove());
    const homeTab = shell.querySelector("[data-finance-home-tab]");
    if (homeTab) {
      homeTab.classList.toggle("active", !currentTab);
      if (currentTab) homeTab.removeAttribute("aria-current");
      else homeTab.setAttribute("aria-current", "page");
    }

    readState().openTabs.forEach((tabId) => {
      const definition = definitions[tabId];
      const holder = document.createElement("span");
      holder.className = `general-module-tab general-module-tab--report${tabId === currentTab ? " active" : ""}`;
      holder.dataset.financeOpenTab = tabId;

      const activate = document.createElement("a");
      activate.className = "general-module-tab-activate";
      activate.href = definition.url;
      activate.textContent = definition.title;
      if (tabId === currentTab) activate.setAttribute("aria-current", "page");

      const close = document.createElement("button");
      close.type = "button";
      close.className = "general-module-tab-close";
      close.dataset.financeCloseTab = tabId;
      close.setAttribute("aria-label", `Закрыть ${definition.title}`);
      close.textContent = "×";
      close.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTab(tabId);
      });

      holder.append(activate, close);
      shell.appendChild(holder);
    });
  };

  rememberCurrentTab();
  render();
})();
