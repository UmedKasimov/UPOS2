(() => {
  const TABLE_SELECTOR = "table[data-products-table]";
  const READY_ATTR = "data-products-table-ready";

  function tableIndex(table) {
    return Array.from(document.querySelectorAll(TABLE_SELECTOR)).indexOf(table);
  }

  function storageKey(table) {
    const key = table.id || table.className || "products-table";
    return `upos.productsSort:${location.pathname}:${key}:${tableIndex(table)}`;
  }

  function readState(table) {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey(table)) || "{}");
      return {
        key: typeof raw.key === "string" ? raw.key : "",
        direction: raw.direction === "desc" ? "desc" : "asc",
      };
    } catch {
      return { key: "", direction: "asc" };
    }
  }

  function saveState(table, state) {
    try {
      localStorage.setItem(storageKey(table), JSON.stringify(state));
    } catch {
      /* localStorage may be unavailable. */
    }
  }

  function parseNumber(value) {
    const cleaned = String(value || "")
      .replace(/\s+/g, "")
      .replace(/,/g, ".")
      .replace(/[^\d.-]/g, "");
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : Number.NaN;
  }

  function normalizeText(value) {
    return String(value || "").trim().toLocaleLowerCase("ru");
  }

  function rowValue(row, key) {
    switch (key) {
      case "quantity":
        return parseNumber(row.dataset.sortQuantity);
      case "price":
        return parseNumber(row.dataset.sortPrice);
      case "sku":
        return normalizeText(row.dataset.sortSku);
      case "barcode":
        return normalizeText(row.dataset.sortBarcode);
      case "unit":
        return normalizeText(row.dataset.sortUnit);
      case "category":
        return normalizeText(row.dataset.sortCategory);
      case "status":
        return normalizeText(row.dataset.sortStatus);
      case "name":
      default:
        return normalizeText(row.dataset.sortName);
    }
  }

  function compareRows(left, right, key, direction) {
    const leftValue = rowValue(left, key);
    const rightValue = rowValue(right, key);
    let result = 0;

    if (
      typeof leftValue === "number" &&
      typeof rightValue === "number" &&
      !Number.isNaN(leftValue) &&
      !Number.isNaN(rightValue)
    ) {
      result = leftValue - rightValue;
    } else {
      result = String(leftValue).localeCompare(String(rightValue), "ru", {
        numeric: true,
        sensitivity: "base",
      });
    }

    if (result === 0) {
      const leftName = normalizeText(left.dataset.sortName);
      const rightName = normalizeText(right.dataset.sortName);
      result = leftName.localeCompare(rightName, "ru", {
        numeric: true,
        sensitivity: "base",
      });
    }

    return direction === "desc" ? result * -1 : result;
  }

  function sortRows(table, state, persist = true) {
    const body = table.tBodies[0];
    if (!body || !state.key) return;
    const rows = Array.from(body.rows).filter((row) =>
      row.hasAttribute("data-product-row")
    );
    rows.sort((left, right) => compareRows(left, right, state.key, state.direction));
    rows.forEach((row) => body.append(row));
    if (persist) saveState(table, state);
    updateSortControls(table, state);
  }

  function updateSortControls(table, state) {
    const buttons = table.querySelectorAll("[data-products-sort]");
    buttons.forEach((button) => {
      const key = button.dataset.productsSort || "";
      const th = button.closest("th");
      const arrow = button.querySelector(".org-shipments-sort-arrow");
      const isActive = key === state.key;
      button.classList.toggle("is-active", isActive);
      if (th) {
        th.setAttribute(
          "aria-sort",
          isActive
            ? state.direction === "desc"
              ? "descending"
              : "ascending"
            : "none"
        );
      }
      if (arrow) {
        arrow.textContent = isActive
          ? state.direction === "desc"
            ? "\u2193"
            : "\u2191"
          : "\u2195";
      }
    });
  }

  function bulkForm(table) {
    return (
      table.closest(".products-list-panel")?.querySelector("[data-products-bulk-form]") ||
      document.querySelector("[data-products-bulk-form]")
    );
  }

  function selectionInputs(table) {
    return Array.from(table.querySelectorAll("[data-products-select]"));
  }

  function selectedInputs(table) {
    return selectionInputs(table).filter((input) => input.checked);
  }

  function updateSelectionControls(table) {
    const form = bulkForm(table);
    const selected = selectedInputs(table);
    const count = selected.length;
    const allToggle = table.querySelector("[data-products-select-all]");
    const rowInputs = selectionInputs(table);

    if (allToggle) {
      allToggle.checked = count > 0 && count === rowInputs.length;
      allToggle.indeterminate = count > 0 && count < rowInputs.length;
    }

    if (!form) return;
    form.hidden = count <= 0;
    form.querySelectorAll("[data-products-selected-count]").forEach((node) => {
      node.textContent = String(count);
    });
    form.querySelectorAll("[data-products-bulk-input], [data-products-bulk-submit], [data-products-clear-selection]").forEach((node) => {
      node.disabled = count <= 0;
    });
  }

  function clearSelection(table) {
    selectionInputs(table).forEach((input) => {
      input.checked = false;
    });
    const allToggle = table.querySelector("[data-products-select-all]");
    if (allToggle) {
      allToggle.checked = false;
      allToggle.indeterminate = false;
    }
    updateSelectionControls(table);
  }

  function initTable(table) {
    if (!table || table.getAttribute(READY_ATTR) === "1") return;
    table.setAttribute(READY_ATTR, "1");

    table.addEventListener("click", (event) => {
      const button = event.target.closest("[data-products-sort]");
      if (!button || !table.contains(button)) return;
      event.preventDefault();
      const key = button.dataset.productsSort || "";
      if (!key) return;
      const current = readState(table);
      const next = {
        key,
        direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
      };
      sortRows(table, next, true);
    });

    table.addEventListener("change", (event) => {
      const selectAll = event.target.closest("[data-products-select-all]");
      if (selectAll) {
        selectionInputs(table).forEach((input) => {
          input.checked = selectAll.checked;
        });
        updateSelectionControls(table);
        return;
      }
      const checkbox = event.target.closest("[data-products-select]");
      if (!checkbox) return;
      updateSelectionControls(table);
    });

    const form = bulkForm(table);
    form?.addEventListener("click", (event) => {
      const clearButton = event.target.closest("[data-products-clear-selection]");
      if (!clearButton) return;
      event.preventDefault();
      clearSelection(table);
    });

    const initial = readState(table);
    updateSortControls(table, initial);
    if (initial.key) sortRows(table, initial, false);
    updateSelectionControls(table);
  }

  function initAll(root = document) {
    root.querySelectorAll(TABLE_SELECTOR).forEach(initTable);
  }

  function purchaseRowTemplate() {
    const row = document.createElement("div");
    row.className = "product-purchase-row";
    row.dataset.productsPurchaseRow = "1";
    row.innerHTML = `
      <input name="purchase_date" type="date" />
      <input name="purchase_warehouse" value="Основной склад" placeholder="Склад" />
      <input name="purchase_quantity" placeholder="К-во" inputmode="decimal" />
      <input name="purchase_price" placeholder="Цена" inputmode="decimal" />
      <input name="purchase_supplier" placeholder="Поставщик" />
      <button type="button" class="btn btn-secondary" data-products-remove-line>×</button>
    `;
    return row;
  }

  function variationRowTemplate() {
    const row = document.createElement("div");
    row.className = "product-line-grid product-line-grid--variation";
    row.dataset.productsVariationRow = "1";
    row.innerHTML = `
      <input name="variation_attribute" placeholder="Размер / Цвет / Материал" />
      <input name="variation_values" placeholder="S, M, L или Красный, Чёрный" />
      <button type="button" class="btn btn-secondary" data-products-remove-line>×</button>
    `;
    return row;
  }

  function syncVariationVisibility(form) {
    const section = form.querySelector("[data-product-variations]");
    if (!section) return;
    const selected = form.querySelector('input[name="kind"]:checked')?.value || "product";
    section.hidden = selected !== "collection";
  }

  function initProductForms(root = document) {
    root.querySelectorAll(".product-form").forEach((form) => {
      if (form.dataset.productsFormReady === "1") return;
      form.dataset.productsFormReady = "1";
      syncVariationVisibility(form);
      form.addEventListener("change", (event) => {
        if (event.target.matches('input[name="kind"]')) syncVariationVisibility(form);
      });
      form.addEventListener("click", (event) => {
        const addPurchase = event.target.closest("[data-products-add-purchase-row]");
        if (addPurchase && form.contains(addPurchase)) {
          event.preventDefault();
          const list = form.querySelector("[data-products-purchase-list]");
          if (list) list.append(purchaseRowTemplate());
          return;
        }
        const addVariation = event.target.closest("[data-products-add-variation-row]");
        if (addVariation && form.contains(addVariation)) {
          event.preventDefault();
          const list = form.querySelector("[data-products-variation-list]");
          if (list) list.append(variationRowTemplate());
          return;
        }
        const removeLine = event.target.closest("[data-products-remove-line]");
        if (removeLine && form.contains(removeLine)) {
          event.preventDefault();
          const row = removeLine.closest("[data-products-purchase-row], [data-products-variation-row]");
          const list = row?.parentElement;
          if (row && list && list.children.length > 1) row.remove();
          else if (row) row.querySelectorAll("input").forEach((input) => (input.value = ""));
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initAll();
      initProductForms();
    }, { once: true });
  } else {
    initAll();
    initProductForms();
  }
})();
