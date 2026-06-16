/**
 * Общие отчёты: консолидированное ОиУ + сводные остатки.
 */
(function () {
  const root = document.getElementById('general-reports-root');
  if (!root) return;

  function t(key, fallback) {
    const pack = window.upos_i18n || {};
    return pack[key] || fallback || key;
  }

  function tf(key, params, fallback) {
    let text = t(key, fallback);
    Object.entries(params || {}).forEach(([name, value]) => {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    });
    return text;
  }

  const tzMeta = document.querySelector('meta[name="general-reports-timezone"]');
  const workspaceTz = (tzMeta?.getAttribute('content') || 'Asia/Tashkent').trim();

  let organizations = [];
  try {
    const blob = document.getElementById('general-reports-orgs');
    if (blob?.textContent) organizations = JSON.parse(blob.textContent);
  } catch {
    organizations = [];
  }

  const state = {
    tab: '',
    period: 'month',
    dateFrom: '',
    dateTo: '',
    organizationId: '',
    displayCurrency: 'USD',
  };

  let lastPnl = null;
  let lastTreasury = null;

  const reportTabMeta = {
    pnl: { title: 'P&L' },
    balance: { title: 'Баланс' },
    cashflow: { title: 'Cash Flow' },
    odds: { title: 'ОДДС' },
    dds: { title: 'ДДС' },
  };
  const openReportTabs = [];
  const reportsStorageKey = 'upos.generalReports.openTabs';

  function reportTitle(tab) {
    return reportTabMeta[tab]?.title || reportTabMeta.pnl.title;
  }

  function ensureOpenReportTab(tab) {
    if (!reportTabMeta[tab]) return;
    if (!openReportTabs.includes(tab)) openReportTabs.push(tab);
  }

  function saveReportTabs() {
    try {
      localStorage.setItem(reportsStorageKey, JSON.stringify({ openTabs: openReportTabs, activeTab: state.tab }));
    } catch {
      /* localStorage can be unavailable in private contexts. */
    }
  }

  function restoreReportTabs() {
    try {
      const saved = JSON.parse(localStorage.getItem(reportsStorageKey) || '{}');
      const tabs = Array.isArray(saved.openTabs) ? saved.openTabs.filter((tab) => reportTabMeta[tab]) : [];
      tabs.forEach(ensureOpenReportTab);
      state.tab = reportTabMeta[saved.activeTab] ? saved.activeTab : '';
      if (state.tab) ensureOpenReportTab(state.tab);
    } catch {
      state.tab = '';
    }
  }

  function closeReportTab(tab) {
    const idx = openReportTabs.indexOf(tab);
    if (idx === -1) return;
    openReportTabs.splice(idx, 1);
    if (state.tab === tab) {
      state.tab = openReportTabs[idx] || openReportTabs[idx - 1] || '';
    }
    render();
  }

  function renderOpenReportTabs() {
    const shell = document.querySelector('[data-report-open-tabs]');
    if (!shell) return;
    shell.querySelectorAll('[data-report-open-tab]').forEach((node) => node.remove());
    const homeTab = shell.querySelector('[data-report-home-tab]');
    if (homeTab) {
      const homeActive = !state.tab;
      homeTab.classList.toggle('active', homeActive);
      if (homeActive) homeTab.setAttribute('aria-current', 'page');
      else homeTab.removeAttribute('aria-current');
    }

    openReportTabs.forEach((tab) => {
      const item = document.createElement('span');
      item.className = 'general-module-tab general-module-tab--report';
      item.setAttribute('data-report-open-tab', tab);

      const activate = document.createElement('button');
      activate.type = 'button';
      activate.className = 'general-module-tab-activate';
      activate.setAttribute('data-gr-tab', tab);
      activate.setAttribute('role', 'tab');
      activate.textContent = reportTitle(tab);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'general-module-tab-close';
      close.setAttribute('data-report-close-tab', tab);
      close.setAttribute('aria-label', `Закрыть вкладку ${reportTitle(tab)}`);
      close.textContent = '×';

      item.append(activate, close);
      shell.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(n, ccy) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    const cur = String(ccy || '').trim().toUpperCase();
    const sign = x < 0 ? '-' : '';
    const amount = Math.round(Math.abs(x)).toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return cur ? `${sign}${amount} ${cur}` : `${sign}${amount}`;
  }

  const currencyOrder = ['UZS', 'USD', 'RUB', 'EUR'];

  function sortedCurrencyEntries(map) {
    return Object.entries(map || {})
      .filter(([, value]) => Number(value))
      .sort(([a], [b]) => {
        const ai = currencyOrder.indexOf(String(a || '').toUpperCase());
        const bi = currencyOrder.indexOf(String(b || '').toUpperCase());
        const ap = ai === -1 ? currencyOrder.length : ai;
        const bp = bi === -1 ? currencyOrder.length : bi;
        if (ap !== bp) return ap - bp;
        return String(a || '').localeCompare(String(b || ''));
      });
  }

  function chipRow(map) {
    const entries = sortedCurrencyEntries(map);
    if (!entries.length) return '<span class="general-kassa-chip-muted">—</span>';
    return entries
      .map(([ccy, amt]) => `<span class="general-kassa-chip">${escapeHtml(formatMoney(amt, ccy))}</span>`)
      .join('');
  }

  function reportsKpiCard(label, valueHtml, toneClass, cardClass) {
    return `<article class="gk-reports-kpi-card ${cardClass}">
      <p class="gk-reports-kpi-label">${escapeHtml(label)}</p>
      <p class="gk-reports-kpi-value${toneClass ? ` ${toneClass}` : ''}">${valueHtml}</p>
    </article>`;
  }

  function pnlQuery() {
    const q = new URLSearchParams();
    q.set('timezone', workspaceTz);
    q.set('period', state.period);
    if (state.period === 'custom') {
      if (state.dateFrom) q.set('date_from', state.dateFrom);
      if (state.dateTo) q.set('date_to', state.dateTo);
    }
    if (state.organizationId) q.set('organization_id', state.organizationId);
    return q.toString();
  }

  function treasuryQuery() {
    const q = new URLSearchParams();
    if (state.organizationId) q.set('organization_id', state.organizationId);
    q.set('display_currency', state.displayCurrency);
    return q.toString();
  }

  function syncHeaderTabs() {
    renderOpenReportTabs();
    document.querySelectorAll('[data-gr-tab]').forEach((btn) => {
      const t = btn.getAttribute('data-gr-tab');
      const on = t === state.tab;
      btn.classList.toggle('active', on);
      btn.closest('[data-report-open-tab]')?.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function showLoadingSkeleton() {
    const overview = root.querySelector('[data-gr-overview]');
    if (overview) {
      overview.innerHTML = `<div class="gk-skeleton-grid" aria-hidden="true">${'<div class="gk-skeleton"></div>'.repeat(4)}</div>`;
    }
  }

  async function loadAll() {
    showLoadingSkeleton();
    const st = root.querySelector('[data-gr-status]');
    if (st) st.textContent = '';
    try {
      const [pnlRes, trRes] = await Promise.all([
        fetch(`/api/director/consolidated-pnl?${pnlQuery()}`),
        fetch(`/api/director/consolidated-treasury?${treasuryQuery()}`),
      ]);
      lastPnl = await pnlRes.json().catch(() => ({}));
      lastTreasury = await trRes.json().catch(() => ({}));
      if (!pnlRes.ok) throw new Error(lastPnl.error || `PnL HTTP ${pnlRes.status}`);
      if (!trRes.ok) throw new Error(lastTreasury.error || `Treasury HTTP ${trRes.status}`);
      render();
      syncDisplayCurrencyOptions();
    } catch (e) {
      const overview = root.querySelector('[data-gr-overview]');
      if (overview) overview.innerHTML = '';
      const panel = root.querySelector('[data-gr-panels]');
      if (panel) {
        panel.innerHTML = `<div class="general-kassa-error">${escapeHtml(e.message || t('general.error_loading', 'Loading error'))}</div>`;
      }
    }
  }

  function syncDisplayCurrencyOptions() {
    const sel = root.querySelector('[data-gr-display-ccy]');
    if (!sel || !lastTreasury) return;
    const set = new Set(['USD', 'EUR', 'UZS', 'RUB']);
    Object.keys(lastTreasury.consolidated_totals_by_currency || {}).forEach((c) => set.add(c));
    const opts = [...set].sort();
    const keep = state.displayCurrency;
    sel.innerHTML = opts.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    sel.value = opts.includes(keep) ? keep : 'USD';
    state.displayCurrency = sel.value;
  }

  function renderTable(title, rows, toneIncome) {
    if (!rows?.length) {
      return `<section class="general-reports-section"><h3 class="general-reports-h3">${escapeHtml(title)}</h3><p class="general-kassa-chip-muted">${escapeHtml(t('general.no_data', 'No data'))}</p></section>`;
    }
    const body = rows
      .map(
        (r) => `<tr>
        <td>${escapeHtml(r.name || '')}</td>
        <td class="general-reports-num ${toneIncome ? 'is-inc' : 'is-exp'}">${escapeHtml(formatMoney(r.amount, r.currency))}</td>
        <td class="general-reports-num">${escapeHtml(String(r.count ?? ''))}</td>
      </tr>`,
      )
      .join('');
    return `<section class="general-reports-section">
      <h3 class="general-reports-h3">${escapeHtml(title)}</h3>
      <div class="general-kassa-table-wrap">
        <table class="general-kassa-table">
          <thead><tr><th>${escapeHtml(t('general.category', 'Category'))}</th><th class="gk-col-num">${escapeHtml(t('general.amount', 'Amount'))}</th><th class="gk-col-num">${escapeHtml(t('general.ops_short', 'Ops'))}</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
  }

  function renderOrgPnLStrip() {
    const rows = lastPnl?.by_organization || [];
    if (!rows.length) return '';
    const cards = rows
      .map((org) => {
        const net = org.net_by_currency || {};
        return `<article class="general-reports-org-strip">
          <h4>${escapeHtml(org.organization_name || '')}</h4>
          <div class="gk-metric-chips">${chipRow(net)}</div>
        </article>`;
      })
      .join('');
    return `<section class="general-reports-section"><h3 class="general-reports-h3">${escapeHtml(t('general.net_by_org', 'Net result by organization'))}</h3><div class="general-reports-org-grid">${cards}</div></section>`;
  }

  function computePnLMaps() {
    const income = lastPnl?.income || [];
    const expense = lastPnl?.expense || [];
    let pri = 'USD';
    const incMap = {};
    const expMap = {};
    income.forEach((r) => {
      const c = String(r.currency || '').toUpperCase();
      incMap[c] = Math.round(((incMap[c] || 0) + Number(r.amount || 0)) * 100) / 100;
    });
    expense.forEach((r) => {
      const c = String(r.currency || '').toUpperCase();
      expMap[c] = Math.round(((expMap[c] || 0) + Number(r.amount || 0)) * 100) / 100;
    });
    const ccys = new Set([...Object.keys(incMap), ...Object.keys(expMap)]);
    if (ccys.has('USD')) pri = 'USD';
    else if (ccys.size) pri = [...ccys].sort()[0];
    const incPri = Math.round((incMap[pri] || 0) * 100) / 100;
    const expPri = Math.round((expMap[pri] || 0) * 100) / 100;
    const netPri = Math.round((incPri - expPri) * 100) / 100;
    return { pri, incMap, expMap, ccys, incPri, expPri, netPri, income, expense };
  }

  function renderOverview() {
    const el = root.querySelector('[data-gr-overview]');
    if (!el || !lastPnl || !lastTreasury) return;

    if (state.tab === 'balance') {
      const data = lastTreasury;
      const fxWarn = [];
      if (data.fx?.stale) fxWarn.push(t('general.fx_stale', 'FX rates may be stale.'));
      if ((data.fx_missing_currencies || []).length)
        fxWarn.push(tf('general.fx_missing', { list: data.fx_missing_currencies.join(', ') }, 'Missing rates for: {list}'));
      const approx =
        data.approx_total_in_display != null
          ? formatMoney(data.approx_total_in_display, data.display_currency)
          : '—';
      const chips =
        Object.entries(data.consolidated_totals_by_currency || {})
          .filter(([, v]) => Number(v))
          .map(([ccy, amt]) => `<span class="general-kassa-chip">${escapeHtml(formatMoney(amt, ccy))}</span>`)
          .join('') || `<span class="general-kassa-chip-muted">${escapeHtml(t('general.no_balances', 'No balances'))}</span>`;
      el.className = 'gk-schet-hero';
      el.innerHTML = `
        <p class="settings-ios-footnote">${escapeHtml(t('general.reports.tab.balance', 'Balances'))}</p>
        <p class="gk-schet-hero-total">${escapeHtml(approx)}</p>
        <p class="gk-schet-hero-meta">${escapeHtml(data.display_currency || 'USD')}${fxWarn.length ? ` · ${escapeHtml(fxWarn.join(' '))}` : ''}</p>
        <div class="gk-schet-hero-chips" role="group" aria-label="${escapeHtml(t('general.by_currency', 'By currency'))}">${chips}</div>
      `;
      return;
    }

    const meta = lastPnl.period_meta || {};
    const { pri, incPri, expPri, netPri } = computePnLMaps();
    el.className = 'gk-kpi-strip';
    el.innerHTML = `
      <div class="gk-kpi-strip-head">
        <p class="settings-ios-footnote">${escapeHtml(reportTitle(state.tab))} · ${escapeHtml(meta.label || '—')}</p>
      </div>
      <div class="gk-reports-kpi-grid" role="group" aria-label="${escapeHtml(t('general.metrics_aria', 'Metrics'))}">
        ${reportsKpiCard(tf('general.income_currency', { currency: pri }, 'Income ({currency})'), escapeHtml(formatMoney(incPri, pri)), 'is-inc', 'gk-reports-kpi-card--income')}
        ${reportsKpiCard(tf('general.expense_currency', { currency: pri }, 'Expense ({currency})'), escapeHtml(formatMoney(expPri, pri)), 'is-exp', 'gk-reports-kpi-card--expense')}
        ${reportsKpiCard(tf('general.profit_currency', { currency: pri }, 'Profit ({currency})'), escapeHtml(formatMoney(netPri, pri)), netPri >= 0 ? 'is-inc' : 'is-exp', 'gk-reports-kpi-card--result')}
      </div>
    `;
  }

  function renderBalanceTab() {
    const data = lastTreasury;
    if (!data) return '';

    const orgCards = (data.organizations || [])
      .map((org) => {
        const openUrl = `/organizations/open-schet?organization_id=${encodeURIComponent(org.organization_id)}`;
        return `<article class="organization-card gk-org-card">
          <header class="gk-org-card-head">
            <div>
              <h3 class="gk-org-card-title">${escapeHtml(org.organization_name || '')}</h3>
            </div>
            <a class="btn btn-secondary gk-open-btn" href="${openUrl}">${escapeHtml(t('general.open_account', 'Open account'))}</a>
          </header>
          <div class="gk-org-card-totals">${chipRow(org.totals_by_currency)}</div>
        </article>`;
      })
      .join('');

    return `<div class="general-reports-balance">
      ${orgCards ? `<div class="organizations-card-grid gk-org-card-grid">${orgCards}</div>` : `<div class="gk-empty-state"><p>${escapeHtml(t('general.no_org_data', 'No organization data'))}</p></div>`}
    </div>`;
  }

  function renderPnLTab() {
    const { ccys, incMap, expMap, income, expense } = computePnLMaps();

    const summaryCcys = [...ccys].sort().map((ccy) => {
      const iv = incMap[ccy] || 0;
      const ev = expMap[ccy] || 0;
      const nv = Math.round((iv - ev) * 100) / 100;
      const tone = nv > 0 ? 'is-inc' : nv < 0 ? 'is-exp' : '';
      return `<div class="general-reports-ccy-row ${tone}">
        <span>${escapeHtml(formatMoney(iv, ccy))}</span>
        <span>${escapeHtml(formatMoney(ev, ccy))}</span>
        <span>${escapeHtml(formatMoney(nv, ccy))}</span>
      </div>`;
    });

    return `<div class="general-reports-pnl">
      ${
        summaryCcys.length
          ? `<div class="general-reports-ccy-table">
        <span class="gk-sc-label">${escapeHtml(t('general.all_currencies_breakdown', 'All currencies'))}</span>
        <div class="general-reports-ccy-head"><span>${escapeHtml(t('general.income', 'Income'))}</span><span>${escapeHtml(t('general.expense', 'Expense'))}</span><span>${escapeHtml(t('general.net', 'Net'))}</span></div>
        ${summaryCcys.join('')}
      </div>`
          : ''
      }
      <div class="general-reports-tables-grid">
        ${renderTable(t('general.income_plural', 'Income'), income, true)}
        ${renderTable(t('general.expense_plural', 'Expenses'), expense, false)}
      </div>
      ${renderOrgPnLStrip()}
    </div>`; 
  }

  function renderCashFlowTab(kind) {
    const { ccys, incMap, expMap, income, expense } = computePnLMaps();
    const title = reportTitle(kind);
    const description = {
      cashflow: 'Свод денежных потоков по валютам: приход, расход и чистое движение.',
      odds: 'Отчёт о движении денежных средств по общему режиму.',
      dds: 'ДДС: движение денежных средств по приходам и расходам.',
    }[kind] || 'Движение денежных средств.';

    const summaryRows = [...ccys].sort().map((ccy) => {
      const inflow = incMap[ccy] || 0;
      const outflow = expMap[ccy] || 0;
      const net = Math.round((inflow - outflow) * 100) / 100;
      const tone = net > 0 ? 'is-inc' : net < 0 ? 'is-exp' : '';
      return `<tr>
        <td class="general-reports-num is-inc">${escapeHtml(formatMoney(inflow, ccy))}</td>
        <td class="general-reports-num is-exp">${escapeHtml(formatMoney(outflow, ccy))}</td>
        <td class="general-reports-num ${tone}">${escapeHtml(formatMoney(net, ccy))}</td>
      </tr>`;
    }).join('');

    return `<div class="general-reports-cashflow">
      <section class="general-reports-section">
        <h3 class="general-reports-h3">${escapeHtml(title)}</h3>
        <p class="general-reports-desc">${escapeHtml(description)}</p>
        <div class="general-kassa-table-wrap">
          <table class="general-kassa-table">
            <thead>
              <tr>
                <th class="gk-col-num">${escapeHtml(t('general.income', 'Income'))}</th>
                <th class="gk-col-num">${escapeHtml(t('general.expense', 'Expense'))}</th>
                <th class="gk-col-num">${escapeHtml(t('general.net', 'Net'))}</th>
              </tr>
            </thead>
            <tbody>
              ${summaryRows || `<tr><td colspan="3" class="general-kassa-empty-cell">${escapeHtml(t('general.no_data', 'No data'))}</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <div class="general-reports-tables-grid">
        ${renderTable('Поступления', income, true)}
        ${renderTable('Списания', expense, false)}
      </div>
      ${renderOrgPnLStrip()}
    </div>`;
  }

  function render() {
    if (!lastPnl || !lastTreasury) return;
    syncHeaderTabs();
    saveReportTabs();

    const activeReportOpen = Boolean(state.tab && openReportTabs.includes(state.tab));
    const launcher = document.querySelector('.general-report-launcher');
    if (launcher) {
      launcher.hidden = activeReportOpen;
      launcher.style.display = activeReportOpen ? 'none' : '';
    }
    root.hidden = !activeReportOpen;
    root.style.display = activeReportOpen ? '' : 'none';
    if (!activeReportOpen) return;

    renderOverview();

    const panels = root.querySelector('[data-gr-panels]');
    if (!panels) return;
    const pnlHidden = state.tab !== 'pnl' ? 'hidden' : '';
    const balHidden = state.tab !== 'balance' ? 'hidden' : '';
    const cashHidden = state.tab !== 'cashflow' ? 'hidden' : '';
    const oddsHidden = state.tab !== 'odds' ? 'hidden' : '';
    const ddsHidden = state.tab !== 'dds' ? 'hidden' : '';
    panels.innerHTML = `
      <div class="general-reports-panel" data-gr-panel-pnl ${pnlHidden}>${renderPnLTab()}</div>
      <div class="general-reports-panel" data-gr-panel-balance ${balHidden}>${renderBalanceTab()}</div>
      <div class="general-reports-panel" data-gr-panel-cashflow ${cashHidden}>${renderCashFlowTab('cashflow')}</div>
      <div class="general-reports-panel" data-gr-panel-odds ${oddsHidden}>${renderCashFlowTab('odds')}</div>
      <div class="general-reports-panel" data-gr-panel-dds ${ddsHidden}>${renderCashFlowTab('dds')}</div>
    `;
  }

  function bindHeaderTabs() {
    const onTabClick = (ev) => {
      const closeBtn = ev.target.closest('[data-report-close-tab]');
      if (closeBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        closeReportTab(closeBtn.getAttribute('data-report-close-tab') || '');
        return;
      }
      const homeBtn = ev.target.closest('[data-report-home-tab]');
      if (homeBtn) {
        ev.preventDefault();
        state.tab = '';
        render();
        return;
      }
      const btn = ev.target.closest('[data-gr-tab]');
      if (!btn) return;
      const tab = btn.getAttribute('data-gr-tab') || 'pnl';
      if (!reportTabMeta[tab]) return;
      ensureOpenReportTab(tab);
      state.tab = tab;
      render();
    };
    document.querySelector('.general-report-launcher')?.addEventListener('click', onTabClick);
    document.querySelector('[data-report-open-tabs]')?.addEventListener('click', onTabClick);
  }

  function mount() {
    restoreReportTabs();
    const orgOpts = [`<option value="">${escapeHtml(t('general.all_organizations', 'All organizations'))}</option>`].concat(
      (organizations || []).map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name || '')}</option>`),
    ).join('');

    root.innerHTML = `
      <section class="gk-kpi-strip" data-gr-overview aria-label="${escapeHtml(t('general.summary', 'Summary'))}"></section>
      <div class="gk-filters-shell">
        <div class="gk-filters-toolbar">
          <label class="gk-field">
            <span>${escapeHtml(t('general.period', 'Period'))}</span>
            <select data-gr-period>
              <option value="today">${escapeHtml(t('period.today', 'Today'))}</option>
              <option value="month">${escapeHtml(t('period.this_month', 'This month'))}</option>
              <option value="all">${escapeHtml(t('period.all_time', 'All time'))}</option>
              <option value="custom">${escapeHtml(t('period.custom', 'Custom'))}</option>
            </select>
          </label>
          <div class="gk-filters-toolbar-fields">
            <label class="gk-field gk-field--wide">
              <span>${escapeHtml(t('general.organization', 'Organization'))}</span>
              <select data-gr-org>${orgOpts}</select>
            </label>
            <label class="gk-field gk-field--date">
              <span>${escapeHtml(t('general.date_from', 'From'))}</span>
              <input type="date" data-gr-from disabled />
            </label>
            <label class="gk-field gk-field--date">
              <span>${escapeHtml(t('general.date_to', 'To'))}</span>
              <input type="date" data-gr-to disabled />
            </label>
            <label class="gk-field">
              <span>${escapeHtml(t('general.display_currency', 'Display currency'))}</span>
              <select data-gr-display-ccy><option value="USD">USD</option></select>
            </label>
          </div>
        </div>
        <p class="general-kassa-status" data-gr-status="" aria-live="polite"></p>
      </div>
      <div class="gk-table-board organizations-board">
        <div class="gk-panel-body" data-gr-panels></div>
      </div>
    `;
    root.hidden = true;

    bindHeaderTabs();

    const selOrg = root.querySelector('[data-gr-org]');
    const selPeriod = root.querySelector('[data-gr-period]');
    const inpFrom = root.querySelector('[data-gr-from]');
    const inpTo = root.querySelector('[data-gr-to]');
    const selDc = root.querySelector('[data-gr-display-ccy]');

    function syncCustom() {
      const c = state.period === 'custom';
      inpFrom.disabled = !c;
      inpTo.disabled = !c;
    }

    selOrg.addEventListener('change', () => {
      state.organizationId = selOrg.value;
      loadAll();
    });
    selPeriod.addEventListener('change', () => {
      state.period = selPeriod.value;
      syncCustom();
      loadAll();
    });
    inpFrom.addEventListener('change', () => {
      state.dateFrom = inpFrom.value;
      if (state.period === 'custom') loadAll();
    });
    inpTo.addEventListener('change', () => {
      state.dateTo = inpTo.value;
      if (state.period === 'custom') loadAll();
    });
    selDc.addEventListener('change', () => {
      state.displayCurrency = selDc.value || 'USD';
      loadAll();
    });

    selPeriod.value = state.period;
    syncCustom();
    loadAll();
  }

  mount();
})();
