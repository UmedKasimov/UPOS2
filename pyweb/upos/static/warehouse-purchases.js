(function () {
  let activeSupplierPicker = null;
  let activeProductPicker = null;
  let activeProductEntryForm = null;
  let activeExpenseTypeInput = null;

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

  function quantityText(value) {
    const quantity = purchaseEntryNumber(value);
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    }).format(quantity);
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

  function writePurchaseOptions(options) {
    const node = document.getElementById("warehouse-purchase-options");
    if (node) node.textContent = JSON.stringify(options || {});
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

  function closeExpenseTypePanel(picker) {
    const panel = picker?.querySelector("[data-purchase-expense-type-panel]");
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

  function positionExpenseTypePanel(picker) {
    const input = picker?.querySelector("[data-purchase-expense-type-input]");
    const panel = picker?.querySelector("[data-purchase-expense-type-panel]");
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

  function supplierByName(name) {
    const cleanName = normalize(name);
    if (!cleanName) return null;
    const options = readPurchaseOptions();
    const supplierRows = Array.isArray(options.supplier_rows) ? options.supplier_rows : [];
    const found = supplierRows.find((supplier) => normalize(supplier?.name) === cleanName);
    if (found) return found;
    const fallbackName = (Array.isArray(options.suppliers) ? options.suppliers : [])
      .find((supplierName) => normalize(supplierName) === cleanName);
    return fallbackName ? { name: fallbackName, balance: "Нет долга", balance_kind: "zero" } : null;
  }

  function updatePurchaseSupplierBalance(picker, supplier) {
    if (!picker || picker.matches("[data-adjustment-supplier-picker]")) return;
    const entry = picker.closest(".warehouse-purchase-entry");
    const balanceBox = entry?.querySelector("[data-warehouse-purchase-supplier-balance]");
    if (!balanceBox) return;
    const input = picker.querySelector("[data-warehouse-supplier-input]");
    const supplierName = String(supplier?.name || input?.value || "").trim();
    const knownSupplier = supplier && typeof supplier === "object" ? supplier : supplierByName(supplierName);
    const nameNode = balanceBox.querySelector("[data-warehouse-purchase-supplier-balance-name]");
    const valueNode = balanceBox.querySelector("[data-warehouse-purchase-supplier-balance-value]");
    const balanceKind = String(knownSupplier?.balance_kind || (supplierName ? "zero" : "empty")).trim() || "zero";
    balanceBox.dataset.balanceKind = balanceKind;
    if (nameNode) nameNode.textContent = supplierName || "Поставщик не выбран";
    if (valueNode) {
      const balanceText = supplierName
        ? String(knownSupplier?.balance || "Нет долга").trim() || "Нет долга"
        : "-";
      valueNode.textContent = `Баланс: ${balanceText}`;
    }
  }

  function syncPurchaseSupplierBalance(form) {
    const picker = form?.querySelector("[data-warehouse-supplier-picker]");
    if (!picker) return;
    const input = picker.querySelector("[data-warehouse-supplier-input]");
    updatePurchaseSupplierBalance(picker, supplierByName(input?.value || ""));
  }

  function commitSupplier(picker, value) {
    const input = picker?.querySelector("[data-warehouse-supplier-input]");
    if (!input) return;
    const supplier = value && typeof value === "object" ? value : { name: value };
    const supplierName = String(supplier.name || "").trim();
    input.value = supplierName;
    if (picker.matches("[data-adjustment-supplier-picker]")) {
      const form = picker.closest("[data-warehouse-adjustment-entry]");
      const supplierIdInput = form?.querySelector("[data-adjustment-supplier]");
      const supplierNameInput = form?.querySelector("[data-adjustment-supplier-name]");
      const supplierBalance = form?.querySelector("[data-adjustment-supplier-balance]");
      if (supplierIdInput) supplierIdInput.value = String(supplier.id || "").trim();
      if (supplierNameInput) supplierNameInput.value = supplierName;
      if (supplierBalance) {
        supplierBalance.textContent = String(supplier.balance || "Нет долга").trim() || "Нет долга";
        supplierBalance.classList.remove("is-debt", "is-advance", "is-mixed", "is-zero");
        supplierBalance.classList.add(`is-${String(supplier.balance_kind || "zero")}`);
      }
      supplierIdInput?.dispatchEvent(new Event("change", { bubbles: true }));
    }
    updatePurchaseSupplierBalance(picker, supplier);
    setSupplierLocked(picker, Boolean(supplierName));
  }

  function setSupplierDialogStatus(form, message, variant) {
    const status = form?.querySelector("[data-warehouse-supplier-status]");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.variant = variant || "";
  }

  function setProductDialogStatus(form, message, variant) {
    const status = form?.querySelector("[data-warehouse-product-status]");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.variant = variant || "";
  }

  function upsertProductOption(product) {
    if (!product || !product.name) return;
    const options = readPurchaseOptions();
    const products = Array.isArray(options.product_rows) ? options.product_rows : [];
    const productId = String(product.id || "").trim();
    const productName = normalize(product.name);
    const index = products.findIndex((item) => {
      return (productId && String(item.id || "").trim() === productId) || normalize(item.name) === productName;
    });
    if (index >= 0) {
      products[index] = product;
    } else {
      products.push(product);
    }
    products.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
    options.product_rows = products;
    options.products = products.map((item) => item.name).filter(Boolean);
    writePurchaseOptions(options);
  }

  function upsertSupplierOption(value) {
    const supplier = value && typeof value === "object" ? value : { name: value };
    const cleanName = String(supplier.name || "").trim();
    if (!cleanName) return;
    const options = readPurchaseOptions();
    const suppliers = Array.isArray(options.suppliers) ? options.suppliers : [];
    if (!suppliers.some((item) => normalize(item) === normalize(cleanName))) {
      suppliers.push(cleanName);
      suppliers.sort((a, b) => String(a || "").localeCompare(String(b || ""), "ru"));
    }
    const supplierRows = Array.isArray(options.supplier_rows) ? options.supplier_rows : [];
    const normalizedSupplier = {
      ...supplier,
      id: String(supplier.id || "").trim(),
      name: cleanName,
      balance: String(supplier.balance || "Нет долга").trim() || "Нет долга",
      balance_kind: String(supplier.balance_kind || "zero").trim() || "zero",
    };
    const supplierIndex = supplierRows.findIndex((item) => {
      return (normalizedSupplier.id && String(item.id || "").trim() === normalizedSupplier.id)
        || normalize(item.name) === normalize(cleanName);
    });
    if (supplierIndex >= 0) supplierRows[supplierIndex] = { ...supplierRows[supplierIndex], ...normalizedSupplier };
    else supplierRows.push(normalizedSupplier);
    supplierRows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
    options.suppliers = suppliers;
    options.supplier_rows = supplierRows;
    writePurchaseOptions(options);
  }

  function writeExpenseTypes(items) {
    const options = readPurchaseOptions();
    options.expense_types = Array.isArray(items) ? items : [];
    writePurchaseOptions(options);
    document.querySelectorAll('select[name="extra_expense_name"]').forEach((select) => {
      const currentValue = String(select.value || "").trim();
      const selectOptions = [new Option("Выберите вид расхода", "")];
      options.expense_types.forEach((item) => {
        const option = document.createElement("option");
        option.value = String(item.name || "");
        option.textContent = String(item.name || "");
        selectOptions.push(option);
      });
      if (currentValue && !options.expense_types.some((item) => String(item.name || "") === currentValue)) {
        selectOptions.push(new Option(currentValue, currentValue));
      }
      select.replaceChildren(...selectOptions);
      select.value = currentValue;
      syncExpenseTypePicker(select);
      const picker = select.closest(".warehouse-purchase-expense-type-field")?.querySelector("[data-purchase-expense-type-picker]");
      if (picker && !picker.querySelector("[data-purchase-expense-type-panel]")?.hidden) {
        renderExpenseTypePicker(picker, picker.querySelector("[data-purchase-expense-type-input]")?.value || "");
      }
    });
  }

  function expenseTypeOptionRows(select) {
    return Array.from(select?.options || []).map((option) => ({
      value: String(option.value || ""),
      label: String(option.textContent || option.value || "").trim(),
    })).filter((item, index, rows) => {
      if (!item.value) return index === 0;
      return rows.findIndex((candidate) => candidate.value === item.value) === index;
    });
  }

  function expenseTypeSelectedLabel(select) {
    const selected = select?.selectedOptions?.[0];
    return String(selected?.textContent || select?.value || "").trim();
  }

  function syncExpenseTypePicker(select) {
    const picker = select?.closest(".warehouse-purchase-expense-type-field")?.querySelector("[data-purchase-expense-type-picker]");
    const input = picker?.querySelector("[data-purchase-expense-type-input]");
    if (!input) return;
    input.value = select?.value ? expenseTypeSelectedLabel(select) : "";
  }

  function setExpenseTypeValue(select, value, label) {
    if (!select) return;
    const cleanValue = String(value || "").trim();
    const cleanLabel = String(label || cleanValue).trim();
    if (cleanValue && !Array.from(select.options || []).some((option) => String(option.value || "") === cleanValue)) {
      select.add(new Option(cleanLabel, cleanValue));
    }
    select.value = cleanValue;
    syncExpenseTypePicker(select);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderExpenseTypePicker(picker, query) {
    const select = picker?.querySelector('select[name="extra_expense_name"]');
    const panel = picker?.querySelector("[data-purchase-expense-type-panel]");
    if (!select || !panel) return;
    const q = normalize(query);
    const rows = expenseTypeOptionRows(select)
      .filter((item) => !q || normalize(item.label).includes(q))
      .slice(0, 100);
    panel.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "sales-combo-empty";
      empty.textContent = "Ничего не найдено";
      panel.append(empty);
    } else {
      rows.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sales-combo-option";
        button.dataset.expenseTypeValue = item.value;
        button.dataset.expenseTypeLabel = item.label;
        button.innerHTML = `<span class="sales-combo-main">${highlightText(item.label, query)}</span>`;
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          setExpenseTypeValue(select, item.value, item.label);
          closeExpenseTypePanel(picker);
        });
        panel.append(button);
      });
    }
    panel.hidden = false;
    positionExpenseTypePanel(picker);
  }

  function enhanceExpenseTypePicker(row) {
    const field = row?.querySelector(".warehouse-purchase-expense-type-field");
    const select = field?.querySelector('select[name="extra_expense_name"]');
    if (!field || !select) return null;
    field.querySelectorAll("[data-purchase-expense-type-picker]").forEach((node) => node.remove());
    select.hidden = true;
    select.dataset.expenseTypeHidden = "1";
    select.tabIndex = -1;
    const picker = document.createElement("label");
    picker.className = "sales-combobox warehouse-expense-type-picker";
    picker.setAttribute("data-purchase-expense-type-picker", "");
    picker.append(select);
    picker.insertAdjacentHTML("beforeend", (
      '<div class="sales-lock-field">' +
      '<input type="text" autocomplete="off" placeholder="Выберите вид расхода" data-purchase-expense-type-input />' +
      '<button type="button" class="sales-combo-edit" data-purchase-expense-type-toggle aria-label="Открыть список расходов" title="Открыть список">⌄</button>' +
      "</div>" +
      '<div class="sales-combo-panel" data-purchase-expense-type-panel hidden></div>'
    ));
    field.insertBefore(picker, field.querySelector("[data-purchase-expense-type-open], [data-adjustment-expense-type-open]") || null);
    const input = picker.querySelector("[data-purchase-expense-type-input]");
    const toggle = picker.querySelector("[data-purchase-expense-type-toggle]");
    syncExpenseTypePicker(select);
    input?.addEventListener("focus", () => renderExpenseTypePicker(picker, input.value));
    input?.addEventListener("input", () => {
      select.value = "";
      renderExpenseTypePicker(picker, input.value);
    });
    input?.addEventListener("keydown", (event) => {
      const first = picker.querySelector("[data-purchase-expense-type-panel] .sales-combo-option");
      if (event.key === "Escape") {
        closeExpenseTypePanel(picker);
        syncExpenseTypePicker(select);
      }
      if (event.key === "Enter" && first) {
        event.preventDefault();
        first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      }
    });
    input?.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!picker.querySelector("[data-purchase-expense-type-panel]")?.hidden) return;
        syncExpenseTypePicker(select);
      }, 120);
    });
    toggle?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      input?.focus();
      renderExpenseTypePicker(picker, input?.value || "");
    });
    return picker;
  }

  function closeExpenseTypeDialog(entryForm) {
    const dialog = entryForm?.parentElement?.querySelector("[data-purchase-expense-type-dialog]") || document.querySelector("[data-purchase-expense-type-dialog]");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
    activeExpenseTypeInput = null;
  }

  function renderExpenseTypeList(entryForm) {
    const dialog = entryForm?.parentElement?.querySelector("[data-purchase-expense-type-dialog]") || document.querySelector("[data-purchase-expense-type-dialog]");
    const list = dialog?.querySelector("[data-purchase-expense-type-list]");
    if (!list) return;
    const items = readPurchaseOptions().expense_types || [];
    list.innerHTML = items.length
      ? items.map((item) => (
        `<div class="warehouse-expense-type-item">` +
        `<button type="button" class="warehouse-expense-type-select" data-expense-type-id="${escapeHtml(item.id || "")}">${escapeHtml(item.name || "")}</button>` +
        (String(item.source || "") === "finance"
          ? `<span class="warehouse-expense-type-source" title="Категория из финансов">Ф</span>`
          : `<button type="button" class="sales-line-remove" data-expense-type-delete="${escapeHtml(item.id || "")}" aria-label="Удалить ${escapeHtml(item.name || "")}" title="Удалить">×</button>`) +
        `</div>`
      )).join("")
      : '<p class="warehouse-expense-type-empty">Сохранённых видов пока нет.</p>';
    list.querySelectorAll("[data-expense-type-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = items.find((candidate) => String(candidate.id || "") === button.dataset.expenseTypeId);
        if (activeExpenseTypeInput && item) {
          setExpenseTypeValue(activeExpenseTypeInput, item.name || "", item.name || "");
        }
        closeExpenseTypeDialog(entryForm);
      });
    });
    list.querySelectorAll("[data-expense-type-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const form = dialog.querySelector("[data-purchase-expense-type-form]");
        const data = new FormData();
        data.set("csrf_token", form.querySelector('[name="csrf_token"]')?.value || "");
        data.set("expense_type_id", button.dataset.expenseTypeDelete || "");
        button.disabled = true;
        fetch(entryForm.getAttribute("data-purchase-expense-type-delete-url") || "/warehouse/purchase-expense-types/delete", {
          method: "POST",
          body: data,
          headers: { "Accept": "application/json" },
        })
          .then((response) => response.json().catch(() => ({})).then((body) => {
            if (!response.ok || !Array.isArray(body.expense_types)) throw new Error(body.error || "Не удалось удалить");
            return body.expense_types;
          }))
          .then((expenseTypes) => {
            writeExpenseTypes(expenseTypes);
            renderExpenseTypeList(entryForm);
          })
          .catch((error) => {
            const status = form.querySelector("[data-purchase-expense-type-status]");
            if (status) {
              status.textContent = error.message || "Не удалось удалить";
              status.dataset.variant = "err";
            }
            button.disabled = false;
          });
      });
    });
  }

  function openExpenseTypeDialog(entryForm, input) {
    const dialog = entryForm?.parentElement?.querySelector("[data-purchase-expense-type-dialog]") || document.querySelector("[data-purchase-expense-type-dialog]");
    const form = dialog?.querySelector("[data-purchase-expense-type-form]");
    if (!dialog || !form) return;
    activeExpenseTypeInput = input || null;
    form.reset();
    const nameInput = form.querySelector("[data-purchase-expense-type-name]");
    const typedExpenseType = input?.matches?.("select")
      ? input.closest(".warehouse-purchase-expense-type-field")?.querySelector("[data-purchase-expense-type-input]")?.value
      : input?.value;
    if (nameInput) nameInput.value = String(typedExpenseType || expenseTypeSelectedLabel(input) || "").trim();
    const status = form.querySelector("[data-purchase-expense-type-status]");
    if (status) {
      status.textContent = "";
      status.dataset.variant = "";
    }
    renderExpenseTypeList(entryForm);
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
      nameInput?.focus();
      nameInput?.select();
    }, 0);
  }

  function wireExpenseTypeDialog(entryForm) {
    const dialog = entryForm?.parentElement?.querySelector("[data-purchase-expense-type-dialog]") || document.querySelector("[data-purchase-expense-type-dialog]");
    const form = dialog?.querySelector("[data-purchase-expense-type-form]");
    if (!dialog || !form || dialog.dataset.purchaseExpenseTypeReady === "1") return;
    dialog.dataset.purchaseExpenseTypeReady = "1";
    dialog.querySelectorAll("[data-purchase-expense-type-close]").forEach((button) => {
      button.addEventListener("click", () => closeExpenseTypeDialog(entryForm));
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const submit = form.querySelector("[data-purchase-expense-type-submit]");
      const status = form.querySelector("[data-purchase-expense-type-status]");
      if (submit) submit.disabled = true;
      if (status) {
        status.textContent = "Сохраняю...";
        status.dataset.variant = "";
      }
      fetch(entryForm.getAttribute("data-purchase-expense-type-save-url") || "/warehouse/purchase-expense-types/save", {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" },
      })
        .then((response) => response.json().catch(() => ({})).then((body) => {
          if (!response.ok || !body.expense_type || !Array.isArray(body.expense_types)) {
            throw new Error(body.error || "Не удалось сохранить");
          }
          return body;
        }))
        .then((body) => {
          writeExpenseTypes(body.expense_types);
          if (activeExpenseTypeInput) {
            setExpenseTypeValue(activeExpenseTypeInput, body.expense_type.name || "", body.expense_type.name || "");
          }
          closeExpenseTypeDialog(entryForm);
        })
        .catch((error) => {
          if (status) {
            status.textContent = error.message || "Не удалось сохранить";
            status.dataset.variant = "err";
          }
        })
        .finally(() => {
          if (submit) submit.disabled = false;
        });
    });
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
    if (dialog.parentElement !== document.body) document.body.append(dialog);
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
          upsertSupplierOption(supplier);
          const picker = activeSupplierPicker && document.contains(activeSupplierPicker)
            ? activeSupplierPicker
            : entryForm.querySelector("[data-warehouse-supplier-picker]");
          commitSupplier(picker, supplier);
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

  function closeProductDialog(entryForm) {
    const dialog = entryForm?.parentElement?.querySelector("[data-warehouse-product-dialog]") || document.querySelector("[data-warehouse-product-dialog]");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
    activeProductPicker = null;
    activeProductEntryForm = null;
  }

  function openProductDialog(entryForm, picker, query) {
    const dialog = entryForm?.parentElement?.querySelector("[data-warehouse-product-dialog]") || document.querySelector("[data-warehouse-product-dialog]");
    const form = dialog?.querySelector("[data-warehouse-product-form]");
    if (!dialog || !form) return;
    if (dialog.parentElement !== document.body) document.body.append(dialog);
    activeProductPicker = picker || null;
    activeProductEntryForm = entryForm || null;
    closeProductPanel(picker);
    form.reset();
    const nameInput = form.querySelector("[data-warehouse-product-name]");
    const unitInput = form.querySelector("[data-warehouse-product-unit]");
    const currencyInput = form.querySelector("[data-warehouse-product-currency]");
    const warehouseInput = form.querySelector("[data-warehouse-product-warehouse]");
    const skuInput = form.querySelector("[data-warehouse-product-sku]");
    if (nameInput) nameInput.value = String(query || "").trim();
    if (unitInput) unitInput.value = "Штука";
    if (skuInput) skuInput.value = String(readPurchaseOptions().next_product_sku || skuInput.defaultValue || "21000").trim();
    if (currencyInput) {
      currencyInput.value = entryForm.querySelector("[data-purchase-entry-currency], [data-adjustment-currency]")?.value || "UZS";
    }
    if (warehouseInput) {
      warehouseInput.value = entryForm.querySelector('[name="warehouse"]')?.value || warehouseInput.defaultValue || "Основной склад";
    }
    resetWarehouseProductPreview(form);
    form.querySelectorAll("[data-warehouse-product-dictionary-combo]").forEach((combo) => {
      syncWarehouseProductDictionary(combo, "");
      closeWarehouseProductDictionary(combo);
    });
    setProductDialogStatus(form, "", "");
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

  function warehouseProductDictionaryValues(form, type) {
    const options = readPurchaseOptions();
    const source = type === "brand" ? options.product_brands : options.product_categories;
    const select = form?.querySelector(`[data-warehouse-product-dictionary-select="${type}"]`);
    const values = Array.isArray(source) ? source : [];
    return Array.from(new Set([
      ...values,
      ...Array.from(select?.options || []).map((option) => option.value),
    ].map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
  }

  function closeWarehouseProductDictionary(combo) {
    const panel = combo?.querySelector("[data-warehouse-product-dictionary-combo-panel]");
    if (panel) panel.hidden = true;
    combo?.classList.remove("is-open");
  }

  function syncWarehouseProductDictionary(combo, value) {
    const form = combo?.closest("[data-warehouse-product-form]");
    const type = combo?.dataset.warehouseProductDictionaryCombo || "";
    const clean = String(value || "").trim();
    const input = combo?.querySelector("[data-warehouse-product-dictionary-combo-input]");
    const hidden = form?.querySelector(`[data-warehouse-product-dictionary-value="${type}"]`);
    const select = form?.querySelector(`[data-warehouse-product-dictionary-select="${type}"]`);
    if (input) input.value = clean;
    if (hidden) hidden.value = clean;
    if (select) {
      if (clean && !Array.from(select.options).some((option) => option.value === clean)) {
        select.appendChild(new Option(clean, clean));
      }
      select.value = clean;
    }
  }

  function renderWarehouseProductDictionary(combo, query) {
    const form = combo?.closest("[data-warehouse-product-form]");
    const type = combo?.dataset.warehouseProductDictionaryCombo || "";
    const panel = combo?.querySelector("[data-warehouse-product-dictionary-combo-panel]");
    if (!form || !combo || !panel || !type) return;
    const needle = normalize(query);
    const rows = warehouseProductDictionaryValues(form, type).filter((value) => !needle || normalize(value).includes(needle));
    panel.innerHTML = rows.length
      ? rows.map((value) => `<button type="button" class="product-dictionary-combo-option" data-value="${escapeHtml(value)}"><span>${escapeHtml(value)}</span></button>`).join("")
      : '<div class="product-dictionary-combo-empty">Ничего не найдено</div>';
    panel.hidden = false;
    combo.classList.add("is-open");
  }

  function resetWarehouseProductPreview(form) {
    const preview = form?.querySelector("[data-warehouse-product-photo]");
    const urlField = form?.querySelector("[data-warehouse-product-photo-url]");
    if (urlField) urlField.value = "";
    if (preview) preview.innerHTML = "<span></span>";
  }

  function showWarehouseProductPreview(form, src) {
    const preview = form?.querySelector("[data-warehouse-product-photo]");
    if (!preview) return;
    const clean = String(src || "").trim();
    preview.innerHTML = clean ? `<img src="${escapeHtml(clean)}" alt="" />` : "<span></span>";
  }

  function wireWarehouseProductQuickForm(form) {
    if (!form || form.dataset.warehouseProductQuickReady === "1") return;
    form.dataset.warehouseProductQuickReady = "1";
    form.querySelectorAll("[data-warehouse-product-dictionary-combo]").forEach((combo) => {
      const input = combo.querySelector("[data-warehouse-product-dictionary-combo-input]");
      const panel = combo.querySelector("[data-warehouse-product-dictionary-combo-panel]");
      if (!input || !panel) return;
      input.addEventListener("focus", () => renderWarehouseProductDictionary(combo, input.value));
      input.addEventListener("input", () => {
        syncWarehouseProductDictionary(combo, input.value);
        renderWarehouseProductDictionary(combo, input.value);
      });
      input.addEventListener("keydown", (event) => {
        const options = Array.from(panel.querySelectorAll(".product-dictionary-combo-option"));
        if (event.key === "Escape") closeWarehouseProductDictionary(combo);
        if (event.key === "Enter" && !panel.hidden && options.length) {
          event.preventDefault();
          syncWarehouseProductDictionary(combo, options[0].dataset.value || "");
          closeWarehouseProductDictionary(combo);
        }
      });
      panel.addEventListener("mousedown", (event) => {
        const button = event.target.closest(".product-dictionary-combo-option");
        if (!button) return;
        event.preventDefault();
        syncWarehouseProductDictionary(combo, button.dataset.value || "");
        closeWarehouseProductDictionary(combo);
        input.focus();
      });
    });
    form.querySelectorAll("[data-warehouse-product-dictionary-add]").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.warehouseProductDictionaryAdd || "";
        const combo = form.querySelector(`[data-warehouse-product-dictionary-combo="${type}"]`);
        const input = combo?.querySelector("[data-warehouse-product-dictionary-combo-input]");
        const value = String(input?.value || "").trim();
        if (value) {
          syncWarehouseProductDictionary(combo, value);
          closeWarehouseProductDictionary(combo);
        }
        input?.focus();
      });
    });
    const urlField = form.querySelector("[data-warehouse-product-photo-url]");
    const fileField = form.querySelector("[data-warehouse-product-photo-file]");
    urlField?.addEventListener("input", () => showWarehouseProductPreview(form, urlField.value));
    fileField?.addEventListener("change", () => {
      const file = fileField.files && fileField.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => showWarehouseProductPreview(form, reader.result);
      reader.readAsDataURL(file);
    });
    document.addEventListener("mousedown", (event) => {
      form.querySelectorAll("[data-warehouse-product-dictionary-combo]").forEach((combo) => {
        if (!combo.contains(event.target)) closeWarehouseProductDictionary(combo);
      });
    });
  }

  function wireProductDialog(entryForm) {
    const dialog = entryForm?.parentElement?.querySelector("[data-warehouse-product-dialog]") || document.querySelector("[data-warehouse-product-dialog]");
    const form = dialog?.querySelector("[data-warehouse-product-form]");
    if (!dialog || !form || dialog.dataset.warehouseProductDialogReady === "1") return;
    dialog.dataset.warehouseProductDialogReady = "1";
    wireWarehouseProductQuickForm(form);
    dialog.querySelectorAll("[data-warehouse-product-dialog-close], [data-warehouse-product-dialog-cancel]").forEach((button) => {
      button.addEventListener("click", () => closeProductDialog(entryForm));
    });
    form.querySelectorAll('input[inputmode="decimal"]').forEach((input) => {
      input.addEventListener("input", () => {
        formatPurchasePriceInput(input, form.querySelector("[data-warehouse-product-currency]")?.value || "UZS");
      });
    });
    form.querySelector("[data-warehouse-product-currency]")?.addEventListener("change", () => {
      form.querySelectorAll('input[inputmode="decimal"]').forEach((input) => {
        formatPurchasePriceInput(input, form.querySelector("[data-warehouse-product-currency]")?.value || "UZS");
      });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const submit = form.querySelector("[data-warehouse-product-submit]");
      const targetEntryForm = activeProductEntryForm && document.contains(activeProductEntryForm)
        ? activeProductEntryForm
        : entryForm;
      const endpoint = targetEntryForm.getAttribute("data-warehouse-product-quick-save-url") || "/sales/products/quick-save";
      setProductDialogStatus(form, "Сохраняю...", "");
      if (submit) submit.disabled = true;
      fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" },
      })
        .then((response) =>
          response.json().catch(() => ({})).then((body) => {
            if (!response.ok || !body.product) throw new Error(body.error || "Не удалось сохранить");
            return body.product;
          })
        )
        .then((product) => {
          upsertProductOption(product);
          const picker = activeProductPicker && document.contains(activeProductPicker)
            ? activeProductPicker
            : targetEntryForm.querySelector("[data-warehouse-product-picker], [data-adjustment-product-picker]");
          if (picker?.matches("[data-adjustment-product-picker]")) {
            picker.dispatchEvent(new CustomEvent("warehouse-adjustment-product-created", {
              bubbles: true,
              detail: { product },
            }));
          } else {
            applyProductSelection(targetEntryForm, picker, product);
          }
          setProductDialogStatus(form, "Сохранено", "ok");
          closeProductDialog(targetEntryForm);
        })
        .catch((error) => {
          setProductDialogStatus(form, error.message || "Не удалось сохранить", "err");
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
    const supplierRows = Array.isArray(options.supplier_rows) && options.supplier_rows.length
      ? options.supplier_rows
      : (options.suppliers || []).map((name) => ({ name, balance: "Нет долга", balance_kind: "zero" }));
    const rows = supplierRows
      .filter((supplier) => supplierMatches(supplier.name, cleanQuery))
      .slice(0, 80);
    const createLabel = cleanQuery ? `+ Создать поставщика "${cleanQuery}"` : "+ Создать поставщика";
    const isAdjustmentPicker = picker.matches("[data-adjustment-supplier-picker]");
    panel.innerHTML =
      `<button type="button" class="sales-combo-create" data-warehouse-supplier-create>${escapeHtml(createLabel)}</button>` +
      (rows.length
        ? rows
            .map(
              (supplier) =>
                '<button type="button" class="sales-combo-option">' +
                '<span class="sales-combo-main">' +
                highlightText(supplier.name, cleanQuery) +
                "</span>" +
                `<span class="sales-combo-meta"><span>Поставщик</span><strong>${escapeHtml(isAdjustmentPicker ? supplier.balance || "Нет долга" : "Контрагент")}</strong></span>` +
                "</button>"
            )
            .join("")
        : '<div class="sales-combo-empty">Ничего не найдено</div>');
    panel.hidden = false;
    positionSupplierPanel(picker);
    panel.querySelector("[data-warehouse-supplier-create]")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      openSupplierDialog(picker.closest("[data-warehouse-purchase-entry], [data-warehouse-adjustment-entry]"), picker, cleanQuery);
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
    const createButton = picker?.querySelector("[data-warehouse-supplier-create-open]");
    if (!picker || !input || picker.dataset.warehouseSupplierReady === "1") return;
    picker.dataset.warehouseSupplierReady = "1";
    input.addEventListener("focus", () => {
      if (!input.readOnly) renderSupplierPicker(picker, input.value);
    });
    input.addEventListener("input", () => {
      if (!input.readOnly) renderSupplierPicker(picker, input.value);
      updatePurchaseSupplierBalance(picker, supplierByName(input.value));
    });
    input.addEventListener("change", () => {
      updatePurchaseSupplierBalance(picker, supplierByName(input.value));
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
    createButton?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    createButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSupplierDialog(form, picker, input.value);
    });
    updatePurchaseSupplierBalance(picker, supplierByName(input.value));
    requestAnimationFrame(() => updatePurchaseSupplierBalance(picker, supplierByName(input.value)));
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
      openProductDialog(form, picker, query);
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
      const expenseLines = form.querySelector("[data-purchase-expense-lines]");
      const expenseTotalOutput = form.querySelector("[data-purchase-expense-total]");
      const expenseGoodsTotalOutput = form.querySelector("[data-purchase-expense-goods-total]");
      const landedTotalOutput = form.querySelector("[data-purchase-landed-total]");
      const paymentDialog = form.parentElement ? form.parentElement.querySelector("[data-purchase-payment-dialog]") : null;
      const options = readPurchaseOptions();
      if (!body) return;
      wireSupplierPicker(form);
      wireSupplierDialog(form);
      wireProductDialog(form);
      wireExpenseTypeDialog(form);
      syncPurchasePriceTitle(form);
      syncPurchaseSupplierBalance(form);
      requestAnimationFrame(() => syncPurchaseSupplierBalance(form));

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
      const expenseRows = () => Array.from(expenseLines?.querySelectorAll("[data-purchase-expense-row]") || []);
      const expenseRowCurrency = (row) => row.querySelector("[data-purchase-expense-currency-select]")?.value || currency();
      const expenseTotal = () => expenseRows().reduce((sum, row) => {
        const amount = purchaseEntryNumber(row.querySelector("[data-purchase-expense-amount]")?.value || "");
        return sum + convertPurchaseCurrency(amount, expenseRowCurrency(row), currency(), options);
      }, 0);
      const expenseRowLabel = (row) => {
        const select = row?.querySelector('select[name="extra_expense_name"]');
        const selected = select?.selectedOptions ? select.selectedOptions[0] : null;
        return String(selected?.textContent || select?.value || "Дополнительный расход").trim() || "Дополнительный расход";
      };
      const paymentAccountOptions = () => {
        const source = paymentDialog?.querySelector("[data-purchase-payment-account]");
        return Array.from(source?.options || []).map((option) => ({
          value: option.value || "",
          label: option.getAttribute("data-label") || option.textContent.trim() || option.value || "",
          displayLabel: option.textContent.trim() || option.getAttribute("data-label") || option.value || "",
          disabled: option.disabled,
        }));
      };
      const ensureExpensePaymentFields = (row) => {
        if (!row) return {};
        let id = row.querySelector("[data-purchase-expense-account-id]");
        let label = row.querySelector("[data-purchase-expense-account]");
        if (!id) {
          id = document.createElement("input");
          id.type = "hidden";
          id.name = "extra_expense_account_id";
          id.setAttribute("data-purchase-expense-account-id", "");
          row.append(id);
        }
        if (!label) {
          label = document.createElement("input");
          label.type = "hidden";
          label.name = "extra_expense_account";
          label.setAttribute("data-purchase-expense-account", "");
          row.append(label);
        }
        return { id, label };
      };
      const syncExpensePaymentSelect = (expenseRow, select) => {
        const fields = ensureExpensePaymentFields(expenseRow);
        const selected = select?.selectedOptions ? select.selectedOptions[0] : null;
        if (fields.id) fields.id.value = select?.value || "";
        if (fields.label) fields.label.value = selected?.getAttribute("data-label") || selected?.textContent.trim() || "";
      };

      const updateExpenseAllocation = (goodsTotal) => {
        const extraTotal = expenseTotal();
        const productRows = rows().filter(rowHasProduct);
        const quantityTotal = productRows.reduce((sum, row) => {
          return sum + (purchaseEntryNumber(row.querySelector('input[name="line_quantity"]')?.value || "1") || 0);
        }, 0);
        productRows.forEach((row) => {
          const quantity = purchaseEntryNumber(row.querySelector('input[name="line_quantity"]')?.value || "1") || 0;
          const price = purchaseEntryNumber(row.querySelector('input[name="line_price"]')?.value);
          const baseTotal = quantity * price;
          const basis = goodsTotal > 0 ? baseTotal : quantity;
          const basisTotal = goodsTotal > 0 ? goodsTotal : quantityTotal;
          const allocated = basisTotal > 0 ? extraTotal * basis / basisTotal : 0;
          const costPrice = quantity > 0 ? (baseTotal + allocated) / quantity : 0;
          const output = row.querySelector("[data-purchase-entry-cost-price]");
          if (output) output.textContent = purchaseEntryMoney(costPrice, currency());
        });
        rows().filter((row) => !rowHasProduct(row)).forEach((row) => {
          const output = row.querySelector("[data-purchase-entry-cost-price]");
          if (output) output.textContent = purchaseEntryMoney(0, currency());
        });
        if (expenseGoodsTotalOutput) expenseGoodsTotalOutput.textContent = purchaseEntryMoney(goodsTotal, currency());
        if (expenseTotalOutput) expenseTotalOutput.textContent = purchaseEntryMoney(extraTotal, currency());
        if (landedTotalOutput) landedTotalOutput.textContent = purchaseEntryMoney(goodsTotal + extraTotal, currency());
      };

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
        const restNode = box.querySelector("[data-purchase-payment-breakdown-rest]");
        const linesNode = box.querySelector("[data-purchase-payment-breakdown-lines]");
        const state = updatePurchasePaymentStatus(payments);
        if (totalNode) totalNode.textContent = purchaseEntryMoney(state.paid, currency());
        if (restNode) {
          restNode.textContent = purchaseEntryMoney(
            Math.max(0, state.total - state.paid),
            currency(),
          );
        }
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
      const renderPurchasePaymentProductInfo = () => {
        if (!paymentDialog) return;
        const productBody = paymentDialog.querySelector("[data-purchase-payment-product-lines]");
        const productTotalNode = paymentDialog.querySelector("[data-purchase-payment-goods-total]");
        if (productTotalNode) productTotalNode.textContent = purchaseEntryMoney(currentPurchaseTotal(), currency());
        if (!productBody) return;
        productBody.innerHTML = "";
        const productRows = rows().filter(rowHasProduct);
        if (!productRows.length) {
          const row = document.createElement("tr");
          row.innerHTML = '<td colspan="5">Товары пока не выбраны</td>';
          productBody.append(row);
          return;
        }
        productRows.forEach((entryRow, index) => {
          const quantity = purchaseEntryNumber(entryRow.querySelector('input[name="line_quantity"]')?.value || "1") || 0;
          const price = purchaseEntryNumber(entryRow.querySelector('input[name="line_price"]')?.value || "");
          const row = document.createElement("tr");
          const values = [
            String(index + 1),
            entryRow.querySelector('input[name="line_product"]')?.value.trim() || "Товар",
            purchaseEntryFormat(quantity || 0),
            purchaseEntryMoney(price, currency()),
            purchaseEntryMoney(rowTotal(entryRow), currency()),
          ];
          values.forEach((value, cellIndex) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            if (cellIndex > 1) cell.className = "warehouse-payment-number-cell";
            row.append(cell);
          });
          productBody.append(row);
        });
      };
      const renderPurchaseExpensePaymentInfo = () => {
        if (!paymentDialog) return;
        const expenseBody = paymentDialog.querySelector("[data-purchase-payment-expense-lines]");
        const expenseTotalNode = paymentDialog.querySelector("[data-purchase-payment-expense-total]");
        if (expenseTotalNode) expenseTotalNode.textContent = purchaseEntryMoney(expenseTotal(), currency());
        if (!expenseBody) return;
        expenseBody.innerHTML = "";
        const accounts = paymentAccountOptions();
        const filledExpenses = expenseRows().filter((row) => purchaseEntryNumber(row.querySelector("[data-purchase-expense-amount]")?.value || "") > 0);
        if (!filledExpenses.length) {
          const row = document.createElement("tr");
          row.innerHTML = '<td colspan="4">Дополнительных расходов нет</td>';
          expenseBody.append(row);
          return;
        }
        filledExpenses.forEach((expenseRow, index) => {
          const amount = purchaseEntryNumber(expenseRow.querySelector("[data-purchase-expense-amount]")?.value || "");
          const row = document.createElement("tr");
          const numberCell = document.createElement("td");
          numberCell.textContent = String(index + 1);
          const nameCell = document.createElement("td");
          nameCell.textContent = expenseRowLabel(expenseRow);
          const amountCell = document.createElement("td");
          amountCell.className = "warehouse-payment-number-cell";
          amountCell.textContent = purchaseEntryMoney(amount, expenseRowCurrency(expenseRow));
          const accountCell = document.createElement("td");
          const select = document.createElement("select");
          select.className = "settings-profile-input warehouse-payment-expense-account";
          select.setAttribute("aria-label", `Счёт оплаты расхода ${index + 1}`);
          const fields = ensureExpensePaymentFields(expenseRow);
          accounts.forEach((account) => {
            const option = document.createElement("option");
            option.value = account.value;
            option.textContent = account.displayLabel || account.label;
            option.dataset.label = account.label;
            option.disabled = account.disabled;
            select.append(option);
          });
          if (fields.id?.value) setPaymentSelect(select, fields.id.value);
          if (!select.value && accounts.length) setPaymentSelect(select, accounts.find((item) => !item.disabled)?.value || accounts[0].value);
          syncExpensePaymentSelect(expenseRow, select);
          select.addEventListener("change", () => syncExpensePaymentSelect(expenseRow, select));
          accountCell.append(select);
          row.append(numberCell, nameCell, amountCell, accountCell);
          expenseBody.append(row);
        });
      };
      const renderPurchasePaymentDialogInfo = () => {
        renderPurchasePaymentProductInfo();
        renderPurchaseExpensePaymentInfo();
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
      const fillPurchasePaymentLine = (row, payment) => {
        if (!row || !payment) return;
        const lineCurrency = String(payment.currency || currency()).toUpperCase();
        const account = row.querySelector("[data-purchase-payment-account]");
        const currencySelect = row.querySelector("[data-purchase-payment-currency]");
        const input = row.querySelector("[data-purchase-payment-amount]");
        setPaymentSelect(
          account,
          payment.account_id || payment.account || payment.type || "",
        );
        setPaymentSelect(currencySelect, lineCurrency);
        row.dataset.purchasePaymentCurrency = lineCurrency;
        if (input) {
          input.value = purchaseEntryFormatCurrency(
            purchaseEntryNumber(payment.amount),
            lineCurrency,
          );
        }
      };
      const openPurchasePaymentDialog = () => {
        if (!paymentDialog) return;
        paymentRows().forEach((row, index) => {
          if (index > 0) {
            row.remove();
          } else {
            row.querySelectorAll("input").forEach((input) => {
              input.value = "";
            });
          }
        });
        const first = paymentRows()[0] || addPurchasePaymentLine();
        const input = first?.querySelector("[data-purchase-payment-amount]");
        const savedPayments = parsePurchasePaymentLines();
        const legacyPaid = purchaseEntryNumber(paidInput?.value || "");
        if (!savedPayments.length && legacyPaid > 0) {
          savedPayments.push({
            amount: String(legacyPaid),
            currency: currency(),
            type: paymentTypeInput?.value || "Оплата",
          });
        }
        if (savedPayments.length) {
          savedPayments.forEach((payment, index) => {
            const row = index === 0 ? first : addPurchasePaymentLine();
            fillPurchasePaymentLine(row, payment);
          });
        } else {
          setPaymentSelect(
            first?.querySelector("[data-purchase-payment-currency]"),
            currency(),
          );
          if (first) first.dataset.purchasePaymentCurrency = currency();
          if (input) {
            input.value = purchaseEntryFormatCurrency(
              currentPurchaseTotal(),
              currency(),
            );
          }
        }
        updatePurchasePaymentSummary();
        renderPurchasePaymentDialogInfo();
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
          const isSearchRow = !rowHasProduct(row);
          const removeButton = row.querySelector("[data-purchase-entry-remove]");
          row.classList.toggle("is-search-row", isSearchRow);
          if (removeButton) {
            removeButton.hidden = isSearchRow;
            removeButton.disabled = isSearchRow;
          }
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
        updateExpenseAllocation(total);
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
        const costOutput = clone.querySelector("[data-purchase-entry-cost-price]");
        if (costOutput) costOutput.textContent = purchaseEntryMoney(0, currency());
        body.append(clone);
        wireRow(clone);
        recalc();
      };

      const wireExpenseRow = (row) => {
        if (!row || row.dataset.purchaseExpenseReady === "1") return;
        row.dataset.purchaseExpenseReady = "1";
        const typePicker = enhanceExpenseTypePicker(row);
        const typeSelect = row.querySelector('select[name="extra_expense_name"]');
        const amount = row.querySelector("[data-purchase-expense-amount]");
        const expenseCurrency = row.querySelector("[data-purchase-expense-currency-select]");
        if (expenseCurrency && !expenseCurrency.value) expenseCurrency.value = currency();
        amount?.addEventListener("input", () => {
          formatPurchasePriceInput(amount, expenseRowCurrency(row));
          recalc();
        });
        amount?.addEventListener("blur", () => {
          const value = purchaseEntryNumber(amount.value);
          amount.value = value ? purchaseEntryFormatCurrency(value, expenseRowCurrency(row)) : "";
          recalc();
        });
        typeSelect?.addEventListener("change", recalc);
        expenseCurrency?.addEventListener("change", () => {
          const value = purchaseEntryNumber(amount?.value || "");
          if (amount) amount.value = value ? purchaseEntryFormatCurrency(value, expenseRowCurrency(row)) : "";
          recalc();
        });
        row.querySelector("[data-purchase-expense-type-open]")?.addEventListener("click", () => {
          openExpenseTypeDialog(form, typeSelect);
        });
        row.querySelector("[data-purchase-expense-remove]")?.addEventListener("click", () => {
          if (expenseRows().length > 1) {
            row.remove();
          } else {
            row.querySelectorAll("input, select").forEach((control) => {
              control.value = "";
            });
            if (expenseCurrency) expenseCurrency.value = currency();
            syncExpenseTypePicker(typeSelect);
          }
          closeExpenseTypePanel(typePicker);
          recalc();
        });
      };

      const addExpenseRow = () => {
        const source = expenseRows()[0];
        if (!expenseLines || !source) return null;
        const row = source.cloneNode(true);
        delete row.dataset.purchaseExpenseReady;
        row.querySelectorAll("input, select").forEach((control) => {
          control.value = "";
        });
        const expenseCurrency = row.querySelector("[data-purchase-expense-currency-select]");
        if (expenseCurrency) expenseCurrency.value = currency();
        expenseLines.append(row);
        wireExpenseRow(row);
        recalc();
        return row;
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
        expenseRows().forEach((row) => {
          const expenseCurrency = row.querySelector("[data-purchase-expense-currency-select]");
          const value = purchaseEntryNumber(row.querySelector("[data-purchase-expense-amount]")?.value || "");
          if (expenseCurrency && !value) expenseCurrency.value = targetCurrency;
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
          if (!rowHasProduct(row)) return;
          if (rows().length > 1) {
            row.remove();
          } else {
            row.querySelectorAll("input").forEach((input) => {
              input.value = "";
            });
          }
          ensureBlankLine();
          recalc();
        });
      };

      rows().forEach(wireRow);
      expenseRows().forEach(wireExpenseRow);
      form.querySelector("[data-purchase-entry-add-product]")?.addEventListener("click", () => {
        ensureBlankLine();
        const blankRow = rows().find((row) => !rowHasProduct(row)) || rows()[rows().length - 1];
        blankRow?.querySelector("[data-warehouse-product-input]")?.focus();
      });
      form.querySelector("[data-purchase-expense-open]")?.addEventListener("click", () => {
        const row = addExpenseRow();
        form.querySelector("[data-purchase-expenses]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        row?.querySelector("[data-purchase-expense-type-input]")?.focus({ preventScroll: true });
      });
      form.querySelector("[data-purchase-expense-add]")?.addEventListener("click", () => {
        const row = addExpenseRow();
        row?.querySelector("[data-purchase-expense-type-input]")?.focus();
      });
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
        renderPurchaseExpensePaymentInfo();
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
        expenseRows().forEach((row) => {
          const input = row.querySelector("[data-purchase-expense-amount]");
          const value = purchaseEntryNumber(input?.value || "");
          if (input) input.value = value ? String(value) : "";
        });
        recalc();
      });
      recalc();
    });
  }

  function initWarehouseAdjustment(root = document) {
    root.querySelectorAll("[data-warehouse-adjustment-entry]").forEach((form) => {
      if (form.dataset.warehouseAdjustmentReady === "1") return;
      form.dataset.warehouseAdjustmentReady = "1";
      const options = readPurchaseOptions();
      const products = Array.isArray(options.product_rows) ? options.product_rows : [];
      wireProductDialog(form);
      wireSupplierPicker(form);
      wireSupplierDialog(form);
      const body = form.querySelector("[data-adjustment-lines]");
      const supplierInput = form.querySelector("[data-adjustment-supplier]");
      const supplierNameInput = form.querySelector("[data-adjustment-supplier-name]");
      const supplierBalance = form.querySelector("[data-adjustment-supplier-balance]");
      const warehouseInput = form.querySelector("[data-adjustment-warehouse]");
      const currencyInput = form.querySelector("[data-adjustment-currency]");
      const priceTypeInput = form.querySelector("[data-adjustment-price-type]");
      const totalOutput = form.querySelector("[data-adjustment-total]");
      const errorOutput = form.querySelector("[data-adjustment-error]");
      const submitButton = form.querySelector("[data-adjustment-submit]");
      const expenseSection = form.querySelector("[data-adjustment-expenses]");
      const expenseLines = form.querySelector("[data-adjustment-expense-lines]");
      const goodsTotalOutputs = Array.from(form.querySelectorAll("[data-adjustment-goods-total], [data-adjustment-expense-goods-total]"));
      const productsQuantityOutput = form.querySelector("[data-adjustment-products-quantity]");
      const expenseTotalOutput = form.querySelector("[data-adjustment-expense-total]");
      const landedTotalOutput = form.querySelector("[data-adjustment-landed-total]");
      const direction = form.dataset.adjustmentDirection === "in" ? "in" : "out";
      const directionSign = direction === "in" ? 1 : -1;
      const signLabel = direction === "in" ? "+" : "−";
      const expenseRowCurrency = (row) => row.querySelector("[data-adjustment-expense-currency-select]")?.value || currency();
      const syncSupplier = () => {
        const supplierId = String(supplierInput?.value || "").trim();
        const supplier = (readPurchaseOptions().supplier_rows || []).find((item) => String(item.id || "").trim() === supplierId) || null;
        const supplierName = String(supplier?.name || form.querySelector("[data-adjustment-supplier-input]")?.value || "").trim();
        if (supplierNameInput) supplierNameInput.value = supplierName;
        if (supplierBalance) {
          supplierBalance.textContent = String(supplier?.balance || "Нет долга").trim() || "Нет долга";
          supplierBalance.classList.remove("is-debt", "is-advance", "is-mixed", "is-zero");
          supplierBalance.classList.add(`is-${String(supplier?.balance_kind || "zero")}`);
        }
      };
      const rows = () => Array.from(body?.querySelectorAll("[data-adjustment-row]") || []);
      const expenseRows = () => Array.from(expenseLines?.querySelectorAll("[data-adjustment-expense-row]") || []);
      const expenseTotal = () => expenseRows().reduce((sum, row) => {
        const amount = Math.max(0, purchaseEntryNumber(row.querySelector("[data-adjustment-expense-amount]")?.value || ""));
        return sum + convertPurchaseCurrency(amount, expenseRowCurrency(row), currency(), readPurchaseOptions());
      }, 0);
      const productForRow = (row) => {
        const productId = String(row.querySelector("[data-adjustment-product]")?.value || "");
        return products.find((product) => String(product?.id || "") === productId) || null;
      };
      const stockForProduct = (product) => {
        const warehouse = normalize(warehouseInput?.value);
        const stocks = Array.isArray(product?.stocks) ? product.stocks : [];
        const matching = stocks.filter((stock) => normalize(stock?.warehouse) === warehouse);
        if (matching.length) {
          return matching.reduce((sum, stock) => sum + purchaseEntryNumber(stock?.quantity), 0);
        }
        const totalStock = stocks.reduce((sum, stock) => sum + purchaseEntryNumber(stock?.quantity), 0);
        return stocks.length ? totalStock : purchaseEntryNumber(product?.quantity);
      };
      const priceForProduct = (product) => {
        const warehouse = normalize(warehouseInput?.value);
        const stocks = Array.isArray(product?.stocks) ? product.stocks : [];
        const history = Array.isArray(product?.purchase_history) ? product.purchase_history : [];
        const newestPriced = (entries) => [...entries]
          .filter((entry) => purchaseEntryNumber(entry?.price) > 0)
          .sort((left, right) => String(right?.date || "").localeCompare(String(left?.date || "")))[0];
        const matchingHistory = history.filter((entry) => normalize(entry?.warehouse) === warehouse);
        const matchingStocks = stocks.filter((stock) => normalize(stock?.warehouse) === warehouse);
        const priced = newestPriced(matchingHistory)
          || newestPriced(history)
          || newestPriced(matchingStocks)
          || newestPriced(stocks);
        return purchaseEntryNumber(priced?.price);
      };
      const selectedAdjustmentPriceType = () => {
        const option = priceTypeInput?.selectedOptions?.[0] || null;
        const priceType = {
          id: String(priceTypeInput?.value || "").trim(),
          name: String(option?.dataset?.name || option?.textContent || "").trim(),
          currency: String(option?.dataset?.currency || "UZS").trim().toUpperCase() || "UZS",
        };
        const nameInput = form.querySelector("[data-adjustment-price-type-name]");
        const currencyField = form.querySelector("[data-adjustment-price-type-currency]");
        const title = form.querySelector("[data-adjustment-sale-price-title]");
        if (nameInput) nameInput.value = priceType.name;
        if (currencyField) currencyField.value = priceType.currency;
        if (title) title.textContent = priceType.name || "Продажная цена";
        return priceType;
      };
      const salesPriceForProduct = (product) => {
        const priceType = selectedAdjustmentPriceType();
        const entry = productPriceEntryForType(product, priceType);
        return {
          price: purchaseEntryNumber(entry?.price),
          currency: String(entry?.currency || priceType.currency || "UZS").toUpperCase(),
        };
      };
      const currency = () => String(currencyInput?.value || "UZS").toUpperCase();
      const setOutput = (row, selector, value) => {
        const output = row.querySelector(selector);
        if (output) output.textContent = value;
      };
      const renumber = () => {
        rows().forEach((row, index) => {
          setOutput(row, ".warehouse-adjustment-row-number", index + 1);
        });
      };
      const syncSearchRows = () => {
        const lineRows = rows();
        lineRows.forEach((row, index) => {
          const isSearchRow = index === lineRows.length - 1 && !productForRow(row);
          row.classList.toggle("is-search-row", isSearchRow);
        });
      };
      const recalc = () => {
        let total = 0;
        let hasLine = false;
        let invalidStock = false;
        let duplicateProduct = false;
        const selectedProducts = new Set();
        rows().forEach((row) => {
          const product = productForRow(row);
          const quantityInput = row.querySelector("[data-adjustment-quantity]");
          const priceInput = row.querySelector("[data-adjustment-price]");
          const salePriceInput = row.querySelector("[data-adjustment-sale-price]");
          const quantity = Math.max(0, purchaseEntryNumber(quantityInput?.value));
          const price = Math.max(0, purchaseEntryNumber(priceInput?.value));
          const current = product ? stockForProduct(product) : 0;
          const after = current + directionSign * quantity;
          const lineTotal = quantity * price;
          const productId = String(product?.id || "");
          if (productId) {
            if (selectedProducts.has(productId)) duplicateProduct = true;
            selectedProducts.add(productId);
          }
          hasLine = hasLine || Boolean(product && quantity > 0);
          const rowInvalid = direction === "out" && Boolean(product) && quantity > current;
          invalidStock = invalidStock || rowInvalid;
          row.classList.toggle("is-insufficient", rowInvalid);
          quantityInput?.setAttribute("aria-invalid", rowInvalid ? "true" : "false");
          setOutput(row, "[data-adjustment-current]", quantityText(current));
          setOutput(row, "[data-adjustment-after]", quantityText(after));
          setOutput(row, "[data-adjustment-unit]", product?.unit || "");
          setOutput(row, "[data-adjustment-sign]", signLabel);
          if (salePriceInput && salePriceInput.dataset.adjustmentManualSalePrice !== "1") {
            const salesPrice = product ? salesPriceForProduct(product) : { price: 0, currency: "UZS" };
            salePriceInput.value = salesPrice.price
              ? purchaseEntryFormatCurrency(salesPrice.price, salesPrice.currency)
              : "";
          }
          setOutput(
            row,
            "[data-adjustment-line-total]",
            `${signLabel} ${purchaseEntryMoney(lineTotal, currency())}`,
          );
          if (product && quantity > 0) total += lineTotal;
        });
        const extraTotal = direction === "in" ? expenseTotal() : 0;
        const quantityTotal = rows().reduce((sum, row) => {
          if (!productForRow(row)) return sum;
          return sum + Math.max(0, purchaseEntryNumber(row.querySelector("[data-adjustment-quantity]")?.value));
        }, 0);
        rows().forEach((row) => {
          const product = productForRow(row);
          const quantity = Math.max(0, purchaseEntryNumber(row.querySelector("[data-adjustment-quantity]")?.value));
          const price = Math.max(0, purchaseEntryNumber(row.querySelector("[data-adjustment-price]")?.value));
          const lineTotal = quantity * price;
          const basis = total > 0 ? lineTotal : quantity;
          const basisTotal = total > 0 ? total : quantityTotal;
          const allocatedExpense = product && basisTotal > 0 ? extraTotal * basis / basisTotal : 0;
          const costPrice = quantity > 0 ? (lineTotal + allocatedExpense) / quantity : 0;
          setOutput(row, "[data-adjustment-cost-price]", purchaseEntryMoney(costPrice, currency()));
        });
        const landedTotal = total + extraTotal;
        if (totalOutput) totalOutput.textContent = `${signLabel} ${purchaseEntryMoney(direction === "in" ? landedTotal : total, currency())}`;
        goodsTotalOutputs.forEach((output) => {
          output.textContent = purchaseEntryMoney(total, currency());
        });
        if (productsQuantityOutput) productsQuantityOutput.textContent = quantityText(quantityTotal);
        if (expenseTotalOutput) expenseTotalOutput.textContent = purchaseEntryMoney(extraTotal, currency());
        if (landedTotalOutput) landedTotalOutput.textContent = purchaseEntryMoney(landedTotal, currency());
        if (errorOutput) {
          errorOutput.textContent = duplicateProduct
            ? "Один товар нельзя добавлять дважды."
            : invalidStock
              ? "Количество списания превышает доступный остаток."
              : "";
        }
        if (submitButton) submitButton.disabled = !hasLine || invalidStock || duplicateProduct;
        renumber();
        syncSearchRows();
      };
      const resetRow = (row) => {
        row.classList.remove("is-insufficient");
        row.querySelectorAll("select, input").forEach((control) => {
          control.value = "";
          control.removeAttribute("aria-invalid");
          delete control.dataset.adjustmentAutoPrice;
          delete control.dataset.adjustmentManualSalePrice;
        });
        // Разблокировать комбобокс товара и скрыть его панель.
        const picker = row.querySelector("[data-adjustment-product-picker]");
        if (picker) picker.classList.remove("is-locked");
        const pickerInput = row.querySelector("[data-adjustment-product-input]");
        if (pickerInput) pickerInput.readOnly = false;
        const pickerEdit = row.querySelector("[data-adjustment-product-edit]");
        if (pickerEdit) pickerEdit.hidden = true;
        const pickerPanel = row.querySelector("[data-adjustment-product-panel]");
        if (pickerPanel) pickerPanel.hidden = true;
        setOutput(row, "[data-adjustment-current]", "0");
        setOutput(row, "[data-adjustment-after]", "0");
        setOutput(row, "[data-adjustment-unit]", "");
        setOutput(row, "[data-adjustment-cost-price]", purchaseEntryMoney(0, currency()));
        const salePriceInput = row.querySelector("[data-adjustment-sale-price]");
        if (salePriceInput) salePriceInput.value = "";
        setOutput(row, "[data-adjustment-line-total]", `${signLabel} ${purchaseEntryMoney(0, currency())}`);
      };
      // Выбор товара — поиском (комбобокс как в продаже), а не выпадающим
      // списком: печатаешь название, выпадают совпадения с остатком.
      const wireAdjustmentPicker = (row) => {
        const picker = row.querySelector("[data-adjustment-product-picker]");
        const search = row.querySelector("[data-adjustment-product-input]");
        const hidden = row.querySelector("[data-adjustment-product]");
        const editBtn = row.querySelector("[data-adjustment-product-edit]");
        const panel = row.querySelector("[data-adjustment-product-panel]");
        if (!picker || !search || !hidden || !panel) return;
        const closePanel = () => {
          panel.hidden = true;
        };
        const lock = (locked) => {
          picker.classList.toggle("is-locked", locked);
          search.readOnly = locked;
          if (editBtn) editBtn.hidden = !locked;
          if (locked) closePanel();
        };
        const pick = (item) => {
          if (!item) return;
          search.value = item.name || "";
          hidden.value = item.id || "";
          lock(true);
          // Тот же change, что и у прежнего select — подставит цену и пересчёт.
          hidden.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const render = (query) => {
          const cleanQuery = String(query || "").trim();
          const selected = new Set(
            rows()
              .map((r) => String(r.querySelector("[data-adjustment-product]")?.value || ""))
              .filter(Boolean),
          );
          const currentId = String(hidden.value || "");
          const list = products
            .filter((item) => productKind(item) === "product" && itemMatches(item, query))
            .filter((item) => !selected.has(String(item.id)) || String(item.id) === currentId)
            .slice(0, 100);
          const createLabel = cleanQuery ? `+ Создать товар "${cleanQuery}"` : "+ Создать товар";
          panel.innerHTML =
            `<button type="button" class="sales-combo-create" data-adjustment-product-create>${escapeHtml(createLabel)}</button>` +
            (list.length
            ? list
                .map((item) => {
                  return (
                    '<button type="button" class="sales-combo-option">' +
                    '<span class="sales-combo-main">' +
                    highlightText(item.name, query) +
                    "</span></button>"
                  );
                })
                .join("")
            : '<div class="sales-combo-empty">Ничего не найдено</div>');
          panel.hidden = false;
          positionFloatingPanel(search, panel, 420);
          panel.querySelector("[data-adjustment-product-create]")?.addEventListener("mousedown", (event) => {
            event.preventDefault();
            openProductDialog(form, picker, cleanQuery);
          });
          panel.querySelectorAll(".sales-combo-option").forEach((button, index) => {
            button.addEventListener("mousedown", (event) => {
              event.preventDefault();
              pick(list[index]);
            });
          });
        };
        search.addEventListener("focus", () => {
          if (!search.readOnly) render(search.value);
        });
        search.addEventListener("input", () => {
          if (!search.readOnly) render(search.value);
        });
        search.addEventListener("keydown", (event) => {
          if (event.key === "Escape") closePanel();
          if (event.key === "Enter") {
            const first = panel.querySelector(".sales-combo-option");
            if (first && !panel.hidden) {
              event.preventDefault();
              first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            }
          }
        });
        editBtn?.addEventListener("click", () => {
          lock(false);
          search.focus();
          search.select();
          render(search.value);
        });
        picker.addEventListener("warehouse-adjustment-product-created", (event) => {
          const product = event.detail?.product;
          if (!product?.name) return;
          const productId = String(product.id || "");
          const index = products.findIndex((item) => (
            (productId && String(item?.id || "") === productId)
            || normalize(item?.name) === normalize(product.name)
          ));
          if (index >= 0) products[index] = product;
          else products.push(product);
          products.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), "ru"));
          pick(product);
        });
      };
      const wireRow = (row) => {
        if (row.dataset.warehouseAdjustmentRowReady === "1") return;
        row.dataset.warehouseAdjustmentRowReady = "1";
        wireAdjustmentPicker(row);
        const productInput = row.querySelector("[data-adjustment-product]");
        const quantityInput = row.querySelector("[data-adjustment-quantity]");
        const priceInput = row.querySelector("[data-adjustment-price]");
        const salePriceInput = row.querySelector("[data-adjustment-sale-price]");
        productInput?.addEventListener("change", () => {
          const suggestedPrice = priceForProduct(productForRow(row));
          if (priceInput) {
            priceInput.value = suggestedPrice ? purchaseEntryFormatCurrency(suggestedPrice, currency()) : "";
            priceInput.dataset.adjustmentAutoPrice = "1";
          }
          if (salePriceInput) salePriceInput.dataset.adjustmentManualSalePrice = "0";
          recalc();
          if (productForRow(row) && rows().every((line) => Boolean(productForRow(line)))) {
            addRow({ focus: false });
          }
          quantityInput?.focus();
        });
        quantityInput?.addEventListener("input", () => {
          quantityInput.value = quantityInput.value.replace(/[^\d\s.,]/g, "");
          recalc();
        });
        priceInput?.addEventListener("input", () => {
          formatPurchasePriceInput(priceInput, currency());
          priceInput.dataset.adjustmentAutoPrice = "0";
          recalc();
        });
        salePriceInput?.addEventListener("input", () => {
          const saleCurrency = selectedAdjustmentPriceType().currency;
          formatPurchasePriceInput(salePriceInput, saleCurrency);
          salePriceInput.dataset.adjustmentManualSalePrice = "1";
        });
        [quantityInput, priceInput, salePriceInput].forEach((input) => {
          input?.addEventListener("focus", () => window.setTimeout(() => input.select(), 0));
          input?.addEventListener("blur", () => {
            const value = purchaseEntryNumber(input.value);
            input.value = value
              ? input === quantityInput
                ? quantityText(value)
                : purchaseEntryFormatCurrency(
                  value,
                  input === salePriceInput ? selectedAdjustmentPriceType().currency : currency(),
                )
              : "";
            recalc();
          });
        });
        row.querySelector("[data-adjustment-remove]")?.addEventListener("click", () => {
          if (rows().length > 1) row.remove();
          else resetRow(row);
          recalc();
        });
      };
      const addRow = ({ focus = true } = {}) => {
        const source = rows()[0];
        if (!source || !body) return;
        const clone = source.cloneNode(true);
        delete clone.dataset.warehouseAdjustmentRowReady;
        resetRow(clone);
        body.append(clone);
        wireRow(clone);
        recalc();
        if (focus) clone.querySelector("[data-adjustment-product-input]")?.focus();
      };
      const wireExpenseRow = (row) => {
        if (!row || row.dataset.adjustmentExpenseReady === "1") return;
        row.dataset.adjustmentExpenseReady = "1";
        const typePicker = enhanceExpenseTypePicker(row);
        const typeSelect = row.querySelector('select[name="extra_expense_name"]');
        const amount = row.querySelector("[data-adjustment-expense-amount]");
        const expenseCurrency = row.querySelector("[data-adjustment-expense-currency-select]");
        if (expenseCurrency && !expenseCurrency.value) expenseCurrency.value = currency();
        amount?.addEventListener("input", () => {
          formatPurchasePriceInput(amount, expenseRowCurrency(row));
          recalc();
        });
        amount?.addEventListener("blur", () => {
          const value = purchaseEntryNumber(amount.value);
          amount.value = value ? purchaseEntryFormatCurrency(value, expenseRowCurrency(row)) : "";
          recalc();
        });
        typeSelect?.addEventListener("change", recalc);
        expenseCurrency?.addEventListener("change", () => {
          const value = purchaseEntryNumber(amount?.value || "");
          if (amount) amount.value = value ? purchaseEntryFormatCurrency(value, expenseRowCurrency(row)) : "";
          recalc();
        });
        row.querySelector("[data-adjustment-expense-type-open]")?.addEventListener("click", () => {
          openExpenseTypeDialog(form, typeSelect);
        });
        row.querySelector("[data-adjustment-expense-remove]")?.addEventListener("click", () => {
          if (expenseRows().length > 1) row.remove();
          else {
            row.querySelectorAll("input, select").forEach((control) => { control.value = ""; });
            if (expenseCurrency) expenseCurrency.value = currency();
            syncExpenseTypePicker(typeSelect);
          }
          closeExpenseTypePanel(typePicker);
          recalc();
        });
      };
      const addExpenseRow = () => {
        const source = expenseRows()[0];
        if (!source || !expenseLines) return null;
        const clone = source.cloneNode(true);
        delete clone.dataset.adjustmentExpenseReady;
        clone.querySelectorAll("input, select").forEach((control) => { control.value = ""; });
        const expenseCurrency = clone.querySelector("[data-adjustment-expense-currency-select]");
        if (expenseCurrency) expenseCurrency.value = currency();
        expenseLines.append(clone);
        wireExpenseRow(clone);
        recalc();
        return clone;
      };
      rows().forEach(wireRow);
      expenseRows().forEach(wireExpenseRow);
      wireExpenseTypeDialog(form);
      form.querySelector("[data-adjustment-add-row]")?.addEventListener("click", addRow);
      form.querySelector("[data-adjustment-expense-add]")?.addEventListener("click", () => {
        const row = addExpenseRow();
        row?.querySelector("[data-purchase-expense-type-input]")?.focus();
      });
      form.querySelector("[data-adjustment-expense-open]")?.addEventListener("click", () => {
        if (expenseSection) expenseSection.hidden = false;
        const row = expenseRows().find((item) => {
          const name = item.querySelector('select[name="extra_expense_name"]')?.value || "";
          const amount = item.querySelector("[data-adjustment-expense-amount]")?.value || "";
          return !name && !purchaseEntryNumber(amount);
        }) || addExpenseRow();
        expenseSection?.scrollIntoView({ behavior: "smooth", block: "center" });
        row?.querySelector("[data-purchase-expense-type-input]")?.focus({ preventScroll: true });
      });
      form.querySelector("[data-adjustment-expense-close]")?.addEventListener("click", () => {
        if (expenseSection) expenseSection.hidden = true;
      });
      warehouseInput?.addEventListener("change", () => {
        rows().forEach((row) => {
          const priceInput = row.querySelector("[data-adjustment-price]");
          if (!priceInput || priceInput.dataset.adjustmentAutoPrice === "0") return;
          const suggestedPrice = priceForProduct(productForRow(row));
          priceInput.value = suggestedPrice ? purchaseEntryFormatCurrency(suggestedPrice, currency()) : "";
        });
        recalc();
      });
      currencyInput?.addEventListener("change", recalc);
      supplierInput?.addEventListener("change", syncSupplier);
      priceTypeInput?.addEventListener("change", () => {
        rows().forEach((row) => {
          const salePriceInput = row.querySelector("[data-adjustment-sale-price]");
          if (salePriceInput) salePriceInput.dataset.adjustmentManualSalePrice = "0";
        });
        recalc();
      });
      form.addEventListener("submit", (event) => {
        recalc();
        if (submitButton?.disabled) {
          event.preventDefault();
          return;
        }
        rows().forEach((row) => {
          row.querySelectorAll("[data-adjustment-quantity], [data-adjustment-price], [data-adjustment-sale-price]").forEach((input) => {
            const value = purchaseEntryNumber(input.value);
            input.value = value ? String(value) : "";
          });
        });
        expenseRows().forEach((row) => {
          const input = row.querySelector("[data-adjustment-expense-amount]");
          const value = purchaseEntryNumber(input?.value || "");
          if (input) input.value = value ? String(value) : "";
        });
      });
      syncSupplier();
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

  function renderSupplierBalanceLines(root, supplier) {
    const container = root.querySelector("[data-purchase-supplier-card-balance]");
    if (!container) return;
    container.replaceChildren();
    const lines = Array.isArray(supplier?.balance_lines) ? supplier.balance_lines : [];
    if (!lines.length) {
      const item = document.createElement("div");
      item.className = "warehouse-supplier-card-balance-item";
      item.dataset.balanceKind = "zero";
      item.innerHTML = "<span>Баланс</span><strong>Нет долга</strong>";
      container.append(item);
      return;
    }
    lines.forEach((line) => {
      const item = document.createElement("div");
      item.className = "warehouse-supplier-card-balance-item";
      item.dataset.balanceKind = String(line.kind || "zero");
      const label = document.createElement("span");
      label.textContent = String(line.label || (line.kind === "debt" ? "Мы должны" : line.kind === "advance" ? "Аванс поставщику" : "Баланс"));
      const value = document.createElement("strong");
      const amount = String(line.amount_abs || line.amount || "0");
      const currency = String(line.currency || "UZS").toUpperCase();
      value.textContent = line.kind === "zero" ? "Нет долга" : `${amount} ${currency}`;
      item.append(label, value);
      container.append(item);
    });
  }

  function supplierCardTable(headers, rows, emptyText) {
    return (
      '<div class="warehouse-supplier-card-table-wrap"><table class="warehouse-supplier-card-table"><thead><tr>' +
      headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("") +
      "</tr></thead><tbody>" +
      (rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="warehouse-supplier-card-empty">${escapeHtml(emptyText)}</td></tr>`) +
      "</tbody></table></div>"
    );
  }

  function supplierStatusLabel(value) {
    const clean = String(value || "").trim().toLowerCase();
    if (clean === "active") return "Активный";
    if (clean === "inactive") return "Неактивный";
    return value || "-";
  }

  function supplierCardInfo(supplier) {
    const rows = [
      ["Телефон", supplier.phone || "-"],
      ["Email", supplier.email || "-"],
      ["ИНН", supplier.inn || supplier.tax_id || "-"],
      ["Категория", supplier.category || "-"],
      ["Последняя закупка", supplier.last_date || "-"],
      ["Статус", supplierStatusLabel(supplier.status)],
      ["Адрес", supplier.address || "-"],
    ];
    return (
      '<dl class="warehouse-supplier-card-info">' +
      rows.map(([label, value], index) => (
        `<div${index === rows.length - 1 ? ' class="wide"' : ""}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
      )).join("") +
      "</dl>"
    );
  }

  function renderSupplierCardDetails(dialog, supplier) {
    const metrics = dialog.querySelector("[data-purchase-supplier-card-metrics]");
    const tabs = dialog.querySelector("[data-purchase-supplier-card-tabs]");
    const panels = dialog.querySelector("[data-purchase-supplier-card-panels]");
    const summary = supplier.summary || {};
    const currency = String(supplier.reconciliation_totals?.currency || "UZS").toUpperCase();
    if (metrics) {
      metrics.innerHTML = [
        ["Баланс", supplier.balance || summary.payable || "0", currency],
        ["Закупки", summary.purchases || "0", `${summary.purchase_count || 0} документов`],
        ["Оплачено", summary.paid || "0", currency],
        ["Долг", summary.payable || supplier.balance || "0", currency],
      ].map((item) => (
        `<div><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></div>`
      )).join("");
    }

    const purchaseRows = (supplier.purchases || []).map((row) => (
      `<tr><td><strong>${escapeHtml(row.number || "-")}</strong></td><td>${escapeHtml(row.date || "-")}</td><td>${escapeHtml(row.amount || "0")} ${escapeHtml(row.currency || currency)}</td><td>${escapeHtml(row.paid_amount || "0")} ${escapeHtml(row.currency || currency)}</td><td>${escapeHtml(row.debt_amount || "0")} ${escapeHtml(row.currency || currency)}</td><td>${escapeHtml(row.status_label || "-")}</td></tr>`
    ));
    const payableRows = (supplier.payables || []).map((row) => (
      `<tr><td><strong>${escapeHtml(row.number || "-")}</strong></td><td>${escapeHtml(row.date || "-")}</td><td>${escapeHtml(row.amount || "0")} ${escapeHtml(row.currency || currency)}</td><td>${escapeHtml(row.paid_amount || "0")} ${escapeHtml(row.currency || currency)}</td><td><strong>${escapeHtml(row.debt_amount || "0")} ${escapeHtml(row.currency || currency)}</strong></td></tr>`
    ));
    const reconciliationRows = (supplier.reconciliation || []).map((row) => (
      `<tr><td>${escapeHtml(row.date || "-")}</td><td><strong>${escapeHtml(row.document || "-")}</strong></td><td>${escapeHtml(row.purchase || "0")} ${escapeHtml(row.currency || currency)}</td><td>${escapeHtml(row.payment || "0")} ${escapeHtml(row.currency || currency)}</td><td>${escapeHtml(row.balance || "0")} ${escapeHtml(row.currency || currency)}</td></tr>`
    ));
    const noteHtml = `<div class="warehouse-supplier-card-note">${escapeHtml(supplier.comment || supplier.note || "Комментарий не указан.")}</div>`;
    const sections = [
      ["info", "Информация", supplierCardInfo(supplier)],
      ["purchases", "Закупки", supplierCardTable(["№", "Дата", "Сумма", "Оплачено", "Долг", "Статус"], purchaseRows, "Закупок пока нет.")],
      ["payables", "Долги", supplierCardTable(["№", "Дата", "Сумма", "Оплачено", "Долг"], payableRows, "Непогашенных долгов нет.")],
      ["reconciliation", "Акт сверки", supplierCardTable(["Дата", "Документ", "Закупка", "Оплата", "Баланс"], reconciliationRows, "Операций пока нет.")],
      ["note", "Комментарий", noteHtml],
    ];
    if (tabs) {
      tabs.innerHTML = sections.map((section, index) => (
        `<button type="button" data-purchase-supplier-card-tab="${section[0]}" class="${index === 0 ? "active" : ""}" aria-selected="${index === 0 ? "true" : "false"}">${escapeHtml(section[1])}</button>`
      )).join("");
    }
    if (panels) {
      panels.innerHTML = sections.map((section, index) => (
        `<section data-purchase-supplier-card-panel="${section[0]}"${index === 0 ? "" : " hidden"}>${section[2]}</section>`
      )).join("");
    }
  }

  function activateSupplierCardTab(dialog, tabName) {
    dialog.querySelectorAll("[data-purchase-supplier-card-tab]").forEach((button) => {
      const active = button.getAttribute("data-purchase-supplier-card-tab") === tabName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    dialog.querySelectorAll("[data-purchase-supplier-card-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-purchase-supplier-card-panel") !== tabName;
    });
  }

  function openPurchaseSupplierCard(panel, purchase) {
    const dialog = panel.querySelector("[data-purchase-supplier-card-dialog]");
    const supplier = purchase?.supplier_card || null;
    if (!dialog || !supplier) return;
    setText(dialog, "[data-purchase-supplier-card-name]", supplier.name || purchase.supplier || "Поставщик");
    setText(dialog, "[data-purchase-supplier-card-sub]", supplier.official_name || supplier.balance || "Баланс и контакты");
    renderSupplierBalanceLines(dialog, supplier);
    renderSupplierCardDetails(dialog, supplier);
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function detailPaymentDialog(root = document) {
    return root.querySelector("[data-purchase-detail-payment-dialog]");
  }

  function detailPaymentRows(dialog) {
    return dialog ? Array.from(dialog.querySelectorAll("[data-detail-payment-line]")) : [];
  }

  function detailPaymentLabel(select) {
    if (!select) return "";
    const option = select.selectedOptions ? select.selectedOptions[0] : null;
    return option ? option.getAttribute("data-label") || option.textContent.trim() || select.value : select.value || "";
  }

  function detailPaymentCurrency(row, dialog) {
    return String(row?.querySelector("[data-detail-payment-currency]")?.value || dialog?.dataset.paymentCurrency || "UZS").toUpperCase();
  }

  function collectDetailPayments(dialog) {
    if (!dialog) return [];
    return detailPaymentRows(dialog).map((row) => {
      const amountInput = row.querySelector("[data-detail-payment-amount]");
      const currency = detailPaymentCurrency(row, dialog);
      if (amountInput) formatPurchasePriceInput(amountInput, currency);
      const amount = purchaseEntryNumber(amountInput?.value || "");
      if (!amount) return null;
      const account = row.querySelector("[data-detail-payment-account]");
      const accountLabel = detailPaymentLabel(account);
      return {
        account_id: account ? account.value : "",
        account: accountLabel,
        currency,
        type: accountLabel || "Оплата",
        amount: String(amount)
      };
    }).filter(Boolean);
  }

  function detailPaymentTotal(dialog) {
    const options = readPurchaseOptions();
    const currency = String(dialog?.dataset.paymentCurrency || "UZS").toUpperCase();
    return collectDetailPayments(dialog).reduce((sum, item) => {
      return sum + convertPurchaseCurrency(item.amount, item.currency || currency, currency, options);
    }, 0);
  }

  function updateDetailPaymentSummary(dialog) {
    if (!dialog) return;
    const currency = String(dialog.dataset.paymentCurrency || "UZS").toUpperCase();
    const due = purchaseEntryNumber(dialog.dataset.paymentDue || "0");
    const paid = detailPaymentTotal(dialog);
    const rest = Math.max(0, due - paid);
    const overpaid = Math.max(0, paid - due);
    setText(dialog, "[data-detail-payment-due]", purchaseEntryMoney(due, currency));
    setText(dialog, "[data-detail-payment-paid]", purchaseEntryMoney(paid, currency));
    setText(dialog, "[data-detail-payment-rest]", purchaseEntryMoney(rest, currency));
    setText(dialog, "[data-detail-payment-over]", purchaseEntryMoney(overpaid, currency));
    const overRow = dialog.querySelector("[data-detail-payment-over-row]");
    if (overRow) overRow.hidden = overpaid <= 0;
    dialog.querySelector("[data-detail-payment-summary]")?.classList.toggle("is-overpaid", overpaid > 0);
    const submit = dialog.querySelector("[data-detail-payment-submit]");
    if (submit) {
      submit.disabled = paid <= 0 || overpaid > 0;
      submit.title = overpaid > 0 ? `Оплата больше суммы на ${purchaseEntryMoney(overpaid, currency)}` : "";
    }
  }

  function wireDetailPaymentRow(dialog, row) {
    if (!dialog || !row || row.dataset.detailPaymentReady === "1") return;
    row.dataset.detailPaymentReady = "1";
    row.querySelectorAll("[data-detail-payment-amount], [data-detail-payment-account], [data-detail-payment-currency]").forEach((input) => {
      input.addEventListener("input", () => {
        if (input.matches("[data-detail-payment-amount]")) formatPurchasePriceInput(input, detailPaymentCurrency(row, dialog));
        updateDetailPaymentSummary(dialog);
      });
      input.addEventListener("change", () => {
        if (input.matches("[data-detail-payment-amount]")) formatPurchasePriceInput(input, detailPaymentCurrency(row, dialog));
        updateDetailPaymentSummary(dialog);
      });
    });
    row.querySelector("[data-detail-payment-remove]")?.addEventListener("click", () => {
      if (detailPaymentRows(dialog).length <= 1) {
        row.querySelectorAll("input").forEach((input) => {
          input.value = "";
        });
      } else {
        row.remove();
      }
      updateDetailPaymentSummary(dialog);
    });
  }

  function addDetailPaymentRow(dialog) {
    const wrap = dialog?.querySelector("[data-detail-payment-lines-ui]");
    const source = dialog?.querySelector("[data-detail-payment-line]");
    if (!wrap || !source) return null;
    const row = source.cloneNode(true);
    row.removeAttribute("data-detail-payment-ready");
    row.querySelectorAll("input").forEach((input) => {
      input.value = "";
    });
    const currency = row.querySelector("[data-detail-payment-currency]");
    if (currency) currency.value = dialog.dataset.paymentCurrency || currency.value || "UZS";
    wrap.append(row);
    wireDetailPaymentRow(dialog, row);
    updateDetailPaymentSummary(dialog);
    return row;
  }

  function closeDetailPaymentDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    dialog.removeAttribute("open");
  }

  function openDetailPaymentDialog(root, panel) {
    const dialog = detailPaymentDialog(root);
    const actionForm = panel?.querySelector("[data-purchase-payment-form]");
    const modalForm = dialog?.querySelector("[data-purchase-detail-payment-modal-form]");
    if (!dialog || !actionForm || !modalForm) return;
    const currency = String(actionForm.dataset.paymentCurrency || "UZS").toUpperCase();
    const due = purchaseEntryNumber(actionForm.dataset.paymentDue || "0");
    dialog.dataset.paymentCurrency = currency;
    dialog.dataset.paymentDue = String(due);
    modalForm.action = actionForm.action || "";
    detailPaymentRows(dialog).forEach((row, index) => {
      if (index > 0) row.remove();
    });
    const row = detailPaymentRows(dialog)[0] || addDetailPaymentRow(dialog);
    const currencyInput = row?.querySelector("[data-detail-payment-currency]");
    const amountInput = row?.querySelector("[data-detail-payment-amount]");
    if (currencyInput) currencyInput.value = currency;
    if (amountInput) amountInput.value = purchaseEntryFormatCurrency(due, currency);
    updateDetailPaymentSummary(dialog);
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch (_err) {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
    window.setTimeout(() => {
      amountInput?.focus();
      amountInput?.select();
    }, 0);
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
    form.dataset.paymentDue = String(debt);
    form.dataset.paymentCurrency = String(purchase.currency || "UZS").toUpperCase();
    const canPay = Boolean(purchaseId && debt > 0);
    form.hidden = !canPay;
    const actionRow = form.closest("tr");
    if (actionRow) actionRow.hidden = !canPay;
    button.disabled = !canPay;
    button.textContent = canPay ? `Оплатить ${moneyWithCurrency(debt, purchase.currency || "UZS")}` : "Оплачено";
  }

  function renderPurchasePayments(panel, purchase) {
    const paymentList = panel.querySelector("[data-purchase-payment-list]");
    const paymentLinesRoot = panel.querySelector("[data-purchase-payment-lines]");
    if (!paymentList || !paymentLinesRoot) return;

    const currency = String(purchase.currency || "UZS").toUpperCase();
    const paymentLines = (Array.isArray(purchase.payment_lines) ? purchase.payment_lines : [])
      .filter((payment) => purchaseEntryNumber(payment?.amount) > 0)
      .map((payment) => ({
        date: String(payment.date || "").trim(),
        account: String(payment.account || payment.type || "Оплата").trim() || "Оплата",
        type: String(payment.type || payment.account || "Оплата").trim() || "Оплата",
        amount: payment.amount,
        currency: String(payment.currency || currency).toUpperCase(),
      }));

    const paidAmount = purchaseEntryNumber(purchase.paid_amount);
    if (!paymentLines.length && paidAmount > 0) {
      paymentLines.push({
        date: String(purchase.date || "").trim(),
        account: String(purchase.payment_type || "Оплата").trim() || "Оплата",
        type: String(purchase.payment_type || "Оплата").trim() || "Оплата",
        amount: paidAmount,
        currency,
      });
    }

    paymentLinesRoot.replaceChildren();
    paymentList.hidden = paymentLines.length === 0 && purchaseEntryNumber(purchase.debt_amount) <= 0;
    paymentLines.forEach((payment, index) => {
      const row = document.createElement("tr");
      [index + 1, payment.date || "—", payment.account, payment.type].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      });
      const amountCell = document.createElement("td");
      const amount = document.createElement("strong");
      amount.textContent = moneyWithCurrency(payment.amount, payment.currency);
      amountCell.append(amount);
      row.append(amountCell);
      paymentLinesRoot.append(row);
    });
  }

  function renderPurchasePaymentSummary(panel, purchase) {
    const summary = panel.querySelector("[data-purchase-payment-summary]");
    if (!summary) return;

    const currency = String(purchase.currency || "UZS").toUpperCase();
    const total = purchaseEntryNumber(purchase.amount);
    const paid = purchaseEntryNumber(purchase.paid_amount);
    const debt = Math.max(0, purchaseEntryNumber(purchase.debt_amount));
    setText(summary, "[data-purchase-payment-total]", moneyWithCurrency(total, currency));
    setText(summary, "[data-purchase-payment-paid]", moneyWithCurrency(paid, currency));
    setText(summary, "[data-purchase-payment-debt]", moneyWithCurrency(debt, currency));
    summary.dataset.paymentState = debt > 0 ? (paid > 0 ? "partial" : "debt") : "paid";
  }

  function renderPurchaseExtraExpenses(panel, purchase) {
    const root = panel.querySelector("[data-purchase-detail-expense-lines]");
    if (!root) return;
    const currency = String(purchase.currency || "UZS").toUpperCase();
    const expenses = (Array.isArray(purchase.extra_expenses) ? purchase.extra_expenses : [])
      .filter((expense) => purchaseEntryNumber(expense?.amount || expense?.document_amount) > 0);
    root.replaceChildren();
    if (!expenses.length) return;

    const titleRow = document.createElement("tr");
    titleRow.className = "warehouse-purchase-detail-expense-head";
    const titleCell = document.createElement("td");
    titleCell.colSpan = 7;
    titleCell.textContent = "Дополнительные расходы";
    titleRow.append(titleCell);
    root.append(titleRow);

    expenses.forEach((expense, index) => {
      const expenseCurrency = String(expense.currency || currency).toUpperCase();
      const amount = expense.amount || expense.document_amount || "0";
      const documentAmount = expense.document_amount || amount;
      const row = document.createElement("tr");
      row.className = "warehouse-purchase-detail-expense-row";

      const numberCell = document.createElement("td");
      numberCell.textContent = `Р${index + 1}`;
      row.append(numberCell);

      const nameCell = document.createElement("td");
      nameCell.colSpan = 3;
      const name = document.createElement("strong");
      name.textContent = String(expense.name || "Дополнительный расход");
      nameCell.append(name);
      row.append(nameCell);

      const amountCell = document.createElement("td");
      amountCell.colSpan = 2;
      amountCell.textContent = moneyWithCurrency(amount, expenseCurrency);
      row.append(amountCell);

      const totalCell = document.createElement("td");
      const total = document.createElement("strong");
      total.textContent = moneyWithCurrency(documentAmount, currency);
      totalCell.append(total);
      row.append(totalCell);

      root.append(row);
    });
  }

  function renderDetail(panel, purchase) {
    const currency = purchase.currency || "UZS";
    const linesRoot = panel.querySelector("[data-purchase-detail-lines]");
    const lines = Array.isArray(purchase.lines) ? purchase.lines : [];
    setText(panel, "[data-purchase-detail-title]", `Закупка: ${purchase.number || "-"}`);
    setText(panel, "[data-purchase-detail-date]", purchase.date ? `${purchase.date} · ${purchase.status_label || "Заказ"}` : purchase.status_label || "Заказ");
    setText(panel, "[data-purchase-detail-supplier]", purchase.supplier || "Поставщик не указан");
    setText(panel, "[data-purchase-detail-supplier-balance]", purchase.supplier_card?.balance || "Баланс не найден");
    const supplierOpen = panel.querySelector("[data-purchase-detail-supplier-open]");
    if (supplierOpen) {
      supplierOpen.disabled = !purchase.supplier_card;
      supplierOpen.dataset.balanceKind = purchase.supplier_card?.balance_kind || "zero";
      supplierOpen.title = purchase.supplier_card ? "Открыть карточку поставщика" : "Карточка поставщика не найдена";
    }
    setText(panel, "[data-purchase-detail-warehouse]", purchase.warehouse || "Основной склад");
    setText(panel, "[data-purchase-detail-status]", purchase.status_label || "Заказ");
    setText(panel, "[data-purchase-detail-paid]", moneyWithCurrency(purchase.paid_amount, currency));
    setText(panel, "[data-purchase-detail-debt]", moneyWithCurrency(purchase.debt_amount, currency));
    setText(panel, "[data-purchase-detail-total]", moneyWithCurrency(purchase.amount, currency));
    const extraExpenseTotal = purchaseEntryNumber(purchase.extra_expense_total);
    const landedCostTotal = purchaseEntryNumber(purchase.landed_cost_total || purchase.amount);
    setText(panel, "[data-purchase-detail-extra-expenses]", moneyWithCurrency(extraExpenseTotal, currency));
    setText(panel, "[data-purchase-detail-landed-total]", moneyWithCurrency(landedCostTotal, currency));
    panel.querySelectorAll("[data-purchase-detail-cost-summary]").forEach((row) => {
      row.hidden = extraExpenseTotal <= 0;
    });
    setText(panel, "[data-purchase-detail-note]", purchase.note || "Комментарий не указан");
    const paymentPane = panel.querySelector('[data-purchase-detail-pane="payment"]');
    if (paymentPane) paymentPane.dataset.paymentState = purchaseEntryNumber(purchase.debt_amount) > 0 ? "debt" : "paid";
    renderPurchasePayments(panel, purchase);
    renderPurchasePaymentSummary(panel, purchase);
    renderPurchaseExtraExpenses(panel, purchase);
    updatePurchasePaymentButton(panel, purchase);
    setText(panel, "[data-purchase-detail-sale-price-title]", purchase.price_type_name || "Продажная цена");
    setText(
      panel,
      "[data-purchase-detail-quantity-total]",
      quantityText(lines.reduce((total, line) => total + purchaseEntryNumber(line.quantity), 0)),
    );
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
      appendCell(row, "-");
      appendCell(row, moneyWithCurrency(purchase.amount, currency));
      linesRoot.append(row);
      return;
    }
    const appendProductCell = (row, line, isService) => {
      const cell = document.createElement("td");
      cell.className = "purchase-line-product";
      // Раскладка живёт внутри ячейки: display:flex на самой td выключает её
      // из расчёта ширин таблицы, и колонка «Товар» схлопывается.
      const box = document.createElement("span");
      box.className = "purchase-line-box";

      const media = document.createElement("span");
      media.className = "purchase-line-photo";
      const photoUrl = String(line.photo_url || "").trim();
      if (photoUrl) {
        const image = document.createElement("img");
        image.src = photoUrl;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        // Битая ссылка не должна оставлять рамку с крестиком.
        image.addEventListener("error", () => {
          media.dataset.fallback = isService ? "service" : "product";
          media.removeAttribute("data-photo-zoom");
          image.remove();
        });
        media.append(image);
        // Клик по фото открывает его увеличенным.
        media.dataset.photoZoom = photoUrl;
        media.title = "Нажмите, чтобы увеличить";
      } else {
        media.dataset.fallback = isService ? "service" : "product";
      }

      const copy = document.createElement("span");
      copy.className = "purchase-line-name";
      copy.textContent = String(line.product || "Товар");
      box.append(media, copy);
      if (isService) {
        const badge = document.createElement("span");
        badge.className = "purchase-line-service-badge";
        badge.textContent = "Услуга";
        box.append(badge);
      }
      cell.append(box);
      row.append(cell);
      return cell;
    };

    lines.forEach((line, index) => {
      const row = document.createElement("tr");
      if (String(line.kind || "product") === "service") row.classList.add("is-service");
      const qty = quantityText(line.quantity);
      const price = line.price ? moneyWithCurrency(line.price, currency) : "-";
      const costPrice = line.cost_price ? moneyWithCurrency(line.cost_price, currency) : price;
      const salePrice = line.sale_price ? moneyWithCurrency(line.sale_price, purchase.price_type_currency || currency) : "-";
      const total = line.total ? moneyWithCurrency(line.total, currency) : "-";
      const isService = String(line.kind || "product") === "service";
      appendCell(row, index + 1);
      appendProductCell(row, line, isService);
      appendCell(row, qty);
      appendCell(row, price);
      appendCell(row, costPrice);
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
    panel.dataset.purchaseId = purchaseId;
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
    const menu = panel.querySelector("[data-purchase-detail-menu]");
    const menuToggle = panel.querySelector("[data-purchase-detail-menu-toggle]");
    if (menu) menu.hidden = true;
    menuToggle?.setAttribute("aria-expanded", "false");
    panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    window.setTimeout(() => {
      panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 180);
  }

  function purchaseAmountNumber(raw) {
    const match = String(raw || "").match(/-?[\d\s]+(?:[.,]\d+)?/);
    if (!match) return 0;
    return Number(match[0].replace(/\s+/g, "").replace(",", ".")) || 0;
  }

  function purchaseSortValue(row, columnIndex, kind) {
    const cell = row.cells[columnIndex];
    if (!cell) return kind === "text" ? "" : 0;
    const select = cell.querySelector("select");
    const raw = select
      ? select.options[select.selectedIndex]?.textContent || ""
      : cell.dataset.sortValue || cell.textContent || "";
    if (kind === "number") return purchaseAmountNumber(raw);
    if (kind === "date") {
      const match = String(raw).trim().match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime();
      const timestamp = Date.parse(String(raw).trim());
      return Number.isFinite(timestamp) ? timestamp : 0;
    }
    return String(raw).trim().toLocaleLowerCase("ru-RU");
  }

  function initPurchasesSort(root) {
    const table = (root || document).querySelector("#warehouse-purchases-table");
    if (!table || table.dataset.purchasesSortReady === "1") return;
    table.dataset.purchasesSortReady = "1";
    table.querySelectorAll("thead .sales-journal-sort-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const header = button.closest("th");
        const body = table.tBodies[0];
        if (!header || !body) return;
        const columnIndex = header.cellIndex;
        const kind = header.dataset.sortKind || "text";
        const direction = header.getAttribute("aria-sort") === "descending" ? "ascending" : "descending";
        const rows = Array.from(body.querySelectorAll("tr.warehouse-purchase-row"));
        rows.forEach((row, index) => {
          if (!row.dataset.purchaseOriginalIndex) row.dataset.purchaseOriginalIndex = String(index);
        });
        rows.sort((left, right) => {
          const a = purchaseSortValue(left, columnIndex, kind);
          const b = purchaseSortValue(right, columnIndex, kind);
          let result = kind === "text"
            ? String(a).localeCompare(String(b), "ru-RU", { numeric: true, sensitivity: "base" })
            : a - b;
          if (!result) result = Number(left.dataset.purchaseOriginalIndex) - Number(right.dataset.purchaseOriginalIndex);
          return direction === "ascending" ? result : -result;
        });
        table.querySelectorAll("thead th[aria-sort]").forEach((item) => {
          item.setAttribute("aria-sort", item === header ? direction : "none");
          const arrow = item.querySelector(".org-shipments-sort-arrow");
          if (arrow) arrow.textContent = item === header ? (direction === "ascending" ? "↑" : "↓") : "↕";
        });
        const totalRow = body.querySelector("tr.sales-journal-total-row");
        rows.forEach((row) => body.appendChild(row));
        if (totalRow) body.appendChild(totalRow);
      });
    });
  }

  function init(root = document) {
    initPurchaseEntry(root);
    initWarehouseAdjustment(root);
    initPurchasesSort(root);
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
    root.querySelectorAll("[data-purchase-row-pay]").forEach((button) => {
      if (button.dataset.purchaseRowPayReady === "1") return;
      button.dataset.purchaseRowPayReady = "1";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const purchaseId = button.dataset.purchaseId || "";
        openDetail(root, purchaseId);
        const panel = root.querySelector("[data-warehouse-purchase-detail]");
        if (!panel || panel.dataset.purchaseId !== purchaseId) return;
        activatePurchaseDetailTab(panel, "payment");
        openDetailPaymentDialog(root, panel);
      });
    });
    root.querySelectorAll("[data-warehouse-purchase-close]").forEach((trigger) => {
      if (trigger.dataset.warehousePurchaseCloseReady === "1") return;
      trigger.dataset.warehousePurchaseCloseReady = "1";
      trigger.addEventListener("click", () => closeDetail(root));
    });
    root.querySelectorAll("[data-purchase-status-select]").forEach((select) => {
      if (select.dataset.purchaseStatusReady === "1") return;
      select.dataset.purchaseStatusReady = "1";
      select.addEventListener("change", () => select.form?.requestSubmit());
    });
    root.querySelectorAll("[data-purchase-delete-form]").forEach((form) => {
      if (form.dataset.purchaseDeleteReady === "1") return;
      form.dataset.purchaseDeleteReady = "1";
      form.addEventListener("submit", (event) => {
        const number = form.dataset.purchaseNumber || "эту закупку";
        if (!window.confirm(`Вы точно хотите удалить закупку ${number}?`)) event.preventDefault();
      });
    });
    root.querySelectorAll("[data-warehouse-purchase-detail]").forEach((panel) => {
      if (panel.dataset.purchaseDetailTabsReady === "1") return;
      panel.dataset.purchaseDetailTabsReady = "1";
      panel.querySelectorAll("[data-purchase-detail-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          activatePurchaseDetailTab(panel, button.getAttribute("data-purchase-detail-tab"));
        });
      });
      const menu = panel.querySelector("[data-purchase-detail-menu]");
      const menuToggle = panel.querySelector("[data-purchase-detail-menu-toggle]");
      menuToggle?.addEventListener("click", () => {
        if (!menu) return;
        menu.hidden = !menu.hidden;
        menuToggle.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
      });
      panel.querySelector("[data-purchase-detail-edit]")?.addEventListener("click", () => {
        const purchaseId = panel.dataset.purchaseId || "";
        if (!purchaseId) return;
        const target = new URL("/warehouse", window.location.origin);
        target.searchParams.set("edit_purchase", purchaseId);
        target.hash = "purchase-edit";
        window.location.assign(target.toString());
      });
      panel.querySelector("[data-purchase-detail-supplier-open]")?.addEventListener("click", () => {
        const purchase = readPurchase(panel.dataset.purchaseId || "");
        if (!purchase?.supplier_card) return;
        openPurchaseSupplierCard(panel, purchase);
      });
      panel.querySelectorAll("[data-purchase-supplier-card-close]").forEach((button) => {
        button.addEventListener("click", () => {
          panel.querySelector("[data-purchase-supplier-card-dialog]")?.close();
        });
      });
      panel.querySelector("[data-purchase-supplier-card-dialog]")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      });
      panel.querySelector("[data-purchase-supplier-card-dialog]")?.addEventListener("click", (event) => {
        const tab = event.target.closest("[data-purchase-supplier-card-tab]");
        if (!tab) return;
        activateSupplierCardTab(event.currentTarget, tab.getAttribute("data-purchase-supplier-card-tab") || "info");
      });
    });
    const paymentDialog = detailPaymentDialog(root);
    if (paymentDialog && paymentDialog.dataset.detailPaymentDialogReady !== "1") {
      paymentDialog.dataset.detailPaymentDialogReady = "1";
      detailPaymentRows(paymentDialog).forEach((row) => {
        wireDetailPaymentRow(paymentDialog, row);
      });
      paymentDialog.querySelector("[data-detail-payment-add-line]")?.addEventListener("click", () => {
        const row = addDetailPaymentRow(paymentDialog);
        row?.querySelector("[data-detail-payment-amount]")?.focus();
      });
      paymentDialog.querySelectorAll("[data-detail-payment-close], [data-detail-payment-cancel]").forEach((button) => {
        button.addEventListener("click", () => closeDetailPaymentDialog(paymentDialog));
      });
      paymentDialog.querySelector("[data-purchase-detail-payment-modal-form]")?.addEventListener("submit", (event) => {
        event.preventDefault();
        updateDetailPaymentSummary(paymentDialog);
        const payments = collectDetailPayments(paymentDialog);
        const paid = detailPaymentTotal(paymentDialog);
        const due = purchaseEntryNumber(paymentDialog.dataset.paymentDue || "0");
        if (!payments.length || paid <= 0 || paid > due) return;
        const hidden = paymentDialog.querySelector("[data-detail-payment-lines]");
        if (hidden) hidden.value = JSON.stringify(payments);
        event.currentTarget.submit();
      });
    }
    root.querySelectorAll("[data-purchase-payment-pay]").forEach((button) => {
      if (button.dataset.purchasePaymentOpenReady === "1") return;
      button.dataset.purchasePaymentOpenReady = "1";
      button.addEventListener("click", () => {
        const panel = button.closest("[data-warehouse-purchase-detail]");
        openDetailPaymentDialog(root, panel);
      });
    });
    // Один раз на страницу — иначе повторная инициализация (AJAX-переключение
    // разделов закупок) множит обработчики Escape на document.
    if (document.body.dataset.warehouseEscGlobalReady !== "1") {
      document.body.dataset.warehouseEscGlobalReady = "1";
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeDetail(document);
      });
    }
    if (document.body.dataset.warehouseProductPickerGlobalReady !== "1") {
      document.body.dataset.warehouseProductPickerGlobalReady = "1";
      document.addEventListener("click", (event) => {
        const adjustmentCreateButton = event.target?.closest?.("[data-adjustment-product-create-open]");
        if (!adjustmentCreateButton) return;
        event.preventDefault();
        const row = adjustmentCreateButton.closest("[data-adjustment-row]");
        const form = adjustmentCreateButton.closest("[data-warehouse-adjustment-entry]");
        const picker = row?.querySelector("[data-adjustment-product-picker]");
        const search = row?.querySelector("[data-adjustment-product-input]");
        if (form && picker) openProductDialog(form, picker, search?.value || "");
      }, true);
      document.addEventListener("mousedown", (event) => {
        document.querySelectorAll("[data-warehouse-product-picker]").forEach((picker) => {
          if (!picker.contains(event.target)) closeProductPanel(picker);
        });
        document.querySelectorAll("[data-warehouse-supplier-picker]").forEach((picker) => {
          if (!picker.contains(event.target)) closeSupplierPanel(picker);
        });
        document.querySelectorAll("[data-purchase-expense-type-picker]").forEach((picker) => {
          if (!picker.contains(event.target)) closeExpenseTypePanel(picker);
        });
        document.querySelectorAll("[data-adjustment-product-picker]").forEach((picker) => {
          if (!picker.contains(event.target)) {
            const panel = picker.querySelector("[data-adjustment-product-panel]");
            if (panel) panel.hidden = true;
          }
        });
      });
      window.addEventListener("resize", () => {
        document.querySelectorAll("[data-warehouse-product-picker]").forEach(positionProductPanel);
        document.querySelectorAll("[data-warehouse-supplier-picker]").forEach(positionSupplierPanel);
        document.querySelectorAll("[data-purchase-expense-type-picker]").forEach(positionExpenseTypePanel);
      });
      window.addEventListener(
        "scroll",
        () => {
          document.querySelectorAll("[data-warehouse-product-picker]").forEach(positionProductPanel);
          document.querySelectorAll("[data-warehouse-supplier-picker]").forEach(positionSupplierPanel);
          document.querySelectorAll("[data-purchase-expense-type-picker]").forEach(positionExpenseTypePanel);
        },
        true
      );
    }
    highlight(root);
    const requestedPurchaseId = new URLSearchParams(window.location.search).get("purchase_id") || "";
    if (requestedPurchaseId && document.body.dataset.openedPurchaseId !== requestedPurchaseId) {
      document.body.dataset.openedPurchaseId = requestedPurchaseId;
      openDetail(root, requestedPurchaseId);
    }
  }

  // Увеличение фото товара: клик по миниатюре открывает её на весь экран.
  function openPhotoZoom(url) {
    if (!url) return;
    const overlay = document.createElement("div");
    overlay.className = "purchase-photo-zoom";
    const image = document.createElement("img");
    image.src = url;
    image.alt = "Фото товара";
    overlay.append(image);
    const close = () => overlay.remove();
    overlay.addEventListener("click", close);
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") close();
      },
      { once: true }
    );
    document.body.append(overlay);
  }

  function purchaseDoneDocument(purchaseId, number) {
    const id = String(purchaseId || "").trim();
    const byId = id ? document.getElementById(`warehouse-purchase-data-${id}`) : null;
    const nodes = byId ? [byId] : Array.from(document.querySelectorAll('script[id^="warehouse-purchase-data-"]'));
    for (const node of nodes) {
      try {
        const data = JSON.parse(node.textContent || "{}");
        if (byId || String(data.number || "").trim() === String(number || "").trim()) return data;
      } catch (error) {
        // Ignore malformed embedded JSON and keep the success dialog usable.
      }
    }
    return {};
  }

  function purchaseDoneBalanceText(doc) {
    const card = doc && doc.supplier_card ? doc.supplier_card : {};
    const balanceLines = Array.isArray(card.balance_lines) ? card.balance_lines : [];
    const parts = balanceLines
      .filter((line) => line && String(line.kind || "") !== "zero")
      .map((line) => `${line.label || "Баланс"}: ${line.amount || "0"} ${line.currency || doc.currency || "UZS"}`);
    if (parts.length) return parts.join(" · ");
    if (card.balance && card.balance !== "Нет долга") return card.balance;
    const debt = String(doc?.debt_amount || "").trim();
    if (debt && debt !== "0") return `Мы должны: ${debt} ${doc.currency || "UZS"}`;
    return "Нет долга";
  }

  function renderPurchaseDoneSummary(dialog, doc) {
    const node = dialog.querySelector("[data-purchase-done-summary]");
    if (!node) return;
    const lines = Array.isArray(doc?.lines) ? doc.lines.filter((line) => line && (line.product || line.total)) : [];
    const currency = doc?.currency || "UZS";
    const itemRows = lines
      .map((line) => {
        const quantity = quantityText(line.quantity || 0);
        const price = moneyWithCurrency(line.price || 0, currency);
        const total = moneyWithCurrency(line.total || 0, currency);
        return `<tr>
          <td>${escapeHtml(line.product || "-")}</td>
          <td class="sale-done-num">${escapeHtml(quantity)}</td>
          <td class="sale-done-num">${escapeHtml(price)}</td>
          <td class="sale-done-num"><strong>${escapeHtml(total)}</strong></td>
        </tr>`;
      })
      .join("");
    const supplier = doc?.supplier || doc?.supplier_card?.name || "";
    const balance = purchaseDoneBalanceText(doc || {});
    const amount = doc?.amount ? `${doc.amount} ${currency}` : "";
    const paid = doc?.paid_amount ? `${doc.paid_amount} ${currency}` : "";
    const debt = doc?.debt_amount ? `${doc.debt_amount} ${currency}` : "";
    node.innerHTML = `
      <section class="sale-done-section sale-done-client">
        <span>Поставщик</span>
        <table class="sale-done-table">
          <tbody>
            <tr><th>У кого</th><td>${escapeHtml(supplier || "-")}</td></tr>
            <tr><th>Баланс сейчас</th><td><strong>${escapeHtml(balance)}</strong></td></tr>
          </tbody>
        </table>
      </section>
      ${lines.length ? `<section class="sale-done-section">
        <span>Закупили</span>
        <table class="sale-done-table">
          <thead><tr><th>Товар</th><th class="sale-done-num">К-во</th><th class="sale-done-num">Цена</th><th class="sale-done-num">Сумма</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </section>` : ""}
      <section class="sale-done-section">
        <span>Итог</span>
        <table class="sale-done-table">
          <tbody>
            <tr><th>Сумма закупки</th><td class="sale-done-num"><strong>${escapeHtml(amount || "-")}</strong></td></tr>
            <tr><th>Оплачено</th><td class="sale-done-num">${escapeHtml(paid || "-")}</td></tr>
            <tr><th>Долг по закупке</th><td class="sale-done-num"><strong>${escapeHtml(debt || "-")}</strong></td></tr>
          </tbody>
        </table>
      </section>`;
  }

  function initPurchaseDoneDialog() {
    const dialog = document.querySelector("[data-purchase-done-dialog]");
    if (!dialog || dialog.dataset.purchaseDoneReady === "1") return;
    dialog.dataset.purchaseDoneReady = "1";

    const close = () => {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
    dialog.querySelector("[data-purchase-done-close]")?.addEventListener("click", close);

    const params = new URLSearchParams(window.location.search);
    const message = String(params.get("msg") || "").trim();
    const titles = {
      saved: "Закупка сохранена",
      updated: "Закупка обновлена",
      paid: "Оплата внесена",
    };
    if (!(message in titles)) return;
    const purchaseId = String(params.get("purchase_id") || "").trim();
    const paidNow = String(params.get("paid_now") || "").trim();
    const currency = String(params.get("currency") || "").trim();
    const number = String(params.get("purchase_number") || "").trim();
    const cashWarning = params.get("cash_warning") === "1";
    const doc = purchaseDoneDocument(purchaseId, number);

    const title = dialog.querySelector("[data-purchase-done-title]");
    const sum = dialog.querySelector("[data-purchase-done-sum]");
    const meta = dialog.querySelector("[data-purchase-done-meta]");
    if (title) title.textContent = titles[message];
    if (sum) sum.textContent = message === "paid" && paidNow ? `${paidNow}${currency ? " " + currency : ""}` : "";
    const metaParts = [];
    if (number) metaParts.push(`Закупка ${number}`);
    if (cashWarning) {
      metaParts.push(message === "paid" ? "Операция кассы не записалась" : "Операции кассы не записались");
    }
    if (meta) meta.textContent = metaParts.join(" · ");
    renderPurchaseDoneSummary(dialog, doc);

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    const url = new URL(window.location.href);
    url.searchParams.delete("msg");
    url.searchParams.delete("purchase_id");
    url.searchParams.delete("purchase_number");
    url.searchParams.delete("paid_now");
    url.searchParams.delete("currency");
    url.searchParams.delete("cash_warning");
    window.history.replaceState(null, "", url.toString());
  }

  document.addEventListener("click", (event) => {
    const media = event.target.closest("[data-photo-zoom]");
    if (!media) return;
    event.preventDefault();
    event.stopPropagation();
    openPhotoZoom(media.dataset.photoZoom);
  });

  // Экспорт для AJAX-переключения разделов закупок (ajax-sections.js):
  // повторно навешивает обработчики на свежую панель, идемпотентно.
  window.WarehousePurchasesInit = init;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init();
      initPurchaseDoneDialog();
    });
  } else {
    init();
    initPurchaseDoneDialog();
  }
})();
