(() => {
  function enhance(input) {
    if (!input || input.dataset.uposDateEnhanced === '1' || !window.UPOS_DATE_RANGE) return;
    input.dataset.uposDateEnhanced = '1';
    input.classList.add('upos-date-hidden-input');
    const mount = document.createElement('span');
    mount.className = 'upos-date-auto';
    input.insertAdjacentElement('afterend', mount);
    const picker = window.UPOS_DATE_RANGE.create(mount, {
      mode: 'single',
      preset: 'custom',
      date_from: input.value || '',
      date_to: input.value || '',
      label: input.value ? window.UPOS_DATE_RANGE.display(input.value) : '',
      onApply: (range) => {
        const next = range.date_from || range.date_to || '';
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        picker.setValue({
          preset: 'custom',
          date_from: next,
          date_to: next,
          label: next ? window.UPOS_DATE_RANGE.display(next) : '',
        });
      },
    });
    input.addEventListener('change', () => {
      picker.setValue({
        preset: 'custom',
        date_from: input.value || '',
        date_to: input.value || '',
        label: input.value ? window.UPOS_DATE_RANGE.display(input.value) : '',
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
