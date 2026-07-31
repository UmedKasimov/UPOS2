(() => {
  function enhance(input) {
    if (!input || input.dataset.uposDateEnhanced === '1' || !window.UPOS_DATE_RANGE) return;
    input.dataset.uposDateEnhanced = '1';
    const rangeMode = input.hasAttribute('data-upos-date-range');
    const inlineLabel = input.hasAttribute('data-upos-date-inline-label');
    const periodModes = input.hasAttribute('data-upos-date-period-modes');
    const form = input.closest('form');
    const toInputName = input.dataset.uposDateTo || `${input.name || 'date'}_to`;
    const toInput = rangeMode && form ? form.querySelector(`[name="${CSS.escape(toInputName)}"]`) : null;
    // Пустое «До» при заполненном «От» — открытый период, сохраняем его как есть:
    // подстановка input.value превратила бы «с 20.07» обратно в один день.
    const dateToValue = rangeMode ? (toInput?.value || '') : (input.value || '');
    // Поле может задать стартовый режим явно (data-upos-date-period-mode="range").
    // Иначе режим угадывается по значениям, и пустой фильтр каждый раз
    // открывался одиночным днём вместо периода.
    const forcedPeriodMode = String(input.dataset.uposDatePeriodMode || '').trim();
    const periodMode = periodModes
      ? forcedPeriodMode || window.UPOS_DATE_RANGE.inferPeriodMode(input.value || '', dateToValue)
      : '';
    const rangeLabel = rangeMode
      ? window.UPOS_DATE_RANGE.labelForSelection(
          input.value || '',
          dateToValue,
          'custom',
          periodMode
        )
      : (input.value ? window.UPOS_DATE_RANGE.display(input.value) : '');
    input.classList.add('upos-date-hidden-input');
    const mount = document.createElement('span');
    mount.className = 'upos-date-auto';
    input.insertAdjacentElement('afterend', mount);
    const picker = window.UPOS_DATE_RANGE.create(mount, {
      mode: rangeMode ? 'range' : 'single',
      preset: 'custom',
      date_from: input.value || '',
      date_to: dateToValue,
      label: rangeLabel,
      inlineLabel,
      periodModes,
      periodMode,
      onApply: (range) => {
        const next = range.date_from || range.date_to || '';
        // В режиме диапазона пустое «До» — это открытый период «с даты и далее».
        // Раньше сюда подставлялось «От», и фильтр схлопывался в один день.
        const nextTo = rangeMode
          ? (range.date_to || (range.period_mode === 'range' ? '' : next))
          : next;
        input.value = next;
        if (toInput) {
          toInput.value = nextTo;
          toInput.dispatchEvent(new Event('input', { bubbles: true }));
          toInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        picker.setValue({
          preset: 'custom',
          date_from: next,
          date_to: nextTo,
          label: rangeMode ? range.label : (next ? window.UPOS_DATE_RANGE.display(next) : ''),
          period_mode: range.period_mode,
        });
      },
    });
    input.addEventListener('change', () => {
      const nextTo = rangeMode ? (toInput?.value || input.value || '') : (input.value || '');
      const nextPeriodMode = periodModes
        ? forcedPeriodMode || window.UPOS_DATE_RANGE.inferPeriodMode(input.value || '', nextTo)
        : '';
      const nextLabel = rangeMode
        ? window.UPOS_DATE_RANGE.labelForSelection(input.value || '', nextTo, 'custom', nextPeriodMode)
        : (input.value ? window.UPOS_DATE_RANGE.display(input.value) : '');
      picker.setValue({
        preset: 'custom',
        date_from: input.value || '',
        date_to: nextTo,
        label: nextLabel,
        period_mode: nextPeriodMode,
      });
    });
  }

  function enhanceAll(root = document) {
    root.querySelectorAll('input[type="date"]:not([data-upos-native-date])').forEach(enhance);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceAll());
  } else {
    enhanceAll();
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node && node.nodeType === 1) enhanceAll(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.UPOS_DATE_AUTO = { enhanceAll };
})();
