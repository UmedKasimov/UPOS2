(function () {
  let activeSupplierPicker = null;

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

  function moneyWithCurrency(value, currency) {
    const code = String(currency || "UZS").trim() || "UZS";
    return purchaseEntryMoney(purchaseEntryNumber(value), code);
  }

  function purchaseEntryNumber(value) {
    const compact = String(value || "")
      .replace(/\s+/g, "")
      .replace(",", ".");
    const direct = Number.parseFloat(compact);
    if (Number.isFinite(direct) && /^[+-]?\d/.test(compact)) return direct;
    const normalized = compact
      .replace(/[^\d.-]/g, "");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function purchaseEntryFormat(value) {
    const rounded = Math.round(Number(value || 0));
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(rounded);
  }

  function purchaseEntryCurrencyDigits(currency) {
    return String(currency || "").toUpperCase() === "UZS" ? 0 : 2;
  }

  function purchaseEntryFormatCurrency(value, currency) {
    const digits = purchaseEntryCurrencyDigits(currency);
    const factor = Math.pow(10, digits);
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return "0";
    const rounded = Math.round(numeric * factor) / factor;
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(rounded);
  }

  function purchaseEntryFormatLive(value, currency) {
    const text = String(value || "").replace(/\s+/g, "");
    const negative = text.trim().startsWith("-");
    const unsigned = text.replace(/-/g, "");
    const separatorIndexes = [unsigned.indexOf("."), unsigned.indexOf(",")].filter((index) => index >= 0);
    const separatorIndex = separatorIndexes.length ? Math.min(...separatorIndexes) : -1;
    const hasDecimal = purchaseEntryCurrencyDigits(currency) > 0 && separatorIndex >= 0;
    const integerRaw = hasDecimal ? unsigned.slice(0, separatorIndex) : unsigned;
    const fractionRaw = hasDecimal ? unsigned.slice(separatorIndex + 1) : "";
    const integerDigits = integerRaw.replace(/\D/g, "");
    const fractionDigits = fractionRaw.replace(/\D/g, "").slice(0, purchaseEntryCurrencyDigits(currency));
    if (!integerDigits && !hasDecimal) return negative ? "-" : "";
    const grouped = (integerDigits || "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${negative ? "-" : ""}${grouped}${hasDecimal ? `,${fractionDigits}` : ""}`;
  }

  function formatPurchasePriceInput(input, currency) {
    const value = String(input.value || "");
    const cursor = input.selectionStart ?? value.length;
    const cursorAtEnd = cursor >= value.length;
    const digitsBeforeCursor = value.slice(0, cursor).replace(/\D/g, "").length;
    const formatted = purchaseEntryFormatLive(value, currency);
    input.value = formatted;
    let nextCursor = formatted.length;
    if (!cursorAtEnd) {
      nextCursor = formatted.startsWith("-") && digitsBeforeCursor === 0 ? 1 : 0;
      let seenDigits = 0;
      for (let index = 0; index < formatted.length; index += 1) {
        if (/\d/.test(formatted[index])) seenDigits += 1;
        if (seenDigits >= digitsBeforeCursor) {
          nextCursor = index + 1;
          break;
        }
      }
    }
    input.setSelectionRange(nextCursor, nextCursor);
  }

  function purchaseEntryMoney(value, currency) {
    return `${purchaseEntryFormatCurrency(value, currency)} ${currency || "UZS"}`;
  }

  function purchaseEntryUsdRate(options) {
    const fx = options?.fx || {};
    const rate = purchaseEntryNumber(fx.USD_UZS || fx.usd_uzs || fx.usdUzs || "12000");
    return rate > 0 ? rate : 12000;
  }

  function convertPurchaseCurrency(value, fromCurrency, toCurrency, options) {
    const amount = purchaseEntryNumber(value);
    const source = String(fromCurrency || "UZS").toUpperCase();
    const target = String(toCurrency || "UZS").toUpperCase();
    const rate = purchaseEntryUsdRate(options);
    if (!amount || source === target) return amount;
    if (source === "USD" && target === "UZS") return amount * rate;
    if (source === "UZS" && target === "USD") return amount / rate;
    return amount;
  }

  function readPurchaseOptions() {
    const node = document.getElementById("warehouse-purchase-options");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function highlightText(value, query) {
    const text = String(value || "");
    const q = String(query || "").trim();
    if (!q) return escapeHtml(text);
    const index = text.toLowerCase().indexOf(q.toLowerCase());
    if (index < 0) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, index)) +
      '<mark class="sales-search-mark">' +
      escapeHtml(text.slice(index, index + q.length)) +
      "</mark>" +
      escapeHtml(text.slice(index + q.length))
    );
  }

  function productKind(item) {
    return String(item?.kind || "product").toLowerCase() === "service" ? "service" : "product";
  }

  function itemMatches(item, query) {
    const q = normalize(query);
    if (!q) return true;
    return ["name", "sku", "barcode", "category", "brand"].some((field) => normalize(item?.[field]).includes(q));
  }

  function productStockLabel(item) {
    const total = Array.isArray(item?.stocks)
      ? item.stocks.reduce((sum, stock) => sum + purchaseEntryNumber(stock?.quantity), 0)
      : 0;
    const unit = String(item?.unit || "шт").trim() || "шт";
    return `${purchaseEntryFormat(total)} ${unit}`;
  }

  function latestPurchasePrice(item) {
    const history = Array.isArray(item?.purchase_history) ? item.purchase_history : [];
    const latest = [...history].reverse().find((row) => purchaseEntryNumber(row?.price) > 0);
    if (latest) return latest.price;
    const stock = Array.isArray(item?.stocks) ? item.stocks.find((row) => purchaseEntryNumber(row?.price) > 0) : null;
    if (stock) return stock.price;
    return item?.sale_price || "";
  }

  function selectedPurchasePriceType(form) {
    const select = form?.querySelector("[data-purchase-price-type]");
    const hidden = form?.querySelector("[data-purchase-price-type-name]");
    const option = select?.selectedOptions?.[0] || null;
    const selected = {
      id: String(select?.value || "").trim(),
      name: String(option?.dataset?.name || option?.textContent || "").trim(),
      currency: String(option?.dataset?.currency || "UZS").trim().toUpperCase() || "UZS",
    };
    if (hidden) hidden.value = selected.name;
    return selected;
  }

  function syncPurchasePriceTitle(form) {
    const priceType = selectedPurchasePriceType(form);
    const title = priceType.name || "Продажная цена";
    const header = form?.querySelector("[data-purchase-sale-price-title]");
    if (header) header.textContent = title;
    form?.querySelectorAll("[data-purchase-entry-sale-price]").forEach((input) => {
      input.placeholder = title;
      input.title = title;
    });
    return priceType;
  }

  function productPriceForType(item, priceType) {
    const prices = Array.isArray(item?.prices) ? item.prices : [];
    const typeId = String(priceType?.id || "").trim();
    const typeName = normalize(priceType?.name);
    const entry = prices.find((price) => String(price?.price_type_id || "").trim() === typeId)
      || prices.find((price) => normalize(price?.name) === typeName);
    return entry?.price || "";
  }

  function productPriceEntryForType(item, priceType) {
    const prices = Array.isArray(item?.prices) ? item.prices : [];
    const typeId = String(priceType?.id || "").trim();
    const typeName = normalize(priceType?.name);
    return prices.find((price) => String(price?.price_type_id || "").trim() === typeId)
      || prices.find((price) => normalize(price?.name) === typeName)
      || null;
  }

  function productByRow(form, row) {
    const picker = row?.querySelector("[data-warehouse-product-picker]");
    const productId = String(picker?.dataset?.productId || "").trim();
    const name = String(row?.querySelector('input[name="line_product"]')?.value || "").trim();
    const options = readPurchaseOptions();
    const products = Array.isArray(options.product_rows) ? options.product_rows : [];
    return products.find((item) => String(item?.id || "") === productId)
      || products.find((item) => normalize(item?.name) === normalize(name))
      || null;
  }

  function purchaseProductKey(item) {
    const id = String(item?.id || "").trim();
    if (id) return `id:${id}`;
    return `name:${normalize(item?.name)}`;
  }

  function selectedPurchaseProductKeys(form, exceptRow) {
    const keys = new Set();
    form?.querySelectorAll("[data-purchase-entry-row]").forEach((row) => {
      if (row === exceptRow) return;
      const picker = row.querySelector("[data-warehouse-product-picker]");
      const input = row.querySelector('input[name="line_product"]');
      const id = String(picker?.dataset?.productId || "").trim();
      const name = String(input?.value || "").trim();
      if (id) keys.add(`id:${id}`);
      else if (name) keys.add(`name:${normalize(name)}`);
    });
    return keys;
  }

  function findDuplicatePurchaseProductRow(form, currentRow, item) {
    const selectedKey = purchaseProductKey(item);
    if (!selectedKey || selectedKey === "name:") return null;
    return Array.from(form?.querySelectorAll("[data-purchase-entry-row]") || []).find((row) => {
      if (row === currentRow) return false;
      const picker = row.querySelector("[data-warehouse-product-picker]");
      const input = row.querySelector('input[name="line_product"]');
      const id = String(picker?.dataset?.productId || "").trim();
      const name = String(input?.value || "").trim();
      const rowKey = id ? `id:${id}` : name ? `name:${normalize(name)}` : "";
      return rowKey === selectedKey;
    }) || null;
  }

  function closeProductPanel(picker) {
    const panel = picker?.querySelector("[data-warehouse-product-panel]");
    if (panel) panel.hidden = true;
  }

  function closeSupplierPanel(picker) {
    const panel = picker?.querySelector("[data-warehouse-supplier-panel]");
    if (panel) panel.hidden = true;
  }

  function positionFloatingPanel(input, panel, minWidth) {
    if (!input || !panel || panel.hidden) return;
    const rect = input.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const width = Math.min(Math.max(rect.width, minWidth), Math.max(260, viewportWidth - 24));
    const left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - width - 12));
    let top = rect.bottom + 4;
    let maxHeight = Math.min(288, viewportHeight - top - 12);
    if (maxHeight < 160 && rect.top > 180) {
      maxHeight = Math.min(288, rect.top - 12);
      top = Math.max(12, rect.top - maxHeight - 4);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(160, maxHeight)}px`;
  }

  function positionProductPanel(picker) {
    const input = picker?.querySelector("[data-warehouse-product-input]");
    const panel = picker?.querySelector("[data-warehouse-product-panel]");
    positionFloatingPanel(input, panel, 420);
  }

  function positionSupplierPanel(picker) {
    const input = picker?.querySelector("[data-warehouse-supplier-input]");
    const panel = picker?.querySelector("[data-warehouse-supplier-panel]");
    positionFloatingPanel(input, panel, 320);
  }

  function setProductLocked(picker, locked) {
    const input = picker?.querySelector("[data-warehouse-product-input]");
    const edit = picker?.querySelector("[data-warehouse-product-edit]");
    picker?.classList.toggle("is-locked", Boolean(locked));
    if (input) input.readOnly = Boolean(locked);
    if (edit) edit.hidden = !locked;
    if (locked) closeProductPanel(picker);
  }

  function setSupplierLocked(picker, locked) {
    const input = picker?.querySelector("[data-warehouse-supplier-input]");
    const edit = picker?.querySelector("[data-warehouse-supplier-edit]");
    picker?.classList.toggle("is-locked", Boolean(locked));
    if (input) input.readOnly = Boolean(locked);
    if (edit) edit.hidden = !locked;
    if (locked) closeSupplierPanel(picker);
  }

  function supplierMatches(name, query) {
    const q = normalize(query);
    if (!q) return true;
    return normalize(name).includes(q);
  }

  function commitSupplier(picker, value) {
    const input = picker?.querySelector("[data-warehouse-supplier-input]");
    if (!input) return;
    input.value = String(value || "").trim();
    setSupplierLocked(picker, Boolean(input.value));
  }

  function setSupplierDialogStatus(form, message, variant) {
    const status = form?.querySelector("[data-warehouse-supplier-status]");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.variant = variant || "";
  }

  function upsertSupplierOption(name) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return;
    const node = document.getElementById("warehouse-purchase-options");
    const options = readPurchaseOptions();
    const suppliers = Array.isArray(options.suppliers) ? options.suppliers : [];
    if (!suppliers.some((item) => normalize(item) === normalize(cleanName))) {
      suppliers.push(cleanName);
      suppliers.sort((a, b) => String(a || "").localeCompare(String(b || ""), "ru"));
    }
    options.suppliers = suppliers;
    if (node) node.textContent = JSON.stringify(options);
  }

  function closeSupplierDialog(entryForm) {
    const dialog = entryForm?.parentElement?.querySelector("[data-warehouse-supplier-dialog]") || document.querySelector("[data-warehouse-supplier-dialog]");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
    activeSupplierPicker = null;
  }

  function openSupplierDialog(entryForm, picker, query) {
    const dialog = entryForm?.parentElement?.querySelector("[data-warehouse-supplier-dialog]") || document.querySelector("[data-warehouse-supplier-dialog]");
    const form = dialog?.querySelector("[data-warehouse-supplier-form]");
    if (!dialog || !form) return;
    activeSupplierPicker = picker || null;
    closeSupplierPanel(picker);
    form.reset();
    const nameInput = form.querySelector("[data-warehouse-supplier-name]");
    if (nameInput) nameInput.value = String(query || "").trim();
    setSupplierDialogStatus(form, "", "");
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch (_) {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.hidden = false;
      dialog.setAttribute("open", "");
    }
    if (!dialog.open) dialog.setAttribute("open", "");
    setTimeout(() => {
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
      }
    }, 0);
  }

  function wireSupplierDialog(entryForm) {
    const dialog = entryForm?.parentElement?.querySelector("[data-warehouse-supplier-dialog]") || document.querySelector("[data-warehouse-supplier-dialog]");
    const form = dialog?.querySelector("[data-warehouse-supplier-form]");
    if (!dialog || !form || dialog.dataset.warehouseSupplierDialogReady === "1") return;
    dialog.dataset.warehouseSupplierDialogReady = "1";
    dialog.querySelectorAll("[data-warehouse-supplier-dialog-close], [data-warehouse-supplier-dialog-cancel]").forEach((button) => {
      button.addEventListener("click", () => closeSupplierDialog(entryForm));
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const submit = form.querySelector("[data-warehouse-supplier-submit]");
      const endpoint = entryForm.getAttribute("data-warehouse-supplier-quick-save-url") || "/warehouse/suppliers/quick-save";
      setSupplierDialogStatus(form, "Сохраняю...", "");
      if (submit) submit.disabled = true;
      fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" },
      })
        .then((response) =>
          response.json().catch(() => ({})).then((body) => {
            if (!response.ok || !body.supplier) throw new Error(body.error || "Не удалось сохранить");
            return body.supplier;
          })
        )
        .then((supplier) => {
          upsertSupplierOption(supplier.name);
          const picker = activeSupplierPicker && document.contains(activeSupplierPicker)
            ? activeSupplierPicker
            : entryForm.querySelector("[data-warehouse-supplier-picker]");
          commitSupplier(picker, supplier.name);
          setSupplierDialogStatus(form, "Сохранено", "ok");
          closeSupplierDialog(entryForm);
        })
        .catch((error) => {
          setSupplierDialogStatus(form, error.message || "Не удалось сохранить", "err");
        })
        .finally(() => {
          if (submit) submit.disabled = false;
        });
    });
  }

  function renderSupplierPicker(picker, query) {
    const options = readPurchaseOptions();
    const panel = picker.querySelector("[data-warehouse-supplier-panel]");
    if (!panel) return;
    const cleanQuery = String(query || "").trim();
    const rows = (options.suppliers || [])
      .filter((name) => supplierMatches(name, cleanQuery))
      .slice(0, 80);
    const createLabel = cleanQuery ? `+ Создать поставщика "${cleanQuery}"` : "+ Создать поставщика";
    panel.innerHTML =
      `<button type="button" class="sales-combo-create" data-warehouse-supplier-create>${escapeHtml(createLabel)}</button>` +
      (rows.length
        ? rows
            .map(
              (name) =>
                '<button type="button" class="sales-combo-option">' +
                '<span class="sales-combo-main">' +
                highlightText(name, cleanQuery) +
                "</span>" +
                '<span class="sales-combo-meta"><span>Поставщик</span><strong>Контрагент</strong></span>' +
                "</button>"
            )
            .join("")
        : '<div class="sales-combo-empty">Ничего не найдено</div>');
    panel.hidden = false;
    positionSupplierPanel(picker);
    panel.querySelector("[data-warehouse-supplier-create]")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      openSupplierDialog(picker.closest("[data-warehouse-purchase-entry]"), picker, cleanQuery);
    });
    panel.querySelectorAll(".sales-combo-option").forEach((button, index) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        commitSupplier(picker, rows[index]);
      });
    });
  }

  function wireSupplierPicker(form) {
    const picker = form.querySelector("[data-warehouse-supplier-picker]");
    const input = picker?.querySelector("[data-warehouse-supplier-input]");
    const edit = picker?.querySelector("[data-warehouse-supplier-edit]");
    if (!picker || !input || picker.dataset.warehouseSupplierReady === "1") return;
    picker.dataset.warehouseSupplierReady = "1";
    input.addEventListener("focus", () => {
      if (!input.readOnly) renderSupplierPicker(picker, input.value);
    });
    input.addEventListener("input", () => {
      if (!input.readOnly) renderSupplierPicker(picker, input.value);
    });
    input.addEventListener("keydown", (event) => {
      const panel = picker.querySelector("[data-warehouse-supplier-panel]");
      const first = panel?.querySelector(".sales-combo-option");
      if (event.key === "Escape") closeSupplierPanel(picker);
      if (event.key === "Enter" && first && !panel.hidden) {
        event.preventDefault();
        first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      }
    });
    edit?.addEventListener("click", () => {
      setSupplierLocked(picker, false);
      input.focus();
      input.select();
      renderSupplierPicker(picker, input.value);
    });
  }

  function renderProductPicker(form, picker, query) {
    const options = readPurchaseOptions();
    const panel = picker.querySelector("[data-warehouse-product-panel]");
    if (!panel) return;
    const row = picker.closest("[data-purchase-entry-row]");
    const selectedKeys = selectedPurchaseProductKeys(form, row);
    const matchedRows = (options.product_rows || [])
      .filter((item) => productKind(item) === "product" && itemMatches(item, query));
    const rows = matchedRows
      .filter((item) => !selectedKeys.has(purchaseProductKey(item)))
      .slice(0, 100);
    panel.innerHTML =
      '<button type="button" class="sales-combo-create" data-warehouse-product-create>+ Создать товар</button>' +
      (rows.length
      ? rows
          .map((item) => {
            const code = item.sku || item.barcode || "Товар";
            const price = latestPurchasePrice(item);
            const priceLabel = price ? `${purchaseEntryFormat(purchaseEntryNumber(price))} ${form.querySelector("[data-purchase-entry-currency]")?.value || "UZS"}` : "Без цены";
            return (
              '<button type="button" class="sales-combo-option">' +
              '<span class="sales-combo-main">' +
              highlightText(item.name, query) +
              "</span>" +
              '<span class="sales-combo-meta"><span>' +
              escapeHtml(`${code} · ${productStockLabel(item)}`) +
              "</span><strong>" +
              escapeHtml(priceLabel) +
              "</strong></span></button>"
            );
          })
          .join("")
      : `<div class="sales-combo-empty">${matchedRows.length ? "Товар уже добавлен в список" : "Ничего не найдено"}</div>`);
    panel.hidden = false;
    positionProductPanel(picker);
    panel.querySelector("[data-warehouse-product-create]")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      window.location.href = "/products?kind=product#product-form";
    });
    panel.querySelectorAll(".sales-combo-option").forEach((button, index) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        applyProductSelection(form, picker, rows[index]);
      });
    });
  }

  function applyProductSelection(form, picker, item) {
    if (!picker || !item) return;
    const input = picker.querySelector("[data-warehouse-product-input]");
    const row = picker.closest("[data-purchase-entry-row]");
    const duplicateRow = findDuplicatePurchaseProductRow(form, row, item);
    if (duplicateRow) {
      if (input) input.value = picker.dataset.previousProductName || "";
      if (picker.dataset.previousProductId) picker.dataset.productId = picker.dataset.previousProductId;
      else delete picker.dataset.productId;
      setProductLocked(picker, Boolean(input?.value));
      closeProductPanel(picker);
      duplicateRow.querySelector('input[name="line_quantity"]')?.focus();
      duplicateRow.classList.add("warehouse-purchase-entry-row--attention");
      window.setTimeout(() => duplicateRow.classList.remove("warehouse-purchase-entry-row--attention"), 900);
      return;
    }
    if (input) input.value = item.name || "";
    picker.dataset.productId = item.id || "";
    if (row) {
      const quantity = row.querySelector('input[name="line_quantity"]');
      const price = row.querySelector('input[name="line_price"]');
      const salePrice = row.querySelector('input[name="line_sale_price"]');
      if (quantity && !quantity.value.trim()) quantity.value = "1";
      if (price) {
        const value = purchaseEntryNumber(latestPurchasePrice(item));
        if (value) price.value = purchaseEntryFormat(value);
      }
      if (salePrice && !salePrice.value.trim()) {
        const priceType = selectedPurchasePriceType(form);
        const entry = productPriceEntryForType(item, priceType);
        const sourceCurrency = String(entry?.currency || priceType.currency || "UZS").toUpperCase();
        const targetCurrency = form.querySelector("[data-purchase-entry-currency]")?.value || "UZS";
        const value = purchaseEntryNumber(entry?.price || "");
        if (value) {
          salePrice.value = purchaseEntryFormatCurrency(
            convertPurchaseCurrency(value, sourceCurrency, targetCurrency, readPurchaseOptions()),
            targetCurrency
          );
        }
      }
    }
    setProductLocked(picker, Boolean(input?.value));
    closeProductPanel(picker);
    picker.dispatchEvent(new CustomEvent("purchase-entry-product-selected", { bubbles: true }));
  }

  function wireProductPicker(form, row) {
    const picker = row.querySelector("[data-warehouse-product-picker]");
    const input = picker?.querySelector("[data-warehouse-product-input]");
    const edit = picker?.querySelector("[data-warehouse-product-edit]");
    if (!picker || !input || picker.dataset.warehouseProductReady === "1") return;
    picker.dataset.warehouseProductReady = "1";
    input.addEventListener("focus", () => {
      if (!input.readOnly) renderProductPicker(form, picker, input.value);
    });
    input.addEventListener("input", () => {
      if (!input.readOnly) renderProductPicker(form, picker, input.value);
    });
    input.addEventListener("keydown", (event) => {
      const panel = picker.querySelector("[data-warehouse-product-panel]");
      const first = panel?.querySelector(".sales-combo-option");
      if (event.key === "Escape") closeProductPanel(picker);
      if (event.key === "Enter" && first && !panel.hidden) {
        event.preventDefault();
        first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      }
    });
    edit?.addEventListener("click", () => {
      picker.dataset.previousProductName = input.value || "";
      picker.dataset.previousProductId = picker.dataset.productId || "";
      setProductLocked(picker, false);
      input.focus();
      input.select();
      renderProductPicker(form, picker, input.value);
    });
  }

  function initPurchaseEntry(root = document) {
    root.querySelectorAll("[data-warehouse-purchase-entry]").forEach((form) => {
      if (form.dataset.purchaseEntryReady === "1") return;
      form.dataset.purchaseEntryReady = "1";

      const body = form.querySelector("[data-purchase-entry-lines]");
      const currencyInput = form.querySelector("[data-purchase-entry-currency]");
      const amountInput = form.querySelector("[data-purchase-entry-amount]");
      const paidInput = form.querySelector("[data-purchase-paid-amount]");
      const paymentTypeInput = form.querySelector("[data-purchase-payment-type]");
      const paymentLinesInput = form.querySelector("[data-purchase-payment-lines]");
      const statusInput = form.querySelector("[data-purchase-status]");
      const totalOutput = form.querySelector("[data-purchase-entry-total]");
      const totalDisplayOutput = form.querySelector("[data-purchase-entry-total-display]");
      const saleTotalOutput = form.querySelector("[data-purchase-entry-sale-total]");
      const paymentDialog = form.parentElement ? form.parentElement.querySelector("[data-purchase-payment-dialog]") : null;
      const options = readPurchaseOptions();
      if (!body) return;
      wireSupplierPicker(form);
      wireSupplierDialog(form);
      syncPurchasePriceTitle(form);

      const rows = () => Array.from(body.querySelectorAll("[data-purchase-entry-row]"));
      const rowHasProduct = (row) => Boolean(row.querySelector('input[name="line_product"]')?.value.trim());
      const rowTotal = (row) => {
        const quantity = purchaseEntryNumber(row.querySelector('input[name="line_quantity"]')?.value || "1") || 0;
        const price = purchaseEntryNumber(row.querySelector('input[name="line_price"]')?.value);
        return quantity * price;
      };
      const rowSaleTotal = (row) => {
        const quantity = purchaseEntryNumber(row.querySelector('input[name="line_quantity"]')?.value || "1") || 0;
        const price = purchaseEntryNumber(row.querySelector('input[name="line_sale_price"]')?.value);
        return quantity * price;
      };
      const currency = () => currencyInput?.value || "UZS";
      const saleCurrency = () => currency();
      form.dataset.purchaseEntryCurrency = currency();

      const paymentRows = () => paymentDialog ? Array.from(paymentDialog.querySelectorAll("[data-purchase-payment-line]")) : [];
      const paymentLabel = (select) => {
        if (!select) return "";
        const option = select.selectedOptions ? select.selectedOptions[0] : null;
        return option ? option.getAttribute("data-label") || option.textContent.trim() || select.value : select.value || "";
      };
      const setPaymentSelect = (select, wanted) => {
        if (!select || !wanted) return;
        select.value = wanted;
        if (select.value === wanted) return;
        Array.from(select.options || []).some((option) => {
          const label = option.getAttribute("data-label") || option.textContent.trim();
          if (label !== String(wanted).trim()) return false;
          select.value = option.value;
          return true;
        });
      };
      const purchasePaymentCurrency = (row) => String(row?.querySelector("[data-purchase-payment-currency]")?.value || currency()).toUpperCase();
      const purchasePaymentAmount = (row) => purchaseEntryNumber(row?.querySelector("[data-purchase-payment-amount]")?.value || "");
      const collectPurchasePayments = () => paymentRows().map((row) => {
        const amountInputNode = row.querySelector("[data-purchase-payment-amount]");
        if (amountInputNode) formatPurchasePriceInput(amountInputNode, purchasePaymentCurrency(row));
        const amount = purchasePaymentAmount(row);
        if (!amount) return null;
        const account = row.querySelector("[data-purchase-payment-account]");
        const lineCurrency = purchasePaymentCurrency(row);
        return {
          account_id: account ? account.value : "",
          account: paymentLabel(account),
          currency: lineCurrency,
          type: paymentLabel(account),
          amount: String(amount)
        };
      }).filter(Boolean);
      const paymentTotalInCurrency = (items, targetCurrency) => {
        const target = String(targetCurrency || currency()).toUpperCase();
        return (Array.isArray(items) ? items : collectPurchasePayments()).reduce((sum, item) => {
          return sum + convertPurchaseCurrency(item.amount, item.currency || target, target, options);
        }, 0);
      };
      const parsePurchasePaymentLines = () => {
        if (!paymentLinesInput || !paymentLinesInput.value) return [];
        try {
          const parsed = JSON.parse(paymentLinesInput.value);
          if (!Array.isArray(parsed)) return [];
          return parsed.filter((item) => item && purchaseEntryNumber(item.amount));
        } catch (_) {
          return [];
        }
      };
      const currentPurchaseTotal = () => purchaseEntryNumber(amountInput?.value || "");
      const updatePurchasePaymentStatus = (items) => {
        const payments = Array.isArray(items) ? items : parsePurchasePaymentLines();
        const total = currentPurchaseTotal();
        const paid = paymentTotalInCurrency(payments, currency());
        if (paidInput) paidInput.value = paid ? purchaseEntryFormatCurrency(paid, currency()) : "0";
        if (statusInput) statusInput.value = paid ? paid >= total && total ? "paid" : "partial" : "new";
        return { total, paid };
      };
      const updatePurchasePaymentBreakdown = (items) => {
        const box = form.querySelector("[data-purchase-payment-breakdown]");
        if (!box) return;
        const payments = Array.isArray(items) ? items : parsePurchasePaymentLines();
        const totalNode = box.querySelector("[data-purchase-payment-breakdown-total]");
        const linesNode = box.querySelector("[data-purchase-payment-breakdown-lines]");
        const state = updatePurchasePaymentStatus(payments);
        if (totalNode) totalNode.textContent = purchaseEntryMoney(state.paid, currency());
        if (linesNode) {
          linesNode.innerHTML = "";
          payments.forEach((item, index) => {
            const amount = purchaseEntryNumber(item.amount);
            if (!amount) return;
            const row = document.createElement("div");
            row.className = "sales-payment-breakdown-row";
            const label = document.createElement("span");
            label.textContent = index === 0 ? "Оплата" : "";
            const value = document.createElement("strong");
            const itemCurrency = String(item.currency || currency()).toUpperCase();
            value.textContent = purchaseEntryMoney(amount, itemCurrency);
            const method = document.createElement("em");
            method.textContent = item.account || item.type || "";
            row.append(label, value, method);
            linesNode.append(row);
          });
        }
        box.hidden = !payments.length;
      };
      const updatePurchasePaymentSummary = () => {
        if (!paymentDialog) return;
        const paid = paymentTotalInCurrency(collectPurchasePayments(), currency());
        const total = currentPurchaseTotal();
        const rest = Math.max(0, total - paid);
        const overpaid = Math.max(0, paid - total);
        const dueNode = paymentDialog.querySelector("[data-purchase-payment-due]");
        const paidNode = paymentDialog.querySelector("[data-purchase-payment-paid]");
        const restNode = paymentDialog.querySelector("[data-purchase-payment-rest]");
        const overRow = paymentDialog.querySelector("[data-purchase-payment-over-row]");
        const overNode = paymentDialog.querySelector("[data-purchase-payment-over]");
        const submit = paymentDialog.querySelector("[data-purchase-payment-submit]");
        if (dueNode) dueNode.textContent = purchaseEntryMoney(total, currency());
        if (paidNode) paidNode.textContent = purchaseEntryMoney(paid, currency());
        if (restNode) restNode.textContent = purchaseEntryMoney(rest, currency());
        if (overNode) overNode.textContent = purchaseEntryMoney(overpaid, currency());
        if (overRow) overRow.hidden = overpaid <= 0;
        paymentDialog.querySelector("[data-purchase-payment-summary]")?.classList.toggle("is-overpaid", overpaid > 0);
        if (submit) {
          submit.disabled = paid <= 0 || overpaid > 0;
          submit.title = overpaid > 0 ? `Оплата больше суммы на ${purchaseEntryMoney(overpaid, currency())}` : "";
        }
      };
      const syncPurchasePaymentHidden = () => {
        const payments = collectPurchasePayments();
        const paid = paymentTotalInCurrency(payments, currency());
        if (paidInput) paidInput.value = paid ? purchaseEntryFormatCurrency(paid, currency()) : "0";
        if (paymentTypeInput) {
          const types = [];
          payments.forEach((item) => {
            if (item.type && !types.includes(item.type)) types.push(item.type);
          });
          paymentTypeInput.value = types.join(", ");
        }
        if (paymentLinesInput) paymentLinesInput.value = JSON.stringify(payments);
        updatePurchasePaymentBreakdown(payments);
      };
      const convertPurchasePaymentLineCurrency = (row, nextCurrency) => {
        if (!row) return;
        const input = row.querySelector("[data-purchase-payment-amount]");
        const target = String(nextCurrency || purchasePaymentCurrency(row)).toUpperCase();
        const previous = String(row.dataset.purchasePaymentCurrency || currency() || target).toUpperCase();
        const amount = purchaseEntryNumber(input?.value || "");
        if (input && amount) {
          input.value = purchaseEntryFormatCurrency(convertPurchaseCurrency(amount, previous, target, options), target);
        }
        row.dataset.purchasePaymentCurrency = target;
      };
      const wirePurchasePaymentLine = (row) => {
        if (!row || row.dataset.purchasePaymentReady === "1") return;
        row.dataset.purchasePaymentReady = "1";
        row.querySelectorAll("[data-purchase-payment-amount], [data-purchase-payment-account], [data-purchase-payment-currency]").forEach((input) => {
          input.addEventListener("input", () => {
            if (input.matches("[data-purchase-payment-amount]")) formatPurchasePriceInput(input, purchasePaymentCurrency(row));
            updatePurchasePaymentSummary();
          });
          input.addEventListener("change", () => {
            if (input.matches("[data-purchase-payment-currency]")) convertPurchasePaymentLineCurrency(row, input.value);
            if (input.matches("[data-purchase-payment-amount]")) formatPurchasePriceInput(input, purchasePaymentCurrency(row));
            updatePurchasePaymentSummary();
          });
        });
        row.querySelector("[data-purchase-payment-remove]")?.addEventListener("click", () => {
          if (paymentRows().length <= 1) {
            row.querySelectorAll("input").forEach((input) => {
              input.value = "";
            });
            setPaymentSelect(row.querySelector("[data-purchase-payment-currency]"), currency());
            row.dataset.purchasePaymentCurrency = currency();
          } else {
            row.remove();
          }
          updatePurchasePaymentSummary();
        });
      };
      const addPurchasePaymentLine = () => {
        if (!paymentDialog) return null;
        const wrap = paymentDialog.querySelector("[data-purchase-payment-lines-ui]");
        const source = paymentDialog.querySelector("[data-purchase-payment-line]");
        if (!wrap || !source) return null;
        const row = source.cloneNode(true);
        row.removeAttribute("data-purchase-payment-ready");
        row.querySelectorAll("input").forEach((input) => {
          input.value = "";
        });
        setPaymentSelect(row.querySelector("[data-purchase-payment-currency]"), currency());
        row.dataset.purchasePaymentCurrency = currency();
        wrap.append(row);
        wirePurchasePaymentLine(row);
        updatePurchasePaymentSummary();
        return row;
      };
      const openPurchasePaymentDialog = () => {
        if (!paymentDialog) return;
        paymentRows().forEach((row, index) => {
          if (index > 0) row.remove();
        });
        const first = paymentRows()[0] || addPurchasePaymentLine();
        const input = first?.querySelector("[data-purchase-payment-amount]");
        setPaymentSelect(first?.querySelector("[data-purchase-payment-currency]"), currency());
        if (first) first.dataset.purchasePaymentCurrency = currency();
        if (input && !purchaseEntryNumber(paidInput?.value || "")) input.value = purchaseEntryFormatCurrency(currentPurchaseTotal(), currency());
        updatePurchasePaymentSummary();
        if (typeof paymentDialog.showModal === "function") {
          try {
            paymentDialog.showModal();
          } catch (_) {
            paymentDialog.setAttribute("open", "");
          }
        } else {
          paymentDialog.setAttribute("open", "");
        }
        window.setTimeout(() => {
          input?.focus();
          input?.select();
        }, 0);
      };
      const closePurchasePaymentDialog = () => {
        if (!paymentDialog) return;
        if (typeof paymentDialog.close === "function") paymentDialog.close();
        paymentDialog.removeAttribute("open");
      };

      const renumber = () => {
        rows().forEach((row, index) => {
          const number = row.querySelector(".warehouse-purchase-entry-row-number");
          if (number) number.textContent = String(index + 1);
        });
      };

      const recalc = () => {
        let total = 0;
        let saleTotal = 0;
        rows().forEach((row) => {
          const value = rowTotal(row);
          const output = row.querySelector("[data-purchase-entry-line-total]");
          if (output) output.textContent = purchaseEntryMoney(value, currency());
          if (rowHasProduct(row)) {
            total += value;
            saleTotal += rowSaleTotal(row);
          }
        });
        if (amountInput) amountInput.value = String(Math.round(total));
        if (totalOutput) totalOutput.textContent = purchaseEntryMoney(total, currency());
        if (totalDisplayOutput) totalDisplayOutput.textContent = purchaseEntryMoney(total, currency());
        if (saleTotalOutput) saleTotalOutput.textContent = purchaseEntryMoney(saleTotal, saleCurrency());
        renumber();
        updatePurchasePaymentBreakdown();
        updatePurchasePaymentSummary();
      };

      const ensureBlankLine = () => {
        const currentRows = rows();
        const last = currentRows[currentRows.length - 1];
        if (!last || !rowHasProduct(last)) return;
        const clone = last.cloneNode(true);
        delete clone.dataset.purchaseEntryRowReady;
        clone.querySelectorAll("[data-warehouse-product-picker]").forEach((picker) => {
          delete picker.dataset.warehouseProductReady;
          delete picker.dataset.productId;
          picker.classList.remove("is-locked");
          const panel = picker.querySelector("[data-warehouse-product-panel]");
          if (panel) {
            panel.hidden = true;
            panel.innerHTML = "";
          }
          const edit = picker.querySelector("[data-warehouse-product-edit]");
          if (edit) edit.hidden = true;
        });
        clone.querySelectorAll("input").forEach((input) => {
          input.readOnly = false;
          input.removeAttribute("aria-readonly");
          input.value = "";
        });
        const output = clone.querySelector("[data-purchase-entry-line-total]");
        if (output) output.textContent = purchaseEntryMoney(0, currency());
        body.append(clone);
        wireRow(clone);
        recalc();
      };

      const convertVisiblePrices = (nextCurrency) => {
        const previousCurrency = String(form.dataset.purchaseEntryCurrency || nextCurrency || currency()).toUpperCase();
        const targetCurrency = String(nextCurrency || currency()).toUpperCase();
        if (previousCurrency === targetCurrency) {
          recalc();
          return;
        }
        rows().forEach((row) => {
          row.querySelectorAll('input[name="line_price"], input[name="line_sale_price"]').forEach((input) => {
            const value = purchaseEntryNumber(input.value);
            input.value = value
              ? purchaseEntryFormatCurrency(convertPurchaseCurrency(value, previousCurrency, targetCurrency, options), targetCurrency)
              : "";
          });
        });
        form.dataset.purchaseEntryCurrency = targetCurrency;
        recalc();
      };

      const wireRow = (row) => {
        if (row.dataset.purchaseEntryRowReady === "1") return;
        row.dataset.purchaseEntryRowReady = "1";
        wireProductPicker(form, row);
        row.querySelectorAll("input").forEach((input) => {
          input.addEventListener("focus", () => {
            if (input.name === "line_quantity" || input.name === "line_price" || input.name === "line_sale_price") {
              window.setTimeout(() => input.select(), 0);
            }
          });
          input.addEventListener("input", () => {
            if (input.name === "line_price" || input.name === "line_sale_price") {
              formatPurchasePriceInput(input, input.name === "line_sale_price" ? saleCurrency() : currency());
            } else if (input.name === "line_quantity") {
              const cursorAtEnd = input.selectionStart === input.value.length;
              input.value = input.value.replace(/[^\d\s.,-]/g, "");
              if (cursorAtEnd) input.setSelectionRange(input.value.length, input.value.length);
            }
            recalc();
            if (input.name === "line_product") ensureBlankLine();
          });
          input.addEventListener("blur", () => {
            if (input.name === "line_quantity" || input.name === "line_price" || input.name === "line_sale_price") {
              const value = purchaseEntryNumber(input.value);
              input.value = value
                ? input.name === "line_quantity"
                  ? purchaseEntryFormat(value)
                  : purchaseEntryFormatCurrency(value, input.name === "line_sale_price" ? saleCurrency() : currency())
                : "";
              recalc();
            }
          });
        });
        row.querySelector("[data-purchase-entry-remove]")?.addEventListener("click", () => {
          if (rows().length > 1) {
            row.remove();
          } else {
            row.querySelectorAll("input").forEach((input) => {
              input.value = "";
            });
          }
          recalc();
        });
      };

      rows().forEach(wireRow);
      paymentRows().forEach(wirePurchasePaymentLine);
      form.querySelector("[data-purchase-payment-open]")?.addEventListener("click", openPurchasePaymentDialog);
      paymentDialog?.querySelectorAll("[data-purchase-payment-close], [data-purchase-payment-cancel]").forEach((button) => {
        button.addEventListener("click", closePurchasePaymentDialog);
      });
      paymentDialog?.querySelector("[data-purchase-payment-add-line]")?.addEventListener("click", () => {
        const row = addPurchasePaymentLine();
        row?.querySelector("[data-purchase-payment-amount]")?.focus();
      });
      paymentDialog?.querySelector("[data-purchase-payment-form]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        updatePurchasePaymentSummary();
        const paid = paymentTotalInCurrency(collectPurchasePayments(), currency());
        const total = currentPurchaseTotal();
        if (paid <= 0 || paid > total) return;
        syncPurchasePaymentHidden();
        closePurchasePaymentDialog();
      });
      form.querySelector("[data-purchase-payment-clear]")?.addEventListener("click", () => {
        if (paidInput) paidInput.value = "0";
        if (paymentTypeInput) paymentTypeInput.value = "";
        if (paymentLinesInput) paymentLinesInput.value = "[]";
        paymentRows().forEach((row, index) => {
          if (index > 0) row.remove();
          else {
            row.querySelectorAll("input").forEach((input) => {
              input.value = "";
            });
            setPaymentSelect(row.querySelector("[data-purchase-payment-currency]"), currency());
            row.dataset.purchasePaymentCurrency = currency();
          }
        });
        updatePurchasePaymentBreakdown([]);
      });
      currencyInput?.addEventListener("change", () => convertVisiblePrices(currency()));
      form.querySelector("[data-purchase-price-type]")?.addEventListener("change", () => {
        const priceType = syncPurchasePriceTitle(form);
        rows().forEach((row) => {
          const product = productByRow(form, row);
          const input = row.querySelector('input[name="line_sale_price"]');
          if (!product || !input) return;
          const entry = productPriceEntryForType(product, priceType);
          const sourceCurrency = String(entry?.currency || priceType.currency || currency()).toUpperCase();
          const value = purchaseEntryNumber(entry?.price || "");
          input.value = value
            ? purchaseEntryFormatCurrency(convertPurchaseCurrency(value, sourceCurrency, currency(), options), currency())
            : "";
        });
      });
      form.addEventListener("purchase-entry-product-selected", (event) => {
        recalc();
        ensureBlankLine();
        const row = event.target?.closest?.("[data-purchase-entry-row]");
        row?.querySelector('input[name="line_quantity"]')?.focus();
      });
      form.addEventListener("submit", () => {
        syncPurchasePriceTitle(form);
        updatePurchasePaymentStatus();
        rows().forEach((row) => {
          row.querySelectorAll('input[name="line_quantity"], input[name="line_price"], input[name="line_sale_price"]').forEach((input) => {
            const value = purchaseEntryNumber(input.value);
            input.value = value ? String(value) : "";
          });
        });
        recalc();
      });
      recalc();
    });
  }

  function readPurchase(id) {
    const node = document.getElementById(`warehouse-purchase-data-${id}`);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (_err) {
      return null;
    }
  }

  function setText(root, selector, value) {
    const node = root.querySelector(selector);
    if (node) node.textContent = value == null || value === "" ? "-" : String(value);
  }

  function activatePurchaseDetailTab(panel, tabName) {
    const activeTab = tabName || "items";
    panel.querySelectorAll("[data-purchase-detail-tab]").forEach((button) => {
      const active = button.getAttribute("data-purchase-detail-tab") === activeTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    panel.querySelectorAll("[data-purchase-detail-pane]").forEach((pane) => {
      const active = pane.getAttribute("data-purchase-detail-pane") === activeTab;
      pane.hidden = !active;
      pane.classList.toggle("active", active);
    });
  }

  function updatePurchasePaymentButton(panel, purchase) {
    const form = panel.querySelector("[data-purchase-payment-form]");
    const button = panel.querySelector("[data-purchase-payment-pay]");
    if (!form || !button) return;
    const purchaseId = String(purchase.id || panel.dataset.purchaseId || "").trim();
    const template = String(form.dataset.purchasePaymentUrlTemplate || "");
    const debt = purchaseEntryNumber(purchase.debt_amount);
    if (purchaseId && template) {
      form.action = template.replace("__purchase_id__", encodeURIComponent(purchaseId));
    }
    const canPay = Boolean(purchaseId && debt > 0);
    form.hidden = !canPay;
    button.disabled = !canPay;
    button.textContent = canPay ? `Оплатить ${moneyWithCurrency(debt, purchase.currency || "UZS")}` : "Оплачено";
  }

  function renderDetail(panel, purchase) {
    const currency = purchase.currency || "UZS";
    const linesRoot = panel.querySelector("[data-purchase-detail-lines]");
    const lines = Array.isArray(purchase.lines) ? purchase.lines : [];
    setText(panel, "[data-purchase-detail-title]", `Закупка: ${purchase.number || "-"}`);
    setText(panel, "[data-purchase-detail-date]", purchase.date ? `${purchase.date} · ${purchase.status_label || "Новый"}` : purchase.status_label || "Новый");
    setText(panel, "[data-purchase-detail-supplier]", purchase.supplier || "Поставщик не указан");
    setText(panel, "[data-purchase-detail-warehouse]", purchase.warehouse || "Основной склад");
    setText(panel, "[data-purchase-detail-status]", purchase.status_label || "Новый");
    setText(panel, "[data-purchase-detail-paid]", moneyWithCurrency(purchase.paid_amount, currency));
    setText(panel, "[data-purchase-detail-debt]", moneyWithCurrency(purchase.debt_amount, currency));
    setText(panel, "[data-purchase-detail-total]", moneyWithCurrency(purchase.amount, currency));
    setText(panel, "[data-purchase-payment-total]", moneyWithCurrency(purchase.amount, currency));
    setText(panel, "[data-purchase-payment-paid]", moneyWithCurrency(purchase.paid_amount, currency));
    setText(panel, "[data-purchase-payment-debt]", moneyWithCurrency(purchase.debt_amount, currency));
    setText(panel, "[data-purchase-payment-status]", purchase.status_label || "Новый");
    setText(panel, "[data-purchase-payment-type]", purchase.payment_type || "Не указано");
    setText(panel, "[data-purchase-payment-date]", purchase.date || "-");
    setText(panel, "[data-purchase-payment-supplier]", purchase.supplier || "Поставщик не указан");
    setText(panel, "[data-purchase-detail-note]", purchase.note || "Комментарий не указан");
    const paymentPane = panel.querySelector('[data-purchase-detail-pane="payment"]');
    if (paymentPane) paymentPane.dataset.paymentState = purchaseEntryNumber(purchase.debt_amount) > 0 ? "debt" : "paid";
    updatePurchasePaymentButton(panel, purchase);
    setText(panel, "[data-purchase-detail-sale-price-title]", purchase.price_type_name || "Продажная цена");
    if (!linesRoot) return;
    linesRoot.replaceChildren();
    const appendCell = (row, value) => {
      const cell = document.createElement("td");
      cell.textContent = value == null || value === "" ? "-" : String(value);
      row.append(cell);
      return cell;
    };
    if (!lines.length) {
      const row = document.createElement("tr");
      appendCell(row, "1");
      appendCell(row, purchase.number || "Закупка");
      appendCell(row, "-");
      appendCell(row, "-");
      appendCell(row, "-");
      appendCell(row, moneyWithCurrency(purchase.amount, currency));
      linesRoot.append(row);
      return;
    }
    lines.forEach((line, index) => {
      const row = document.createElement("tr");
      const qty = String(line.quantity || "-");
      const price = line.price ? moneyWithCurrency(line.price, currency) : "-";
      const salePrice = line.sale_price ? moneyWithCurrency(line.sale_price, purchase.price_type_currency || currency) : "-";
      const total = line.total ? moneyWithCurrency(line.total, currency) : "-";
      appendCell(row, index + 1);
      appendCell(row, line.product || "Товар");
      appendCell(row, qty);
      appendCell(row, price);
      appendCell(row, salePrice);
      appendCell(row, total);
      linesRoot.append(row);
    });
  }

  function openDetail(root, purchaseId) {
    const panel = root.querySelector("[data-warehouse-purchase-detail]");
    const backdrop = root.querySelector(".warehouse-purchase-detail-backdrop");
    const purchase = readPurchase(purchaseId);
    if (!panel || !purchase) return;
    renderDetail(panel, purchase);
    activatePurchaseDetailTab(panel, "items");
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => {
      panel.classList.add("is-open");
      if (backdrop) backdrop.classList.add("is-open");
    });
  }

  function closeDetail(root) {
    const panel = root.querySelector("[data-warehouse-purchase-detail]");
    const backdrop = root.querySelector(".warehouse-purchase-detail-backdrop");
    if (!panel) return;
    panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    window.setTimeout(() => {
      panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 180);
  }

  function init(root = document) {
    initPurchaseEntry(root);
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
    root.querySelectorAll("[data-warehouse-purchase-open]").forEach((trigger) => {
      if (trigger.dataset.warehousePurchaseOpenReady === "1") return;
      trigger.dataset.warehousePurchaseOpenReady = "1";
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        openDetail(root, trigger.dataset.purchaseId || "");
      });
    });
    root.querySelectorAll("[data-warehouse-purchase-close]").forEach((trigger) => {
      if (trigger.dataset.warehousePurchaseCloseReady === "1") return;
      trigger.dataset.warehousePurchaseCloseReady = "1";
      trigger.addEventListener("click", () => closeDetail(root));
    });
    root.querySelectorAll("[data-warehouse-purchase-detail]").forEach((panel) => {
      if (panel.dataset.purchaseDetailTabsReady === "1") return;
      panel.dataset.purchaseDetailTabsReady = "1";
      panel.querySelectorAll("[data-purchase-detail-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          activatePurchaseDetailTab(panel, button.getAttribute("data-purchase-detail-tab"));
        });
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDetail(root);
    });
    if (document.body.dataset.warehouseProductPickerGlobalReady !== "1") {
      document.body.dataset.warehouseProductPickerGlobalReady = "1";
      document.addEventListener("mousedown", (event) => {
        document.querySelectorAll("[data-warehouse-product-picker]").forEach((picker) => {
          if (!picker.contains(event.target)) closeProductPanel(picker);
        });
        document.querySelectorAll("[data-warehouse-supplier-picker]").forEach((picker) => {
          if (!picker.contains(event.target)) closeSupplierPanel(picker);
        });
      });
      window.addEventListener("resize", () => {
        document.querySelectorAll("[data-warehouse-product-picker]").forEach(positionProductPanel);
        document.querySelectorAll("[data-warehouse-supplier-picker]").forEach(positionSupplierPanel);
      });
      window.addEventListener(
        "scroll",
        () => {
          document.querySelectorAll("[data-warehouse-product-picker]").forEach(positionProductPanel);
          document.querySelectorAll("[data-warehouse-supplier-picker]").forEach(positionSupplierPanel);
        },
        true
      );
    }
    highlight(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
