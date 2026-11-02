(() => {
  const dataNode = document.getElementById('delivery-shipments-report-data');
  const paymentsNode = document.getElementById('delivery-payments-report-data');
  const debtsNode = document.getElementById('delivery-debts-report-data');
  const debtLimitsNode = document.getElementById('delivery-debt-limits-data');
  const stockHistoryNode = document.getElementById('stock-purchase-history-data');
  const tabsShell = document.querySelector('[data-org-report-open-tabs]');
  const homeTab = document.querySelector('[data-org-report-home-tab]');
  const launcher = document.querySelector('.org-report-launcher');
  const root = document.querySelector('[data-org-reports-root]');
  if (!tabsShell || !homeTab || !launcher || !root) return;
  const stockUsdRate = Number(root.dataset.reportsUsdRate || 12000) || 12000;

  const reportMeta = {
    'courier-debts': 'Долги доставщиков',
    'courier-balance': 'Баланс доставщиков',
    'delivery-shipments': 'Отгрузки',
    'sales-overview': 'Продажи',
    'profit': 'Прибыль',
    'sales-cost': 'Продажи и себестоимость',
    'company-balance': 'Баланс компании',
    'stock-movement': 'Движение по складу',
    'stock-analysis': 'Анализ остатков',
    'receivables': 'Дебиторка',
    'calls-conversion': 'Звонки',
  };
  reportMeta['courier-reconcile'] = 'Акт сверки';
  const openTabs = [];
  let activeTab = '';
  let reconcileCourierName = '';
  let reconcilePeriod = 'all';
  let reconcileDateFrom = '';
  let reconcileDateTo = '';
  let reconcileDatePicker = null;
  let shipments = [];
  let payments = [];
  let courierDebts = [];
  let courierDebtLimits = {};
  let courierDebtLimitSaving = false;
  let courierDebtLimitStatus = '';
  let courierBalanceView = 'bars';
  let stockCurrency = 'UZS';
  let stockPurchaseHistory = {};
  try {
    shipments = JSON.parse(dataNode?.textContent || '[]');
  } catch {
    shipments = [];
  }
  try {
    payments = JSON.parse(paymentsNode?.textContent || '[]');
  } catch {
    payments = [];
  }
  try {
    courierDebts = JSON.parse(debtsNode?.textContent || '[]');
  } catch {
    courierDebts = [];
  }
  try {
    courierDebtLimits = JSON.parse(debtLimitsNode?.textContent || '{}') || {};
  } catch {
    courierDebtLimits = {};
  }
  try {
    stockPurchaseHistory = JSON.parse(stockHistoryNode?.textContent || '{}') || {};
  } catch {
    stockPurchaseHistory = {};
  }

  const numberFormatter = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  });

  function money(value, currency) {
    const amount = Number(value || 0);
    return `${numberFormatter.format(amount)} ${currency || 'UZS'}`;
  }

  let profitCurrency = document.querySelector('[data-profit-currency-switch]')?.getAttribute('data-initial-currency') === 'UZS' ? 'UZS' : 'USD';
  const savedSalesCostPageSize = Number(window.localStorage.getItem('upos-reports-sales-cost-page-size') || 100);
  let salesCostPageSize = [100, 500, 1000].includes(savedSalesCostPageSize) ? savedSalesCostPageSize : 100;
  let salesCostPage = 1;

  function renderProfitCurrency(scope = document) {
    scope.querySelectorAll('[data-profit-money]').forEach((node) => {
      const amountUzs = Number(node.getAttribute('data-money-uzs') || 0);
      const amount = profitCurrency === 'USD' ? amountUzs / stockUsdRate : amountUzs;
      node.textContent = `${numberFormatter.format(amount)} ${profitCurrency}`;
    });
    scope.querySelectorAll('[data-profit-currency]').forEach((button) => {
      const active = button.getAttribute('data-profit-currency') === profitCurrency;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // Разделы прибыли: «Отгрузки» показывают ожидаемую прибыль, «Архив» —
  // реальную, потому что программа признаёт прибыль только после архива.
  function salesCostRowMatchesFilters(row) {
    const selected = {};
    document.querySelectorAll('[data-sales-cost-filter]').forEach((select) => {
      selected[select.getAttribute('data-sales-cost-filter')] = String(select.value || '').trim().toLocaleLowerCase('ru');
    });
    const employee = String(row.getAttribute('data-sales-cost-employee') || '').toLocaleLowerCase('ru');
    const installer = String(row.getAttribute('data-sales-cost-installer') || '').toLocaleLowerCase('ru');
    const programs = String(row.getAttribute('data-sales-cost-programs') || '').split('|').map((value) => value.trim().toLocaleLowerCase('ru'));
    return (!selected.employee || employee === selected.employee)
      && (!selected.installer || installer === selected.installer)
      && (!selected.program || programs.includes(selected.program));
  }

  function applySalesCostStage(stage) {
    const tabs = document.querySelector('[data-sales-cost-stages]');
    if (!tabs) return;
    const button = tabs.querySelector(`[data-sales-cost-stage="${stage}"]`) || tabs.querySelector('[data-sales-cost-stage]');
    if (!button) return;
    const active = button.getAttribute('data-sales-cost-stage');
    tabs.querySelectorAll('[data-sales-cost-stage]').forEach((node) => {
      const on = node === button;
      node.classList.toggle('active', on);
      node.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    const rows = Array.from(document.querySelectorAll('[data-sales-cost-row]'));
    const filteredRows = rows.filter(salesCostRowMatchesFilters);
    const matchingRows = filteredRows.filter((row) => active === 'all' || row.getAttribute('data-sales-cost-row') === active);
    tabs.querySelectorAll('[data-sales-cost-stage]').forEach((stageButton) => {
      const stageKey = stageButton.getAttribute('data-sales-cost-stage');
      const count = filteredRows.filter((row) => stageKey === 'all' || row.getAttribute('data-sales-cost-row') === stageKey).length;
      const countNode = stageButton.querySelector('b');
      if (countNode) countNode.textContent = String(count);
    });
    const totalPages = Math.max(1, Math.ceil(matchingRows.length / salesCostPageSize));
    salesCostPage = Math.min(Math.max(1, salesCostPage), totalPages);
    const start = (salesCostPage - 1) * salesCostPageSize;
    const visibleRows = new Set(matchingRows.slice(start, start + salesCostPageSize));
    rows.forEach((row) => {
      row.hidden = !visibleRows.has(row);
    });
    const emptyRow = document.querySelector('[data-sales-cost-empty]');
    if (emptyRow) emptyRow.hidden = matchingRows.length > 0;

    const status = document.querySelector('[data-sales-cost-page-status]');
    const pageNumber = document.querySelector('[data-sales-cost-page-number]');
    const previous = document.querySelector('[data-sales-cost-page-prev]');
    const next = document.querySelector('[data-sales-cost-page-next]');
    const size = document.querySelector('[data-sales-cost-page-size]');
    const shownFrom = matchingRows.length ? start + 1 : 0;
    const shownTo = Math.min(start + salesCostPageSize, matchingRows.length);
    if (status) status.textContent = `Показано: ${shownFrom}–${shownTo} из ${matchingRows.length}`;
    if (pageNumber) pageNumber.textContent = `Стр. ${salesCostPage} из ${totalPages}`;
    if (previous) previous.disabled = salesCostPage <= 1;
    if (next) next.disabled = salesCostPage >= totalPages;
    if (size) size.value = String(salesCostPageSize);

    const revenue = matchingRows.reduce((total, row) => total + Number(row.getAttribute('data-sales-cost-amount') || 0), 0);
    const cost = matchingRows.reduce((total, row) => total + Number(row.getAttribute('data-sales-cost-cost') || 0), 0);
    const profit = revenue - cost;
    const pairs = [
      ['[data-sales-cost-total]', cost],
      ['[data-sales-cost-profit]', profit],
      ['[data-sales-cost-foot-revenue]', revenue],
      ['[data-sales-cost-foot-cost]', cost],
      ['[data-sales-cost-foot-profit]', profit],
    ];
    pairs.forEach(([selector, value]) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute('data-money-uzs', value);
    });
    const label = document.querySelector('[data-sales-cost-profit-label]');
    if (label) label.textContent = button.getAttribute('data-stage-note') || 'прибыль';
    renderProfitCurrency();
  }

  document.querySelector('[data-sales-cost-stages]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-sales-cost-stage]');
    if (!button) return;
    salesCostPage = 1;
    applySalesCostStage(button.getAttribute('data-sales-cost-stage'));
  });

  document.querySelector('[data-sales-cost-pagination]')?.addEventListener('click', (event) => {
    const activeStage = document.querySelector('[data-sales-cost-stage].active')?.getAttribute('data-sales-cost-stage') || 'all';
    if (event.target.closest('[data-sales-cost-page-prev]')) salesCostPage -= 1;
    else if (event.target.closest('[data-sales-cost-page-next]')) salesCostPage += 1;
    else return;
    applySalesCostStage(activeStage);
    document.querySelector('[data-sales-cost-table-wrap]')?.scrollTo({ top: 0 });
  });

  document.querySelector('[data-sales-cost-page-size]')?.addEventListener('change', (event) => {
    const value = Number(event.target.value || 100);
    salesCostPageSize = [100, 500, 1000].includes(value) ? value : 100;
    window.localStorage.setItem('upos-reports-sales-cost-page-size', String(salesCostPageSize));
    salesCostPage = 1;
    const activeStage = document.querySelector('[data-sales-cost-stage].active')?.getAttribute('data-sales-cost-stage') || 'all';
    applySalesCostStage(activeStage);
    document.querySelector('[data-sales-cost-table-wrap]')?.scrollTo({ top: 0 });
  });

  document.querySelector('[data-sales-cost-filters]')?.addEventListener('change', () => {
    salesCostPage = 1;
    const activeStage = document.querySelector('[data-sales-cost-stage].active')?.getAttribute('data-sales-cost-stage') || 'all';
    applySalesCostStage(activeStage);
    document.querySelector('[data-sales-cost-table-wrap]')?.scrollTo({ top: 0 });
  });

  function renderStockCurrency(scope = document) {
    scope.querySelectorAll('[data-stock-money]').forEach((node) => {
      const amountUzs = Number(node.getAttribute('data-money-uzs') || 0);
      const amount = stockCurrency === 'USD' ? amountUzs / stockUsdRate : amountUzs;
      node.textContent = `${numberFormatter.format(amount)} ${stockCurrency}`;
    });
    scope.querySelectorAll('[data-stock-currency]').forEach((button) => {
      const active = button.getAttribute('data-stock-currency') === stockCurrency;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function closeStockHistory() {
    const drawer = document.querySelector('[data-stock-history-drawer]');
    const backdrop = document.querySelector('.reports-stock-history-backdrop');
    drawer?.classList.remove('is-open');
    backdrop?.classList.remove('is-open');
    window.setTimeout(() => {
      if (drawer) drawer.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 180);
  }

  function openStockHistory(productId, productName) {
    const drawer = document.querySelector('[data-stock-history-drawer]');
    const backdrop = document.querySelector('.reports-stock-history-backdrop');
    const title = document.querySelector('[data-stock-history-title]');
    const summary = document.querySelector('[data-stock-history-summary]');
    const list = document.querySelector('[data-stock-history-list]');
    if (!drawer || !backdrop || !title || !summary || !list) return;
    const history = Array.isArray(stockPurchaseHistory[productId]) ? stockPurchaseHistory[productId] : [];
    title.textContent = productName || 'Товар';
    summary.textContent = history.length
      ? `${history.length} ${history.length === 1 ? 'документ прихода' : 'документов прихода'}`
      : 'Документы прихода не найдены';
    list.innerHTML = history.length ? `
      <table class="reports-data-table reports-stock-history-table">
        <thead>
          <tr><th>Дата</th><th>Документ</th><th>Поставщик</th><th>Склад</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr>
        </thead>
        <tbody>
          ${history.map((item) => `
            <tr class="reports-stock-history-tr" data-history-url="${escapeHtml(item.url || '/warehouse#purchases')}">
              <td>${escapeHtml(item.date || '-')}</td>
              <td><strong>${escapeHtml(item.number || '-')}</strong></td>
              <td>${escapeHtml(item.supplier || 'Без поставщика')}</td>
              <td>${escapeHtml(item.warehouse || 'Основной склад')}</td>
              <td class="num">${escapeHtml(item.quantity || '0')}${item.unit && item.unit !== 'Штука' ? ' ' + escapeHtml(item.unit) : ''}</td>
              <td class="num">${escapeHtml(item.price || '0 UZS')}</td>
              <td class="num"><b>${escapeHtml(item.amount || '0 UZS')}</b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<div class="reports-stock-history-empty">Для этого товара пока нет сохранённых закупок.</div>';
    list.querySelectorAll('.reports-stock-history-tr').forEach((row) => {
      row.addEventListener('click', () => { window.location.href = row.dataset.historyUrl; });
    });
    drawer.hidden = false;
    backdrop.hidden = false;
    window.requestAnimationFrame(() => {
      drawer.classList.add('is-open');
      backdrop.classList.add('is-open');
    });
  }

  function sortableCellValue(cell) {
    const raw = String(cell?.getAttribute('data-sort-value') || cell?.textContent || '').trim();
    const numberLike = /^[!▲+\-]?\s*[\d\s.,]+\s*(?:UZS|USD|RUB|EUR|pcs|шт)?$/i.test(raw);
    if (numberLike) {
      const parsed = Number(raw.replace(/[!▲\s]/g, '').replace(',', '.').replace(/(?:UZS|USD|RUB|EUR|pcs|шт)$/i, ''));
      if (Number.isFinite(parsed)) return {type: 'number', value: parsed};
    }
    return {type: 'text', value: raw.toLocaleLowerCase('ru-RU')};
  }

  function sortReportTable(table, columnIndex, direction) {
    const body = table.tBodies[0];
    if (!body) return;
    const rows = Array.from(body.rows).filter((row) => !row.querySelector('.reports-empty-cell'));
    rows.sort((left, right) => {
      const a = sortableCellValue(left.cells[columnIndex]);
      const b = sortableCellValue(right.cells[columnIndex]);
      const result = a.type === 'number' && b.type === 'number'
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), 'ru', {numeric: true, sensitivity: 'base'});
      return direction === 'desc' ? -result : result;
    });
    rows.forEach((row) => body.appendChild(row));
  }

  function enhanceSortableTables(scope = document) {
    scope.querySelectorAll('.reports-data-table').forEach((table) => {
      table.querySelectorAll('thead th').forEach((header, columnIndex) => {
        if (header.querySelector('.reports-sort-button') || !header.textContent.trim() || header.hasAttribute('data-report-no-sort')) return;
        const label = header.textContent.trim();
        header.textContent = '';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reports-sort-button';
        button.setAttribute('data-report-sort-column', String(columnIndex));
        button.setAttribute('aria-label', `${label}: сортировать от большего к меньшему`);
        button.innerHTML = `<span>${label}</span><span class="reports-sort-icon" aria-hidden="true">↕</span>`;
        header.appendChild(button);
      });
    });
  }

  function percent(value, max) {
    const cleanMax = Number(max || 0);
    if (cleanMax <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(Number(value || 0) / cleanMax * 100)));
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
      || document.querySelector('input[name="csrf_token"]')?.value
      || '';
  }

  function parseLimitAmount(value) {
    const normalized = String(value || '').replace(/\s|\u202f/g, '').replace(',', '.');
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
  }

  function formatLimitAmount(value) {
    const text = String(value || '').replace(/[^\d.,\s\u202f]/g, '').replace(/\s|\u202f/g, '').replace('.', ',');
    if (!text) return '';
    const [rawInteger, rawFraction = ''] = text.split(',');
    const integer = Number(rawInteger || 0);
    if (!Number.isFinite(integer)) return '';
    const formatted = numberFormatter.format(integer).replace(/\u00a0|\u202f/g, ' ');
    const fraction = rawFraction.replace(/\D/g, '').slice(0, 2);
    return fraction ? `${formatted},${fraction}` : formatted;
  }

  function formatLimitInput(input) {
    const formatted = formatLimitAmount(input.value);
    input.value = formatted;
  }

  function courierLimitKey(row) {
    return `${encodeURIComponent(String(row?.courier_name || '').trim())}|${String(row?.currency || 'UZS').toUpperCase()}`;
  }

  function courierLimitValue(row) {
    return Number(courierDebtLimits[courierLimitKey(row)] || 0);
  }

  function courierNameButton(name, className = '') {
    return `<button type="button" class="reports-courier-link ${className}" data-courier-name="${escapeHtml(name)}" aria-label="Открыть акт сверки ${escapeHtml(name)}">${escapeHtml(name)}</button>`;
  }

  function collectCourierDebtLimits() {
    const limits = {};
    document.querySelectorAll('[data-courier-limit-input]').forEach((input) => {
      const key = input.getAttribute('data-courier-limit-input') || '';
      const amount = parseLimitAmount(input.value);
      if (key && amount > 0) limits[key] = amount;
    });
    return limits;
  }

  function setCourierLimitStatus(text) {
    courierDebtLimitStatus = text || '';
    document.querySelectorAll('[data-courier-limit-status]').forEach((node) => {
      node.textContent = courierDebtLimitStatus;
    });
  }

  async function saveCourierDebtLimits() {
    if (courierDebtLimitSaving) return;
    const limits = collectCourierDebtLimits();
    courierDebtLimits = limits;
    courierDebtLimitSaving = true;
    setCourierLimitStatus('Сохранение...');
    document.querySelectorAll('[data-courier-limit-save]').forEach((button) => { button.disabled = true; });
    try {
      const response = await fetch('/api/reports/courier-debt-limits', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken(),
        },
        body: JSON.stringify({ limits }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'save_failed');
      }
      courierDebtLimits = payload.limits || limits;
      setCourierLimitStatus('Лимиты сохранены');
    } catch (err) {
      setCourierLimitStatus('Не удалось сохранить лимиты');
    } finally {
      courierDebtLimitSaving = false;
      renderCourierBalancePanel();
    }
  }

  function txDate(tx) {
    return String(tx?.created_at || '').slice(0, 10);
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function monthStartIso() {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  }

  function yearStartIso() {
    const date = new Date();
    date.setMonth(0, 1);
    return date.toISOString().slice(0, 10);
  }

  function resetReconcileFilter() {
    reconcilePeriod = 'month';
    reconcileDateFrom = monthStartIso();
    reconcileDateTo = todayIso();
  }

  function setReconcilePreset(period) {
    reconcilePeriod = period || 'all';
    if (reconcilePeriod === 'today') {
      const today = todayIso();
      reconcileDateFrom = today;
      reconcileDateTo = today;
    } else if (reconcilePeriod === 'month') {
      reconcileDateFrom = monthStartIso();
      reconcileDateTo = todayIso();
    } else if (reconcilePeriod === 'year') {
      reconcileDateFrom = yearStartIso();
      reconcileDateTo = todayIso();
    } else if (reconcilePeriod === 'all') {
      reconcileDateFrom = '';
      reconcileDateTo = '';
    }
  }

  function tabLabel(tab) {
    if (tab === 'courier-reconcile') {
      return reconcileCourierName ? `Акт: ${reconcileCourierName}` : reportMeta[tab];
    }
    return reportMeta[tab] || tab;
  }

  function sortedCourierRows(courierName) {
    const clean = String(courierName || '').trim();
    return shipments
      .filter((row) => String(row?.courier_name || '').trim() === clean)
      .slice()
      .sort((a, b) => {
        const dateCompare = String(a.shipment_date || '').localeCompare(String(b.shipment_date || ''));
        if (dateCompare) return dateCompare;
        return Number(a.number || 0) - Number(b.number || 0);
      });
  }

  function filteredCourierRows(courierName) {
    return sortedCourierRows(courierName).filter((row) => {
      const date = String(row?.shipment_date || '');
      if (reconcileDateFrom && date < reconcileDateFrom) return false;
      if (reconcileDateTo && date > reconcileDateTo) return false;
      return true;
    });
  }

  function filteredCourierPayments(courierName) {
    const clean = String(courierName || '').trim();
    return payments
      .filter((tx) => {
        const name = String(tx?.data?.courier_name || tx?.supplier || tx?.client || '').trim();
        const date = txDate(tx);
        if (name !== clean) return false;
        if (reconcileDateFrom && date < reconcileDateFrom) return false;
        if (reconcileDateTo && date > reconcileDateTo) return false;
        return true;
      })
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || Number(a.number || 0) - Number(b.number || 0));
  }

  function buildReconcileSummary(summaryNode, totals) {
    const currencies = Object.keys(totals).sort();
    summaryNode.replaceChildren();
    if (!currencies.length) {
      const empty = document.createElement('div');
      empty.className = 'reports-empty-state';
      empty.textContent = 'По этому доставщику пока нет отгрузок.';
      summaryNode.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'reports-data-table reports-reconcile-total-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Валюта</th>
          <th>Итого дебет</th>
          <th>Итого кредит</th>
          <th>Итоговый долг</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    currencies.forEach((currency) => {
      const row = totals[currency];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${currency}</td>
        <td>${money(row.debit, currency)}</td>
        <td>${money(row.credit, currency)}</td>
        <td><strong>${money(row.balance, currency)}</strong></td>
      `;
      tbody.appendChild(tr);
    });

    summaryNode.appendChild(table);
  }

  function renderReconcilePanel() {
    const title = document.querySelector('[data-reconcile-title]');
    const subtitle = document.querySelector('[data-reconcile-subtitle]');
    const rowsNode = document.querySelector('[data-reconcile-rows]');
    const paymentRowsNode = document.querySelector('[data-reconcile-payment-rows]');
    const summaryNode = document.querySelector('[data-reconcile-summary]');
    if (!title || !subtitle || !rowsNode || !paymentRowsNode || !summaryNode) return;

    initReconcileDatePicker();
    if (reconcileDatePicker && typeof reconcileDatePicker.setValue === 'function') {
      reconcileDatePicker.setValue({
        preset: reconcilePeriod,
        date_from: reconcileDateFrom,
        date_to: reconcileDateTo,
      });
    }

    const allRows = sortedCourierRows(reconcileCourierName);
    const rows = filteredCourierRows(reconcileCourierName);
    const totals = {};
    rowsNode.replaceChildren();
    paymentRowsNode.replaceChildren();
    title.textContent = reconcileCourierName || 'Акт сверки';
    subtitle.textContent = `${rows.length} из ${allRows.length} отгрузок в акте сверки.`;

    rows.forEach((row) => {
      const currency = row.currency || 'UZS';
      if (!totals[currency]) totals[currency] = { debit: 0, credit: 0, balance: 0 };
      const debit = Number(row.total_amount || 0);
      const credit = Number(row.paid_amount || 0);
      totals[currency].debit += debit;
      totals[currency].credit += credit;
      totals[currency].balance += debit - credit;

      const tr = document.createElement('tr');
      const firstItem = Array.isArray(row.items) && row.items.length ? row.items[0] : null;
      const documentName = firstItem?.product_name
        ? `Отгрузка №${row.number} - ${firstItem.product_name}`
        : `Отгрузка №${row.number}`;
      tr.innerHTML = `
        <td>${row.shipment_date || ''}</td>
        <td>${documentName}</td>
        <td>${money(debit, currency)}</td>
        <td>${money(credit, currency)}</td>
        <td><strong>${money(totals[currency].balance, currency)}</strong></td>
      `;
      rowsNode.appendChild(tr);
    });

    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="reports-empty-cell">За выбранный период отгрузок нет.</td>';
      rowsNode.appendChild(tr);
    }

    const paymentRows = filteredCourierPayments(reconcileCourierName);
    paymentRows.forEach((tx) => {
      const currency = tx.currency || 'UZS';
      const b = tx?.data?.courier_breakdown || {};
      const accountLine = (text) => text ? `<br><small>${escapeHtml(text)}</small>` : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(txDate(tx))}</td>
        <td>Касса №${escapeHtml(tx.number || '')}</td>
        <td>${escapeHtml(money(b.cash ?? tx.amount, currency))}${accountLine(b.cash_account_id_label)}</td>
        <td>${escapeHtml(money(b.transfer, currency))}${accountLine(b.transfer_account_id_label)}</td>
        <td>${escapeHtml(money(b.return_goods, currency))}</td>
        <td>${escapeHtml(money(b.discount, currency))}</td>
        <td>${escapeHtml(money(b.terminal, currency))}${accountLine(b.terminal_account_id_label)}</td>
        <td>${escapeHtml(money(b.current_debt, currency))}</td>
        <td>${escapeHtml(money(b.old_debt, currency))}</td>
        <td>${escapeHtml(money(b.expense, currency))}${b.expense_type ? `<br><small>${escapeHtml(b.expense_type)}</small>` : ''}</td>
        <td><strong>${escapeHtml(money(b.difference, currency))}</strong></td>
      `;
      paymentRowsNode.appendChild(tr);
    });
    if (!paymentRows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="11" class="reports-empty-cell">Поступлений из кассы за выбранный период нет.</td>';
      paymentRowsNode.appendChild(tr);
    }

    buildReconcileSummary(summaryNode, totals);
  }

  function balanceRows() {
    const byKey = new Map();
    courierDebts.forEach((row) => {
      const courier = String(row?.courier_name || '').trim();
      const currency = String(row?.currency || 'UZS').toUpperCase();
      if (!courier) return;
      const key = `${courier}|${currency}`;
      const item = byKey.get(key) || {
        courier_name: courier,
        currency,
        debit: 0,
        credit: 0,
        debt: 0,
        shipment_count: 0,
      };
      item.debit += Number(row?.total_amount || 0);
      item.credit += Number(row?.paid_amount || 0);
      item.debt += Number(row?.debt_amount || 0);
      item.shipment_count += Number(row?.shipment_count || 0);
      byKey.set(key, item);
    });
    return [...byKey.values()].sort((a, b) => (
      b.debt - a.debt
      || b.debit - a.debit
      || a.courier_name.localeCompare(b.courier_name, 'ru')
      || a.currency.localeCompare(b.currency)
    ));
  }

  const balanceViewMeta = {
    bars: {
      title: 'Дебет, кредит и долг',
      count: (rows) => `${rows.length} доставщиков`,
    },
    stack: {
      title: 'Кредит и долг внутри дебета',
      count: (rows) => `${rows.length} доставщиков`,
    },
    ranking: {
      title: 'Рейтинг по задолженности',
      count: (rows) => `Топ ${rows.length} доставщиков`,
    },
    share: {
      title: 'Доля в общей задолженности',
      count: (rows) => `${rows.length} долей`,
    },
    limits: {
      title: 'Контроль лимита долга',
      count: (rows) => `${rows.length} доставщиков`,
    },
  };

  function updateBalanceViewButtons() {
    document.querySelectorAll('[data-courier-balance-view]').forEach((button) => {
      const isActive = button.getAttribute('data-courier-balance-view') === courierBalanceView;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function renderBalanceBars(chartNode, rows, maxByCurrency) {
    rows.forEach((row) => {
      const max = maxByCurrency.get(row.currency) || 0;
      const item = document.createElement('div');
      item.className = 'reports-courier-balance-row';
      item.innerHTML = `
        <div class="reports-courier-balance-name">
          <strong>${courierNameButton(row.courier_name)}</strong>
          <span>${escapeHtml(row.currency)} · ${row.shipment_count} отгрузок</span>
        </div>
        <div class="reports-courier-balance-bars">
          <div class="reports-courier-balance-bar reports-courier-balance-bar--debit">
            <span>Дебет</span>
            <i><b style="width:${percent(row.debit, max)}%"></b></i>
            <em>${escapeHtml(money(row.debit, row.currency))}</em>
          </div>
          <div class="reports-courier-balance-bar reports-courier-balance-bar--credit">
            <span>Кредит</span>
            <i><b style="width:${percent(row.credit, max)}%"></b></i>
            <em>${escapeHtml(money(row.credit, row.currency))}</em>
          </div>
          <div class="reports-courier-balance-bar reports-courier-balance-bar--debt">
            <span>Долг</span>
            <i><b style="width:${percent(row.debt, max)}%"></b></i>
            <em>${escapeHtml(money(row.debt, row.currency))}</em>
          </div>
        </div>
      `;
      chartNode.appendChild(item);
    });
  }

  function renderBalanceStack(chartNode, rows) {
    rows.forEach((row) => {
      const base = Math.max(Number(row.debit || 0), Number(row.credit || 0) + Number(row.debt || 0));
      const creditWidth = percent(row.credit, base);
      const debtWidth = Math.max(0, 100 - creditWidth);
      const item = document.createElement('div');
      item.className = 'reports-courier-balance-stack';
      item.innerHTML = `
        <div class="reports-courier-balance-name">
          <strong>${courierNameButton(row.courier_name)}</strong>
          <span>${escapeHtml(money(row.debit, row.currency))} дебет · ${row.shipment_count} отгрузок</span>
        </div>
        <div class="reports-courier-stack-track" aria-label="Кредит и долг">
          <span class="reports-courier-stack-credit" style="width:${creditWidth}%"></span>
          <span class="reports-courier-stack-debt" style="width:${debtWidth}%"></span>
        </div>
        <div class="reports-courier-stack-legend">
          <span><i class="reports-courier-stack-credit"></i> Кредит ${escapeHtml(money(row.credit, row.currency))}</span>
          <span><i class="reports-courier-stack-debt"></i> Долг ${escapeHtml(money(row.debt, row.currency))}</span>
        </div>
      `;
      chartNode.appendChild(item);
    });
  }

  function renderBalanceRanking(chartNode, rows, maxDebt) {
    const list = document.createElement('div');
    list.className = 'reports-courier-balance-ranking';
    rows.forEach((row, index) => {
      const item = document.createElement('div');
      item.className = 'reports-courier-rank-card';
      item.innerHTML = `
        <div class="reports-courier-rank-number">${index + 1}</div>
        <div class="reports-courier-rank-bar"><span style="height:${percent(row.debt, maxDebt)}%"></span></div>
        <strong>${courierNameButton(row.courier_name)}</strong>
        <em>${escapeHtml(money(row.debt, row.currency))}</em>
      `;
      list.appendChild(item);
    });
    chartNode.appendChild(list);
  }

  function renderBalanceShare(chartNode, rows, debtTotals) {
    const list = document.createElement('div');
    list.className = 'reports-courier-balance-share';
    const visibleRows = rows.filter((row) => Number(row.debt || 0) > 0 && Number(debtTotals.get(row.currency) || 0) > 0);
    if (!visibleRows.length) {
      const empty = document.createElement('div');
      empty.className = 'reports-empty-state reports-empty-state--large';
      empty.textContent = 'По долям задолженности пока нет данных.';
      chartNode.appendChild(empty);
      return;
    }
    visibleRows.forEach((row) => {
      const share = percent(row.debt, debtTotals.get(row.currency) || 0);
      const item = document.createElement('div');
      item.className = 'reports-courier-share-card';
      item.innerHTML = `
        <div class="reports-courier-share-ring" style="--share:${share}%"><span>${share}%</span></div>
        <div>
          <strong>${courierNameButton(row.courier_name)}</strong>
          <span>${escapeHtml(money(row.debt, row.currency))} из общей задолженности ${escapeHtml(row.currency)}</span>
        </div>
      `;
      list.appendChild(item);
    });
    chartNode.appendChild(list);
  }

  function renderBalanceLimits(chartNode, rows) {
    const shell = document.createElement('div');
    shell.className = 'reports-courier-limit-shell';
    shell.innerHTML = `
      <div class="reports-courier-limit-toolbar">
        <div>
          <strong>Контроль баланса</strong>
          <span>Закрепите максимальный долг и смотрите, на сколько процентов доставщик заполнил лимит.</span>
        </div>
        <button type="button" class="btn btn-secondary" data-courier-limit-save ${courierDebtLimitSaving ? 'disabled' : ''}>Сохранить лимиты</button>
        <em data-courier-limit-status>${escapeHtml(courierDebtLimitStatus)}</em>
      </div>
      <div class="reports-courier-limit-grid"></div>
    `;
    const grid = shell.querySelector('.reports-courier-limit-grid');
    rows.forEach((row) => {
      const limit = courierLimitValue(row);
      const filled = limit > 0 ? Math.round(Number(row.debt || 0) / limit * 100) : 0;
      const capped = Math.max(0, Math.min(100, filled));
      const isOver = limit > 0 && Number(row.debt || 0) > limit;
      const card = document.createElement('article');
      card.className = `reports-courier-limit-card${isOver ? ' is-over' : ''}`;
      card.innerHTML = `
        <div class="reports-courier-limit-head">
          <div>
            <strong>${courierNameButton(row.courier_name)}</strong>
            <span>${escapeHtml(row.currency)} · ${row.shipment_count} отгрузок</span>
          </div>
          <div class="reports-courier-limit-ring${isOver ? ' is-over' : ''}" style="--fill:${capped}%"><span>${limit > 0 ? `${filled}%` : '0%'}</span></div>
        </div>
        <div class="reports-courier-limit-track"><span style="width:${capped}%"></span></div>
        <div class="reports-courier-limit-values">
          <span>Долг <b>${escapeHtml(money(row.debt, row.currency))}</b></span>
          <label>Максимальный долг
            <input
              class="reports-courier-limit-input"
              type="text"
              inputmode="decimal"
              data-courier-limit-input="${escapeHtml(courierLimitKey(row))}"
              value="${limit > 0 ? escapeHtml(formatLimitAmount(String(limit))) : ''}"
              placeholder="0"
            />
          </label>
        </div>
        <small>${limit > 0 ? escapeHtml(money(Math.max(limit - Number(row.debt || 0), 0), row.currency)) + ' осталось до лимита' : 'Лимит не задан'}</small>
      `;
      grid.appendChild(card);
    });
    chartNode.appendChild(shell);
  }

  function renderCourierBalancePanel() {
    const totalsNode = document.querySelector('[data-courier-balance-totals]');
    const chartNode = document.querySelector('[data-courier-balance-chart]');
    const countNode = document.querySelector('[data-courier-balance-count]');
    const titleNode = document.querySelector('[data-courier-balance-title]');
    if (!totalsNode || !chartNode) return;

    const rows = balanceRows();
    const totals = new Map();
    const maxByCurrency = new Map();
    const debtTotals = new Map();
    let maxDebt = 0;
    rows.forEach((row) => {
      const current = totals.get(row.currency) || { debit: 0, credit: 0, debt: 0, count: 0 };
      current.debit += row.debit;
      current.credit += row.credit;
      current.debt += row.debt;
      current.count += 1;
      totals.set(row.currency, current);
      debtTotals.set(row.currency, (debtTotals.get(row.currency) || 0) + row.debt);
      maxDebt = Math.max(maxDebt, row.debt);
      maxByCurrency.set(
        row.currency,
        Math.max(maxByCurrency.get(row.currency) || 0, row.debit, row.credit, row.debt)
      );
    });

    updateBalanceViewButtons();
    const viewMeta = balanceViewMeta[courierBalanceView] || balanceViewMeta.bars;
    if (titleNode) titleNode.textContent = viewMeta.title;
    totalsNode.replaceChildren();
    chartNode.replaceChildren();
    if (countNode) countNode.textContent = viewMeta.count(rows);

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'reports-empty-state reports-empty-state--large';
      empty.textContent = 'По доставщикам пока нет данных для баланса.';
      chartNode.appendChild(empty);
      return;
    }

    [...totals.entries()]
      .filter(([, item]) => Number(item.debit || 0) || Number(item.credit || 0) || Number(item.debt || 0))
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([currency, item]) => {
        const card = document.createElement('article');
        card.className = 'reports-courier-balance-total';
        card.innerHTML = `
          <span>${escapeHtml(currency)}</span>
          <strong>${escapeHtml(money(item.debt, currency))}</strong>
          <small>Общая задолженность</small>
          <div>
            <b>Дебет ${escapeHtml(money(item.debit, currency))}</b>
            <b>Кредит ${escapeHtml(money(item.credit, currency))}</b>
          </div>
        `;
        totalsNode.appendChild(card);
      });

    if (courierBalanceView === 'stack') {
      renderBalanceStack(chartNode, rows);
    } else if (courierBalanceView === 'ranking') {
      renderBalanceRanking(chartNode, rows, maxDebt);
    } else if (courierBalanceView === 'share') {
      renderBalanceShare(chartNode, rows, debtTotals);
    } else if (courierBalanceView === 'limits') {
      renderBalanceLimits(chartNode, rows);
    } else {
      renderBalanceBars(chartNode, rows, maxByCurrency);
    }
  }

  function initReconcileDatePicker() {
    const mount = document.getElementById('reports-reconcile-date-picker');
    if (!mount || !window.UPOS_DATE_RANGE || reconcileDatePicker) return;
    reconcileDatePicker = window.UPOS_DATE_RANGE.create(mount, {
      preset: reconcilePeriod,
      date_from: reconcileDateFrom,
      date_to: reconcileDateTo,
      onApply: (range) => {
        reconcilePeriod = range.preset || 'custom';
        reconcileDateFrom = range.date_from || '';
        reconcileDateTo = range.date_to || range.date_from || '';
        renderReconcilePanel();
      },
    });
  }

  function ensureOpen(tab) {
    if (!reportMeta[tab]) return;
    if (!openTabs.includes(tab)) openTabs.push(tab);
  }

  const storageKey = 'upos.homeReports.openTabs';

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ openTabs, activeTab }));
    } catch (err) {
      /* localStorage can be unavailable in private contexts. */
    }
  }

  function restoreState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const savedTabs = Array.isArray(saved.openTabs)
        ? saved.openTabs.filter((tab) => reportMeta[tab])
        : [];
      savedTabs.forEach(ensureOpen);
      activeTab = reportMeta[saved.activeTab] ? saved.activeTab : '';
      if (activeTab) ensureOpen(activeTab);
    } catch (err) {
      activeTab = '';
    }
  }

  function closeTab(tab) {
    const idx = openTabs.indexOf(tab);
    if (idx === -1) return;
    openTabs.splice(idx, 1);
    if (tab === 'courier-reconcile') reconcileCourierName = '';
    if (activeTab === tab) {
      activeTab = openTabs[idx] || openTabs[idx - 1] || '';
    }
    render();
  }

  function renderOpenTabs() {
    tabsShell.querySelectorAll('[data-org-report-open-tab]').forEach((node) => node.remove());
    const homeActive = !activeTab;
    homeTab.classList.toggle('active', homeActive);
    if (homeActive) homeTab.setAttribute('aria-current', 'page');
    else homeTab.removeAttribute('aria-current');

    openTabs.forEach((tab) => {
      const item = document.createElement('span');
      item.className = 'general-module-tab general-module-tab--report';
      item.setAttribute('data-org-report-open-tab', tab);

      const activate = document.createElement('button');
      activate.type = 'button';
      activate.className = 'general-module-tab-activate';
      activate.setAttribute('data-org-report-activate', tab);
      activate.setAttribute('role', 'tab');
      activate.textContent = tabLabel(tab);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'general-module-tab-close';
      close.setAttribute('data-org-report-close-tab', tab);
      close.setAttribute('aria-label', `Закрыть вкладку ${tabLabel(tab)}`);
      close.textContent = '×';

      item.append(activate, close);
      tabsShell.appendChild(item);
    });
  }

  function render() {
    renderOpenTabs();
    const hasReport = Boolean(activeTab);
    launcher.hidden = hasReport;
    root.hidden = !hasReport;

    document.querySelectorAll('[data-org-report-card]').forEach((card) => {
      const isActive = card.getAttribute('data-org-report-card') === activeTab;
      card.classList.toggle('active', isActive);
      card.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('[data-org-report-open-tab]').forEach((tabEl) => {
      tabEl.classList.toggle('active', tabEl.getAttribute('data-org-report-open-tab') === activeTab);
    });
    document.querySelectorAll('[data-org-report-activate]').forEach((btn) => {
      btn.setAttribute('aria-selected', btn.getAttribute('data-org-report-activate') === activeTab ? 'true' : 'false');
    });
    document.querySelectorAll('[data-org-report-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-org-report-panel') !== activeTab;
    });
    const activePanel = activeTab
      ? document.querySelector(`[data-org-report-panel="${CSS.escape(activeTab)}"]`)
      : null;
    if (activeTab === 'courier-reconcile') renderReconcilePanel();
    if (activeTab === 'courier-balance') renderCourierBalancePanel();
    if (activeTab === 'sales-cost') {
      applySalesCostStage(activePanel?.querySelector('[data-sales-cost-stage].active')?.getAttribute('data-sales-cost-stage') || 'all');
    }
    if (activePanel) enhanceSortableTables(activePanel);
    if (activeTab === 'profit' || activeTab === 'sales-cost') renderProfitCurrency(activePanel || document);
    if (activeTab === 'stock-analysis' || activeTab === 'stock-movement') renderStockCurrency(activePanel || document);
    saveState();
  }

  function openReport(tab) {
    if (!reportMeta[tab]) return;
    ensureOpen(tab);
    activeTab = tab;
    render();
  }

  function openReconcile(courierName) {
    reconcileCourierName = String(courierName || '').trim();
    resetReconcileFilter();
    ensureOpen('courier-reconcile');
    activeTab = 'courier-reconcile';
    render();
  }

  homeTab.addEventListener('click', (event) => {
    event.preventDefault();
    activeTab = '';
    render();
  });
  document.addEventListener('click', (event) => {
    const historyProduct = event.target.closest('[data-stock-history-product]');
    if (historyProduct) {
      openStockHistory(
        historyProduct.getAttribute('data-stock-history-product') || '',
        historyProduct.getAttribute('data-stock-history-name') || historyProduct.textContent.trim(),
      );
      return;
    }
    if (event.target.closest('[data-stock-history-close]')) {
      closeStockHistory();
      return;
    }
    const currencyButton = event.target.closest('[data-stock-currency]');
    if (currencyButton) {
      stockCurrency = currencyButton.getAttribute('data-stock-currency') === 'USD' ? 'USD' : 'UZS';
      renderStockCurrency();
      return;
    }
    const profitCurrencyButton = event.target.closest('[data-profit-currency]');
    if (profitCurrencyButton) {
      profitCurrency = profitCurrencyButton.getAttribute('data-profit-currency') === 'USD' ? 'USD' : 'UZS';
      renderProfitCurrency();
      return;
    }
    const sortButton = event.target.closest('[data-report-sort-column]');
    if (sortButton) {
      const table = sortButton.closest('table');
      if (!table) return;
      const nextDirection = sortButton.getAttribute('data-sort-direction') === 'desc' ? 'asc' : 'desc';
      table.querySelectorAll('[data-report-sort-column]').forEach((button) => {
        button.removeAttribute('data-sort-direction');
        button.querySelector('.reports-sort-icon').textContent = '↕';
      });
      sortButton.setAttribute('data-sort-direction', nextDirection);
      sortButton.querySelector('.reports-sort-icon').textContent = nextDirection === 'desc' ? '↓' : '↑';
      sortButton.setAttribute('aria-label', `${sortButton.firstElementChild.textContent}: сортировать ${nextDirection === 'desc' ? 'от меньшего к большему' : 'от большего к меньшему'}`);
      sortReportTable(table, Number(sortButton.getAttribute('data-report-sort-column')), nextDirection);
      return;
    }
    const balanceViewButton = event.target.closest('[data-courier-balance-view]');
    if (balanceViewButton) {
      courierBalanceView = balanceViewButton.getAttribute('data-courier-balance-view') || 'bars';
      renderCourierBalancePanel();
      return;
    }
    const limitSave = event.target.closest('[data-courier-limit-save]');
    if (limitSave) {
      saveCourierDebtLimits();
      return;
    }
    const card = event.target.closest('[data-org-report-card]');
    if (card) {
      openReport(card.getAttribute('data-org-report-card'));
      return;
    }
    const activate = event.target.closest('[data-org-report-activate]');
    if (activate) {
      openReport(activate.getAttribute('data-org-report-activate'));
      return;
    }
    const close = event.target.closest('[data-org-report-close-tab]');
    if (close) {
      closeTab(close.getAttribute('data-org-report-close-tab'));
      return;
    }
    const resetFilter = event.target.closest('[data-reconcile-reset]');
    if (resetFilter) {
      resetReconcileFilter();
      renderReconcilePanel();
      return;
    }
    const courierButton = event.target.closest('[data-courier-name]');
    if (courierButton) {
      openReconcile(courierButton.getAttribute('data-courier-name') || courierButton.textContent.trim());
    }
  });

  document.addEventListener('input', (event) => {
    const limitInput = event.target.closest('[data-courier-limit-input]');
    if (limitInput) {
      formatLimitInput(limitInput);
    }
  });

  document.addEventListener('change', (event) => {
    const periodNode = event.target.closest('[data-reconcile-period]');
    if (periodNode) {
      setReconcilePreset(periodNode.value);
      renderReconcilePanel();
      return;
    }
    const fromNode = event.target.closest('[data-reconcile-date-from]');
    if (fromNode) {
      reconcileDateFrom = fromNode.value || '';
      reconcilePeriod = 'custom';
      renderReconcilePanel();
      return;
    }
    const toNode = event.target.closest('[data-reconcile-date-to]');
    if (toNode) {
      reconcileDateTo = toNode.value || '';
      reconcilePeriod = 'custom';
      renderReconcilePanel();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeStockHistory();
  });

  // Выбор прайс-листа для колонки цены: значения обновляются на месте,
  // без перезагрузки страницы.
  document.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-stock-price-type-select]');
    if (!select) return;
    select.disabled = true;
    try {
      const response = await fetch(`/api/reports/stock-prices?price_type=${encodeURIComponent(select.value)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      const prices = payload.prices || {};
      document.querySelectorAll('[data-stock-price-cell]').forEach((cell) => {
        const entry = prices[cell.dataset.productId] || null;
        cell.textContent = entry ? entry.display : '-';
        cell.setAttribute('data-sort-value', entry ? entry.raw : '0');
      });
      // Запоминаем выбор в адресе, чтобы обновление страницы его сохранило.
      const url = new URL(window.location.href);
      url.searchParams.set('stock_price_type', select.value);
      window.history.replaceState(null, '', url.toString());
    } catch (error) {
      // При сбое честно перезагружаем страницу с выбранным прайсом.
      const url = new URL(window.location.href);
      url.searchParams.set('stock_price_type', select.value);
      window.location.href = url.toString();
    } finally {
      select.disabled = false;
    }
  });

  restoreState();
  render();
})();
