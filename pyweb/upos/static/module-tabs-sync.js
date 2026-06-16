(() => {
  function tabHash(button) {
    const tab = button.closest('.general-module-tab--report');
    if (!tab) return '';
    const candidates = [
      tab.dataset.workspaceHash,
      tab.dataset.workspaceOpenTab,
      tab.dataset.hrOpenTab,
      tab.dataset.shipmentOpenTab,
      tab.dataset.orgSettingsOpenTab,
      tab.getAttribute('data-report-open-tab'),
      tab.getAttribute('data-org-report-open-tab'),
    ];
    const raw = candidates.find(Boolean);
    return raw ? `#${raw}` : '';
  }

  function syncNow(button) {
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add('is-syncing');
    button.setAttribute('aria-label', '\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044f');

    const workspaceUrl = button.closest('.general-module-tab--report')?.dataset.workspaceSyncUrl;
    if (workspaceUrl) {
      const target = new URL(workspaceUrl, window.location.href);
      target.searchParams.set('t', String(Date.now()));
      window.location.assign(target.toString());
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('t', String(Date.now()));
    const settingsTab = button.closest('.general-module-tab--report')?.dataset.orgSettingsOpenTab;
    if (settingsTab) {
      url.searchParams.set('tab', settingsTab);
      window.location.assign(url.toString());
      return;
    }
    const hash = tabHash(button);
    if (hash) url.hash = hash;
    window.location.assign(url.toString());
  }

  function syncStaticTab(icon) {
    const tab = icon.closest('.general-module-tab, .settings-tab--rail');
    if (!tab) return;
    const url = new URL(window.location.href);
    const href = tab.getAttribute('href');
    if (href) {
      const target = new URL(href, window.location.href);
      target.searchParams.set('t', String(Date.now()));
      window.location.assign(target.toString());
      return;
    }
    const settingsTab = tab.getAttribute('data-settings-tab');
    if (settingsTab) {
      url.searchParams.set('tab', settingsTab);
    }
    const hrTab = tab.getAttribute('data-hr-home-tab');
    const shipmentTab = tab.getAttribute('data-shipment-home-tab');
    const reportTab = tab.getAttribute('data-report-home-tab') || tab.getAttribute('data-org-report-home-tab');
    if (hrTab || shipmentTab || reportTab) {
      url.hash = '';
    }
    url.searchParams.set('t', String(Date.now()));
    window.location.assign(url.toString());
  }

  function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'general-module-tab-sync';
    button.title = '\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c';
    button.setAttribute('aria-label', '\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 0 1 14.7-7" />
        <path d="M17.7 5H13" />
        <path d="M17.7 5v4.7" />
        <path d="M21 12a9 9 0 0 1-14.7 7" />
        <path d="M6.3 19H11" />
        <path d="M6.3 19v-4.7" />
      </svg>
    `;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      syncNow(button);
    });
    return button;
  }

  function mountReportTab(tab) {
    if (tab.querySelector('.general-module-tab-sync')) return;
    const activate = tab.querySelector('.general-module-tab-activate');
    if (!activate) return;
    tab.insertBefore(createButton(), activate);
  }

  function createStaticIcon() {
    const icon = document.createElement('span');
    icon.className = 'general-module-tab-sync-icon';
    icon.setAttribute('role', 'button');
    icon.setAttribute('tabindex', '0');
    icon.setAttribute('aria-label', '\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u043e\u0432\u0430\u0442\u044c');
    icon.innerHTML = createButton().innerHTML;
    icon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      syncStaticTab(icon);
    });
    icon.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      syncStaticTab(icon);
    });
    return icon;
  }

  function mountStaticTab(tab) {
    if (tab.classList.contains('general-module-tab--report')) return;
    tab.querySelector('.general-module-tab-sync-icon')?.remove();
  }

  function mount() {
    document.querySelectorAll('.general-module-tab--report').forEach(mountReportTab);
    document.querySelectorAll('.general-module-tabs .general-module-tab, .settings-tablist--rail .settings-tab--rail').forEach(mountStaticTab);
    document.querySelectorAll('.general-module-tabs').forEach((tabs) => {
      if (tabs.dataset.moduleTabsSyncObserver === '1') return;
      tabs.dataset.moduleTabsSyncObserver = '1';
      new MutationObserver(() => {
        tabs.querySelectorAll('.general-module-tab--report').forEach(mountReportTab);
        tabs.querySelectorAll('.general-module-tab').forEach(mountStaticTab);
      }).observe(tabs, { childList: true, subtree: true });
    });
    document.querySelectorAll('.settings-tablist--rail').forEach((tabs) => {
      if (tabs.dataset.moduleTabsSyncObserver === '1') return;
      tabs.dataset.moduleTabsSyncObserver = '1';
      new MutationObserver(() => {
        tabs.querySelectorAll('.settings-tab--rail').forEach(mountStaticTab);
      }).observe(tabs, { childList: true, subtree: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
