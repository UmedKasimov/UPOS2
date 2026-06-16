(() => {
  const routes = [
    { path: '/organizations/reports', keys: ['upos.generalReports.openTabs'] },
    { path: '/organizations/settings', keys: ['upos.orgSettings.openTabs'] },
    { path: '/organizations/users', keys: ['upos.orgSettings.openTabs'] },
    { path: '/organizations/shipments', keys: ['upos.shipments.openTabs'] },
    { path: '/organizations/hr', keys: ['upos.hr.openTabs'] },
    { path: '/sales', keys: ['upos.sales.openTabs'] },
    { path: '/products', keys: ['upos.products.openTabs'] },
    { path: '/warehouse', keys: ['upos.warehouse.openTabs'] },
    { path: '/clients', keys: ['upos.clients.openTabs'] },
    { path: '/suppliers', keys: ['upos.suppliers.openTabs'] },
    { path: '/crm', keys: ['upos.crm.openTabs'] },
    { path: '/telephony', keys: ['upos.telephony.openTabs'] },
    { path: '/messengers', keys: ['upos.messengers.openTabs'] },
    { path: '/reports', keys: ['upos.homeReports.openTabs'] },
    { path: '/shipments', keys: ['upos.shipments.openTabs'] },
    { path: '/hr', keys: ['upos.hr.openTabs'] },
    { path: '/adjustments', keys: ['upos.adjustments.openTabs'] },
  ];

  function resetActiveTab(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      const openTabs = Array.isArray(saved) ? saved : Array.isArray(saved.openTabs) ? saved.openTabs : [];
      localStorage.setItem(key, JSON.stringify({ openTabs, activeTab: '' }));
    } catch {
      localStorage.setItem(key, JSON.stringify({ openTabs: [], activeTab: '' }));
    }
  }

  function routeForHref(href) {
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return null;
    }
    if (url.origin !== window.location.origin) return null;
    return routes.find((route) => url.pathname === route.path) || null;
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a.nav-link[href], a.nav-sublink[href]');
    if (!link) return;
    const route = routeForHref(link.getAttribute('href'));
    if (!route) return;
    route.keys.forEach((key) => resetActiveTab(key));
  });
})();
