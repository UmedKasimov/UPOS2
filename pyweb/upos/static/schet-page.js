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

  const CHART_PALETTE = [
    '#2d6cdf',
    '#5eb8ff',
    '#22c55e',
    '#f59e0b',
    '#a855f7',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#6366f1',
    '#84cc16',
  ];

  const PRESET_CCY = [
    'UZS',
    'USD',
    'EUR',
    'RUB',
    'KZT',
    'GBP',
    'CNY',
    'AED',
    'TRY',
    'CHF',
    'JPY',
    'KRW',
  ];

  const csrf =
    document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
    '';

  let templates = [];
  let employees = [];
  let enabledCurrencies = [...PRESET_CCY];
  let state = { display_currency: 'USD', pockets: [] };
  let movement = { accounts: {}, total: { currencies: [], count: 0 } };
  let movementPeriod = { preset: 'today', date_from: '', date_to: '', label: '' };
  let movementDatePicker = null;
  let activeDetailPocketId = '';
  let activeDetailCurrency = '';
  let activeDetailTransactions = [];
  const DETAIL_HISTORY_LIMIT = 10;
  let detailFilter = { preset: 'latest', date_from: '', date_to: '', open: false };
  let pocketDraft = null;
  let editorDirty = false;
  let editorFocusPocketId = null;
  let editorSurfaceBound = false;
  /** @type {'pick'|'edit'} */
  let editorStep = 'pick';
  let editorSelectedId = null;
  let rates = { USD: 1 };
  let ratesMeta = { as_of: null, stale: true };
  let chartPocket = null;
  let chartCcy = null;
  let pocketChartType = 'doughnut';

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function parseBootstrap() {
    const el = document.getElementById('schet-bootstrap-json');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || 'null');
    } catch {
      return null;
    }
  }

  function newId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function uamt() {
    return window.UPOS_AMOUNT || null;
  }

  const NO_MINOR_DISPLAY_CCY = new Set(['UZS', 'RUB', 'KZT', 'IDR', 'VND', 'UGX', 'JPY', 'KRW']);

  function decimalsForSchetDisplay(currency) {
    return 0;
  }

  function roundForDecimals(value, decimals) {
    const n = Number(value || 0);
    const d = Math.max(0, Math.floor(Number(decimals) || 0));
    const mult = d === 0 ? 1 : 10 ** d;
    return Math.round(n * mult) / mult;
  }

  function persistApiError(d, fallback) {
    const fb = fallback || '';
    if (!d || typeof d !== 'object') return fb;
    if (typeof d.error === 'string' && d.error.trim()) return d.error.trim();
    if (typeof d.detail === 'string' && d.detail.trim()) return d.detail.trim();
    if (Array.isArray(d.detail) && d.detail.length > 0) {
      const x = d.detail[0];
      if (typeof x === 'string') return x;
      if (x && typeof x.msg === 'string') return String(x.msg);
    }
    return fb;
  }

  function formatNumberGroupedHtml(raw, maxDecimals) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { html: '—', plain: '—' };
    const neg = n < 0;
    const abs = Math.abs(n);
    const mult = maxDecimals === 0 ? 1 : 10 ** maxDecimals;
    const num =
      maxDecimals === 0
        ? Math.round(abs)
        : Math.round(abs * mult) / mult;
    let s = String(num);
    const [intPart, decPartRaw] = s.split('.');
    const groups = [];
    let idx = intPart.length;
    while (idx > 0) {
      groups.unshift(intPart.slice(Math.max(0, idx - 3), idx));
      idx -= 3;
    }
    const joinInner = groups
      .map((g) => `<span class="schet-num-grp">${g}</span>`)
      .join('');
    let inner = `<span class="schet-num-join">${joinInner}`;
    if (decPartRaw !== undefined && maxDecimals > 0) {
      const d = (decPartRaw + '000').slice(0, maxDecimals);
      inner += `<span class="schet-num-dec"><span class="schet-num-dot">,</span>${d}</span>`;
    }
    inner += '</span>';
    const html = neg ? `<span class="schet-num-neg">−</span>${inner}` : inner;
    const decPlain =
      decPartRaw !== undefined && maxDecimals > 0
        ? `,${(decPartRaw + '000').slice(0, maxDecimals)}`
        : '';
    const plain = `${neg ? '−' : ''}${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${decPlain}`;
    return { html, plain };
  }

  function verbalMagnitudeRU(intVal) {
    const x = Math.floor(Math.abs(Number(intVal)));
    if (!Number.isFinite(x) || x === 0) return '0';
    let rest = x;
    const b = Math.floor(rest / 1_000_000_000);
    rest %= 1_000_000_000;
    const m = Math.floor(rest / 1_000_000);
    rest %= 1_000_000;
    const t = Math.floor(rest / 1_000);
    rest %= 1_000;
    const parts = [];
    if (b) parts.push(`${b}\u202f${i18n('schet.compact.billion', 'млрд')}`);
    if (m) parts.push(`${m}\u202f${i18n('schet.compact.million', 'млн')}`);
    if (t) parts.push(`${t}\u202f${i18n('schet.compact.thousand', 'тыс')}`);
    if (rest) parts.push(`${rest}`);
    return parts.join('\u202f');
  }

  function formatTotalVerbalCaption(amount, currency) {
    const cc = (currency || '').toUpperCase();
    const n = Number(amount);
    if (!Number.isFinite(n)) return '';
    const abs = Math.abs(n);
    const displayDecimals = decimalsForSchetDisplay(cc);
    const rounded = roundForDecimals(abs, displayDecimals);
    const intCore = verbalMagnitudeRU(Math.floor(rounded));
    const cents = Math.round((rounded - Math.floor(rounded)) * 100);
    let line = intCore;
    if (displayDecimals > 0 && cents > 0) {
      line += `\u202f,\u202f${String(cents).padStart(2, '0')}`;
    }
    return `${line}\u00a0${cc}`;
  }

  function amountInUsd(amount, ccy, rmap) {
    const c = (ccy || '').toUpperCase();
    if (c === 'USD') return amount;
    const rf = rmap[c];
    if (!rf || rf <= 0) return null;
    return amount / rf;
  }

  function usdToAmount(usd, ccy, rmap) {
    const c = (ccy || '').toUpperCase();
    if (c === 'USD') return usd;
    const rt = rmap[c];
    if (!rt || rt <= 0) return null;
    return usd * rt;
  }

  function pocketTotalUsd(pocket, rmap) {
    let s = 0;
    let ok = true;
    for (const e of pocket.entries || []) {
      const u = amountInUsd(Number(e.amount), e.currency, rmap);
      if (u == null) ok = false;
      else s += u;
    }
    return { usd: s, ok };
  }

  function totalUsdAll() {
    let s = 0;
    let ok = true;
    for (const p of state.pockets) {
      const r = pocketTotalUsd(p, rates);
      if (!r.ok) ok = false;
      s += r.usd;
    }
    return { usd: s, ok };
  }

  function collectCurrencies(pockets) {
    const base = enabledCurrencies.length ? enabledCurrencies : PRESET_CCY;
    const s = new Set(base);
    for (const p of pockets || []) {
      for (const e of p.entries || []) {
        s.add((e.currency || 'USD').toUpperCase());
      }
    }
    s.add((state.display_currency || 'USD').toUpperCase());
    const order = [...base];
    const rest = [...s].filter((x) => !order.includes(x)).sort();
    return [...order.filter((x) => s.has(x)), ...rest];
  }

  function currenciesUsedInPocket(pocket, excludeEntryId) {
    const used = new Set();
    const ex = excludeEntryId != null ? String(excludeEntryId).trim() : '';
    for (const e of pocket?.entries || []) {
      if (ex && String(e.id).trim() === ex) continue;
      const c = String(e.currency || '').toUpperCase().trim();
      if (c) used.add(c);
    }
    return used;
  }

  function availableCurrenciesForEntry(pocket, entryId, pockets) {
    const selEntry = (pocket?.entries || []).find((e) => String(e.id).trim() === String(entryId ?? '').trim());
    const sel = (selEntry?.currency || 'USD').toUpperCase();
    const used = currenciesUsedInPocket(pocket, entryId);
    return collectCurrencies(pockets).filter((c) => c === sel || !used.has(c));
  }

  function firstUnusedCurrencyInPocket(pocket) {
    const used = currenciesUsedInPocket(pocket);
    const base = enabledCurrencies.length ? enabledCurrencies : PRESET_CCY;
    for (const c of base) {
      const u = String(c).toUpperCase();
      if (!used.has(u)) return u;
    }
    for (const c of collectCurrencies(pocket ? [pocket] : [])) {
      if (!used.has(c)) return c;
    }
    return null;
  }

  function pocketCanAddCurrency(pocket) {
    return !!firstUnusedCurrencyInPocket(pocket);
  }

  function currencyLabelsHtml(selected, pockets, pocket, entryId) {
    const sel = (selected || 'USD').toUpperCase();
    const list =
      pocket && entryId != null
        ? availableCurrenciesForEntry(pocket, entryId, pockets)
        : collectCurrencies(pockets);
    const M = typeof window !== 'undefined' && window.UPOS_CCY ? window.UPOS_CCY : null;
    return list
      .map((c) => {
        const lab = M && typeof M.optionLabel === 'function' ? M.optionLabel(c) : c;
        return `<option value="${escapeHtml(c)}" ${c === sel ? 'selected' : ''}>${escapeHtml(lab)}</option>`;
      })
      .join('');
  }

  function defaultEnabledCurrency() {
    return enabledCurrencies[0] || 'UZS';
  }

  function tplMeta(templateId) {
    if (templateId == null) return undefined;
    const key = String(templateId).trim();
    if (!key) return undefined;
    return templates.find(
      (x) => String(x != null && x.id != null ? x.id : '').trim() === key,
    );
  }

  function tplBadgeLabel(templateId) {
    const t = tplMeta(templateId);
    return t ? t.title : templateId;
  }

  function employeeNameById(employeeId) {
    const key = String(employeeId || '').trim();
    if (!key) return '';
    const emp = employees.find((x) => String(x?.id || '').trim() === key);
    return emp ? String(emp.name || emp.username || '').trim() : '';
  }

  function pocketOwnerLabel(pocket) {
    const ownerId = String(pocket?.owner_employee_id || '').trim();
    if (!ownerId) return 'Общий счёт';
    return employeeNameById(ownerId) || pocket?.owner_employee_name || 'Сотрудник';
  }

  function ownerBadgeHtml(pocket) {
    const ownerId = String(pocket?.owner_employee_id || '').trim();
    const cls = ownerId ? 'schet-pocket-owner-badge' : 'schet-pocket-owner-badge is-common';
    return `<span class="${cls}">${escapeHtml(pocketOwnerLabel(pocket))}</span>`;
  }

  function accessEmployeesText(pocket) {
    const rows = Array.isArray(pocket?.access_employees) ? pocket.access_employees : [];
    const names = rows.length
      ? rows.map((x) => String(x?.name || x?.username || x?.id || '').trim())
      : (Array.isArray(pocket?.access_employee_names) ? pocket.access_employee_names.map((x) => String(x || '').trim()) : []);
    const clean = [];
    const seen = new Set();
    names.forEach((name) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      clean.push(name);
    });
    return clean.join(', ');
  }

  function accessBadgeHtml(pocket) {
    const text = accessEmployeesText(pocket);
    if (!text) return '';
    return `<span class="schet-pocket-access-badge">Доступ: ${escapeHtml(text)}</span>`;
  }

  function ownerSelectHtml() {
    return '';
  }

  function pocketIconKey(p) {
    if (p.icon) return p.icon;
    const m = tplMeta(p.template_id);
    return (m && m.icon) || 'custom';
  }

  function setStatus(msg, variant) {
    const el = document.getElementById('schet-status');
    if (!el) return;
    el.textContent = msg || '';
    if (variant) el.setAttribute('data-variant', variant);
    else el.removeAttribute('data-variant');
  }

  function notifyTreasuryUpdated() {
    window.dispatchEvent(new CustomEvent('upos:treasury-updated'));
    const bc = new BroadcastChannel('upos:treasury');
    bc.postMessage('updated');
  }

  const bcSchet = new BroadcastChannel('upos:treasury');
  bcSchet.onmessage = () => {
    refreshTreasuryFromServer().then((ok) => {
      if (!ok) return;
      syncMovementControls();
      renderDashboard();
      updateTotalsAndCharts();
    });
  };

  async function loadBootstrap() {
    let b = parseBootstrap();
    if (!b) {
      try {
        const r = await fetch('/api/treasury');
        if (!r.ok) throw new Error('load');
        b = await r.json();
      } catch {
        setStatus(i18n('schet.load_err', 'Не удалось загрузить данные счёта.'), 'err');
        return false;
      }
    }
    templates = Array.isArray(b.templates) ? b.templates : [];
    employees = Array.isArray(b.employees) ? b.employees : [];
    if (b.settings && Array.isArray(b.settings.enabled_currencies)) {
      const clean = b.settings.enabled_currencies
        .map((x) => String(x || '').trim().toUpperCase())
        .filter((x) => /^[A-Z]{3}$/.test(x));
      if (clean.length) enabledCurrencies = clean;
    }
    if (!templates.length) {
      try {
        const r = await fetch('/api/treasury');
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d.templates) && d.templates.length)
            templates = d.templates;
        }
      } catch {
        /* ignore */
      }
    }
    const t = b.treasury || {};
    state = {
      display_currency: (t.display_currency || 'USD').toUpperCase(),
      pockets: Array.isArray(t.pockets) ? t.pockets : [],
    };
    movement = b.movement || movement;
    movementPeriod = b.movement_period || movementPeriod;
    return true;
  }

  function treasuryPeriodUrl() {
    const params = new URLSearchParams();
    const preset = String(movementPeriod.preset || 'today');
    if (preset === 'today' || preset === 'month' || preset === 'all') {
      params.set('period', preset);
    } else {
      params.set('period', 'custom');
      if (movementPeriod.date_from) params.set('date_from', movementPeriod.date_from);
      if (movementPeriod.date_to) params.set('date_to', movementPeriod.date_to);
    }
    return `/api/treasury?${params.toString()}`;
  }

  async function loadRates() {
    try {
      const r = await fetch('/api/fx/rates');
      if (!r.ok) throw new Error('fx');
      const d = await r.json();
      if (d.rates && typeof d.rates === 'object') {
        rates = d.rates;
        ratesMeta = {
          as_of: d.as_of || null,
          stale: !!d.stale,
        };
      }
    } catch {
      /* keep */
    }
    updateFxHint();
  }

  function updateFxHint() {
    const el = document.getElementById('schet-fx-hint');
    if (!el) return;
    if (ratesMeta.as_of) {
      const warn = ratesMeta.stale ? i18n('schet.rates_cache', ' (кэш / запас)') : '';
      el.textContent = `${i18n('schet.rates_to_usd', 'Курсы к USD ·')} ${ratesMeta.as_of}${warn}`;
    } else {
      el.textContent = ratesMeta.stale
        ? i18n('schet.rates_approx', 'Курсы приблизительные — проверьте соединение.')
        : '';
    }
  }

  async function persistToServer(body) {
    setStatus(i18n('schet.saving', 'Сохранение…'), null);
    try {
      const r = await fetch('/api/treasury', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(
          persistApiError(d, '') || `${i18n('schet.save_error', 'Ошибка сохранения')} (${r.status})`,
          'err',
        );
        return false;
      }
      if (d.treasury) {
        state.display_currency =
          d.treasury.display_currency || state.display_currency;
        state.pockets = d.treasury.pockets || state.pockets;
      }
      setStatus(i18n('schet.saved', 'Сохранено'), 'ok');
      window.setTimeout(() => setStatus(''), 2200);
      notifyTreasuryUpdated();
      return true;
    } catch {
      setStatus(i18n('schet.net_err', 'Сеть недоступна'), 'err');
      return false;
    }
  }

  /** Подтянуть остатки с сервера (после операций в Кассе / другой вкладке). */
  async function refreshTreasuryFromServer() {
    if (pocketDraft !== null) return false;
    try {
      const r = await fetch(treasuryPeriodUrl());
      if (!r.ok) return false;
      const d = await r.json();
      const t = d.treasury || {};
      state.display_currency = (t.display_currency || state.display_currency || 'USD').toUpperCase();
      state.pockets = Array.isArray(t.pockets) ? t.pockets : state.pockets;
      movement = d.movement || movement;
      movementPeriod = d.movement_period || movementPeriod;
      if (Array.isArray(d.templates) && d.templates.length) {
        templates = d.templates;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Только валюта пересчёта — без PUT полной казны (иначе затрутся актуальные остатки из Кассы). */
  async function saveDashboardDisplayCcyOnly() {
    const dc = (state.display_currency || 'USD').toUpperCase();
    setStatus(i18n('schet.saving', 'Сохранение…'), null);
    try {
      const r = await fetch('/api/treasury', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify({ display_currency: dc }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(
          persistApiError(d, '') || `${i18n('schet.save_error', 'Ошибка сохранения')} (${r.status})`,
          'err',
        );
        return false;
      }
      if (d.treasury) {
        state.display_currency = (d.treasury.display_currency || dc).toUpperCase();
        state.pockets = d.treasury.pockets || state.pockets;
      }
      if (Array.isArray(d.templates) && d.templates.length) {
        templates = d.templates;
      }
      setStatus(i18n('schet.saved', 'Сохранено'), 'ok');
      window.setTimeout(() => setStatus(''), 2200);
      notifyTreasuryUpdated();
      return true;
    } catch {
      setStatus(i18n('schet.net_err', 'Сеть недоступна'), 'err');
      return false;
    }
  }

  function iconSvg(key) {
    const common =
      'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const icons = {
      cash: `<svg ${common}><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`,
      bank: `<svg ${common}><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/></svg>`,
      building: `<svg ${common}><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/></svg>`,
      card: `<svg ${common}><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`,
      smartphone: `<svg ${common}><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>`,
      globe: `<svg ${common}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z"/></svg>`,
      vault: `<svg ${common}><rect width="18" height="18" x="3" y="3" rx="3"/><circle cx="12" cy="13" r="3"/><path d="M8 3v4M16 3v4M3 8h18"/></svg>`,
      chart: `<svg ${common}><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`,
      crypto: `<svg ${common}><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5"/><path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"/></svg>`,
      handshake: `<svg ${common}><path d="m11 17 2 2a2 2 0 1 0 2-2l-1-1"/><path d="m11 12 2 2 2-2"/><path d="M14 10V8a2 2 0 0 0-2-2H8"/><path d="m4 16 4-4 4 4"/></svg>`,
      custom: `<svg ${common}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    };
    return icons[key] || icons.custom;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function cssEsc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function movementRowMap(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const c = String(row.currency || '').trim().toUpperCase();
      if (!c) continue;
      map.set(c, row);
    }
    return map;
  }

  function formatCurrencyMovementValue(value, currency) {
    const c = (currency || '').toUpperCase();
    const dec = decimalsForSchetDisplay(c);
    const rounded = roundForDecimals(Math.abs(Number(value || 0)), dec);
    const fmt = formatNumberGroupedHtml(rounded, dec);
    const sign = Number(value || 0) > 0 ? '+' : Number(value || 0) < 0 ? '−' : '';
    return `${sign}${fmt.html}<span class="schet-ccy-delta-code">${escapeHtml(c)}</span>`;
  }

  function currencyMovementDeltaHtml(row) {
    if (!row || !Number(row.count || 0)) return '';
    const net = Number(row.net || 0);
    const dec = decimalsForSchetDisplay(row.currency);
    if (Math.abs(roundForDecimals(net, dec)) < (dec === 0 ? 1 : 0.005)) return '';
    const tone = net > 0 ? 'positive' : 'negative';
    return `<span class="schet-ccy-delta schet-ccy-delta--${tone}">${formatCurrencyMovementValue(net, row.currency)}</span>`;
  }

  function txAccountId(raw) {
    return String(raw || '').trim();
  }

  function txTransferCredit(tx) {
    const data = tx && tx.data && typeof tx.data === 'object' ? tx.data : {};
    const baseAmount = Number(tx?.amount || 0);
    const baseCurrency = String(tx?.currency || 'USD').trim().toUpperCase();
    const rawAmount = Number(data.transfer_credit_amount);
    const rawCurrency = String(data.transfer_credit_currency || '').trim().toUpperCase();
    return {
      amount: Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : baseAmount,
      currency: /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : baseCurrency,
    };
  }

  function txCountsInBalance(tx) {
    if (tx?.is_adjustment) return true;
    const status = String(tx?.status || (tx?.is_confirmed ? 'confirmed' : 'draft')).trim().toLowerCase();
    if (status === 'rejected' || status === 'draft') return false;
    if (tx?.is_confirmed) return true;
    return Boolean(tx?.type === 'transfer' && status === 'pending' && tx?.requires_confirmation);
  }

  function txPostingsForPocket(tx, pocketId) {
    const pid = String(pocketId || '').trim();
    if (!pid || !txCountsInBalance(tx)) return [];
    const type = String(tx?.type || '').trim().toLowerCase();
    const amount = Number(tx?.amount || 0);
    const currency = String(tx?.currency || 'USD').trim().toUpperCase();
    if (type === 'adjustment' && String(tx?.account_id || '').trim() === pid) {
      const delta = Number(tx?.delta || 0);
      return Number.isFinite(delta) && delta !== 0
        ? [{ delta, currency, direction: delta >= 0 ? 'in' : 'out' }]
        : [];
    }
    const fromId = txAccountId(tx?.from_account_id || tx?.from_pocket_id);
    const toId = txAccountId(tx?.to_account_id || tx?.to_pocket_id);
    const rows = [];
    if (type === 'income' && toId === pid) {
      rows.push({ delta: amount, currency, direction: 'in' });
    } else if (type === 'expense' && fromId === pid) {
      rows.push({ delta: -amount, currency, direction: 'out' });
    } else if (type === 'transfer') {
      const status = String(tx?.status || '').trim().toLowerCase();
      const pendingTransfer = status === 'pending' && tx?.requires_confirmation;
      if (fromId === pid) rows.push({ delta: -amount, currency, direction: 'out' });
      if (toId === pid && !pendingTransfer) {
        const credit = txTransferCredit(tx);
        rows.push({ delta: credit.amount, currency: credit.currency, direction: 'in' });
      }
    }
    return rows.filter((row) => row.currency && Number.isFinite(row.delta) && row.delta !== 0);
  }

  function txDetailTitle(tx, direction) {
    const type = String(tx?.type || '').trim().toLowerCase();
    const number = tx?.number ? ` #${tx.number}` : '';
    const cat = String(tx?.category || '').trim();
    const supplier = String(tx?.supplier || '').trim();
    const note = String(tx?.note || '').trim();
    if (type === 'adjustment') return note ? `Корректировка остатка: ${note}` : 'Корректировка остатка';
    if (type === 'income') return `${cat || note || 'Прочие приходы'}${number}`;
    if (type === 'expense') return `${cat || supplier || note || 'Прочие расходы'}${number}`;
    if (type === 'transfer') {
      return `${direction === 'in' ? 'Перемещение денег (приход)' : 'Перемещение денег (расход)'}${number}`;
    }
    return `${cat || note || 'Операция'}${number}`;
  }

  function txDetailDate(tx) {
    const d = new Date(tx?.created_at || '');
    if (!Number.isFinite(d.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  }

  function detailIsoDate(d) {
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function detailTxDay(tx) {
    const d = new Date(tx?.created_at || '');
    return detailIsoDate(d);
  }

  function detailPresetRange(preset) {
    const now = new Date();
    const p = String(preset || '').trim();
    if (p === 'today') {
      const day = detailIsoDate(now);
      return { date_from: day, date_to: day };
    }
    if (p === 'yesterday') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const day = detailIsoDate(d);
      return { date_from: day, date_to: day };
    }
    if (p === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { date_from: detailIsoDate(from), date_to: detailIsoDate(to) };
    }
    if (p === 'prev-month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { date_from: detailIsoDate(from), date_to: detailIsoDate(to) };
    }
    if (p === 'year') {
      return {
        date_from: `${now.getFullYear()}-01-01`,
        date_to: `${now.getFullYear()}-12-31`,
      };
    }
    if (p === 'prev-year') {
      const y = now.getFullYear() - 1;
      return { date_from: `${y}-01-01`, date_to: `${y}-12-31` };
    }
    return { date_from: '', date_to: '' };
  }

  function resetDetailFilter() {
    detailFilter = { preset: 'latest', date_from: '', date_to: '', open: false };
  }

  function detailFilterLabel() {
    const p = String(detailFilter.preset || 'latest');
    if (p === 'latest') return `Последние ${DETAIL_HISTORY_LIMIT}`;
    if (p === 'today') return 'Сегодня';
    if (p === 'yesterday') return 'Вчера';
    if (p === 'month') return 'Этот месяц';
    if (p === 'prev-month') return 'Прошлый месяц';
    if (p === 'year') return 'Этот год';
    if (p === 'prev-year') return 'Прошлый год';
    if (detailFilter.date_from || detailFilter.date_to) {
      const from = detailFilter.date_from || '...';
      const to = detailFilter.date_to || '...';
      return `${from} — ${to}`;
    }
    return `Последние ${DETAIL_HISTORY_LIMIT}`;
  }

  function detailFilterToolbarHtml() {
    const presets = [
      ['latest', `Последние ${DETAIL_HISTORY_LIMIT}`],
      ['today', 'Сегодня'],
      ['yesterday', 'Вчера'],
      ['month', 'Этот месяц'],
      ['prev-month', 'Прошлый месяц'],
      ['year', 'Этот год'],
      ['prev-year', 'Прошлый год'],
    ];
    const presetButtons = presets.map(([value, label]) => {
      const active = String(detailFilter.preset || 'latest') === value;
      return `<button type="button" class="schet-detail-filter-preset${active ? ' active' : ''}" data-detail-filter-preset="${escapeAttr(value)}">${escapeHtml(label)}</button>`;
    }).join('');
    return `
      <div class="schet-detail-filter-wrap">
        <div class="schet-detail-filter-bar">
          <button type="button" class="schet-detail-filter-toggle" id="schet-detail-filter-toggle" aria-expanded="${detailFilter.open ? 'true' : 'false'}">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 3H2l8 9v6l4 3v-9l8-9z"/></svg>
            Фильтр
          </button>
          <span class="schet-detail-filter-summary">${escapeHtml(detailFilterLabel())}</span>
        </div>
        <div class="schet-detail-filter-panel" id="schet-detail-filter-panel" ${detailFilter.open ? '' : 'hidden'}>
          <div class="schet-detail-filter-presets">${presetButtons}</div>
          <div class="schet-detail-filter-custom">
            <label>
              <span>С даты</span>
              <input type="date" id="schet-detail-filter-from" value="${escapeAttr(detailFilter.date_from || '')}" />
            </label>
            <label>
              <span>По дату</span>
              <input type="date" id="schet-detail-filter-to" value="${escapeAttr(detailFilter.date_to || '')}" />
            </label>
            <button type="button" class="schet-detail-filter-apply" id="schet-detail-filter-apply">Применить</button>
            <button type="button" class="schet-detail-filter-close" id="schet-detail-filter-close">Закрыть</button>
          </div>
        </div>
      </div>`;
  }

  function txKassaSearchValue(tx) {
    const number = String(tx?.number || '').trim();
    if (number) return `#${number}`;
    return String(tx?.id || '').trim();
  }

  function txKassaHref(tx) {
    const id = String(tx?.id || '').trim();
    const search = txKassaSearchValue(tx);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (id) params.set('tx', id);
    const qs = params.toString();
    return qs ? `/kassa?${qs}` : '/kassa';
  }

  function detailAmountHtml(value, currency, balance = false) {
    const c = String(currency || 'USD').trim().toUpperCase();
    const n = Number(value || 0);
    const dec = decimalsForSchetDisplay(c);
    const fmt = formatNumberGroupedHtml(Math.abs(roundForDecimals(n, dec)), dec);
    const sign = balance ? (n < 0 ? '−' : '') : (n > 0 ? '+' : n < 0 ? '−' : '');
    const cls = balance
      ? 'schet-detail-balance'
      : `schet-detail-amount ${n >= 0 ? 'schet-detail-amount--positive' : 'schet-detail-amount--negative'}`;
    return `<span class="${cls}">${sign}${fmt.html}<span class="schet-detail-ccy">${escapeHtml(c)}</span></span>`;
  }

  function detailCurrentBalanceMap(pocket) {
    const map = new Map();
    for (const entry of pocket?.entries || []) {
      const c = String(entry?.currency || '').trim().toUpperCase();
      if (!c) continue;
      map.set(c, Number(entry?.amount || 0));
    }
    return map;
  }

  async function loadDetailTransactions() {
    const res = await fetch('/api/transactions?limit=5000&offset=0', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('transactions');
    const data = await res.json();
    return Array.isArray(data.transactions) ? data.transactions : [];
  }

  async function loadDetailAdjustments(pocketId, currency) {
    const pid = String(pocketId || '').trim();
    const ccy = String(currency || '').trim().toUpperCase();
    if (!pid || !ccy) return [];
    const res = await fetch(`/api/adjustments?t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data.history) ? data.history : [];
    return rows
      .filter((row) => {
        const section = String(row?.section || '').trim();
        const targetId = String(row?.target_id || '').trim();
        const rowCurrency = String(row?.currency || '').trim().toUpperCase();
        return section === 'accounts' && targetId === pid && rowCurrency === ccy;
      })
      .map((row) => ({
        id: `adjustment-${String(row.id || '')}`,
        type: 'adjustment',
        category: 'Корректировка остатка',
        note: String(row.note || '').trim(),
        created_at: row.created_at || '',
        is_adjustment: true,
        is_confirmed: true,
        status: 'confirmed',
        account_id: pid,
        currency: ccy,
        amount: Math.abs(Number(row.delta || 0)),
        delta: Number(row.delta || 0),
      }))
      .filter((row) => Number.isFinite(row.delta) && row.delta !== 0);
  }

  function applyDetailHistoryFilter(rows) {
    let out = [...(rows || [])];
    const from = String(detailFilter.date_from || '').trim();
    const to = String(detailFilter.date_to || '').trim();
    if (from || to) {
      out = out.filter((row) => {
        const day = detailTxDay(row.tx);
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      });
    }
    return out.slice(0, DETAIL_HISTORY_LIMIT);
  }

  function renderActivePocketDetail() {
    const id = String(activeDetailPocketId || '').trim();
    const onlyCurrency = String(activeDetailCurrency || '').trim().toUpperCase();
    if (!id || !onlyCurrency) return;
    const pocket = state.pockets.find((p) => String(p.id || '').trim() === id);
    const body = document.getElementById('schet-detail-body');
    if (!pocket || !body) return;
    body.innerHTML = renderDetailRows(pocket, activeDetailTransactions, onlyCurrency);
  }

  function setDetailFilterPreset(preset) {
    const p = String(preset || 'latest').trim();
    if (p === 'latest') {
      detailFilter = { preset: 'latest', date_from: '', date_to: '', open: true };
    } else {
      detailFilter = { preset: p, ...detailPresetRange(p), open: true };
    }
    renderActivePocketDetail();
  }

  function applyCustomDetailFilter() {
    const from = String(document.getElementById('schet-detail-filter-from')?.value || '').trim();
    const to = String(document.getElementById('schet-detail-filter-to')?.value || '').trim();
    detailFilter = { preset: 'custom', date_from: from, date_to: to, open: false };
    renderActivePocketDetail();
  }

  function renderDetailRows(pocket, transactions, onlyCurrency = '') {
    const only = String(onlyCurrency || '').trim().toUpperCase();
    const balances = detailCurrentBalanceMap(pocket);
    const sorted = [...(transactions || [])].sort((a, b) => {
      const ad = new Date(a?.created_at || '').getTime() || 0;
      const bd = new Date(b?.created_at || '').getTime() || 0;
      return bd - ad;
    });
    const rows = [];
    const currencies = [];
    const addCurrency = (currency) => {
      const c = String(currency || '').trim().toUpperCase();
      if (!c || currencies.includes(c)) return;
      if (only && c !== only) return;
      currencies.push(c);
    };
    for (const entry of pocket?.entries || []) addCurrency(entry?.currency);
    for (const tx of sorted) {
      const postings = txPostingsForPocket(tx, pocket.id);
      postings.forEach((posting) => {
        addCurrency(posting.currency);
        if (only && posting.currency !== only) return;
        const current = Number(balances.get(posting.currency) || 0);
        rows.push({ tx, posting, balanceAfter: current });
        balances.set(posting.currency, current - posting.delta);
      });
    }
    if (!rows.length && !currencies.length) {
      return `<p class="schet-detail-state">По этому счёту пока нет прихода или расхода.</p>`;
    }
    const currentByCurrency = new Map();
    for (const entry of pocket?.entries || []) {
      const c = String(entry?.currency || '').trim().toUpperCase();
      if (c) currentByCurrency.set(c, Number(entry?.amount || 0));
    }
    const sections = currencies.map((currency) => {
      const allCurrencyRows = rows.filter((row) => row.posting.currency === currency);
      const curRows = applyDetailHistoryFilter(allCurrencyRows);
      const body = curRows.length
        ? curRows.map(({ tx, posting, balanceAfter }) => {
          const title = escapeHtml(txDetailTitle(tx, posting.direction));
          const titleHtml = tx?.is_adjustment
            ? `<span class="schet-detail-tx-title">${title}</span>`
            : `<a class="schet-detail-tx-title" href="${escapeAttr(txKassaHref(tx))}">${title}</a>`;
          return `
          <tr>
            <td>
              ${titleHtml}
              <div class="schet-detail-tx-date">${escapeHtml(txDetailDate(tx))}</div>
            </td>
            <td>${detailAmountHtml(posting.delta, posting.currency)}</td>
            <td>${detailAmountHtml(balanceAfter, posting.currency, true)}</td>
          </tr>`;
        }).join('')
        : `<tr><td colspan="3" class="schet-detail-empty-cell">Нет операций по этой валюте</td></tr>`;
      const total = detailAmountHtml(Number(currentByCurrency.get(currency) || 0), currency, true);
      return `
        <section class="schet-detail-currency-section">
          <h3 class="schet-detail-currency-title">${escapeHtml(currency)}</h3>
          <table class="schet-detail-table">
            <colgroup>
              <col style="width: 50%" />
              <col style="width: 24%" />
              <col style="width: 26%" />
            </colgroup>
            <thead>
              <tr>
                <th>Транзакция</th>
                <th>Сумма</th>
                <th>Баланс после операции</th>
              </tr>
            </thead>
            <tbody>
              ${body}
              <tr class="schet-detail-total-row">
                <td colspan="2">Итого ${escapeHtml(currency)}</td>
                <td>${total}</td>
              </tr>
            </tbody>
          </table>
        </section>`;
    }).join('');
    return `${detailFilterToolbarHtml()}<div class="schet-detail-currency-stack">${sections}</div>`;
  }

  async function openPocketDetail(pocketId, currency = '') {
    const id = String(pocketId || '').trim();
    const onlyCurrency = String(currency || '').trim().toUpperCase();
    if (!onlyCurrency) return;
    const pocket = state.pockets.find((p) => String(p.id || '').trim() === id);
    if (!pocket) return;
    activeDetailPocketId = id;
    activeDetailCurrency = onlyCurrency;
    activeDetailTransactions = [];
    resetDetailFilter();
    const dlg = document.getElementById('schet-detail-dialog');
    const nameEl = document.getElementById('schet-detail-name');
    const body = document.getElementById('schet-detail-body');
    if (!dlg || !body) return;
    if (nameEl) {
      const baseName = pocket.label || tplBadgeLabel(pocket.template_id);
      nameEl.textContent = onlyCurrency ? `${baseName} · ${onlyCurrency}` : baseName;
    }
    body.innerHTML = `<p class="schet-detail-state">Загрузка истории…</p>`;
    if (!dlg.open) dlg.showModal();
    try {
      const txs = await loadDetailTransactions();
      let adjustments = [];
      try {
        adjustments = await loadDetailAdjustments(id, onlyCurrency);
      } catch {
        adjustments = [];
      }
      if (activeDetailPocketId !== id || activeDetailCurrency !== onlyCurrency) return;
      activeDetailTransactions = [...txs, ...adjustments];
      renderActivePocketDetail();
    } catch {
      if (activeDetailPocketId === id && activeDetailCurrency === onlyCurrency) {
        body.innerHTML = `<p class="schet-detail-state">Не удалось загрузить историю операций.</p>`;
      }
    }
  }

  function closePocketDetail() {
    activeDetailPocketId = '';
    activeDetailCurrency = '';
    activeDetailTransactions = [];
    resetDetailFilter();
    const dlg = document.getElementById('schet-detail-dialog');
    if (dlg?.open) dlg.close();
  }

  function usedCurrencyColumns(pockets = state.pockets) {
    const used = new Set();
    for (const pocket of pockets || []) {
      for (const entry of pocket?.entries || []) {
        const c = String(entry?.currency || '').trim().toUpperCase();
        if (c) used.add(c);
      }
    }
    const base = enabledCurrencies.length ? enabledCurrencies : PRESET_CCY;
    const fixed = [...base, ...PRESET_CCY];
    const ordered = [];
    fixed.forEach((currency) => {
      const c = String(currency || '').trim().toUpperCase();
      if (used.has(c) && !ordered.includes(c)) ordered.push(c);
    });
    [...used].sort().forEach((currency) => {
      if (!ordered.includes(currency)) ordered.push(currency);
    });
    return ordered;
  }

  function entriesByCurrency(entries) {
    const map = new Map();
    for (const entry of entries || []) {
      const c = String(entry?.currency || '').trim().toUpperCase();
      if (!c) continue;
      map.set(c, Number(map.get(c) || 0) + Number(entry?.amount || 0));
    }
    return map;
  }

  function totalEntriesByCurrency(pockets = state.pockets) {
    const map = new Map();
    for (const pocket of pockets || []) {
      for (const entry of pocket?.entries || []) {
        const c = String(entry?.currency || '').trim().toUpperCase();
        if (!c) continue;
        map.set(c, Number(map.get(c) || 0) + Number(entry?.amount || 0));
      }
    }
    return [...map.entries()].map(([currency, amount]) => ({ currency, amount }));
  }

  /** Номинальные суммы по валютам в карточке списка (до пересчёта в валюту итога). */
  function pocketNominalBreakdownHtml(entries, currencyColumns = usedCurrencyColumns(), opts = {}) {
    const entryList = Array.isArray(entries) ? entries : [];
    const columns = Array.isArray(currencyColumns) ? currencyColumns.filter(Boolean) : [];
    const amountMap = entriesByCurrency(entryList);
    if (!columns.length) {
      amountMap.forEach((_amount, currency) => {
        if (currency && !columns.includes(currency)) columns.push(currency);
      });
    }
    const U = uamt();
    if (!U) {
      return `<span class="schet-ccy-tag is-empty">${escapeHtml(i18n('schet.formatting_loading', 'Загрузка форматирования…'))}</span>`;
    }
    if (!columns.length && !opts.total) {
      return `<span class="schet-ccy-tag is-empty">${escapeHtml(i18n('schet.no_amounts', 'Нет сумм'))}</span>`;
    }
    const gridStyle = columns.length
      ? ` style="grid-template-columns: repeat(${columns.length}, minmax(9.5rem, 1fr));"`
      : '';
    const lines = columns.map((c) => {
      if (!amountMap.has(c)) {
        return `<div class="schet-ccy-line schet-ccy-line--empty" aria-hidden="true"><span class="schet-ccy-line-main"></span></div>`;
      }
      const amount = Number(amountMap.get(c) || 0);
      const dec = decimalsForSchetDisplay(c);
      const nom = formatNumberGroupedHtml(amount, dec);
      const detailAttr = opts.total ? '' : ` data-detail-currency="${escapeAttr(c)}" role="button" tabindex="0" title="История ${escapeAttr(c)}"`;
      return `<div class="schet-ccy-line${opts.total ? ' schet-ccy-line--total' : ''}"${detailAttr}><span class="schet-ccy-line-main"><span class="schet-ccy-line-amt" aria-label="${escapeAttr(`${nom.plain} ${c}`)}">${nom.html}</span><span class="schet-ccy-line-ccy">${escapeHtml(c)}</span></span></div>`;
    });
    return `<div class="schet-ccy-breakdown"${gridStyle}>${lines.join('')}</div>`;
  }

  function movementRowsForAccount(accountId) {
    const accounts = movement && movement.accounts && typeof movement.accounts === 'object'
      ? movement.accounts
      : {};
    const row = accounts[String(accountId || '')] || {};
    return Array.isArray(row.currencies) ? row.currencies : [];
  }

  function movementRowsTotal() {
    const total = movement && movement.total && typeof movement.total === 'object'
      ? movement.total
      : {};
    return Array.isArray(total.currencies) ? total.currencies : [];
  }

  function movementNetInDisplay(rows) {
    const dc = (state.display_currency || 'USD').toUpperCase();
    let usd = 0;
    let ok = true;
    let count = 0;
    for (const row of rows || []) {
      const c = String(row.currency || 'USD').toUpperCase();
      const net = Number(row.net || 0);
      const u = amountInUsd(net, c, rates);
      if (u == null || !Number.isFinite(u)) {
        ok = false;
        continue;
      }
      usd += u;
      count += Number(row.count || 0);
    }
    const converted = ok ? usdToAmount(usd, dc, rates) : null;
    return {
      ok: ok && converted != null && Number.isFinite(converted),
      value: converted,
      currency: dc,
      count,
    };
  }

  function movementTone(value, count, currency) {
    const dec = decimalsForSchetDisplay(currency);
    const rounded = roundForDecimals(Number(value || 0), dec);
    const threshold = dec === 0 ? 1 : 0.005;
    if (!count || Math.abs(rounded) < threshold) return 'neutral';
    return rounded > 0 ? 'positive' : 'negative';
  }

  function formatMovementValue(value, currency) {
    const dc = (currency || state.display_currency || 'USD').toUpperCase();
    const dec = decimalsForSchetDisplay(dc);
    const rounded = roundForDecimals(Number(value || 0), dec);
    const fmt = formatNumberGroupedHtml(Math.abs(rounded), dec);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${sign}${fmt.html}<span class="schet-change-ccy">${escapeHtml(dc)}</span>`;
  }

  function movementChangeHtml(rows, compact) {
    const info = movementNetInDisplay(rows);
    const label = movementPeriod.label || i18n('period.today', 'Сегодня');
    if (!info.ok) {
      return `<div class="schet-change schet-change--neutral${compact ? ' schet-change--compact' : ''}">
        <span>${escapeHtml(i18n('schet.movement_fx_missing', 'Нет курса'))}</span>
        <small>${escapeHtml(label)}</small>
      </div>`;
    }
    const tone = movementTone(info.value, info.count, info.currency);
    const text = info.count
      ? formatMovementValue(info.value, info.currency)
      : escapeHtml(i18n('schet.movement_zero', '0'));
    const caption = info.count
      ? label
      : i18n('schet.movement_none', 'Нет движения');
    return `<div class="schet-change schet-change--${tone}${compact ? ' schet-change--compact' : ''}">
      <span>${text}</span>
      <small>${escapeHtml(caption)}</small>
    </div>`;
  }

  function renderViewPocketCard(p, currencyColumns) {
    const iconK = pocketIconKey(p);
    const title = escapeHtml(p.label || tplBadgeLabel(p.template_id));
    const noteRaw = (p.note || '').trim();
    const noteBlock = noteRaw
      ? `<p class="schet-view-note-static schet-list-note">${escapeHtml(noteRaw)}</p>`
      : '';

    const entries = p.entries || [];
    let tableBody = '';
    if (!entries.length) {
      tableBody =
        `<tr><td colspan="3" class="schet-view-compact" style="text-align:left">${escapeHtml(i18n('schet.no_amounts_adjust', 'Нет сумм — откройте корректировку.'))}</td></tr>`;
    } else {
      const U = uamt();
      if (!U) {
        tableBody =
          `<tr><td colspan="3" class="schet-view-compact" style="text-align:left">${escapeHtml(i18n('schet.formatting_reload', 'Обновите страницу (не загружено форматирование сумм).'))}</td></tr>`;
      } else {
        tableBody = entries
          .map((e) => {
            const c = (e.currency || '').toUpperCase();
            const dec = decimalsForSchetDisplay(c);
            const nom = formatNumberGroupedHtml(e.amount, dec);
            return `<tr>
            <td class="schet-view-ccy">${escapeHtml(c)}</td>
            <td class="schet-view-nominal" aria-label="${escapeAttr(`${nom.plain} ${c}`)}">${nom.html}</td>
            <td class="schet-view-compact">${escapeHtml(U.formatCompact(e.amount, c))}</td>
          </tr>`;
          })
          .join('');
      }
    }

    const breakdownHtml = pocketNominalBreakdownHtml(entries, currencyColumns);

    return `
      <section class="schet-category schet-list-item" data-pocket-id="${escapeAttr(p.id)}">
        <div class="schet-list-left">
          <div class="schet-pocket-icon" aria-hidden="true">${iconSvg(iconK)}</div>
            <div class="schet-pocket-titles">
              <div class="schet-pocket-title-line">
                <h3 class="schet-view-title">${title}</h3>
                <button type="button" class="schet-list-edit-btn" data-edit-pocket="${escapeAttr(p.id)}" aria-label="${escapeAttr(i18n('schet.edit_aria', 'Редактировать'))}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
              </div>
            ${noteBlock}
          </div>
        </div>
        <div class="schet-list-center">
          ${breakdownHtml}
        </div>
      </section>`;
  }

  function renderCurrencyTotalsRow(currencyColumns) {
    const totals = totalEntriesByCurrency();
    const breakdownHtml = pocketNominalBreakdownHtml(totals, currencyColumns, { total: true });
    return `
      <section class="schet-category schet-list-item schet-list-total-item" aria-label="Итого по валютам">
        <div class="schet-list-left">
          <div class="schet-pocket-icon schet-pocket-icon--total" aria-hidden="true">Σ</div>
          <div class="schet-pocket-titles">
            <h3 class="schet-view-title">Итого</h3>
          </div>
        </div>
        <div class="schet-list-center">
          ${breakdownHtml}
        </div>
        <div class="schet-list-right"></div>
      </section>`;
  }

  function renderCurrencyHeaderRow(currencyColumns) {
    const columns = Array.isArray(currencyColumns) ? currencyColumns.filter(Boolean) : [];
    const gridStyle = columns.length
      ? ` style="grid-template-columns: repeat(${columns.length}, minmax(9.5rem, 1fr));"`
      : '';
    const cells = columns
      .map((currency) => `<div class="schet-ccy-head-cell">${escapeHtml(currency)}</div>`)
      .join('');
    return `
      <section class="schet-list-item schet-list-header" aria-hidden="true">
        <div class="schet-list-left">Счёт</div>
        <div class="schet-list-center">
          <div class="schet-ccy-breakdown"${gridStyle}>${cells}</div>
        </div>
        <div class="schet-list-right"></div>
      </section>`;
  }

  /** Список карманов «Счёт» — пересчитывает суммы «Итого» в текущей `state.display_currency`. */
  function renderPocketsList() {
    const host = document.getElementById('schet-pockets');
    if (!host) return;
    if (!state.pockets.length) {
      host.innerHTML = '';
      return;
    }
    const currencyColumns = usedCurrencyColumns(state.pockets);
    host.innerHTML = [
      renderCurrencyHeaderRow(currencyColumns),
      ...state.pockets.map((p) => renderViewPocketCard(p, currencyColumns)),
      renderCurrencyTotalsRow(currencyColumns),
    ].join('');
  }

  function renderDashboard() {
    const host = document.getElementById('schet-pockets');
    const empty = document.getElementById('schet-empty');
    const total = document.getElementById('schet-total-card');
    const charts = document.getElementById('schet-charts');
    const shell = document.getElementById('schet-overview-shell');
    if (!host || !empty || !total || !charts) return;

    if (!state.pockets.length) {
      empty.hidden = false;
      if (shell) shell.hidden = true;
      renderPocketsList();
      total.hidden = true;
      charts.hidden = true;
      destroyCharts();
      return;
    }

    empty.hidden = true;
    if (shell) shell.hidden = false;
    renderPocketsList();
    total.hidden = false;
    charts.hidden = false;

    syncSelectCcyOptions();
    updateTotalsAndCharts();

    const scr = document.getElementById('schet-root');
    if (scr && typeof window !== 'undefined' && window.UPOS_CCY_SELECT)
      window.UPOS_CCY_SELECT.upgradeAll(scr);
  }

  function syncSelectCcyOptions() {
    const sel = document.getElementById('schet-display-ccy');
    if (!sel) return;
    const cur = state.display_currency.toUpperCase();
    sel.innerHTML = currencyLabelsHtml(cur, state.pockets);
    sel.value = cur;
  }

  function findDraftPocket(pid) {
    if (!pocketDraft || pid == null) return undefined;
    const key = String(pid).trim();
    if (!key) return undefined;
    return pocketDraft.find((x) => String(x.id).trim() === key);
  }

  function draftEntryById(p, eid) {
    if (!p || eid == null) return null;
    const k = String(eid).trim();
    if (!k) return null;
    return (p.entries || []).find((x) => String(x.id).trim() === k) || null;
  }

  /** Снимок полей модалки в черновик перед сохранением (blur может не успеть сработать). */
  function flushEditorDraftFromDom() {
    if (!pocketDraft) return;
    document.querySelectorAll('[data-editor-label]').forEach((el) => {
      const pid = el.getAttribute('data-pocket-id');
      const p = findDraftPocket(pid);
      if (!p) return;
      const v = String(el.value || '').trim();
      if (v) p.label = v;
    });
    document.querySelectorAll('[data-editor-note]').forEach((el) => {
      const pid = el.getAttribute('data-pocket-id');
      const p = findDraftPocket(pid);
      if (!p) return;
      p.note = String(el.value || '').trim();
    });
    const U = uamt();
    document.querySelectorAll('[data-editor-amt]').forEach((input) => {
      const pid = input.getAttribute('data-pocket-id');
      const eid = input.getAttribute('data-entry-id');
      const p = findDraftPocket(pid);
      const e = p && draftEntryById(p, eid);
      if (!e) return;
      const ccy = (e.currency || 'USD').toUpperCase();
      if (U && typeof U.formatInputElement === 'function') {
        const dec = U.decimalsForCurrency(ccy);
        U.formatInputElement(input, dec);
        e.amount = U.parseAmount(input.value);
      } else {
        const s = String(input.value || '')
          .replace(/[\s\u202f\u00a0]/g, '')
          .replace(',', '.');
        const n = Number(s);
        e.amount = Number.isFinite(n) && n >= 0 ? n : Number(e.amount) || 0;
      }
    });
  }

  /** Убираем дубликаты имён счетов локально — иначе БД кидает unique (workspace,name). */
  function dedupePocketLabelsForSave(pockets) {
    if (!pockets || !pockets.length) return;
    const count = new Map();
    for (const p of pockets) {
      const base = String(p.label || '').trim() || i18n('schet.pocket_default', 'Место хранения');
      const key = base.toLowerCase();
      const n = (count.get(key) || 0) + 1;
      count.set(key, n);
      if (n === 1) p.label = base;
      else p.label = `${base} (${n})`;
    }
  }

  function renderEditorPocketMarkup(p) {
    const iconK = pocketIconKey(p);
    const rowHtml = (p.entries || []).length
      ? (p.entries || [])
          .map((e) => {
            const ccyOpts = currencyLabelsHtml(e.currency, pocketDraft, p, e.id);
            return `
          <div class="schet-row" data-entry-row data-pocket-id="${escapeAttr(p.id)}" data-entry-id="${escapeAttr(e.id)}">
            <select class="schet-row-ccy" data-ccy-enhance data-editor-ccy aria-label="${escapeAttr(i18n('schet.currency_aria', 'Валюта'))}" data-pocket-id="${escapeAttr(p.id)}" data-entry-id="${escapeAttr(e.id)}">
              ${ccyOpts}
            </select>
            <input type="text" inputmode="decimal" class="schet-amt" data-editor-amt data-pocket-id="${escapeAttr(p.id)}" data-entry-id="${escapeAttr(e.id)}" value="" placeholder="0" />
            <button type="button" class="schet-row-del" data-editor-del-entry data-pocket-id="${escapeAttr(p.id)}" data-entry-id="${escapeAttr(e.id)}" aria-label="${escapeAttr(i18n('schet.del_row_aria', 'Удалить строку'))}">✕</button>
          </div>`;
          })
          .join('')
      : `<div class="schet-pocket-hint">${escapeHtml(i18n('schet.add_rows_hint', 'Добавьте строки по валютам.'))}</div>`;

    return `
      <section class="schet-editor-pocket" id="schet-editor-pocket-${escapeAttr(p.id)}" data-pocket-id="${escapeAttr(p.id)}">
        <div class="schet-editor-pocket-top">
          <div class="schet-pocket-head" style="margin:0;padding-left:0">
            <div class="schet-pocket-icon" aria-hidden="true">${iconSvg(iconK)}</div>
            <div class="schet-pocket-titles">
              <input class="schet-pocket-label" data-editor-label data-pocket-id="${escapeAttr(p.id)}" value="${escapeAttr(p.label || '')}" maxlength="120" />
            </div>
          </div>
          <button type="button" class="btn-danger-ghost" data-editor-del-pocket data-pocket-id="${escapeAttr(p.id)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            ${escapeHtml(i18n('schet.delete_pocket', 'Удалить место'))}
          </button>
        </div>
        ${ownerSelectHtml(p)}
        <textarea class="schet-pocket-note" data-editor-note data-pocket-id="${escapeAttr(p.id)}" maxlength="400" placeholder="${escapeAttr(i18n('schet.note_ph', 'Заметка (банк, филиал, номер счёта…)'))}">${escapeHtml(p.note || '')}</textarea>
        <div class="schet-pocket-rows">${rowHtml}</div>
        <div class="schet-pocket-actions" style="margin-top:0.5rem">
          <button type="button" class="btn-secondary" data-editor-add-entry data-pocket-id="${escapeAttr(p.id)}" ${pocketCanAddCurrency(p) ? '' : 'hidden disabled'} title="${escapeAttr(pocketCanAddCurrency(p) ? '' : i18n('schet.all_currencies_used', 'Все доступные валюты уже добавлены в этот счёт'))}">${escapeHtml(i18n('schet.add_currency', '+ Валюта'))}</button>
        </div>
      </section>`;
  }

  function renderEditorPickTile(p) {
    const iconK = pocketIconKey(p);
    const title = escapeHtml(p.label || tplBadgeLabel(p.template_id));
    const sub = escapeHtml(tplBadgeLabel(p.template_id));
    return `
      <button type="button" class="schet-editor-pick-tile" data-editor-open-pocket="${escapeAttr(p.id)}">
        <span class="schet-editor-pick-ic" aria-hidden="true">${iconSvg(iconK)}</span>
        <span class="schet-editor-pick-text">
          <span class="schet-editor-pick-title">${title}</span>
          <span class="schet-editor-pick-sub">${sub}</span>
        </span>
      </button>`;
  }

  function renderEditorPickView() {
    if (!pocketDraft.length) {
      return `
        <p class="schet-editor-intro schet-editor-intro--pick">
          ${escapeHtml(i18n('schet.no_pockets', 'Пока нет мест хранения. Добавьте первое — банк, наличные, карта и т.д.'))}
        </p>
        <div class="schet-editor-pick-actions">
          <button type="button" class="btn" data-editor-add-place>
            <span class="schet-btn-ic" aria-hidden="true">+</span>
            ${escapeHtml(i18n('schet.add_pocket', 'Добавить место'))}
          </button>
        </div>`;
    }
    const tiles = pocketDraft.map(renderEditorPickTile).join('');
    return `
      <div class="schet-editor-pick-grid">${tiles}</div>
      <div class="schet-editor-pick-footer">
        <button type="button" class="btn btn-secondary" data-editor-add-place>
          <span class="schet-btn-ic" aria-hidden="true">+</span>
          ${escapeHtml(i18n('schet.add_pocket', 'Добавить место'))}
        </button>
      </div>`;
  }

  function renderEditorSingleView(p) {
    return `
      <div class="schet-editor-single-head">
        <button type="button" class="btn-secondary schet-editor-back-btn" data-editor-back-pick>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          ${escapeHtml(i18n('schet.back_to_pockets', 'К списку мест'))}
        </button>
      </div>
      <div class="schet-editor-pockets schet-editor-pockets--single">${renderEditorPocketMarkup(p)}</div>`;
  }

  function updateEditorChrome() {
    const title = document.getElementById('schet-editor-title');
    const sub = document.querySelector('.schet-editor-head .schet-editor-sub');
    if (!title || !sub) return;
    if (editorStep === 'pick') {
      title.textContent = i18n('schet.adjust_title', 'Корректировка счёта');
      sub.textContent = '';
    } else {
      const p = findDraftPocket(editorSelectedId);
      title.textContent = p
        ? String(p.label || tplBadgeLabel(p.template_id)).trim() || i18n('schet.pocket_default', 'Место хранения')
        : i18n('schet.pocket_default', 'Место хранения');
      sub.textContent =
        i18n('schet.editor_help', 'Валюты и суммы. «К списку мест» — выбрать другой счёт без закрытия окна.');
    }
  }

  function renderEditorBody() {
    const host = document.getElementById('schet-editor-body');
    if (!host || !pocketDraft) return;

    if (editorStep === 'edit' && editorSelectedId) {
      const p = findDraftPocket(editorSelectedId);
      host.innerHTML = p ? renderEditorSingleView(p) : renderEditorPickView();
      if (!p) {
        editorStep = 'pick';
        editorSelectedId = null;
      }
    } else {
      editorStep = 'pick';
      editorSelectedId = null;
      host.innerHTML = renderEditorPickView();
    }

    updateEditorChrome();
    bindEditorDialogOnce();
    syncEditorAmtInputs();

    if (editorFocusPocketId) {
      const el = document.getElementById(
        `schet-editor-pocket-${editorFocusPocketId}`,
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      editorFocusPocketId = null;
    }

    const dlg = document.getElementById('schet-editor-dialog');
    if (dlg && typeof window !== 'undefined' && window.UPOS_CCY_SELECT) {
      window.UPOS_CCY_SELECT.upgradeAll(dlg);
    }
  }

  function syncEditorAmtInputs() {
    const U = uamt();
    if (!U) return;
    document.querySelectorAll('[data-editor-amt]').forEach((input) => {
      const pid = input.getAttribute('data-pocket-id');
      const eid = input.getAttribute('data-entry-id');
      const p = findDraftPocket(pid);
      const e = p && draftEntryById(p, eid);
      if (!e) return;
      U.setInputFromNumber(
        input,
        Number(e.amount) || 0,
        U.decimalsForCurrency(e.currency),
      );
      updateEditorRowCompact(pid, eid);
    });
  }

  /** События редактора: вешаем на сам <dialog>, клики — capture (не терять из‑за stopPropagation во вложенных UI). */
  function bindEditorDialogOnce() {
    const dlg = document.getElementById('schet-editor-dialog');
    if (!dlg || editorSurfaceBound) return;
    editorSurfaceBound = true;

    dlg.addEventListener('focusin', (ev) => {
      const t = ev.target;
      if (t.matches && t.matches('[data-editor-amt]')) {
        const val = t.value.trim();
        if (val === '0') t.value = '';
      }
    }, true);

    dlg.addEventListener('input', (ev) => {
      const U = uamt();
      if (!U) return;
      const t = ev.target;
      if (!t.matches || !t.matches('[data-editor-amt]')) return;
      const pid = t.getAttribute('data-pocket-id');
      const eid = t.getAttribute('data-entry-id');
      const p = findDraftPocket(pid);
      if (!p) return;
      const e = draftEntryById(p, eid);
      if (!e) return;
      const dec = U.decimalsForCurrency(e.currency);
      U.formatInputElement(t, dec);
      e.amount = U.parseAmount(t.value);
      editorDirty = true;
      updateEditorRowCompact(pid, eid);
    });

    dlg.addEventListener(
      'focusout',
      (ev) => {
        const t = ev.target;
        if (!t.matches || !t.matches('[data-editor-amt]')) return;
        const U = uamt();
        if (!U || typeof U.formatInputElement !== 'function') return;
        const pid = t.getAttribute('data-pocket-id');
        const eid = t.getAttribute('data-entry-id');
        const p = findDraftPocket(pid);
        const e = p && draftEntryById(p, eid);
        if (!e) return;
        const dec = U.decimalsForCurrency(e.currency);
        U.formatInputElement(t, dec);
        e.amount = U.parseAmount(t.value);
        editorDirty = true;
        updateEditorRowCompact(pid, eid);
      },
      true,
    );

    dlg.addEventListener('change', (ev) => {
      const t = ev.target;
      const U = uamt();
      if (!U) return;
      if (!t.matches || !t.matches('[data-editor-ccy]')) return;
      const pid = t.getAttribute('data-pocket-id');
      const eid = t.getAttribute('data-entry-id');
      const p = findDraftPocket(pid);
      if (!p) return;
      const e = draftEntryById(p, eid);
      if (!e) return;
      e.currency = (t.value || 'USD').toUpperCase();
      const row = document.querySelector(
        `[data-entry-row][data-pocket-id="${cssEsc(pid)}"][data-entry-id="${cssEsc(eid)}"]`,
      );
      const amtInput = row?.querySelector('[data-editor-amt]');
      if (amtInput) {
        U.setInputFromNumber(
          amtInput,
          Number(e.amount) || 0,
          U.decimalsForCurrency(e.currency),
        );
      }
      editorDirty = true;
      updateEditorRowCompact(pid, eid);
      renderEditorBody();
    });

    dlg.addEventListener(
      'click',
      (ev) => {
      const openP = ev.target.closest('[data-editor-open-pocket]');
      if (openP) {
        const id = String(
          openP.getAttribute('data-editor-open-pocket') || '',
        ).trim();
        if (id && findDraftPocket(id)) {
          editorStep = 'edit';
          editorSelectedId = id;
          renderEditorBody();
        }
        return;
      }
      if (ev.target.closest('[data-editor-back-pick]')) {
        editorStep = 'pick';
        editorSelectedId = null;
        renderEditorBody();
        return;
      }
      const addPlace = ev.target.closest('[data-editor-add-place]');
      if (addPlace) {
        openTemplateDialog((tpl) => {
          const pid = newId();
          pocketDraft.push({
            id: pid,
            template_id: tpl.id,
            label: tpl.title,
            note: '',
            icon: tpl.icon,
            owner_employee_id: '',
            entries: [{ id: newId(), currency: defaultEnabledCurrency(), amount: null }],
          });
          editorDirty = true;
          editorStep = 'edit';
          editorSelectedId = pid;
          renderEditorBody();
        });
        return;
      }
      const delEntry = ev.target.closest('[data-editor-del-entry]');
      if (delEntry) {
        const pid = delEntry.getAttribute('data-pocket-id');
        const eid = delEntry.getAttribute('data-entry-id');
        
        const onOk = () => {
          const p = findDraftPocket(pid);
          if (!p) return;
          p.entries = (p.entries || []).filter((x) => String(x.id).trim() !== String(eid ?? '').trim());
          editorDirty = true;
          renderEditorBody();
        };

        if (isExistingEntry(pid, eid)) {
          confirmDeletion(i18n('schet.confirm.del_ccy', 'Вы уверены, что хотите удалить эту валюту из счёта? Остаток по ней будет обнулён.'), onOk);
        } else {
          onOk();
        }
      }
      const addEntry = ev.target.closest('[data-editor-add-entry]');
      if (addEntry) {
        const pid = addEntry.getAttribute('data-pocket-id');
        const p = findDraftPocket(pid);
        if (!p) return;
        if (!p.entries) p.entries = [];
        const nextCcy = firstUnusedCurrencyInPocket(p);
        if (!nextCcy) return;
        p.entries.push({
          id: newId(),
          currency: nextCcy,
          amount: null,
        });
        editorDirty = true;
        renderEditorBody();
        return;
      }
      const delPocket = ev.target.closest('[data-editor-del-pocket]');
      if (delPocket) {
        const pid = delPocket.getAttribute('data-pocket-id');
        const onOk = () => {
          const idx = pocketDraft.findIndex((x) => String(x.id).trim() === String(pid ?? '').trim());
          if (idx >= 0) pocketDraft.splice(idx, 1);
          editorDirty = true;
          editorStep = 'pick';
          editorSelectedId = null;
          renderEditorBody();
        };

        if (isExistingPocket(pid)) {
          confirmDeletion(i18n('schet.confirm.del_pocket', 'Вы уверены, что хотите полностью удалить этот счёт / место хранения? Все остатки по валютам будут удалены.'), onOk);
        } else {
          onOk();
        }
      }
    },
      true,
    );

    dlg.addEventListener(
      'blur',
      (ev) => {
        const t = ev.target;
        if (t.matches('[data-editor-label]')) {
          const pid = t.getAttribute('data-pocket-id');
          const p = findDraftPocket(pid);
          if (!p) return;
          const next = String(t.value || '').trim();
          if (next) p.label = next;
          editorDirty = true;
        }
      },
      true,
    );

    dlg.addEventListener(
      'blur',
      (ev) => {
        const t = ev.target;
        if (t.matches('[data-editor-note]')) {
          const pid = t.getAttribute('data-pocket-id');
          const p = findDraftPocket(pid);
          if (!p) return;
          p.note = String(t.value || '').trim();
          editorDirty = true;
        }
      },
      true,
    );
  }

  function updateEditorRowCompact(pid, eid) {
    return;
  }

  function openEditor(pocketId = null) {
    const dlg = document.getElementById('schet-editor-dialog');
    if (!dlg) return;
    pocketDraft = deepClone(state.pockets);
    editorDirty = false;
    const want =
      pocketId != null && pocketId !== ''
        ? String(pocketId).trim()
        : '';
    if (want && findDraftPocket(want)) {
      editorStep = 'edit';
      editorSelectedId = want;
    } else {
      editorStep = 'pick';
      editorSelectedId = null;
    }
    editorFocusPocketId = null;
    renderEditorBody();
    dlg.showModal();
  }

  function tryCloseEditor() {
    const dlg = document.getElementById('schet-editor-dialog');
    if (!dlg) return;
    if (editorDirty) {
      const ok = window.confirm(
        i18n('schet.confirm.close', 'Закрыть без сохранения? Несохранённые изменения пропадут.'),
      );
      if (!ok) return;
    }
    
    editorDirty = false;
    pocketDraft = null;
    editorStep = 'pick';
    editorSelectedId = null;
    dlg.close();
  }

  async function saveFromEditor() {
    if (!pocketDraft) return;
    flushEditorDraftFromDom();

    for (const p of pocketDraft) {
      const currencies = (p.entries || []).map(e => String(e.currency || '').toUpperCase().trim());
      const unique = new Set(currencies);
      if (currencies.length !== unique.size) {
        setStatus(i18n('schet.duplicate_currency', 'Валюта уже добавлена в этом счете'), 'err');
        
        if (editorStep === 'pick') {
          editorStep = 'edit';
          editorSelectedId = p.id;
          renderEditorBody();
        }
        
        setTimeout(() => {
          const pocketEl = document.getElementById(`schet-editor-pocket-${p.id}`);
          if (pocketEl) {
            const seen = new Set();
            pocketEl.querySelectorAll('[data-entry-row]').forEach(row => {
              const select = row.querySelector('[data-editor-ccy]');
              const ccy = select ? String(select.value || '').toUpperCase().trim() : '';
              if (ccy) {
                if (seen.has(ccy)) {
                  row.classList.add('is-invalid');
                } else {
                  seen.add(ccy);
                  row.classList.remove('is-invalid');
                }
              }
            });
          }
        }, 50);
        return;
      }
    }

    dedupePocketLabelsForSave(pocketDraft);
    const ok = await persistToServer({
      display_currency: state.display_currency,
      pockets: pocketDraft,
    });
    if (!ok) return;
    
    const dlg = document.getElementById('schet-editor-dialog');
    if (dlg) {
      editorDirty = false;
      pocketDraft = null;
      editorStep = 'pick';
      editorSelectedId = null;
      dlg.close();
      renderDashboard();
    } else {
      editorDirty = false;
      pocketDraft = null;
      editorStep = 'pick';
      editorSelectedId = null;
      renderDashboard();
    }
  }

  function openTemplateDialog(onSelect) {
    const dlg = document.getElementById('schet-tpl-dialog');
    const uzHost = document.getElementById('schet-tpl-uz');
    const intlHost = document.getElementById('schet-tpl-intl');
    if (!dlg || !uzHost || !intlHost) return;

    const intro = document.getElementById('schet-tpl-intro');
    if (intro) {
      intro.textContent =
        typeof onSelect === 'function' && pocketDraft !== null
          ? i18n('schet.draft_hint', 'Добавляется в черновик корректировки — сохраните форму, чтобы зафиксировать на главном экране.')
          : i18n('schet.pick_type', 'Выберите тип счёта или кошелька.');
    }

    const uz = templates.filter((x) => x.region === 'uz');
    const intl = templates.filter((x) => x.region !== 'uz');

    uzHost.innerHTML = uz.map(renderTplBtn).join('');
    intlHost.innerHTML = intl.map(renderTplBtn).join('');

    dlg.showModal();

    function teardownPick() {
      uzHost.innerHTML = '';
      intlHost.innerHTML = '';
      dlg.removeEventListener('click', onPick, true);
    }

    function onPick(ev) {
      const btn = ev.target.closest('[data-tpl-id]');
      if (!btn) return;
      const id = btn.getAttribute('data-tpl-id');
      const t = tplMeta(id);
      if (!t) return;
      try {
        if (typeof onSelect === 'function') onSelect(t);
      } catch {
        /* не блокируем закрытие */
      }
      dlg.close();
    }

    function cleanupPick() {
      teardownPick();
      dlg.removeEventListener('close', cleanupPick);
    }

    dlg.addEventListener('click', onPick, true);
    dlg.addEventListener('close', cleanupPick, { once: true });
  }

  function renderTplBtn(t) {
    return `
      <button type="button" class="schet-tpl-card" data-tpl-id="${escapeAttr(t.id)}">
        <div class="schet-tpl-ic" aria-hidden="true">${iconSvg(t.icon)}</div>
        <div>
          <p class="schet-tpl-card-title">${escapeHtml(t.title)}</p>
          <p class="schet-tpl-card-sub">${escapeHtml(t.subtitle || '')}</p>
        </div>
      </button>`;
  }

  function updateTotalsAndCharts() {
    const tot = document.getElementById('schet-total-value');
    const verbalEl = document.getElementById('schet-total-verbal');
    const sub = document.getElementById('schet-total-sub');
    if (!tot) return;
    const { usd, ok } = totalUsdAll();
    const dc = state.display_currency.toUpperCase();
    const conv = usdToAmount(usd, dc, rates);
    if (!ok || conv == null) {
      tot.textContent = '—';
      tot.removeAttribute('aria-label');
      if (verbalEl) {
        verbalEl.textContent = '';
        verbalEl.hidden = true;
      }
      if (sub)
        sub.textContent =
          i18n('schet.fx_missing', 'Часть валют не найдена в курсах. Обновите курсы или скорректируйте коды валют.');
    } else {
      const dec = decimalsForSchetDisplay(dc);
      const rounded = roundForDecimals(conv, dec);
      const fmt = formatNumberGroupedHtml(rounded, dec);
      tot.innerHTML = `${fmt.html}<span class="schet-total-suffix">${escapeHtml(dc)}</span>`;
      tot.setAttribute('aria-label', `${fmt.plain} ${dc}`);
      if (verbalEl) {
        verbalEl.textContent = formatTotalVerbalCaption(rounded, dc);
        verbalEl.hidden = !verbalEl.textContent;
      }
      if (sub) {
        sub.textContent =
          i18n('schet.fx_usd_hint', 'Пересчёт через USD: каждая сумма переводится в доллары, затем в выбранную валюту.');
      }
    }
    const changeEl = document.getElementById('schet-total-change');
    if (changeEl) {
      changeEl.innerHTML = movementChangeHtml(movementRowsTotal(), false);
      changeEl.hidden = false;
    }
    renderCharts();
  }

  function destroyCharts() {
    if (chartPocket) {
      chartPocket.destroy();
      chartPocket = null;
    }
    if (chartCcy) {
      chartCcy.destroy();
      chartCcy = null;
    }
  }

  function aggregateByCurrency() {
    const map = new Map();
    const dc = state.display_currency.toUpperCase();
    for (const p of state.pockets) {
      for (const e of p.entries || []) {
        const c = (e.currency || 'USD').toUpperCase();
        const amt = Number(e.amount || 0);
        const u = amountInUsd(amt, c, rates);
        const conv = u != null ? usdToAmount(u, dc, rates) : 0;

        const prev = map.get(c) || { nominal: 0, converted: 0 };
        map.set(c, {
          nominal: prev.nominal + amt,
          converted: prev.converted + (conv || 0),
        });
      }
    }
    return [...map.entries()]
      .filter(([, v]) => v.converted > 0)
      .sort((a, b) => b[1].converted - a[1].converted);
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') return;
    const { ok } = totalUsdAll();
    const dc = state.display_currency.toUpperCase();

    const pocketLabels = [];
    const pocketVals = [];
    for (const p of state.pockets) {
      const { usd: u } = pocketTotalUsd(p, rates);
      const v = usdToAmount(u, dc, rates);
      if (v == null || !ok) continue;
      pocketLabels.push(p.label || tplBadgeLabel(p.template_id));
      pocketVals.push(Math.max(0, v));
    }

    const ccyAgg = aggregateByCurrency();

    const cEl = document.getElementById('schet-chart-pockets');
    const cEl2 = document.getElementById('schet-chart-ccy');

    if (!cEl || !cEl2) return;

    document.querySelectorAll('[data-display-ccy-placeholder]').forEach((el) => {
      el.textContent = dc;
    });

    if (!pocketVals.length || pocketVals.every((x) => x === 0)) {
      destroyCharts();
      return;
    }

    const colors = pocketLabels.map(
      (_, i) => CHART_PALETTE[i % CHART_PALETTE.length],
    );
    const colors2 = ccyAgg.map(
      (_, i) => CHART_PALETTE[i % CHART_PALETTE.length],
    );

    const commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: cssVar('--foreground'),
            font: { family: 'Inter', size: 11 },
            boxWidth: 10,
          },
        },
      },
    };

    if (chartPocket) chartPocket.destroy();
    if (pocketChartType === 'bar') {
      chartPocket = new Chart(cEl, {
        type: 'bar',
        data: {
          labels: pocketLabels,
          datasets: [
            {
              label: i18n('schet.chart_share_label', 'Доля, {currency}', { currency: dc }),
              data: pocketVals,
              backgroundColor: colors,
              borderRadius: 6,
            },
          ],
        },
        options: {
          ...commonOpts,
          scales: {
            x: {
              ticks: { color: cssVar('--muted-foreground'), maxRotation: 45 },
              grid: { color: cssVar('--border') },
            },
            y: {
              ticks: { color: cssVar('--muted-foreground') },
              grid: { color: cssVar('--border') },
            },
          },
        },
      });
    } else {
      chartPocket = new Chart(cEl, {
        type: 'doughnut',
        data: {
          labels: pocketLabels,
          datasets: [
            {
              data: pocketVals,
              backgroundColor: colors,
              borderWidth: 2,
              borderColor: cssVar('--card'),
            },
          ],
        },
        options: {
          ...commonOpts,
          cutout: '62%',
        },
      });
    }

    if (chartCcy) chartCcy.destroy();
    if (ccyAgg.length) {
      chartCcy = new Chart(cEl2, {
        type: 'pie',
        data: {
          labels: ccyAgg.map(([c]) => c),
          datasets: [
            {
              data: ccyAgg.map(([, v]) => v.converted),
              backgroundColor: colors2,
              borderWidth: 2,
              borderColor: cssVar('--card'),
            },
          ],
        },
        options: {
          ...commonOpts,
          plugins: {
            ...commonOpts.plugins,
            tooltip: {
              callbacks: {
                label(ctx) {
                  const c = ctx.label;
                  const Um = uamt();
                  const item = ccyAgg.find((x) => x[0] === c);
                  const nominal = item ? item[1].nominal : ctx.raw;
                  const txt =
                    Um && typeof Um.formatCompact === 'function'
                      ? Um.formatCompact(nominal, c)
                      : `${nominal}\u202f${c}`;
                  return ` ${c}: ${txt}`;
                },
              },
            },
          },
        },
      });
    } else {
      chartCcy = null;
    }
  }

  function syncMovementControls() {
    const toolbar = document.querySelector('.schet-movement-toolbar');
    const preset = String(movementPeriod.preset || 'today');
    if (toolbar) toolbar.setAttribute('data-mode', preset);
    if (movementDatePicker && typeof movementDatePicker.setValue === 'function') {
      movementDatePicker.setValue({
        preset,
        date_from: movementPeriod.date_from || '',
        date_to: movementPeriod.date_to || '',
        label: movementPeriod.label || '',
      });
    }
  }

  function initMovementDatePicker() {
    const mount = document.getElementById('schet-period-picker');
    if (!mount || !window.UPOS_DATE_RANGE || movementDatePicker) return;
    movementDatePicker = window.UPOS_DATE_RANGE.create(mount, {
      preset: movementPeriod.preset || 'today',
      date_from: movementPeriod.date_from || '',
      date_to: movementPeriod.date_to || '',
      label: movementPeriod.label || '',
      onApply: (range) => {
        applyMovementPeriod({
          preset: range.preset || 'custom',
          date_from: range.date_from || '',
          date_to: range.date_to || range.date_from || '',
          label: range.label || '',
        });
      },
    });
  }

  async function applyMovementPeriod(next) {
    movementPeriod = {
      ...movementPeriod,
      ...next,
    };
    syncMovementControls();
    setStatus(i18n('schet.movement_loading', 'Обновление периода...'), null);
    const ok = await refreshTreasuryFromServer();
    if (ok) {
      syncSelectCcyOptions();
      renderDashboard();
      updateTotalsAndCharts();
      setStatus('');
    } else {
      setStatus(i18n('schet.load_err', 'Не удалось загрузить данные счёта.'), 'err');
    }
  }

  function cssVar(name) {
    return (
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
      '#888'
    );
  }

  function bindChrome() {
    document.getElementById('schet-open-editor')?.addEventListener('click', () => {
      openEditor();
    });
    document.getElementById('schet-empty-cta')?.addEventListener('click', () => {
      openEditor();
    });

    document.getElementById('schet-pockets')?.addEventListener('click', (ev) => {
      const editBtn = ev.target.closest('[data-edit-pocket]');
      if (editBtn) {
        const pid = String(
          editBtn.getAttribute('data-edit-pocket') || '',
        ).trim();
        openEditor(pid);
        return;
      }
      const card = ev.target.closest('[data-pocket-id]');
      const currencyLine = ev.target.closest('[data-detail-currency]');
      if (card && currencyLine) {
        const pid = String(card.getAttribute('data-pocket-id') || '').trim();
        const currency = String(currencyLine.getAttribute('data-detail-currency') || '').trim();
        openPocketDetail(pid, currency);
      }
    });

    document.getElementById('schet-pockets')?.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const currencyLine = ev.target.closest('[data-detail-currency]');
      const card = ev.target.closest('[data-pocket-id]');
      if (!card || !currencyLine) return;
      ev.preventDefault();
      const pid = String(card.getAttribute('data-pocket-id') || '').trim();
      const currency = String(currencyLine.getAttribute('data-detail-currency') || '').trim();
      openPocketDetail(pid, currency);
    });

    document.getElementById('schet-detail-close')?.addEventListener('click', closePocketDetail);
    document.getElementById('schet-detail-dialog')?.addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) closePocketDetail();
    });
    document.getElementById('schet-detail-dialog')?.addEventListener('click', (ev) => {
      const toggle = ev.target.closest('#schet-detail-filter-toggle');
      if (toggle) {
        detailFilter = { ...detailFilter, open: !detailFilter.open };
        renderActivePocketDetail();
        return;
      }
      const preset = ev.target.closest('[data-detail-filter-preset]');
      if (preset) {
        setDetailFilterPreset(preset.getAttribute('data-detail-filter-preset') || 'latest');
        return;
      }
      if (ev.target.closest('#schet-detail-filter-apply')) {
        applyCustomDetailFilter();
        return;
      }
      if (ev.target.closest('#schet-detail-filter-close')) {
        detailFilter = { ...detailFilter, open: false };
        renderActivePocketDetail();
      }
    });
    document.getElementById('schet-detail-dialog')?.addEventListener('close', () => {
      activeDetailPocketId = '';
      activeDetailCurrency = '';
      activeDetailTransactions = [];
      resetDetailFilter();
    });

    document.getElementById('schet-editor-cancel')?.addEventListener('click', () => {
      tryCloseEditor();
    });
    document.getElementById('schet-editor-close')?.addEventListener('click', () => {
      tryCloseEditor();
    });
    document.getElementById('schet-editor-save')?.addEventListener('click', () => {
      saveFromEditor();
    });

    const edlg = document.getElementById('schet-editor-dialog');
    edlg?.addEventListener('close', () => {
      pocketDraft = null;
      editorStep = 'pick';
      editorSelectedId = null;
      editorDirty = false;
      edlg.classList.remove('is-closing');
    });
    edlg?.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (editorDirty) {
        if (!window.confirm(i18n('schet.confirm.close', 'Закрыть без сохранения? Несохранённые изменения пропадут.'))) {
          return;
        }
      }
      editorDirty = false;
      pocketDraft = null;
      editorStep = 'pick';
      editorSelectedId = null;
      edlg.close();
    });

    document.getElementById('schet-tpl-close')?.addEventListener('click', () => {
      document.getElementById('schet-tpl-dialog')?.close();
    });

    document
      .getElementById('schet-display-ccy')
      ?.addEventListener('change', async (ev) => {
        state.display_currency = (ev.target.value || 'USD').toUpperCase();
        syncSelectCcyOptions();
        renderPocketsList();
        updateTotalsAndCharts();
        await saveDashboardDisplayCcyOnly();
      });

    document.querySelectorAll('[data-pocket-chart]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-pocket-chart]').forEach((b) =>
          b.classList.remove('active'),
        );
        btn.classList.add('active');
        pocketChartType = btn.getAttribute('data-pocket-chart') || 'doughnut';
        renderCharts();
      });
    });

    initMovementDatePicker();
  }

  async function main() {
    bindChrome();
    const ok = await loadBootstrap();
    if (!ok) return;
    await loadRates();
    syncMovementControls();
    renderDashboard();
    if (state.pockets.length) updateTotalsAndCharts();

    const refreshRatesIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      loadRates().then(() => {
        renderDashboard();
        updateTotalsAndCharts();
      });
    };

    window.setInterval(refreshRatesIfVisible, 60 * 1000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      refreshTreasuryFromServer().then((okTreasury) => {
        refreshRatesIfVisible();
        if (okTreasury) {
          syncSelectCcyOptions();
          syncMovementControls();
          renderDashboard();
          updateTotalsAndCharts();
        }
      });
    });
  }

  main();
  function isExistingPocket(pid) {
    return state.pockets.some(p => String(p.id) === String(pid));
  }

  function isExistingEntry(pid, eid) {
    const p = state.pockets.find(x => String(x.id) === String(pid));
    if (!p) return false;
    return (p.entries || []).some(e => String(e.id) === String(eid));
  }

  function confirmDeletion(message, onConfirm) {
    const dlg = document.getElementById('schet-confirm-dialog');
    const txt = document.getElementById('schet-confirm-text');
    const btnYes = document.getElementById('schet-confirm-yes');
    const btnNo = document.getElementById('schet-confirm-cancel');
    const btnClose = document.getElementById('schet-confirm-close');
    if (!dlg || !btnYes) return;

    txt.textContent = message;
    btnYes.disabled = true;
    
    let seconds = 5;
    btnYes.textContent = i18n('schet.confirm_yes_count', 'Да ({seconds})', { seconds });

    const timer = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(timer);
        btnYes.disabled = false;
        btnYes.textContent = i18n('schet.confirm_yes', 'Да');
      } else {
        btnYes.textContent = i18n('schet.confirm_yes_count', 'Да ({seconds})', { seconds });
      }
    }, 1000);

    const cleanup = () => {
      clearInterval(timer);
      btnYes.removeEventListener('click', onYes);
      btnNo.removeEventListener('click', onNo);
      btnClose.removeEventListener('click', onNo);
      dlg.close();
    };

    const onYes = () => {
      cleanup();
      onConfirm();
    };
    const onNo = () => {
      cleanup();
    };

    btnYes.addEventListener('click', onYes);
    btnNo.addEventListener('click', onNo);
    btnClose.addEventListener('click', onNo);

    dlg.showModal();
  }
})();
