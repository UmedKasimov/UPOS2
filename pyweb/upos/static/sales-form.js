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

  function formatMoney(value) {
    var num = Number(value);
    if (!Number.isFinite(num) || !num) return "0";
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
    setLocked(combo, !!input.value && /^(client|product)$/.test(combo.getAttribute("data-sales-combobox") || ""));
  }

  function rowProductValue(row) {
    var input = row ? row.querySelector('[data-sales-combobox="product"] [data-sales-combo-input]') : null;
    return input ? input.value.trim() : "";
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

  function wireLine(root, row, options) {
    if (!row || row.getAttribute("data-sales-line-wired") === "1") return;
    row.setAttribute("data-sales-line-wired", "1");
    row.querySelectorAll("[data-sales-combobox]").forEach(function (combo) {
      wireCombo(root, combo, options);
    });
    row.querySelectorAll('input[name="line_quantity"], input[name="line_price"]').forEach(function (input) {
      input.addEventListener("input", function () {
        updateTotal(root);
      });
    });
  }

  function cloneLine(root, sourceRow, options) {
    var row = sourceRow.cloneNode(true);
    row.removeAttribute("data-sales-line-wired");
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
    var rows = Array.from(root.querySelectorAll(".sales-lines-table tbody .sales-line-grid"));
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
    if (output) output.textContent = formatMoney(total) + " " + selectedCurrency(root);
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
    var rows = (options.product_rows || []).filter(function (item) {
      return itemMatches(item, query, ["name", "sku", "barcode"]);
    }).slice(0, 100);
    panel.innerHTML = rows.length
      ? rows.map(function (item) {
          var price = productPrice(item, priceTypeId);
          var code = item.sku || item.barcode || "Товар";
          var priceLabel = price.price ? price.price + " " + (price.currency || "") : "Без цены";
          return buttonHtml(item.name, code + " · " + stockLabel(item, warehouse), priceLabel, query);
        }).join("")
      : '<div class="sales-combo-empty">Ничего не найдено</div>';
    panel.hidden = false;
    panel.querySelectorAll("button").forEach(function (button, index) {
      button.addEventListener("mousedown", function (event) {
        event.preventDefault();
        var item = rows[index];
        var line = combo.closest(".sales-line-grid");
        var price = productPrice(item, priceTypeId);
        commitCombo(combo, item.name || "");
        if (line && price.price) {
          var priceInput = line.querySelector('input[name="line_price"]');
          if (priceInput) priceInput.value = price.price;
        }
        if (line) {
          var quantityInput = line.querySelector('input[name="line_quantity"]');
          if (quantityInput && !quantityInput.value.trim()) quantityInput.value = "1";
          updateTotal(root);
          ensureNextLine(root, line, options);
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
      if (type === "product") renderProduct(root, combo, options, input.value);
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
        updateTotal(root);
      });
      syncPriceType(root);
    }
    root.querySelectorAll(".sales-lines-table tbody .sales-line-grid").forEach(function (row) {
      wireLine(root, row, options);
    });
    var currency = root.querySelector("[data-sales-currency]");
    if (currency) {
      currency.addEventListener("change", function () {
        updateTotal(root);
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
