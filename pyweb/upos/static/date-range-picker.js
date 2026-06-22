(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const presets = [
    ['today', 'Сегодня'],
    ['yesterday', 'Вчера'],
    ['before-yesterday', 'Позавчера'],
    ['month', 'Этот месяц'],
    ['prev-month', 'Прошлый месяц'],
    ['year', 'Этот год'],
    ['prev-year', 'Прошлый год'],
    ['all', 'За всё время'],
  ];

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function iso(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseIso(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function display(value) {
    const d = parseIso(value);
    return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : '';
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function rangeForPreset(preset) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (preset === 'today') return { date_from: iso(today), date_to: iso(today) };
    if (preset === 'yesterday') {
      const d = addDays(today, -1);
      return { date_from: iso(d), date_to: iso(d) };
    }
    if (preset === 'before-yesterday') {
      const d = addDays(today, -2);
      return { date_from: iso(d), date_to: iso(d) };
    }
    if (preset === 'month') {
      return {
        date_from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
        date_to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    }
    if (preset === 'prev-month') {
      return {
        date_from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        date_to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    }
    if (preset === 'year') {
      return {
        date_from: `${today.getFullYear()}-01-01`,
        date_to: `${today.getFullYear()}-12-31`,
      };
    }
    if (preset === 'prev-year') {
      const y = today.getFullYear() - 1;
      return { date_from: `${y}-01-01`, date_to: `${y}-12-31` };
    }
    return { date_from: '', date_to: '' };
  }

  function labelForRange(from, to, preset) {
    if (preset === 'all') return 'За всё время';
    const known = presets.find(([key]) => key === preset);
    if (known && from && to) return known[1];
    if (from && to && from !== to) return `${display(from)} - ${display(to)}`;
    if (from) return display(from);
    return 'Всё время';
  }

  function monthStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function nextMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  }

  function sameMonth(a, b) {
    return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function mondayIndex(day) {
    return (day + 6) % 7;
  }

  function createMount(root, options) {
    root.classList.add('upos-date');
    root.innerHTML = `
      <button type="button" class="upos-date-trigger" aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
        <span>Дата</span>
      </button>
      <span class="upos-date-summary"></span>
    `;
    return {
      trigger: root.querySelector('.upos-date-trigger'),
      summary: root.querySelector('.upos-date-summary'),
      options,
    };
  }

  function create(root, options = {}) {
    const parts = createMount(root, options);
    const single = options.mode === 'single';
    const baseView = monthStart(parseIso(options.date_from) || new Date());
    const toView = monthStart(parseIso(options.date_to) || new Date(baseView.getFullYear(), baseView.getMonth() + 1, 1));
    const state = {
      preset: options.preset || 'today',
      date_from: options.date_from || '',
      date_to: options.date_to || '',
      open: false,
      view: baseView,
      leftView: baseView,
      rightView: toView,
      viewMode: 'days',
      yearBase: new Date().getFullYear(),
      pickerSide: 'from',
      selecting: 'from',
      panel: null,
    };

    function currentLabel() {
      return options.label || labelForRange(state.date_from, state.date_to, state.preset);
    }

    function sync() {
      parts.summary.textContent = options.hideSummary ? '' : currentLabel();
      parts.trigger.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    }

    function selectedText() {
      if (state.preset === 'all') return 'Выбранный период: за всё время';
      if (single && state.date_from) return `Дата: ${display(state.date_from)}`;
      if (state.date_from && state.date_to) return `От: ${display(state.date_from)} · До: ${display(state.date_to)}`;
      if (state.date_from) return `От: ${display(state.date_from)} · выберите дату До`;
      return single ? 'Выберите дату' : 'Выберите дату От';
    }

    function activeView() {
      return state.pickerSide === 'to' ? state.rightView : state.leftView;
    }

    function setSideView(side, date) {
      const next = monthStart(date);
      if (side === 'to') state.rightView = next;
      else state.leftView = next;
      state.view = next;
    }

    function setPickerSide(side) {
      state.pickerSide = side === 'to' ? 'to' : 'from';
      state.view = activeView();
    }

    function syncViewsFromRange() {
      const from = monthStart(parseIso(state.date_from) || new Date());
      const to = monthStart(parseIso(state.date_to) || new Date(from.getFullYear(), from.getMonth() + 1, 1));
      state.leftView = from;
      state.rightView = single || sameMonth(from, to) ? nextMonth(from) : to;
      state.view = from;
      state.pickerSide = 'from';
    }

    function normalizeRangeViews() {
      if (single || sameMonth(state.leftView, state.rightView) || state.rightView < state.leftView) {
        state.rightView = nextMonth(state.leftView);
      }
      state.view = state.pickerSide === 'to' ? state.rightView : state.leftView;
    }

    function dayButton(date, currentMonth) {
      const value = iso(date);
      const muted = date.getMonth() !== currentMonth;
      const selectedStart = value === state.date_from;
      const selectedEnd = !single && value === state.date_to;
      const inRange = !single && state.date_from && state.date_to && value > state.date_from && value < state.date_to;
      const cls = [
        'upos-date-day',
        muted ? 'is-muted' : '',
        selectedStart ? 'is-start' : '',
        selectedEnd ? 'is-end' : '',
        inRange ? 'in-range' : '',
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-upos-day="${value}">${date.getDate()}</button>`;
    }

    function monthHtml(base, side) {
      const first = new Date(base.getFullYear(), base.getMonth(), 1);
      const start = addDays(first, -mondayIndex(first.getDay()));
      let days = '';
      for (let i = 0; i < 42; i += 1) days += dayButton(addDays(start, i), base.getMonth());
      return `
        <section class="upos-date-month" data-upos-side="${side}">
          <div class="upos-date-month-title">
            <button type="button" class="upos-date-title-btn" data-upos-open-months="${base.getFullYear()}" data-upos-open-month-index="${base.getMonth()}" data-upos-picker-side="${side}">${monthNames[base.getMonth()]}</button>
            <button type="button" class="upos-date-title-btn" data-upos-open-years="${base.getFullYear()}" data-upos-picker-side="${side}">${base.getFullYear()}</button>
          </div>
          <div class="upos-date-grid">
            ${weekdays.map((d) => `<div class="upos-date-weekday">${d}</div>`).join('')}
            ${days}
          </div>
        </section>
      `;
    }

    function monthsHtml(year) {
      const view = activeView();
      const currentMonth = view.getFullYear() === year ? view.getMonth() : -1;
      return `
        <section class="upos-date-picker-view">
          <button type="button" class="upos-date-year-title" data-upos-open-years="${year}" data-upos-picker-side="${state.pickerSide}">${year}</button>
          <div class="upos-date-month-grid">
            ${monthNames.map((name, month) => `
              <button type="button" class="upos-date-pick-cell${month === currentMonth ? ' active' : ''}" data-upos-select-month="${month}" data-upos-select-year="${year}">${name}</button>
            `).join('')}
          </div>
        </section>
      `;
    }

    function yearsHtml(baseYear) {
      const start = Math.floor(baseYear / 12) * 12;
      const view = activeView();
      let years = '';
      for (let i = 0; i < 12; i += 1) {
        const year = start + i;
        years += `<button type="button" class="upos-date-pick-cell${year === view.getFullYear() ? ' active' : ''}" data-upos-select-year-only="${year}">${year}</button>`;
      }
      return `
        <section class="upos-date-picker-view">
          <div class="upos-date-year-title">${start} - ${start + 11}</div>
          <div class="upos-date-year-grid">${years}</div>
        </section>
      `;
    }

    function renderPanel() {
      if (!state.panel) return;
      const content = state.viewMode === 'years'
        ? yearsHtml(state.yearBase || activeView().getFullYear())
        : state.viewMode === 'months'
          ? monthsHtml(activeView().getFullYear())
          : `<div class="upos-date-months">${monthHtml(state.leftView, 'from')}${monthHtml(state.rightView, 'to')}</div>`;
      state.panel.innerHTML = `
        <div class="upos-date-presets">
          ${presets.map(([key, label]) => `<button type="button" class="upos-date-preset${state.preset === key ? ' active' : ''}" data-upos-preset="${key}">${label}</button>`).join('')}
        </div>
        <div class="upos-date-main">
          <div class="upos-date-nav">
            <button type="button" data-upos-nav="-1" aria-label="Предыдущий месяц">‹</button>
            <div></div>
            <button type="button" data-upos-nav="1" aria-label="Следующий месяц">›</button>
          </div>
          ${content}
          <div class="upos-date-footer">
            <div class="upos-date-selected">${selectedText()}</div>
            <div class="upos-date-actions">
              <button type="button" class="upos-date-apply" data-upos-apply>Применить</button>
              <button type="button" class="upos-date-close" data-upos-close>Закрыть</button>
            </div>
          </div>
        </div>
      `;
    }

    function positionPanel() {
      if (!state.panel) return;
      const rect = root.getBoundingClientRect();
      const width = Math.min(720, window.innerWidth - 32);
      const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
      const top = Math.min(rect.bottom + 8, window.innerHeight - 360);
      state.panel.style.left = `${left}px`;
      state.panel.style.top = `${Math.max(16, top)}px`;
    }

    function open() {
      if (state.open) return;
      state.open = true;
      state.panel = document.createElement('div');
      state.panel.className = 'upos-date-panel';
      const topLayerHost = root.closest('dialog[open]') || document.body;
      topLayerHost.appendChild(state.panel);
      renderPanel();
      positionPanel();
      sync();
    }

    function close() {
      state.open = false;
      state.panel?.remove();
      state.panel = null;
      sync();
    }

    function apply() {
      if (!single && state.date_from && state.date_to && state.date_to < state.date_from) {
        const from = state.date_to;
        state.date_to = state.date_from;
        state.date_from = from;
      }
      const label = labelForRange(state.date_from, state.date_to, state.preset);
      options.onApply?.({
        preset: state.preset,
        date_from: state.date_from,
        date_to: state.date_to || state.date_from,
        label,
      });
      close();
    }

    function setValue(next = {}) {
      state.preset = next.preset || state.preset || 'today';
      state.date_from = next.date_from || '';
      state.date_to = next.date_to || '';
      options.label = next.label || '';
      syncViewsFromRange();
      state.viewMode = 'days';
      state.selecting = 'from';
      sync();
      renderPanel();
    }

    parts.trigger.addEventListener('click', () => {
      if (state.open) close();
      else open();
    });

    document.addEventListener('click', (event) => {
      if (!state.open) return;
      if (root.contains(event.target) || state.panel?.contains(event.target)) return;
      close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open) close();
    });

    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);

    document.addEventListener('click', (event) => {
      if (!state.panel?.contains(event.target)) return;
      const preset = event.target.closest('[data-upos-preset]');
      if (preset) {
        const key = preset.getAttribute('data-upos-preset') || 'today';
        const range = rangeForPreset(key);
        state.preset = key;
        state.date_from = range.date_from;
        state.date_to = range.date_to;
        syncViewsFromRange();
        state.viewMode = 'days';
        state.selecting = 'from';
        renderPanel();
        return;
      }
      const nav = event.target.closest('[data-upos-nav]');
      if (nav) {
        const delta = Number(nav.getAttribute('data-upos-nav') || 0);
        if (state.viewMode === 'years') {
          state.yearBase = (state.yearBase || state.view.getFullYear()) + (delta * 12);
        } else if (state.viewMode === 'months') {
          const view = activeView();
          setSideView(state.pickerSide, new Date(view.getFullYear() + delta, view.getMonth(), 1));
        } else {
          if (single) {
            const nextLeft = new Date(state.leftView.getFullYear(), state.leftView.getMonth() + delta, 1);
            setSideView('from', nextLeft);
            state.rightView = nextMonth(state.leftView);
          } else if (delta < 0) {
            setSideView('from', new Date(state.leftView.getFullYear(), state.leftView.getMonth() - 1, 1));
          } else {
            setSideView('to', new Date(state.rightView.getFullYear(), state.rightView.getMonth() + 1, 1));
          }
        }
        renderPanel();
        return;
      }
      const openMonths = event.target.closest('[data-upos-open-months]');
      if (openMonths) {
        const year = Number(openMonths.getAttribute('data-upos-open-months')) || state.view.getFullYear();
        const month = Number(openMonths.getAttribute('data-upos-open-month-index'));
        setPickerSide(openMonths.getAttribute('data-upos-picker-side'));
        setSideView(state.pickerSide, new Date(year, Number.isFinite(month) ? month : activeView().getMonth(), 1));
        state.viewMode = 'months';
        renderPanel();
        return;
      }
      const openYears = event.target.closest('[data-upos-open-years]');
      if (openYears) {
        const year = Number(openYears.getAttribute('data-upos-open-years')) || state.view.getFullYear();
        setPickerSide(openYears.getAttribute('data-upos-picker-side'));
        state.yearBase = year;
        state.viewMode = 'years';
        renderPanel();
        return;
      }
      const selectMonth = event.target.closest('[data-upos-select-month][data-upos-select-year]');
      if (selectMonth) {
        const year = Number(selectMonth.getAttribute('data-upos-select-year')) || state.view.getFullYear();
        const month = Number(selectMonth.getAttribute('data-upos-select-month')) || 0;
        setSideView(state.pickerSide, new Date(year, month, 1));
        state.viewMode = 'days';
        renderPanel();
        return;
      }
      const selectYear = event.target.closest('[data-upos-select-year-only]');
      if (selectYear) {
        const year = Number(selectYear.getAttribute('data-upos-select-year-only')) || state.view.getFullYear();
        setSideView(state.pickerSide, new Date(year, activeView().getMonth(), 1));
        state.viewMode = 'months';
        renderPanel();
        return;
      }
      const day = event.target.closest('[data-upos-day]');
      if (day) {
        const value = day.getAttribute('data-upos-day') || '';
        state.preset = 'custom';
        if (single) {
          state.date_from = value;
          state.date_to = value;
          state.selecting = 'from';
        } else if (state.selecting === 'to' && state.date_from) {
          state.date_to = value;
          state.selecting = 'from';
        } else {
          state.date_from = value;
          state.date_to = '';
          state.selecting = 'to';
          setSideView('from', parseIso(value) || new Date());
          normalizeRangeViews();
        }
        renderPanel();
        return;
      }
      if (event.target.closest('[data-upos-apply]')) {
        apply();
        return;
      }
      if (event.target.closest('[data-upos-close]')) close();
    });

    setValue({
      preset: state.preset,
      date_from: state.date_from,
      date_to: state.date_to,
      label: options.label,
    });

    return { setValue, open, close };
  }

  window.UPOS_DATE_RANGE = { create, rangeForPreset, labelForRange, display };
})();
