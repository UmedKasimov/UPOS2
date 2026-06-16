/**
 * Общее форматирование денежных полей: группы по тысячам при вводе и краткая подсказка (млн / тыс.).
 */
(() => {
  const THIN_NBSP = '\u202f';

  function decimalsForCurrency(currency) {
    const c = (currency || '').toUpperCase();
    const intOnly = new Set(['VND', 'UGX', 'JPY']);
    return intOnly.has(c) ? 0 : 2;
  }

  function stripSeparators(raw) {
    return String(raw || '')
      .replace(/[\s\u202f\u00a0]/g, '')
      .replace(',', '.');
  }

  function parseAmount(raw) {
    if (raw == null) return 0;
    const s = stripSeparators(raw);
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function parseOptionalNumber(raw) {
    const s = String(raw || '')
      .replace(/[\s\u202f\u00a0]/g, '')
      .trim();
    if (!s) return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function formatGroupedDigits(intStr) {
    const digits = String(intStr || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
  }

  function formatGroupedInt(n) {
    return formatGroupedDigits(String(Math.round(Math.abs(Number(n)))));
  }

  /**
   * Компактное отображение суммы: разбивает на млн/тыс без округления.
   * Пример: 7500 → "7 тыс", 1500000 → "1 млн 500 тыс".
   */
  function _compactParts(abs) {
    const mln = Math.floor(abs / 1_000_000);
    const tys = Math.floor((abs % 1_000_000) / 1_000);
    const parts = [];
    const t_mln = (window.upos_i18n && window.upos_i18n['num.mln']) || 'млн';
    const t_tys = (window.upos_i18n && window.upos_i18n['num.tys']) || 'тыс';
    if (mln) parts.push(`${mln}${THIN_NBSP}${t_mln}`);
    if (tys) parts.push(`${tys}${THIN_NBSP}${t_tys}`);
    return parts;
  }

  function formatCompact(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    const cc = (currency || '').toUpperCase();

    if (abs === 0) return `${sign}0${THIN_NBSP}${cc}`;
    if (abs < 1000) return `${sign}${formatGroupedInt(abs)}${THIN_NBSP}${cc}`;
    const parts = _compactParts(abs);
    if (parts.length === 0)
      return `${sign}${formatGroupedInt(Math.round(abs))}${THIN_NBSP}${cc}`;
    return `${sign}${parts.join(THIN_NBSP)}${THIN_NBSP}${cc}`;
  }

  /** Масштаб без кода валюты (поле «курс» и т.п.). */
  function formatCompactBare(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '';
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (abs === 0) return `${sign}0`;
    if (abs >= 1_000_000_000) {
      const t_mlrd = (window.upos_i18n && window.upos_i18n['num.mlrd']) || 'млрд';
      return `${sign}${formatGroupedInt(Math.round(abs / 1_000_000_000))}${THIN_NBSP}${t_mlrd}`;
    }
    if (abs < 1000) return `${sign}${formatGroupedInt(abs)}`;
    const parts = _compactParts(abs);
    if (parts.length === 0) return `${sign}${formatGroupedInt(Math.round(abs))}`;
    return `${sign}${parts.join(THIN_NBSP)}`;
  }

  function parseTypingSegments(raw) {
    const s = String(raw || '').replace(/[\s\u202f\u00a0]/g, '');
    let intDigits = '';
    let fracDigits = '';
    let seenDec = false;
    let hadDecimalSep = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c >= '0' && c <= '9') {
        if (!seenDec) intDigits += c;
        else fracDigits += c;
      } else if ((c === '.' || c === ',') && !seenDec) {
        seenDec = true;
        hadDecimalSep = true;
      }
    }
    const last = s.length ? s[s.length - 1] : '';
    const trailingSep = !!(hadDecimalSep && fracDigits.length === 0 && (last === '.' || last === ','));
    return { intDigits, fracDigits, trailingSep };
  }

  function digitsLeftOfCaret(s, caret) {
    let n = 0;
    const upto = Math.min(caret ?? 0, s.length);
    for (let i = 0; i < upto; i++) if (/\d/.test(s[i])) n++;
    return n;
  }

  function caretAfterDigitCount(display, count) {
    if (count <= 0) return 0;
    let seen = 0;
    for (let i = 0; i < display.length; i++) {
      if (/\d/.test(display[i])) {
        seen++;
        if (seen === count) return i + 1;
      }
    }
    return display.length;
  }

  /**
   * Курс / произвольные положительные дробные: до maxFrac знаков после запятой в вводе.
   */
  function rateDisplayAndNumber(raw, maxFrac) {
    const max = Number.isFinite(maxFrac) ? Math.max(0, Math.floor(maxFrac)) : 10;
    const { intDigits, fracDigits, trailingSep } = parseTypingSegments(raw);
    const intPart = intDigits.replace(/\D/g, '');
    let frac = fracDigits.replace(/\D/g, '').slice(0, max);

    if (!intPart && !frac && !trailingSep) return { display: '', parsed: NaN };

    const intShow = intPart ? formatGroupedDigits(intPart) : frac || trailingSep ? '0' : '';
    let display = intShow;
    if (trailingSep || frac.length) display += `,${frac}`;

    let parsed = NaN;
    if (!intPart && !frac.length && trailingSep) parsed = NaN;
    else if (trailingSep && frac.length === 0 && intPart.length)
      parsed = Number(parseInt(intPart, 10));
    else if (max === 0)
      parsed = intPart.length ? Number(parseInt(intPart, 10)) : NaN;
    else {
      const iNum = intPart.length ? parseInt(intPart, 10) : 0;
      if (frac.length)
        parsed = Number(`${iNum}.${(frac + '0'.repeat(max)).slice(0, max)}`);
      else parsed = Number(`${iNum}`);
    }
    return { display, parsed };
  }

  function buildMoneyDisplayAndNumber(raw, maxDecimals) {
    const md = Number.isFinite(maxDecimals) ? Math.max(0, Math.floor(maxDecimals)) : 2;
    const { intDigits, fracDigits, trailingSep } = parseTypingSegments(raw);
    const intPart = intDigits.replace(/\D/g, '');
    let frac = fracDigits.replace(/\D/g, '').slice(0, md);

    if (md === 0) {
      if (!intPart) return { display: '', parsed: NaN };
      return { display: formatGroupedDigits(intPart), parsed: Number(parseInt(intPart, 10)) };
    }

    const intShow = intPart ? formatGroupedDigits(intPart) : frac || trailingSep ? '0' : '';
    if (!intShow && !frac && !trailingSep) return { display: '', parsed: NaN };

    let display = intShow;
    if (trailingSep || frac.length) display += `,${frac}`;

    if (trailingSep && frac.length === 0) {
      const parsed = intPart.length ? Number(parseInt(intPart, 10)) : NaN;
      return { display, parsed };
    }

    const iNum = intPart.length ? parseInt(intPart, 10) : 0;
    const fd = `${frac}${'0'.repeat(md)}`.slice(0, md);
    let parsed = Number(`${iNum}.${fd}`);
    if (!intPart.length && !frac.length) parsed = NaN;
    parsed = Math.round(parsed * 10 ** md) / 10 ** md;
    return { display, parsed };
  }

  function formatInputElement(el, maxDecimals) {
    if (!el) return NaN;
    const caret = el.selectionStart ?? el.value.length;
    const k = digitsLeftOfCaret(el.value, caret);
    const { display, parsed } = buildMoneyDisplayAndNumber(el.value, maxDecimals);
    el.value = display;
    try {
      const newCaret = caretAfterDigitCount(display, k);
      el.setSelectionRange(newCaret, newCaret);
    } catch {
      /* ignore */
    }
    return parsed;
  }

  function formatRateInputElement(el, maxFrac) {
    if (!el) return NaN;
    const caret = el.selectionStart ?? el.value.length;
    const k = digitsLeftOfCaret(el.value, caret);
    const { display, parsed } = rateDisplayAndNumber(el.value, maxFrac);
    el.value = display;
    try {
      const newCaret = caretAfterDigitCount(display, k);
      el.setSelectionRange(newCaret, newCaret);
    } catch {
      /* ignore */
    }
    return parsed;
  }

  function setInputFromNumber(el, n, maxDecimals) {
    if (!el) return;
    if (!Number.isFinite(n) || n < 0) {
      el.value = '';
      return;
    }
    const md = Number.isFinite(maxDecimals) ? Math.max(0, Math.floor(maxDecimals)) : 2;
    if (md === 0) {
      el.value = formatGroupedInt(n);
      return;
    }
    const rounded = Math.round(n * 100) / 100;
    if (Number.isInteger(rounded)) {
      el.value = formatGroupedInt(rounded);
      return;
    }
    const [a, b] = rounded.toFixed(2).split('.');
    el.value = `${formatGroupedDigits(a)},${b}`;
  }

  function setRateInputFromNumber(el, n, maxFrac = 12) {
    if (!el) return;
    if (!Number.isFinite(n) || n < 0) {
      el.value = '';
      return;
    }
    const s = String(n);
    const [a, b0] = s.includes('.') ? s.split('.') : [s, ''];
    const b = (b0 + '0'.repeat(maxFrac)).slice(0, maxFrac).replace(/0+$/, '');
    el.value = b.length ? `${formatGroupedDigits(a)},${b}` : formatGroupedDigits(a);
  }

  function updateHintEl(hintEl, amount, currency) {
    if (!hintEl) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      hintEl.textContent = '';
      hintEl.hidden = true;
      return;
    }
    const cc = String(currency || '').trim().toUpperCase();
    hintEl.textContent = cc ? formatCompact(n, cc) : formatCompactBare(n);
    hintEl.hidden = false;
  }

  const api = {
    THIN_NBSP,
    decimalsForCurrency,
    parseAmount,
    parseOptionalNumber,
    stripSeparators,
    formatGroupedDigits,
    formatGroupedInt,
    formatCompact,
    formatCompactBare,
    parseTypingSegments,
    buildMoneyDisplayAndNumber,
    rateDisplayAndNumber,
    formatInputElement,
    formatRateInputElement,
    setInputFromNumber,
    setRateInputFromNumber,
    updateHintEl,
    digitsLeftOfCaret,
    caretAfterDigitCount,
  };

  (typeof globalThis !== 'undefined' ? globalThis : window).UPOS_AMOUNT = api;
})();
