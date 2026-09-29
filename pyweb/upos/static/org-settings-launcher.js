(() => {
  const storageKey = 'upos.orgSettings.openTabs';

  const readTabs = () => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (Array.isArray(value)) return value;
      return Array.isArray(value.openTabs) ? value.openTabs : [];
    } catch {
      return [];
    }
  };

  const rememberTab = (tab) => {
    if (!tab) return;
    const tabs = readTabs().filter((item) => typeof item === 'string' && item);
    localStorage.setItem(storageKey, JSON.stringify({
      openTabs: [...new Set([...tabs, tab])],
      activeTab: tab,
    }));
  };

  document.querySelectorAll('[data-org-settings-launch-tab]').forEach((card) => {
    card.addEventListener('click', (event) => {
      const tab = card.getAttribute('data-org-settings-launch-tab');
      const href = card.getAttribute('href');
      rememberTab(tab);
      if (!href) return;
      event.preventDefault();
      window.location.assign(href);
    });
  });
})();
