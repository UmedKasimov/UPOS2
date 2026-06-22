(() => {
  function enhance(input) {
    if (!input || input.dataset.uposDateEnhanced === '1' || !window.UPOS_DATE_RANGE) return;
    input.dataset.uposDateEnhanced = '1';
    const rangeMode = input.hasAttribute('data-upos-date-range');
    const form = input.closest('form');
    const toInputName = input.dataset.uposDateTo || `${input.name || 'date'}_to`;
    const toInput = rangeMode && form ? form.querySelector(`[name="${CSS.escape(toInputName)}"]`) : null;
    const dateToValue = rangeMode ? (toInput?.value || input.value || '') : (input.value || '');
    const rangeLabel = rangeMode
      ? window.UPOS_DATE_RANGE.labelForRange(input.value || '', dateToValue || input.value || '', 'custom')
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
      onApply: (range) => {
        const next = range.date_from || range.date_to || '';
        const nextTo = rangeMode ? (range.date_to || next) : next;
        input.value = next;
        if (toInput) {
          toInput.value = nextTo;
          toInput.dispatchEvent(new Event('input', { bubbles: true }));
          toInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const nextLabel = rangeMode
          ? window.UPOS_DATE_RANGE.labelForRange(next, nextTo, 'custom')
          : (next ? window.UPOS_DATE_RANGE.display(next) : '');
        picker.setValue({
          preset: 'custom',
          date_from: next,
          date_to: nextTo,
          label: nextLabel,
        });
      },
    });
    input.addEventListener('change', () => {
      const nextTo = rangeMode ? (toInput?.value || input.value || '') : (input.value || '');
      const nextLabel = rangeMode
        ? window.UPOS_DATE_RANGE.labelForRange(input.value || '', nextTo, 'custom')
        : (input.value ? window.UPOS_DATE_RANGE.display(input.value) : '');
      picker.setValue({
        preset: 'custom',
        date_from: input.value || '',
        date_to: nextTo,
        label: nextLabel,
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
