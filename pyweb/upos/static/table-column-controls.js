(() => {
  const TABLE_SELECTOR = 'table.org-ops-table, table[data-upos-column-controls]';
  const READY_ATTR = 'data-upos-column-controls-ready';
  const CONTROL_CELL = 'upos-table-column-control-cell';
  const HIDDEN_CLASS = 'upos-table-column-hidden';
  const MENU_OPEN_CLASS = 'is-column-menu-open';
  const CELL_KEY_ATTR = 'data-upos-column-cell-key';
  const ORDER_STORAGE_SUFFIX = ':order';
  const WIDTH_STORAGE_SUFFIX = ':widths';
  const MIN_COLUMN_WIDTH = 48;
  // Столбцы с постоянной шириной: тянуть там нечего, а из общего
  // распределения ширин они раздувались до размера обычной колонки.
  const FIXED_WIDTH_COLUMNS = [
    { selector: '.products-check-col, .clients-map-select-column, .kassa-col-select', width: 44 },
    { selector: '.products-photo-col', width: 72 },
    { selector: '.clients-col-id', width: 96 },
    { selector: '.clients-col-own', width: 116 },
  ];

  function fixedCellWidth(cell) {
    if (!cell || !cell.matches) return 0;
    for (const item of FIXED_WIDTH_COLUMNS) {
      if (cell.matches(item.selector)) return item.width;
    }
    // Узнаём и по содержимому: внутри только галочка и больше ничего.
    const checkbox = cell.querySelector(':scope > input[type="checkbox"]');
    return checkbox && !cell.textContent.trim() ? 44 : 0;
  }

  function isFixedWidthCell(cell) {
    return fixedCellWidth(cell) > 0;
  }
  function minimumCellWidth(cell) {
    const requested = Number(cell?.dataset?.uposMinWidth);
    const configured = Number.isFinite(requested) && requested > MIN_COLUMN_WIDTH
      ? Math.min(MAX_COLUMN_WIDTH, requested)
      : MIN_COLUMN_WIDTH;
    return cell?.classList?.contains('upos-table-column-control-slot')
      ? Math.max(72, configured)
      : configured;
  }

  function minimumColumnWidth(table, key) {
    const cell = directCells(headerRow(table))
      .find((item) => item.getAttribute(CELL_KEY_ATTR) === key);
    return minimumCellWidth(cell);
  }

  const MAX_COLUMN_WIDTH = 720;
  let draggedColumn = null;
  let draggedHeaderColumn = null;
  let resizedColumn = null;
  const TEXT_DROP_TABLE_SELECTOR = [
    'table[data-upos-column-controls]',
    'table.products-table',
    'table.org-ops-table',
    'table.kassa-table',
    'table.general-kassa-table',
    'table.reports-data-table',
    'table.warehouse-purchases-table',
    'table.org-balance-table',
    'table.roles-permission-table',
    'table.pnl-table',
  ].join(', ');

  function cleanLabel(value, fallback) {
    const label = String(value || '')
      .replace(/[↕↑↓⌄^]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return label || fallback;
  }

  const FILLER_CELL = 'upos-table-filler';

  function directCells(row) {
    return Array.from(row?.children || []).filter(
      (cell) => !cell.classList.contains(CONTROL_CELL) && !cell.classList.contains(FILLER_CELL),
    );
  }

  /* Пустых колонок-заполнителей быть не должно: свободное место занимают
     сами колонки (см. captureBaseWidths — ширины растягиваются на всю
     таблицу). Старые заполнители из ранее отрисованных таблиц убираем. */
  function ensureFillerCells(table) {
    table.querySelectorAll(`.${FILLER_CELL}`).forEach((cell) => cell.remove());
  }

  function hasTextSelection() {
    const selection = window.getSelection?.();
    return Boolean(selection && !selection.isCollapsed && String(selection).trim());
  }

  function hasControlSelection(target) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
    const start = Number(target.selectionStart ?? 0);
    const end = Number(target.selectionEnd ?? 0);
    return end > start && target.value.slice(start, end).trim().length > 0;
  }

  function isRealColumnHeaderDrag(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-upos-header-drag-handle]')) return true;
    const header = target.closest('th[draggable="true"], th.clients-table-movable-column');
    return Boolean(header && !target.closest('input, textarea, select, button, a, [contenteditable="true"]'));
  }

  function isTableTextDropTarget(target) {
    if (!(target instanceof Element)) return false;
    const table = target.closest(TEXT_DROP_TABLE_SELECTOR);
    if (!table) return false;
    return Boolean(target.closest('td, input, textarea, select, output, [contenteditable="true"]'));
  }

  function dataTransferHasText(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes('text/plain') || types.includes('text/html') || types.includes('Text');
  }

  function installTextDragGuard() {
    if (document.documentElement.dataset.uposTableTextDragGuard === '1') return;
    document.documentElement.dataset.uposTableTextDragGuard = '1';

    document.addEventListener('dragstart', (event) => {
      if (isRealColumnHeaderDrag(event.target)) return;
      if ((hasTextSelection() || hasControlSelection(event.target)) && isTableTextDropTarget(event.target)) {
        event.preventDefault();
      }
    }, true);

    document.addEventListener('dragover', (event) => {
      if (!isTableTextDropTarget(event.target) || !dataTransferHasText(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    }, true);

    document.addEventListener('drop', (event) => {
      if (!isTableTextDropTarget(event.target) || !dataTransferHasText(event)) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function headerRow(table) {
    const rows = Array.from(table.tHead?.rows || []);
    return rows[rows.length - 1] || null;
  }

  function tableRows(table) {
    return [
      ...Array.from(table.tHead?.rows || []),
      ...Array.from(table.tBodies || []).flatMap((body) => Array.from(body.rows || [])),
      ...Array.from(table.tFoot?.rows || []),
    ];
  }

  function ensureColumnKeys(table) {
    const row = headerRow(table);
    const headerCells = directCells(row);
    if (!headerCells.length) return [];

    const defaults = Array.isArray(table._uposDefaultColumnOrder)
      ? [...table._uposDefaultColumnOrder]
      : [];
    const used = new Set();
    const headerKeys = headerCells.map((cell, index) => {
      const preferred = cell.dataset.columnKey
        || cell.getAttribute(CELL_KEY_ATTR)
        || defaults[index]
        || String(index);
      let key = String(preferred);
      let suffix = 2;
      while (used.has(key)) {
        key = `${preferred}-${suffix}`;
        suffix += 1;
      }
      used.add(key);
      cell.dataset.columnKey = key;
      cell.setAttribute(CELL_KEY_ATTR, key);
      return key;
    });

    if (!defaults.length) {
      table._uposDefaultColumnOrder = [...headerKeys];
    } else {
      headerKeys.forEach((key) => {
        if (!defaults.includes(key)) defaults.push(key);
      });
      table._uposDefaultColumnOrder = defaults;
    }

    const defaultOrder = table._uposDefaultColumnOrder;
    tableRows(table).forEach((tableRow) => {
      if (tableRow === row) return;
      const cells = directCells(tableRow);
      if (cells.length !== defaultOrder.length) return;
      cells.forEach((cell, index) => {
        if (!cell.hasAttribute(CELL_KEY_ATTR)) {
          cell.setAttribute(CELL_KEY_ATTR, defaultOrder[index]);
        }
      });
    });
    return headerKeys;
  }

  function columns(table) {
    ensureColumnKeys(table);
    return directCells(headerRow(table)).map((cell, index) => ({
      index,
      key: cell.dataset.columnKey || String(index),
      label: cleanLabel(cell.getAttribute('data-column-label') || cell.textContent, `Столбец ${index + 1}`),
    }));
  }

  function tableIndex(table) {
    return Array.from(document.querySelectorAll(TABLE_SELECTOR)).indexOf(table);
  }

  function legacyStorageKey(table) {
    const panel = table.closest('[id]');
    const key = table.id || panel?.id || table.className || 'table';
    return `upos.tableColumns:${location.pathname}:${key}:${tableIndex(table)}`;
  }

  function storageKey(table) {
    const user = document.body?.dataset.userId || 'anonymous';
    if (table.dataset.uposTableStorageKey || table.id) {
      return `upos.tableColumns.v2:${user}:${location.pathname}:${table.dataset.uposTableStorageKey || table.id}`;
    }
    if (!table._uposStorageIdentity) {
      const panel = table.parentElement?.closest('[id]') || document.body;
      const parts = [];
      for (let node = table; node && node !== panel; node = node.parentElement) {
        const siblings = Array.from(node.parentElement?.children || [])
          .filter((item) => item.tagName === node.tagName);
        parts.unshift(`${node.tagName.toLowerCase()}${siblings.indexOf(node)}`);
      }
      table._uposStorageIdentity = `${panel.id || 'page'}:${parts.join('/')}`;
    }
    return `upos.tableColumns.v2:${user}:${location.pathname}:${table._uposStorageIdentity}`;
  }

  function readStored(table, suffix, fallback) {
    const key = `${storageKey(table)}${suffix}`;
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved;
    const oldKey = `${legacyStorageKey(table)}${suffix}`;
    let legacy = localStorage.getItem(oldKey);
    if (legacy === null && table.id) {
      const prefix = `upos.tableColumns:${location.pathname}:${table.id}:`;
      const matching = Object.keys(localStorage).filter((item) => {
        if (!item.startsWith(prefix)) return false;
        const tail = item.slice(prefix.length);
        return suffix
          ? tail.endsWith(suffix) && /^\d+$/.test(tail.slice(0, -suffix.length))
          : /^\d+$/.test(tail);
      });
      if (matching.length) legacy = localStorage.getItem(matching[matching.length - 1]);
    }
    if (legacy === null) return fallback;
    localStorage.setItem(key, legacy);
    return legacy;
  }

  function orderStorageKey(table) {
    return `${storageKey(table)}${ORDER_STORAGE_SUFFIX}`;
  }

  function widthStorageKey(table) {
    return `${storageKey(table)}${WIDTH_STORAGE_SUFFIX}`;
  }

  function readWidths(table) {
    try {
      const raw = JSON.parse(readStored(table, WIDTH_STORAGE_SUFFIX, '{}'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      return Object.fromEntries(
        Object.entries(raw)
          .map(([key, value]) => [String(key), Number(value)])
          .filter(([, value]) => Number.isFinite(value) && value >= MIN_COLUMN_WIDTH),
      );
    } catch {
      return {};
    }
  }

  function saveWidths(table, widths) {
    try {
      localStorage.setItem(widthStorageKey(table), JSON.stringify(widths));
    } catch {
      /* localStorage may be unavailable. */
    }
  }

  function captureBaseWidths(table) {
    if (table._uposBaseColumnWidths && Object.keys(table._uposBaseColumnWidths).length) return;
    // Скрытую таблицу мерить нельзя: все колонки получат нулевую ширину и
    // схлопнутся в минимум. Ждём, пока панель станет видимой.
    if (!table.offsetParent && getComputedStyle(table).position !== 'fixed') return;
    if (table.getBoundingClientRect().width < MIN_COLUMN_WIDTH) return;
    const widths = {};
    directCells(headerRow(table)).forEach((cell) => {
      // Узкий столбец с галочкой в общее распределение ширин не входит.
      if (isFixedWidthCell(cell)) return;
      const key = cell.getAttribute(CELL_KEY_ATTR);
      const width = cell.getBoundingClientRect().width;
      if (key && Number.isFinite(width) && width > 0) {
        widths[key] = Math.max(minimumCellWidth(cell), Math.min(MAX_COLUMN_WIDTH, width));
      }
    });
    if (!Object.keys(widths).length) return;

    // Растягиваем колонки на всю ширину таблицы: пустых мест справа быть
    // не должно, а лишнее место браузер иначе раскидает сам и при
    // перетаскивании поедут сразу несколько колонок.
    const available = (table.parentElement || table).clientWidth;
    const total = Object.values(widths).reduce((sum, value) => sum + value, 0);
    if (available > total && total > 0) {
      const factor = available / total;
      Object.keys(widths).forEach((key) => {
        widths[key] = Math.max(minimumColumnWidth(table, key), Math.min(MAX_COLUMN_WIDTH, Math.floor(widths[key] * factor)));
      });
    }
    table._uposBaseColumnWidths = widths;
  }

  function applyWidths(table, overrides = {}) {
    ensureColumnKeys(table);
    captureBaseWidths(table);
    const hidden = readHidden(table);
    const saved = readWidths(table);
    const widths = {
      ...(table._uposBaseColumnWidths || {}),
      ...saved,
      ...(table._uposDraftWidths || {}),
      ...overrides,
    };
    let totalWidth = 0;
    let sized = 0;

    columns(table).forEach((column) => {
      const sample = tableRows(table)
        .map((row) => directCells(row).find((item) => item.getAttribute(CELL_KEY_ATTR) === column.key))
        .find(Boolean);
      const fixed = fixedCellWidth(sample);
      const value = fixed || Number(widths[column.key]);
      if (!Number.isFinite(value)) return;
      const width = fixed || Math.max(minimumColumnWidth(table, column.key), Math.min(MAX_COLUMN_WIDTH, value));
      tableRows(table).forEach((row) => {
        const cell = directCells(row).find((item) => item.getAttribute(CELL_KEY_ATTR) === column.key);
        if (!cell) return;
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
      });
      sized += 1;
      if (!hidden.has(column.key)) totalWidth += width;
    });

    // Ширины ещё не сняты (панель была скрыта) — не сжимаем таблицу в полоску,
    // а оставляем обычную ширину 100%, пока не появится настоящий замер.
    if (!sized || sized < columns(table).length) {
      table.style.removeProperty('--upos-table-column-total-width');
      return;
    }
    table.style.setProperty('--upos-table-column-total-width', `${Math.ceil(totalWidth)}px`);
  }

  /* Единый футер таблицы: у панелей с серверной пагинацией он уже есть,
     остальным добавляем такой же по виду счётчик строк. */
  function ensureFooter(table) {
    const wrap = table.closest('.products-table-wrap, .org-ops-table-wrap, .reports-table-wrap, .clients-table-wrap');
    if (!wrap || wrap.parentElement?.querySelector(':scope > .products-catalog-footer')) return;
    let footer = wrap.nextElementSibling;
    if (!footer || !footer.classList.contains('upos-table-auto-footer')) {
      footer = document.createElement('footer');
      footer.className = 'products-catalog-footer upos-table-auto-footer';
      footer.innerHTML = '<div class="products-catalog-footer-meta">'
        + '<div class="products-panel-stats"><span data-upos-table-total></span></div></div>';
      wrap.parentElement?.insertBefore(footer, wrap.nextSibling);
    }
    const rows = Array.from(table.tBodies?.[0]?.rows || []).filter(
      (row) => !row.querySelector(':scope > .org-ops-empty, :scope > .reports-empty-cell') && row.cells.length > 1,
    ).length;
    const total = footer.querySelector('[data-upos-table-total]');
    if (total) total.textContent = `Всего: ${rows}`;
  }

  /* Панели с таблицами открываются вкладками: пока панель скрыта, замерить
     колонки нельзя. Досняем ширины, как только таблица становится видимой. */
  function watchVisibility(table) {
    if (table._uposVisibilityWatched || typeof ResizeObserver !== 'function') return;
    table._uposVisibilityWatched = true;
    const observer = new ResizeObserver(() => {
      if (table._uposBaseColumnWidths && Object.keys(table._uposBaseColumnWidths).length) {
        observer.disconnect();
        return;
      }
      if (table.getBoundingClientRect().width < MIN_COLUMN_WIDTH) return;
      captureBaseWidths(table);
      if (table._uposBaseColumnWidths) {
        applyWidths(table);
        observer.disconnect();
      }
    });
    observer.observe(table);
  }

  function enhanceHeaderInteractions(table) {
    const row = headerRow(table);
    if (!row) return;
    directCells(row).forEach((cell) => {
      const key = cell.getAttribute(CELL_KEY_ATTR);
      if (!key) return;
      cell.classList.add('upos-table-interactive-header');
      if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative';

      if (
        !cell.classList.contains('clients-table-movable-column')
        && !cell.querySelector(':scope > [data-upos-header-drag-handle]')
      ) {
        const moveHandle = document.createElement('button');
        moveHandle.type = 'button';
        moveHandle.className = 'upos-table-header-drag-handle';
        moveHandle.dataset.uposHeaderDragHandle = '1';
        moveHandle.draggable = true;
        moveHandle.title = 'Переместить столбец';
        moveHandle.setAttribute('aria-label', 'Переместить столбец');
        cell.append(moveHandle);
      }

      if (!isFixedWidthCell(cell) && !cell.querySelector(':scope > [data-upos-column-resize-handle]')) {
        const resizeHandle = document.createElement('span');
        resizeHandle.className = 'upos-table-column-resize-handle';
        resizeHandle.dataset.uposColumnResizeHandle = '1';
        resizeHandle.setAttribute('role', 'separator');
        resizeHandle.setAttribute('aria-orientation', 'vertical');
        resizeHandle.setAttribute('tabindex', '0');
        resizeHandle.title = 'Изменить ширину столбца';
        resizeHandle.setAttribute('aria-label', 'Изменить ширину столбца');
        cell.append(resizeHandle);
      }
    });
  }

  function readHidden(table) {
    try {
      const raw = JSON.parse(readStored(table, '', '[]'));
      if (!Array.isArray(raw)) return new Set();
      const list = columns(table);
      const keys = new Set(list.map((column) => column.key));
      return new Set(raw.map((value) => {
        if (typeof value === 'number') return list[value]?.key || null;
        const key = String(value);
        if (keys.has(key)) return key;
        const legacyIndex = Number(key);
        return Number.isInteger(legacyIndex) ? list[legacyIndex]?.key || null : null;
      }).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  function saveHidden(table, hidden) {
    try {
      localStorage.setItem(storageKey(table), JSON.stringify([...hidden]));
    } catch {
      /* localStorage may be unavailable. */
    }
  }

  function readOrder(table) {
    ensureColumnKeys(table);
    const available = new Set(columns(table).map((column) => column.key));
    const fallback = (table._uposDefaultColumnOrder || []).filter((key) => available.has(key));
    try {
      const raw = JSON.parse(readStored(table, ORDER_STORAGE_SUFFIX, '[]'));
      if (!Array.isArray(raw)) return fallback;
      const order = raw.map(String).filter((key, index, items) => (
        available.has(key) && items.indexOf(key) === index
      ));
      fallback.forEach((key, fallbackIndex) => {
        if (order.includes(key)) return;

        const previousKey = fallback
          .slice(0, fallbackIndex)
          .reverse()
          .find((candidate) => order.includes(candidate));
        if (previousKey) {
          order.splice(order.indexOf(previousKey) + 1, 0, key);
          return;
        }

        const nextKey = fallback
          .slice(fallbackIndex + 1)
          .find((candidate) => order.includes(candidate));
        if (nextKey) {
          order.splice(order.indexOf(nextKey), 0, key);
          return;
        }

        order.push(key);
      });
      return order;
    } catch {
      return fallback;
    }
  }

  function saveOrder(table, order) {
    try {
      localStorage.setItem(orderStorageKey(table), JSON.stringify(order));
    } catch {
      /* localStorage may be unavailable. */
    }
  }

  function applyOrder(table) {
    ensureColumnKeys(table);
    const order = readOrder(table);
    if (!order.length) return;
    tableRows(table).forEach((row) => {
      const cells = directCells(row);
      if (cells.length !== order.length) return;
      const keyedCells = new Map(
        cells.map((cell) => [cell.getAttribute(CELL_KEY_ATTR), cell]),
      );
      if (keyedCells.size !== order.length || order.some((key) => !keyedCells.has(key))) return;
      const currentOrder = cells.map((cell) => cell.getAttribute(CELL_KEY_ATTR));
      if (currentOrder.every((key, index) => key === order[index])) return;
      const controlCell = row.querySelector(`:scope > .${CONTROL_CELL}`);
      order.forEach((key) => {
        row.insertBefore(keyedCells.get(key), controlCell || null);
      });
    });
  }

  function visibleCount(table, hidden) {
    return Math.max(1, columns(table).filter((column) => !hidden.has(column.key)).length);
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
    ensureColumnKeys(table);
    const hidden = readHidden(table);
    const list = columns(table);
    tableRows(table).forEach((row) => {
      if (syncPlaceholder(row, table, hidden)) return;
      directCells(row).forEach((cell, index) => {
        const key = cell.getAttribute(CELL_KEY_ATTR) || list[index]?.key || String(index);
        cell.classList.toggle(HIDDEN_CLASS, hidden.has(key));
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
      const choice = document.createElement('div');
      choice.className = 'upos-table-column-choice';
      choice.dataset.uposColumnOrderKey = column.key;

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'upos-table-column-drag-handle';
      handle.dataset.uposColumnDragHandle = '1';
      handle.draggable = true;
      handle.title = `Переместить столбец «${column.label}»`;
      handle.setAttribute('aria-label', `Переместить столбец «${column.label}»`);

      const label = document.createElement('label');
      label.className = 'upos-table-column-choice-label';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !hidden.has(column.key);
      input.dataset.uposColumnKey = column.key;
      const text = document.createElement('span');
      text.textContent = column.label;
      label.append(input, text);
      choice.append(handle, label);
      menu.append(choice);
    });

    const footer = document.createElement('div');
    footer.className = 'upos-table-column-menu-footer';

    const orderReset = document.createElement('button');
    orderReset.type = 'button';
    orderReset.className = 'upos-table-column-reset';
    orderReset.textContent = 'Сбросить порядок';
    orderReset.dataset.uposColumnOrderReset = '1';

    const widthReset = document.createElement('button');
    widthReset.type = 'button';
    widthReset.className = 'upos-table-column-reset';
    widthReset.textContent = 'Сбросить размеры';
    widthReset.dataset.uposColumnWidthReset = '1';

    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.className = 'upos-table-column-reset';
    showAll.textContent = 'Показать все';
    showAll.dataset.uposColumnReset = '1';
    footer.append(orderReset, widthReset, showAll);
    menu.append(footer);
  }

  function closeWidthMode(table, save = false) {
    const root = table?._uposColumnControlRoot;
    if (!root || !table._uposDraftWidths) return;
    if (save) saveWidths(table, { ...readWidths(table), ...table._uposDraftWidths });
    table._uposDraftWidths = null;
    table.classList.remove('upos-table-width-editing');
    root.classList.remove('is-width-editor-open');
    const panel = root._uposWidthPanel;
    if (panel) panel.hidden = true;
    root.querySelector('[data-upos-column-width-toggle]')?.setAttribute('aria-expanded', 'false');
    applyWidths(table);
  }

  function openWidthMode(table, root, button) {
    document.querySelectorAll('.upos-table-column-control.is-width-editor-open').forEach((item) => {
      if (item !== root) closeWidthMode(item._uposColumnTable);
    });
    closeMenus();
    table._uposDraftWidths = {};
    table.classList.add('upos-table-width-editing');
    root.classList.add('is-width-editor-open');
    const panel = root._uposWidthPanel;
    if (panel.parentElement !== document.body) document.body.append(panel);
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    positionMenu(button, panel);
  }

  function createControl(table) {
    const root = document.createElement('div');
    root.className = 'upos-table-column-control';

    const widthButton = document.createElement('button');
    widthButton.type = 'button';
    widthButton.className = 'upos-table-column-btn upos-table-width-btn';
    widthButton.dataset.uposColumnWidthToggle = '1';
    widthButton.title = 'Настроить ширину столбцов';
    widthButton.setAttribute('aria-label', 'Настроить ширину столбцов');
    widthButton.setAttribute('aria-expanded', 'false');
    widthButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 7h18M3 17h18M7 4 4 7l3 3m10-6 3 3-3 3M7 14l-3 3 3 3m10-6 3 3-3 3" /></svg>';

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

    const widthPanel = document.createElement('div');
    widthPanel.className = 'upos-table-column-menu upos-table-width-panel';
    widthPanel.dataset.uposColumnWidthPanel = '1';
    widthPanel.setAttribute('role', 'dialog');
    widthPanel.setAttribute('aria-label', 'Ширина столбцов');
    widthPanel.hidden = true;
    widthPanel.innerHTML = '<div class="upos-table-column-menu-title">Ширина столбцов</div>'
      + '<p>Потяните границу нужного столбца или используйте клавиши ← → на границе. Затем сохраните изменения.</p>'
      + '<div class="upos-table-width-panel-actions">'
      + '<button type="button" class="upos-table-column-reset" data-upos-column-width-cancel>Отмена</button>'
      + '<button type="button" class="upos-table-column-reset upos-table-width-save" data-upos-column-width-save>Сохранить</button>'
      + '</div>';

    root.append(widthButton, button, menu, widthPanel);
    root._uposColumnMenu = menu;
    root._uposWidthPanel = widthPanel;
    root._uposColumnTable = table;
    menu._uposColumnRoot = root;
    menu._uposColumnTable = table;
    widthPanel._uposColumnRoot = root;
    widthPanel._uposColumnTable = table;
    table._uposColumnControlRoot = root;
    renderMenu(table, root);
    return root;
  }

  /* Настройка столбцов живёт в заголовке колонки действий, а не отдельной
     колонкой: иначе в каждой строке остаётся пустая служебная ячейка. */
  function mountControl(table) {
    const header = headerRow(table);
    const host = header?.querySelector(':scope > .products-actions-head, :scope > .org-hr-actions-col')
      || header?.lastElementChild;
    if (!host) return;
    host.classList.add('upos-table-column-control-slot');
    host.append(createControl(table));
  }

  /* Старые служебные ячейки из ранее отрисованных таблиц убираем. */
  function dropControlCells(table) {
    table.querySelectorAll(`.${CONTROL_CELL}`).forEach((cell) => cell.remove());
  }

  function initTable(table) {
    if (!table || table.getAttribute(READY_ATTR) === '1' || table.hasAttribute('data-upos-no-column-controls')) return;
    const row = headerRow(table);
    if (!row || columns(table).length < 2) return;
    table.setAttribute(READY_ATTR, '1');
    table.classList.add('upos-table-with-column-controls', 'upos-table-resizable-columns');
    ensureColumnKeys(table);
    captureBaseWidths(table);
    dropControlCells(table);
    mountControl(table);
    ensureFillerCells(table);
    ensureColumnKeys(table);
    applyOrder(table);
    applyVisibility(table);
    enhanceHeaderInteractions(table);
    applyWidths(table);
    watchVisibility(table);
    ensureFooter(table);
  }

  function initAll(root = document) {
    root.querySelectorAll(TABLE_SELECTOR).forEach(initTable);
  }

  document.addEventListener('click', (event) => {
    const widthToggle = event.target.closest('[data-upos-column-width-toggle]');
    if (widthToggle) {
      const root = widthToggle.closest('.upos-table-column-control');
      const table = root?._uposColumnTable;
      if (!root || !table) return;
      if (table._uposDraftWidths) closeWidthMode(table);
      else openWidthMode(table, root, widthToggle);
      return;
    }

    const widthAction = event.target.closest('[data-upos-column-width-save], [data-upos-column-width-cancel]');
    if (widthAction) {
      const table = widthAction.closest('[data-upos-column-width-panel]')?._uposColumnTable;
      if (table) closeWidthMode(table, widthAction.hasAttribute('data-upos-column-width-save'));
      return;
    }

    const toggle = event.target.closest('[data-upos-column-menu-toggle]');
    if (toggle) {
      const root = toggle.closest('.upos-table-column-control');
      const table = root?._uposColumnTable || toggle.closest('table');
      if (!root || !table) return;
      if (table._uposDraftWidths) closeWidthMode(table);
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
      saveHidden(table, new Set());
      renderMenu(table, reset.closest('[data-upos-column-menu]')?._uposColumnRoot || reset.closest('.upos-table-column-control'));
      applyVisibility(table);
      applyWidths(table);
      return;
    }

    const widthReset = event.target.closest('[data-upos-column-width-reset]');
    if (widthReset) {
      const menu = widthReset.closest('[data-upos-column-menu]');
      const table = menu?._uposColumnTable || widthReset.closest('table');
      if (!table) return;
      saveWidths(table, {});
      applyWidths(table);
      return;
    }

    const orderReset = event.target.closest('[data-upos-column-order-reset]');
    if (orderReset) {
      const menu = orderReset.closest('[data-upos-column-menu]');
      const table = menu?._uposColumnTable || orderReset.closest('table');
      if (!table) return;
      saveOrder(table, []);
      applyOrder(table);
      applyVisibility(table);
      applyWidths(table);
      renderMenu(table, menu?._uposColumnRoot || orderReset.closest('.upos-table-column-control'));
      return;
    }

    if (!event.target.closest('.upos-table-column-control') && !event.target.closest('[data-upos-column-menu]')) closeMenus();
  });

  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-upos-column-key]');
    if (!input) return;
    const table = input.closest('[data-upos-column-menu]')?._uposColumnTable || input.closest('table');
    if (!table) return;
    const hidden = readHidden(table);
    const key = input.dataset.uposColumnKey;
    if (input.checked) hidden.delete(key);
    else hidden.add(key);
    saveHidden(table, hidden);
    applyVisibility(table);
    applyWidths(table);
  });

  function resizeColumn(table, key, width, persist = false) {
    const nextWidth = Math.max(minimumColumnWidth(table, key), Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
    if (table._uposDraftWidths) table._uposDraftWidths[key] = nextWidth;
    applyWidths(table, { [key]: nextWidth });
    if (persist && !table._uposDraftWidths) {
      const widths = readWidths(table);
      widths[key] = nextWidth;
      saveWidths(table, widths);
    }
    return nextWidth;
  }

  function finishColumnResize() {
    if (!resizedColumn) return;
    resizeColumn(resizedColumn.table, resizedColumn.key, resizedColumn.width, true);
    resizedColumn.handle.releasePointerCapture?.(resizedColumn.pointerId);
    resizedColumn.handle.removeAttribute('data-resizing');
    document.body.classList.remove('upos-table-column-resizing');
    resizedColumn = null;
  }

  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-upos-column-resize-handle]');
    const header = handle?.closest(`th[${CELL_KEY_ATTR}]`);
    const table = header?.closest(TABLE_SELECTOR);
    if (!handle || !header || !table || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizedColumn = {
      table,
      key: header.getAttribute(CELL_KEY_ATTR),
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: header.getBoundingClientRect().width,
      width: header.getBoundingClientRect().width,
    };
    handle.dataset.resizing = '1';
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add('upos-table-column-resizing');
  });

  document.addEventListener('pointermove', (event) => {
    if (!resizedColumn || event.pointerId !== resizedColumn.pointerId) return;
    event.preventDefault();
    resizedColumn.width = resizeColumn(
      resizedColumn.table,
      resizedColumn.key,
      resizedColumn.startWidth + event.clientX - resizedColumn.startX,
    );
  });

  document.addEventListener('pointerup', (event) => {
    if (!resizedColumn || event.pointerId !== resizedColumn.pointerId) return;
    finishColumnResize();
  });

  document.addEventListener('pointercancel', finishColumnResize);

  document.addEventListener('dblclick', (event) => {
    const handle = event.target.closest('[data-upos-column-resize-handle]');
    const header = handle?.closest(`th[${CELL_KEY_ATTR}]`);
    const table = header?.closest(TABLE_SELECTOR);
    if (!handle || !header || !table) return;
    event.preventDefault();
    if (table._uposDraftWidths) {
      const key = header.getAttribute(CELL_KEY_ATTR);
      table._uposDraftWidths[key] = table._uposBaseColumnWidths?.[key] || minimumColumnWidth(table, key);
      applyWidths(table);
      return;
    }
    const widths = readWidths(table);
    delete widths[header.getAttribute(CELL_KEY_ATTR)];
    saveWidths(table, widths);
    applyWidths(table);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const active = document.querySelector('.upos-table-column-control.is-width-editor-open');
      if (active) {
        event.preventDefault();
        closeWidthMode(active._uposColumnTable);
        return;
      }
    }
    const moveHandle = event.target.closest('[data-upos-header-drag-handle]');
    if (moveHandle && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const header = moveHandle.closest(`th[${CELL_KEY_ATTR}]`);
      const table = header?.closest(TABLE_SELECTOR);
      if (!header || !table) return;
      const cells = directCells(headerRow(table));
      const currentIndex = cells.indexOf(header);
      const target = cells[currentIndex + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (!target) return;
      event.preventDefault();
      moveHeaderColumn(
        table,
        header.getAttribute(CELL_KEY_ATTR),
        target.getAttribute(CELL_KEY_ATTR),
        event.key === 'ArrowRight',
      );
      moveHandle.focus();
      return;
    }

    const resizeHandle = event.target.closest('[data-upos-column-resize-handle]');
    if (resizeHandle && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      const header = resizeHandle.closest(`th[${CELL_KEY_ATTR}]`);
      const table = header?.closest(TABLE_SELECTOR);
      if (!header || !table) return;
      event.preventDefault();
      resizeColumn(
        table,
        header.getAttribute(CELL_KEY_ATTR),
        header.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -8 : 8),
        true,
      );
      return;
    }

    const handle = event.target.closest('[data-upos-column-drag-handle]');
    if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const choice = handle.closest('[data-upos-column-order-key]');
    const menu = choice?.closest('[data-upos-column-menu]');
    const table = menu?._uposColumnTable;
    if (!choice || !menu || !table) return;
    const key = choice.dataset.uposColumnOrderKey;
    const order = readOrder(table);
    const currentIndex = order.indexOf(key);
    const nextIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    event.preventDefault();
    order.splice(currentIndex, 1);
    order.splice(nextIndex, 0, key);
    saveOrder(table, order);
    applyOrder(table);
    applyVisibility(table);
    applyWidths(table);
    renderMenu(table, menu._uposColumnRoot);
    menu.querySelector(`[data-upos-column-order-key="${CSS.escape(key)}"] [data-upos-column-drag-handle]`)?.focus();
  });

  function clearDropIndicators(menu) {
    menu?.querySelectorAll('.is-drop-before, .is-drop-after').forEach((choice) => {
      choice.classList.remove('is-drop-before', 'is-drop-after');
    });
  }

  function clearHeaderDropIndicators(table) {
    headerRow(table)?.querySelectorAll('.is-upos-drop-before, .is-upos-drop-after').forEach((cell) => {
      cell.classList.remove('is-upos-drop-before', 'is-upos-drop-after');
    });
  }

  function moveHeaderColumn(table, sourceKey, targetKey, insertAfter) {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    const order = readOrder(table).filter((key) => key !== sourceKey);
    let targetIndex = order.indexOf(targetKey);
    if (targetIndex < 0) return;
    if (insertAfter) targetIndex += 1;
    order.splice(targetIndex, 0, sourceKey);
    saveOrder(table, order);
    applyOrder(table);
    applyVisibility(table);
    enhanceHeaderInteractions(table);
    applyWidths(table);
  }

  document.addEventListener('dragstart', (event) => {
    const headerHandle = event.target.closest('[data-upos-header-drag-handle]');
    const headerCell = headerHandle?.closest(`th[${CELL_KEY_ATTR}]`);
    const headerTable = headerCell?.closest(TABLE_SELECTOR);
    if (headerHandle && headerCell && headerTable) {
      draggedHeaderColumn = {
        key: headerCell.getAttribute(CELL_KEY_ATTR),
        table: headerTable,
      };
      headerCell.classList.add('is-upos-header-dragging');
      event.dataTransfer?.setData('application/x-upos-header-column', draggedHeaderColumn.key);
      event.dataTransfer?.setData('text/plain', draggedHeaderColumn.key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      return;
    }

    const handle = event.target.closest('[data-upos-column-drag-handle]');
    const choice = handle?.closest('[data-upos-column-order-key]');
    const menu = choice?.closest('[data-upos-column-menu]');
    const table = menu?._uposColumnTable;
    if (!choice || !menu || !table) return;
    draggedColumn = {
      key: choice.dataset.uposColumnOrderKey,
      menu,
      table,
    };
    choice.classList.add('is-dragging');
    event.dataTransfer?.setData('application/x-upos-column', draggedColumn.key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  document.addEventListener('dragover', (event) => {
    if (draggedHeaderColumn) {
      const cell = event.target.closest(`th[${CELL_KEY_ATTR}]`);
      if (!cell || cell.closest(TABLE_SELECTOR) !== draggedHeaderColumn.table) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      clearHeaderDropIndicators(draggedHeaderColumn.table);
      const rect = cell.getBoundingClientRect();
      cell.classList.add(event.clientX > rect.left + rect.width / 2 ? 'is-upos-drop-after' : 'is-upos-drop-before');
      return;
    }

    if (!draggedColumn) return;
    const choice = event.target.closest('[data-upos-column-order-key]');
    if (!choice || choice.closest('[data-upos-column-menu]') !== draggedColumn.menu) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    clearDropIndicators(draggedColumn.menu);
    const rect = choice.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    choice.classList.add(after ? 'is-drop-after' : 'is-drop-before');

    const menuRect = draggedColumn.menu.getBoundingClientRect();
    if (event.clientY < menuRect.top + 32) draggedColumn.menu.scrollTop -= 12;
    if (event.clientY > menuRect.bottom - 32) draggedColumn.menu.scrollTop += 12;
  });

  document.addEventListener('drop', (event) => {
    if (draggedHeaderColumn) {
      const cell = event.target.closest(`th[${CELL_KEY_ATTR}]`);
      if (!cell || cell.closest(TABLE_SELECTOR) !== draggedHeaderColumn.table) return;
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      moveHeaderColumn(
        draggedHeaderColumn.table,
        draggedHeaderColumn.key,
        cell.getAttribute(CELL_KEY_ATTR),
        event.clientX > rect.left + rect.width / 2,
      );
      headerRow(draggedHeaderColumn.table)?.querySelectorAll('.is-upos-header-dragging').forEach((item) => {
        item.classList.remove('is-upos-header-dragging');
      });
      clearHeaderDropIndicators(draggedHeaderColumn.table);
      draggedHeaderColumn = null;
      return;
    }

    if (!draggedColumn) return;
    const choice = event.target.closest('[data-upos-column-order-key]');
    if (!choice || choice.closest('[data-upos-column-menu]') !== draggedColumn.menu) return;
    event.preventDefault();
    const targetKey = choice.dataset.uposColumnOrderKey;
    if (targetKey === draggedColumn.key) {
      clearDropIndicators(draggedColumn.menu);
      return;
    }
    const rect = choice.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    const order = readOrder(draggedColumn.table).filter((key) => key !== draggedColumn.key);
    let targetIndex = order.indexOf(targetKey);
    if (targetIndex < 0) return;
    if (insertAfter) targetIndex += 1;
    order.splice(targetIndex, 0, draggedColumn.key);
    saveOrder(draggedColumn.table, order);
    applyOrder(draggedColumn.table);
    applyVisibility(draggedColumn.table);
    applyWidths(draggedColumn.table);
    const root = draggedColumn.menu._uposColumnRoot;
    clearDropIndicators(draggedColumn.menu);
    renderMenu(draggedColumn.table, root);
  });

  document.addEventListener('dragend', () => {
    if (draggedHeaderColumn) {
      headerRow(draggedHeaderColumn.table)?.querySelectorAll('.is-upos-header-dragging').forEach((cell) => {
        cell.classList.remove('is-upos-header-dragging');
      });
      clearHeaderDropIndicators(draggedHeaderColumn.table);
      draggedHeaderColumn = null;
    }
    if (!draggedColumn) return;
    draggedColumn.menu.querySelectorAll('.is-dragging').forEach((choice) => {
      choice.classList.remove('is-dragging');
    });
    clearDropIndicators(draggedColumn.menu);
    draggedColumn = null;
  });

  function repositionOpenMenus() {
    document.querySelectorAll('.upos-table-column-control.is-column-menu-open').forEach((root) => {
      const button = root.querySelector('[data-upos-column-menu-toggle]');
      const menu = root._uposColumnMenu || root.querySelector('[data-upos-column-menu]');
      if (menu && !menu.hidden) positionMenu(button, menu);
    });
    document.querySelectorAll('.upos-table-column-control.is-width-editor-open').forEach((root) => {
      const button = root.querySelector('[data-upos-column-width-toggle]');
      const panel = root._uposWidthPanel;
      if (panel && !panel.hidden) positionMenu(button, panel);
    });
  }

  const observer = new MutationObserver((records) => {
    document.querySelectorAll('[data-upos-column-width-panel]').forEach((panel) => {
      if (panel._uposColumnRoot && !panel._uposColumnRoot.isConnected) panel.remove();
    });
    const tablesToRefresh = new Set();
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(TABLE_SELECTOR)) initTable(node);
        initAll(node);
        const table = node.closest?.(TABLE_SELECTOR);
        if (table?.getAttribute(READY_ATTR) === '1') tablesToRefresh.add(table);
      });
    });
    tablesToRefresh.forEach((table) => {
      dropControlCells(table);
      ensureFillerCells(table);
      ensureColumnKeys(table);
      applyOrder(table);
      applyVisibility(table);
      enhanceHeaderInteractions(table);
      applyWidths(table);
      ensureFooter(table);
    });
  });

  window.addEventListener('resize', repositionOpenMenus);
  window.addEventListener('scroll', repositionOpenMenus, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installTextDragGuard();
      initAll();
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  } else {
    installTextDragGuard();
    initAll();
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
