(function () {
  var quickProductTargetCombo = null;
  var SALES_DRAFT_KEY = "upos.sales.new-sale.draft.v1";
  var SALES_DRAFT_WINDOW_PREFIX = "__UPOS_SALES_DRAFT__:";
  var SALES_DRAFT_COOKIE_PREFIX = "upos_sales_draft_";
  var SALES_DRAFT_COOKIE_CHUNK = 3400;
  var SALES_DRAFT_COOKIE_LIMIT = 20;
  var salesDraftTimer = null;

  function readOptions() {
    var node = document.getElementById("sales-form-options");
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

  function numberValue(value) {
    var raw = String(value || "").replace(/\s+/g, "").replace("%", "").replace(",", ".");
    var num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  }

  function sanitizeNumericInput(input) {
    if (!input) return;
    var value = String(input.value || "");
    var cursor = input.selectionStart;
    var normalizedBeforeCursor = typeof cursor === "number" ? value.slice(0, cursor).replace(/[^\d.,]/g, "") : "";
    var stripped = value.replace(/[^\d.,]/g, "");
    var separatorMatch = stripped.match(/[.,]/);
    var separator = separatorMatch ? separatorMatch[0] : "";
    var separatorIndex = separatorMatch ? separatorMatch.index : -1;
    var integerPart = (separatorIndex >= 0 ? stripped.slice(0, separatorIndex) : stripped).replace(/\D/g, "");
    var decimalPart = separatorIndex >= 0 ? stripped.slice(separatorIndex + 1).replace(/\D/g, "") : "";
    var formatted = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    if (separator) formatted += separator + decimalPart;
    if (formatted === value) return;
    input.value = formatted;
    if (typeof cursor === "number") {
      var target = normalizedBeforeCursor.length;
      if (!target) {
        input.setSelectionRange(0, 0);
        return;
      }
      var seen = 0;
      var nextCursor = formatted.length;
      for (var i = 0; i < formatted.length; i += 1) {
        if (/[^\s]/.test(formatted.charAt(i))) seen += 1;
        if (seen >= target) {
          nextCursor = i + 1;
          break;
        }
      }
      input.setSelectionRange(nextCursor, nextCursor);
    }
  }

  function sanitizeNumericInputs(root) {
    if (!root) return;
    root.querySelectorAll('input[inputmode="decimal"], input[name="line_quantity"], input[name="line_price"], input[name="line_discount_value"]').forEach(function (input) {
      sanitizeNumericInput(input);
    });
  }

  function formatQty(value) {
    var num = numberValue(value);
    if (!num) return "0";
    return String(num).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  function currencyFractionDigits(currency) {
    return String(currency || "").toUpperCase() === "UZS" ? 0 : 2;
  }

  function roundCurrency(value, currency) {
    var digits = currencyFractionDigits(currency);
    var factor = Math.pow(10, digits);
    var num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.round(num * factor) / factor;
  }

  function formatMoney(value, currency) {
    var num = roundCurrency(value, currency);
    if (!Number.isFinite(num) || !num) return "0";
    var maxDigits = currencyFractionDigits(currency);
    if (num > 0 && num < 0.01) maxDigits = 4;
    return num.toLocaleString("ru-RU", {
      maximumFractionDigits: maxDigits
    });
  }

  function formatPercent(value) {
    var num = Number(value);
    if (!Number.isFinite(num) || Math.abs(num) < 0.01) return "";
    return num.toLocaleString("ru-RU", {
      maximumFractionDigits: 2
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function highlight(value, query) {
    var text = String(value || "");
    var q = String(query || "").trim();
    if (!q) return escapeHtml(text);
    var lower = text.toLowerCase();
    var needle = q.toLowerCase();
    var index = lower.indexOf(needle);
    if (index < 0) return escapeHtml(text);
    return (
      escapeHtml(text.slice(0, index)) +
      '<mark class="sales-search-mark">' +
      escapeHtml(text.slice(index, index + q.length)) +
      "</mark>" +
      escapeHtml(text.slice(index + q.length))
    );
  }

  function stockTotal(product, warehouse) {
    var target = normalize(warehouse);
    return (Array.isArray(product.stocks) ? product.stocks : []).reduce(function (sum, stock) {
      if (target && normalize(stock.warehouse) !== target) return sum;
      return sum + numberValue(stock.quantity);
    }, 0);
  }

  function stockLabel(product, warehouse) {
    var total = stockTotal(product, warehouse);
    var unit = product.unit || "шт";
    return formatQty(total) + " " + unit;
  }

  function selectedPriceTypeId(root) {
    var select = root.querySelector("[data-sales-price-type]");
    return select ? select.value : "";
  }

  function selectedDocType(root) {
    var checked = root.querySelector('input[name="doc_type"]:checked');
    if (checked) return checked.value;
    var input = root.querySelector('input[name="doc_type"]');
    return input && input.value ? input.value : "sale";
  }

  function syncDocumentNumber(root, options) {
    var input = root.querySelector("[data-sales-auto-number]");
    if (!input) return;
    var numbers = options.next_numbers || {};
    input.value = numbers[selectedDocType(root)] || numbers.sale || "";
  }

  function selectedLineWarehouse(root, combo) {
    var line = combo ? combo.closest(".sales-line-grid") : null;
    var input = line
      ? line.querySelector('[data-sales-combobox="warehouse"] [data-sales-combo-input]')
      : root.querySelector('[data-sales-combobox="warehouse"] [data-sales-combo-input]');
    return input ? input.value : "";
  }

  function productPrice(product, priceTypeId) {
    var map = product.price_by_type || {};
    var entry = map[priceTypeId] || null;
    if (!entry && map && Object.keys(map).length) {
      entry = map[Object.keys(map)[0]];
    }
    return entry || { price: "", currency: "" };
  }

  function usdRate(options) {
    var fx = options.fx || {};
    var rate = numberValue(fx.USD_UZS || fx.usd_uzs || fx.usdUzs || "12000");
    return rate > 0 ? rate : 12000;
  }

  function convertPrice(value, fromCurrency, toCurrency, options) {
    var amount = numberValue(value);
    var source = String(fromCurrency || "UZS").toUpperCase();
    var target = String(toCurrency || "UZS").toUpperCase();
    var rate = usdRate(options);
    if (!amount || source === target) return amount;
    if (source === "USD" && target === "UZS") return amount * rate;
    if (source === "UZS" && target === "USD") return amount / rate;
    return amount;
  }

  function salesPrice(product, priceTypeId, targetCurrency, options) {
    var entry = productPrice(product, priceTypeId);
    var sourceCurrency = String(entry.currency || targetCurrency || "UZS").toUpperCase();
    var converted = convertPrice(entry.price, sourceCurrency, targetCurrency, options);
    return {
      basePrice: entry.price || "",
      baseCurrency: sourceCurrency,
      price: converted ? formatMoney(converted, targetCurrency) : "",
      currency: String(targetCurrency || sourceCurrency || "UZS").toUpperCase()
    };
  }

  function selectedCurrency(root) {
    var currency = root.querySelector("[data-sales-currency]");
    return currency && currency.value ? currency.value : "UZS";
  }

  function itemMatches(item, query, fields) {
    var q = normalize(query);
    if (!q) return true;
    return fields.some(function (field) {
      return normalize(item[field]).indexOf(q) >= 0;
    });
  }

  function closePanel(combo) {
    var panel = combo.querySelector("[data-sales-combo-panel]");
    if (panel) panel.hidden = true;
  }

  function positionComboPanel(combo) {
    var input = combo ? combo.querySelector("[data-sales-combo-input]") : null;
    var panel = combo ? combo.querySelector("[data-sales-combo-panel]") : null;
    if (!input || !panel || panel.hidden) return;
    var rect = input.getBoundingClientRect();
    var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    var maxWidth = panel.classList.contains("sales-combo-panel--wide") ? 672 : 544;
    var minWidth = panel.classList.contains("sales-combo-panel--wide") ? 420 : 260;
    var width = Math.min(Math.max(rect.width, minWidth), maxWidth, Math.max(260, viewportWidth - 24));
    var left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - width - 12));
    var top = rect.bottom + 4;
    var maxHeight = Math.min(288, viewportHeight - top - 12);
    if (maxHeight < 160 && rect.top > 180) {
      maxHeight = Math.min(288, rect.top - 12);
      top = Math.max(12, rect.top - maxHeight - 4);
    }
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.width = width + "px";
    panel.style.maxHeight = Math.max(160, maxHeight) + "px";
  }

  function isLocked(combo) {
    return combo && combo.classList.contains("is-locked");
  }

  function setLocked(combo, locked) {
    var input = combo.querySelector("[data-sales-combo-input]");
    var edit = combo.querySelector("[data-sales-combo-edit]");
    combo.classList.toggle("is-locked", !!locked);
    if (input) input.readOnly = !!locked;
    if (edit) edit.hidden = !locked;
    if (locked) closePanel(combo);
  }

  function commitCombo(combo, value) {
    var input = combo.querySelector("[data-sales-combo-input]");
    if (!input) return;
    input.value = value || "";
    setLocked(combo, !!input.value && /^(client|product|service)$/.test(combo.getAttribute("data-sales-combobox") || ""));
    scheduleSalesDraft(combo.closest(".sales-form"));
  }

  function clientBalanceText(item) {
    if (!item) return "";
    var lines = Array.isArray(item.balance_lines) ? item.balance_lines : [];
    if (lines.length) {
      return lines.map(function (line) {
        return String(line.amount || "0") + " " + String(line.currency || "UZS");
      }).join(" / ");
    }
    return item.balance ? String(item.balance || "0") + " UZS" : "";
  }

  function clientBalanceOptionHtml(item) {
    if (!item) return "";
    var kind = String(item.balance_kind || "zero");
    if (kind === "zero") return "";
    var text = clientBalanceText(item);
    if (!text) return "";
    var label = kind === "debt" ? "Долг" : kind === "advance" ? "Депозит" : "Баланс";
    return (
      '<span class="sales-combo-balance" data-balance-kind="' +
      escapeHtml(kind) +
      '"><span>' +
      escapeHtml(label) +
      "</span><strong>" +
      escapeHtml(text) +
      "</strong></span>"
    );
  }

  function updateClientBalance(root, client) {
    var node = root.querySelector("[data-sales-client-balance]");
    if (!node) return;
    var item = client;
    if (typeof item === "string") {
      var name = normalize(item);
      item = (readOptions().client_rows || []).find(function (row) {
        return normalize(row.name) === name;
      });
    }
    var kind = item ? String(item.balance_kind || "zero") : "zero";
    var text = item && kind !== "zero" ? clientBalanceText(item) : "";
    node.dataset.balanceKind = kind;
    node.hidden = !text;
    node.textContent = text ? String(item.balance_note || "Баланс") + ": " + text : "";
  }

  function rowProductValue(row) {
    var input = row ? row.querySelector('[data-sales-combobox="product"] [data-sales-combo-input]') : null;
    if (!input && row) input = row.querySelector('[data-sales-combobox="service"] [data-sales-combo-input]');
    return input ? input.value.trim() : "";
  }

  function syncRowState(row) {
    if (!row) return;
    row.classList.toggle("is-empty", !rowProductValue(row));
  }

  function resetCombo(combo) {
    if (!combo) return;
    var input = combo.querySelector("[data-sales-combo-input]");
    var edit = combo.querySelector("[data-sales-combo-edit]");
    combo.classList.remove("is-locked");
    if (input) {
      input.readOnly = false;
      input.value = "";
    }
    if (edit) edit.hidden = true;
    closePanel(combo);
    if (combo.getAttribute("data-sales-combobox") === "client") {
      var root = combo.closest(".sales-form");
      if (root) updateClientBalance(root, null);
    }
  }

  function lockWarehouseCombo(combo) {
    if (!combo) return;
    var input = combo.querySelector("[data-sales-combo-input]");
    var panel = combo.querySelector("[data-sales-combo-panel]");
    combo.classList.add("is-locked", "is-static");
    if (input) {
      input.readOnly = true;
      input.setAttribute("aria-readonly", "true");
    }
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }
  }

  function applyLineCurrency(row, root, options) {
    if (!row || !row.dataset.salesBasePrice) return;
    var priceInput = row.querySelector('input[name="line_price"]');
    if (!priceInput) return;
    var value = convertPrice(row.dataset.salesBasePrice, row.dataset.salesBaseCurrency || "UZS", selectedCurrency(root), options);
    priceInput.value = value ? formatMoney(value, selectedCurrency(root)) : "";
  }

  function refreshLineProductPrice(root, row, options) {
    var productName = rowProductValue(row);
    if (!productName) return;
    var product = (options.product_rows || []).find(function (item) {
      return normalize(item.name) === normalize(productName);
    });
    if (!product) {
      applyLineCurrency(row, root, options);
      return;
    }
    var price = salesPrice(product, selectedPriceTypeId(root), selectedCurrency(root), options);
    var priceInput = row.querySelector('input[name="line_price"]');
    row.dataset.salesBasePrice = price.basePrice || price.price || "";
    row.dataset.salesBaseCurrency = price.baseCurrency || price.currency || selectedCurrency(root);
    row.dataset.salesPriceTypeId = selectedPriceTypeId(root) || "";
    if (priceInput) priceInput.value = price.price || "";
  }

  function refreshAllLinePrices(root, options) {
    if (root.dataset.salesApplyingTotal !== "1") clearManualTotal(root, false);
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      refreshLineProductPrice(root, row, options);
    });
    updateTotal(root);
  }

  function setDiscountMode(row, mode) {
    var clean = mode === "markup" ? "markup" : "discount";
    var input = row ? row.querySelector("[data-sales-discount-mode]") : null;
    var button = row ? row.querySelector("[data-sales-discount-mode-button]") : null;
    if (input) input.value = clean;
    if (button) {
      button.dataset.mode = clean;
      button.textContent = clean === "markup" ? "+" : "-";
      button.title = clean === "markup" ? "Наценка" : "Скидка";
    }
  }

  function closeDiscountMenus(root, exceptMenu) {
    (root || document).querySelectorAll("[data-sales-discount-menu]").forEach(function (menu) {
      if (menu !== exceptMenu) menu.hidden = true;
    });
  }

  function wireDiscountControl(root, row) {
    var control = row ? row.querySelector("[data-sales-discount]") : null;
    if (!control || control.getAttribute("data-sales-discount-wired") === "1") return;
    control.setAttribute("data-sales-discount-wired", "1");
    var modeButton = control.querySelector("[data-sales-discount-mode-button]");
    var menu = control.querySelector("[data-sales-discount-menu]");
    var value = control.querySelector("[data-sales-discount-value]");
    var unit = control.querySelector("[data-sales-discount-unit]");
    if (modeButton && menu) {
      modeButton.addEventListener("click", function (event) {
        event.stopPropagation();
        var shouldOpen = menu.hidden;
        closeDiscountMenus(root, menu);
        menu.hidden = !shouldOpen;
      });
      menu.querySelectorAll("[data-sales-discount-pick]").forEach(function (button) {
        button.addEventListener("click", function (event) {
          event.stopPropagation();
          setDiscountMode(row, button.getAttribute("data-sales-discount-pick"));
          menu.hidden = true;
          updateTotal(root);
        });
      });
    }
    [value, unit].forEach(function (input) {
      if (!input) return;
      input.addEventListener("input", function () {
        if (input === value) sanitizeNumericInput(input);
        updateTotal(root);
      });
      input.addEventListener("change", function () {
        if (input === value) sanitizeNumericInput(input);
        updateTotal(root);
      });
    });
    setDiscountMode(row, control.querySelector("[data-sales-discount-mode]")?.value || "discount");
  }

  function wireLine(root, row, options) {
    if (!row || row.getAttribute("data-sales-line-wired") === "1") return;
    row.setAttribute("data-sales-line-wired", "1");
    row.querySelectorAll("[data-sales-combobox]").forEach(function (combo) {
      wireCombo(root, combo, options);
    });
    row.querySelectorAll('input[name="line_quantity"], input[name="line_price"], input[name="line_discount_value"]').forEach(function (input) {
      input.addEventListener("focus", function () {
        input.select();
      });
      input.addEventListener("mouseup", function (event) {
        event.preventDefault();
        input.select();
      });
      input.addEventListener("input", function () {
        sanitizeNumericInput(input);
        if (root.dataset.salesApplyingTotal !== "1") clearManualTotal(root, false);
        if (input.name === "line_price") {
          row.removeAttribute("data-sales-base-price");
          row.removeAttribute("data-sales-base-currency");
        }
        syncRowState(row);
        updateTotal(root);
      });
    });
    wireDiscountControl(root, row);
    var productInput = row.querySelector('[data-sales-combo-input]');
    if (productInput) {
      productInput.addEventListener("input", function () {
        if (root.dataset.salesApplyingTotal !== "1") clearManualTotal(root, false);
        productInput.setCustomValidity("");
        syncRowState(row);
        updateTotal(root);
      });
    }
    var removeButton = row.querySelector("[data-sales-line-remove]");
    if (removeButton) {
      removeButton.addEventListener("click", function () {
        removeLine(root, row, options);
      });
    }
    syncRowState(row);
  }

  function clearLine(row) {
    if (!row) return;
    resetCombo(row.querySelector('[data-sales-combobox="product"]'));
    resetCombo(row.querySelector('[data-sales-combobox="service"]'));
    var categoryCell = row.querySelector("[data-sales-line-category]");
    if (categoryCell) categoryCell.textContent = "";
    row.querySelectorAll('input[name="line_quantity"], input[name="line_price"], input[name="line_discount_value"]').forEach(function (input) {
      input.value = "";
      delete input.dataset.salesOriginalPrice;
    });
    setDiscountMode(row, "discount");
    var discountUnit = row.querySelector("[data-sales-discount-unit]");
    if (discountUnit) discountUnit.value = "percent";
    var discountValue = row.querySelector("[data-sales-discount-value]");
    if (discountValue) discountValue.value = "0";
    row.querySelectorAll(".sales-price-original").forEach(function (node) {
      node.remove();
    });
    row.querySelectorAll(".sales-price-cell-adjusted").forEach(function (cell) {
      cell.classList.remove("sales-price-cell-adjusted");
    });
    syncRowState(row);
  }

  function removeLine(root, row, options) {
    if (!row) return;
    if (root.dataset.salesApplyingTotal !== "1") clearManualTotal(root, false);
    var kind = row.getAttribute("data-sales-line-kind") || "product";
    var rows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="' + kind + '"]'));
    if (kind === "product" && rows.length <= 1) {
      clearLine(row);
    } else {
      row.remove();
    }
    syncServiceControls(root);
    updateTotal(root);
  }

  function cloneLine(root, sourceRow, options) {
    var row = sourceRow.cloneNode(true);
    row.removeAttribute("data-sales-line-wired");
    row.classList.remove("is-empty");
    row.querySelectorAll("[data-sales-combobox]").forEach(function (combo) {
      combo.removeAttribute("data-sales-combo-wired");
    });
    resetCombo(row.querySelector('[data-sales-combobox="product"]'));
    resetCombo(row.querySelector('[data-sales-combobox="warehouse"]'));
    var sourceWarehouse = sourceRow.querySelector('input[name="line_warehouse"]');
    var warehouse = row.querySelector('input[name="line_warehouse"]');
    if (warehouse) warehouse.value = sourceWarehouse ? sourceWarehouse.value : warehouse.defaultValue || "";
    lockWarehouseCombo(row.querySelector('[data-sales-combobox="warehouse"]'));
    row.querySelectorAll('input[name="line_quantity"], input[name="line_price"], input[name="line_discount_value"]').forEach(function (input) {
      input.value = "";
    });
    setDiscountMode(row, "discount");
    var discountUnit = row.querySelector("[data-sales-discount-unit]");
    if (discountUnit) discountUnit.value = "percent";
    var discountValue = row.querySelector("[data-sales-discount-value]");
    if (discountValue) discountValue.value = "0";
    sourceRow.parentNode.insertBefore(row, sourceRow.nextSibling);
    wireLine(root, row, options);
    return row;
  }

  function serviceRows(root) {
    return Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="service"]'));
  }

  function syncServiceControls(root) {
    if (!root) return;
    var hasServices = serviceRows(root).length > 0;
    var servicesBlock = root.querySelector("[data-sales-services-block]");
    var addServiceBtn = root.querySelector("[data-sales-add-service]");
    if (servicesBlock) servicesBlock.hidden = !hasServices;
    if (addServiceBtn) addServiceBtn.hidden = hasServices;
  }

  function ensureNextLine(root, currentRow, options) {
    if (!currentRow) return;
    var kind = rowKind(currentRow);
    var comboType = kind === "service" ? "service" : "product";
    var rows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="' + kind + '"]'));
    var currentIndex = rows.indexOf(currentRow);
    var nextBlank = rows.slice(currentIndex + 1).find(function (row) {
      return !rowProductValue(row);
    });
    if (!nextBlank) {
      nextBlank = kind === "service" ? addServiceLine(root, options) : cloneLine(root, rows[rows.length - 1] || currentRow, options);
    }
    var nextInput = nextBlank ? nextBlank.querySelector('[data-sales-combobox="' + comboType + '"] [data-sales-combo-input]') : null;
    if (nextInput) nextInput.focus();
  }

  function addServiceLine(root, options, settings) {
    var config = settings || {};
    var block = root.querySelector("[data-sales-services-block]");
    var body = root.querySelector("[data-sales-services-body]");
    var template = document.getElementById("sales-service-row-template");
    if (!body || !template || !template.content) return null;
    if (block) block.hidden = false;
    var row = template.content.firstElementChild.cloneNode(true);
    body.appendChild(row);
    wireLine(root, row, options);
    syncServiceControls(root);
    var input = row.querySelector('[data-sales-combobox="service"] [data-sales-combo-input]');
    if (input && config.focus !== false) input.focus();
    return row;
  }

  function draftStorage(name) {
    try {
      var storage = window[name];
      return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function" ? storage : null;
    } catch (_) {
      return null;
    }
  }

  function cookieValue(name) {
    try {
      var prefix = name + "=";
      var parts = String(document.cookie || "").split("; ");
      for (var i = 0; i < parts.length; i += 1) {
        if (parts[i].indexOf(prefix) === 0) return parts[i].slice(prefix.length);
      }
    } catch (_) {}
    return "";
  }

  function salesDraftCookieText() {
    var encoded = "";
    for (var i = 0; i < SALES_DRAFT_COOKIE_LIMIT; i += 1) {
      var part = cookieValue(SALES_DRAFT_COOKIE_PREFIX + i);
      if (!part) break;
      encoded += part;
    }
    if (!encoded) return null;
    try {
      return decodeURIComponent(encoded);
    } catch (_) {
      return null;
    }
  }

  function clearSalesDraftCookies() {
    try {
      for (var i = 0; i < SALES_DRAFT_COOKIE_LIMIT; i += 1) {
        document.cookie = SALES_DRAFT_COOKIE_PREFIX + i + "=; path=/; max-age=0; SameSite=Lax";
      }
    } catch (_) {}
  }

  function setSalesDraftCookieText(value) {
    try {
      clearSalesDraftCookies();
      var encoded = encodeURIComponent(value);
      for (var i = 0; i < SALES_DRAFT_COOKIE_LIMIT && encoded; i += 1) {
        var chunk = encoded.slice(0, SALES_DRAFT_COOKIE_CHUNK);
        encoded = encoded.slice(SALES_DRAFT_COOKIE_CHUNK);
        document.cookie = SALES_DRAFT_COOKIE_PREFIX + i + "=" + chunk + "; path=/; max-age=604800; SameSite=Lax";
      }
    } catch (_) {}
  }

  function salesDraftText() {
    var local = draftStorage("localStorage");
    if (local) {
      try {
        var localText = local.getItem(SALES_DRAFT_KEY);
        if (localText) return localText;
      } catch (_) {}
    }
    var session = draftStorage("sessionStorage");
    if (session) {
      try {
        var sessionText = session.getItem(SALES_DRAFT_KEY);
        if (sessionText) return sessionText;
      } catch (_) {}
    }
    var cookieText = salesDraftCookieText();
    if (cookieText) return cookieText;
    try {
      return String(window.name || "").indexOf(SALES_DRAFT_WINDOW_PREFIX) === 0 ? String(window.name).slice(SALES_DRAFT_WINDOW_PREFIX.length) : null;
    } catch (_) {
      return null;
    }
  }

  function setSalesDraftText(value) {
    var local = draftStorage("localStorage");
    if (local) {
      try {
        local.setItem(SALES_DRAFT_KEY, value);
        return;
      } catch (_) {}
    }
    var session = draftStorage("sessionStorage");
    if (session) {
      try {
        session.setItem(SALES_DRAFT_KEY, value);
        return;
      } catch (_) {}
    }
    setSalesDraftCookieText(value);
    try {
      window.name = SALES_DRAFT_WINDOW_PREFIX + value;
    } catch (_) {}
  }

  function removeSalesDraftText() {
    var local = draftStorage("localStorage");
    if (local) local.removeItem(SALES_DRAFT_KEY);
    var session = draftStorage("sessionStorage");
    if (session) session.removeItem(SALES_DRAFT_KEY);
    clearSalesDraftCookies();
    try {
      if (String(window.name || "").indexOf(SALES_DRAFT_WINDOW_PREFIX) === 0) window.name = "";
    } catch (_) {}
  }

  function lineDraft(row) {
    var combo = row.querySelector('[data-sales-combobox="product"], [data-sales-combobox="service"]');
    var input = combo ? combo.querySelector("[data-sales-combo-input]") : null;
    var warehouse = row.querySelector('input[name="line_warehouse"]');
    var quantity = row.querySelector('input[name="line_quantity"]');
    var price = row.querySelector('input[name="line_price"]');
    var discountMode = row.querySelector("[data-sales-discount-mode]");
    var discountValue = row.querySelector("[data-sales-discount-value]");
    var discountUnit = row.querySelector("[data-sales-discount-unit]");
    var category = row.querySelector("[data-sales-line-category]");
    return {
      kind: rowKind(row),
      product: input ? input.value || "" : "",
      warehouse: warehouse ? warehouse.value || "" : "",
      quantity: quantity ? quantity.value || "" : "",
      price: price ? price.value || "" : "",
      discountMode: discountMode ? discountMode.value || "discount" : "discount",
      discountValue: discountValue ? discountValue.value || "" : "",
      discountUnit: discountUnit ? discountUnit.value || "percent" : "percent",
      category: category ? category.textContent || "" : "",
      basePrice: row.dataset.salesBasePrice || "",
      baseCurrency: row.dataset.salesBaseCurrency || "",
      priceTypeId: row.dataset.salesPriceTypeId || ""
    };
  }

  function hasDraftLine(line) {
    return !!(line && (String(line.product || "").trim() || String(line.quantity || "").trim() || String(line.price || "").trim() || numberValue(line.discountValue)));
  }

  function collectSalesDraft(root) {
    return {
      number: root.querySelector('input[name="number"]')?.value || "",
      date: root.querySelector('input[name="date"]')?.value || "",
      dateTo: root.querySelector('input[name="date_to"]')?.value || "",
      client: root.querySelector('[data-sales-combobox="client"] [data-sales-combo-input]')?.value || "",
      currency: root.querySelector('select[name="currency"]')?.value || "",
      priceTypeId: root.querySelector('select[name="price_type_id"]')?.value || "",
      paidAmount: root.querySelector("[data-sales-paid-amount]")?.value || "",
      paymentType: root.querySelector("[data-sales-payment-type]")?.value || "",
      paymentLines: root.querySelector("[data-sales-payment-lines]")?.value || "",
      manualOriginalTotal: root.dataset.salesManualOriginalTotal || "",
      products: Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"]')).map(lineDraft).filter(hasDraftLine),
      services: serviceRows(root).map(lineDraft).filter(hasDraftLine)
    };
  }

  function saveSalesDraftNow(root) {
    if (!root || root.dataset.salesRestoringDraft === "1") return;
    try {
      setSalesDraftText(JSON.stringify(collectSalesDraft(root)));
    } catch (_) {}
  }

  function scheduleSalesDraft(root) {
    if (!root || root.dataset.salesRestoringDraft === "1") return;
    window.clearTimeout(salesDraftTimer);
    salesDraftTimer = window.setTimeout(function () {
      saveSalesDraftNow(root);
    }, 120);
  }

  function clearSalesDraft() {
    removeSalesDraftText();
  }

  function isSalesSavedPage() {
    try {
      return ["saved", "order_saved", "return_saved"].indexOf(new URLSearchParams(window.location.search).get("msg")) >= 0;
    } catch (_) {
      return false;
    }
  }

  function setDraftField(root, selector, value) {
    var input = root.querySelector(selector);
    if (input && value !== undefined && value !== null) input.value = value;
  }

  function applyLineDraft(root, row, line) {
    if (!row || !line) return;
    var comboType = rowKind(row) === "service" ? "service" : "product";
    var combo = row.querySelector('[data-sales-combobox="' + comboType + '"]');
    if (combo) commitCombo(combo, line.product || "");
    var warehouse = row.querySelector('input[name="line_warehouse"]');
    if (warehouse && line.warehouse !== undefined) warehouse.value = line.warehouse || warehouse.value || "";
    var quantity = row.querySelector('input[name="line_quantity"]');
    if (quantity) quantity.value = line.quantity || "";
    var price = row.querySelector('input[name="line_price"]');
    if (price) price.value = line.price || "";
    setDiscountMode(row, line.discountMode || "discount");
    var discountValue = row.querySelector("[data-sales-discount-value]");
    if (discountValue) discountValue.value = line.discountValue || "0";
    var discountUnit = row.querySelector("[data-sales-discount-unit]");
    if (discountUnit) discountUnit.value = line.discountUnit || "percent";
    var category = row.querySelector("[data-sales-line-category]");
    if (category) category.textContent = line.category || "";
    if (line.basePrice) row.dataset.salesBasePrice = line.basePrice;
    else row.removeAttribute("data-sales-base-price");
    if (line.baseCurrency) row.dataset.salesBaseCurrency = line.baseCurrency;
    else row.removeAttribute("data-sales-base-currency");
    if (line.priceTypeId) row.dataset.salesPriceTypeId = line.priceTypeId;
    else row.removeAttribute("data-sales-price-type-id");
    syncRowState(row);
  }

  function ensureBlankProductLine(root, options) {
    var rows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"]'));
    if (!rows.length || rows.some(function (row) { return !rowProductValue(row); })) return;
    cloneLine(root, rows[rows.length - 1], options);
  }

  function ensureBlankServiceLine(root, options) {
    var rows = serviceRows(root);
    if (!rows.length || rows.some(function (row) { return !rowProductValue(row); })) return;
    addServiceLine(root, options, { focus: false });
  }

  function restoreSalesDraft(root, options) {
    var draft = null;
    try {
      draft = JSON.parse(salesDraftText() || "null");
    } catch (_) {
      draft = null;
    }
    if (!draft || typeof draft !== "object") return false;
    root.dataset.salesRestoringDraft = "1";
    setDraftField(root, 'input[name="number"]', draft.number);
    setDraftField(root, 'input[name="date"]', draft.date);
    setDraftField(root, 'input[name="date_to"]', draft.dateTo);
    setDraftField(root, 'select[name="currency"]', draft.currency);
    setDraftField(root, 'select[name="price_type_id"]', draft.priceTypeId);
    setDraftField(root, "[data-sales-paid-amount]", draft.paidAmount);
    setDraftField(root, "[data-sales-payment-type]", draft.paymentType);
    setDraftField(root, "[data-sales-payment-lines]", draft.paymentLines);
    if (draft.manualOriginalTotal) root.dataset.salesManualOriginalTotal = draft.manualOriginalTotal;
    else delete root.dataset.salesManualOriginalTotal;
    var clientCombo = root.querySelector('[data-sales-combobox="client"]');
    if (clientCombo) commitCombo(clientCombo, draft.client || "");
    var productLines = (Array.isArray(draft.products) ? draft.products : []).filter(hasDraftLine);
    var productRows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"]'));
    var firstProduct = productRows[0];
    productRows.slice(1).forEach(function (row) { row.remove(); });
    if (firstProduct) clearLine(firstProduct);
    var previousProduct = firstProduct;
    productLines.forEach(function (line, index) {
      var row = index === 0 ? firstProduct : cloneLine(root, previousProduct, options);
      applyLineDraft(root, row, line);
      previousProduct = row;
    });
    ensureBlankProductLine(root, options);
    serviceRows(root).forEach(function (row) { row.remove(); });
    (Array.isArray(draft.services) ? draft.services : []).filter(hasDraftLine).forEach(function (line) {
      applyLineDraft(root, addServiceLine(root, options, { focus: false }), line);
    });
    ensureBlankServiceLine(root, options);
    syncServiceControls(root);
    var matchedClient = (options.client_rows || []).find(function (item) {
      return normalize(item.name) === normalize(draft.client);
    });
    updateClientBalance(root, matchedClient || (draft.client ? draft.client : null));
    delete root.dataset.salesRestoringDraft;
    return true;
  }

  function lineBasePrice(row) {
    var priceInput = row ? row.querySelector('input[name="line_price"]') : null;
    if (!priceInput) return 0;
    return numberValue(priceInput.dataset.salesOriginalPrice || priceInput.value);
  }

  function lineQuantity(row, fallbackWhenSelected) {
    var product = rowProductValue(row);
    if (!product) return 0;
    var quantityInput = row.querySelector('input[name="line_quantity"]');
    var raw = quantityInput ? String(quantityInput.value || "").trim() : "";
    if (!raw) return fallbackWhenSelected ? 1 : 0;
    return numberValue(raw);
  }

  function rowsQuantity(root) {
    var quantity = 0;
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      quantity += lineQuantity(row, true);
    });
    return quantity;
  }

  function rowKind(row) {
    return row && row.getAttribute("data-sales-line-kind") === "service" ? "service" : "product";
  }

  function rowsQuantityByKind(root, kind) {
    var quantity = 0;
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      if (kind && rowKind(row) !== kind) return;
      quantity += lineQuantity(row, true);
    });
    return quantity;
  }

  function lineDiscountValue(row, subtotal) {
    var valueInput = row ? row.querySelector("[data-sales-discount-value]") : null;
    var unit = row ? row.querySelector("[data-sales-discount-unit]") : null;
    var mode = row ? row.querySelector("[data-sales-discount-mode]") : null;
    var value = numberValue(valueInput ? valueInput.value : "");
    if (!value || !subtotal) return 0;
    var amount = unit && unit.value === "amount" ? value : subtotal * value / 100;
    if (mode && mode.value === "markup") return amount;
    return -Math.min(amount, subtotal);
  }

  function lineRawTotal(row, useOriginal) {
    if (!rowProductValue(row)) return 0;
    var priceInput = row.querySelector('input[name="line_price"]');
    var price = useOriginal ? lineBasePrice(row) : numberValue(priceInput ? priceInput.value : "");
    var quantity = lineQuantity(row, false);
    if (!quantity && price) quantity = 1;
    return quantity * price;
  }

  function rowsTotal(root, useOriginal, kind) {
    var total = 0;
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      if (kind && rowKind(row) !== kind) return;
      total += lineTotalValue(row, useOriginal);
    });
    return total;
  }

  function lineTotalValue(row, useOriginal) {
    var subtotal = lineRawTotal(row, useOriginal);
    if (!subtotal) return 0;
    return Math.max(0, subtotal + lineDiscountValue(row, subtotal));
  }

  function updateLineTotals(root) {
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      var cell = row.querySelector("[data-sales-line-total]");
      if (!cell) return;
      var total = lineTotalValue(row, false);
      cell.textContent = total ? formatMoney(total, selectedCurrency(root)) : "";
    });
  }

  function discountLabel(originalTotal, currentTotal) {
    if (!originalTotal || originalTotal <= 0) return "";
    var percent = ((originalTotal - currentTotal) / originalTotal) * 100;
    if (Math.abs(percent) < 0.01) return "";
    var label = Math.abs(percent).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    return percent >= 0 ? "Скидка " + label + "%" : "Наценка " + label + "%";
  }

  function updateDiscountBadge(root, total) {
    var badge = root.querySelector("[data-sales-total-discount]");
    if (!badge) return;
    var originalTotal = numberValue(root.dataset.salesManualOriginalTotal || "");
    var label = discountLabel(originalTotal, total);
    badge.textContent = label;
    badge.hidden = !label;
  }

  function updateTotal(root) {
    updateLineTotals(root);
    var total = rowsTotal(root, false);
    var productsTotal = rowsTotal(root, false, "product");
    var servicesTotal = rowsTotal(root, false, "service");
    var productsQuantity = rowsQuantityByKind(root, "product");
    var servicesQuantity = rowsQuantityByKind(root, "service");
    var productsQuantityOutput = root.querySelector("[data-sales-products-quantity]");
    var servicesQuantityOutput = root.querySelector("[data-sales-services-quantity]");
    var productsTotalOutput = root.querySelector("[data-sales-products-total]");
    var servicesTotalOutput = root.querySelector("[data-sales-services-total]");
    if (productsQuantityOutput) productsQuantityOutput.textContent = productsQuantity.toLocaleString("ru-RU");
    if (servicesQuantityOutput) servicesQuantityOutput.textContent = servicesQuantity.toLocaleString("ru-RU");
    if (productsTotalOutput) productsTotalOutput.textContent = formatMoney(productsTotal, selectedCurrency(root)) + " " + selectedCurrency(root);
    if (servicesTotalOutput) servicesTotalOutput.textContent = formatMoney(servicesTotal, selectedCurrency(root)) + " " + selectedCurrency(root);
    var quantityOutput = root.querySelector("[data-sales-lines-quantity]");
    if (quantityOutput) quantityOutput.textContent = rowsQuantity(root).toLocaleString("ru-RU");
    var output = root.querySelector("[data-sales-lines-total]");
    if (output) output.textContent = formatMoney(total, selectedCurrency(root)) + " " + selectedCurrency(root);
    updateDiscountBadge(root, total);
    updatePaymentBreakdown(root);
    scheduleSalesDraft(root);
  }

  function renderAdjustedPrice(input, originalPrice) {
    if (!input) return;
    var cell = input.closest("td");
    if (!cell) return;
    var old = cell.querySelector(".sales-price-original");
    if (!old) {
      old = document.createElement("span");
      old.className = "sales-price-original";
      cell.insertBefore(old, input);
    }
    old.textContent = formatMoney(originalPrice, selectedCurrency(input.closest(".sales-form"))) + " " + selectedCurrency(input.closest(".sales-form"));
    cell.classList.add("sales-price-cell-adjusted");
  }

  function clearManualTotal(root, restoreOriginals) {
    root.querySelectorAll('input[name="line_price"]').forEach(function (input) {
      if (restoreOriginals && input.dataset.salesOriginalPrice) {
        input.value = formatMoney(numberValue(input.dataset.salesOriginalPrice), selectedCurrency(root));
      }
      delete input.dataset.salesOriginalPrice;
      var cell = input.closest("td");
      if (cell) {
        var old = cell.querySelector(".sales-price-original");
        if (old) old.remove();
        cell.classList.remove("sales-price-cell-adjusted");
      }
    });
    delete root.dataset.salesManualOriginalTotal;
    var badge = root.querySelector("[data-sales-total-discount]");
    if (badge) {
      badge.hidden = true;
      badge.textContent = "";
    }
    updateTotal(root);
  }

  function applyManualTotal(root, manualTotal, kind) {
    var targetKind = kind === "product" || kind === "service" ? kind : "";
    var originalTotal = rowsTotal(root, true, targetKind);
    if (!originalTotal || originalTotal <= 0) return false;
    var currency = selectedCurrency(root);
    var targetTotal = roundCurrency(manualTotal, currency);
    var factor = targetTotal / originalTotal;
    var items = [];
    root.dataset.salesApplyingTotal = "1";
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      if (targetKind && rowKind(row) !== targetKind) return;
      if (!rowProductValue(row)) return;
      var priceInput = row.querySelector('input[name="line_price"]');
      if (!priceInput) return;
      var originalPrice = lineBasePrice(row);
      if (!originalPrice) return;
      var quantity = lineQuantity(row, false);
      if (!quantity) quantity = 1;
      var newPrice = roundCurrency(originalPrice * factor, currency);
      items.push({
        input: priceInput,
        originalPrice: originalPrice,
        quantity: quantity,
        price: newPrice
      });
    });
    var roundedTotal = items.reduce(function (sum, item) {
      return sum + roundCurrency(item.price * item.quantity, currency);
    }, 0);
    var diff = roundCurrency(targetTotal - roundedTotal, currency);
    if (diff && items.length) {
      var adjustable = items.find(function (item) {
        return item.quantity === 1;
      }) || items[items.length - 1];
      if (currencyFractionDigits(currency) === 0 && Math.abs(diff) < Math.abs(adjustable.quantity) && adjustable.quantity !== 1) {
        adjustable.price = roundCurrency(adjustable.price + (diff > 0 ? 1 : -1), currency);
      } else {
        var step = roundCurrency(diff / adjustable.quantity, currency);
        if (step) adjustable.price = roundCurrency(adjustable.price + step, currency);
      }
    }
    items.forEach(function (item) {
      item.input.dataset.salesOriginalPrice = String(item.originalPrice);
      item.input.value = formatMoney(item.price, currency);
      renderAdjustedPrice(item.input, item.originalPrice);
    });
    if (!root.dataset.salesManualOriginalTotal) root.dataset.salesManualOriginalTotal = String(rowsTotal(root, true));
    delete root.dataset.salesApplyingTotal;
    updateTotal(root);
    return true;
  }

  function totalFromPercent(root, percent, kind) {
    var targetKind = kind === "product" || kind === "service" ? kind : "";
    var originalTotal = rowsTotal(root, true, targetKind);
    if (!originalTotal || originalTotal <= 0) return 0;
    return roundCurrency(originalTotal * (1 - percent / 100), selectedCurrency(root));
  }

  function percentFromTotal(root, total, kind) {
    var targetKind = kind === "product" || kind === "service" ? kind : "";
    var originalTotal = rowsTotal(root, true, targetKind);
    if (!originalTotal || originalTotal <= 0) return 0;
    return ((originalTotal - total) / originalTotal) * 100;
  }

  function productKind(item) {
    return String(item.kind || "product").toLowerCase() === "service" ? "service" : "product";
  }

  function selectedLineNames(root, comboType, currentLine) {
    return Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="' + comboType + '"]'))
      .filter(function (row) {
        return row !== currentLine;
      })
      .map(function (row) {
        return normalize(rowProductValue(row));
      })
      .filter(Boolean);
  }

  function duplicateProductInput(root) {
    var seen = Object.create(null);
    var duplicate = null;
    root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"] [data-sales-combobox="product"] [data-sales-combo-input]').forEach(function (input) {
      if (duplicate) return;
      var key = normalize(input.value);
      if (!key) return;
      if (seen[key]) duplicate = input;
      seen[key] = true;
    });
    return duplicate;
  }

  function upsertProductOption(options, product) {
    if (!product || !product.name) return;
    options.product_rows = options.product_rows || [];
    var productId = String(product.id || "");
    var productName = normalize(product.name);
    var index = options.product_rows.findIndex(function (item) {
      return (productId && String(item.id || "") === productId) || normalize(item.name) === productName;
    });
    if (index >= 0) {
      options.product_rows[index] = product;
    } else {
      options.product_rows.push(product);
    }
    options.product_rows.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), "ru");
    });
  }

  function firstAvailableCombo(root, kind, options) {
    var comboType = kind === "service" ? "service" : "product";
    var selector = '.sales-line-grid[data-sales-line-kind="' + comboType + '"]';
    var row = Array.from(root.querySelectorAll(selector)).find(function (item) {
      return !rowProductValue(item);
    });
    if (!row && comboType === "service") row = addServiceLine(root, options);
    if (!row && comboType === "product") {
      var rows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"]'));
      row = rows.length ? cloneLine(root, rows[rows.length - 1], options) : null;
    }
    return row ? row.querySelector('[data-sales-combobox="' + comboType + '"]') : null;
  }

  function applyProductSelection(root, combo, options, item) {
    if (!combo || !item) return;
    if (root.dataset.salesApplyingTotal !== "1") clearManualTotal(root, false);
    var comboType = combo.getAttribute("data-sales-combobox") === "service" ? "service" : "product";
    var line = combo.closest(".sales-line-grid");
    if (selectedLineNames(root, comboType, line).indexOf(normalize(item.name)) !== -1) {
      closePanel(combo);
      return;
    }
    var price = salesPrice(item, selectedPriceTypeId(root), selectedCurrency(root), options);
    commitCombo(combo, item.name || "");
    if (line && price.price) {
      line.dataset.salesBasePrice = price.basePrice || price.price;
      line.dataset.salesBaseCurrency = price.baseCurrency || price.currency || selectedCurrency(root);
      line.dataset.salesPriceTypeId = selectedPriceTypeId(root) || "";
      var priceInput = line.querySelector('input[name="line_price"]');
      if (priceInput) priceInput.value = price.price;
    }
    if (line) {
      var categoryCell = line.querySelector("[data-sales-line-category]");
      if (categoryCell) categoryCell.textContent = item.category || "Без категории";
      var quantityInput = line.querySelector('input[name="line_quantity"]');
      if (quantityInput && !quantityInput.value.trim()) quantityInput.value = "1";
      syncRowState(line);
      updateTotal(root);
      if (comboType === "product" || comboType === "service") ensureNextLine(root, line, options);
    }
    closePanel(combo);
  }

  function buttonHtml(main, metaLeft, metaRight, query) {
    return (
      '<button type="button" class="sales-combo-option">' +
      '<span class="sales-combo-main">' +
      highlight(main, query) +
      "</span>" +
      '<span class="sales-combo-meta">' +
      '<span>' +
      escapeHtml(metaLeft || "") +
      "</span>" +
      '<strong>' +
      escapeHtml(metaRight || "") +
      "</strong>" +
      "</span>" +
      "</button>"
    );
  }

  function renderClient(combo, options, query) {
    var panel = combo.querySelector("[data-sales-combo-panel]");
    var rows = (options.client_rows || []).filter(function (item) {
      return itemMatches(item, query, ["name", "phone", "tax_id"]);
    }).slice(0, 80);
    panel.innerHTML = rows.length
      ? rows.map(function (item, index) {
          return buttonHtml(item.name, item.phone || item.tax_id || "Клиент", item.tax_id || "", query).replace(
            "</button>",
            clientBalanceOptionHtml(item) + "</button>"
          ).replace(
            'class="sales-combo-option"',
            'class="sales-combo-option" data-index="' + index + '"'
          );
        }).join("")
      : '<div class="sales-combo-empty">Ничего не найдено</div>';
    panel.hidden = false;
    positionComboPanel(combo);
    panel.querySelectorAll("button").forEach(function (button, index) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        var item = rows[index];
        commitCombo(combo, item.name || "");
        var root = combo.closest(".sales-form");
        if (root) updateClientBalance(root, item);
        closePanel(combo);
      });
    });
  }

  function renderProduct(root, combo, options, query) {
    var panel = combo.querySelector("[data-sales-combo-panel]");
    var warehouse = selectedLineWarehouse(root, combo);
    var priceTypeId = selectedPriceTypeId(root);
    var currency = selectedCurrency(root);
    var comboType = combo.getAttribute("data-sales-combobox") === "service" ? "service" : "product";
    var line = combo.closest(".sales-line-grid");
    var selectedNames = selectedLineNames(root, comboType, line);
    var rows = (options.product_rows || []).filter(function (item) {
      var itemName = normalize(item.name);
      return (
        productKind(item) === comboType &&
        selectedNames.indexOf(itemName) === -1 &&
        itemMatches(item, query, ["name", "sku", "barcode"])
      );
    }).slice(0, 100);
    var createLabel = comboType === "service" ? "Создать услугу" : "Создать товар";
    panel.innerHTML =
      '<button type="button" class="sales-combo-create" data-sales-combo-create>+ ' +
      escapeHtml(createLabel) +
      "</button>" +
      (rows.length
      ? rows.map(function (item) {
          var price = salesPrice(item, priceTypeId, currency, options);
          var code = item.sku || item.barcode || (comboType === "service" ? "Услуга" : "Товар");
          var meta = comboType === "service" ? (item.category || "Услуга") : code + " · " + stockLabel(item, warehouse);
          var priceLabel = price.price ? price.price + " " + (price.currency || "") : "Без цены";
          return buttonHtml(item.name, meta, priceLabel, query);
        }).join("")
      : '<div class="sales-combo-empty">Ничего не найдено</div>');
    panel.hidden = false;
    positionComboPanel(combo);
    var createButton = panel.querySelector("[data-sales-combo-create]");
    if (createButton) {
      createButton.addEventListener("mousedown", function (event) {
        event.preventDefault();
        openQuickProductDialog(root, comboType, query, combo, options);
      });
    }
    panel.querySelectorAll(".sales-combo-option").forEach(function (button, index) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        var item = rows[index];
        applyProductSelection(root, combo, options, item);
      });
    });
  }

  function renderWarehouse(root, combo, options, query) {
    var panel = combo.querySelector("[data-sales-combo-panel]");
    var warehouses = options.warehouse_rows || [];
    var products = options.product_rows || [];
    var rows = warehouses.filter(function (item) {
      return itemMatches(item, query, ["name", "manager", "note"]);
    });
    panel.innerHTML = rows.length
      ? rows.map(function (item) {
          var count = products.reduce(function (sum, product) {
            return sum + (stockTotal(product, item.name) > 0 ? 1 : 0);
          }, 0);
          return buttonHtml(item.name, "", count + " товаров", query);
        }).join("")
      : '<div class="sales-combo-empty">Ничего не найдено</div>';
    panel.hidden = false;
    positionComboPanel(combo);
    panel.querySelectorAll("button").forEach(function (button, index) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        var item = rows[index];
        var input = combo.querySelector("[data-sales-combo-input]");
        input.value = item.name || "";
        updateTotal(root);
        closePanel(combo);
      });
    });
  }

  function wireCombo(root, combo, options) {
    var input = combo.querySelector("[data-sales-combo-input]");
    if (!input) return;
    if (combo.getAttribute("data-sales-combo-wired") === "1") return;
    combo.setAttribute("data-sales-combo-wired", "1");
    var type = combo.getAttribute("data-sales-combobox");
    if (type === "warehouse") {
      lockWarehouseCombo(combo);
      return;
    }
    var render = function () {
      if (isLocked(combo)) {
        closePanel(combo);
        return;
      }
      if (type === "client") renderClient(combo, options, input.value);
      if (type === "product" || type === "service") renderProduct(root, combo, options, input.value);
      if (type === "warehouse") renderWarehouse(root, combo, options, "");
    };
    var edit = combo.querySelector("[data-sales-combo-edit]");
    if (edit) {
      edit.addEventListener("mousedown", function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      edit.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        setLocked(combo, false);
        if (type === "client") updateClientBalance(root, null);
        input.focus();
        input.select();
        render();
      });
    }
    input.addEventListener("input", render);
    if (type === "client") {
      input.addEventListener("input", function () {
        updateClientBalance(root, input.value);
      });
    }
    input.addEventListener("focus", render);
    input.addEventListener("click", render);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closePanel(combo);
    });
  }

  function setQuickProductStatus(form, message, variant) {
    var status = form ? form.querySelector("[data-sales-product-status]") : null;
    if (!status) return;
    status.textContent = message || "";
    status.dataset.variant = variant || "";
  }

  function closeQuickProductDialog(root) {
    var dialog = root.parentElement ? root.parentElement.querySelector("[data-sales-product-dialog]") : null;
    if (!dialog) dialog = document.querySelector("[data-sales-product-dialog]");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
    quickProductTargetCombo = null;
  }

  function openQuickProductDialog(root, kind, query, combo, options) {
    var dialog = root.parentElement ? root.parentElement.querySelector("[data-sales-product-dialog]") : null;
    if (!dialog) dialog = document.querySelector("[data-sales-product-dialog]");
    var form = dialog ? dialog.querySelector("[data-sales-product-form]") : null;
    if (!dialog || !form) return;
    var cleanKind = kind === "service" ? "service" : "product";
    quickProductTargetCombo = combo || null;
    form.reset();
    form.querySelector("[data-sales-product-kind]").value = cleanKind;
    var title = form.querySelector("[data-sales-product-dialog-title]");
    var sub = form.querySelector("[data-sales-product-dialog-sub]");
    var nameInput = form.querySelector("[data-sales-product-name]");
    var unitInput = form.querySelector("[data-sales-product-unit]");
    var priceInput = form.querySelector("[data-sales-product-price]");
    var currencyInput = form.querySelector("[data-sales-product-currency]");
    var warehouseInput = form.querySelector("[data-sales-product-warehouse]");
    if (title) title.textContent = cleanKind === "service" ? "Создание услуги" : "Создание товара";
    if (sub) sub.textContent = cleanKind === "service" ? "Услуга сразу появится в выборе услуг." : "Товар сразу появится в выборе позиций.";
    if (nameInput) nameInput.value = query || "";
    if (unitInput) unitInput.value = cleanKind === "service" ? "Услуга" : "Штука";
    if (priceInput) priceInput.value = "";
    if (currencyInput) currencyInput.value = selectedCurrency(root);
    if (warehouseInput) warehouseInput.value = selectedLineWarehouse(root, combo) || warehouseInput.defaultValue || "Основной склад";
    form.querySelectorAll("[data-sales-product-stock-field]").forEach(function (field) {
      field.hidden = cleanKind === "service";
    });
    setQuickProductStatus(form, "", "");
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
    setTimeout(function () {
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
      }
    }, 0);
  }

  function quickProductTarget(root, kind, options) {
    if (quickProductTargetCombo && document.contains(quickProductTargetCombo)) return quickProductTargetCombo;
    return firstAvailableCombo(root, kind, options);
  }

  function wireQuickProductDialog(root, options) {
    var dialog = root.parentElement ? root.parentElement.querySelector("[data-sales-product-dialog]") : null;
    if (!dialog) dialog = document.querySelector("[data-sales-product-dialog]");
    var form = dialog ? dialog.querySelector("[data-sales-product-form]") : null;
    if (!dialog || !form || dialog.getAttribute("data-sales-product-dialog-wired") === "1") return;
    dialog.setAttribute("data-sales-product-dialog-wired", "1");
    dialog.querySelectorAll("[data-sales-product-dialog-close], [data-sales-product-dialog-cancel]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeQuickProductDialog(root);
      });
    });
    var createProduct = root.querySelector("[data-sales-create-product]");
    if (createProduct) {
      createProduct.addEventListener("click", function () {
        openQuickProductDialog(root, "product", "", null, options);
      });
    }
    form.querySelectorAll('input[inputmode="decimal"]').forEach(function (input) {
      input.addEventListener("input", function () {
        sanitizeNumericInput(input);
      });
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      sanitizeNumericInputs(form);
      var submit = form.querySelector("[data-sales-product-submit]");
      var endpoint = root.getAttribute("data-sales-product-quick-save-url") || "/sales/products/quick-save";
      var kindInput = form.querySelector("[data-sales-product-kind]");
      var kind = kindInput && kindInput.value === "service" ? "service" : "product";
      setQuickProductStatus(form, "Сохраняю...", "");
      if (submit) submit.disabled = true;
      fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" }
      })
        .then(function (response) {
          return response.json().catch(function () {
            return {};
          }).then(function (body) {
            if (!response.ok || !body.product) throw new Error(body.error || "Не удалось сохранить");
            return body.product;
          });
        })
        .then(function (product) {
          upsertProductOption(options, product);
          var combo = quickProductTarget(root, kind, options);
          if (combo) applyProductSelection(root, combo, options, product);
          setQuickProductStatus(form, "Сохранено", "ok");
          closeQuickProductDialog(root);
        })
        .catch(function (error) {
          setQuickProductStatus(form, error.message || "Не удалось сохранить", "err");
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  }

  function openTotalDialog(root, kind) {
    var dialog = root.parentElement ? root.parentElement.querySelector("[data-sales-total-dialog]") : null;
    if (!dialog) dialog = document.querySelector("[data-sales-total-dialog]");
    var input = dialog ? dialog.querySelector("[data-sales-total-input]") : null;
    var percentInput = dialog ? dialog.querySelector("[data-sales-total-percent]") : null;
    if (!dialog || !input) return;
    var targetKind = kind === "product" || kind === "service" ? kind : "";
    dialog.dataset.salesTotalKind = targetKind;
    input.value = formatMoney(rowsTotal(root, false, targetKind), selectedCurrency(root));
    if (percentInput) {
      var percent = percentFromTotal(root, rowsTotal(root, false, targetKind), targetKind);
      percentInput.value = formatPercent(percent);
    }
    var status = dialog.querySelector("[data-sales-total-status]");
    if (status) {
      status.textContent = "";
      status.dataset.variant = "";
    }
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
    setTimeout(function () {
      input.focus();
      input.select();
    }, 0);
  }

  function closeTotalDialog(root) {
    var dialog = root.parentElement ? root.parentElement.querySelector("[data-sales-total-dialog]") : null;
    if (!dialog) dialog = document.querySelector("[data-sales-total-dialog]");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
  }

  function wireTotalDialog(root) {
    var trigger = root.querySelector("[data-sales-total-trigger]");
    var kindTriggers = Array.from(root.querySelectorAll("[data-sales-total-trigger-kind]"));
    var dialog = root.parentElement ? root.parentElement.querySelector("[data-sales-total-dialog]") : null;
    if (!dialog) dialog = document.querySelector("[data-sales-total-dialog]");
    var form = dialog ? dialog.querySelector("[data-sales-total-form]") : null;
    if (!trigger || !dialog || !form || dialog.getAttribute("data-sales-total-wired") === "1") return;
    dialog.setAttribute("data-sales-total-wired", "1");
    function wireTotalTrigger(node, kind) {
      node.addEventListener("click", function () {
        openTotalDialog(root, kind);
      });
      node.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openTotalDialog(root, kind);
        }
      });
    }
    wireTotalTrigger(trigger, "");
    kindTriggers.forEach(function (node) {
      wireTotalTrigger(node, node.getAttribute("data-sales-total-trigger-kind") || "");
    });
    dialog.querySelectorAll("[data-sales-total-close], [data-sales-total-cancel]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeTotalDialog(root);
      });
    });
    var reset = dialog.querySelector("[data-sales-total-reset]");
    if (reset) {
      reset.addEventListener("click", function () {
        clearManualTotal(root, true);
        closeTotalDialog(root);
      });
    }
    var totalInput = form.querySelector("[data-sales-total-input]");
    var percentInput = form.querySelector("[data-sales-total-percent]");
    if (totalInput && percentInput) {
      totalInput.addEventListener("input", function () {
        sanitizeNumericInput(totalInput);
        var kind = dialog.dataset.salesTotalKind || "";
        var value = numberValue(totalInput.value);
        percentInput.value = value ? formatPercent(percentFromTotal(root, value, kind)) : "";
      });
      percentInput.addEventListener("input", function () {
        sanitizeNumericInput(percentInput);
        var kind = dialog.dataset.salesTotalKind || "";
        var percent = numberValue(percentInput.value);
        var value = totalFromPercent(root, percent, kind);
        totalInput.value = value ? formatMoney(value, selectedCurrency(root)) : "";
      });
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      sanitizeNumericInputs(form);
      var input = form.querySelector("[data-sales-total-input]");
      var percent = form.querySelector("[data-sales-total-percent]");
      var status = form.querySelector("[data-sales-total-status]");
      var kind = dialog.dataset.salesTotalKind || "";
      var value = numberValue(input ? input.value : "");
      if ((!value || value < 0) && percent && percent.value.trim()) {
        value = totalFromPercent(root, numberValue(percent.value), kind);
      }
      value = roundCurrency(value, selectedCurrency(root));
      if (!value || value < 0) {
        if (status) {
          status.textContent = "Введите сумму или процент";
          status.dataset.variant = "err";
        }
        return;
      }
      if (!applyManualTotal(root, value, kind)) {
        if (status) {
          status.textContent = "Сначала выберите товары и цены";
          status.dataset.variant = "err";
        }
        return;
      }
      closeTotalDialog(root);
    });
  }

  function paymentDialog(root) {
    return root.parentElement ? root.parentElement.querySelector("[data-sales-payment-dialog]") : document.querySelector("[data-sales-payment-dialog]");
  }

  function paymentLineTemplate(dialog) {
    return dialog ? dialog.querySelector("[data-sales-payment-line]") : null;
  }

  function paymentRows(root) {
    var dialog = paymentDialog(root);
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll("[data-sales-payment-line]"));
  }

  function paymentAmount(row) {
    return numberValue(row ? row.querySelector("[data-sales-payment-amount]")?.value : "");
  }

  function paymentCurrency(row, root) {
    var select = row ? row.querySelector("[data-sales-payment-currency]") : null;
    return String((select && select.value) || (root ? selectedCurrency(root) : "UZS") || "UZS").toUpperCase();
  }

  function paymentTotalInCurrency(root, targetCurrency) {
    var options = readOptions();
    var target = String(targetCurrency || selectedCurrency(root) || "UZS").toUpperCase();
    return collectPayments(root).reduce(function (sum, item) {
      return sum + convertPrice(item.amount, item.currency || target, target, options);
    }, 0);
  }

  function convertPaymentLineCurrency(root, row, nextCurrency) {
    if (!row) return;
    var amountInput = row.querySelector("[data-sales-payment-amount]");
    var target = String(nextCurrency || paymentCurrency(row, root)).toUpperCase();
    var previous = String(row.dataset.salesPaymentCurrency || selectedCurrency(root) || target).toUpperCase();
    if (amountInput) {
      var amount = numberValue(amountInput.value);
      if (amount && previous !== target) {
        amountInput.value = formatMoney(convertPrice(amount, previous, target, readOptions()), target);
      } else if (amount) {
        amountInput.value = formatMoney(amount, target);
      }
    }
    row.dataset.salesPaymentCurrency = target;
  }

  function selectedPaymentLabel(select) {
    if (!select) return "";
    var option = select.selectedOptions ? select.selectedOptions[0] : null;
    return option ? option.getAttribute("data-label") || option.textContent.trim() || select.value : select.value || "";
  }

  function setPaymentSelect(select, wanted) {
    if (!select || !wanted) return;
    select.value = wanted;
    if (select.value === wanted) return;
    var wantedText = String(wanted).trim();
    Array.from(select.options || []).some(function (option) {
      var label = option.getAttribute("data-label") || option.textContent.trim();
      if (label !== wantedText) return false;
      select.value = option.value;
      return true;
    });
  }

  function collectPayments(root) {
    var payments = [];
    paymentRows(root).forEach(function (row) {
      var amountInput = row.querySelector("[data-sales-payment-amount]");
      if (amountInput) sanitizeNumericInput(amountInput);
      var amount = paymentAmount(row);
      if (!amount) return;
      var account = row.querySelector("[data-sales-payment-account]");
      var currency = row.querySelector("[data-sales-payment-currency]");
      var paymentCurrency = currency ? String(currency.value || "").toUpperCase() : selectedCurrency(root);
      payments.push({
        account_id: account ? account.value : "",
        account: selectedPaymentLabel(account),
        currency: paymentCurrency || selectedCurrency(root),
        type: selectedPaymentLabel(account),
        amount: String(amount)
      });
    });
    return payments;
  }

  function paymentTotal(root) {
    return collectPayments(root).reduce(function (sum, item) {
      return sum + numberValue(item.amount);
    }, 0);
  }

  function updatePaymentSummary(root) {
    var dialog = paymentDialog(root);
    var summary = dialog ? dialog.querySelector("[data-sales-payment-summary]") : null;
    if (!summary) return;
    var currency = selectedCurrency(root);
    var due = rowsTotal(root, false);
    var paid = paymentTotalInCurrency(root, currency);
    var rest = Math.max(0, due - paid);
    var overpaid = Math.max(0, paid - due);
    var dueNode = dialog.querySelector("[data-sales-payment-due]");
    var paidNode = dialog.querySelector("[data-sales-payment-paid]");
    var restNode = dialog.querySelector("[data-sales-payment-rest]");
    var overRow = dialog.querySelector("[data-sales-payment-over-row]");
    var overNode = dialog.querySelector("[data-sales-payment-over]");
    var submit = dialog.querySelector("[data-sales-payment-submit]");
    if (dueNode && paidNode && restNode) {
      dueNode.textContent = formatMoney(due, currency) + " " + currency;
      paidNode.textContent = formatMoney(paid, currency) + " " + currency;
      restNode.textContent = formatMoney(rest, currency) + " " + currency;
      if (overNode) overNode.textContent = formatMoney(overpaid, currency) + " " + currency;
      if (overRow) overRow.hidden = overpaid <= 0;
      summary.classList.toggle("is-overpaid", overpaid > 0);
      if (submit) {
        submit.disabled = overpaid > 0;
        submit.title = overpaid > 0 ? "Оплата больше суммы на " + formatMoney(overpaid, currency) + " " + currency : "";
      }
      return;
    }
    summary.textContent = "Оплата: " + formatMoney(paid, currency) + " " + currency;
  }

  function parsePaymentLines(root) {
    var input = root.querySelector("[data-sales-payment-lines]");
    if (!input || !input.value) return [];
    try {
      var parsed = JSON.parse(input.value);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (item) {
        return item && numberValue(item.amount);
      });
    } catch (_) {
      return [];
    }
  }

  function updatePaymentBreakdown(root, payments) {
    var box = root.querySelector("[data-sales-payment-breakdown]");
    if (!box) return;
    var items = Array.isArray(payments) ? payments : parsePaymentLines(root);
    var currency = selectedCurrency(root);
    var total = rowsTotal(root, false);
    var totalOutput = box.querySelector("[data-sales-payment-breakdown-total]");
    var lines = box.querySelector("[data-sales-payment-breakdown-lines]");
    if (totalOutput) totalOutput.textContent = formatMoney(total, currency) + " " + currency;
    if (lines) {
      lines.innerHTML = "";
      items.forEach(function (item, index) {
        var amount = numberValue(item.amount);
        if (!amount) return;
        var row = document.createElement("div");
        row.className = "sales-payment-breakdown-row";
        var label = document.createElement("span");
        label.textContent = index === 0 ? "Оплата" : "";
        var value = document.createElement("strong");
        var itemCurrency = String(item.currency || currency).toUpperCase();
        value.textContent = formatMoney(amount, itemCurrency) + " " + itemCurrency;
        var method = document.createElement("em");
        method.textContent = item.account || item.type || "";
        row.appendChild(label);
        row.appendChild(value);
        row.appendChild(method);
        lines.appendChild(row);
      });
    }
    box.hidden = !items.length;
  }

  function clearPayments(root) {
    var amountInput = root.querySelector("[data-sales-paid-amount]");
    var typeInput = root.querySelector("[data-sales-payment-type]");
    var linesInput = root.querySelector("[data-sales-payment-lines]");
    if (amountInput) amountInput.value = "0";
    if (typeInput) typeInput.value = "";
    if (linesInput) linesInput.value = "[]";
    paymentRows(root).forEach(function (row, index) {
      if (index > 0) row.remove();
      else row.querySelectorAll("[data-sales-payment-amount]").forEach(function (input) {
        input.value = "";
      });
      var currency = row.querySelector("[data-sales-payment-currency]");
      if (currency) {
        setPaymentSelect(currency, selectedCurrency(root));
        row.dataset.salesPaymentCurrency = paymentCurrency(row, root);
      }
    });
    updatePaymentSummary(root);
    updatePaymentBreakdown(root, []);
    saveSalesDraftNow(root);
  }

  function syncPaymentHidden(root) {
    var payments = collectPayments(root);
    var total = paymentTotalInCurrency(root, selectedCurrency(root));
    var amountInput = root.querySelector("[data-sales-paid-amount]");
    var typeInput = root.querySelector("[data-sales-payment-type]");
    var linesInput = root.querySelector("[data-sales-payment-lines]");
    if (amountInput) amountInput.value = total ? formatMoney(total, selectedCurrency(root)) : "0";
    if (typeInput) {
      var types = [];
      payments.forEach(function (item) {
        if (item.type && types.indexOf(item.type) < 0) types.push(item.type);
      });
      typeInput.value = types.join(", ");
    }
    if (linesInput) linesInput.value = JSON.stringify(payments);
    updatePaymentBreakdown(root, payments);
  }

  function addPaymentLine(root, values) {
    var dialog = paymentDialog(root);
    var wrap = dialog ? dialog.querySelector("[data-sales-payment-lines-ui]") : null;
    var source = paymentLineTemplate(dialog);
    if (!wrap || !source) return null;
    var row = source.cloneNode(true);
    row.removeAttribute("data-sales-payment-wired");
    row.querySelectorAll("input").forEach(function (input) {
      input.value = "";
    });
    if (values) {
      var account = row.querySelector("[data-sales-payment-account]");
      var currency = row.querySelector("[data-sales-payment-currency]");
      var amount = row.querySelector("[data-sales-payment-amount]");
      setPaymentSelect(account, values.account_id || values.account);
      setPaymentSelect(currency, values.currency || selectedCurrency(root));
      if (amount && values.amount) amount.value = formatMoney(numberValue(values.amount), values.currency || selectedCurrency(root));
      row.dataset.salesPaymentCurrency = paymentCurrency(row, root);
    } else {
      var defaultCurrency = row.querySelector("[data-sales-payment-currency]");
      setPaymentSelect(defaultCurrency, selectedCurrency(root));
      row.dataset.salesPaymentCurrency = paymentCurrency(row, root);
    }
    wrap.appendChild(row);
    wirePaymentLine(root, row);
    updatePaymentSummary(root);
    return row;
  }

  function ensureSingleEmptyPaymentLine(root) {
    var rows = paymentRows(root);
    if (rows.length) return rows[0];
    return addPaymentLine(root, null);
  }

  function removeExtraPaymentLines(root) {
    paymentRows(root).forEach(function (row, index) {
      if (index > 0) row.remove();
    });
  }

  function openPaymentDialog(root) {
    var dialog = paymentDialog(root);
    if (!dialog) return;
    removeExtraPaymentLines(root);
    var first = ensureSingleEmptyPaymentLine(root);
    var amountInput = first ? first.querySelector("[data-sales-payment-amount]") : null;
    var currencyInput = first ? first.querySelector("[data-sales-payment-currency]") : null;
    var currentPaid = numberValue(root.querySelector("[data-sales-paid-amount]")?.value || "");
    var total = rowsTotal(root, false);
    if (currencyInput && !currentPaid) setPaymentSelect(currencyInput, selectedCurrency(root));
    if (first) first.dataset.salesPaymentCurrency = paymentCurrency(first, root);
    if (amountInput && !currentPaid && total) amountInput.value = formatMoney(total, selectedCurrency(root));
    updatePaymentSummary(root);
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
    setTimeout(function () {
      if (amountInput) {
        amountInput.focus();
        amountInput.select();
      }
    }, 0);
  }

  function closePaymentDialog(root) {
    var dialog = paymentDialog(root);
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
  }

  function wirePaymentLine(root, row) {
    if (!row || row.getAttribute("data-sales-payment-wired") === "1") return;
    row.setAttribute("data-sales-payment-wired", "1");
    row.querySelectorAll("[data-sales-payment-amount], [data-sales-payment-account], [data-sales-payment-currency]").forEach(function (input) {
      input.addEventListener("input", function () {
        if (input.matches("[data-sales-payment-amount]")) sanitizeNumericInput(input);
        updatePaymentSummary(root);
      });
      input.addEventListener("change", function () {
        if (input.matches("[data-sales-payment-amount]")) sanitizeNumericInput(input);
        if (input.matches("[data-sales-payment-currency]")) convertPaymentLineCurrency(root, row, input.value);
        updatePaymentSummary(root);
      });
    });
    var remove = row.querySelector("[data-sales-payment-remove]");
    if (remove) {
      remove.addEventListener("click", function () {
        if (paymentRows(root).length <= 1) {
          row.querySelectorAll("input").forEach(function (input) {
            input.value = "";
          });
          var currency = row.querySelector("[data-sales-payment-currency]");
          if (currency) {
            setPaymentSelect(currency, selectedCurrency(root));
            row.dataset.salesPaymentCurrency = paymentCurrency(row, root);
          }
        } else {
          row.remove();
        }
        updatePaymentSummary(root);
      });
    }
  }

  function wirePaymentDialog(root) {
    var trigger = root.querySelector("[data-sales-payment-open]");
    var dialog = paymentDialog(root);
    var form = dialog ? dialog.querySelector("[data-sales-payment-form]") : null;
    if (!trigger || !dialog || !form || dialog.getAttribute("data-sales-payment-wired") === "1") return;
    dialog.setAttribute("data-sales-payment-wired", "1");
    paymentRows(root).forEach(function (row) {
      wirePaymentLine(root, row);
    });
    trigger.addEventListener("click", function () {
      openPaymentDialog(root);
    });
    dialog.querySelectorAll("[data-sales-payment-close], [data-sales-payment-cancel]").forEach(function (button) {
      button.addEventListener("click", function () {
        closePaymentDialog(root);
      });
    });
    var add = dialog.querySelector("[data-sales-payment-add-line]");
    if (add) {
      add.addEventListener("click", function () {
        var row = addPaymentLine(root, null);
        var input = row ? row.querySelector("[data-sales-payment-amount]") : null;
        if (input) input.focus();
      });
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      updatePaymentSummary(root);
      var currency = selectedCurrency(root);
      var due = rowsTotal(root, false);
      var paid = paymentTotalInCurrency(root, currency);
      if (paid > due) return;
      syncPaymentHidden(root);
      closePaymentDialog(root);
    });
    var clear = root.querySelector("[data-sales-payment-clear]");
    if (clear) {
      clear.addEventListener("click", function () {
        clearPayments(root);
      });
    }
  }

  function syncPriceType(root) {
    var priceType = root.querySelector("[data-sales-price-type]");
    var hidden = root.querySelector("[data-sales-price-type-name]");
    var currency = root.querySelector("[data-sales-currency]");
    if (!priceType) return;
    var option = priceType.selectedOptions && priceType.selectedOptions[0];
    if (hidden) hidden.value = option ? option.getAttribute("data-name") || option.textContent || "" : "";
    if (currency && option && option.getAttribute("data-currency")) {
      currency.value = option.getAttribute("data-currency");
    }
  }

  function init() {
    var root = document.querySelector(".sales-form");
    if (!root) return;
    var options = readOptions();
    root.querySelectorAll("[data-sales-combobox]").forEach(function (combo) {
      wireCombo(root, combo, options);
    });
    var priceType = root.querySelector("[data-sales-price-type]");
    if (priceType) {
      priceType.addEventListener("change", function () {
        syncPriceType(root);
        refreshAllLinePrices(root, options);
      });
      syncPriceType(root);
    }
    root.querySelectorAll('input[name="doc_type"]').forEach(function (input) {
      input.addEventListener("change", function () {
        syncDocumentNumber(root, options);
      });
    });
    syncDocumentNumber(root, options);
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      wireLine(root, row, options);
    });
    syncServiceControls(root);
    var addServiceBtn = root.querySelector("[data-sales-add-service]");
    if (addServiceBtn) {
      addServiceBtn.addEventListener("click", function () {
        addServiceLine(root, options);
      });
    }
    var prefillClient = String(root.dataset.salesPrefillClient || "").trim();
    if (prefillClient) {
      clearSalesDraft();
      var prefillCombo = root.querySelector('[data-sales-combobox="client"]');
      if (prefillCombo) commitCombo(prefillCombo, prefillClient);
      var prefillClientRow = (options.client_rows || []).find(function (item) {
        return normalize(item.name) === normalize(prefillClient);
      });
      updateClientBalance(root, prefillClientRow || prefillClient);
    } else if (isSalesSavedPage()) {
      clearSalesDraft();
    } else {
      restoreSalesDraft(root, options);
    }
    root.addEventListener("input", function () {
      scheduleSalesDraft(root);
    });
    root.addEventListener("change", function () {
      scheduleSalesDraft(root);
    });
    wireQuickProductDialog(root, options);
    wireTotalDialog(root);
    wirePaymentDialog(root);
    var currency = root.querySelector("[data-sales-currency]");
    if (currency) {
      currency.addEventListener("change", function () {
        refreshAllLinePrices(root, options);
        updatePaymentSummary(root);
      });
    }
    root.addEventListener("submit", function (event) {
      sanitizeNumericInputs(root);
      syncPaymentHidden(root);
      var filledLine = Array.from(root.querySelectorAll(".sales-lines-table tbody .sales-line-grid")).find(function (row) {
        return rowProductValue(row);
      });
      if (!filledLine) {
        event.preventDefault();
        var productInput = root.querySelector('[data-sales-combobox="product"] [data-sales-combo-input]') || root.querySelector('[data-sales-combobox="service"] [data-sales-combo-input]');
        if (productInput) {
          productInput.setCustomValidity("Добавьте товар или услугу");
          productInput.reportValidity();
          productInput.focus();
          setTimeout(function () {
            productInput.setCustomValidity("");
          }, 0);
        }
        return;
      }
      if (rowsTotal(root, false) <= 0) {
        event.preventDefault();
        var priceInput = filledLine.querySelector('input[name="line_price"]');
        if (priceInput) {
          priceInput.setCustomValidity("Укажите цену больше 0");
          priceInput.reportValidity();
          priceInput.focus();
          priceInput.select();
          setTimeout(function () {
            priceInput.setCustomValidity("");
          }, 0);
        }
        return;
      }
      var duplicate = duplicateProductInput(root);
      if (!duplicate) {
        clearSalesDraft();
        return;
      }
      event.preventDefault();
      duplicate.setCustomValidity("Этот товар уже выбран");
      duplicate.reportValidity();
      duplicate.focus();
    });
    updateTotal(root);
    document.addEventListener("mousedown", function (event) {
      root.querySelectorAll("[data-sales-combobox]").forEach(function (combo) {
        if (!combo.contains(event.target)) closePanel(combo);
      });
      if (!event.target.closest("[data-sales-discount]")) closeDiscountMenus(root, null);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
