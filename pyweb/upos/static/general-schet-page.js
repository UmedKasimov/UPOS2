/**
 * General account: consolidated balances by organization.
 */
(function () {
  const root = document.getElementById('general-schet-root');
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

  const state = {
    displayCurrency: 'USD',
    pendingTemplate: 'cash',
    pendingTemplateLabel: 'Наличные',
    pendingOrg: null,
  };

  const walletTemplates = [
    { id: 'cash', icon: '▣', title: 'Наличные', note: 'Касса, сейф, оборотная касса' },
    { id: 'bank', icon: '▥', title: 'Расчётный счёт', note: 'Юрлицо в банке Узбекистана' },
    { id: 'transit', icon: '▦', title: 'Транзит / лицевой счёт', note: 'Счёт компании для перечислений' },
    { id: 'card', icon: '▭', title: 'Банковская карта', note: 'Humo, Uzcard, Visa, Mastercard' },
    { id: 'wallet', icon: '▯', title: 'Мобильные кошельки', note: 'Payme, Click, Uzum Bank и др.' },
    { id: 'currency', icon: '◎', title: 'Валютный счёт', note: 'USD / EUR в узбекском банке' },
    { id: 'safe', icon: '▤', title: 'Сейф / резерв', note: 'Заначка, запас наличных' },
    { id: 'crypto', icon: '◉', title: 'Криптоактивы', note: 'Биржа, холодный кошелёк' },
    { id: 'custom', icon: '✎', title: 'Своё место', note: 'Произвольное название и заметка' },
  ];

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
    if (!Number.isFinite(x)) return '-';
    const cur = String(ccy || '').trim().toUpperCase();
    const sign = x < 0 ? '-' : '';
    const amount = Math.round(Math.abs(x)).toLocaleString('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return cur ? `${sign}${amount} ${cur}` : `${sign}${amount}`;
  }

  function buildQuery() {
    const q = new URLSearchParams();
    q.set('display_currency', state.displayCurrency);
    return q.toString();
  }

  function showOverviewSkeleton() {
    const el = root.querySelector('[data-gs-overview]');
    if (el) {
      el.innerHTML = `<div class="gk-skeleton-grid" aria-hidden="true">${'<div class="gk-skeleton"></div>'.repeat(3)}</div>`;
    }
  }

  function renderOverview(data) {
    const el = root.querySelector('[data-gs-overview]');
    if (!el || !data) return;

    const fxWarn = [];
    if (data.fx?.stale) fxWarn.push(t('general.fx_stale', 'FX rates may be stale.'));
    if ((data.fx_missing_currencies || []).length) {
      fxWarn.push(tf('general.fx_missing', { list: data.fx_missing_currencies.join(', ') }, 'Missing rates for: {list}'));
    }

    const approx =
      data.approx_total_in_display != null
        ? formatMoney(data.approx_total_in_display, data.display_currency)
        : '-';

    const chips =
      Object.entries(data.consolidated_totals_by_currency || {})
        .filter(([, v]) => Number(v))
        .map(([ccy, amt]) => `<span class="general-kassa-chip">${escapeHtml(formatMoney(amt, ccy))}</span>`)
        .join('') || `<span class="general-kassa-chip-muted">${escapeHtml(t('general.no_balances', 'No balances'))}</span>`;

    el.innerHTML = `
      <p class="settings-ios-footnote">${escapeHtml(t('general.schet.consolidated', 'Consolidated account'))}</p>
      <p class="gk-schet-hero-total">${escapeHtml(approx)}</p>
      <p class="gk-schet-hero-meta">${escapeHtml(tf('general.estimated_in', { currency: data.display_currency || 'USD' }, 'Estimated in {currency}'))}${fxWarn.length ? ` · ${escapeHtml(fxWarn.join(' '))}` : ''}</p>
      <div class="gk-schet-hero-chips" role="group" aria-label="${escapeHtml(t('general.balances_by_currency', 'Balances by currency'))}">${chips}</div>
    `;
  }

  function renderOrgList(data) {
    const body = root.querySelector('[data-gs-body]');
    if (!body) return;

    const orgs = data?.organizations || [];
    if (!orgs.length) {
      body.innerHTML = `<div class="gk-empty-state">
        <span class="organizations-panel-icon" aria-hidden="true">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </span>
        <p>${escapeHtml(t('general.schet.empty', 'No organization data. Open a specific organization account to configure it.'))}</p>
      </div>`;
      return;
    }

    body.innerHTML = orgs
      .map((org) => {
        const orgId = orgKey(org);
        const openUrl = `/organizations/open-schet?organization_id=${encodeURIComponent(orgId)}`;
        const pockets = (org.pockets || [])
          .map(
            (p) => `<div class="gk-org-pocket">
              <span class="gk-org-pocket-label">${escapeHtml(p.label || '-')}</span>
            </div>`,
          )
          .join('');

        return `<article class="organization-card gk-org-card">
          <header class="gk-org-card-head">
            <div>
              <h3 class="gk-org-card-title">${escapeHtml(org.organization_name || '')}</h3>
            </div>
            <div class="gk-org-card-actions">
              <button
                type="button"
                class="btn btn-secondary gk-open-btn"
                data-gs-add-wallet
                data-org-id="${escapeHtml(orgId)}"
              >${escapeHtml(t('general.add_account', 'Добавить счёт'))}</button>
              <a class="btn btn-secondary gk-open-btn" href="${openUrl}">${escapeHtml(t('general.open_account', 'Open account'))}</a>
            </div>
          </header>
          <div class="gk-org-card-pockets">${pockets || `<p class="general-kassa-chip-muted">${escapeHtml(t('general.no_accounts', 'No accounts'))}</p>`}</div>
        </article>`;
      })
      .join('');
    root._generalSchetData = data;
  }

  function render(data) {
    renderOverview(data);
    renderOrgList(data);
  }

  async function load() {
    showOverviewSkeleton();
    const status = root.querySelector('[data-gs-status]');
    if (status) status.textContent = '';
    try {
      const res = await fetch(`/api/director/consolidated-treasury?${buildQuery()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      render(data);
    } catch (e) {
      const overview = root.querySelector('[data-gs-overview]');
      if (overview) overview.innerHTML = '';
      const body = root.querySelector('[data-gs-body]');
      if (body) body.innerHTML = `<div class="general-kassa-error">${escapeHtml(e.message || t('general.error_loading', 'Loading error'))}</div>`;
    }
  }

  function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  function orgKey(org) {
    return String(org?.organization_id || org?.id || '').trim();
  }

  function orgById(id) {
    const wanted = String(id || '').trim();
    const list = root._generalSchetData?.organizations || [];
    return list.find((org) => orgKey(org) === wanted) || null;
  }

  function apiErrorMessage(code) {
    const key = String(code || '').trim();
    const messages = {
      organization_required: 'Выберите организацию.',
      organization_not_allowed: 'Организация не найдена или недоступна.',
      employee_not_allowed: 'Этот сотрудник не относится к выбранной организации.',
      csrf: 'Сессия устарела. Обновите страницу и попробуйте снова.',
      forbidden: 'Недостаточно прав для этого действия.',
      workspace: 'Не удалось открыть рабочую область организации.',
      json: 'Не удалось прочитать данные формы.',
    };
    return messages[key] || key || 'Не удалось сохранить счёт.';
  }

  function defaultLabelForTemplate(id) {
    return (walletTemplates.find((item) => item.id === id) || walletTemplates[0]).title;
  }

  function renderTemplateOptions(selected) {
    return walletTemplates
      .map((item) => {
        const active = item.id === selected ? ' is-active' : '';
        return `<button type="button" class="gs-wallet-template${active}" data-gs-template="${escapeHtml(item.id)}">
          <span class="gs-wallet-template-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
          <span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.note)}</small>
          </span>
        </button>`;
      })
      .join('');
  }

  function renderEmployeeOptions(org, selectedId) {
    const employees = Array.isArray(org?.employees) ? org.employees : [];
    if (!employees.length) return '<option value="">Сотрудников нет</option>';
    return [
      '<option value="">Без сотрудника</option>',
      ...employees.map((emp) => {
        const value = String(emp.id || '');
        const selected = value === String(selectedId || '') ? ' selected' : '';
        const label = `${emp.name || emp.username || 'Сотрудник'}${emp.position ? ` · ${emp.position}` : ''}`;
        return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
      }),
    ].join('');
  }

  function openWalletDialog(orgId) {
    const org = orgById(orgId);
    if (!org) return;
    state.pendingOrg = org;
    state.pendingTemplate = 'cash';
    state.pendingTemplateLabel = defaultLabelForTemplate(state.pendingTemplate);
    const dialog = document.getElementById('gs-wallet-dialog');
    const orgName = dialog.querySelector('[data-gs-wallet-org]');
    const label = dialog.querySelector('[data-gs-wallet-label]');
    const employee = dialog.querySelector('[data-gs-wallet-employee]');
    const templates = dialog.querySelector('[data-gs-wallet-templates]');
    const status = dialog.querySelector('[data-gs-wallet-status]');
    if (orgName) orgName.textContent = org.organization_name || '';
    if (label) label.value = defaultLabelForTemplate(state.pendingTemplate);
    if (employee) employee.innerHTML = renderEmployeeOptions(org, '');
    if (templates) templates.innerHTML = renderTemplateOptions(state.pendingTemplate);
    if (status) status.textContent = '';
    dialog.showModal();
  }

  function closeWalletDialog() {
    document.getElementById('gs-wallet-dialog')?.close();
  }

  async function submitWalletDialog(ev) {
    ev.preventDefault();
    const dialog = document.getElementById('gs-wallet-dialog');
    const status = dialog.querySelector('[data-gs-wallet-status]');
    const submit = dialog.querySelector('[data-gs-wallet-submit]');
    const org = state.pendingOrg;
    if (!org) return;
    const orgId = orgKey(org);
    const label = String(dialog.querySelector('[data-gs-wallet-label]')?.value || '').trim();
    const employeeId = String(dialog.querySelector('[data-gs-wallet-employee]')?.value || '').trim();
    if (!orgId) {
      if (status) status.textContent = 'Выберите организацию.';
      return;
    }
    if (!label) {
      if (status) status.textContent = 'Введите название счёта.';
      return;
    }
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Сохраняю...';
    try {
      const res = await fetch('/api/director/organization-wallets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken(),
        },
        body: JSON.stringify({
          organization_id: orgId,
          template_id: state.pendingTemplate,
          label,
          owner_employee_id: employeeId,
          entries: [],
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
      closeWalletDialog();
      await load();
    } catch (err) {
      if (status) status.textContent = apiErrorMessage(err.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function mount() {
    root.innerHTML = `
      <section class="gk-schet-hero" data-gs-overview aria-label="${escapeHtml(t('general.summary', 'Summary'))}"></section>
      <p class="general-kassa-status" data-gs-status="" aria-live="polite"></p>
      <section class="gk-table-board organizations-board">
        <div class="organizations-card-grid gk-org-card-grid" data-gs-body></div>
      </section>
      <dialog class="gs-wallet-dialog" id="gs-wallet-dialog">
        <form class="gs-wallet-modal" data-gs-wallet-form>
          <header class="gs-wallet-modal-head">
            <div>
              <p class="settings-ios-footnote">Новый счёт</p>
              <h2 class="gs-wallet-modal-title" data-gs-wallet-org></h2>
            </div>
            <button type="button" class="settings-profile-modal-close" data-gs-wallet-close aria-label="Закрыть">×</button>
          </header>
          <div class="gs-wallet-modal-body">
            <label class="gs-wallet-field">
              <span>Название счёта</span>
              <input type="text" data-gs-wallet-label autocomplete="off" />
            </label>
            <label class="gs-wallet-field">
              <span>Прикрепить сотрудника</span>
              <select data-gs-wallet-employee></select>
            </label>
            <div class="gs-wallet-template-grid" data-gs-wallet-templates></div>
            <p class="general-kassa-status" data-gs-wallet-status aria-live="polite"></p>
          </div>
          <footer class="gs-wallet-modal-actions">
            <button type="button" class="btn btn-secondary" data-gs-wallet-close>Отмена</button>
            <button type="submit" class="btn" data-gs-wallet-submit>Добавить счёт</button>
          </footer>
        </form>
      </dialog>
    `;

    root.addEventListener('click', (ev) => {
      const add = ev.target.closest('[data-gs-add-wallet]');
      if (add) {
        openWalletDialog(add.getAttribute('data-org-id') || '');
        return;
      }
      const template = ev.target.closest('[data-gs-template]');
      if (template) {
        const previousLabel = state.pendingTemplateLabel || defaultLabelForTemplate(state.pendingTemplate);
        state.pendingTemplate = template.getAttribute('data-gs-template') || 'custom';
        state.pendingTemplateLabel = defaultLabelForTemplate(state.pendingTemplate);
        const dialog = document.getElementById('gs-wallet-dialog');
        const templates = dialog?.querySelector('[data-gs-wallet-templates]');
        const label = dialog?.querySelector('[data-gs-wallet-label]');
        if (templates) templates.innerHTML = renderTemplateOptions(state.pendingTemplate);
        if (label && (!String(label.value || '').trim() || String(label.value || '').trim() === previousLabel)) {
          label.value = state.pendingTemplateLabel;
        }
        return;
      }
      if (ev.target.closest('[data-gs-wallet-close]')) {
        closeWalletDialog();
      }
    });
    root.querySelector('[data-gs-wallet-form]')?.addEventListener('submit', submitWalletDialog);
    load();
  }

  mount();
})();
