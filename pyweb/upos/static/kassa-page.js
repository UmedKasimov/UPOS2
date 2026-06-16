(() => {
  function i18n(key, fallback, vars) {
    const pack = window.upos_i18n || {};
    let text = pack[key] || fallback || key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach((name) => {
        text = String(text).replace(new RegExp('\\{' + name + '\\}', 'g'), String(vars[name]));
      });
    }
    return text;
  }

  function csrfFromMeta() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  /** Обновить meta и вернуть токен из сессии (если meta устарел — сохранение иначе даёт 403 csrf). */
  async function ensureFreshCsrf() {
    try {
      const r = await fetch('/api/csrf-token');
      if (!r.ok) return csrfFromMeta();
      const j = await r.json();
      const tok = typeof j.csrf_token === 'string' ? j.csrf_token : '';
      if (tok) {
        const m = document.querySelector('meta[name="csrf-token"]');
        if (m) m.setAttribute('content', tok);
        return tok;
      }
    } catch {
      /* ignore */
    }
    return csrfFromMeta();
  }

  async function fetchApiCsrf(method, url, bodyObj) {
    let token = csrfFromMeta();
    const run = async () => {
      const headers = { 'X-CSRF-Token': token };
      if (bodyObj != null) headers['Content-Type'] = 'application/json';
      return fetch(url, {
        method,
        headers,
        body: bodyObj != null ? JSON.stringify(bodyObj) : undefined,
      });
    };
    let res = await run();
    if (res.status === 403) {
      const err = await res
        .clone()
        .json()
        .catch(() => ({}));
      if (err && err.error === 'csrf') {
        token = await ensureFreshCsrf();
        if (token) res = await run();
      }
    }
    return res;
  }

  function apiErrorMessage(code) {
    const c = String(code || '').trim();
    if (c === 'csrf')
      return i18n('kassa.err.csrf', 'Запрос устарел (защита формы). Повторите сохранение — токен уже обновлён.');
    if (c === 'json') return i18n('kassa.err.json', 'Сервер не разобрал данные. Обновите страницу и попробуйте снова.');
    if (c === 'forbidden') return 'Недостаточно прав для этого действия';
    if (c === 'account_forbidden') return 'Этот счет недоступен текущему сотруднику';
    if (c === 'not_connected') return 'Telegram не подключён';
    if (c === 'no_targets') return 'Не выбрана Telegram группа для отчёта доставщиков';
    if (c === 'disabled') return 'Отчёт доставщиков выключен в Telegram настройках';
    if (c === 'unknown_report') return 'Неизвестный тип смс отчёта';
    if (c === 'transfer_confirmation_required') return 'Этот перевод управляется через подтверждение получателя';
    if (c === 'internal_error') return i18n('kassa.err.internal', 'Внутренняя ошибка сервера. Попробуйте позже или обновите страницу.');
    return c || i18n('kassa.err.generic', 'Ошибка при сохранении');
  }

  let transactions = [];
  let treasury = null;
  let transferTargets = [];
  let pendingTransfers = [];
  let categoriesCatalog = [];
  let categoriesRestricted = false;
  let courierDebts = [];
  let categoriesFetched = false;
  let salaryEmployees = [];
  let salaryEmployeesDate = '';
  let salaryEmployeeFetchPromise = null;
  let salaryPositionFilter = new Set();
  let referenceDataPromise = null;
  /** Курсы: единиц валюты за 1 USD (как в /api/fx/rates). */
  let fxRates = { USD: 1 };
  let fxMeta = { as_of: null, stale: true };
  const INCOME_CCY_FALLBACK = ['UZS', 'USD', 'RUB', 'EUR'];
  const CURRENCY_PICK_PRIORITY = ['UZS', 'USD', 'RUB', 'EUR'];
  const COLUMN_ORDER_KEY = 'upos:kassa:column-order:v1';
  const COLUMN_SORT_KEY = 'upos:kassa:column-sort:v1';
  const COLUMN_HIDDEN_KEY = 'upos:kassa:column-hidden:v1';
  const COLUMN_WIDTH_KEY = 'upos:kassa:column-widths:v1';
  const COLUMN_TEMPLATES_KEY = 'upos:kassa:column-templates:v1';
  const COLUMN_MIN_WIDTH = 76;
  const COLUMN_MAX_WIDTH = 560;
  const SUMMARY_CURRENCY_KEY = 'upos:kassa:summary-currency:v1';
  const COURIER_ACCOUNT_STORAGE_KEY = 'upos:kassa:courier-accounts:v1';
  const COLUMN_DEFAULT_WIDTHS = {
    number: 78,
    amount: 190,
    date: 190,
    client: 140,
    employee: 150,
    from: 150,
    to: 150,
    type: 120,
    confirmed: 260,
    category: 240,
    assets: 170,
    supplier: 160,
    'courier-summary': 220,
    'supplier-balance': 180,
    author: 130,
    branch: 150,
    note: 240,
    actions: 128,
  };
  const PAGE_SIZE_KEY = 'upos:kassa:page-size:v1';
  const TX_BATCH = 500;
  const MAX_DOM_ROWS = 200;
  const PAGE_SIZE_OPTIONS = [5, 10, 30, 50, 100, 'all'];
  const TOGGLEABLE_COLUMNS = [
    'client', 'employee', 'from', 'to', 'type', 'confirmed', 'category',
    'assets', 'supplier', 'courier-summary', 'supplier-balance', 'author', 'branch', 'note',
  ];
  const COURIER_PAYMENT_CATEGORY = 'Оплата от доставщиков';
  const SALARY_CATEGORY = 'Зарплата';
  const COLUMN_DEFS = [
    { key: 'number', label: i18n('kassa.col.number', '№'), locked: false, className: 'kassa-col-number' },
    { key: 'amount', label: i18n('kassa.col.amount', 'Сумма'), locked: false, className: 'kassa-col-amount' },
    { key: 'date', label: i18n('kassa.col.date', 'Дата создания'), locked: false, className: 'kassa-col-date' },
    { key: 'client', label: i18n('kassa.col.client', 'Клиент'), locked: false, className: 'kassa-col-client' },
    { key: 'employee', label: i18n('kassa.col.employee', 'Сотрудник'), locked: false, className: 'kassa-col-employee' },
    { key: 'from', label: i18n('kassa.col.from', 'Из кошелька'), locked: false, className: 'kassa-col-from' },
    { key: 'to', label: i18n('kassa.col.to', 'В кошелек'), locked: false, className: 'kassa-col-to' },
    { key: 'type', label: i18n('kassa.col.type', 'Тип'), locked: false, className: 'kassa-col-type' },
    { key: 'confirmed', label: 'Статус', locked: false, className: 'kassa-col-confirmed' },
    { key: 'category', label: i18n('kassa.col.category', 'Категория'), locked: false, className: 'kassa-col-category' },
    { key: 'assets', label: i18n('kassa.col.assets', 'Основные средства'), locked: false, className: 'kassa-col-assets' },
    { key: 'supplier', label: i18n('kassa.col.supplier', 'Поставщик'), locked: false, className: 'kassa-col-supplier' },
    { key: 'courier-summary', label: 'Расчёт доставщика', locked: false, className: 'kassa-col-courier-summary' },
    { key: 'supplier-balance', label: i18n('kassa.col.supplier_balance', 'Сальдо поставщика'), locked: false, className: 'kassa-col-supplier-balance' },
    { key: 'author', label: i18n('kassa.col.author', 'Автор'), locked: false, className: 'kassa-col-author' },
    { key: 'branch', label: i18n('kassa.col.branch', 'Филиал'), locked: false, className: 'kassa-col-branch' },
    { key: 'note', label: i18n('kassa.col.note', 'Примечание'), locked: false, className: 'kassa-col-note' },
    { key: 'actions', label: i18n('kassa.col.actions', 'Действия'), locked: true, className: 'kassa-col-actions' },
  ];
  let enabledCurrencies = [...INCOME_CCY_FALLBACK];
  let columnOrder = COLUMN_DEFS.map((c) => c.key);
  let columnSort = { key: '', dir: 'asc' };
  let columnHidden = new Set();
  let columnWidths = {};
  let columnTemplates = [];
  let pageIndex = 0;
  let pageSize = 10;
  let summaryCurrency =
    (localStorage.getItem(SUMMARY_CURRENCY_KEY) || 'UZS').trim().toUpperCase();
  let filteredRowsCache = null;
  let filteredRowsCacheKey = '';
  let transactionsLoadComplete = true;
  let draggingColumn = '';
  let resizingColumn = null;
  let columnLayoutFrame = 0;
  let transferRecalcLock = false;
  let simpleSplitRows = [];
  /** @type {'debit_amt'|'credit_amt'|'rate'|null} */
  let transferLastEdited = null;

  let workspaceTz =
    document.getElementById('kassa-root')?.dataset.workspaceTimezone?.trim() || 'Asia/Tashkent';

  let currentFilter = {
    search: '',
    category: [],
    dateStart: '',
    dateEnd: '',
    type: [],
    supplier: [],
    pocket: [],
    currency: [],
    status: [],
  };

  const MULTI_FILTER_KEYS = ['category', 'type', 'supplier', 'pocket', 'currency', 'status'];
  let multiFilterOptions = {
    category: [],
    type: [],
    supplier: [],
    pocket: [],
    currency: [],
    status: [],
  };

  const els = {
    root: document.getElementById('kassa-root'),
    status: document.getElementById('kassa-status'),
    tableBody: document.getElementById('kassa-table-body'),
    btnCreate: document.getElementById('kassa-create-new'),
    dialog: document.getElementById('kassa-editor-dialog'),
    btnClose: document.getElementById('kassa-editor-close'),
    btnCancel: document.getElementById('kassa-editor-cancel'),
    btnSave: document.getElementById('kassa-editor-save'),
    form: document.getElementById('kassa-form'),

    fSearch: document.getElementById('kassa-filter-search'),
    fCategory: document.getElementById('kassa-filter-category'),
    fDateStart: document.getElementById('kassa-filter-date-start'),
    fDateEnd: document.getElementById('kassa-filter-date-end'),
    fDateRange: document.getElementById('kassa-filter-date-range'),
    fType: document.getElementById('kassa-filter-type'),
    fSupplier: document.getElementById('kassa-filter-supplier'),
    fPocket: document.getElementById('kassa-filter-pocket'),
    fCurrency: document.getElementById('kassa-filter-currency'),
    fStatus: document.getElementById('kassa-filter-status'),
    smsToggle: document.getElementById('kassa-sms-toggle'),
    smsMenu: document.getElementById('kassa-sms-menu'),
    smsDate: document.getElementById('kassa-sms-date'),
    smsDailyCouriers: document.getElementById('kassa-sms-daily-couriers'),
    smsDailyExpenses: document.getElementById('kassa-sms-daily-expenses'),
    smsDailyTransfers: document.getElementById('kassa-sms-daily-transfers'),
    smsToday: document.getElementById('kassa-sms-today'),
    summaryIncome: document.getElementById('kassa-summary-income'),
    summaryExpense: document.getElementById('kassa-summary-expense'),
    summaryTransfer: document.getElementById('kassa-summary-transfer'),
    summaryBalance: document.getElementById('kassa-summary-balance'),
    summaryCurrency: document.getElementById('kassa-summary-currency'),

    table: document.getElementById('kassa-table'),
    columnsToggle: document.getElementById('kassa-columns-toggle'),
    columnsMenu: document.getElementById('kassa-columns-menu'),
    columnToggles: document.querySelector('[data-kassa-column-toggles]'),
    columnTemplateSelect: document.getElementById('kassa-column-template'),
    columnTemplateName: document.getElementById('kassa-column-template-name'),
    columnTemplateSave: document.getElementById('kassa-column-template-save'),
    columnTemplateDelete: document.getElementById('kassa-column-template-delete'),
    pagination: document.getElementById('kassa-pagination'),
    paginationInfo: document.getElementById('kassa-pagination-info'),
    pagePrev: document.getElementById('kassa-page-prev'),
    pageNext: document.getElementById('kassa-page-next'),
    pageIndicator: document.getElementById('kassa-page-indicator'),
    pageSizeSelect: document.getElementById('kassa-page-size'),
    pendingPanel: document.getElementById('kassa-pending-panel'),
    pendingList: document.getElementById('kassa-pending-list'),
    transferQueueBtn: document.getElementById('kassa-transfer-queue'),
    transferQueueCount: document.getElementById('kassa-transfer-queue-count'),
    transferQueueDialog: document.getElementById('kassa-transfer-queue-dialog'),
    transferQueueClose: document.getElementById('kassa-transfer-queue-close'),
    transferQueueRefresh: document.getElementById('kassa-transfer-queue-refresh'),
    transferQueueBody: document.getElementById('kassa-transfer-queue-body'),

    fieldType: document.getElementById('kassa-field-type'),
    paymentTabs: document.querySelectorAll('[data-payment-type]'),
    rowCategory: document.getElementById('kassa-row-category'),
    fieldCategory: document.getElementById('kassa-field-category'),
    rowCourierPayment: document.getElementById('kassa-row-courier-payment'),
    fieldCourierPayment: document.getElementById('kassa-field-courier-payment'),
    courierDebtHint: document.getElementById('kassa-courier-debt-hint'),
    rowCourierDetails: document.getElementById('kassa-row-courier-details'),
    courierResult: document.getElementById('kassa-courier-result'),
    rowSalaryEmployee: document.getElementById('kassa-row-salary-employee'),
    salaryEmployeeCombo: document.getElementById('kassa-salary-employee-combo'),
    salaryEmployeeButton: document.getElementById('kassa-salary-employee-button'),
    salaryEmployeeButtonLabel: document.getElementById('kassa-salary-employee-button-label'),
    salaryEmployeeMenu: document.getElementById('kassa-salary-employee-menu'),
    salaryEmployeeOptions: document.getElementById('kassa-salary-employee-options'),
    fieldSalaryEmployeeSearch: document.getElementById('kassa-field-salary-employee-search'),
    fieldSalaryEmployeeClear: document.getElementById('kassa-field-salary-employee-clear'),
    fieldSalaryEmployee: document.getElementById('kassa-field-salary-employee'),
    salaryPositionFilter: document.getElementById('kassa-salary-position-filter'),
    salaryPositionButton: document.getElementById('kassa-salary-position-button'),
    salaryPositionLabel: document.getElementById('kassa-salary-position-label'),
    salaryPositionMenu: document.getElementById('kassa-salary-position-menu'),
    salaryPositionSearch: document.getElementById('kassa-salary-position-search'),
    salaryPositionOptions: document.getElementById('kassa-salary-position-options'),
    salaryEmployeeHint: document.getElementById('kassa-salary-employee-hint'),
    rowFromPocket: document.getElementById('kassa-row-from-pocket'),
    rowToPocket: document.getElementById('kassa-row-to-pocket'),
    labelToPocket: document.getElementById('kassa-label-to-pocket'),
    fieldFromPocket: document.getElementById('kassa-field-from-pocket'),
    fieldToPocket: document.getElementById('kassa-field-to-pocket'),
    fieldCurrency: document.getElementById('kassa-field-currency'),
    fieldAmount: document.getElementById('kassa-field-amount'),
    transferWarning: document.getElementById('kassa-transfer-confirm-warning'),
    splitActions: document.getElementById('kassa-simple-split-actions'),
    splitAdd: document.getElementById('kassa-simple-split-add'),
    splitLines: document.getElementById('kassa-simple-split-lines'),
  };

  const AM = typeof window !== 'undefined' && window.UPOS_AMOUNT ? window.UPOS_AMOUNT : null;

  function ccOptionBaseLabel(cur) {
    const c = String(cur || '').toUpperCase();
    const M = typeof window !== 'undefined' && window.UPOS_CCY ? window.UPOS_CCY : null;
    return M && typeof M.optionLabel === 'function' ? M.optionLabel(c) : c;
  }

  function ccOptionAvailableLabel(cur, amount) {
    return i18n('kassa.ccy_available', '{currency} · доступно {amount}', {
      currency: ccOptionBaseLabel(cur),
      amount: formatBalanceAmt(amount, cur),
    });
  }

  function ccOptionAvailableHtml(cur, amount, selected) {
    const c = String(cur || '').toUpperCase();
    const selectedAttr = selected ? ' selected' : '';
    const balance = formatBalanceAmt(amount, c);
    return `<option value="${escapeHtml(c)}" data-balance-label="${escapeHtml(balance)}"${selectedAttr}>${escapeHtml(ccOptionAvailableLabel(c, amount))}</option>`;
  }

  function currencyPriority(currency) {
    const c = String(currency || '').toUpperCase();
    const idx = CURRENCY_PICK_PRIORITY.indexOf(c);
    return idx === -1 ? CURRENCY_PICK_PRIORITY.length : idx;
  }

  function sortCurrencyRows(rows) {
    return [...(rows || [])].sort((a, b) => {
      const pa = currencyPriority(a.currency);
      const pb = currencyPriority(b.currency);
      if (pa !== pb) return pa - pb;
      return String(a.currency || '').localeCompare(String(b.currency || ''));
    });
  }

  function normalizeCurrencyCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : '';
  }

  function transactionCurrencies(tx) {
    const values = [
      tx?.currency,
      tx?.data?.transfer_credit_currency,
      tx?.data?.transfer_commission_currency,
    ];
    return [...new Set(values.map(normalizeCurrencyCode).filter(Boolean))];
  }

  function upgradeKassaCcySelects() {
    const dlg = els.dialog;
    if (dlg && typeof window !== 'undefined' && window.UPOS_CCY_SELECT)
      window.UPOS_CCY_SELECT.upgradeAll(dlg);
  }

  function numGrouped(raw) {
    if (!AM) {
      const n = Number(String(raw ?? '').replace(/[\s\u202f\u00a0]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : NaN;
    }
    const n = Number(AM.stripSeparators(String(raw ?? '')));
    return Number.isFinite(n) ? n : NaN;
  }

  function refreshAmountScaleHints() {
    if (!AM) return;
    const simpleCcy = (els.fieldCurrency?.value || '').toUpperCase();
    AM.updateHintEl(
      document.getElementById('kassa-editor-amount-scale-hint'),
      numGrouped(els.fieldAmount?.value),
      simpleCcy,
    );
    const dc = (document.getElementById('kassa-field-debit-currency')?.value || '').toUpperCase();
    const cc = (document.getElementById('kassa-field-credit-currency')?.value || '').toUpperCase();
    const debitAmt = document.getElementById('kassa-field-debit-amount');
    const creditAmt = document.getElementById('kassa-field-credit-amount');
    AM.updateHintEl(document.getElementById('kassa-editor-debit-scale-hint'), numGrouped(debitAmt?.value), dc);
    AM.updateHintEl(document.getElementById('kassa-editor-credit-scale-hint'), numGrouped(creditAmt?.value), cc);
    const commEl = document.getElementById('kassa-field-transfer-commission');
    AM.updateHintEl(document.getElementById('kassa-editor-commission-scale-hint'), numGrouped(commEl?.value), dc);
    const rateEl = document.getElementById('kassa-field-transfer-rate');
    const rateHint = document.getElementById('kassa-editor-transfer-rate-scale-hint');
    if (rateHint && rateEl) {
      const r = numGrouped(rateEl.value);
      if (!Number.isFinite(r) || r <= 0) {
        rateHint.textContent = '';
        rateHint.hidden = true;
      } else {
        rateHint.textContent = AM.formatCompactBare(r);
        rateHint.hidden = false;
      }
    }
  }

  function formatSimpleAmountOnInput() {
    if (!els.fieldAmount || els.fieldAmount.disabled) {
      updateEditorHints();
      return;
    }
    const ccy = (els.fieldCurrency?.value || 'USD').toUpperCase();
    const raw = numGrouped(els.fieldAmount.value);
    if (!Number.isFinite(raw) || raw < 0) {
      updateEditorHints();
      return;
    }
    if (AM) AM.formatInputElement(els.fieldAmount, AM.decimalsForCurrency(ccy));
    else applyPlainNumberInput(els.fieldAmount, raw, ccy);
    updateEditorHints();
  }

  function isTransferForm() {
    return els.fieldType?.value === 'transfer';
  }

  function toggleMoneyPanels(isTransfer) {
    const simple = document.getElementById('kassa-simple-money');
    const transfer = document.getElementById('kassa-transfer-money');
    if (simple) simple.hidden = !!isTransfer;
    if (transfer) transfer.hidden = !isTransfer;
    simple?.querySelectorAll('input, select, textarea').forEach((el) => {
      el.disabled = !!isTransfer;
    });
    ['kassa-field-debit-currency', 'kassa-field-debit-amount', 'kassa-field-credit-currency', 'kassa-field-credit-amount', 'kassa-field-transfer-rate', 'kassa-field-transfer-commission'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !isTransfer;
    });
  }

  function transferDebitCreditCcys() {
    const dc = (document.getElementById('kassa-field-debit-currency')?.value || '').toUpperCase();
    const cc = (document.getElementById('kassa-field-credit-currency')?.value || '').toUpperCase();
    return { debitCcy: dc, creditCcy: cc };
  }

  function isCrossCurrencyTransfer() {
    const { debitCcy, creditCcy } = transferDebitCreditCcys();
    return !!(debitCcy && creditCcy && debitCcy !== creditCcy);
  }

  function setStatus(msg, variant) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    if (variant) els.status.setAttribute('data-variant', variant);
    else els.status.removeAttribute('data-variant');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function uniqueFilterValues(values) {
    const list = Array.isArray(values) ? values : [values];
    return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  function filterValues(key) {
    return uniqueFilterValues(currentFilter[key] || []);
  }

  function setFilterValues(key, values) {
    if (!MULTI_FILTER_KEYS.includes(key)) return;
    currentFilter[key] = uniqueFilterValues(values);
  }

  function filterMatches(key, value) {
    const selected = filterValues(key);
    return !selected.length || selected.includes(String(value || '').trim());
  }

  function multiFilterRoot(key) {
    return document.querySelector(`[data-kassa-multi-filter="${key}"]`);
  }

  function multiFilterPlaceholder(key) {
    const labels = {
      category: i18n('kassa.filter.category', 'Категория'),
      type: i18n('kassa.filter.type', 'Тип'),
      supplier: i18n('kassa.filter.supplier', 'Поставщик'),
      pocket: i18n('kassa.filter.pocket', 'Кошелек'),
      currency: 'Валюта',
      status: 'Все статусы',
    };
    return labels[key] || key;
  }

  function multiFilterEmptyLabel(key) {
    const labels = {
      category: 'Все категории',
      type: 'Все типы',
      supplier: 'Все поставщики',
      pocket: 'Все кошельки',
      currency: 'Все валюты',
      status: 'Все статусы',
    };
    return labels[key] || multiFilterPlaceholder(key);
  }

  function multiFilterOptionLabel(key, value) {
    const item = (multiFilterOptions[key] || []).find((option) => String(option.value) === String(value));
    return item ? item.label : String(value || '');
  }

  function syncMultiFilterState(key) {
    const root = multiFilterRoot(key);
    if (!root) return;
    const selected = filterValues(key);
    const button = root.querySelector('[data-multi-filter-button]');
    const label = root.querySelector('[data-multi-filter-label]');
    const menu = root.querySelector('[data-multi-filter-menu]');
    const isOpen = !!menu && !menu.hidden;

    root.classList.toggle('has-value', selected.length > 0);
    if (button) button.setAttribute('aria-expanded', String(isOpen));
    if (label) {
      label.textContent = selected.length === 0
        ? multiFilterPlaceholder(key)
        : selected.length === 1
          ? multiFilterOptionLabel(key, selected[0])
          : `${selected.length} выбрано`;
    }

    root.querySelectorAll('[data-multi-filter-option]').forEach((input) => {
      input.checked = selected.includes(String(input.value || '').trim());
      input.closest('.kassa-multi-filter-option')?.classList.toggle('is-checked', input.checked);
    });
    root.querySelector('[data-multi-filter-clear]')?.classList.toggle('is-checked', selected.length === 0);
  }

  function renderMultiFilter(key, options) {
    const root = multiFilterRoot(key);
    if (!root) return;
    const menu = root.querySelector('[data-multi-filter-menu]');
    if (!menu) return;
    const cleanOptions = (Array.isArray(options) ? options : [])
      .map((option) => ({
        value: String(option?.value || '').trim(),
        label: String(option?.label || option?.value || '').trim(),
      }))
      .filter((option) => option.value && option.label);
    multiFilterOptions[key] = cleanOptions;

    const allowed = new Set(cleanOptions.map((option) => option.value));
    setFilterValues(key, filterValues(key).filter((value) => allowed.has(value)));

    const rows = cleanOptions.map((option) => `
      <label class="kassa-multi-filter-option">
        <input type="checkbox" data-multi-filter-option value="${escapeHtml(option.value)}" />
        <span class="kassa-multi-filter-check" aria-hidden="true">✓</span>
        <span class="kassa-multi-filter-option-text">${escapeHtml(option.label)}</span>
      </label>
    `).join('');

    menu.innerHTML = `
      <button type="button" class="kassa-multi-filter-clear" data-multi-filter-clear>
        <span class="kassa-multi-filter-check" aria-hidden="true">✓</span>
        <span>${escapeHtml(multiFilterEmptyLabel(key))}</span>
      </button>
      ${rows || `<div class="kassa-multi-filter-empty">Нет вариантов</div>`}
    `;
    syncMultiFilterState(key);
  }

  function closeAllMultiFilters(exceptKey = '') {
    document.querySelectorAll('[data-kassa-multi-filter]').forEach((root) => {
      const key = root.dataset.kassaMultiFilter || '';
      if (exceptKey && key === exceptKey) return;
      const menu = root.querySelector('[data-multi-filter-menu]');
      if (menu) menu.hidden = true;
      syncMultiFilterState(key);
    });
  }

  function toggleMultiFilter(key) {
    const root = multiFilterRoot(key);
    const menu = root?.querySelector('[data-multi-filter-menu]');
    if (!root || !menu) return;
    const willOpen = menu.hidden;
    closeAllMultiFilters(key);
    menu.hidden = !willOpen;
    syncMultiFilterState(key);
  }

  function typeFilterOptions() {
    return [
      { value: 'income', label: i18n('kassa.type.income', 'Доход') },
      { value: 'expense', label: i18n('kassa.type.expense', 'Расход') },
      { value: 'transfer', label: i18n('kassa.type.transfer', 'Перевод') },
    ];
  }

  function statusFilterOptions() {
    return [
      { value: 'confirmed', label: 'Подтверждено' },
      { value: 'pending', label: 'Ожидание' },
      { value: 'draft', label: 'Черновик' },
      { value: 'rejected', label: 'Отклонено' },
    ];
  }

  function formatMoney(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    const s = Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const sign = n < 0 ? '−' : '';
    return `${sign}${s} ${currency || ''}`.trim();
  }

  /** Сумма с группировкой разрядов; без суффикса валюты (для чипов в футере). */
  function formatAmountGrouped(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    const s = Math.abs(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const sign = n < 0 ? '−' : '';
    return `${sign}${s}`;
  }

  function summaryCurrencySortKeys(keys) {
    return [...keys].sort((a, b) => {
      const pa = currencyPriority(a);
      const pb = currencyPriority(b);
      if (pa !== pb) return pa - pb;
      return String(a).localeCompare(String(b));
    });
  }

  function summaryCurrencyChipsHtml(map) {
    const keys = summaryCurrencySortKeys(
      Object.keys(map || {}).filter((k) => Math.abs(Number(map[k]) || 0) > 1e-9),
    );
    if (!keys.length) {
      return `<span class="kassa-summary-empty">${escapeHtml(i18n('kassa.summary.empty', '—'))}</span>`;
    }
    const M = typeof window !== 'undefined' && window.UPOS_CCY ? window.UPOS_CCY : null;
    const parts = keys.map((ccy) => {
      const raw = Number(map[ccy]) || 0;
      const amt = formatAmountGrouped(raw);
      const code = escapeHtml(ccy.toUpperCase());
      const ic = M && typeof M.iconHtmlSmall === 'function' ? M.iconHtmlSmall(ccy) : '';
      const neg = raw < 0 ? ' kassa-ccy-chip--negative' : '';
      return `<span class="kassa-ccy-chip${neg}" data-ccy="${code}">${ic}<span class="kassa-ccy-chip-amt">${escapeHtml(
        amt,
      )}</span><span class="kassa-ccy-chip-code">${code}</span></span>`;
    });
    return `<span class="kassa-ccy-chips">${parts.join('')}</span>`;
  }

  /**
   * Итоги по валютам в футере: не смешиваем суммы разных кодов ISO.
   * Подпись — код ISO (UZS, USD): компактно и однозначно.
   * @param {HTMLElement | null} el
   * @param {Record<string, number>} map
   */
  function renderSummaryCurrencyChips(el, map) {
    if (!el) return;
    const keys = summaryCurrencySortKeys(
      Object.keys(map || {}).filter((k) => Math.abs(Number(map[k]) || 0) > 1e-9),
    );
    if (!keys.length) {
      el.innerHTML = `<span class="kassa-summary-empty">${escapeHtml(
        i18n('kassa.summary.empty', '—'),
      )}</span>`;
      return;
    }
    const M = typeof window !== 'undefined' && window.UPOS_CCY ? window.UPOS_CCY : null;
    const parts = keys.map((ccy) => {
      const raw = Number(map[ccy]) || 0;
      const amt = formatAmountGrouped(raw);
      const code = escapeHtml(ccy.toUpperCase());
      const ic = M && typeof M.iconHtmlSmall === 'function' ? M.iconHtmlSmall(ccy) : '';
      const neg = raw < 0 ? ' kassa-ccy-chip--negative' : '';
      return `<span class="kassa-ccy-chip${neg}" data-ccy="${code}">${ic}<span class="kassa-ccy-chip-amt">${escapeHtml(
        amt,
      )}</span><span class="kassa-ccy-chip-code">${code}</span></span>`;
    });
    el.innerHTML = `<span class="kassa-ccy-chips">${parts.join('')}</span>`;
  }

  function summaryCurrencyChoices(totals) {
    const set = new Set();
    (treasury?.pockets || []).forEach((pocket) => {
      pocketBalancesList(pocket).forEach((row) => {
        const c = String(row.currency || '').trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(c)) set.add(c);
      });
    });
    if (!set.size) {
      [totals?.income, totals?.expense, totals?.transfer, totals?.balance].forEach((map) => {
        Object.keys(map || {}).forEach((ccy) => {
          const c = String(ccy || '').trim().toUpperCase();
          if (/^[A-Z]{3}$/.test(c)) set.add(c);
        });
      });
    }
    if (!set.size) {
      enabledCurrencies.forEach((ccy) => {
        const c = String(ccy || '').trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(c)) set.add(c);
      });
    }
    return summaryCurrencySortKeys([...set]);
  }

  function syncSummaryCurrencySelect(totals) {
    const select = els.summaryCurrency;
    if (!select) return;
    const choices = summaryCurrencyChoices(totals);
    if (!choices.includes(summaryCurrency)) summaryCurrency = choices[0] || 'UZS';
    select.innerHTML = choices
      .map((ccy) => `<option value="${escapeHtml(ccy)}"${ccy === summaryCurrency ? ' selected' : ''}>${escapeHtml(ccy)}</option>`)
      .join('');
    select.value = summaryCurrency;
  }

  function convertSummaryMap(map, targetCurrency) {
    const target = String(targetCurrency || 'UZS').trim().toUpperCase();
    let total = 0;
    const missing = [];
    Object.entries(map || {}).forEach(([ccy, raw]) => {
      const source = String(ccy || '').trim().toUpperCase();
      const amount = Number(raw) || 0;
      if (!source || Math.abs(amount) <= 1e-9) return;
      const converted = source === target ? amount : convertThroughUsd(amount, source, target, fxRates);
      if (converted == null) {
        missing.push(source);
        return;
      }
      total += converted;
    });
    return { total: roundMoneyAmt(total, target), missing };
  }

  function renderSummaryTotal(el, map, tone) {
    if (!el) return;
    const hasValues = Object.values(map || {}).some((value) => Math.abs(Number(value) || 0) > 1e-9);
    if (!hasValues) {
      el.innerHTML = `<span class="kassa-summary-empty">${escapeHtml(i18n('kassa.summary.empty', '—'))}</span>`;
      return;
    }
    const target = String(summaryCurrency || 'UZS').trim().toUpperCase();
    const result = convertSummaryMap(map, target);
    if (false && result.missing.length && Math.abs(result.total) <= 1e-9) {
      el.innerHTML = `<span class="kassa-summary-empty">${escapeHtml(i18n('general.no_rate', 'Нет курса'))}</span>`;
      return;
    }
    const hint = result.missing.length
      ? ` title="${escapeHtml(i18n('general.fx_missing', 'Нет курса для: {list}', { list: result.missing.join(', ') }))}"`
      : '';
    const toneClass = tone ? ` kassa-summary-total--${tone}` : '';
    const stackClass = tone ? ` kassa-summary-stack--${tone}` : '';
    const totalHtml = result.missing.length && Math.abs(result.total) <= 1e-9
      ? `<span class="kassa-summary-empty"${hint}>${escapeHtml(i18n('general.no_rate', 'РќРµС‚ РєСѓСЂСЃР°'))}</span>`
      : `<span class="kassa-summary-total${toneClass}"${hint}><span class="kassa-summary-total-label">${escapeHtml(
          i18n('kassa.summary.converted_total', 'Итого'),
        )}</span><span class="kassa-summary-total-amt">${escapeHtml(
          formatAmountGrouped(result.total),
        )}</span><span class="kassa-summary-total-code">${escapeHtml(target)}</span></span>`;
    el.innerHTML = `<span class="kassa-summary-stack${stackClass}"><span class="kassa-summary-original">${summaryCurrencyChipsHtml(
      map,
    )}</span>${totalHtml}</span>`;
  }

  /** Текст суммы для таблицы / экспорта (перевод с двумя валютами). */
  function formatTransferAmountSummary(tx) {
    if (tx.type !== 'transfer') return formatMoney(tx.amount, tx.currency);
    const dc = String(tx.currency || '').toUpperCase();
    const cc = String(tx.data?.transfer_credit_currency || dc).toUpperCase();
    const da = Number(tx.amount);
    const caRaw = tx.data?.transfer_credit_amount;
    const ca = caRaw != null ? Number(caRaw) : da;
    if (!Number.isFinite(da)) return '—';
    if (dc === cc || !Number.isFinite(ca))
      return formatMoney(da, dc);
    return `${formatMoney(da, dc).trim()} → ${formatMoney(ca, cc).trim()}`;
  }

  function utcIsoToDatetimeLocalValue(isoString, timeZone) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const s = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);
    return s.replace(' ', 'T');
  }

  function calendarDateInWorkspaceTz(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: workspaceTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  function currentWorkspaceDate() {
    return calendarDateInWorkspaceTz(new Date().toISOString());
  }

  function defaultSmsReportDate() {
    return els.smsDate?.value || els.fDateStart?.value || els.fDateEnd?.value || currentWorkspaceDate();
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', {
      timeZone: workspaceTz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function columnLetter(index) {
    let n = index + 1;
    let name = '';
    while (n > 0) {
      const mod = (n - 1) % 26;
      name = String.fromCharCode(65 + mod) + name;
      n = Math.floor((n - mod) / 26);
    }
    return name;
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      });
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = crc32.table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function writeUint16LE(target, value) {
    target.push(value & 0xff, (value >>> 8) & 0xff);
  }

  function writeUint32LE(target, value) {
    target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const stamp = dosDateTime(new Date());

    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
      const crc = crc32(dataBytes);
      const local = [];
      writeUint32LE(local, 0x04034b50);
      writeUint16LE(local, 20);
      writeUint16LE(local, 0x0800);
      writeUint16LE(local, 0);
      writeUint16LE(local, stamp.time);
      writeUint16LE(local, stamp.date);
      writeUint32LE(local, crc);
      writeUint32LE(local, dataBytes.length);
      writeUint32LE(local, dataBytes.length);
      writeUint16LE(local, nameBytes.length);
      writeUint16LE(local, 0);
      chunks.push(Uint8Array.from(local), nameBytes, dataBytes);

      const entry = [];
      writeUint32LE(entry, 0x02014b50);
      writeUint16LE(entry, 20);
      writeUint16LE(entry, 20);
      writeUint16LE(entry, 0x0800);
      writeUint16LE(entry, 0);
      writeUint16LE(entry, stamp.time);
      writeUint16LE(entry, stamp.date);
      writeUint32LE(entry, crc);
      writeUint32LE(entry, dataBytes.length);
      writeUint32LE(entry, dataBytes.length);
      writeUint16LE(entry, nameBytes.length);
      writeUint16LE(entry, 0);
      writeUint16LE(entry, 0);
      writeUint16LE(entry, 0);
      writeUint16LE(entry, 0);
      writeUint32LE(entry, 0);
      writeUint32LE(entry, offset);
      central.push(Uint8Array.from(entry), nameBytes);
      offset += local.length + nameBytes.length + dataBytes.length;
    });

    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = [];
    writeUint32LE(end, 0x06054b50);
    writeUint16LE(end, 0);
    writeUint16LE(end, 0);
    writeUint16LE(end, files.length);
    writeUint16LE(end, files.length);
    writeUint32LE(end, centralSize);
    writeUint32LE(end, offset);
    writeUint16LE(end, 0);
    return new Blob([...chunks, ...central, Uint8Array.from(end)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  function xlsxCell(value, rowNumber, colIndex, isHeader) {
    const ref = `${columnLetter(colIndex)}${rowNumber}`;
    const style = isHeader ? ' s="1"' : '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}"${style}><v>${value}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"${style}><is><t>${xmlEscape(value)}</t></is></c>`;
  }

  function buildTransactionsXlsx(headers, rows) {
    const allRows = [headers, ...rows];
    const columnWidths = headers.map((header, index) => {
      const maxLen = allRows.reduce((max, row) => Math.max(max, String(row[index] ?? '').length), 0);
      return Math.max(10, Math.min(42, maxLen + 2));
    });
    const lastCell = `${columnLetter(headers.length - 1)}${allRows.length}`;
    const colsXml = columnWidths
      .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
      .join('');
    const rowsXml = allRows
      .map((row, rowIndex) => {
        const rowNumber = rowIndex + 1;
        const cells = row.map((value, colIndex) => xlsxCell(value, rowNumber, colIndex, rowIndex === 0)).join('');
        return `<row r="${rowNumber}">${cells}</row>`;
      })
      .join('');

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${colsXml}</cols><sheetData>${rowsXml}</sheetData><autoFilter ref="A1:${lastCell}"/></worksheet>`;

    return createZip([
      {
        name: '[Content_Types].xml',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      },
      {
        name: '_rels/.rels',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: 'xl/workbook.xml',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Kassa" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      },
      {
        name: 'xl/styles.xml',
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
      },
      { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
    ]);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function highlightTxFromUrl() {
    try {
      const id = new URLSearchParams(window.location.search).get('tx');
      if (!id || !/^[a-fA-F0-9-]{36}$/.test(id.trim()) || !els.tableBody) return;
      const clean = id.trim();
      const row = els.tableBody.querySelector(`tr[data-tx-id="${clean}"]`);
      if (!row) return;
      row.classList.add('kassa-row-highlight');
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      window.setTimeout(() => row.classList.remove('kassa-row-highlight'), 4500);
    } catch {
      /* ignore */
    }
  }

  function yieldToMain() {
    return new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  function invalidateFilteredCache() {
    filteredRowsCache = null;
    filteredRowsCacheKey = '';
  }

  function filterCacheKey() {
    return `${JSON.stringify(currentFilter)}|${columnSort.key}|${columnSort.dir}|${transactions.length}`;
  }

  function setLoadingStatus(count) {
    const tpl = i18n('kassa.status.loading_count', 'Загрузка… {count}');
    setStatus(tpl.replace('{count}', String(count != null ? count : '')), null);
  }

  function isEditorReferenceDataReady() {
    return treasury !== null && categoriesFetched;
  }

  async function ensureEditorDataLoaded() {
    if (isEditorReferenceDataReady()) return;
    if (!referenceDataPromise) {
      referenceDataPromise = fetchTreasuryAndCategories().finally(() => {
        referenceDataPromise = null;
      });
    }
    await referenceDataPromise;
  }

  function refreshEditorReferenceData() {
    if (!els.dialog?.open) return;
    populatePocketSelects();
    const type = els.fieldType?.value || 'expense';
    if (type === 'income' || type === 'expense' || type === 'transfer') {
      const preserve = els.fieldCategory?.value || '';
      populateCategoryField(type, preserve);
    }
    void syncSalaryEmployeeUI({ preserveValue: els.fieldSalaryEmployee?.value || '' });
  }

  function applyTreasuryPayload(trData) {
    treasury = trData.treasury || null;
    transferTargets = Array.isArray(trData.transfer_targets)
      ? trData.transfer_targets
      : (treasury?.pockets || []);
    if (trData.settings && Array.isArray(trData.settings.enabled_currencies)) {
      const clean = trData.settings.enabled_currencies
        .map((x) => String(x || '').trim().toUpperCase())
        .filter((x) => /^[A-Z]{3}$/.test(x));
      if (clean.length) enabledCurrencies = clean;
    }
    if (trData.settings && typeof trData.settings.timezone === 'string' && trData.settings.timezone.trim()) {
      workspaceTz = trData.settings.timezone.trim();
      const root = document.getElementById('kassa-root');
      if (root) root.dataset.workspaceTimezone = workspaceTz;
    }
    populatePocketSelects();
    refreshEditorReferenceData();
  }

  async function loadRemainingTransactions(startOffset) {
    let offset = startOffset;
    try {
      while (true) {
        const res = await fetch(`/api/transactions?limit=${TX_BATCH}&offset=${offset}`);
        if (!res.ok) break;
        const data = await res.json();
        const chunk = Array.isArray(data.transactions) ? data.transactions : [];
        if (!chunk.length) break;
        transactions.push(...chunk);
        invalidateFilteredCache();
        setLoadingStatus(transactions.length);
        if (chunk.length < TX_BATCH) break;
        offset += TX_BATCH;
        await yieldToMain();
      }
      populateFilterOptions();
      renderKassaView();
      setStatus('', null);
    } catch {
      /* фоновая догрузка не блокирует уже показанные данные */
    } finally {
      transactionsLoadComplete = true;
    }
  }

  async function fetchTreasuryAndCategories() {
    const [trRes, catRes, courierRes] = await Promise.all([
      fetch('/api/treasury'),
      fetch('/api/categories'),
      fetch('/api/shipments/courier-debts'),
    ]);

    if (trRes.ok) {
      applyTreasuryPayload(await trRes.json());
    } else {
      setStatus(i18n('kassa.load_err_treasury', 'Не удалось загрузить кассу'), 'err');
    }

    if (catRes.ok) {
      const catData = await catRes.json();
      categoriesCatalog = Array.isArray(catData.categories) ? catData.categories : [];
      categoriesRestricted = !!catData.restricted;
      if (!catData.restricted && !categoriesCatalog.some((cat) => cat && cat.type === 'income' && cat.name === COURIER_PAYMENT_CATEGORY)) {
        categoriesCatalog.push({ id: '', name: COURIER_PAYMENT_CATEGORY, type: 'income' });
      }
      categoriesFetched = true;
    } else if (trRes.ok) {
      setStatus(i18n('kassa.load_err_categories', 'Не удалось загрузить категории'), 'err');
      categoriesRestricted = false;
      categoriesFetched = true;
    } else if (!trRes.ok) {
      setStatus(i18n('kassa.load_err_treasury', 'Не удалось загрузить кассу'), 'err');
    }
    if (courierRes.ok) {
      const courierData = await courierRes.json().catch(() => ({}));
      courierDebts = Array.isArray(courierData.courier_debts) ? courierData.courier_debts : [];
    } else {
      courierDebts = [];
    }
    populateCourierPaymentSelect();
    refreshEditorReferenceData();
  }

  function courierDebtRowsForName(name) {
    const clean = String(name || '').trim();
    return courierDebts.filter((row) => String(row?.courier_name || '').trim() === clean);
  }

  function courierDebtHintText(name) {
    const rows = courierDebtRowsForName(name);
    if (!rows.length) return '';
    return rows
      .map((row) => `${formatBalanceAmt(row.debt_amount, row.currency)} ${String(row.currency || '').toUpperCase()}`)
      .join(' · ');
  }

  function populateCourierPaymentSelect(preserveValue) {
    const select = els.fieldCourierPayment;
    if (!select) return;
    const current = preserveValue != null ? String(preserveValue || '') : select.value;
    const names = [...new Set(courierDebts.map((row) => String(row?.courier_name || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
    if (current && !names.includes(current)) names.push(current);
    select.innerHTML =
      '<option value="">Выберите доставщика</option>' +
      names.map((name) => {
        const hint = courierDebtHintText(name);
        const label = hint ? `${name} · долг ${hint}` : name;
        return `<option value="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
      }).join('');
    if (current && [...select.options].some((opt) => opt.value === current)) select.value = current;
    syncCourierPaymentUI();
  }

  function isCourierPaymentMode() {
    return (els.fieldType?.value || '') === 'income' && (els.fieldCategory?.value || '') === COURIER_PAYMENT_CATEGORY;
  }

  function courierPaymentLockedForEdit() {
    return isCourierPaymentMode() && !!String(document.getElementById('kassa-field-id')?.value || '').trim();
  }

  const COURIER_MONEY_FIELDS = [
    'transfer',
    'return_goods',
    'discount',
    'terminal',
    'current_debt',
    'old_debt',
    'expense',
    'cash',
  ];
  const COURIER_ACCOUNT_FIELDS = ['transfer_account_id', 'terminal_account_id', 'cash_account_id'];

  function courierInput(name) {
    return els.rowCourierDetails?.querySelector(`[data-courier-field="${name}"]`) || null;
  }

  function courierNumber(name) {
    const input = courierInput(name);
    const value = AM && input ? AM.parseAmount(input.value) : numGrouped(input?.value || '');
    return Number.isFinite(value) ? value : 0;
  }

  function courierAccountSelect(name) {
    return els.rowCourierDetails?.querySelector(`[data-courier-account="${name}"]`) || null;
  }

  function courierAccountStorageKey() {
    const scope = String(els.root?.dataset.activeOrgId || document.body?.dataset.userId || 'default').trim() || 'default';
    return `${COURIER_ACCOUNT_STORAGE_KEY}:${scope}`;
  }

  function loadCourierAccountPrefs() {
    try {
      const data = JSON.parse(safeStorageGet(courierAccountStorageKey()) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  function saveCourierAccountPrefs() {
    const data = {};
    COURIER_ACCOUNT_FIELDS.forEach((key) => {
      const value = String(courierAccountSelect(key)?.value || '').trim();
      if (value) data[key] = value;
    });
    safeStorageSet(courierAccountStorageKey(), JSON.stringify(data));
  }

  function courierAccountLabel(accountId) {
    const pocket = getPocketById(accountId) || getTransferTargetById(accountId);
    if (!pocket) return '';
    const owner = String(pocket.owner_employee_name || '').trim();
    const base = pocket.label || i18n('kassa.no_name', 'Без названия');
    return owner ? `${base} · ${owner}` : base;
  }

  function isCourierTransferAccount(pocket) {
    const label = String(pocket?.label || '').trim().toLowerCase();
    const templateId = String(pocket?.template_id || pocket?.templateId || '').trim();
    return /\u043f\u0435\u0440\u0435\u0447\u0438\u0441\u043b/i.test(label) || templateId === 'transit_company_uz';
  }

  function courierAccountRows() {
    const rows = Array.isArray(treasury?.pockets) ? [...treasury.pockets] : [];
    const seen = new Set(rows.map((pocket) => String(pocket?.id || '').trim()).filter(Boolean));
    (Array.isArray(transferTargets) ? transferTargets : []).forEach((pocket) => {
      const id = String(pocket?.id || '').trim();
      if (!id || seen.has(id) || !isCourierTransferAccount(pocket)) return;
      rows.push(pocket);
      seen.add(id);
    });
    return rows;
  }

  function courierKnownShipmentTotal() {
    const rows = courierDebtRowsForName(els.fieldCourierPayment?.value || '');
    const currency = (els.fieldCurrency?.value || '').toUpperCase();
    const filtered = currency ? rows.filter((row) => String(row.currency || '').toUpperCase() === currency) : rows;
    return filtered.reduce((sum, row) => sum + (Number(row.total_amount || 0) || 0), 0);
  }

  function courierCurrentDebtTotal() {
    const rows = courierDebtRowsForName(els.fieldCourierPayment?.value || '');
    const currency = (els.fieldCurrency?.value || '').toUpperCase();
    const filtered = currency ? rows.filter((row) => String(row.currency || '').toUpperCase() === currency) : rows;
    return filtered.reduce((sum, row) => sum + (Number(row.debt_amount || 0) || 0), 0);
  }

  function populateCourierAccountSelects(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const stored = loadCourierAccountPrefs();
    const pockets = courierAccountRows();
    const options = '<option value="">Выберите счёт</option>' + pockets
      .map((pocket) => `<option value="${escapeHtml(pocket.id)}">${escapeHtml(courierAccountLabel(pocket.id))}</option>`)
      .join('');
    COURIER_ACCOUNT_FIELDS.forEach((key) => {
      const select = courierAccountSelect(key);
      if (!select) return;
      const hasStoredData = Object.prototype.hasOwnProperty.call(data, key);
      const current = hasStoredData
        ? String(data[key] || '')
        : String(stored[key] || (key === 'cash_account_id' ? (els.fieldToPocket?.value || '') : '') || select.value || '');
      select.innerHTML = options;
      if (current && [...select.options].some((opt) => opt.value === current)) select.value = current;
    });
  }

  function syncCourierCashAccountToMain() {
    if (!isCourierPaymentMode()) return;
    const cashAccountId = String(courierAccountSelect('cash_account_id')?.value || '').trim();
    if (!cashAccountId || !els.fieldToPocket) return;
    if (els.fieldToPocket.value !== cashAccountId) {
      els.fieldToPocket.value = cashAccountId;
      syncEditorCurrencySelect({ preferCurrency: els.fieldCurrency?.value || '' });
      syncSimpleSplitAvailability();
    }
  }

  function courierBreakdownFromDom() {
    const result = {};
    COURIER_MONEY_FIELDS.forEach((key) => {
      result[key] = courierNumber(key);
    });
    result.expense_type = String(courierInput('expense_type')?.value || '').trim();
    COURIER_ACCOUNT_FIELDS.forEach((key) => {
      const id = String(courierAccountSelect(key)?.value || '').trim();
      result[key] = id;
      result[`${key}_label`] = courierAccountLabel(id);
    });
    result.shipment_total = roundMoneyAmt(courierKnownShipmentTotal(), els.fieldCurrency?.value || 'UZS');
    result.debt_base = roundMoneyAmt(courierCurrentDebtTotal(), els.fieldCurrency?.value || 'UZS');
    const delivered = Math.max(0, result.shipment_total - result.return_goods);
    const expectedBase = result.debt_base > 0 ? result.debt_base : delivered;
    const expectedCash = expectedBase
      - result.transfer
      - result.return_goods
      - result.discount
      - result.terminal
      - result.current_debt
      + result.old_debt
      - result.expense;
    result.delivered_total = roundMoneyAmt(delivered, els.fieldCurrency?.value || 'UZS');
    result.expected_base = roundMoneyAmt(expectedBase, els.fieldCurrency?.value || 'UZS');
    result.expected_cash = roundMoneyAmt(expectedCash, els.fieldCurrency?.value || 'UZS');
    result.difference = roundMoneyAmt(result.cash - expectedCash, els.fieldCurrency?.value || 'UZS');
    return result;
  }

  function setCourierBreakdownInputs(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    COURIER_MONEY_FIELDS.forEach((key) => {
      const input = courierInput(key);
      if (!input) return;
      const value = Number(data[key] || 0);
      if (AM) AM.setInputFromNumber(input, Number.isFinite(value) ? value : 0, AM.decimalsForCurrency(els.fieldCurrency?.value || 'UZS'));
      else input.value = Number.isFinite(value) && value ? String(value) : '';
    });
    const expenseType = courierInput('expense_type');
    if (expenseType) expenseType.value = String(data.expense_type || '');
    populateCourierAccountSelects(data);
    updateCourierBreakdownResult();
  }

  function updateCourierBreakdownResult(syncAmount = false) {
    if (!els.rowCourierDetails || !els.courierResult) return;
    const data = courierBreakdownFromDom();
    const currency = (els.fieldCurrency?.value || 'UZS').toUpperCase();
    if (syncAmount && els.fieldAmount) {
      if (AM) AM.setInputFromNumber(els.fieldAmount, data.cash, AM.decimalsForCurrency(currency));
      else els.fieldAmount.value = data.cash ? String(data.cash) : '';
      refreshAmountScaleHints();
      updateEditorHints();
    }
    const diffTone = data.difference === 0 ? '' : data.difference > 0 ? 'plus' : 'minus';
    els.courierResult.innerHTML = `
      <span>Отгружено по акту: ${escapeHtml(formatBalanceAmt(data.shipment_total, currency))} ${escapeHtml(currency)}</span>
      <span>К оплате по долгу: ${escapeHtml(formatBalanceAmt(data.expected_cash, currency))} ${escapeHtml(currency)}</span>
      <strong data-tone="${escapeHtml(diffTone)}">Разница: ${escapeHtml(formatBalanceAmt(data.difference, currency))} ${escapeHtml(currency)}</strong>
    `;
  }

  function courierBreakdownSummary(tx) {
    const d = tx?.data?.courier_breakdown;
    if (!d || typeof d !== 'object') return '';
    const currency = String(tx?.currency || 'UZS').toUpperCase();
    const diff = Number(d.difference || 0);
    const cash = Number(d.cash || tx?.amount || 0);
    return `Наличные ${formatBalanceAmt(cash, currency)} ${currency}; разница ${formatBalanceAmt(diff, currency)} ${currency}`;
  }

  function syncCourierPaymentUI() {
    const active = isCourierPaymentMode();
    if (els.rowCourierPayment) els.rowCourierPayment.hidden = !active;
    if (els.rowCourierDetails) els.rowCourierDetails.hidden = !active;
    els.rowCourierDetails?.querySelectorAll('input, select').forEach((input) => {
      input.disabled = !active;
    });
    if (els.fieldCourierPayment) {
      els.fieldCourierPayment.disabled = !active || courierPaymentLockedForEdit();
      if (active) els.fieldCourierPayment.setAttribute('required', 'required');
      else {
        els.fieldCourierPayment.removeAttribute('required');
        els.fieldCourierPayment.value = '';
        setCourierBreakdownInputs({});
      }
    }
    if (!els.courierDebtHint) return;
    const hint = active ? courierDebtHintText(els.fieldCourierPayment?.value || '') : '';
    els.courierDebtHint.textContent = hint ? `Текущий долг: ${hint}` : '';
    els.courierDebtHint.hidden = !hint;
    if (active) updateCourierBreakdownResult();
  }

  function editorLocalDateValue() {
    return String(document.getElementById('kassa-field-date')?.value || '').slice(0, 10)
      || new Date().toISOString().slice(0, 10);
  }

  function isSalaryPaymentMode() {
    return (els.fieldType?.value || '') === 'expense'
      && String(els.fieldCategory?.value || '').trim() === SALARY_CATEGORY;
  }

  function salaryEmployeeById(id) {
    const clean = String(id || '').trim();
    if (!clean) return null;
    return salaryEmployees.find((emp) => String(emp?.id || '').trim() === clean) || null;
  }

  function salaryEmployeePaidLabel(emp) {
    const paid = emp?.paid_by_currency && typeof emp.paid_by_currency === 'object'
      ? emp.paid_by_currency
      : {};
    const parts = Object.entries(paid)
      .filter(([, amount]) => Number(amount) > 0)
      .map(([currency, amount]) => `${formatBalanceAmt(amount, currency)} ${String(currency || '').toUpperCase()}`);
    return parts.length ? parts.join(' · ') : '0 UZS';
  }

  function salaryEmployeeOptionLabel(emp) {
    const name = String(emp?.name || '').trim() || 'Сотрудник';
    const balance = Number(emp?.balance_uzs);
    if (!Number.isFinite(balance)) return name;
    const label = balance < 0 ? 'переплата' : 'к выплате';
    return `${name} · ${label} ${formatMoney(Math.abs(balance), 'UZS')}`;
  }

  function salaryEmployeeSearchText() {
    return String(els.fieldSalaryEmployeeSearch?.value || '').trim().toLowerCase();
  }

  function salaryPositionSearchText() {
    return String(els.salaryPositionSearch?.value || '').trim().toLowerCase();
  }

  function salaryEmployeePositionLabel(emp) {
    return String(emp?.position || emp?.role || '').trim() || 'Без должности';
  }

  function salaryEmployeePositions() {
    const seen = new Set();
    salaryEmployees.forEach((emp) => {
      const label = salaryEmployeePositionLabel(emp);
      if (label) seen.add(label);
    });
    return [...seen].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function salaryPositionAllowed(position) {
    return !salaryPositionFilter.size || salaryPositionFilter.has(position);
  }

  function filteredSalaryEmployees() {
    const query = salaryEmployeeSearchText();
    return salaryEmployees.filter((emp) => {
      const position = salaryEmployeePositionLabel(emp);
      if (!salaryPositionAllowed(position)) return false;
      if (!query) return true;
      const haystack = [
        emp?.name,
        position,
        salaryEmployeeOptionLabel(emp),
      ].map((part) => String(part || '').toLowerCase()).join(' ');
      return haystack.includes(query);
    });
  }

  function closeSalaryEmployeeMenu() {
    if (els.salaryEmployeeMenu) els.salaryEmployeeMenu.hidden = true;
    if (els.salaryEmployeeButton) els.salaryEmployeeButton.setAttribute('aria-expanded', 'false');
  }

  function openSalaryEmployeeMenu() {
    if (!isSalaryPaymentMode() || !els.salaryEmployeeMenu) return;
    closeSalaryPositionMenu();
    els.salaryEmployeeMenu.hidden = false;
    if (els.salaryEmployeeButton) els.salaryEmployeeButton.setAttribute('aria-expanded', 'true');
    setTimeout(() => els.fieldSalaryEmployeeSearch?.focus(), 0);
  }

  function closeSalaryPositionMenu() {
    if (els.salaryPositionMenu) els.salaryPositionMenu.hidden = true;
    if (els.salaryPositionButton) els.salaryPositionButton.setAttribute('aria-expanded', 'false');
  }

  function openSalaryPositionMenu() {
    if (!isSalaryPaymentMode() || !els.salaryPositionMenu) return;
    closeSalaryEmployeeMenu();
    els.salaryPositionMenu.hidden = false;
    if (els.salaryPositionButton) els.salaryPositionButton.setAttribute('aria-expanded', 'true');
    setTimeout(() => els.salaryPositionSearch?.focus(), 0);
  }

  function renderSalaryEmployeePicker() {
    const selected = salaryEmployeeById(els.fieldSalaryEmployee?.value || '');
    if (els.salaryEmployeeButtonLabel) {
      els.salaryEmployeeButtonLabel.textContent = selected
        ? salaryEmployeeOptionLabel(selected)
        : 'Выберите сотрудника';
    }
    if (!els.salaryEmployeeOptions) return;
    const rows = filteredSalaryEmployees();
    if (!rows.length) {
      els.salaryEmployeeOptions.innerHTML = '<div class="kassa-salary-empty">Сотрудник не найден</div>';
      return;
    }
    const selectedId = String(els.fieldSalaryEmployee?.value || '');
    els.salaryEmployeeOptions.innerHTML = rows.map((emp) => {
      const id = String(emp?.id || '');
      const active = id === selectedId;
      const position = salaryEmployeePositionLabel(emp);
      return `
        <button type="button" class="kassa-salary-employee-option${active ? ' is-selected' : ''}" data-salary-employee-id="${escapeHtml(id)}" role="option" aria-selected="${active ? 'true' : 'false'}">
          <strong>${escapeHtml(String(emp?.name || '').trim() || 'Сотрудник')}</strong>
          <span>${escapeHtml(position)} · ${escapeHtml(salaryEmployeeOptionLabel(emp).replace(String(emp?.name || '').trim(), '').replace(/^ · /, ''))}</span>
        </button>
      `;
    }).join('');
  }

  function renderSalaryPositionFilter() {
    const positions = salaryEmployeePositions();
    if (els.salaryPositionFilter) els.salaryPositionFilter.hidden = !positions.length;
    if (els.salaryPositionLabel) {
      if (!salaryPositionFilter.size || salaryPositionFilter.size === positions.length) {
        els.salaryPositionLabel.textContent = 'Все должности';
      } else if (salaryPositionFilter.size === 1) {
        els.salaryPositionLabel.textContent = [...salaryPositionFilter][0];
      } else {
        els.salaryPositionLabel.textContent = `${salaryPositionFilter.size} должности`;
      }
    }
    if (!els.salaryPositionOptions) return;
    const q = salaryPositionSearchText();
    const visible = positions.filter((pos) => !q || pos.toLowerCase().includes(q));
    const allChecked = !salaryPositionFilter.size || salaryPositionFilter.size === positions.length;
    const rows = [
      `<label class="kassa-salary-position-option"><input type="checkbox" data-salary-position-all ${allChecked ? 'checked' : ''} /> <span>Выбрать все</span></label>`,
      ...visible.map((pos) => {
        const checked = !salaryPositionFilter.size || salaryPositionFilter.has(pos);
        return `<label class="kassa-salary-position-option"><input type="checkbox" data-salary-position-option value="${escapeHtml(pos)}" ${checked ? 'checked' : ''} /> <span>${escapeHtml(pos)}</span></label>`;
      }),
    ];
    els.salaryPositionOptions.innerHTML = rows.join('') || '<div class="kassa-salary-empty">Должности не найдены</div>';
  }

  function renderSalaryPickerControls() {
    renderSalaryPositionFilter();
    renderSalaryEmployeePicker();
  }

  function updateSalaryEmployeeHint() {
    if (!els.salaryEmployeeHint) return;
    if (!isSalaryPaymentMode()) {
      els.salaryEmployeeHint.hidden = true;
      els.salaryEmployeeHint.textContent = '';
      return;
    }
    const emp = salaryEmployeeById(els.fieldSalaryEmployee?.value || '');
    if (!emp) {
      els.salaryEmployeeHint.textContent = salaryEmployees.length && filteredSalaryEmployees().length === 0
        ? 'Сотрудник по поиску не найден.'
        : salaryEmployees.length
        ? 'Выберите сотрудника, чтобы увидеть долг по зарплате.'
        : 'В HR пока нет сотрудников для выбора.';
      els.salaryEmployeeHint.hidden = false;
      return;
    }
    const balance = Number(emp.balance_uzs || 0);
    const balanceTitle = balance < 0 ? 'Переплата' : 'Мы должны';
    const salaryDue = formatMoney(emp.salary_due || 0, 'UZS');
    const paid = salaryEmployeePaidLabel(emp);
    els.salaryEmployeeHint.textContent =
      `${balanceTitle}: ${formatMoney(Math.abs(balance), 'UZS')} · Начислено: ${salaryDue} · Выплачено: ${paid}`;
    els.salaryEmployeeHint.hidden = false;
  }

  function populateSalaryEmployeeSelect(preserveValue) {
    const select = els.fieldSalaryEmployee;
    if (!select) return;
    const current = preserveValue != null ? String(preserveValue || '') : select.value;
    if (els.fieldSalaryEmployeeClear) {
      els.fieldSalaryEmployeeClear.hidden = !salaryEmployeeSearchText();
    }
    if (!salaryEmployees.length) {
      select.innerHTML = '<option value="">Сотрудников нет</option>';
      select.value = '';
      renderSalaryPickerControls();
      updateSalaryEmployeeHint();
      return;
    }
    const rows = filteredSalaryEmployees();
    if (!rows.length) {
      select.innerHTML = '<option value="">Сотрудник не найден</option>';
      select.value = '';
      renderSalaryPickerControls();
      updateSalaryEmployeeHint();
      return;
    }
    select.innerHTML = '<option value="">Выберите сотрудника</option>' +
      rows
        .map((emp) => {
          const id = String(emp?.id || '');
          return `<option value="${escapeHtml(id)}">${escapeHtml(salaryEmployeeOptionLabel(emp))}</option>`;
        })
        .join('');
    if (current && [...select.options].some((opt) => opt.value === current)) {
      select.value = current;
    }
    renderSalaryPickerControls();
    updateSalaryEmployeeHint();
  }

  async function loadSalaryEmployeesForDate(dateValue, force) {
    const cleanDate = String(dateValue || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!force && salaryEmployeesDate === cleanDate) return;
    if (salaryEmployeeFetchPromise) {
      await salaryEmployeeFetchPromise;
      if (!force && salaryEmployeesDate === cleanDate) return;
    }
    salaryEmployeeFetchPromise = fetch(`/api/hr/salary-employees?date=${encodeURIComponent(cleanDate)}`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('salary_employees_failed')))
      .then((body) => {
        salaryEmployeesDate = cleanDate;
        salaryEmployees = Array.isArray(body.employees) ? body.employees : [];
      })
      .catch(() => {
        salaryEmployeesDate = cleanDate;
        salaryEmployees = [];
      })
      .finally(() => {
        salaryEmployeeFetchPromise = null;
      });
    await salaryEmployeeFetchPromise;
  }

  async function syncSalaryEmployeeUI(opts = {}) {
    const active = isSalaryPaymentMode();
    if (els.rowSalaryEmployee) els.rowSalaryEmployee.hidden = !active;
    if (!els.fieldSalaryEmployee) return;
    els.fieldSalaryEmployee.disabled = !active;
    if (els.fieldSalaryEmployeeSearch) els.fieldSalaryEmployeeSearch.disabled = !active;
    if (els.salaryEmployeeButton) els.salaryEmployeeButton.disabled = !active;
    if (els.salaryPositionButton) els.salaryPositionButton.disabled = !active;
    if (els.fieldSalaryEmployeeClear) els.fieldSalaryEmployeeClear.hidden = !salaryEmployeeSearchText();
    if (!active) {
      els.fieldSalaryEmployee.removeAttribute('required');
      els.fieldSalaryEmployee.value = '';
      if (els.fieldSalaryEmployeeSearch) els.fieldSalaryEmployeeSearch.value = '';
      if (els.salaryPositionSearch) els.salaryPositionSearch.value = '';
      salaryPositionFilter = new Set();
      if (els.fieldSalaryEmployeeClear) els.fieldSalaryEmployeeClear.hidden = true;
      closeSalaryEmployeeMenu();
      closeSalaryPositionMenu();
      updateSalaryEmployeeHint();
      return;
    }

    const preserve = opts.preserveValue != null ? String(opts.preserveValue || '') : els.fieldSalaryEmployee.value;
    els.fieldSalaryEmployee.innerHTML = '<option value="">Загрузка сотрудников...</option>';
    await loadSalaryEmployeesForDate(editorLocalDateValue(), !!opts.force);
    populateSalaryEmployeeSelect(preserve);
  }

  async function fetchPendingTransfers() {
    const queue = [];
    try {
      const responses = await Promise.all([
        fetch('/api/transfers?status=pending&direction=incoming'),
        fetch('/api/transfers?status=rejected&direction=outgoing'),
      ]);
      for (const res of responses) {
        if (!res.ok) continue;
        const data = await res.json().catch(() => ({}));
        const rows = Array.isArray(data.transfers) ? data.transfers : [];
        queue.push(...rows);
      }
      const seen = new Set();
      pendingTransfers = queue
        .filter((tx) => {
          const id = String(tx?.id || '');
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      renderPendingTransfers();
    } catch {
      pendingTransfers = [];
      renderPendingTransfers();
    }
  }

  function renderPendingTransfers() {
    if (els.pendingPanel) els.pendingPanel.hidden = true;
    if (els.pendingList) els.pendingList.innerHTML = '';
    renderTransferQueue();
  }

  function visibleTransferTargetOptions(selectedId) {
    const rows = Array.isArray(treasury?.pockets) ? treasury.pockets : [];
    const selected = String(selectedId || '').trim();
    if (!rows.length) return '<option value="">Нет доступных касс</option>';
    return rows.map((p) => {
      const id = String(p.id || '').trim();
      const label = p.label || i18n('kassa.no_name', 'Без названия');
      const note = p.note ? ` · ${p.note}` : '';
      return `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(label + note)}</option>`;
    }).join('');
  }

  function transferQueueStatusText(tx) {
    const status = String(tx?.status || '').toLowerCase();
    if (status === 'pending') return 'Ожидает подтверждения';
    if (status === 'rejected') return 'Отклонён';
    if (status === 'confirmed') return 'Подтверждён';
    if (status === 'draft') return 'Черновик';
    return status || '—';
  }

  function transferQueueRole(tx) {
    const toId = tx?.to_pocket_id || tx?.to_account_id || '';
    const fromId = tx?.from_pocket_id || tx?.from_account_id || '';
    const status = String(tx?.status || '').toLowerCase();
    if (status === 'pending' && getPocketById(toId)) return 'incoming';
    if (status === 'rejected' && getPocketById(fromId)) return 'rejected-outgoing';
    return '';
  }

  function renderTransferQueue() {
    const rows = Array.isArray(pendingTransfers)
      ? pendingTransfers.filter((tx) => transferQueueRole(tx))
      : [];
    if (els.transferQueueCount) {
      const pendingCount = rows.filter((tx) => String(tx.status || '').toLowerCase() === 'pending').length;
      els.transferQueueCount.textContent = String(pendingCount);
      els.transferQueueCount.hidden = pendingCount <= 0;
    }
    if (!els.transferQueueBody) return;
    if (!rows.length) {
      els.transferQueueBody.innerHTML = '<tr><td colspan="8" class="kassa-transfer-queue-empty">Нет перемещений, ожидающих действий</td></tr>';
      return;
    }
    els.transferQueueBody.innerHTML = rows.map((tx) => {
      const id = String(tx.id || '');
      const role = transferQueueRole(tx);
      const status = String(tx.status || '').toLowerCase();
      const fromId = tx.from_pocket_id || tx.from_account_id || '';
      const toId = tx.to_pocket_id || tx.to_account_id || '';
      const targetDisabled = role !== 'incoming' ? ' disabled' : '';
      const targetSelect = `<select class="kassa-transfer-queue-target" data-transfer-queue-target${targetDisabled}>${visibleTransferTargetOptions(toId)}</select>`;
      const actions = role === 'incoming'
        ? `<button type="button" class="btn kassa-transfer-queue-action" data-transfer-queue-confirm="${escapeHtml(id)}">Принять</button>
           <button type="button" class="btn btn-secondary kassa-transfer-queue-action" data-transfer-queue-reject="${escapeHtml(id)}">Отклонить</button>`
        : `<button type="button" class="btn kassa-transfer-queue-action" data-transfer-queue-resend="${escapeHtml(id)}">Повторить</button>`;
      return `
        <tr data-transfer-queue-id="${escapeHtml(id)}">
          <td>${escapeHtml(String(tx.number || '—'))}</td>
          <td>${escapeHtml(formatDate(tx.created_at))}</td>
          <td>${escapeHtml(getPocketName(fromId))}</td>
          <td>${escapeHtml(getPocketName(toId))}</td>
          <td class="kassa-transfer-queue-amount">${escapeHtml(formatTransferAmountSummary(tx))}</td>
          <td><span class="kassa-transfer-status-pill kassa-transfer-status-pill--${escapeHtml(status || 'unknown')}">${escapeHtml(transferQueueStatusText(tx))}</span></td>
          <td>${targetSelect}</td>
          <td><div class="kassa-transfer-queue-actions">${actions}</div></td>
        </tr>`;
    }).join('');
  }

  function openTransferQueue() {
    renderTransferQueue();
    if (els.transferQueueDialog && !els.transferQueueDialog.open) {
      els.transferQueueDialog.showModal();
    }
  }

  function closeTransferQueue() {
    if (els.transferQueueDialog?.open) els.transferQueueDialog.close();
  }

  async function resolveTransfer(id, action, targetPocketId = '') {
    const cleanAction = action === 'reject' ? 'reject' : 'confirm';
    setStatus(cleanAction === 'reject' ? 'Отклонение перевода...' : 'Подтверждение перевода...', null);
    try {
      const body = cleanAction === 'confirm' && targetPocketId ? { to_pocket_id: targetPocketId } : null;
      const res = await fetchApiCsrf('POST', `/api/transfers/${encodeURIComponent(id)}/${cleanAction}`, body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err.error));
      }
      setStatus(cleanAction === 'reject' ? 'Перевод отклонён, деньги возвращены отправителю' : 'Перевод принят и зачислен', 'ok');
      await loadData();
      notifyTreasuryUpdated();
      renderTransferQueue();
      setTimeout(() => setStatus(''), 1800);
    } catch (e) {
      setStatus(e.message || apiErrorMessage(''), 'err');
    }
  }

  async function fetchKassaData() {
    setLoadingStatus('');
    transactionsLoadComplete = false;

    const txRes = await fetch(`/api/transactions?limit=${TX_BATCH}&offset=0`);
    if (!txRes.ok) {
      setStatus(i18n('kassa.load_err_tx', 'Не удалось загрузить операции'), 'err');
      throw new Error('tx');
    }
    const txData = await txRes.json();
    transactions = Array.isArray(txData.transactions) ? txData.transactions : [];
    invalidateFilteredCache();

    renderKassaView();

    await fetchTreasuryAndCategories();
    await fetchPendingTransfers();
    try {
      populateFilterOptions();
      populateCategoryField(els.fieldType?.value || 'expense');
      renderTable();
    } catch {
      /* фильтры не должны скрывать уже загруженную таблицу */
    }

    if (transactions.length >= TX_BATCH) {
      void loadRemainingTransactions(TX_BATCH);
    } else {
      transactionsLoadComplete = true;
      setStatus('', null);
    }
  }

  function renderKassaView() {
    try {
      populateFilterOptions();
      populateCategoryField(els.fieldType?.value || 'expense');
      renderTable();
      highlightTxFromUrl();
    } catch {
      setStatus(i18n('kassa.render_err', 'Ошибка отображения таблицы'), 'err');
    }
  }

  function scheduleTableRender() {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => renderTable());
    } else {
      renderTable();
    }
  }

  async function loadData() {
    try {
      await fetchKassaData();
    } catch {
      if (!els.status?.textContent) {
        setStatus(i18n('kassa.load_err', 'Ошибка загрузки данных'), 'err');
      }
    } finally {
      if (transactions.length > 0) {
        renderKassaView();
        scheduleTableRender();
      }
      if (transactionsLoadComplete) setStatus('', null);
    }
  }

  function notifyTreasuryUpdated() {
    window.dispatchEvent(new CustomEvent('upos:treasury-updated'));
    const bc = new BroadcastChannel('upos:treasury');
    bc.postMessage('updated');
  }

  function populatePocketSelects() {
    if (!treasury || !treasury.pockets) return;

    const fromValue = els.fieldFromPocket?.value || '';
    const toValue = els.fieldToPocket?.value || '';
    const optionLabel = (p) => {
      const owner = String(p.owner_employee_name || '').trim();
      const base = p.label || i18n('kassa.no_name', 'Без названия');
      return owner ? `${base} · ${owner}` : base;
    };
    const optionsFrom = `<option value="">${escapeHtml(i18n('kassa.select_pocket', 'Выберите счёт…'))}</option>` +
      treasury.pockets.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(optionLabel(p))}</option>`).join('');
    const toRows = isTransferForm() && transferTargets.length ? transferTargets : treasury.pockets;
    const optionsTo = `<option value="">${escapeHtml(i18n('kassa.select_pocket', 'Выберите счёт…'))}</option>` +
      toRows.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(optionLabel(p))}</option>`).join('');

    if (els.fieldFromPocket) {
      els.fieldFromPocket.innerHTML = optionsFrom;
      if (fromValue && [...els.fieldFromPocket.options].some((o) => o.value === fromValue)) els.fieldFromPocket.value = fromValue;
    }
    if (els.fieldToPocket) {
      els.fieldToPocket.innerHTML = optionsTo;
      if (toValue && [...els.fieldToPocket.options].some((o) => o.value === toValue)) els.fieldToPocket.value = toValue;
    }
    populateCourierAccountSelects();

    renderMultiFilter('pocket', treasury.pockets.map((p) => ({
      value: p.id,
      label: optionLabel(p),
    })));
  }

  function populateCategoryFilter(type) {
    const categories = new Set();
    const types = uniqueFilterValues(Array.isArray(type) ? type : [type])
      .filter((value) => value === 'income' || value === 'expense' || value === 'transfer');
    const useTypes = types.length > 0;

    if (useTypes) {
      categoriesCatalog.forEach((cat) => {
        if (cat && cat.name && types.includes(cat.type)) categories.add(cat.name);
      });
      transactions.forEach((tx) => {
        if (tx.category && types.includes(tx.type)) categories.add(tx.category);
      });
    } else {
      categoriesCatalog.forEach((cat) => {
        if (cat && cat.name) categories.add(cat.name);
      });
      transactions.forEach((tx) => {
        if (tx.category) categories.add(tx.category);
      });
    }

    renderMultiFilter('category', [...categories].sort().map((name) => ({
      value: name,
      label: name,
    })));
  }

  function populateFilterOptions() {
    const suppliers = new Set();
    const currencies = new Set((enabledCurrencies || []).map(normalizeCurrencyCode).filter(Boolean));
    filterValues('currency').forEach((ccy) => currencies.add(ccy));

    transactions.forEach(tx => {
      if (tx.supplier) suppliers.add(tx.supplier);
      transactionCurrencies(tx).forEach((ccy) => currencies.add(ccy));
    });
    (treasury?.pockets || []).forEach((pocket) => {
      pocketBalancesList(pocket).forEach((row) => {
        const ccy = normalizeCurrencyCode(row.currency);
        if (ccy) currencies.add(ccy);
      });
    });

    renderMultiFilter('type', typeFilterOptions());
    renderMultiFilter('status', statusFilterOptions());
    renderMultiFilter('currency', summaryCurrencySortKeys([...currencies]).map((ccy) => ({
      value: ccy,
      label: ccy,
    })));
    renderMultiFilter('supplier', [...suppliers].sort().map((name) => ({
      value: name,
      label: name,
    })));
    populateCategoryFilter(filterValues('type'));
  }

  function categoryIcon(type) {
    if (type === 'income') return '+';
    if (type === 'expense') return '-';
    return '↔';
  }

  function syncCategoryPicker() {
    const sel = els.fieldCategory || document.getElementById('kassa-field-category');
    if (!sel) return;
    let wrap = sel.closest('.kassa-category-picker');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'kassa-category-picker';
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kassa-category-btn';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      const panel = document.createElement('div');
      panel.className = 'kassa-category-panel';
      panel.hidden = true;
      wrap.insertBefore(btn, sel);
      wrap.insertBefore(panel, sel);
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        panel.hidden = !panel.hidden;
        btn.setAttribute('aria-expanded', String(!panel.hidden));
      });
      panel.addEventListener('click', (ev) => {
        const item = ev.target.closest('[data-category-value]');
        if (!item) return;
        sel.value = item.getAttribute('data-category-value') || '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        syncCategoryPicker();
      });
      document.addEventListener('click', () => {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      });
    }
    const btn = wrap.querySelector('.kassa-category-btn');
    const panel = wrap.querySelector('.kassa-category-panel');
    const type = els.fieldType?.value || 'expense';
    const icon = categoryIcon(type);
    const selected = sel.value || '';
    const selectedLabel = selected || i18n('kassa.f.cat', 'Категория платежа');
    btn.innerHTML = `<span class="kassa-category-dot kassa-category-dot--${escapeHtml(type)}">${escapeHtml(icon)}</span><span>${escapeHtml(selectedLabel)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>`;
    panel.innerHTML = [...sel.options].map((opt) => {
      const value = opt.value || '';
      const active = value === selected ? ' is-active' : '';
      const label = value || i18n('kassa.no_category', 'Без категории');
      return `<button type="button" class="kassa-category-option${active}" data-category-value="${escapeHtml(value)}"><span class="kassa-category-dot kassa-category-dot--${escapeHtml(type)}">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span></button>`;
    }).join('');
  }

  function populateCategoryField(type, preserveValue) {
    const sel = els.fieldCategory || document.getElementById('kassa-field-category');
    if (!sel) return;
    const current = preserveValue != null ? preserveValue : sel.value;
    const cleanType = type === 'income' || type === 'expense' || type === 'transfer' ? type : '';
    if (!cleanType) {
      sel.innerHTML = `<option value="">${escapeHtml(i18n('kassa.f.cat', 'Категория платежа'))}</option>`;
      sel.value = '';
      syncCategoryPicker();
      return;
    }
    let list = categoriesCatalog
      .filter((cat) => cat && cat.type === cleanType);
    if (cleanType === 'transfer' && list.length === 0) {
      list = categoriesCatalog.filter((cat) => cat && cat.name);
    }
    const placeholder = categoriesRestricted
      ? ''
      : `<option value="">${escapeHtml(i18n('kassa.f.cat', 'Категория платежа'))}</option>`;
    sel.innerHTML =
      placeholder +
      list
        .map((cat) => `<option value="${escapeHtml(cat.name)}">${escapeHtml(categoryIcon(cleanType) + '  ' + cat.name)}</option>`)
        .join('');
    if (current && [...sel.options].some((opt) => opt.value === current)) {
      sel.value = current;
    } else if (categoriesRestricted && sel.options.length) {
      sel.value = sel.options[0].value;
    }
    syncCategoryPicker();
    syncCourierPaymentUI();
    void syncSalaryEmployeeUI({ preserveValue: els.fieldSalaryEmployee?.value || '' });
  }

  function getPocketName(id) {
    if (!id) return '—';
    const p = getPocketById(id) || getTransferTargetById(id);
    return p ? (p.label || i18n('kassa.no_name', 'Без названия')) : '—';
  }

  function getPocketById(id) {
    if (!id || !treasury?.pockets) return null;
    const k = String(id).trim();
    return treasury.pockets.find((p) => String(p.id).trim() === k) || null;
  }

  function getTransferTargetById(id) {
    if (!id || !Array.isArray(transferTargets)) return null;
    const k = String(id).trim();
    return transferTargets.find((p) => String(p.id).trim() === k) || null;
  }

  function decimalsForCurrency(currency) {
    const c = (currency || '').toUpperCase();
    const intOnly = new Set(['VND', 'UGX', 'JPY']);
    return intOnly.has(c) ? 0 : 2;
  }

  function roundMoneyAmt(amount, currency) {
    const d = decimalsForCurrency(currency);
    const n = Number(amount);
    if (!Number.isFinite(n)) return 0;
    const p = Math.pow(10, d);
    return Math.round(n * p) / p;
  }

  function formatBalanceAmt(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  function formatBalanceAmtCompact(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return 'вЂ”';
    return n.toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  function i18nHtml(key, fallback, vars) {
    let html = escapeHtml(i18n(key, fallback));
    Object.entries(vars || {}).forEach(([name, value]) => {
      html = html.replace(new RegExp('\\{' + name + '\\}', 'g'), String(value));
    });
    return html;
  }

  function hintMoneyHtml(amount, currency) {
    const c = String(currency || '').toUpperCase();
    return `<span class="kassa-hint-money">${escapeHtml(formatBalanceAmtCompact(amount, c))}</span>`;
  }

  function getBalanceEntry(pocket, ccy) {
    if (!pocket?.entries || !ccy) return null;
    const cu = String(ccy).toUpperCase();
    return pocket.entries.find((e) => (e.currency || '').toUpperCase() === cu) || null;
  }

  function pocketBalancesList(pocket) {
    const list = Array.isArray(pocket?.entries)
      ? pocket.entries.map((e) => ({
          currency: String(e.currency || '').toUpperCase(),
          amount: Number(e.amount) || 0,
        }))
      : [];
    return list.filter((x) => x.currency);
  }

  function amountInUsd(amount, ccy, rmap) {
    const c = (ccy || '').toUpperCase();
    if (c === 'USD') return amount;
    const rf = rmap[c];
    if (!rf || rf <= 0) return null;
    return amount / rf;
  }

  function convertThroughUsd(amount, fromCcy, toCcy, rmap) {
    const usd = amountInUsd(amount, fromCcy, rmap);
    if (usd == null) return null;
    const t = (toCcy || '').toUpperCase();
    if (t === 'USD') return usd;
    const rt = rmap[t];
    if (!rt || rt <= 0) return null;
    return usd * rt;
  }

  function syncTransferDebitCurrencySelect(opts) {
    const preferCurrency = String(opts?.preferCurrency || '').toUpperCase();
    const sel = document.getElementById('kassa-field-debit-currency');
    const hintCcy = document.getElementById('kassa-editor-debit-ccy-hint');
    if (!sel) return;

    const pocketId = els.fieldFromPocket?.value || '';
    const pocket = getPocketById(pocketId);

    const showHint = (text) => {
      if (!hintCcy) return;
      hintCcy.textContent = text || '';
      hintCcy.hidden = !text;
    };

    sel.removeAttribute('required');
    sel.disabled = true;

    if (!pocketId) {
      sel.innerHTML = `<option value="">${escapeHtml(i18n('kassa.select_debit_first', 'Сначала выберите счёт списания…'))}</option>`;
      showHint('');
      upgradeKassaCcySelects();
      return;
    }

    let rows = sortCurrencyRows(pocketBalancesList(pocket));
    if (!rows.length) {
      sel.innerHTML = `<option value="">${escapeHtml(i18n('kassa.no_ccy_on_account', 'Нет валютных остатков на счёте'))}</option>`;
      showHint(i18n('kassa.add_ccy_hint', 'Добавьте суммы по валютам для этого счёта на вкладке «Счёт».'));
      upgradeKassaCcySelects();
      return;
    }

    showHint(i18n('kassa.debit_amount_hint', 'Сумму списания вводите в выбранной валюте.'));

    const optionHtmlParts = [];
    for (const { currency: cur, amount: bal } of rows) {
      optionHtmlParts.push(ccOptionAvailableHtml(cur, bal));
    }
    sel.innerHTML = optionHtmlParts.join('');

    let pick = '';
    if (preferCurrency && [...sel.options].some((o) => o.value === preferCurrency))
      pick = preferCurrency;
    else if (sel.options[0]?.value)
      pick = sel.options[0].value;

    sel.value = pick;
    sel.disabled = false;
    sel.setAttribute('required', 'required');
    upgradeKassaCcySelects();
  }

  function syncTransferCreditCurrencySelect(opts) {
    const preferCurrency = String(opts?.preferCurrency || '').toUpperCase();
    const sel = document.getElementById('kassa-field-credit-currency');
    const hintCcy = document.getElementById('kassa-editor-credit-ccy-hint');
    if (!sel) return;

    const pocketId = els.fieldToPocket?.value || '';
    const pocket = getPocketById(pocketId);

    const showHint = (text) => {
      if (!hintCcy) return;
      hintCcy.textContent = text || '';
      hintCcy.hidden = !text;
    };

    sel.removeAttribute('required');
    sel.disabled = true;

    if (!pocketId) {
      sel.innerHTML = `<option value="">${escapeHtml(i18n('kassa.select_credit_first', 'Сначала выберите счёт зачисления…'))}</option>`;
      showHint('');
      upgradeKassaCcySelects();
      return;
    }

    let rows = sortCurrencyRows(pocketBalancesList(pocket));
    if (!rows.length) {
      const fallback = enabledCurrencies.length ? enabledCurrencies : INCOME_CCY_FALLBACK;
      rows = sortCurrencyRows(fallback.map((currency) => ({ currency, amount: 0 })));
      showHint(i18n('kassa.credit_empty_hint', 'На счёте пока нет остатков — выберите валюту зачисления (можно первый раз).'));
    } else {
      showHint(i18n('kassa.credit_amount_hint', 'Сумму зачисления можно править вручную — пересчитается курс.'));
    }

    const optionHtmlParts = [];
    for (const { currency: cur, amount: bal } of rows) {
      optionHtmlParts.push(ccOptionAvailableHtml(cur, bal));
    }
    sel.innerHTML = optionHtmlParts.join('');

    let pick = '';
    if (preferCurrency && [...sel.options].some((o) => o.value === preferCurrency))
      pick = preferCurrency;
    else if (sel.options[0]?.value)
      pick = sel.options[0].value;

    sel.value = pick;
    sel.disabled = false;
    sel.setAttribute('required', 'required');
    upgradeKassaCcySelects();
  }

  function syncEditorCurrencySelect(opts) {
    if (isTransferForm()) return;

    const preferCurrency = String(opts?.preferCurrency || '').toUpperCase();
    const sel = els.fieldCurrency;
    const hintCcy = document.getElementById('kassa-editor-currency-hint');
    if (!sel) return;

    const type = els.fieldType?.value || 'expense';
    let pocketId = '';
    if (type === 'income') pocketId = els.fieldToPocket?.value || '';
    else pocketId = els.fieldFromPocket?.value || '';

    const pocket = getPocketById(pocketId);

    const showHint = (text) => {
      if (!hintCcy) return;
      hintCcy.textContent = text || '';
      hintCcy.hidden = !text;
    };

    sel.removeAttribute('required');
    sel.disabled = true;

    if (!pocketId) {
      sel.innerHTML =
        `<option value="">${escapeHtml(
          type === 'income' ? i18n('kassa.select_credit_first', 'Сначала выберите счёт зачисления…') : i18n('kassa.select_debit_first', 'Сначала выберите счёт списания…')
        )}</option>`;
      showHint('');
      updateEditorHints();
      upgradeKassaCcySelects();
      return;
    }

    const isDebitSide = type === 'expense' || type === 'transfer';
    let rows = sortCurrencyRows(pocketBalancesList(pocket));

    if (!rows.length && type === 'income') {
      const fallback = enabledCurrencies.length ? enabledCurrencies : INCOME_CCY_FALLBACK;
      rows = sortCurrencyRows(fallback.map((currency) => ({ currency, amount: 0 })));
      showHint(
        i18n('kassa.credit_empty_hint', 'На счёте пока нет остатков — выберите валюту зачисления (можно первый раз).')
      );
    } else if (!rows.length && isDebitSide) {
      sel.innerHTML = `<option value="">${escapeHtml(i18n('kassa.no_ccy_on_account', 'Нет валютных остатков на счёте'))}</option>`;
      showHint(i18n('kassa.add_ccy_hint', 'Добавьте суммы по валютам для этого счёта на вкладке «Счёт».'));
      updateEditorHints();
      upgradeKassaCcySelects();
      return;
    } else {
      showHint(
        type === 'income'
          ? i18n('kassa.credit_amount_hint', 'Сумму зачисления можно править вручную — пересчитается курс.')
          : i18n('kassa.debit_amount_hint', 'Сумму списания вводите в выбранной валюте.')
      );
    }

    const optionHtmlParts = [];
    for (const { currency: cur, amount: bal } of rows) {
      optionHtmlParts.push(ccOptionAvailableHtml(cur, bal));
    }
    sel.innerHTML = optionHtmlParts.join('');

    let pick = '';
    if (preferCurrency && [...sel.options].some((o) => o.value === preferCurrency))
      pick = preferCurrency;
    else if (sel.options[0]?.value)
      pick = sel.options[0].value;

    sel.value = pick;
    sel.disabled = false;
    sel.setAttribute('required', 'required');
    updateEditorHints();
    upgradeKassaCcySelects();
  }

  function simpleSplitEnabled() {
    const type = els.fieldType?.value || 'expense';
    if (type !== 'income' && type !== 'expense') return false;
    const editing = !!(document.getElementById('kassa-field-id')?.value || '').trim();
    return !editing || isCourierPaymentMode();
  }

  function activeSimplePocketId() {
    const type = els.fieldType?.value || 'expense';
    return type === 'income' ? (els.fieldToPocket?.value || '') : (els.fieldFromPocket?.value || '');
  }

  function splitPocketOptions(selected) {
    const opts = [`<option value="">${escapeHtml(i18n('kassa.select_pocket', 'Выберите счёт…'))}</option>`];
    (treasury?.pockets || []).forEach((p) => {
      const id = String(p.id || '');
      opts.push(`<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(p.label || i18n('kassa.no_name', 'Без названия'))}</option>`);
    });
    return opts.join('');
  }

  function splitCurrencyRowsForPocket(pocketId) {
    const type = els.fieldType?.value || 'expense';
    const pocket = getPocketById(pocketId);
    let rows = sortCurrencyRows(pocketBalancesList(pocket));
    if (!rows.length && type === 'income') {
      const fallback = enabledCurrencies.length ? enabledCurrencies : INCOME_CCY_FALLBACK;
      rows = sortCurrencyRows(fallback.map((currency) => ({ currency, amount: 0 })));
    }
    return rows;
  }

  function splitCurrencyOptions(pocketId, selected) {
    const rows = splitCurrencyRowsForPocket(pocketId);
    if (!pocketId)
      return `<option value="">${escapeHtml(i18n('kassa.select_first_pocket', 'Сначала выберите счёт…'))}</option>`;
    if (!rows.length)
      return `<option value="">${escapeHtml(i18n('kassa.no_ccy_on_account', 'Нет валютных остатков на счёте'))}</option>`;
    return rows.map((row) => {
      const c = String(row.currency || '').toUpperCase();
      return ccOptionAvailableHtml(c, row.amount, c === selected);
    }).join('');
  }

  function defaultSplitCurrency(pocketId) {
    return splitCurrencyRowsForPocket(pocketId)[0]?.currency || '';
  }

  function renderSimpleSplitRows() {
    if (!els.splitActions || !els.splitLines) return;
    const enabled = simpleSplitEnabled();
    els.splitActions.hidden = !enabled;
    if (!enabled) {
      simpleSplitRows = [];
      els.splitLines.hidden = true;
      els.splitLines.innerHTML = '';
      return;
    }
    els.splitLines.hidden = simpleSplitRows.length === 0;
    els.splitLines.innerHTML = simpleSplitRows.map((row, index) => {
      const pocketId = String(row.pocketId || '');
      const currency = String(row.currency || defaultSplitCurrency(pocketId) || '').toUpperCase();
      row.currency = currency;
      const blockTitle = i18n('kassa.split.block_title', 'Дополнительный счёт {n}', { n: index + 2 });
      return `
        <article class="kassa-split-block" data-split-id="${escapeHtml(row.id)}">
          <header class="kassa-split-block-head">
            <span class="kassa-split-block-title">${escapeHtml(blockTitle)}</span>
            <button type="button" class="kassa-split-remove" data-split-remove aria-label="${escapeHtml(i18n('kassa.split.remove', 'Удалить строку'))}">×</button>
          </header>
          <div class="kassa-form-group">
            <label>${escapeHtml(i18n('kassa.split.account', 'Счёт'))}</label>
            <select data-split-pocket>${splitPocketOptions(pocketId)}</select>
          </div>
          <div class="kassa-form-group">
            <label>${escapeHtml(i18n('kassa.f.currency', 'Валюта операции'))}</label>
            <select data-split-currency data-ccy-enhance>${splitCurrencyOptions(pocketId, currency)}</select>
          </div>
          <div class="kassa-form-group kassa-form-group--amount">
            <label>${escapeHtml(i18n('kassa.f.amount', 'Сумма'))}</label>
            <input type="text" inputmode="decimal" autocomplete="off" data-split-amount placeholder="0" value="${escapeHtml(row.amount || '')}" />
          </div>
        </article>
      `;
    }).join('');
    upgradeKassaCcySelects();
  }

  function addSimpleSplitRow() {
    if (!simpleSplitEnabled()) return;
    const pocketId = activeSimplePocketId();
    simpleSplitRows.push({
      id: `split-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      pocketId,
      currency: defaultSplitCurrency(pocketId),
      amount: '',
    });
    renderSimpleSplitRows();
  }

  function syncSimpleSplitAvailability() {
    renderSimpleSplitRows();
  }

  function loadSimpleSplitRowsFromExtraPostings(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row === 'object')
      .map((row, index) => ({
        id: `split-loaded-${index}-${Date.now()}`,
        pocketId: String(row.account_id || row.pocket_id || '').trim(),
        currency: String(row.currency || '').trim().toUpperCase(),
        amount: row.amount == null ? '' : String(row.amount),
      }))
      .filter((row) => row.pocketId || row.currency || row.amount);
  }

  async function loadFxRates() {
    try {
      const r = await fetch('/api/fx/rates');
      if (!r.ok) throw new Error('fx');
      const d = await r.json();
      if (d.rates && typeof d.rates === 'object') {
        const norm = { USD: 1 };
        for (const [k, v] of Object.entries(d.rates)) {
          if (typeof k !== 'string') continue;
          const code = k.trim().toUpperCase();
          const num = Number(v);
          if (code.length === 3 && Number.isFinite(num) && num > 0) norm[code] = num;
        }
        fxRates = norm;
        fxMeta = { as_of: d.as_of || null, stale: !!d.stale };
      }
    } catch {
      /* keep previous */
    }
    updateEditorHints();
  }

  function activeDebitPocket() {
    const type = els.fieldType?.value || 'expense';
    if (type === 'expense' || type === 'transfer')
      return getPocketById(els.fieldFromPocket?.value);
    return null;
  }

  /** Счёт получателя — только переводы. */
  function activeCreditPocketForTransfer() {
    if (!isTransferForm()) return null;
    return getTransferTargetById(els.fieldToPocket?.value) || getPocketById(els.fieldToPocket?.value);
  }

  function transferRequiresConfirmationNow() {
    if (!isTransferForm()) return false;
    const from = getPocketById(els.fieldFromPocket?.value);
    const toId = String(els.fieldToPocket?.value || '').trim();
    const to = activeCreditPocketForTransfer();
    const fromOwner = String(from?.owner_employee_id || '').trim();
    const toOwner = String(to?.owner_employee_id || '').trim();
    const targetOutsideOwnAccess = !!(toId && !getPocketById(toId) && getTransferTargetById(toId));
    return targetOutsideOwnAccess || !!(fromOwner && toOwner && fromOwner !== toOwner);
  }

  function updateTransferConfirmationWarning() {
    if (!els.transferWarning) return;
    const show = transferRequiresConfirmationNow();
    els.transferWarning.hidden = !show;
  }

  function applyPlainNumberInput(el, n, currency) {
    if (!el) return;
    const ccy = (currency || 'USD').toUpperCase();
    const d = decimalsForCurrency(ccy);
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) {
      el.value = '';
      return;
    }
    if (AM) AM.setInputFromNumber(el, v, AM.decimalsForCurrency(ccy));
    else el.value = v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function updateTransferConvertPanel() {
    const panel = document.getElementById('kassa-transfer-convert-panel');
    const rateLabel = document.getElementById('kassa-transfer-rate-label');
    const expl = document.getElementById('kassa-transfer-rate-explainer');
    const marketHint = document.getElementById('kassa-transfer-market-hint');
    const { debitCcy, creditCcy } = transferDebitCreditCcys();
    const cross = !!(debitCcy && creditCcy && debitCcy !== creditCcy);
    if (panel) panel.hidden = !cross;
    if (rateLabel && debitCcy && creditCcy)
      rateLabel.textContent = i18n('kassa.rate_for_pair', 'За 1 {credit} — списание в {debit}', { credit: creditCcy, debit: debitCcy });
    if (expl) {
      let t = cross
        ? i18n('kassa.transfer_rate_explainer', 'Измените курс или сумму зачисления — второе значение пересчитается. Сумма списания задаёт объём отправки.')
        : '';
      if (cross && debitCcy && creditCcy) {
        const perUnit = convertThroughUsd(1, debitCcy, creditCcy, fxRates);
        if (perUnit != null && perUnit > 0) {
          const r = roundMoneyAmt(perUnit, creditCcy);
          t += ' ' + i18n('kassa.market_rate_hint', 'Ориентир (по курсам к USD): 1 {debit} ≈ {amount} {credit}.', { debit: debitCcy, amount: formatBalanceAmt(r, creditCcy), credit: creditCcy });
        } else {
          t += ' ' + i18n('kassa.no_pair_rate', 'Нет курса для пары валют — дождитесь загрузки курсов или задайте сумму зачисления вручную.');
        }
      }
      expl.textContent = t;
    }
    if (marketHint) {
      let t = '';
      if (cross && fxMeta.as_of != null && String(fxMeta.as_of).trim())
        t = i18n('kassa.market_hint_asof', 'Ориентир по курсу к USD · {as_of}', { as_of: fxMeta.as_of }) + (fxMeta.stale ? i18n('kassa.cache_suffix', ' · кэш') : '');
      else if (cross && fxMeta.stale)
        t = i18n('kassa.market_hint_approx', 'Ориентир по курсу приблизительный.');
      marketHint.textContent = t;
    }
    const foot = document.getElementById('kassa-transfer-fx-footnote');
    if (foot) {
      foot.hidden = !cross;
      foot.textContent = cross
        ? i18n('kassa.rate_saved_note', 'Курс хранится в операции; он может отличаться от рыночного, если вы его меняли.')
        : '';
    }
  }

  function updateTransferEditorHints() {
    const hintDebitAvail = document.getElementById('kassa-editor-debit-pocket-available');
    const hintCreditAvail = document.getElementById('kassa-editor-credit-pocket-available');
    const hintDebitBal = document.getElementById('kassa-editor-debit-balance-hint');
    const hintCreditFoot = document.getElementById('kassa-editor-credit-foot-hint');
    const debitEl = document.getElementById('kassa-field-debit-amount');
    const creditEl = document.getElementById('kassa-field-credit-amount');
    const rateEl = document.getElementById('kassa-field-transfer-rate');

    updateTransferConvertPanel();
    updateTransferConfirmationWarning();

    const pocket = activeDebitPocket();
    const pocketCredit = activeCreditPocketForTransfer();
    const { debitCcy, creditCcy } = transferDebitCreditCcys();
    const amt = numGrouped(debitEl?.value);

    if (hintDebitAvail) {
      hintDebitAvail.hidden = true;
      if (pocket && debitCcy) {
        const row0 = getBalanceEntry(pocket, debitCcy);
        const bal0 = row0 != null ? Number(row0.amount) : NaN;
        if (Number.isFinite(bal0)) {
          hintDebitAvail.innerHTML = i18nHtml('kassa.debit_available', 'Debit account: {amount} {currency}', {
            amount: hintMoneyHtml(bal0, debitCcy),
            currency: escapeHtml(debitCcy),
          });
          hintDebitAvail.hidden = false;
        }
      }
    }

    if (hintCreditAvail) {
      hintCreditAvail.hidden = true;
      if (pocketCredit && creditCcy) {
        const rowc = getBalanceEntry(pocketCredit, creditCcy);
        const balcNow = rowc != null ? Number(rowc.amount) : NaN;
        if (Number.isFinite(balcNow)) {
          hintCreditAvail.innerHTML = i18nHtml('kassa.credit_available', 'Recipient account now: {amount} {currency}', {
            amount: hintMoneyHtml(balcNow, creditCcy),
            currency: escapeHtml(creditCcy),
          });
          hintCreditAvail.hidden = false;
        }
      }
    }

    const caAfter = numGrouped(creditEl?.value);
    const creditBalNow =
      pocketCredit && creditCcy ? (() => {
        const rr = getBalanceEntry(pocketCredit, creditCcy);
        const b = rr != null ? Number(rr.amount) : NaN;
        return Number.isFinite(b) ? b : NaN;
      })()
      : NaN;

    function appendCreditAfterLine(txt) {
      if (!txt || !Number.isFinite(caAfter) || caAfter <= 0 || !Number.isFinite(creditBalNow) || !creditCcy) return txt;
      const after = i18nHtml('kassa.credit_after', 'After transfer on recipient account: {amount} {currency}.', {
        amount: hintMoneyHtml(creditBalNow + caAfter, creditCcy),
        currency: escapeHtml(creditCcy),
      });
      return `${txt} ${after}`;
    }

    if (hintDebitBal) {
      hintDebitBal.hidden = true;
      hintDebitBal.removeAttribute('data-variant');
      if (pocket && debitCcy && Number.isFinite(amt) && amt > 0) {
        const row = getBalanceEntry(pocket, debitCcy);
        const bal = row != null ? Number(row.amount) : NaN;
        if (Number.isFinite(bal)) {
          const left = bal - amt;
          hintDebitBal.innerHTML = i18nHtml('kassa.after_operation', 'After operation in {currency}: {amount} left', {
            currency: escapeHtml(debitCcy),
            amount: hintMoneyHtml(left, debitCcy),
          });
          hintDebitBal.hidden = false;
          if (amt > bal + 1e-9) hintDebitBal.setAttribute('data-variant', 'err');
        }
      }
    }

    if (hintCreditFoot) {
      hintCreditFoot.hidden = !(debitCcy && creditCcy);
      if (!hintCreditFoot.hidden) {
        const da = numGrouped(debitEl?.value);
        const ca = numGrouped(creditEl?.value);
        const rv = numGrouped(rateEl?.value);
        if (!isCrossCurrencyTransfer())
          hintCreditFoot.innerHTML = appendCreditAfterLine(escapeHtml(i18n('kassa.same_ccy_hint', 'Same currency; amounts match.')));
        else if (Number.isFinite(da) && da > 0 && Number.isFinite(ca) && ca > 0 && Number.isFinite(rv) && rv > 0)
          hintCreditFoot.innerHTML = appendCreditAfterLine(
            i18nHtml('kassa.current_rate', 'Current rate: {amount} {debit} for 1 {credit}.', {
              amount: hintMoneyHtml(rv, debitCcy),
              debit: escapeHtml(debitCcy),
              credit: escapeHtml(creditCcy),
            }),
          );
        else if (Number.isFinite(da) && da > 0 && Number.isFinite(ca) && ca > 0)
          hintCreditFoot.innerHTML = appendCreditAfterLine(
            i18nHtml('kassa.implied_rate', 'Implied {amount} {debit} for 1 {credit}.', {
              amount: hintMoneyHtml(da / ca, debitCcy),
              debit: escapeHtml(debitCcy),
              credit: escapeHtml(creditCcy),
            }),
          );
        else
          hintCreditFoot.innerHTML = appendCreditAfterLine(escapeHtml(i18n('kassa.enter_amounts_or_rate', 'Enter amounts or rate.'))) || escapeHtml(i18n('kassa.enter_amounts_or_rate', 'Enter amounts or rate.'));
      }
    }

    refreshAmountScaleHints();
  }
  function updateEditorHints() {
    if (isTransferForm()) {
      updateTransferEditorHints();
      return;
    }

    const hintBal = document.getElementById('kassa-editor-balance-hint');
    const hintFx = document.getElementById('kassa-editor-fx-hint');
    const type = els.fieldType?.value || 'expense';

    if (hintFx) {
      let base = '';
      if (fxMeta.as_of != null && String(fxMeta.as_of).trim())
        base = i18n('kassa.fx_base_asof', 'Курс: единиц валюты за 1 USD · {as_of}', { as_of: fxMeta.as_of }) + (fxMeta.stale ? i18n('kassa.cache_suffix', ' · кэш') : '');
      else if (fxMeta.stale)
        base = i18n('kassa.fx_approx', 'Курсы к USD приблизительные.');
      else base = i18n('kassa.fx_base', 'Курсы к USD');
      let line = base;
      const ccy = (els.fieldCurrency?.value || '').toUpperCase();
      const amt = numGrouped(els.fieldAmount?.value);
      if (ccy && Number.isFinite(amt) && amt > 0) {
        const usd = amountInUsd(amt, ccy, fxRates);
        if (usd != null)
          line = `≈ ${formatBalanceAmt(usd, 'USD')} USD · ${base}`;
      }
      hintFx.textContent = line;
      hintFx.hidden = !line.trim();
    }

    if (hintBal) {
      hintBal.hidden = true;
      hintBal.removeAttribute('data-variant');
      if (type === 'expense' || type === 'transfer') {
        const pocket = activeDebitPocket();
        const ccy = (els.fieldCurrency?.value || '').toUpperCase();
        const amt = numGrouped(els.fieldAmount?.value);
        if (pocket && ccy && Number.isFinite(amt) && amt > 0) {
          const row = getBalanceEntry(pocket, ccy);
          const bal = row != null ? Number(row.amount) : NaN;
          if (Number.isFinite(bal)) {
            const left = bal - amt;
            hintBal.textContent = i18n('kassa.after_operation', 'После операции по {currency}: останется {amount}', { currency: ccy, amount: formatBalanceAmt(left, ccy) });
            hintBal.hidden = false;
            if (amt > bal + 1e-9) hintBal.setAttribute('data-variant', 'err');
          }
        }
      }
    }

    refreshAmountScaleHints();
  }

  function onTransferDebitAmountInput() {
    if (transferRecalcLock || !isTransferForm()) return;
    transferLastEdited = 'debit_amt';
    const debitAmt = document.getElementById('kassa-field-debit-amount');
    const creditAmt = document.getElementById('kassa-field-credit-amount');
    const rateEl = document.getElementById('kassa-field-transfer-rate');
    const dc = (document.getElementById('kassa-field-debit-currency')?.value || '').toUpperCase();
    const cc = (document.getElementById('kassa-field-credit-currency')?.value || '').toUpperCase();

    if (AM && debitAmt) AM.formatInputElement(debitAmt, AM.decimalsForCurrency(dc || 'UZS'));
    else if (debitAmt) {
      const rawDebit = numGrouped(debitAmt.value);
      if (Number.isFinite(rawDebit)) applyPlainNumberInput(debitAmt, rawDebit, dc || 'UZS');
    }

    const da = numGrouped(debitAmt?.value);

    if (!(dc && cc)) {
      updateTransferEditorHints();
      return;
    }

    transferRecalcLock = true;
    if (dc === cc) {
      const synced = AM ? AM.parseAmount(debitAmt?.value) : numGrouped(debitAmt?.value);
      if (creditAmt) applyPlainNumberInput(creditAmt, synced, cc);
      if (rateEl) rateEl.value = '';
    } else if (Number.isFinite(da) && da > 0) {
      const rVal = rateEl ? numGrouped(rateEl.value) : NaN;
      if (Number.isFinite(rVal) && rVal > 0 && creditAmt) {
        const cr = roundMoneyAmt(da / rVal, cc);
        applyPlainNumberInput(creditAmt, cr, cc);
      } else {
        const conv = convertThroughUsd(da, dc, cc, fxRates);
        if (conv != null && creditAmt) {
          const rounded = roundMoneyAmt(conv, cc);
          applyPlainNumberInput(creditAmt, rounded, cc);
          if (rounded > 0 && rateEl) {
            const rNum = da / rounded;
            if (AM) AM.setRateInputFromNumber(rateEl, rNum, 12);
            else rateEl.value = String(rNum).replace('.', ',');
          }
        }
      }
    }
    transferRecalcLock = false;
    updateTransferEditorHints();
  }

  function onTransferCreditAmountInput() {
    if (transferRecalcLock || !isTransferForm()) return;
    transferLastEdited = 'credit_amt';
    const debitAmt = document.getElementById('kassa-field-debit-amount');
    const creditAmt = document.getElementById('kassa-field-credit-amount');
    const rateEl = document.getElementById('kassa-field-transfer-rate');
    const dc = (document.getElementById('kassa-field-debit-currency')?.value || '').toUpperCase();
    const cc = (document.getElementById('kassa-field-credit-currency')?.value || '').toUpperCase();

    if (AM && creditAmt) AM.formatInputElement(creditAmt, AM.decimalsForCurrency(cc || 'UZS'));
    else if (creditAmt) {
      const rawC = numGrouped(creditAmt.value);
      if (Number.isFinite(rawC)) applyPlainNumberInput(creditAmt, rawC, cc || 'UZS');
    }

    const da = numGrouped(debitAmt?.value);
    const ca = numGrouped(creditAmt?.value);

    transferRecalcLock = true;
    if (dc === cc) {
      const synced = AM ? AM.parseAmount(creditAmt?.value) : ca;
      if (debitAmt) applyPlainNumberInput(debitAmt, synced, dc);
    } else if (Number.isFinite(da) && da > 0 && Number.isFinite(ca) && ca > 0 && rateEl) {
      if (AM) AM.setRateInputFromNumber(rateEl, da / ca, 12);
      else rateEl.value = String(da / ca).replace('.', ',');
    }
    transferRecalcLock = false;
    updateTransferEditorHints();
  }

  function onTransferRateInput() {
    if (transferRecalcLock || !isTransferForm()) return;
    transferLastEdited = 'rate';
    const debitAmt = document.getElementById('kassa-field-debit-amount');
    const creditAmt = document.getElementById('kassa-field-credit-amount');
    const rateEl = document.getElementById('kassa-field-transfer-rate');
    const dc = (document.getElementById('kassa-field-debit-currency')?.value || '').toUpperCase();
    const cc = (document.getElementById('kassa-field-credit-currency')?.value || '').toUpperCase();

    if (AM && rateEl) AM.formatRateInputElement(rateEl, 12);

    const da = numGrouped(debitAmt?.value);
    const rVal = rateEl ? numGrouped(rateEl.value) : NaN;

    transferRecalcLock = true;
    if (dc === cc) {
      const synced = AM && debitAmt ? AM.parseAmount(debitAmt.value) : da;
      if (creditAmt) applyPlainNumberInput(creditAmt, synced, cc);
    } else if (Number.isFinite(rVal) && rVal > 0 && Number.isFinite(da) && da > 0 && creditAmt)
      applyPlainNumberInput(creditAmt, roundMoneyAmt(da / rVal, cc), cc);
    transferRecalcLock = false;
    updateTransferEditorHints();
  }

  function onTransferCurrencySideChanged() {
    transferLastEdited = null;
    const rateEl = document.getElementById('kassa-field-transfer-rate');
    if (rateEl) rateEl.value = '';
    formatCommissionTransferInput(false);
    onTransferDebitAmountInput();
  }

  /** @param {boolean} reformat Если true — переформатировать по дробям валюты списания. */
  function formatCommissionTransferInput(reformat) {
    const el = document.getElementById('kassa-field-transfer-commission');
    if (!el || !isTransferForm()) return;
    const dc = (document.getElementById('kassa-field-debit-currency')?.value || 'USD').toUpperCase();
    if (reformat && AM) {
      const n = AM.parseAmount(el.value);
      AM.formatInputElement(el, AM.decimalsForCurrency(dc));
    }
    refreshAmountScaleHints();
  }

  function validateExpenseOrTransferBalance(data) {
    const type = data.type;
    if (type !== 'expense' && type !== 'transfer') return '';
    const fromId = data.from_pocket_id;
    if (!fromId) return i18n('kassa.err.pick_from', 'Выберите счёт для списания.');
    const ccy = String(data.currency || '').toUpperCase();
    const amt = Number(data.amount);
    if (!Number.isFinite(amt) || amt <= 0) return '';
    const pocket = getPocketById(fromId);
    const row = getBalanceEntry(pocket, ccy);
    if (!row || !Number.isFinite(Number(row.amount)))
      return i18n('kassa.err.no_ccy', 'На счёте нет выбранной валюты — задайте остаток на вкладке «Счёт».');
    const bal = Number(row.amount);
    if (amt > bal + 1e-9) return i18n('kassa.err.overdraft', 'Сумма больше доступного остатка по этой валюте.');
    return '';
  }

  function validateTransferCreditFields() {
    const dc = (document.getElementById('kassa-field-debit-currency')?.value || '').trim();
    const cc = (document.getElementById('kassa-field-credit-currency')?.value || '').trim();
    const da = numGrouped(document.getElementById('kassa-field-debit-amount')?.value);
    const ca = numGrouped(document.getElementById('kassa-field-credit-amount')?.value);
    if (!dc) return i18n('kassa.err.pick_dc', 'Выберите валюту списания.');
    if (!cc) return i18n('kassa.err.pick_cc', 'Выберите валюту зачисления.');
    if (!Number.isFinite(da) || da <= 0) return i18n('kassa.err.amt_debit', 'Укажите сумму списания.');
    if (!Number.isFinite(ca) || ca <= 0) return i18n('kassa.err.amt_credit', 'Укажите сумму зачисления.');
    const fid = els.fieldFromPocket?.value;
    const tid = els.fieldToPocket?.value;
    if (fid && tid && fid === tid) return i18n('kassa.err.same_pocket', 'Выберите разные счета для перевода.');
    return '';
  }

  function getTypeLabel(type, tx) {
    switch (type) {
      case 'income': return `<span class="kassa-type-badge kassa-type-income">${escapeHtml(i18n('kassa.type.income', 'Доход'))}</span>`;
      case 'expense': return `<span class="kassa-type-badge kassa-type-expense">${escapeHtml(i18n('kassa.type.expense', 'Расход'))}</span>`;
      case 'transfer': {
        const isCashout = String(tx?.data?.transfer_kind || '') === 'cashout';
        const label = isCashout ? i18n('kassa.transfer_kind.cashout', 'Cash out') : i18n('kassa.type.transfer', 'Transfer');
        return `<span class="kassa-type-badge kassa-type-transfer">${escapeHtml(label)}</span>`;
      }
      default: return escapeHtml(type);
    }
  }

  function columnDef(key) {
    return COLUMN_DEFS.find((x) => x.key === key) || null;
  }

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  function clampColumnWidth(value) {
    const width = Math.round(Number(value) || 0);
    if (!width) return COLUMN_MIN_WIDTH;
    return Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, width));
  }

  function getColumnWidth(key) {
    return clampColumnWidth(columnWidths[key] || COLUMN_DEFAULT_WIDTHS[key] || 140);
  }

  function visibleColumnKeys() {
    return columnOrder.filter((key) => columnDef(key) && !columnHidden.has(key));
  }

  function pickFillColumnKey(keys, excludeKey = '') {
    if (!keys.length) return '';
    const priority = ['note', 'category', 'client', 'supplier', 'assets', 'date', 'amount', 'to', 'from'];
    return (
      priority.find((key) => key !== excludeKey && keys.includes(key)) ||
      keys.find((key) => key !== excludeKey && key !== 'actions') ||
      keys.find((key) => key !== excludeKey) ||
      keys[0]
    );
  }

  function effectiveColumnWidths() {
    const visibleKeys = visibleColumnKeys();
    const widths = {};
    let baseTotal = 0;

    visibleKeys.forEach((key) => {
      const width = getColumnWidth(key);
      widths[key] = width;
      baseTotal += width;
    });

    const wrapper = els.table?.closest('.kassa-table-wrapper');
    const wrapperWidth = wrapper?.clientWidth || els.table?.parentElement?.clientWidth || 0;
    if (wrapperWidth > baseTotal && visibleKeys.length) {
      const fillKey = pickFillColumnKey(visibleKeys, resizingColumn?.key || '');
      if (fillKey) widths[fillKey] = Math.max(COLUMN_MIN_WIDTH, widths[fillKey] + (wrapperWidth - baseTotal));
    }

    return widths;
  }

  function loadColumnWidths() {
    const allowed = new Set(COLUMN_DEFS.map((c) => c.key));
    const next = {};
    try {
      const raw = JSON.parse(safeStorageGet(COLUMN_WIDTH_KEY) || '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        Object.entries(raw).forEach(([key, value]) => {
          if (allowed.has(key)) next[key] = clampColumnWidth(value);
        });
      }
    } catch {
      /* use defaults */
    }
    columnWidths = { ...COLUMN_DEFAULT_WIDTHS, ...next };
  }

  function saveColumnWidths() {
    safeStorageSet(COLUMN_WIDTH_KEY, JSON.stringify(columnWidths));
  }

  function ensureColumnGroup() {
    if (!els.table) return null;
    let group = els.table.querySelector('colgroup[data-kassa-column-widths]');
    if (!group) {
      group = document.createElement('colgroup');
      group.setAttribute('data-kassa-column-widths', '');
      els.table.insertBefore(group, els.table.firstChild);
    }
    return group;
  }

  function applyColumnWidths() {
    if (!els.table) return;
    const group = ensureColumnGroup();
    if (!group) return;
    group.replaceChildren();

    const keys = visibleColumnKeys();
    const effectiveWidths = effectiveColumnWidths();
    let totalWidth = 0;
    keys.forEach((key) => {
      const col = document.createElement('col');
      const width = Math.max(0, Math.round(effectiveWidths[key] || getColumnWidth(key)));
      col.dataset.col = key;
      col.style.width = `${width}px`;
      group.appendChild(col);
      totalWidth += width;
    });

    const wrapper = els.table.closest('.kassa-table-wrapper');
    const wrapperWidth = wrapper?.clientWidth || els.table.parentElement?.clientWidth || 0;
    const tableWidth = Math.max(totalWidth, wrapperWidth);
    els.table.style.width = tableWidth ? `${tableWidth}px` : '';
    els.table.style.minWidth = wrapperWidth ? `${wrapperWidth}px` : '100%';

    els.table.querySelectorAll('thead th[data-col]').forEach((th) => {
      const key = th.getAttribute('data-col') || '';
      const width = Math.max(0, Math.round(effectiveWidths[key] || getColumnWidth(key)));
      th.style.width = `${width}px`;
      th.style.minWidth = `${COLUMN_MIN_WIDTH}px`;
    });
  }

  function scheduleColumnLayout() {
    if (columnLayoutFrame) cancelAnimationFrame(columnLayoutFrame);
    columnLayoutFrame = requestAnimationFrame(() => {
      columnLayoutFrame = 0;
      applyColumnWidths();
    });
  }

  function beginColumnResize(ev) {
    const handle = ev.target.closest('[data-col-resize]');
    if (!handle || !els.table) return;
    const key = handle.getAttribute('data-col-resize') || '';
    if (!columnDef(key)) return;

    ev.preventDefault();
    ev.stopPropagation();

    resizingColumn = {
      key,
      startX: ev.clientX,
      startWidth: getColumnWidth(key),
    };
    draggingColumn = '';
    els.table.classList.add('is-column-resizing');
    document.body.classList.add('kassa-column-resizing');
    handle.setPointerCapture?.(ev.pointerId);
    document.addEventListener('pointermove', onColumnResizeMove);
    document.addEventListener('pointerup', endColumnResize, { once: true });
    document.addEventListener('pointercancel', endColumnResize, { once: true });
  }

  function onColumnResizeMove(ev) {
    if (!resizingColumn) return;
    const nextWidth = resizingColumn.startWidth + (ev.clientX - resizingColumn.startX);
    columnWidths[resizingColumn.key] = clampColumnWidth(nextWidth);
    applyColumnWidths();
  }

  function endColumnResize() {
    if (!resizingColumn) return;
    saveColumnWidths();
    resizingColumn = null;
    els.table?.classList.remove('is-column-resizing');
    document.body.classList.remove('kassa-column-resizing');
    document.removeEventListener('pointermove', onColumnResizeMove);
    document.removeEventListener('pointerup', endColumnResize);
    document.removeEventListener('pointercancel', endColumnResize);
  }

  function nudgeColumnWidth(key, delta) {
    if (!columnDef(key)) return;
    columnWidths[key] = clampColumnWidth(getColumnWidth(key) + delta);
    saveColumnWidths();
    applyColumnWidths();
  }

  function loadColumnPrefs() {
    const allowed = new Set(COLUMN_DEFS.map((c) => c.key));
    try {
      const rawOrder = JSON.parse(safeStorageGet(COLUMN_ORDER_KEY) || '[]');
      if (Array.isArray(rawOrder)) {
        const clean = rawOrder.filter((x) => allowed.has(x) && x !== 'month' && x !== 'checkbox');
        const missing = COLUMN_DEFS.map((x) => x.key).filter((x) => !clean.includes(x));
        columnOrder = [...clean, ...missing];
      }
    } catch {
      columnOrder = COLUMN_DEFS.map((c) => c.key);
    }
    try {
      const rawSort = JSON.parse(safeStorageGet(COLUMN_SORT_KEY) || '{}');
      if (
        rawSort
        && allowed.has(rawSort.key)
        && rawSort.key !== 'checkbox'
        && (rawSort.dir === 'asc' || rawSort.dir === 'desc')
      ) {
        columnSort = { key: rawSort.key, dir: rawSort.dir };
      }
    } catch {
      columnSort = { key: '', dir: 'asc' };
    }
  }

  function saveColumnOrder() {
    safeStorageSet(COLUMN_ORDER_KEY, JSON.stringify(columnOrder));
  }

  function saveColumnSort() {
    safeStorageSet(COLUMN_SORT_KEY, JSON.stringify(columnSort));
  }

  function loadColumnVisibility() {
    try {
      const raw = JSON.parse(safeStorageGet(COLUMN_HIDDEN_KEY) || '[]');
      if (Array.isArray(raw)) {
        columnHidden = new Set(raw.filter((x) => TOGGLEABLE_COLUMNS.includes(x) && x !== 'month'));
      }
    } catch {
      columnHidden = new Set();
    }
  }

  function saveColumnVisibility() {
    safeStorageSet(COLUMN_HIDDEN_KEY, JSON.stringify([...columnHidden]));
  }

  function applyColumnVisibility() {
    if (!els.table) return;
    TOGGLEABLE_COLUMNS.forEach((col) => {
      els.table.classList.toggle(`hide-${col}`, columnHidden.has(col));
    });
    if (els.columnToggles) {
      els.columnToggles.querySelectorAll('[data-column-toggle]').forEach((checkbox) => {
        const col = checkbox.getAttribute('data-column-toggle');
        if (col) checkbox.checked = !columnHidden.has(col);
      });
    }
    applyColumnWidths();
  }

  function rerenderColumns() {
    renderTableHeader();
    renderTable();
  }

  function buildColumnToggleMenu() {
    if (!els.columnToggles) return;
    els.columnToggles.innerHTML = TOGGLEABLE_COLUMNS.map((key) => {
      const def = columnDef(key);
      const label = def ? def.label : key;
      const checked = !columnHidden.has(key);
      return `<label class="kassa-columns-menu-item"><input type="checkbox" data-column-toggle="${escapeHtml(key)}" ${checked ? 'checked' : ''} /><span>${escapeHtml(label)}</span></label>`;
    }).join('');
  }

  function positionColumnsMenu() {
    if (!els.columnsMenu || !els.columnsToggle) return;
    const rect = els.columnsToggle.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const needed = 320;
    els.columnsMenu.classList.toggle(
      'is-flipped',
      spaceBelow < needed && rect.top > needed,
    );
  }

  function closeColumnsMenu() {
    if (!els.columnsMenu || !els.columnsToggle) return;
    els.columnsMenu.hidden = true;
    els.columnsToggle.setAttribute('aria-expanded', 'false');
  }

  function openColumnsMenu() {
    if (!els.columnsMenu || !els.columnsToggle) return;
    els.columnsMenu.hidden = false;
    els.columnsToggle.setAttribute('aria-expanded', 'true');
    positionColumnsMenu();
  }

  function toggleColumnsMenu() {
    if (!els.columnsMenu) return;
    if (els.columnsMenu.hidden) openColumnsMenu();
    else closeColumnsMenu();
  }

  function showAllColumns() {
    columnHidden.clear();
    saveColumnVisibility();
    buildColumnToggleMenu();
    rerenderColumns();
    if (els.columnTemplateSelect) els.columnTemplateSelect.value = '';
  }

  function resetColumnsVisibility() {
    loadColumnVisibility();
    buildColumnToggleMenu();
    rerenderColumns();
    if (els.columnTemplateSelect) els.columnTemplateSelect.value = '';
  }

  function loadColumnTemplates() {
    try {
      const raw = JSON.parse(safeStorageGet(COLUMN_TEMPLATES_KEY) || '[]');
      columnTemplates = Array.isArray(raw)
        ? raw.filter((t) => t && t.id && t.name && Array.isArray(t.hidden))
        : [];
    } catch {
      columnTemplates = [];
    }
  }

  function saveColumnTemplatesStore() {
    safeStorageSet(COLUMN_TEMPLATES_KEY, JSON.stringify(columnTemplates));
  }

  function renderColumnTemplateSelect() {
    if (!els.columnTemplateSelect) return;
    const current = els.columnTemplateSelect.value;
    const defaultLabel = i18n('kassa.columns.template_all', 'Все');
    els.columnTemplateSelect.innerHTML =
      `<option value="">${escapeHtml(defaultLabel)}</option>` +
      columnTemplates
        .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
        .join('');
    if (current && [...els.columnTemplateSelect.options].some((o) => o.value === current)) {
      els.columnTemplateSelect.value = current;
    }
    if (els.columnTemplateDelete) {
      els.columnTemplateDelete.disabled = !els.columnTemplateSelect.value;
    }
  }

  function applyColumnTemplate(templateId) {
    if (!templateId) {
      loadColumnVisibility();
    } else {
      const tpl = columnTemplates.find((t) => t.id === templateId);
      if (!tpl) return;
      columnHidden = new Set(
        tpl.hidden.filter((x) => TOGGLEABLE_COLUMNS.includes(x) && x !== 'month'),
      );
      saveColumnVisibility();
    }
    buildColumnToggleMenu();
    rerenderColumns();
  }

  function saveCurrentColumnTemplate() {
    const name = (els.columnTemplateName?.value || '').trim();
    if (!name) {
      alert(i18n('kassa.columns.template_name_required', 'Введите название шаблона'));
      return;
    }
    const id = `tpl_${Date.now()}`;
    columnTemplates.push({ id, name, hidden: [...columnHidden] });
    saveColumnTemplatesStore();
    renderColumnTemplateSelect();
    if (els.columnTemplateSelect) els.columnTemplateSelect.value = id;
    if (els.columnTemplateName) els.columnTemplateName.value = '';
    if (els.columnTemplateDelete) els.columnTemplateDelete.disabled = false;
  }

  function deleteSelectedColumnTemplate() {
    const id = els.columnTemplateSelect?.value || '';
    if (!id) return;
    columnTemplates = columnTemplates.filter((t) => t.id !== id);
    saveColumnTemplatesStore();
    renderColumnTemplateSelect();
    applyColumnTemplate('');
  }

  function loadPageSizePrefs() {
    const raw = safeStorageGet(PAGE_SIZE_KEY);
    if (raw === 'all') {
      pageSize = 10;
      safeStorageSet(PAGE_SIZE_KEY, '10');
    } else {
      const n = Number(raw);
      if (PAGE_SIZE_OPTIONS.filter((x) => x !== 'all').includes(n)) pageSize = n;
    }
    if (els.pageSizeSelect) {
      els.pageSizeSelect.value = String(pageSize);
    }
  }

  function savePageSizePrefs() {
    safeStorageSet(PAGE_SIZE_KEY, String(pageSize));
  }

  function getFilteredRows() {
    const key = filterCacheKey();
    if (filteredRowsCache && filteredRowsCacheKey === key) return filteredRowsCache;
    filteredRowsCache = sortRows(applyFilters());
    filteredRowsCacheKey = key;
    return filteredRowsCache;
  }

  function paginateRows(rows) {
    if (pageSize === 'all') {
      return rows.slice(0, MAX_DOM_ROWS);
    }
    const size = Number(pageSize) || 10;
    const maxPage = Math.max(0, Math.ceil(rows.length / size) - 1);
    if (pageIndex > maxPage) pageIndex = maxPage;
    const start = pageIndex * size;
    return rows.slice(start, start + size);
  }

  function getPaginationMeta(total) {
    const capped = pageSize === 'all' && total > MAX_DOM_ROWS;
    const displayTotal = pageSize === 'all' ? Math.min(total, MAX_DOM_ROWS) : total;

    if (pageSize === 'all' || total === 0) {
      return {
        total,
        displayTotal,
        start: displayTotal ? 1 : 0,
        end: displayTotal,
        pageIndex: 0,
        pageCount: 1,
        capped,
      };
    }
    const size = Number(pageSize) || 10;
    const pageCount = Math.max(1, Math.ceil(total / size));
    const safeIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
    if (safeIndex !== pageIndex) pageIndex = safeIndex;
    const sliceStart = safeIndex * size;
    const sliceEnd = Math.min(sliceStart + size, total);
    return {
      total,
      displayTotal,
      start: sliceStart + 1,
      end: sliceEnd,
      pageIndex: safeIndex,
      pageCount,
      capped: false,
    };
  }

  function renderPagination(meta) {
    if (!els.paginationInfo) return;
    const { total, start, end, pageIndex: idx, pageCount, capped } = meta;
    if (total === 0) {
      els.paginationInfo.textContent = i18n('kassa.pagination.empty', 'Нет операций');
    } else if (pageSize === 'all') {
      const shown = Math.min(total, MAX_DOM_ROWS);
      let text = i18n('kassa.pagination.all', 'Показано все {count}').replace('{count}', String(shown));
      if (capped) {
        text += ' — ' + i18n('kassa.pagination.capped', 'уточните фильтр ({total} всего)').replace('{total}', String(total));
      }
      els.paginationInfo.textContent = text;
    } else {
      els.paginationInfo.textContent = i18n(
        'kassa.pagination.range',
        'Показано {start}–{end} из {total}',
      )
        .replace('{start}', String(start))
        .replace('{end}', String(end))
        .replace('{total}', String(total));
    }
    if (els.pageIndicator) {
      els.pageIndicator.textContent = pageSize === 'all' || total === 0
        ? '—'
        : i18n('kassa.pagination.page_of', 'Стр. {page} / {pages}')
          .replace('{page}', String(idx + 1))
          .replace('{pages}', String(pageCount));
    }
    if (els.pagePrev) els.pagePrev.disabled = pageSize === 'all' || idx <= 0 || total === 0;
    if (els.pageNext) {
      els.pageNext.disabled = pageSize === 'all' || idx >= pageCount - 1 || total === 0;
    }
  }

  function txStatus(tx) {
    const status = String(tx?.status || '').toLowerCase();
    if (['draft', 'pending', 'confirmed', 'rejected'].includes(status)) return status;
    return tx?.is_confirmed ? 'confirmed' : 'draft';
  }

  function txStatusLabel(tx) {
    const status = txStatus(tx);
    if (status === 'draft') return 'Черновик';
    if (status === 'pending') return 'Ожидание';
    if (status === 'rejected') return 'Отклонено';
    return 'Подтверждено';
  }

  function statusOptionHtml(value, label, selected) {
    return `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }

  function txStatusSelectHtml(tx) {
    const status = txStatus(tx);
    const labels = {
      confirmed: 'Подтверждено',
      pending: 'Ожидание',
      draft: 'Черновик',
      rejected: 'Отклонено',
    };
    return `<select class="kassa-status-select kassa-status-select--${escapeHtml(status)}" data-status-id="${escapeHtml(tx.id)}" data-current-status="${escapeHtml(status)}" aria-label="Статус операции">
      ${statusOptionHtml('confirmed', labels.confirmed, status === 'confirmed')}
      ${statusOptionHtml('pending', labels.pending, status === 'pending')}
      ${statusOptionHtml('draft', labels.draft, status === 'draft')}
      ${statusOptionHtml('rejected', labels.rejected, status === 'rejected')}
    </select>`;
  }

  function canReturnTxToDraft(tx) {
    return tx && ['income', 'expense'].includes(tx.type) && txStatus(tx) === 'confirmed';
  }

  function canConfirmDraftTx(tx) {
    return tx && ['income', 'expense'].includes(tx.type) && txStatus(tx) === 'draft';
  }

  function txEmployeeText(tx) {
    return tx?.data?.hr_employee_name || tx?.employee_name || tx?.employee_id || '';
  }

  function txColumnText(tx, key) {
    switch (key) {
      case 'number': return String(tx.number || '');
      case 'amount': return formatTransferAmountSummary(tx);
      case 'date': return formatDate(tx.created_at);
      case 'client': return tx.client || '';
      case 'employee': return txEmployeeText(tx);
      case 'from': return getPocketName(tx.from_pocket_id);
      case 'to': return getPocketName(tx.to_pocket_id);
      case 'type':
        return tx.type === 'income' ? i18n('kassa.type.income', 'Доход') : tx.type === 'expense' ? i18n('kassa.type.expense', 'Расход') : tx.type === 'transfer' ? i18n('kassa.type.transfer', 'Перевод') : tx.type || '';
      case 'confirmed': return txStatusLabel(tx);
      case 'category': return tx.category || '';
      case 'assets': return tx.data?.asset || tx.data?.assets || '';
      case 'supplier': return tx.supplier || '';
      case 'courier-summary': return courierBreakdownSummary(tx);
      case 'supplier-balance': return tx.data?.supplier_balance || '';
      case 'author': return tx.data?.author || tx.data?.author_name || '';
      case 'branch': return tx.branch || '';
      case 'note': return tx.note || '';
      default: return '';
    }
  }

  function txCellHtml(tx, key) {
    const text = txColumnText(tx, key) || '—';
    switch (key) {
      case 'amount':
        return `<td class="kassa-col-amount" data-col="amount">${escapeHtml(text)}</td>`;
      case 'type':
        return `<td data-col="type">${getTypeLabel(tx.type, tx)}</td>`;
      case 'confirmed':
        return `<td data-col="confirmed">${txStatusSelectHtml(tx)}</td>`;
      case 'courier-summary':
        return `<td class="kassa-col-courier-summary" data-col="courier-summary">${escapeHtml(text)}</td>`;
      case 'actions': {
        const confirmBtn = canConfirmDraftTx(tx)
          ? `<button type="button" class="kassa-action-btn confirm" data-id="${escapeHtml(tx.id)}" title="Подтвердить">✓</button>`
          : '';
        return `<td data-col="actions">
          ${confirmBtn}
          <button type="button" class="kassa-action-btn edit" data-id="${escapeHtml(tx.id)}" title="${escapeHtml(i18n('kassa.edit', 'Редактировать'))}">✎</button>
          <button type="button" class="kassa-action-btn delete" data-id="${escapeHtml(tx.id)}" title="${escapeHtml(i18n('kassa.delete', 'Удалить'))}">✕</button>
        </td>`;
      }
      default:
        return `<td data-col="${escapeHtml(key)}">${escapeHtml(text)}</td>`;
    }
  }

  

  function renderTableHeader() {
    const theadRow = els.table?.querySelector('thead tr');
    if (!theadRow) return;
    theadRow.innerHTML = visibleColumnKeys().map((key) => {
      const def = columnDef(key);
      if (!def) return '';
      const dragAttrs = def.locked ? '' : ' draggable="true"';
      const sortActive = columnSort.key === key ? ` is-sorted sort-${columnSort.dir}` : '';
      const sortMark = columnSort.key === key ? (columnSort.dir === 'asc' ? '↑' : '↓') : '';
      const label = escapeHtml(def.label);
      const width = getColumnWidth(key);
      return `<th class="${escapeHtml(def.className)}${sortActive}" data-col="${escapeHtml(key)}" style="width:${width}px; min-width:${COLUMN_MIN_WIDTH}px"${dragAttrs}>
        <span class="kassa-th-inner">
          <button type="button" class="kassa-th-label" data-col-sort="${escapeHtml(key)}" ${def.locked ? 'tabindex="-1"' : ''}>${label}</button>
          ${sortMark ? `<span class="kassa-sort-mark" aria-hidden="true">${sortMark}</span>` : ''}
        </span>
        <span class="kassa-col-resizer" data-col-resize="${escapeHtml(key)}" role="separator" aria-orientation="vertical" aria-label="${escapeHtml(`Изменить ширину: ${def.label}`)}" tabindex="0"></span>
      </th>`;
    }).join('');
    applyColumnWidths();
  }

  function applyColumnOrderToDom() {
    if (!els.tableBody) return;
    const keys = visibleColumnKeys();
    els.tableBody.querySelectorAll('tr').forEach((row) => {
      const cells = new Map();
      row.querySelectorAll('td').forEach((td) => {
        const key = td.getAttribute('data-col') || '';
        if (key) cells.set(key, td);
      });
      keys.forEach((key) => {
        const cell = cells.get(key);
        if (cell) row.appendChild(cell);
      });
    });
  }

  

  

  function sortRows(rows) {
    if (!columnSort.key) return rows;
    const key = columnSort.key;
    const dir = columnSort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      let av;
      let bv;
      if (key === 'date') {
        av = a.created_at ? new Date(a.created_at).getTime() : 0;
        bv = b.created_at ? new Date(b.created_at).getTime() : 0;
      } else if (key === 'amount' || key === 'number') {
        av = Number(key === 'amount' ? a.amount : a.number) || 0;
        bv = Number(key === 'amount' ? b.amount : b.number) || 0;
      } else {
        av = txColumnText(a, key).toLowerCase();
        bv = txColumnText(b, key).toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function toggleColumnSort(key) {
    const def = columnDef(key);
    if (!def || def.locked || key === 'actions') return;
    if (columnSort.key === key) {
      columnSort = { key, dir: columnSort.dir === 'asc' ? 'desc' : 'asc' };
    } else {
      columnSort = { key, dir: 'asc' };
    }
    saveColumnSort();
    invalidateFilteredCache();
    renderTableHeader();
    renderTable();
  }

  function reorderColumn(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    if (columnDef(fromKey)?.locked || columnDef(toKey)?.locked) return;
    const next = columnOrder.filter((x) => x !== fromKey);
    const toIndex = next.indexOf(toKey);
    if (toIndex < 0) return;
    next.splice(toIndex, 0, fromKey);
    columnOrder = next;
    saveColumnOrder();
    renderTableHeader();
    renderTable();
  }

  function applyFilters() {
    return transactions.filter(tx => {
      if (currentFilter.search) {
        const rawQ = String(currentFilter.search || '').trim();
        const q = rawQ.toLowerCase();
        const exactNumber = rawQ.startsWith('#') ? rawQ.slice(1).trim() : '';
        const match = exactNumber
          ? String(tx.number || '').trim() === exactNumber
          : (
            String(tx.number || '').includes(q) ||
            String(tx.id || '').toLowerCase().includes(q) ||
            (tx.category || '').toLowerCase().includes(q) ||
            (tx.client || '').toLowerCase().includes(q) ||
            txEmployeeText(tx).toLowerCase().includes(q) ||
            (tx.supplier || '').toLowerCase().includes(q) ||
            (tx.note || '').toLowerCase().includes(q)
          );
        if (!match) return false;
      }
      if (!filterMatches('category', tx.category || '')) return false;
      if (!filterMatches('type', tx.type || '')) return false;
      if (!filterMatches('status', txStatus(tx))) return false;
      if (!filterMatches('supplier', tx.supplier || '')) return false;

      const currencyFilter = filterValues('currency');
      if (currencyFilter.length) {
        const txCurrencySet = new Set(transactionCurrencies(tx));
        if (!currencyFilter.some((ccy) => txCurrencySet.has(ccy))) return false;
      }

      const pocketFilter = filterValues('pocket');
      if (pocketFilter.length) {
        const fromPocket = String(tx.from_pocket_id || '').trim();
        const toPocket = String(tx.to_pocket_id || '').trim();
        if (!pocketFilter.includes(fromPocket) && !pocketFilter.includes(toPocket)) {
          return false;
        }
      }

      if (currentFilter.dateStart) {
        const txDay = calendarDateInWorkspaceTz(tx.created_at);
        if (!txDay || txDay < currentFilter.dateStart) return false;
      }
      if (currentFilter.dateEnd) {
        const txDay = calendarDateInWorkspaceTz(tx.created_at);
        if (!txDay || txDay > currentFilter.dateEnd) return false;
      }

      return true;
    });
  }

  function buildTreasuryBalanceSummary() {
    const totals = {};
    const selectedPocketIds = filterValues('pocket');
    const selected = new Set(selectedPocketIds.map((value) => String(value || '').trim()).filter(Boolean));
    const pockets = Array.isArray(treasury?.pockets) ? treasury.pockets : [];

    pockets.forEach((pocket) => {
      const pocketId = String(pocket?.id || '').trim();
      if (selected.size && !selected.has(pocketId)) return;
      pocketBalancesList(pocket).forEach((entry) => {
        const ccy = String(entry.currency || '').toUpperCase();
        if (!ccy) return;
        totals[ccy] = (totals[ccy] || 0) + (Number(entry.amount) || 0);
      });
    });

    return totals;
  }

  function addSummaryCurrencyAmount(map, currency, amount) {
    const ccy = String(currency || '').toUpperCase();
    const value = Number(amount);
    if (!ccy || !Number.isFinite(value)) return;
    map[ccy] = (map[ccy] || 0) + value;
  }

  function buildOperationSummary(rows) {
    const income = {};
    const expense = {};
    const transfer = {};

    (Array.isArray(rows) ? rows : []).forEach((tx) => {
      if (txStatus(tx) !== 'confirmed') return;
      const amount = Math.abs(Number(tx.amount) || 0);
      if (tx.type === 'income') {
        addSummaryCurrencyAmount(income, tx.currency, amount);
      } else if (tx.type === 'expense') {
        addSummaryCurrencyAmount(expense, tx.currency, amount);
      } else if (tx.type === 'transfer') {
        addSummaryCurrencyAmount(transfer, tx.currency, amount);
      }
    });

    return { income, expense, transfer };
  }

  function buildRemainingSummary(totals) {
    const remaining = {};
    const currencies = new Set([
      ...Object.keys(totals?.income || {}),
      ...Object.keys(totals?.expense || {}),
      ...Object.keys(totals?.transfer || {}),
    ]);
    currencies.forEach((currency) => {
      const income = Number(totals?.income?.[currency]) || 0;
      const expense = Number(totals?.expense?.[currency]) || 0;
      const transfer = Number(totals?.transfer?.[currency]) || 0;
      const amount = income - expense + transfer;
      if (Math.abs(amount) > 1e-9) remaining[currency] = roundMoneyAmt(amount, currency);
    });
    return remaining;
  }

  function tableSummaryRowsHtml(visibleKeys) {
    if (!visibleKeys.includes('amount')) return '';
    const balances = buildTreasuryBalanceSummary();
    const label = i18n('kassa.summary.balance', 'Реальный остаток');
    const labelKey = visibleKeys.find((key) => key === 'category' || key === 'note' || key === 'type') || visibleKeys[0] || 'amount';
    const cells = visibleKeys.map((key) => {
      const col = escapeHtml(key);
      if (key === 'amount') {
        const amountLabel = labelKey === 'amount'
          ? `<span class="kassa-table-summary-label">${escapeHtml(label)}</span>`
          : '';
        return `<td class="kassa-table-summary-cell kassa-table-summary-amount" data-col="${col}">${amountLabel}${summaryCurrencyChipsHtml(balances)}</td>`;
      }
      if (key === labelKey) {
        return `<td class="kassa-table-summary-cell kassa-table-summary-title-cell" data-col="${col}"><span class="kassa-table-summary-label">${escapeHtml(label)}</span></td>`;
      }
      return `<td class="kassa-table-summary-cell kassa-table-summary-empty-cell" data-col="${col}"></td>`;
    }).join('');
    return `<tr class="kassa-table-summary-row kassa-table-summary-row--balance" data-summary-row="true">${cells}</tr>`;
  }

  function renderTable() {
    if (!els.tableBody) return;

    const filtered = getFilteredRows();
    const visibleKeys = visibleColumnKeys();
    const colSpan = visibleKeys.length || 1;

    if (filtered.length === 0) {
      els.tableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding: 2rem; color: var(--muted-foreground);">${escapeHtml(i18n('kassa.no_rows', 'Операции не найдены'))}</td></tr>`;
      applyColumnVisibility();
      scheduleColumnLayout();
      updateSummary([]);
      renderPagination(getPaginationMeta(0));
      return;
    }

    const meta = getPaginationMeta(filtered.length);
    const pageRows = paginateRows(filtered);
    const frag = document.createDocumentFragment();

    pageRows.forEach((tx) => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-tx-id', String(tx.id || ''));
      tr.innerHTML = visibleKeys.map((key) => txCellHtml(tx, key)).join('');
      frag.appendChild(tr);
    });

    els.tableBody.replaceChildren(frag);

    applyColumnOrderToDom();
    applyColumnVisibility();
    scheduleColumnLayout();
    updateSummary(filtered);
    renderPagination(meta);
    highlightTxFromUrl();
  }

  function updateSummary(rows) {
    const filteredRows = Array.isArray(rows) ? rows : getFilteredRows();
    const totals = buildOperationSummary(filteredRows);
    const remaining = buildRemainingSummary(totals);
    syncSummaryCurrencySelect({ ...totals, balance: remaining });
    renderSummaryTotal(els.summaryIncome, totals.income, 'income');
    renderSummaryTotal(els.summaryExpense, totals.expense, 'expense');
    renderSummaryTotal(els.summaryTransfer, totals.transfer, 'transfer');
    renderSummaryTotal(els.summaryBalance, remaining, 'balance');
  }

  function handleTypeChange(opts) {
    if (!els.fieldType) return;
    const type = els.fieldType.value;
    const preserveSimple = String(opts?.preserveCurrency || '').toUpperCase();
    const preserveDebit = String(opts?.preserveDebitCurrency || '').toUpperCase();
    const preserveCredit = String(opts?.preserveCreditCurrency || '').toUpperCase();
    const hasCategoryOverride = opts && Object.prototype.hasOwnProperty.call(opts, 'preserveCategory');
    const preserveCategory = hasCategoryOverride ? String(opts.preserveCategory || '') : undefined;

    els.paymentTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-payment-type') === type);
    });

    if (type === 'income') {
      if (els.rowCategory) els.rowCategory.style.display = 'flex';
      populateCategoryField('income', preserveCategory);
      els.rowFromPocket.style.display = 'none';
      els.rowToPocket.style.display = 'flex';
      els.labelToPocket.textContent = i18n('kassa.f.to_pocket', 'Счёт / кошелёк (зачисление)');
      els.fieldFromPocket.removeAttribute('required');
      els.fieldToPocket.setAttribute('required', 'required');
      els.fieldFromPocket.value = '';
    } else if (type === 'expense') {
      if (els.rowCategory) els.rowCategory.style.display = 'flex';
      populateCategoryField('expense', preserveCategory);
      els.rowFromPocket.style.display = 'flex';
      els.rowToPocket.style.display = 'none';
      els.fieldFromPocket.setAttribute('required', 'required');
      els.fieldToPocket.removeAttribute('required');
      els.fieldToPocket.value = '';
    } else if (type === 'transfer') {
      if (els.rowCategory) els.rowCategory.style.display = 'flex';
      populateCategoryField('transfer', preserveCategory);
      els.rowFromPocket.style.display = 'flex';
      els.rowToPocket.style.display = 'flex';
      els.labelToPocket.textContent = i18n('kassa.f.to_pocket', 'Счёт / кошелёк (зачисление)');
      els.fieldFromPocket.setAttribute('required', 'required');
      els.fieldToPocket.setAttribute('required', 'required');
    }

    toggleMoneyPanels(type === 'transfer');
    transferLastEdited = null;
    syncSimpleSplitAvailability();
    populatePocketSelects();
    updateTransferConfirmationWarning();

    if (type === 'transfer') {
      syncTransferDebitCurrencySelect({ preferCurrency: preserveDebit });
      syncTransferCreditCurrencySelect({ preferCurrency: preserveCredit });
      const rateEl = document.getElementById('kassa-field-transfer-rate');
      if (rateEl) rateEl.value = '';
      void loadFxRates().then(() => {
        onTransferDebitAmountInput();
        updateTransferEditorHints();
      });
    } else {
      syncEditorCurrencySelect({ preferCurrency: preserveSimple });
    }
    syncCourierPaymentUI();
    void syncSalaryEmployeeUI({ preserveValue: els.fieldSalaryEmployee?.value || '' });
  }

  function applyLoadedTransferTx(tx) {
    if (!tx || tx.type !== 'transfer') return;
    const debitAmt = document.getElementById('kassa-field-debit-amount');
    const creditAmt = document.getElementById('kassa-field-credit-amount');
    const rateEl = document.getElementById('kassa-field-transfer-rate');
    const dc = String(tx.currency || '').toUpperCase();
    const cc = String(tx.data?.transfer_credit_currency || dc).toUpperCase();
    const camt = tx.data?.transfer_credit_amount;

    if (debitAmt && AM) AM.setInputFromNumber(debitAmt, Number(tx.amount) || 0, AM.decimalsForCurrency(dc));
    else if (debitAmt) debitAmt.value = tx.amount != null ? String(tx.amount) : '';

    if (creditAmt && AM)
      AM.setInputFromNumber(
        creditAmt,
        camt != null ? Number(camt) : Number(tx.amount) || 0,
        AM.decimalsForCurrency(cc),
      );
    else if (creditAmt) creditAmt.value = camt != null ? String(camt) : (tx.amount ?? '');

    transferRecalcLock = true;
    if (rateEl && dc !== cc) {
      const da = numGrouped(debitAmt?.value);
      const ca = numGrouped(creditAmt?.value);
      if (Number.isFinite(da) && da > 0 && Number.isFinite(ca) && ca > 0 && AM)
        AM.setRateInputFromNumber(rateEl, da / ca, 12);
      else if (rateEl) rateEl.value = '';
    } else if (rateEl) rateEl.value = '';
    transferRecalcLock = false;
    transferLastEdited = null;

    const commEl = document.getElementById('kassa-field-transfer-commission');
    const cm = tx.data?.transfer_commission_amount;
    const dcUpper = dc.toUpperCase();
    if (commEl && AM) {
      if (cm != null && Number(cm) > 0) AM.setInputFromNumber(commEl, Number(cm), AM.decimalsForCurrency(dcUpper));
      else commEl.value = '';
    } else if (commEl) {
      commEl.value = cm != null && Number(cm) > 0 ? String(cm) : '';
    }

    updateTransferEditorHints();
  }

  async function openEditor(txId = null) {
    if (!els.dialog) return;

    await ensureEditorDataLoaded();

    els.form.reset();
    salaryPositionFilter = new Set();
    if (els.fieldSalaryEmployeeSearch) els.fieldSalaryEmployeeSearch.value = '';
    if (els.salaryPositionSearch) els.salaryPositionSearch.value = '';
    closeSalaryEmployeeMenu();
    closeSalaryPositionMenu();
    populatePocketSelects();

    let preserveSimple = '';
    let preserveDebit = '';
    let preserveCredit = '';
    document.getElementById('kassa-field-id').value = '';
    document.getElementById('kassa-field-type').value = 'expense';
    document.getElementById('kassa-field-confirmed').checked = true;
    simpleSplitRows = [];
    const defaultTransferKind = document.querySelector('input[name="transfer_kind"][value="transfer"]');
    if (defaultTransferKind) defaultTransferKind.checked = true;

    document.getElementById('kassa-field-date').value = utcIsoToDatetimeLocalValue(
      new Date().toISOString(),
      workspaceTz,
    );

    let loadedTx = null;

    if (txId) {
      const tx = transactions.find((x) => x.id === txId);
      if (tx) {
        loadedTx = tx;
        if (tx.type === 'transfer') {
          preserveDebit = String(tx.currency || '').toUpperCase();
          preserveCredit = String(tx.data?.transfer_credit_currency || tx.currency || '').toUpperCase();
        } else {
          preserveSimple = String(tx.currency || '').toUpperCase();
        }
        document.getElementById('kassa-editor-title').textContent = i18n('kassa.dialog.payment_num', 'Платеж №') + tx.number;
        document.getElementById('kassa-field-id').value = tx.id;
        document.getElementById('kassa-field-type').value = tx.type;
        if (tx.created_at) {
          document.getElementById('kassa-field-date').value = utcIsoToDatetimeLocalValue(
            tx.created_at,
            workspaceTz,
          );
        }
        document.getElementById('kassa-field-from-pocket').value = tx.from_pocket_id || '';
        document.getElementById('kassa-field-to-pocket').value = tx.to_pocket_id || '';
        document.getElementById('kassa-field-category').value = tx.category || '';
        document.getElementById('kassa-field-client').value = tx.client || '';
        document.getElementById('kassa-field-supplier').value = tx.supplier || '';
        document.getElementById('kassa-field-branch').value = tx.branch || '';
        document.getElementById('kassa-field-note').value = tx.note || '';
        if (els.fieldSalaryEmployee) els.fieldSalaryEmployee.value = tx.data?.hr_employee_id || '';
        document.getElementById('kassa-field-confirmed').checked = tx.is_confirmed;
        const transferKind = String(tx.data?.transfer_kind || 'transfer');
        const transferKindEl = document.querySelector(`input[name="transfer_kind"][value="${transferKind === 'cashout' ? 'cashout' : 'transfer'}"]`);
        if (transferKindEl) transferKindEl.checked = true;
      }
    } else {
      document.getElementById('kassa-editor-title').textContent = i18n('kassa.dialog.new', 'Новый платеж');
      if (els.fieldAmount) els.fieldAmount.value = '';
      const dAmt = document.getElementById('kassa-field-debit-amount');
      const cAmt = document.getElementById('kassa-field-credit-amount');
      if (dAmt) dAmt.value = '';
      if (cAmt) cAmt.value = '';
    }

    handleTypeChange({
      preserveCurrency: preserveSimple,
      preserveDebitCurrency: preserveDebit,
      preserveCreditCurrency: preserveCredit,
      preserveCategory: loadedTx?.category || '',
    });
    if (loadedTx && els.fieldCategory) {
      populateCategoryField(loadedTx.type, loadedTx.category || '');
    }
    if (loadedTx && els.fieldCourierPayment) {
      populateCourierPaymentSelect(loadedTx.data?.courier_name || loadedTx.supplier || loadedTx.client || '');
      setCourierBreakdownInputs(loadedTx.data?.courier_breakdown || { cash: loadedTx.amount || 0 });
      simpleSplitRows = loadSimpleSplitRowsFromExtraPostings(loadedTx.data?.extra_income_postings);
    } else {
      populateCourierPaymentSelect();
      setCourierBreakdownInputs({});
    }
    await syncSalaryEmployeeUI({ preserveValue: loadedTx?.data?.hr_employee_id || '' });

    await loadFxRates();

    if (loadedTx?.type === 'transfer') applyLoadedTransferTx(loadedTx);
    else if (loadedTx) {
      const amtEl = document.getElementById('kassa-field-amount');
      if (amtEl && AM)
        AM.setInputFromNumber(
          amtEl,
          Number(loadedTx.amount) || 0,
          AM.decimalsForCurrency(loadedTx.currency || 'USD'),
        );
    }

    updateEditorHints();
    syncSimpleSplitAvailability();
    els.dialog.showModal();
  }

  function closeEditor() {
    if (!els.dialog) return;
    els.dialog.classList.add('is-closing');
    els.dialog.addEventListener('animationend', function handler() {
      els.dialog.classList.remove('is-closing');
      els.dialog.removeEventListener('animationend', handler);
      els.dialog.close();
    }, { once: true });
  }

  async function openTransferDraftFromTx(tx) {
    if (!tx) return;
    closeTransferQueue();
    await openEditor();

    const idEl = document.getElementById('kassa-field-id');
    const typeEl = document.getElementById('kassa-field-type');
    const titleEl = document.getElementById('kassa-editor-title');
    if (idEl) idEl.value = '';
    if (typeEl) typeEl.value = 'transfer';
    if (titleEl) titleEl.textContent = 'Повторное перемещение';

    const debitCurrency = String(tx.currency || '').toUpperCase();
    const creditCurrency = String(tx.data?.transfer_credit_currency || tx.currency || '').toUpperCase();
    handleTypeChange({
      preserveDebitCurrency: debitCurrency,
      preserveCreditCurrency: creditCurrency,
      preserveCategory: tx.category || '',
    });

    if (els.fieldFromPocket) els.fieldFromPocket.value = tx.from_pocket_id || tx.from_account_id || '';
    if (els.fieldToPocket) els.fieldToPocket.value = tx.to_pocket_id || tx.to_account_id || '';
    if (els.fieldCategory) {
      populateCategoryField('transfer', tx.category || '');
      els.fieldCategory.value = tx.category || '';
      syncCategoryPicker();
    }

    const noteEl = document.getElementById('kassa-field-note');
    const confirmedEl = document.getElementById('kassa-field-confirmed');
    if (noteEl) noteEl.value = tx.note || '';
    if (confirmedEl) confirmedEl.checked = true;

    syncTransferDebitCurrencySelect({ preferCurrency: debitCurrency });
    syncTransferCreditCurrencySelect({ preferCurrency: creditCurrency });
    await loadFxRates();
    applyLoadedTransferTx({
      ...tx,
      type: 'transfer',
      currency: debitCurrency,
      data: {
        ...(tx.data || {}),
        transfer_credit_currency: creditCurrency,
      },
    });
    updateTransferConfirmationWarning();
    updateTransferEditorHints();
  }

  function updateSimpleSplitModelFromDom() {
    if (!els.splitLines) return;
    els.splitLines.querySelectorAll('.kassa-split-block').forEach((line) => {
      const id = line.getAttribute('data-split-id') || '';
      const row = simpleSplitRows.find((x) => x.id === id);
      if (!row) return;
      row.pocketId = line.querySelector('[data-split-pocket]')?.value || '';
      row.currency = String(line.querySelector('[data-split-currency]')?.value || '').toUpperCase();
      row.amount = line.querySelector('[data-split-amount]')?.value || '';
    });
  }

  function simpleLineFromData(data) {
    const type = data.type || 'expense';
    return {
      pocketId: type === 'income' ? data.to_pocket_id : data.from_pocket_id,
      currency: String(data.currency || '').toUpperCase(),
      amount: Number(data.amount),
      primary: true,
    };
  }

  function collectSimpleSplitLines(data) {
    updateSimpleSplitModelFromDom();
    const type = data.type || 'expense';
    const lines = [simpleLineFromData(data)];
    for (const row of simpleSplitRows) {
      const amount = AM ? AM.parseAmount(row.amount) : numGrouped(row.amount);
      lines.push({
        pocketId: row.pocketId,
        currency: String(row.currency || '').toUpperCase(),
        amount,
        primary: false,
      });
    }

    const seen = new Set();
    for (const line of lines) {
      if (!line.pocketId) return { error: i18n('kassa.split.err.account', 'Выберите счёт во всех строках.') };
      if (!line.currency) return { error: i18n('kassa.split.err.currency', 'Выберите валюту во всех строках.') };
      if (!Number.isFinite(line.amount) || line.amount <= 0)
        return { error: i18n('kassa.split.err.amount', 'Укажите сумму во всех строках.') };
      const key = `${line.pocketId}::${line.currency}`;
      if (seen.has(key))
        return { error: i18n('kassa.split.err.duplicate', 'Один и тот же счёт с одной валютой нельзя добавить два раза.') };
      seen.add(key);
      if (type === 'expense') {
        const balErr = validateExpenseOrTransferBalance({
          type: 'expense',
          from_pocket_id: line.pocketId,
          currency: line.currency,
          amount: line.amount,
        });
        if (balErr) return { error: balErr };
      }
    }
    return { lines };
  }

  function buildSimpleTransactionPayload(data, baseData, line) {
    const payload = {
      ...data,
      data: { ...baseData },
      currency: line.currency,
      amount: line.amount,
    };
    if (payload.type === 'income') {
      payload.to_pocket_id = line.pocketId;
      payload.from_pocket_id = '';
    } else {
      payload.from_pocket_id = line.pocketId;
      payload.to_pocket_id = '';
    }
    delete payload.id;
    return payload;
  }

  function closeSmsMenu() {
    if (els.smsMenu) els.smsMenu.hidden = true;
    if (els.smsToggle) els.smsToggle.setAttribute('aria-expanded', 'false');
  }

  function toggleSmsMenu() {
    if (!els.smsMenu || !els.smsToggle) return;
    const willOpen = els.smsMenu.hidden;
    if (willOpen && els.smsDate && !els.smsDate.value) {
      els.smsDate.value = defaultSmsReportDate();
    }
    els.smsMenu.hidden = !willOpen;
    els.smsToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  async function sendSmsReport(kind, label) {
    const date = defaultSmsReportDate();
    if (!date) {
      setStatus('Выберите дату отчёта', 'err');
      return;
    }
    if (els.smsDate) els.smsDate.value = date;
    setStatus(`Отправка смс отчёта: ${label}...`, null);
    try {
      const res = await fetchApiCsrf('POST', '/api/kassa/sms-report', {
        kind,
        date,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        throw new Error(apiErrorMessage(payload.error) || payload.error || 'Не удалось отправить смс отчёт');
      }
      closeSmsMenu();
      const sent = Number(payload.sent || 0);
      setStatus(sent > 0 ? `Смс отчёт отправлен: ${sent}` : 'Смс отчёт обработан', 'ok');
      setTimeout(() => setStatus(''), 2400);
    } catch (err) {
      setStatus(err.message || 'Не удалось отправить смс отчёт', 'err');
    }
  }

  function sendSmsDailyCourierReport() {
    return sendSmsReport('daily_couriers', 'доходы/расходы + доставщики');
  }

  async function saveTransaction() {
    if (!els.form.checkValidity()) {
      els.form.reportValidity();
      return;
    }

    const formData = new FormData(els.form);
    const data = Object.fromEntries(formData.entries());
    data.is_confirmed = formData.has('is_confirmed');
    data.status = data.is_confirmed ? 'confirmed' : 'draft';
    data.type = els.fieldType?.value || data.type || 'expense';

    if (data.type !== 'transfer') {
      if (AM && els.fieldAmount) data.amount = AM.parseAmount(els.fieldAmount.value);
      else if (els.fieldAmount) {
        const n = numGrouped(els.fieldAmount.value);
        data.amount = Number.isFinite(n) ? n : 0;
      }
    }

    const txId = data.id;
    const prevTx = txId ? transactions.find((x) => x.id === txId) : null;

    const baseData = {
      author: document.body?.dataset?.userName || '',
      asset: prevTx?.data?.asset ?? '',
      supplier_balance: prevTx?.data?.supplier_balance ?? '',
      hr_employee_id: '',
      hr_employee_name: '',
      hr_employee_position: '',
      salary_payment: false,
    };

    if (data.type === 'transfer') {
      const terr = validateTransferCreditFields();
      if (terr) {
        setStatus(terr, 'err');
        return;
      }
      const dc = (document.getElementById('kassa-field-debit-currency')?.value || '').trim().toUpperCase();
      const cc = (document.getElementById('kassa-field-credit-currency')?.value || '').trim().toUpperCase();
      const da = numGrouped(document.getElementById('kassa-field-debit-amount')?.value);
      const ca = numGrouped(document.getElementById('kassa-field-credit-amount')?.value);
      const rv = numGrouped(document.getElementById('kassa-field-transfer-rate')?.value);
      data.currency = dc;
      data.amount = da;
      data.data = {
        ...baseData,
        transfer_kind: document.querySelector('input[name="transfer_kind"]:checked')?.value || 'transfer',
        transfer_credit_currency: cc,
        transfer_credit_amount: ca,
        transfer_cross_currency: dc !== cc,
      };
      if (dc !== cc && Number.isFinite(rv) && rv > 0)
        data.data.transfer_debit_per_credit = rv;

      const commEl = document.getElementById('kassa-field-transfer-commission');
      let commVal = NaN;
      if (AM && commEl) commVal = AM.parseAmount(commEl.value);
      else if (commEl) commVal = numGrouped(commEl.value);
      if (Number.isFinite(commVal) && commVal > 0) {
        data.data.transfer_commission_amount = commVal;
        data.data.transfer_commission_currency = dc;
      } else {
        data.data.transfer_commission_amount = null;
        data.data.transfer_commission_currency = null;
      }
    } else {
      if (isCourierPaymentMode()) {
        const courierName = String(els.fieldCourierPayment?.value || '').trim();
        if (!courierName) {
          setStatus('Выберите доставщика для оплаты от доставщиков', 'err');
          return;
        }
        const breakdown = courierBreakdownFromDom();
        const enteredMainAmount = Number(data.amount) || 0;
        if (breakdown.cash <= 0 && enteredMainAmount > 0) breakdown.cash = enteredMainAmount;
        else if (enteredMainAmount <= 0 && breakdown.cash > 0) data.amount = breakdown.cash;
        baseData.courier_payment = true;
        baseData.courier_balance_posting = true;
        baseData.courier_name = courierName;
        baseData.courier_breakdown = breakdown;
        baseData.extra_income_postings = [];
        data.supplier = courierName;
        data.client = courierName;
      }
      if (isSalaryPaymentMode()) {
        const employeeId = String(els.fieldSalaryEmployee?.value || '').trim();
        const employee = salaryEmployeeById(employeeId);
        if (!employeeId) {
          setStatus('Выберите сотрудника для зарплаты', 'err');
          return;
        }
        baseData.hr_employee_id = employeeId;
        baseData.hr_employee_name = String(employee?.name || '').trim();
        baseData.hr_employee_position = String(employee?.position || '').trim();
        baseData.salary_payment = true;
        if (baseData.hr_employee_name) {
          data.supplier = baseData.hr_employee_name;
        }
      }
      delete data.hr_employee_id;
      data.data = { ...baseData };
      if (!data.currency || els.fieldCurrency?.disabled) {
        setStatus(i18n('kassa.err.pick_ccy_op', 'Выберите счёт и валюту операции.'), 'err');
        return;
      }
    }

    let batchPayloads = null;
    if (data.type !== 'transfer' && simpleSplitRows.length && isCourierPaymentMode()) {
      const batch = collectSimpleSplitLines(data);
      if (batch.error) {
        setStatus(batch.error, 'err');
        return;
      }
      const extraLines = batch.lines
        .filter((line) => !line.primary)
        .map((line) => ({
          account_id: line.pocketId,
          currency: line.currency,
          amount: line.amount,
        }));
      baseData.extra_income_postings = extraLines;
      data.data = { ...baseData };
      delete data.id;
    } else if (data.type !== 'transfer' && !txId && simpleSplitRows.length) {
      const batch = collectSimpleSplitLines(data);
      if (batch.error) {
        setStatus(batch.error, 'err');
        return;
      }
      batchPayloads = batch.lines.map((line) => buildSimpleTransactionPayload(data, baseData, line));
    } else {
      const balErr = validateExpenseOrTransferBalance(data);
      if (balErr) {
        setStatus(balErr, 'err');
        return;
      }
      delete data.id;
    }

    setStatus(i18n('kassa.status.saving', 'Сохранение...'), null);

    try {
      let savedTx = null;
      if (batchPayloads) {
        for (const payload of batchPayloads) {
          const res = await fetchApiCsrf('POST', '/api/transactions', payload);
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(apiErrorMessage(err.error));
          }
        }
      } else {
        const url = txId ? `/api/transactions/${encodeURIComponent(txId)}` : '/api/transactions';
        const method = txId ? 'PUT' : 'POST';

        const res = await fetchApiCsrf(method, url, data);

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(apiErrorMessage(err.error));
        }
        const okData = await res.json().catch(() => ({}));
        savedTx = okData.transaction || null;
      }

      const pendingMsg = 'Перевод отправлен и ожидает подтверждения';
      setStatus(savedTx?.status === 'pending' ? pendingMsg : i18n('kassa.status.saved', 'Сохранено'), 'ok');
      setTimeout(() => setStatus(''), 2000);

      closeEditor();
      await loadData();
      notifyTreasuryUpdated();

    } catch (e) {
      setStatus(e.message || apiErrorMessage(''), 'err');
    }
  }

  async function deleteTransaction(id) {
    if (!confirm(i18n('kassa.confirm.delete_tx', 'Удалить эту операцию?'))) return;

    setStatus(i18n('kassa.status.deleting', 'Удаление...'), null);
    try {
      const res = await fetchApiCsrf(
        'DELETE',
        `/api/transactions/${encodeURIComponent(id)}`,
        null,
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err.error) || i18n('kassa.err.delete', 'Ошибка при удалении'));
      }

      setStatus(i18n('kassa.status.deleted', 'Удалено'), 'ok');
      setTimeout(() => setStatus(''), 2000);

      await loadData();
      notifyTreasuryUpdated();
    } catch (e) {
      setStatus(e.message || i18n('kassa.err.delete', 'Ошибка при удалении'), 'err');
    }
  }

  async function changeTransactionStatus(id, status) {
    const labels = {
      confirmed: 'Подтверждено',
      pending: 'Ожидание',
      draft: 'Черновик',
      rejected: 'Отклонено',
    };
    const targetLabel = labels[status] || status;
    const question = `Изменить статус операции на "${targetLabel}"? Баланс будет пересчитан.`;
    if (!confirm(question)) return;

    setStatus('Изменение статуса...', null);
    try {
      const res = await fetchApiCsrf(
        'PATCH',
        `/api/transactions/${encodeURIComponent(id)}/status`,
        { status },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(err.error) || 'Не удалось изменить статус');
      }

      setStatus(`Статус изменён: ${targetLabel}`, 'ok');
      setTimeout(() => setStatus(''), 2000);

      await loadData();
      notifyTreasuryUpdated();
      return true;
    } catch (e) {
      setStatus(e.message || 'Не удалось изменить статус', 'err');
      return false;
    }
  }

  function applyInitialFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    const initialType = (params.get('type') || '').trim().toLowerCase();
    const initialStatus = (params.get('status') || '').trim().toLowerCase();
    const initialCurrencies = uniqueFilterValues((params.get('currency') || params.get('ccy') || '').split(','))
      .map(normalizeCurrencyCode)
      .filter(Boolean);
    const initialSearch = (params.get('search') || params.get('q') || '').trim();
    let changed = false;
    if (['income', 'expense', 'transfer'].includes(initialType)) {
      setFilterValues('type', [initialType]);
      syncMultiFilterState('type');
      changed = true;
    }
    if (['confirmed', 'pending', 'draft', 'rejected'].includes(initialStatus)) {
      setFilterValues('status', [initialStatus]);
      syncMultiFilterState('status');
      changed = true;
    }
    if (initialCurrencies.length) {
      setFilterValues('currency', initialCurrencies);
      syncMultiFilterState('currency');
      changed = true;
    }
    if (initialSearch) {
      currentFilter.search = initialSearch;
      if (els.fSearch) els.fSearch.value = initialSearch;
      changed = true;
    }
    if (!changed) return;
    pageIndex = 0;
    invalidateFilteredCache();
  }

  function bindEvents() {
    window.addEventListener('upos:treasury-updated', () => {
      void fetchTreasuryAndCategories();
    });
    window.addEventListener('resize', scheduleColumnLayout);

    if (els.dialog) {
      els.dialog.addEventListener('focusin', (ev) => {
        const t = ev.target;
        if (t.id === 'kassa-field-amount' || t.id === 'kassa-field-debit-amount' || t.id === 'kassa-field-credit-amount' || t.matches?.('[data-split-amount]')) {
          if (t.value.trim() === '0') t.value = '';
        }
      }, true);
    }

    if (els.btnCreate) els.btnCreate.addEventListener('click', () => openEditor());
    if (els.btnClose) els.btnClose.addEventListener('click', closeEditor);
    if (els.btnCancel) els.btnCancel.addEventListener('click', closeEditor);
    if (els.btnSave) els.btnSave.addEventListener('click', saveTransaction);
    if (els.smsToggle && els.smsMenu) {
      const smsWrap = els.smsToggle.closest('.kassa-sms-menu-wrap');
      els.smsToggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleSmsMenu();
      });
      els.smsMenu.addEventListener('click', (ev) => ev.stopPropagation());
      document.addEventListener('click', (ev) => {
        if (els.smsMenu.hidden) return;
        if (smsWrap?.contains(ev.target)) return;
        closeSmsMenu();
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && !els.smsMenu.hidden) closeSmsMenu();
      });
    }
    if (els.smsDailyCouriers) {
      els.smsDailyCouriers.addEventListener('click', () => {
        void sendSmsDailyCourierReport();
      });
    }
    if (els.smsDailyExpenses) {
      els.smsDailyExpenses.addEventListener('click', () => {
        void sendSmsReport('daily_expenses', 'расходы');
      });
    }
    if (els.smsDailyTransfers) {
      els.smsDailyTransfers.addEventListener('click', () => {
        void sendSmsReport('daily_transfers', 'перемещения');
      });
    }
    if (els.smsToday) {
      els.smsToday.addEventListener('click', () => {
        if (els.smsDate) els.smsDate.value = currentWorkspaceDate();
      });
    }
    if (els.transferQueueBtn) {
      els.transferQueueBtn.addEventListener('click', () => {
        void fetchPendingTransfers().then(openTransferQueue);
      });
    }
    if (els.transferQueueClose) els.transferQueueClose.addEventListener('click', closeTransferQueue);
    if (els.transferQueueRefresh) {
      els.transferQueueRefresh.addEventListener('click', () => {
        void fetchPendingTransfers();
      });
    }
    els.summaryCurrency?.addEventListener('change', () => {
      summaryCurrency = (els.summaryCurrency.value || 'UZS').trim().toUpperCase();
      localStorage.setItem(SUMMARY_CURRENCY_KEY, summaryCurrency);
      updateSummary();
    });
    els.transferQueueBody?.addEventListener('click', (ev) => {
      const confirmBtn = ev.target.closest('[data-transfer-queue-confirm]');
      const rejectBtn = ev.target.closest('[data-transfer-queue-reject]');
      const resendBtn = ev.target.closest('[data-transfer-queue-resend]');
      const btn = confirmBtn || rejectBtn || resendBtn;
      if (!btn) return;
      const row = btn.closest('[data-transfer-queue-id]');
      const id = row?.getAttribute('data-transfer-queue-id') || '';
      if (!id) return;
      if (confirmBtn) {
        const targetId = row?.querySelector('[data-transfer-queue-target]')?.value || '';
        if (!targetId) {
          setStatus('Выберите кассу для зачисления', 'err');
          return;
        }
        void resolveTransfer(id, 'confirm', targetId);
        return;
      }
      if (rejectBtn) {
        void resolveTransfer(id, 'reject');
        return;
      }
      if (resendBtn) {
        const tx = pendingTransfers.find((x) => String(x.id || '') === String(id));
        void openTransferDraftFromTx(tx);
      }
    });
    els.pendingList?.addEventListener('click', (ev) => {
      const confirmBtn = ev.target.closest('[data-transfer-confirm]');
      const rejectBtn = ev.target.closest('[data-transfer-reject]');
      if (confirmBtn) {
        void resolveTransfer(confirmBtn.getAttribute('data-transfer-confirm') || '', 'confirm');
        return;
      }
      if (rejectBtn) {
        void resolveTransfer(rejectBtn.getAttribute('data-transfer-reject') || '', 'reject');
      }
    });
    els.paymentTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (!els.fieldType) return;
        const nextType = tab.getAttribute('data-payment-type') || 'expense';
        if (els.fieldType.value !== nextType) simpleSplitRows = [];
        els.fieldType.value = nextType;
        handleTypeChange();
      });
    });

    els.fieldFromPocket?.addEventListener('change', () => {
      if (isTransferForm()) {
        syncTransferDebitCurrencySelect({ preferCurrency: '' });
        onTransferCurrencySideChanged();
        updateTransferConfirmationWarning();
      } else {
        syncEditorCurrencySelect({ preferCurrency: '' });
        syncSimpleSplitAvailability();
        if (isCourierPaymentMode()) {
          const cashSelect = courierAccountSelect('cash_account_id');
          if (cashSelect && els.fieldToPocket?.value) {
            cashSelect.value = els.fieldToPocket.value;
            saveCourierAccountPrefs();
          }
          updateCourierBreakdownResult();
        }
      }
    });

    els.fieldToPocket?.addEventListener('change', () => {
      if (isTransferForm()) {
        syncTransferCreditCurrencySelect({ preferCurrency: '' });
        onTransferCurrencySideChanged();
        updateTransferConfirmationWarning();
      } else {
        syncEditorCurrencySelect({ preferCurrency: '' });
        syncSimpleSplitAvailability();
      }
    });

    els.fieldCurrency?.addEventListener('change', () => {
      if (els.fieldAmount) {
        const n = AM ? AM.parseAmount(els.fieldAmount.value) : numGrouped(els.fieldAmount.value);
        const ccy = (els.fieldCurrency?.value || 'USD').toUpperCase();
        if (Number.isFinite(n)) applyPlainNumberInput(els.fieldAmount, n, ccy);
      }
      updateEditorHints();
      updateCourierBreakdownResult();
    });
    els.splitAdd?.addEventListener('click', addSimpleSplitRow);
    els.splitLines?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-split-remove]');
      if (!btn) return;
      const line = btn.closest('.kassa-split-block');
      const id = line?.getAttribute('data-split-id') || '';
      simpleSplitRows = simpleSplitRows.filter((row) => row.id !== id);
      renderSimpleSplitRows();
    });
    els.splitLines?.addEventListener('change', (ev) => {
      const line = ev.target.closest('.kassa-split-block');
      if (!line) return;
      const id = line.getAttribute('data-split-id') || '';
      const row = simpleSplitRows.find((x) => x.id === id);
      if (!row) return;
      if (ev.target.matches('[data-split-pocket]')) {
        row.pocketId = ev.target.value || '';
        row.currency = defaultSplitCurrency(row.pocketId);
        row.amount = line.querySelector('[data-split-amount]')?.value || '';
        renderSimpleSplitRows();
      } else if (ev.target.matches('[data-split-currency]')) {
        row.currency = String(ev.target.value || '').toUpperCase();
      }
    });
    els.splitLines?.addEventListener('input', (ev) => {
      if (!ev.target.matches('[data-split-amount]')) return;
      const line = ev.target.closest('.kassa-split-block');
      const id = line?.getAttribute('data-split-id') || '';
      const row = simpleSplitRows.find((x) => x.id === id);
      if (!row) return;
      row.amount = ev.target.value || '';
    });
    els.splitLines?.addEventListener('blur', (ev) => {
      if (!ev.target.matches('[data-split-amount]')) return;
      const line = ev.target.closest('.kassa-split-block');
      const ccy = (line?.querySelector('[data-split-currency]')?.value || 'USD').toUpperCase();
      const n = AM ? AM.parseAmount(ev.target.value) : numGrouped(ev.target.value);
      if (!Number.isFinite(n) || n < 0) return;
      applyPlainNumberInput(ev.target, n, ccy);
      updateSimpleSplitModelFromDom();
    }, true);
    els.fieldCategory?.addEventListener('change', () => {
      syncCategoryPicker();
      syncCourierPaymentUI();
      void syncSalaryEmployeeUI({ preserveValue: els.fieldSalaryEmployee?.value || '' });
    });
    els.fieldCourierPayment?.addEventListener('change', syncCourierPaymentUI);
    els.rowCourierDetails?.addEventListener('focusin', (ev) => {
      const input = ev.target.closest('[data-courier-field]');
      if (!input || input.getAttribute('data-courier-field') === 'expense_type') return;
      const n = AM ? AM.parseAmount(input.value) : numGrouped(input.value);
      if (Number.isFinite(n) && n === 0) input.value = '';
    });
    els.rowCourierDetails?.addEventListener('input', (ev) => {
      const input = ev.target.closest('[data-courier-field]');
      if (!input) return;
      if (input.getAttribute('data-courier-field') !== 'expense_type') {
        const ccy = (els.fieldCurrency?.value || 'UZS').toUpperCase();
        if (AM) AM.formatInputElement(input, AM.decimalsForCurrency(ccy));
        else {
          const n = numGrouped(input.value);
          if (Number.isFinite(n) && n >= 0) applyPlainNumberInput(input, n, ccy);
        }
      }
      updateCourierBreakdownResult(input.getAttribute('data-courier-field') === 'cash');
    });
    els.rowCourierDetails?.addEventListener('change', (ev) => {
      const select = ev.target.closest('[data-courier-account]');
      if (!select) return;
      if (select.getAttribute('data-courier-account') === 'cash_account_id') {
        syncCourierCashAccountToMain();
      }
      saveCourierAccountPrefs();
      updateCourierBreakdownResult();
    });
    els.rowCourierDetails?.addEventListener('blur', (ev) => {
      const input = ev.target.closest('[data-courier-field]');
      if (!input || input.getAttribute('data-courier-field') === 'expense_type') return;
      const ccy = (els.fieldCurrency?.value || 'UZS').toUpperCase();
      const n = AM ? AM.parseAmount(input.value) : numGrouped(input.value);
      if (!Number.isFinite(n) || n < 0) return;
      if (AM) AM.setInputFromNumber(input, n, AM.decimalsForCurrency(ccy));
      else applyPlainNumberInput(input, n, ccy);
      updateCourierBreakdownResult(input.getAttribute('data-courier-field') === 'cash');
    }, true);
    els.fieldSalaryEmployee?.addEventListener('change', updateSalaryEmployeeHint);
    els.salaryEmployeeButton?.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (els.salaryEmployeeMenu?.hidden) openSalaryEmployeeMenu();
      else closeSalaryEmployeeMenu();
    });
    els.salaryPositionButton?.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (els.salaryPositionMenu?.hidden) openSalaryPositionMenu();
      else closeSalaryPositionMenu();
    });
    els.salaryEmployeeOptions?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-salary-employee-id]');
      if (!btn || !els.fieldSalaryEmployee) return;
      els.fieldSalaryEmployee.value = btn.getAttribute('data-salary-employee-id') || '';
      renderSalaryPickerControls();
      updateSalaryEmployeeHint();
      closeSalaryEmployeeMenu();
    });
    els.fieldSalaryEmployeeSearch?.addEventListener('input', () => {
      populateSalaryEmployeeSelect(els.fieldSalaryEmployee?.value || '');
    });
    els.fieldSalaryEmployeeClear?.addEventListener('click', () => {
      if (els.fieldSalaryEmployeeSearch) {
        els.fieldSalaryEmployeeSearch.value = '';
        els.fieldSalaryEmployeeSearch.focus();
      }
      populateSalaryEmployeeSelect(els.fieldSalaryEmployee?.value || '');
    });
    els.salaryPositionSearch?.addEventListener('input', renderSalaryPositionFilter);
    els.salaryPositionOptions?.addEventListener('change', (ev) => {
      const all = ev.target.closest('[data-salary-position-all]');
      const option = ev.target.closest('[data-salary-position-option]');
      const positions = salaryEmployeePositions();
      if (all) {
        salaryPositionFilter = new Set();
      } else if (option) {
        const current = salaryPositionFilter.size ? new Set(salaryPositionFilter) : new Set(positions);
        const value = String(option.value || '').trim();
        if (value) {
          if (option.checked) current.add(value);
          else current.delete(value);
        }
        salaryPositionFilter = current.size === positions.length ? new Set() : current;
      }
      populateSalaryEmployeeSelect(els.fieldSalaryEmployee?.value || '');
    });
    document.getElementById('kassa-field-date')?.addEventListener('change', () => {
      if (!isSalaryPaymentMode()) return;
      void syncSalaryEmployeeUI({ force: true, preserveValue: els.fieldSalaryEmployee?.value || '' });
    });
    els.fieldAmount?.addEventListener('input', formatSimpleAmountOnInput);
    els.fieldAmount?.addEventListener('blur', () => {
      if (!els.fieldAmount || els.fieldAmount.disabled) return;
      const ccy = (els.fieldCurrency?.value || 'USD').toUpperCase();
      const n = AM ? AM.parseAmount(els.fieldAmount.value) : numGrouped(els.fieldAmount.value);
      if (!Number.isFinite(n) || n < 0) return;
      applyPlainNumberInput(els.fieldAmount, n, ccy);
    });

    document.getElementById('kassa-field-debit-amount')?.addEventListener('blur', () => {
      const el = document.getElementById('kassa-field-debit-amount');
      const dc = (document.getElementById('kassa-field-debit-currency')?.value || 'USD').toUpperCase();
      const n = numGrouped(el?.value);
      if (!el || el.disabled || !Number.isFinite(n)) return;
      applyPlainNumberInput(el, n, dc);
    });
    document.getElementById('kassa-field-credit-amount')?.addEventListener('blur', () => {
      const el = document.getElementById('kassa-field-credit-amount');
      const cc = (document.getElementById('kassa-field-credit-currency')?.value || 'USD').toUpperCase();
      const n = numGrouped(el?.value);
      if (!el || el.disabled || !Number.isFinite(n)) return;
      applyPlainNumberInput(el, n, cc);
    });

    document.getElementById('kassa-field-debit-currency')?.addEventListener('change', () => {
      onTransferCurrencySideChanged();
    });
    document.getElementById('kassa-field-credit-currency')?.addEventListener('change', () => {
      onTransferCurrencySideChanged();
    });
    document.getElementById('kassa-field-debit-amount')?.addEventListener('input', onTransferDebitAmountInput);
    document.getElementById('kassa-field-credit-amount')?.addEventListener('input', onTransferCreditAmountInput);
    document.getElementById('kassa-field-transfer-rate')?.addEventListener('input', onTransferRateInput);
    document.getElementById('kassa-field-transfer-commission')?.addEventListener('input', () => {
      formatCommissionTransferInput(true);
    });

    const updateFilters = () => {
      currentFilter = {
        search: els.fSearch?.value || '',
        category: filterValues('category'),
        dateStart: els.fDateStart?.value || '',
        dateEnd: els.fDateEnd?.value || '',
        type: filterValues('type'),
        supplier: filterValues('supplier'),
        pocket: filterValues('pocket'),
        currency: filterValues('currency'),
        status: filterValues('status'),
      };
      pageIndex = 0;
      invalidateFilteredCache();
      renderTable();
    };

    function initDateRangeFilter() {
      if (!els.fDateRange || !window.UPOS_DATE_RANGE) return;
      const syncPicker = window.UPOS_DATE_RANGE.create(els.fDateRange, {
        preset: 'custom',
        date_from: els.fDateStart?.value || '',
        date_to: els.fDateEnd?.value || '',
        hideSummary: true,
        onApply: (range) => {
          if (els.fDateStart) els.fDateStart.value = range.date_from || '';
          if (els.fDateEnd) els.fDateEnd.value = range.date_to || range.date_from || '';
          syncPicker.setValue({
            preset: range.preset || 'custom',
            date_from: els.fDateStart?.value || '',
            date_to: els.fDateEnd?.value || '',
            label: range.label || '',
          });
          updateFilters();
        },
      });
    }

    ['fSearch'].forEach(k => {
      if (els[k]) els[k].addEventListener('input', updateFilters);
    });
    initDateRangeFilter();

    els.root?.addEventListener('click', (ev) => {
      const button = ev.target.closest('[data-multi-filter-button]');
      if (button) {
        ev.preventDefault();
        const root = button.closest('[data-kassa-multi-filter]');
        toggleMultiFilter(root?.dataset.kassaMultiFilter || '');
        return;
      }

      const clear = ev.target.closest('[data-multi-filter-clear]');
      if (clear) {
        ev.preventDefault();
        const root = clear.closest('[data-kassa-multi-filter]');
        const key = root?.dataset.kassaMultiFilter || '';
        setFilterValues(key, []);
        if (key === 'type') populateCategoryFilter([]);
        syncMultiFilterState(key);
        updateFilters();
      }
    });

    els.root?.addEventListener('change', (ev) => {
      const input = ev.target.closest('[data-multi-filter-option]');
      if (!input) return;
      const root = input.closest('[data-kassa-multi-filter]');
      const key = root?.dataset.kassaMultiFilter || '';
      const values = new Set(filterValues(key));
      const value = String(input.value || '').trim();
      if (!value) return;
      if (input.checked) values.add(value);
      else values.delete(value);
      setFilterValues(key, [...values]);
      if (key === 'type') populateCategoryFilter(filterValues('type'));
      syncMultiFilterState(key);
      updateFilters();
    });

    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-kassa-multi-filter]')) closeAllMultiFilters();
      if (!ev.target.closest('#kassa-row-salary-employee')) {
        closeSalaryEmployeeMenu();
        closeSalaryPositionMenu();
      }
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeAllMultiFilters();
      if (ev.key === 'Escape') {
        closeSalaryEmployeeMenu();
        closeSalaryPositionMenu();
      }
    });

    if (els.pageSizeSelect) {
      els.pageSizeSelect.addEventListener('change', () => {
        const val = els.pageSizeSelect.value;
        const filtered = getFilteredRows();
        if (val === 'all' && filtered.length > MAX_DOM_ROWS) {
          els.pageSizeSelect.value = String(pageSize);
          setStatus(
            i18n('kassa.page_size.all_blocked', 'Слишком много строк — уточните фильтр'),
            'err',
          );
          return;
        }
        pageSize = val === 'all' ? 'all' : Number(val) || 10;
        pageIndex = 0;
        savePageSizePrefs();
        setStatus('', null);
        renderTable();
      });
    }

    if (els.pagePrev) {
      els.pagePrev.addEventListener('click', () => {
        if (pageIndex > 0) {
          pageIndex -= 1;
          renderTable();
        }
      });
    }

    if (els.pageNext) {
      els.pageNext.addEventListener('click', () => {
        pageIndex += 1;
        renderTable();
      });
    }

    if (els.tableBody) {
      els.tableBody.addEventListener('change', async (ev) => {
        const sel = ev.target.closest('.kassa-status-select');
        if (!sel) return;
        const id = String(sel.getAttribute('data-status-id') || '').trim();
        const prev = String(sel.getAttribute('data-current-status') || '').trim();
        const next = String(sel.value || '').trim();
        if (!id || !next || next === prev) return;
        sel.disabled = true;
        const ok = await changeTransactionStatus(id, next);
        if (!ok) {
          sel.value = prev;
          sel.disabled = false;
        }
      });

      els.tableBody.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.kassa-action-btn');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        if (btn.classList.contains('edit')) {
          openEditor(id);
        } else if (btn.classList.contains('draft')) {
          changeTransactionStatus(id, 'draft');
        } else if (btn.classList.contains('confirm')) {
          changeTransactionStatus(id, 'confirmed');
        } else if (btn.classList.contains('delete')) {
          deleteTransaction(id);
        }
      });
    }

    if (els.table) {
      els.table.addEventListener('pointerdown', beginColumnResize);

      els.table.addEventListener('keydown', (ev) => {
        const handle = ev.target.closest('[data-col-resize]');
        if (!handle) return;
        const key = handle.getAttribute('data-col-resize') || '';
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault();
          const dir = ev.key === 'ArrowRight' ? 1 : -1;
          nudgeColumnWidth(key, dir * (ev.shiftKey ? 32 : 12));
        }
      });

      els.table.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-col-resize]')) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        const sortBtn = ev.target.closest('[data-col-sort]');
        if (sortBtn && !ev.target.closest('input')) {
          ev.preventDefault();
          ev.stopPropagation();
          toggleColumnSort(sortBtn.getAttribute('data-col-sort') || '');
        }
      });

      els.table.addEventListener('dragstart', (ev) => {
        if (resizingColumn || ev.target.closest('[data-col-resize]')) {
          ev.preventDefault();
          return;
        }
        const th = ev.target.closest('th[draggable="true"]');
        if (!th) return;
        draggingColumn = th.getAttribute('data-col') || '';
        th.classList.add('is-dragging');
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', draggingColumn);
      });

      els.table.addEventListener('dragover', (ev) => {
        const th = ev.target.closest('th[draggable="true"]');
        if (!th || !draggingColumn) return;
        ev.preventDefault();
        th.classList.add('is-drop-target');
      });

      els.table.addEventListener('dragleave', (ev) => {
        const th = ev.target.closest('th[draggable="true"]');
        if (th) th.classList.remove('is-drop-target');
      });

      els.table.addEventListener('drop', (ev) => {
        const th = ev.target.closest('th[draggable="true"]');
        if (!th || !draggingColumn) return;
        ev.preventDefault();
        reorderColumn(draggingColumn, th.getAttribute('data-col') || '');
        draggingColumn = '';
        els.table.querySelectorAll('th').forEach((x) => x.classList.remove('is-dragging', 'is-drop-target'));
      });

      els.table.addEventListener('dragend', () => {
        draggingColumn = '';
        els.table.querySelectorAll('th').forEach((x) => x.classList.remove('is-dragging', 'is-drop-target'));
      });
    }

    if (els.columnsToggle && els.columnsMenu && els.table) {
      const columnsWrap = els.columnsToggle.closest('.kassa-columns-menu-wrap');

      els.columnsToggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleColumnsMenu();
      });

      els.columnsMenu.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.target.closest('[data-columns-show-all]')) {
          showAllColumns();
          return;
        }
        if (ev.target.closest('[data-columns-reset]')) {
          resetColumnsVisibility();
          return;
        }
        const checkbox = ev.target.closest('[data-column-toggle]');
        if (!checkbox) return;
        const col = checkbox.getAttribute('data-column-toggle');
        if (!col || !TOGGLEABLE_COLUMNS.includes(col)) return;
        if (checkbox.checked) columnHidden.delete(col);
        else columnHidden.add(col);
        saveColumnVisibility();
        rerenderColumns();
        if (els.columnTemplateSelect) els.columnTemplateSelect.value = '';
      });

      document.addEventListener('click', (ev) => {
        if (els.columnsMenu.hidden) return;
        if (columnsWrap?.contains(ev.target)) return;
        closeColumnsMenu();
      });

      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && !els.columnsMenu.hidden) closeColumnsMenu();
      });
    }

    if (els.columnTemplateSelect) {
      els.columnTemplateSelect.addEventListener('change', () => {
        const id = els.columnTemplateSelect.value;
        applyColumnTemplate(id);
        if (els.columnTemplateDelete) els.columnTemplateDelete.disabled = !id;
      });
    }

    if (els.columnTemplateSave) {
      els.columnTemplateSave.addEventListener('click', saveCurrentColumnTemplate);
    }

    if (els.columnTemplateDelete) {
      els.columnTemplateDelete.addEventListener('click', deleteSelectedColumnTemplate);
    }

    const btnExport = document.getElementById('kassa-export');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const filtered = sortRows(applyFilters());
        if (!filtered.length) return alert(i18n('kassa.export.empty', 'Нет данных для экспорта'));

        const headers = [
          'ID',
          i18n('kassa.export.number', 'Номер'),
          i18n('kassa.export.amount_transfer', 'Сумма / перевод'),
          i18n('kassa.export.debit_ccy', 'Валюта списания'),
          i18n('kassa.export.credit_ccy', 'Валюта зачисления'),
          i18n('kassa.export.date', 'Дата'),
          i18n('kassa.col.client', 'Клиент'),
          i18n('kassa.col.employee', 'Сотрудник'),
          i18n('kassa.col.from', 'Из кошелька'),
          i18n('kassa.col.to', 'В кошелек'),
          i18n('kassa.col.type', 'Тип'),
          i18n('kassa.export.status', 'Статус'),
          i18n('kassa.col.category', 'Категория'),
          i18n('kassa.col.branch', 'Филиал'),
          i18n('kassa.col.supplier', 'Поставщик'),
          i18n('kassa.col.note', 'Примечание'),
          i18n('kassa.export.commission', 'Комиссия (перевод)'),
        ];
        const rows = filtered.map(tx => {
          const cc = tx.type === 'transfer' ? String(tx.data?.transfer_credit_currency || tx.currency || '') : '';
          const commission =
            tx.type === 'transfer' && tx.data && Number(tx.data.transfer_commission_amount) > 0
              ? `${tx.data.transfer_commission_amount} ${(tx.data.transfer_commission_currency || tx.currency || '').toString()}`
              : '';
          return [
            tx.id,
            tx.number,
            formatTransferAmountSummary(tx),
            tx.currency,
            cc,
            formatDate(tx.created_at),
            tx.client,
            txEmployeeText(tx),
            getPocketName(tx.from_pocket_id),
            getPocketName(tx.to_pocket_id),
            tx.type,
            txStatusLabel(tx),
            tx.category,
            tx.branch,
            tx.supplier,
            tx.note,
            commission,
          ];
        });

        const blob = buildTransactionsXlsx(headers, rows);
        downloadBlob(blob, 'kassa-transactions.xlsx');
      });
    }
  }

  async function init() {
    loadColumnPrefs();
    loadColumnVisibility();
    loadColumnWidths();
    loadColumnTemplates();
    loadPageSizePrefs();
    buildColumnToggleMenu();
    applyColumnVisibility();
    renderColumnTemplateSelect();
    renderTableHeader();
    bindEvents();
    applyInitialFiltersFromUrl();
    toggleMoneyPanels(false);
    await loadFxRates();
    await loadData();
  }

  init();
})();
