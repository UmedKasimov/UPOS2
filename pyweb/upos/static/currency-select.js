/**
 * Custom currency select: icon + currency code.
 */
(() => {
  const meta = () => window.UPOS_CCY;

  function closeAll(exceptWrap) {
    document.querySelectorAll('.upos-ccy-select.is-open').forEach((w) => {
      if (w !== exceptWrap) {
        w.classList.remove('is-open');
        const p = w.querySelector('.upos-ccy-select-panel');
        if (p) p.hidden = true;
      }
    });
  }

  function optionCode(opt) {
    return String(opt?.value || '').toUpperCase();
  }

  function optionBalanceLabel(opt) {
    const explicit = String(opt?.dataset?.balanceLabel || '').trim();
    if (explicit) return explicit;
    const text = String(opt?.textContent || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/(?:^|·)\s*доступно\s+(.+)$/i);
    return match ? match[1].trim() : '';
  }

  function rebuildPanel(wrap, select) {
    const panel = wrap.querySelector('.upos-ccy-select-panel');
    if (!panel) return;
    panel.innerHTML = '';
    [...select.options].forEach((opt) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      const v = opt.value;
      li.dataset.value = v;
      li.className = 'upos-ccy-select-item';
      if (!v) {
        li.classList.add('is-placeholder');
        li.textContent = opt.textContent || '-';
        li.dataset.value = '';
      } else {
        const cc = meta();
        const code = optionCode(opt);
        const ic = cc && cc.iconHtmlSmall && code ? cc.iconHtmlSmall(code) : '';
        const balance = optionBalanceLabel(opt);
        const bal = balance ? `<span class="upos-ccy-select-item-balance">${escapeHtml(balance)}</span>` : '';
        if (balance) li.classList.add('has-balance');
        li.innerHTML = `${ic}<span class="upos-ccy-select-item-code">${escapeHtml(code)}</span>${bal}`;
      }
      if (opt.selected) li.classList.add('is-selected');
      panel.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function syncButton(btn, select) {
    btn.disabled = select.disabled;
    const opt = select.options[select.selectedIndex];
    const v = select.value;
    const cc = meta();
    if (!opt || (!v && !opt.textContent.trim())) {
      btn.innerHTML = `<span class="upos-ccy-select-btn-ph">${escapeHtml(opt?.textContent || '...')}</span>`;
      return;
    }
    const code = v ? optionCode(opt) : '';
    const ic = cc && cc.iconHtmlSmall && code ? cc.iconHtmlSmall(code) : '';
    const balance = optionBalanceLabel(opt);
    const bal = balance ? `<span class="upos-ccy-select-item-balance">${escapeHtml(balance)}</span>` : '';
    const label = code
      ? `<span class="upos-ccy-select-btn-main">${ic}<span class="upos-ccy-select-btn-code">${escapeHtml(code)}</span></span>${bal}`
      : `<span class="upos-ccy-select-btn-plain">${escapeHtml(opt.textContent || '')}</span>`;
    btn.innerHTML = `${label}<svg class="upos-ccy-chevron" width="14" height="14" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>`;
  }

  function enhanceCurrencySelect(select) {
    if (!select || select.dataset.ccyEnhanced === '1') return;
    const wrap = document.createElement('div');
    wrap.className = 'upos-ccy-select';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'upos-ccy-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('ul');
    panel.className = 'upos-ccy-select-panel';
    panel.setAttribute('role', 'listbox');
    panel.hidden = true;

    wrap.insertBefore(btn, select);
    wrap.insertBefore(panel, select);
    select.classList.add('upos-ccy-select-native');
    select.dataset.ccyEnhanced = '1';

    rebuildPanel(wrap, select);
    syncButton(btn, select);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = wrap.classList.contains('is-open');
      if (wasOpen) {
        wrap.classList.remove('is-open');
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
      closeAll(null);
      rebuildPanel(wrap, select);
      wrap.classList.add('is-open');
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    });

    wrap.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    panel.addEventListener('click', (ev) => {
      const item = ev.target.closest('.upos-ccy-select-item');
      if (!item || wrap !== item.closest('.upos-ccy-select')) return;
      const val = item.dataset.value;
      if (typeof val !== 'string') return;
      const opt = [...select.options].find((o) => o.value === val);
      if (!opt || opt.disabled) return;
      select.value = val;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('input', { bubbles: true }));
      rebuildPanel(wrap, select);
      syncButton(btn, select);
      wrap.classList.remove('is-open');
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });

    select.addEventListener('change', () => {
      rebuildPanel(wrap, select);
      syncButton(btn, select);
    });

    const mo = new MutationObserver(() => {
      rebuildPanel(wrap, select);
      syncButton(btn, select);
    });
    mo.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

    document.addEventListener('click', () => {
      wrap.classList.remove('is-open');
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && wrap.classList.contains('is-open')) {
        wrap.classList.remove('is-open');
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function upgradeAll(scope) {
    const root = scope || document;
    root.querySelectorAll('select[data-ccy-enhance]').forEach(enhanceCurrencySelect);
  }

  window.UPOS_CCY_SELECT = { enhanceCurrencySelect, upgradeAll };
})();
