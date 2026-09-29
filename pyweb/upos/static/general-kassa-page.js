/**
 * Общая касса (консолидированный журнал по организациям владельца).
 */
(function () {
  const root = document.getElementById('general-kassa-root');
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

  const tzMeta = document.querySelector('meta[name="general-kassa-timezone"]');
  const workspaceTz = (tzMeta?.getAttribute('content') || 'Asia/Tashkent').trim();

  let organizations = [];
  try {
    const blob = document.getElementById('general-kassa-orgs');
    if (blob?.textContent) organizations = JSON.parse(blob.textContent);
  } catch {
    organizations = [];
  }

  const state = {
    period: 'month',
    dateFrom: '',
    dateTo: '',
    organizationId: '',
    type: '',
    currency: '',
    category: '',
    source: '',
    pageIndex: 0,
    pageSize: 50,
  };

  let lastPayload = null;
  let loading = false;

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

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: workspaceTz,
      }).format(d);
    } catch {
      return d.toLocaleString();
    }
  }

  function chipsHtml(map) {
    const entries = Object.entries(map || {}).filter(([, v]) => Number(v));
    if (!entries.length) return `<span class="general-kassa-chip-muted">—</span>`;
    return `<span class="gk-metric-chips">${entries
      .map(([ccy, amt]) => `<span class="general-kassa-chip">${escapeHtml(formatMoney(amt, ccy))}</span>`)
      .join('')}</span>`;
  }

  function metricIcon(tone) {
    const icons = {
      count: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="19" height="19" rx="3"/><path d="M7.5 8h9M7.5 12h9M7.5 16h9"/></svg>',
      income: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m18 11-6-6-6 6"/></svg>',
      expense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>',
      net: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m15 8 4 4-4 4"/></svg>',
      transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/></svg>',
      cashout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/></svg>',
    };
    return icons[tone] || icons.count;
  }

  function getPaginationMeta(total) {
    const size = state.pageSize === 'all' ? Math.max(1, total) : state.pageSize;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const safeIndex = Math.min(Math.max(0, state.pageIndex), pageCount - 1);
    if (safeIndex !== state.pageIndex) state.pageIndex = safeIndex;
    const sliceStart = safeIndex * size;
    const sliceEnd = Math.min(sliceStart + size, total);
    return {
      total,
      start: total === 0 ? 0 : sliceStart + 1,
      end: sliceEnd,
      pageIndex: safeIndex,
      pageCount,
    };
  }

  function renderPagination(meta) {
    const infoEl = root.querySelector('[data-gk-pagination-info]');
    const indicatorEl = root.querySelector('[data-gk-page-indicator]');
    const prevBtn = root.querySelector('[data-gk-page-prev]');
    const nextBtn = root.querySelector('[data-gk-page-next]');
    const sizeSelect = root.querySelector('[data-gk-page-size]');

    if (!infoEl) return;

    const { total, start, end, pageIndex: idx, pageCount } = meta;

    if (total === 0) {
      infoEl.textContent = t('kassa.pagination.empty', 'Нет операций');
    } else if (state.pageSize === 'all') {
      infoEl.textContent = t('kassa.pagination.all', 'Показано все {count}').replace('{count}', String(total));
    } else {
      infoEl.textContent = t('kassa.pagination.range', 'Показано {start}–{end} из {total}')
        .replace('{start}', String(start))
        .replace('{end}', String(end))
        .replace('{total}', String(total));
    }

    if (indicatorEl) {
      indicatorEl.textContent = state.pageSize === 'all' || total === 0
        ? '—'
        : t('kassa.pagination.page_of', 'Стр. {page} / {pages}')
          .replace('{page}', String(idx + 1))
          .replace('{pages}', String(pageCount));
    }

    if (prevBtn) prevBtn.disabled = state.pageSize === 'all' || idx <= 0 || total === 0;
    if (nextBtn) nextBtn.disabled = state.pageSize === 'all' || idx >= pageCount - 1 || total === 0;

    if (sizeSelect) {
      sizeSelect.value = String(state.pageSize);
    }
  }

  function metricTile(label, bodyHtml, isChips, tone = 'neutral') {
    const valueClass = isChips ? ' general-metric-value--chips' : '';
    return `<div class="general-metric general-metric--${escapeHtml(tone)}">
      <div class="general-metric-header">
        <span class="gk-metric-icon" aria-hidden="true">${metricIcon(tone)}</span>
        <span class="general-metric-label">${escapeHtml(label)}</span>
      </div>
      <div class="general-metric-value${valueClass}">${bodyHtml}</div>
    </div>`;
  }

  function typeLabel(tx) {
    const kind = tx.type;
    if (kind === 'income') return `<span class="gk-badge gk-badge--in">${escapeHtml(t('general.type.income', 'Income'))}</span>`;
    if (kind === 'expense') return `<span class="gk-badge gk-badge--out">${escapeHtml(t('general.type.expense', 'Expense'))}</span>`;
    if (kind === 'transfer') {
      const cash = String(tx?.data?.transfer_kind || '') === 'cashout';
      return cash
        ? `<span class="gk-badge gk-badge--cashout">${escapeHtml(t('general.type.cashout', 'Cash out'))}</span>`
        : `<span class="gk-badge gk-badge--tr">${escapeHtml(t('general.type.transfer', 'Transfer'))}</span>`;
    }
    return escapeHtml(kind || '');
  }

  function sourceLabel(src) {
    if (src === 'smartup') return '<span class="gk-src gk-src--smart">Smartup</span>';
    return `<span class="gk-src gk-src--man">${escapeHtml(t('general.manual', 'Manual'))}</span>`;
  }

  function buildQuery() {
    const q = new URLSearchParams();
    q.set('timezone', workspaceTz);
    q.set('period', state.period);
    if (state.period === 'custom') {
      if (state.dateFrom) q.set('date_from', state.dateFrom);
      if (state.dateTo) q.set('date_to', state.dateTo);
    }
    if (state.organizationId) q.set('organization_id', state.organizationId);
    if (state.type) q.set('type', state.type);
    if (state.currency) q.set('currency', state.currency);
    if (state.category) q.set('category', state.category);
    if (state.source) q.set('source', state.source);
    return q.toString();
  }

  function showLoadingSkeleton() {
    const sum = root.querySelector('[data-gk-summary]');
    if (sum) {
      sum.innerHTML = `<div class="gk-skeleton-grid" aria-hidden="true">${'<div class="gk-skeleton"></div>'.repeat(7)}</div>`;
    }
    const sk = root.querySelector('[data-gk-table-skeleton]');
    if (sk) {
      sk.hidden = false;
      sk.innerHTML = '<div class="gk-skeleton-row"></div>'.repeat(5);
    }
    const tbody = root.querySelector('[data-gk-tbody]');
    if (tbody) tbody.innerHTML = '';
  }

  async function load() {
    if (loading) return;
    loading = true;
    showLoadingSkeleton();
    const statusEl = root.querySelector('[data-gk-status]');
    if (statusEl) statusEl.textContent = '';
    try {
      const res = await fetch(`/api/director/consolidated-transactions?${buildQuery()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      lastPayload = data;
      state.pageIndex = 0;
      render();
    } catch (e) {
      lastPayload = null;
      const sum = root.querySelector('[data-gk-summary]');
      if (sum) sum.innerHTML = '';
      const sk = root.querySelector('[data-gk-table-skeleton]');
      if (sk) sk.hidden = true;
      const tbody = root.querySelector('[data-gk-tbody]');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="general-kassa-empty">${escapeHtml(e.message || t('general.error_loading', 'Loading error'))}</td></tr>`;
      }
    } finally {
      loading = false;
      const sk = root.querySelector('[data-gk-table-skeleton]');
      if (sk) sk.hidden = true;
    }
  }

  function renderSummary(summary, meta) {
    const el = root.querySelector('[data-gk-summary]');
    if (!el || !summary) return;
    const warn = summary.truncated
      ? `<span class="gk-metric-warn">${escapeHtml(tf('general.truncated_warn', { limit: summary.limit }, 'Showing latest {limit}; summary covers all matches.'))}</span>`
      : '';
    el.innerHTML = `
      <div class="gk-kpi-strip-head">
        <p class="settings-ios-footnote">${escapeHtml(t('general.summary', 'Summary'))} · ${escapeHtml(meta?.label || '—')}</p>
        ${warn}
      </div>
      <div class="general-metric-grid gk-kpi-grid--6" role="group" aria-label="${escapeHtml(t('general.metrics_aria', 'Metrics'))}">
        ${metricTile(t('general.operations', 'Operations'), escapeHtml(String(summary.total_count ?? 0)), false, 'count')}
        ${metricTile(t('general.income', 'Income'), chipsHtml(summary.income_by_currency), true, 'income')}
        ${metricTile(t('general.expense', 'Expense'), chipsHtml(summary.expense_by_currency), true, 'expense')}
        ${metricTile(t('general.net', 'Net'), chipsHtml(summary.net_by_currency), true, 'net')}
        ${metricTile(t('general.transfers', 'Transfers'), chipsHtml(summary.transfer_by_currency), true, 'transfer')}
        ${metricTile(t('general.cashout', 'Cash out'), chipsHtml(summary.cashout_by_currency), true, 'cashout')}
      </div>
    `;
  }

  function renderTable(rows) {
    const tbody = root.querySelector('[data-gk-tbody]');
    if (!tbody) return;
    if (!rows?.length) {
      tbody.innerHTML = `<tr><td colspan="9">
        <div class="gk-empty-state">
          <span class="organizations-panel-icon" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></svg>
          </span>
          <p>${escapeHtml(t('general.kassa.empty', 'No transactions match the selected filters. Create a transaction in a specific organization.'))}</p>
        </div>
      </td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((tx) => {
        const orgName = tx.organization_name || '—';
        const openUrl = `/organizations/open-kassa?organization_id=${encodeURIComponent(tx.organization_id)}&tx=${encodeURIComponent(tx.id)}`;
        const cat = tx.category || '—';
        const note = tx.note || '';
        const amt = formatMoney(tx.amount, tx.currency);
        return `<tr data-gk-tx="${escapeHtml(tx.id)}">
          <td><span class="gk-org-badge" title="${escapeHtml(orgName)}">${escapeHtml(orgName)}</span></td>
          <td>${escapeHtml(String(tx.number ?? ''))}</td>
          <td>${formatDate(tx.created_at)}</td>
          <td>${typeLabel(tx)}</td>
          <td class="gk-col-num">${escapeHtml(amt)}</td>
          <td>${escapeHtml(cat)}</td>
          <td>${sourceLabel(tx.source)}</td>
          <td class="gk-note gk-col-note">${escapeHtml(note)}</td>
          <td><a class="btn btn-secondary gk-open-btn" href="${openUrl}">${escapeHtml(t('general.open', 'Open'))}</a></td>
        </tr>`;
      })
      .join('');
  }

  function mergeHints(hints) {
    const catSel = root.querySelector('[data-gk-filter-category]');
    const ccySel = root.querySelector('[data-gk-filter-currency]');
    if (!catSel || !hints?.categories) return;
    const preserve = state.category;
    const opts = [`<option value="">${escapeHtml(t('general.all_categories', 'All categories'))}</option>`]
      .concat(hints.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`))
      .join('');
    catSel.innerHTML = opts;
    catSel.value = preserve;

    if (!ccySel || !hints?.currencies) return;
    const p2 = state.currency;
    const o2 = [`<option value="">${escapeHtml(t('general.all_currencies', 'All currencies'))}</option>`].concat(
      hints.currencies.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
    ).join('');
    ccySel.innerHTML = o2;
    ccySel.value = p2;
  }

  function render() {
    if (!lastPayload) return;
    const meta = lastPayload.period_meta || {};
    renderSummary(lastPayload.summary, meta);
    mergeHints(lastPayload.filter_hints);

    const txs = lastPayload.transactions || [];
    const pagMeta = getPaginationMeta(txs.length);
    renderPagination(pagMeta);

    const size = state.pageSize === 'all' ? txs.length : state.pageSize;
    const pageTxs = txs.slice(pagMeta.pageIndex * size, (pagMeta.pageIndex + 1) * size);
    renderTable(pageTxs);
  }

  function mountChrome() {
    const orgOptions = [`<option value="">${escapeHtml(t('general.all_organizations', 'All organizations'))}</option>`]
      .concat(
        (organizations || []).map((o) =>
          `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name || '')}</option>`),
      )
      .join('');

    root.innerHTML = `
      <section class="gk-kpi-strip" data-gk-summary aria-label="${escapeHtml(t('general.summary', 'Summary'))}"></section>
      <div class="gk-filters-shell">
        <div class="gk-filters-row">
          <label class="gk-field gk-field--wide">
            <span>${escapeHtml(t('general.organization', 'Organization'))}</span>
            <select data-gk-filter-org>${orgOptions}</select>
          </label>
          <label class="gk-field">
            <span>${escapeHtml(t('general.period', 'Period'))}</span>
            <select data-gk-filter-period>
              <option value="today">${escapeHtml(t('period.today', 'Today'))}</option>
              <option value="month">${escapeHtml(t('period.this_month', 'This month'))}</option>
              <option value="all">${escapeHtml(t('period.all_time', 'All time'))}</option>
              <option value="custom">${escapeHtml(t('period.custom', 'Custom'))}</option>
            </select>
          </label>
          <label class="gk-field gk-field--date">
            <span>${escapeHtml(t('general.date_from', 'From'))}</span>
            <input type="date" data-gk-filter-from disabled />
          </label>
          <label class="gk-field gk-field--date">
            <span>${escapeHtml(t('general.date_to', 'To'))}</span>
            <input type="date" data-gk-filter-to disabled />
          </label>
          <label class="gk-field">
            <span>${escapeHtml(t('general.type', 'Type'))}</span>
            <select data-gk-filter-type>
              <option value="">${escapeHtml(t('general.all_types', 'All types'))}</option>
              <option value="income">${escapeHtml(t('general.type.income', 'Income'))}</option>
              <option value="expense">${escapeHtml(t('general.type.expense', 'Expense'))}</option>
              <option value="transfer">${escapeHtml(t('general.type.transfer', 'Transfer'))}</option>
              <option value="cashout">${escapeHtml(t('general.type.cashout', 'Cash out'))}</option>
            </select>
          </label>
          <label class="gk-field">
            <span>${escapeHtml(t('general.currency', 'Currency'))}</span>
            <select data-gk-filter-currency><option value="">${escapeHtml(t('general.all_currencies', 'All currencies'))}</option></select>
          </label>
          <label class="gk-field">
            <span>${escapeHtml(t('general.category', 'Category'))}</span>
            <select data-gk-filter-category><option value="">${escapeHtml(t('general.all_categories', 'All categories'))}</option></select>
          </label>
          <label class="gk-field">
            <span>${escapeHtml(t('general.source', 'Source'))}</span>
            <select data-gk-filter-source>
              <option value="">${escapeHtml(t('general.all', 'All'))}</option>
              <option value="manual">${escapeHtml(t('general.manual', 'Manual'))}</option>
              <option value="smartup">Smartup</option>
            </select>
          </label>
        </div>
        <p class="general-kassa-status" data-gk-status="" aria-live="polite"></p>
      </div>
      <section class="gk-table-board organizations-board">
        <div class="general-kassa-table-wrap">
          <div data-gk-table-skeleton hidden></div>
          <table class="general-kassa-table">
            <thead>
              <tr>
                <th>${escapeHtml(t('general.organization', 'Organization'))}</th>
                <th>№</th>
                <th>${escapeHtml(t('general.date', 'Date'))}</th>
                <th>${escapeHtml(t('general.type', 'Type'))}</th>
                <th class="gk-col-num">${escapeHtml(t('general.amount', 'Amount'))}</th>
                <th>${escapeHtml(t('general.category', 'Category'))}</th>
                <th>${escapeHtml(t('general.source', 'Source'))}</th>
                <th>${escapeHtml(t('general.comment', 'Comment'))}</th>
                <th></th>
              </tr>
            </thead>
            <tbody data-gk-tbody></tbody>
          </table>
        </div>
        <footer class="gk-table-footer" data-gk-pagination aria-label="${escapeHtml(t('kassa.pagination.aria', 'Навигация по страницам'))}">
          <div class="gk-pagination-toolbar">
            <p class="gk-pagination-info" data-gk-pagination-info></p>
            <div class="gk-pagination-nav">
              <button type="button" class="gk-page-nav-btn" data-gk-page-prev aria-label="${escapeHtml(t('kassa.pagination.prev', 'Предыдущая страница'))}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <span class="gk-page-indicator" data-gk-page-indicator>—</span>
              <button type="button" class="gk-page-nav-btn" data-gk-page-next aria-label="${escapeHtml(t('kassa.pagination.next', 'Следующая страница'))}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
            <label class="gk-pagination-size">
              <span class="gk-pagination-size-label">${escapeHtml(t('kassa.page_size.label', 'На странице'))}</span>
              <div class="gk-page-size-group">
                <select data-gk-page-size class="gk-page-size-select" aria-label="${escapeHtml(t('kassa.page_size.label', 'На странице'))}">
                  <option value="10">10</option>
                  <option value="30">30</option>
                  <option value="50" selected>50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="all">${escapeHtml(t('kassa.page_size.all', 'Все'))}</option>
                </select>
              </div>
            </label>
          </div>
        </footer>
      </section>
    `;
  }

  function bind() {
    mountChrome();

    const selOrg = root.querySelector('[data-gk-filter-org]');
    const selPeriod = root.querySelector('[data-gk-filter-period]');
    const inpFrom = root.querySelector('[data-gk-filter-from]');
    const inpTo = root.querySelector('[data-gk-filter-to]');
    const selType = root.querySelector('[data-gk-filter-type]');
    const selCcy = root.querySelector('[data-gk-filter-currency]');
    const selCat = root.querySelector('[data-gk-filter-category]');
    const selSrc = root.querySelector('[data-gk-filter-source]');

    selOrg.value = state.organizationId;
    selPeriod.value = state.period;
    inpFrom.value = state.dateFrom;
    inpTo.value = state.dateTo;
    selType.value = state.type;
    selCcy.value = state.currency;
    selCat.value = state.category;
    selSrc.value = state.source;

    function syncCustomDates() {
      const custom = state.period === 'custom';
      inpFrom.disabled = !custom;
      inpTo.disabled = !custom;
    }

    selOrg.addEventListener('change', () => {
      state.organizationId = selOrg.value;
      load();
    });
    selPeriod.addEventListener('change', () => {
      state.period = selPeriod.value;
      syncCustomDates();
      load();
    });
    inpFrom.addEventListener('change', () => {
      state.dateFrom = inpFrom.value;
      if (state.period === 'custom') load();
    });
    inpTo.addEventListener('change', () => {
      state.dateTo = inpTo.value;
      if (state.period === 'custom') load();
    });
    selType.addEventListener('change', () => {
      state.type = selType.value;
      load();
    });
    selCcy.addEventListener('change', () => {
      state.currency = selCcy.value;
      load();
    });
    selCat.addEventListener('change', () => {
      state.category = selCat.value;
      load();
    });
    selSrc.addEventListener('change', () => {
      state.source = selSrc.value;
      load();
    });

    const prevBtn = root.querySelector('[data-gk-page-prev]');
    const nextBtn = root.querySelector('[data-gk-page-next]');
    const sizeSelect = root.querySelector('[data-gk-page-size]');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (state.pageIndex > 0) {
          state.pageIndex--;
          render();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const txs = lastPayload?.transactions || [];
        const size = state.pageSize === 'all' ? txs.length : state.pageSize;
        const pageCount = Math.ceil(txs.length / size);
        if (state.pageIndex < pageCount - 1) {
          state.pageIndex++;
          render();
        }
      });
    }
    if (sizeSelect) {
      sizeSelect.addEventListener('change', () => {
        const val = sizeSelect.value;
        state.pageSize = val === 'all' ? 'all' : Number(val) || 50;
        state.pageIndex = 0;
        render();
      });
    }

    syncCustomDates();
  }

  bind();
  load();
})();
