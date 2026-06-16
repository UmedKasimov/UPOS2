/**
 * Метаданные валют для иконок/подписей в выпадающих списках и сайдбаре.
 */
(() => {
  const ACCENT = {
    UZS: 'oklch(0.72 0.12 155)',
    USD: 'oklch(0.72 0.11 235)',
    EUR: 'oklch(0.68 0.12 285)',
    RUB: 'oklch(0.72 0.18 35)',
    KZT: 'oklch(0.68 0.12 295)',
    GBP: 'oklch(0.72 0.14 295)',
    CNY: 'oklch(0.74 0.15 65)',
    AED: 'oklch(0.72 0.11 235)',
    TRY: 'oklch(0.72 0.15 340)',
    CHF: 'oklch(0.74 0.12 295)',
    JPY: 'oklch(0.74 0.12 10)',
    KRW: 'oklch(0.74 0.11 295)',
    VND: 'oklch(0.75 0.12 355)',
    UGX: 'oklch(0.73 0.11 295)',
    IDR: 'oklch(0.72 0.12 295)',
    default: 'oklch(0.65 0.08 250)',
  };

  function symbol(code) {
    const m = {
      USD: '$',
      EUR: '€',
      RUB: '₽',
      KZT: '₸',
      GBP: '£',
      TRY: '₺',
      UZS: '',
      JPY: '¥',
      CNY: '¥',
      KRW: '₩',
      CHF: `Fr.`,
      AED: `dh`,
    };
    return m[(code || '').toUpperCase()] || '';
  }

  /** Круг с двумя буквами кода ISO (без CDN флагов). */
  function iconHtml(code, px = 22) {
    const ccy = (code || '??').toUpperCase().slice(0, 3);
    const two = (ccy + 'XX').slice(0, 2);
    const fill = ACCENT[ccy] || ACCENT.default;
    const fs = px > 18 ? 8 : 7;
    const t = two.replace(/</g, '');
    return `<span class="upos-ccy-ic-wrap" aria-hidden="true"><svg class="upos-ccy-ic-svg" width="${px}" height="${px}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="11" fill="${fill}"/><text x="12" y="14.5" text-anchor="middle" fill="#fff" font-size="${fs}px" font-weight="700" font-family="system-ui,sans-serif">${t}</text></svg></span>`;
  }

  function iconHtmlSmall(code) {
    return iconHtml(code, 18);
  }

  /** Текст в нативном option (до кастомного UI). */
  function optionLabel(code) {
    const c = (code || '').toUpperCase();
    const s = symbol(c);
    return s ? `${s}\u202f\u00b7\u202f${c}` : c;
  }

  window.UPOS_CCY = {
    ACCENT,
    symbol,
    iconHtml,
    iconHtmlSmall,
    optionLabel,
  };
})();
