(function () {
  function updateAction(form) {
    const hash = form.action.includes("#") ? form.action.slice(form.action.indexOf("#")) : "#purchases";
    const base = form.action.split("#")[0] || window.location.pathname;
    const params = new URLSearchParams(new FormData(form));
    Array.from(params.keys()).forEach((key) => {
      if (!params.get(key)) params.delete(key);
    });
    form.action = `${base}${params.toString() ? `?${params.toString()}` : ""}${hash}`;
  }

  function highlight(root) {
    const query = root.querySelector("[data-warehouse-purchases-filter] input[name=\"q\"]")?.value.trim() || "";
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 5);
    const targets = root.querySelectorAll("[data-warehouse-purchase-highlight]");
    targets.forEach((node) => {
      const original = node.dataset.warehousePurchaseOriginalText || node.textContent || "";
      node.dataset.warehousePurchaseOriginalText = original;
      if (!terms.length) {
        node.textContent = original;
        return;
      }
      const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      if (!pattern) {
        node.textContent = original;
        return;
      }
      const regex = new RegExp(`(${pattern})`, "gi");
      node.replaceChildren();
      let cursor = 0;
      original.replace(regex, (match, _group, offset) => {
        if (offset > cursor) node.append(document.createTextNode(original.slice(cursor, offset)));
        const mark = document.createElement("mark");
        mark.className = "products-search-hit";
        mark.textContent = match;
        node.append(mark);
        cursor = offset + match.length;
        return match;
      });
      if (cursor < original.length) node.append(document.createTextNode(original.slice(cursor)));
    });
  }

  function init(root = document) {
    root.querySelectorAll("[data-warehouse-purchases-filter]").forEach((form) => {
      if (form.dataset.warehousePurchasesReady === "1") return;
      form.dataset.warehousePurchasesReady = "1";
      let timer = 0;
      const submit = () => {
        updateAction(form);
        form.requestSubmit();
      };
      Array.from(form.elements).forEach((control) => {
        if (control.matches?.('input[type="search"]')) {
          control.addEventListener("input", () => {
            highlight(root);
            window.clearTimeout(timer);
            timer = window.setTimeout(submit, 450);
          });
          control.addEventListener("search", () => {
            window.clearTimeout(timer);
            submit();
          });
          return;
        }
        if (!control.disabled && control.name) {
          control.addEventListener("change", submit);
        }
      });
      form.addEventListener("submit", () => updateAction(form));
    });
    highlight(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
