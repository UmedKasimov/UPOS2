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

  function updateFilterAction(form) {
    const kind = form.elements.kind?.value || "product";
    const hash = kind === "service" ? "#service" : "#catalog";
    const base = form.dataset.productsFilterBaseAction || form.getAttribute("action") || location.pathname;
    const actionUrl = new URL(base, location.href);
    actionUrl.hash = hash;
    form.action = actionUrl.toString();
  }

  function submitFilterForm(form) {
    updateFilterAction(form);
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }

  function updateMultiFilterLabel(wrapper) {
    const label = wrapper.querySelector("[data-products-multi-filter-label]");
    if (!label) return;
    const checked = Array.from(
      wrapper.querySelectorAll('input[type="checkbox"]:checked:not([data-products-select-all])')
    );
    const all = checked.find((input) => input.hasAttribute("data-products-filter-all"));
    if (all) {
      label.textContent = all.closest("label")?.innerText.trim() || label.textContent;
      return;
    }
    if (checked.length === 0) {
      label.textContent = label.dataset.productsDefaultLabel || label.textContent;
      return;
    }
    if (checked.length === 1) {
      label.textContent = checked[0].closest("label")?.innerText.trim() || label.textContent;
      return;
    }
    const base = label.dataset.productsDefaultLabel || label.textContent;
    label.textContent = `${base}: ${checked.length}`;
  }

  function syncMultiFilterSelectAllState(wrapper) {
    const selectAll = wrapper.querySelector('input[data-products-select-all]');
    if (!selectAll) return;
    const options = Array.from(
      wrapper.querySelectorAll('input[type="checkbox"]:not([data-products-select-all])')
    );
    const allOption = options.find((node) => node.hasAttribute("data-products-filter-all"));
    const regularOptions = options.filter((node) => !node.hasAttribute("data-products-filter-all"));
    const checkedRegular = regularOptions.filter((node) => node.checked);
    const allChecked = allOption?.checked || (regularOptions.length > 0 && checkedRegular.length === regularOptions.length);
    selectAll.checked = Boolean(allChecked);
    selectAll.indeterminate = !allChecked && checkedRegular.length > 0;
  }

  function applyMultiFilterSelectAll(input) {
    const wrapper = input.closest("[data-products-multi-filter]");
    if (!wrapper) return;
    const options = Array.from(
      wrapper.querySelectorAll('input[type="checkbox"]:not([data-products-select-all])')
    );
    const allOption = options.find((node) => node.hasAttribute("data-products-filter-all"));
    if (!input.checked) {
      options.forEach((node) => {
        node.checked = false;
      });
      return;
    }
    if (allOption) {
      allOption.checked = true;
      options.forEach((node) => {
        if (node !== allOption) node.checked = false;
      });
      return;
    }
    options.forEach((node) => {
      node.checked = true;
    });
  }

  function syncMultiFilterAll(input) {
    const wrapper = input.closest("[data-products-multi-filter]");
    if (!wrapper) return;
    if (input.hasAttribute("data-products-filter-all") && input.checked) {
      wrapper.querySelectorAll('input[type="checkbox"]:not([data-products-filter-all])').forEach((node) => {
        node.checked = false;
      });
      return;
    }
    if (!input.hasAttribute("data-products-filter-all") && input.checked) {
      wrapper.querySelectorAll('input[data-products-filter-all]').forEach((node) => {
        node.checked = false;
      });
    }
    syncMultiFilterSelectAllState(wrapper);
  }

  function highlightProductSearch(root = document) {
    const query = root.querySelector("[data-products-auto-filter] input[name=\"q\"]")?.value.trim() || "";
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 5);
    const targets = root.querySelectorAll(
      ".products-catalog-table .product-cell-meta strong, .products-catalog-table [data-products-search-highlight]"
    );
    targets.forEach((node) => {
      const original = node.dataset.productsOriginalText || node.textContent || "";
      node.dataset.productsOriginalText = original;
      if (!terms.length) {
        node.textContent = original;
        return;
      }
      const pattern = terms
        .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
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

  function initCatalogFilters(root = document) {
    root.querySelectorAll("[data-products-auto-filter]").forEach((form) => {
      if (form.dataset.productsAutoFilterReady === "1") return;
      form.dataset.productsAutoFilterReady = "1";
      let searchTimer = 0;
      let checkboxTimer = 0;

      form.querySelectorAll("[data-products-multi-filter-label]").forEach((label) => {
        label.dataset.productsDefaultLabel = label.textContent || "";
      });
      form.querySelectorAll("[data-products-multi-filter]").forEach((wrapper) => {
        updateMultiFilterLabel(wrapper);
        syncMultiFilterSelectAllState(wrapper);
      });

      Array.from(form.elements).forEach((control) => {
        if (control.type === "hidden") return;
        if (!control?.name && !control.hasAttribute("data-products-select-all")) return;
        if (control.matches('input[type="search"]')) {
          control.addEventListener("input", () => {
            highlightProductSearch(root);
            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => submitFilterForm(form), 450);
          });
          control.addEventListener("search", () => {
            window.clearTimeout(searchTimer);
            submitFilterForm(form);
          });
          return;
        }
        if (control.matches('input[type="checkbox"]')) {
          control.addEventListener("change", () => {
            const wrapper = control.closest("[data-products-multi-filter]");
            if (control.hasAttribute("data-products-select-all")) {
              applyMultiFilterSelectAll(control);
            } else {
              syncMultiFilterAll(control);
            }
            if (wrapper) {
              updateMultiFilterLabel(wrapper);
              syncMultiFilterSelectAllState(wrapper);
            }
            window.clearTimeout(checkboxTimer);
            checkboxTimer = window.setTimeout(() => submitFilterForm(form), 900);
          });
          return;
        }
        control.addEventListener("change", () => submitFilterForm(form));
      });

      form.addEventListener("submit", () => updateFilterAction(form));
    });
    document.addEventListener("click", (event) => {
      document.querySelectorAll("[data-products-multi-filter][open]").forEach((details) => {
        if (!details.contains(event.target)) details.removeAttribute("open");
      });
    });
    highlightProductSearch(root);
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
      case "purchase-price":
        return parseNumber(row.dataset.sortPurchasePrice);
      case "price-list":
        return normalizeText(row.dataset.sortPriceList);
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

  function photoDialog() {
    let dialog = document.querySelector("[data-product-photo-dialog]");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "product-photo-dialog";
    dialog.dataset.productPhotoDialog = "1";
    dialog.innerHTML = `
      <div class="product-photo-dialog-panel">
        <header class="product-photo-dialog-head">
          <strong data-product-photo-dialog-title></strong>
          <button type="button" class="product-photo-dialog-close" data-product-photo-dialog-close aria-label="Закрыть">×</button>
        </header>
        <div class="product-photo-dialog-body">
          <img alt="" data-product-photo-dialog-img />
        </div>
      </div>
    `;
    document.body.append(dialog);
    dialog.addEventListener("click", (event) => {
      if (
        event.target === dialog ||
        event.target.closest("[data-product-photo-dialog-close]")
      ) {
        event.preventDefault();
        if (dialog.open && typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
    });
    return dialog;
  }

  function openPhotoPreview(button) {
    const src = button?.dataset.productPhotoPreview || "";
    if (!src) return;
    const dialog = photoDialog();
    const img = dialog.querySelector("[data-product-photo-dialog-img]");
    const title = dialog.querySelector("[data-product-photo-dialog-title]");
    const label = button.dataset.productPhotoTitle || "Фото товара";
    if (img) {
      img.src = src;
      img.alt = label;
    }
    if (title) title.textContent = label;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
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

  function updateBulkDialogState(form) {
    if (!form) return;
    const selectedCount = Number(form.dataset.productsSelectedCount || "0");
    let hasEnabledField = false;
    form.querySelectorAll("[data-products-bulk-toggle]").forEach((toggle) => {
      const row = toggle.closest(".products-bulk-dialog-row");
      const input = row?.querySelector("[data-products-bulk-input]");
      const enabled = selectedCount > 0 && toggle.checked;
      if (input) {
        input.disabled = !enabled;
        if (!enabled) input.value = "";
      }
      if (enabled) hasEnabledField = true;
    });
    form.querySelectorAll("[data-products-bulk-submit]").forEach((node) => {
      node.disabled = selectedCount <= 0 || !hasEnabledField;
    });
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
    form.dataset.productsSelectedCount = String(count);
    form.querySelectorAll("[data-products-selected-count]").forEach((node) => {
      node.textContent = String(count);
    });
    form.querySelectorAll("[data-products-bulk-open], [data-products-clear-selection]").forEach((node) => {
      node.disabled = count <= 0;
    });
    if (count <= 0) {
      const dialog = form.querySelector("[data-products-bulk-dialog]");
      if (dialog?.open) dialog.close();
      form.querySelectorAll("[data-products-bulk-toggle]").forEach((toggle) => {
        toggle.checked = false;
      });
    }
    updateBulkDialogState(form);
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
      const photoButton = event.target.closest("[data-product-photo-preview]");
      if (photoButton && table.contains(photoButton)) {
        event.preventDefault();
        openPhotoPreview(photoButton);
        return;
      }

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
      const openButton = event.target.closest("[data-products-bulk-open]");
      if (openButton) {
        event.preventDefault();
        const dialog = form.querySelector("[data-products-bulk-dialog]");
        if (dialog && typeof dialog.showModal === "function") dialog.showModal();
        else if (dialog) dialog.setAttribute("open", "");
        updateBulkDialogState(form);
        return;
      }
      const closeButton = event.target.closest("[data-products-bulk-close]");
      if (closeButton) {
        event.preventDefault();
        const dialog = form.querySelector("[data-products-bulk-dialog]");
        if (dialog?.open && typeof dialog.close === "function") dialog.close();
        else if (dialog) dialog.removeAttribute("open");
        return;
      }
      const clearButton = event.target.closest("[data-products-clear-selection]");
      if (!clearButton) return;
      event.preventDefault();
      clearSelection(table);
    });

    form?.addEventListener("change", (event) => {
      if (!event.target.closest("[data-products-bulk-toggle]")) return;
      updateBulkDialogState(form);
    });

    const initial = readState(table);
    updateSortControls(table, initial);
    if (initial.key) sortRows(table, initial, false);
    updateSelectionControls(table);
  }

  function initAll(root = document) {
    initCatalogFilters(root);
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
