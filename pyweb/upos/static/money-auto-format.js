(() => {
  "use strict";

  const SELECTOR = "input[data-upos-money-format]";

  function amountApi() {
    return window.UPOS_AMOUNT || null;
  }

  function decimalsFor(input) {
    const raw = Number(input?.dataset?.uposMoneyDecimals);
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  }

  function format(input) {
    const api = amountApi();
    if (!api || !input) return;
    api.formatInputElement(input, decimalsFor(input));
  }

  function strip(input) {
    const api = amountApi();
    if (!api || !input) return;
    input.value = api.stripSeparators(input.value);
  }

  function enhanceInput(input) {
    if (!input || input.dataset.uposMoneyReady === "1") return;
    input.dataset.uposMoneyReady = "1";
    input.addEventListener("input", () => format(input));
    input.addEventListener("blur", () => format(input));
    if (input.value) format(input);
  }

  function enhanceAll(root = document) {
    root.querySelectorAll?.(SELECTOR).forEach(enhanceInput);
  }

  document.addEventListener("DOMContentLoaded", () => enhanceAll());

  document.addEventListener(
    "submit",
    (event) => {
      event.target?.querySelectorAll?.(SELECTOR).forEach(strip);
    },
    true
  );

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.(SELECTOR)) enhanceInput(node);
        enhanceAll(node);
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.UPOS_MONEY_AUTO = { enhanceAll, enhanceInput, format, strip };
})();
