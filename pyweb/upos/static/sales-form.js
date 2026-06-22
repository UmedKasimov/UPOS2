(function () {
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
    var raw = String(value || "").replace(/\s+/g, "").replace(",", ".");
    var num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  }

  function formatQty(value) {
    var num = numberValue(value);
    if (!num) return "0";
    return String(num).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  function formatMoney(value, currency) {
    var num = Number(value);
    if (!Number.isFinite(num) || !num) return "0";
    var maxDigits = String(currency || "").toUpperCase() === "UZS" ? 0 : 2;
    if (num > 0 && num < 0.01) maxDigits = 4;
    return num.toLocaleString("ru-RU", {
      maximumFractionDigits: maxDigits
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
    return checked ? checked.value : "sale";
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
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      refreshLineProductPrice(root, row, options);
    });
    updateTotal(root);
  }

  function wireLine(root, row, options) {
    if (!row || row.getAttribute("data-sales-line-wired") === "1") return;
    row.setAttribute("data-sales-line-wired", "1");
    row.querySelectorAll("[data-sales-combobox]").forEach(function (combo) {
      wireCombo(root, combo, options);
    });
    row.querySelectorAll('input[name="line_quantity"], input[name="line_price"]').forEach(function (input) {
      input.addEventListener("input", function () {
        if (input.name === "line_price") {
          row.removeAttribute("data-sales-base-price");
          row.removeAttribute("data-sales-base-currency");
        }
        syncRowState(row);
        updateTotal(root);
      });
    });
    var productInput = row.querySelector('[data-sales-combo-input]');
    if (productInput) {
      productInput.addEventListener("input", function () {
        syncRowState(row);
        updateTotal(root);
      });
    }
    syncRowState(row);
  }

  function cloneLine(root, sourceRow, options) {
    var row = sourceRow.cloneNode(true);
    row.removeAttribute("data-sales-line-wired");
    row.classList.remove("is-empty");
    resetCombo(row.querySelector('[data-sales-combobox="product"]'));
    resetCombo(row.querySelector('[data-sales-combobox="warehouse"]'));
    var sourceWarehouse = sourceRow.querySelector('input[name="line_warehouse"]');
    var warehouse = row.querySelector('input[name="line_warehouse"]');
    if (warehouse) warehouse.value = sourceWarehouse ? sourceWarehouse.value : warehouse.defaultValue || "";
    row.querySelectorAll('input[name="line_quantity"], input[name="line_price"]').forEach(function (input) {
      input.value = "";
    });
    sourceRow.parentNode.insertBefore(row, sourceRow.nextSibling);
    wireLine(root, row, options);
    return row;
  }

  function ensureNextLine(root, currentRow, options) {
    if (!currentRow) return;
    var rows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"]'));
    var currentIndex = rows.indexOf(currentRow);
    var nextBlank = rows.slice(currentIndex + 1).find(function (row) {
      return !rowProductValue(row);
    });
    if (!nextBlank) {
      nextBlank = cloneLine(root, rows[rows.length - 1] || currentRow, options);
    }
    var nextInput = nextBlank.querySelector('[data-sales-combobox="product"] [data-sales-combo-input]');
    if (nextInput) nextInput.focus();
  }

  function addServiceLine(root, options) {
    var block = root.querySelector("[data-sales-services-block]");
    var body = root.querySelector("[data-sales-services-body]");
    var template = document.getElementById("sales-service-row-template");
    if (!body || !template || !template.content) return null;
    if (block) block.hidden = false;
    var row = template.content.firstElementChild.cloneNode(true);
    body.appendChild(row);
    wireLine(root, row, options);
    var input = row.querySelector('[data-sales-combobox="service"] [data-sales-combo-input]');
    if (input) input.focus();
    return row;
  }

  function updateTotal(root) {
    var total = 0;
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      var product = rowProductValue(row);
      var quantityInput = row.querySelector('input[name="line_quantity"]');
      var priceInput = row.querySelector('input[name="line_price"]');
      var price = numberValue(priceInput ? priceInput.value : "");
      var quantity = numberValue(quantityInput ? quantityInput.value : "");
      if (product && !quantity && price) quantity = 1;
      total += quantity * price;
    });
    var output = root.querySelector("[data-sales-lines-total]");
    if (output) output.textContent = formatMoney(total, selectedCurrency(root)) + " " + selectedCurrency(root);
  }

  function productKind(item) {
    return String(item.kind || "product").toLowerCase() === "service" ? "service" : "product";
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
            'class="sales-combo-option"',
            'class="sales-combo-option" data-index="' + index + '"'
          );
        }).join("")
      : '<div class="sales-combo-empty">Ничего не найдено</div>';
    panel.hidden = false;
    panel.querySelectorAll("button").forEach(function (button, index) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        var item = rows[index];
        commitCombo(combo, item.name || "");
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
    var rows = (options.product_rows || []).filter(function (item) {
      return productKind(item) === comboType && itemMatches(item, query, ["name", "sku", "barcode"]);
    }).slice(0, 100);
    panel.innerHTML = rows.length
      ? rows.map(function (item) {
          var price = salesPrice(item, priceTypeId, currency, options);
          var code = item.sku || item.barcode || (comboType === "service" ? "Услуга" : "Товар");
          var meta = comboType === "service" ? code : code + " · " + stockLabel(item, warehouse);
          var priceLabel = price.price ? price.price + " " + (price.currency || "") : "Без цены";
          return buttonHtml(item.name, meta, priceLabel, query);
        }).join("")
      : '<div class="sales-combo-empty">Ничего не найдено</div>';
    panel.hidden = false;
    panel.querySelectorAll("button").forEach(function (button, index) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        var item = rows[index];
        var line = combo.closest(".sales-line-grid");
        var price = salesPrice(item, priceTypeId, selectedCurrency(root), options);
        commitCombo(combo, item.name || "");
        if (line && price.price) {
          line.dataset.salesBasePrice = price.basePrice || price.price;
          line.dataset.salesBaseCurrency = price.baseCurrency || price.currency || selectedCurrency(root);
          line.dataset.salesPriceTypeId = priceTypeId || "";
          var priceInput = line.querySelector('input[name="line_price"]');
          if (priceInput) priceInput.value = price.price;
        }
        if (line) {
          var quantityInput = line.querySelector('input[name="line_quantity"]');
          if (quantityInput && !quantityInput.value.trim()) quantityInput.value = "1";
          syncRowState(line);
          updateTotal(root);
          if (comboType === "product") ensureNextLine(root, line, options);
        }
        closePanel(combo);
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
          return buttonHtml(item.name, item.manager || "Склад", count + " товаров", query);
        }).join("")
      : '<div class="sales-combo-empty">Ничего не найдено</div>';
    panel.hidden = false;
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
    var render = function () {
      if (isLocked(combo)) {
        closePanel(combo);
        return;
      }
      if (type === "client") renderClient(combo, options, input.value);
      if (type === "product" || type === "service") renderProduct(root, combo, options, input.value);
      if (type === "warehouse") renderWarehouse(root, combo, options, input.value);
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
        input.focus();
        input.select();
        render();
      });
    }
    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closePanel(combo);
    });
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
    var addServiceBtn = root.querySelector("[data-sales-add-service]");
    if (addServiceBtn) {
      addServiceBtn.addEventListener("click", function () {
        addServiceLine(root, options);
      });
    }
    var currency = root.querySelector("[data-sales-currency]");
    if (currency) {
      currency.addEventListener("change", function () {
        refreshAllLinePrices(root, options);
      });
    }
    updateTotal(root);
    document.addEventListener("mousedown", function (event) {
      root.querySelectorAll("[data-sales-combobox]").forEach(function (combo) {
        if (!combo.contains(event.target)) closePanel(combo);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
