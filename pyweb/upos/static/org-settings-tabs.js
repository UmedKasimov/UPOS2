(() => {
  const shell = document.querySelector('.settings-module-tabs');
  if (!shell) return;

  const config = window.orgSettingsTabs || {};
  const labels = config.labels || {};
  const urls = config.urls || {};
  const baseUrl = config.baseUrl || '/settings';
  const homeUrl = config.homeUrl || '/organizations/settings';
  const storageKey = 'upos.orgSettings.openTabs';
  const currentUrl = new URL(window.location.href);
  const currentTab = labels[config.currentTab]
    ? config.currentTab
    : (labels[currentUrl.searchParams.get('tab')] ? currentUrl.searchParams.get('tab') : '');

  const tabUrl = (tab) => {
    if (urls[tab]) return new URL(urls[tab], window.location.href).toString();
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set('tab', tab);
    return url.toString();
  };

  const normalizeTabs = (tabs) => [...new Set((Array.isArray(tabs) ? tabs : []).filter((tab) => labels[tab]))];

  const readState = () => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (Array.isArray(value)) {
        return { openTabs: normalizeTabs(value), activeTab: '' };
      }
      return {
        openTabs: normalizeTabs(value.openTabs),
        activeTab: labels[value.activeTab] ? value.activeTab : '',
      };
    } catch {
      return { openTabs: [], activeTab: '' };
    }
  };

  const writeState = (state) => {
    localStorage.setItem(storageKey, JSON.stringify({
      openTabs: normalizeTabs(state.openTabs),
      activeTab: labels[state.activeTab] ? state.activeTab : '',
    }));
  };

  const rememberActiveTab = (tab) => {
    if (!labels[tab]) return;
    const state = readState();
    writeState({
      openTabs: normalizeTabs([...state.openTabs, tab]),
      activeTab: tab,
    });
  };

  const closeTab = (tab) => {
    const state = readState();
    const index = state.openTabs.indexOf(tab);
    const nextTabs = state.openTabs.filter((item) => item !== tab);
    const nextActive = tab === currentTab ? (nextTabs[index] || nextTabs[index - 1] || '') : state.activeTab;
    writeState({ openTabs: nextTabs, activeTab: nextActive });
    if (tab === currentTab) {
      window.location.assign(nextActive ? tabUrl(nextActive) : new URL(homeUrl, window.location.href).toString());
      return;
    }
    render();
  };

  const bindHomeTab = () => {
    const homeTab = shell.querySelector('[data-org-settings-home-tab]');
    if (!homeTab) return;
    const homeActive = !currentTab && new URL(homeUrl, window.location.href).pathname === currentUrl.pathname;
    homeTab.classList.toggle('active', homeActive);
    if (homeActive) homeTab.setAttribute('aria-current', 'page');
    else homeTab.removeAttribute('aria-current');
    homeTab.addEventListener('click', () => {
      const state = readState();
      writeState({ openTabs: state.openTabs, activeTab: '' });
    }, { once: true });
  };

  const render = () => {
    shell.querySelectorAll('[data-org-settings-open-tab]').forEach((node) => node.remove());
    bindHomeTab();
    readState().openTabs.forEach((tab) => {
      const item = document.createElement('span');
      item.className = `general-module-tab general-module-tab--report${tab === currentTab ? ' active' : ''}`;
      item.dataset.orgSettingsOpenTab = tab;

      const activate = document.createElement('a');
      activate.className = 'general-module-tab-activate';
      activate.href = tabUrl(tab);
      activate.textContent = labels[tab];
      if (tab === currentTab) activate.setAttribute('aria-current', 'page');

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'general-module-tab-close';
      close.setAttribute('aria-label', `Закрыть ${labels[tab]}`);
      close.textContent = '×';
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTab(tab);
      });

      item.append(activate, close);
      shell.appendChild(item);
    });
  };

  if (currentTab) {
    rememberActiveTab(currentTab);
  } else if (config.restoreActive !== false) {
    const state = readState();
    if (state.activeTab) {
      window.location.replace(tabUrl(state.activeTab));
      return;
    }
  }
  render();
})();
