(() => {
  const TABLE_SELECTOR = 'table.org-ops-table';
  const READY_ATTR = 'data-upos-column-controls-ready';
  const CONTROL_CELL = 'upos-table-column-control-cell';
  const HIDDEN_CLASS = 'upos-table-column-hidden';
  const MENU_OPEN_CLASS = 'is-column-menu-open';

  function cleanLabel(value, fallback) {
    const label = String(value || '')
      .replace(/[↕↑↓⌄^]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return label || fallback;
  }

  function directCells(row) {
    return Array.from(row?.children || []).filter((cell) => !cell.classList.contains(CONTROL_CELL));
  }

  function headerRow(table) {
    const rows = Array.from(table.tHead?.rows || []);
    return rows[rows.length - 1] || null;
  }

  function columns(table) {
    return directCells(headerRow(table)).map((cell, index) => ({
      index,
      label: cleanLabel(cell.getAttribute('data-column-label') || cell.textContent, `Столбец ${index + 1}`),
    }));
  }

  function tableIndex(table) {
    return Array.from(document.querySelectorAll(TABLE_SELECTOR)).indexOf(table);
  }

  function storageKey(table) {
    const panel = table.closest('[id]');
    const key = table.id || panel?.id || table.className || 'table';
    return `upos.tableColumns:${location.pathname}:${key}:${tableIndex(table)}`;
  }

  function readHidden(table) {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey(table)) || '[]');
      return new Set(Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : []);
    } catch {
      return new Set();
    }
  }

  function saveHidden(table, hidden) {
    try {
      localStorage.setItem(storageKey(table), JSON.stringify([...hidden].sort((a, b) => a - b)));
    } catch {
      /* localStorage may be unavailable. */
    }
  }

  function visibleCount(table, hidden) {
    return Math.max(1, columns(table).filter((column) => !hidden.has(column.index)).length);
  }

  function syncPlaceholder(row, table, hidden) {
    const cells = directCells(row);
    if (cells.length !== 1 || Number(cells[0].getAttribute('colspan') || cells[0].colSpan || 1) <= 1) return false;
    cells[0].colSpan = visibleCount(table, hidden) + 1;
    return true;
  }

  function ensureBodyControlCells(table) {
    const groups = [...Array.from(table.tBodies || []), table.tFoot].filter(Boolean);
    groups.forEach((group) => {
      Array.from(group.rows || []).forEach((row) => {
        if (row.querySelector(`:scope > .${CONTROL_CELL}`)) return;
        if (directCells(row).length === 1 && Number(directCells(row)[0].getAttribute('colspan') || directCells(row)[0].colSpan || 1) > 1) return;
        const cell = document.createElement('td');
        cell.className = CONTROL_CELL;
        cell.setAttribute('aria-hidden', 'true');
        row.append(cell);
      });
    });
  }

  function applyVisibility(table) {
    const hidden = readHidden(table);
    const rows = [
      ...Array.from(table.tHead?.rows || []),
      ...Array.from(table.tBodies || []).flatMap((body) => Array.from(body.rows || [])),
      ...Array.from(table.tFoot?.rows || []),
    ];
    rows.forEach((row) => {
      if (syncPlaceholder(row, table, hidden)) return;
      directCells(row).forEach((cell, index) => {
        cell.classList.toggle(HIDDEN_CLASS, hidden.has(index));
      });
    });
  }

  function closeMenus(except = null) {
    document.querySelectorAll('.upos-table-column-control').forEach((root) => {
      if (root === except) return;
      root.classList.remove(MENU_OPEN_CLASS);
      const button = root.querySelector('[data-upos-column-menu-toggle]');
      const menu = root._uposColumnMenu || root.querySelector('[data-upos-column-menu]');
      if (button) button.setAttribute('aria-expanded', 'false');
      if (menu) menu.hidden = true;
    });
  }

  function positionMenu(button, menu) {
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const gap = 6;
    const width = Math.min(280, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
    const below = window.innerHeight - rect.bottom - gap - 12;
    const above = rect.top - gap - 12;
    const openAbove = below < 220 && above > below;
    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.top = openAbove ? 'auto' : `${rect.bottom + gap}px`;
    menu.style.bottom = openAbove ? `${window.innerHeight - rect.top + gap}px` : 'auto';
    menu.style.maxHeight = `${Math.max(180, Math.min(360, openAbove ? above : below))}px`;
  }

  function renderMenu(table, root) {
    const menu = root?._uposColumnMenu || root?.querySelector('[data-upos-column-menu]');
    if (!menu) return;
    const hidden = readHidden(table);
    const list = columns(table);
    menu.replaceChildren();

    const title = document.createElement('div');
    title.className = 'upos-table-column-menu-title';
    title.textContent = 'Столбцы таблицы';
    menu.append(title);

    list.forEach((column) => {
      const label = document.createElement('label');
      label.className = 'upos-table-column-choice';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !hidden.has(column.index);
      input.dataset.uposColumnIndex = String(column.index);
      const text = document.createElement('span');
      text.textContent = column.label;
      label.append(input, text);
      menu.append(label);
    });

    const footer = document.createElement('button');
    footer.type = 'button';
    footer.className = 'upos-table-column-reset';
    footer.textContent = 'Показать все';
    footer.dataset.uposColumnReset = '1';
    menu.append(footer);
  }

  function createControl(table) {
    const th = document.createElement('th');
    th.className = CONTROL_CELL;
    th.scope = 'col';

    const root = document.createElement('div');
    root.className = 'upos-table-column-control';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'upos-table-column-btn';
    button.dataset.uposColumnMenuToggle = '1';
    button.title = 'Настроить столбцы';
    button.setAttribute('aria-label', 'Настроить столбцы таблицы');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.36a1.7 1.7 0 0 0-1 .16 1.7 1.7 0 0 0-1 1.56V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1-.16 1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-.16-1 1.7 1.7 0 0 0-1.56-1H3a2 2 0 0 1 0-4h.08a1.7 1.7 0 0 0 1.56-1 1.7 1.7 0 0 0 .16-1 1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-.16 1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1 .16 1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.36 9c.06.34.12.68.16 1H21a2 2 0 0 1 0 4h-.08a1.7 1.7 0 0 0-1.56 1Z" />
      </svg>
    `;

    const menu = document.createElement('div');
    menu.className = 'upos-table-column-menu';
    menu.dataset.uposColumnMenu = '1';
    menu.hidden = true;

    root.append(button, menu);
    root._uposColumnMenu = menu;
    menu._uposColumnRoot = root;
    menu._uposColumnTable = table;
    th.append(root);
    renderMenu(table, root);
    return th;
  }

  function initTable(table) {
    if (!table || table.getAttribute(READY_ATTR) === '1' || table.hasAttribute('data-upos-no-column-controls')) return;
    const row = headerRow(table);
    if (!row || columns(table).length < 2) return;
    table.setAttribute(READY_ATTR, '1');
    table.classList.add('upos-table-with-column-controls');
    row.append(createControl(table));
    ensureBodyControlCells(table);
    applyVisibility(table);
  }

  function initAll(root = document) {
    root.querySelectorAll(TABLE_SELECTOR).forEach(initTable);
  }

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-upos-column-menu-toggle]');
    if (toggle) {
      const root = toggle.closest('.upos-table-column-control');
      const table = toggle.closest('table');
      if (!root || !table) return;
      closeMenus(root);
      renderMenu(table, root);
      const menu = root._uposColumnMenu || root.querySelector('[data-upos-column-menu]');
      if (menu && menu.parentElement !== document.body) document.body.append(menu);
      const open = menu?.hidden;
      if (menu) menu.hidden = !open;
      if (open) positionMenu(toggle, menu);
      root.classList.toggle(MENU_OPEN_CLASS, Boolean(open));
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }

    const reset = event.target.closest('[data-upos-column-reset]');
    if (reset) {
      const table = reset.closest('[data-upos-column-menu]')?._uposColumnTable || reset.closest('table');
      if (!table) return;
      localStorage.removeItem(storageKey(table));
      renderMenu(table, reset.closest('[data-upos-column-menu]')?._uposColumnRoot || reset.closest('.upos-table-column-control'));
      applyVisibility(table);
      return;
    }

    if (!event.target.closest('.upos-table-column-control') && !event.target.closest('[data-upos-column-menu]')) closeMenus();
  });

  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-upos-column-index]');
    if (!input) return;
    const table = input.closest('[data-upos-column-menu]')?._uposColumnTable || input.closest('table');
    if (!table) return;
    const hidden = readHidden(table);
    const index = Number(input.dataset.uposColumnIndex);
    if (input.checked) hidden.delete(index);
    else hidden.add(index);
    saveHidden(table, hidden);
    applyVisibility(table);
  });

  function repositionOpenMenus() {
    document.querySelectorAll('.upos-table-column-control.is-column-menu-open').forEach((root) => {
      const button = root.querySelector('[data-upos-column-menu-toggle]');
      const menu = root._uposColumnMenu || root.querySelector('[data-upos-column-menu]');
      if (menu && !menu.hidden) positionMenu(button, menu);
    });
  }

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(TABLE_SELECTOR)) initTable(node);
        initAll(node);
        const table = node.closest?.(TABLE_SELECTOR);
        if (table?.getAttribute(READY_ATTR) === '1') {
          ensureBodyControlCells(table);
          applyVisibility(table);
        }
      });
    });
  });

  window.addEventListener('resize', repositionOpenMenus);
  window.addEventListener('scroll', repositionOpenMenus, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAll();
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  } else {
    initAll();
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
