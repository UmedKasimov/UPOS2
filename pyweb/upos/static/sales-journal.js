(function () {
  var SALES_DRAFT_KEY = "upos.sales.new-sale.draft.v1";
  var RETURN_FORM_URL = "/sales?doc_type=return#sales-form";

  function readSale(id) {
    var node = document.getElementById("sales-journal-data-" + id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (_err) {
      return null;
    }
  }

  function setText(root, selector, value) {
    var node = root.querySelector(selector);
    if (!node) return;
    node.textContent = value == null || value === "" ? "-" : String(value);
  }

  function moneyWithCurrency(value, currency) {
    var text = String(value == null || value === "" ? "0" : value).trim() || "0";
    var moneyCurrency = String(currency || "UZS").trim() || "UZS";
    if (/\b(UZS|USD)\b/i.test(text)) {
      moneyCurrency = (text.match(/\b(UZS|USD)\b/i) || [moneyCurrency])[0].toUpperCase();
      text = text.replace(/\b(UZS|USD)\b/gi, "").trim();
    }
    var normalized = text.replace(/\s+/g, "").replace(",", ".");
    var numeric = Number(normalized);
    if (normalized !== "" && Number.isFinite(numeric)) {
      text = new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 2,
      }).format(Math.round((numeric + Number.EPSILON) * 100) / 100);
    }
    return text + " " + moneyCurrency;
  }

  function draftStorage(name) {
    try {
      return window[name] || null;
    } catch (_err) {
      return null;
    }
  }

  function saveSalesDraftText(value) {
    var local = draftStorage("localStorage");
    var session = draftStorage("sessionStorage");
    try {
      if (local) local.setItem(SALES_DRAFT_KEY, value);
    } catch (_err) {}
    try {
      if (session) session.setItem(SALES_DRAFT_KEY, value);
    } catch (_err) {}
  }

  function textValue(value) {
    return String(value == null ? "" : value).trim();
  }

  function numericText(value) {
    return textValue(value)
      .replace(/\b(UZS|USD)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lineValue(line, names, fallback) {
    for (var i = 0; i < names.length; i += 1) {
      var value = line[names[i]];
      if (value != null && String(value).trim() !== "") return value;
    }
    return fallback;
  }

  function lineKind(line) {
    var kind = textValue(line.kind || line.line_kind || line.type).toLowerCase();
    if (kind === "service") return "service";
    if (line.service) return "service";
    var warehouse = textValue(lineValue(line, ["warehouse", "stock_warehouse"], "")).toLowerCase();
    if (warehouse.indexOf("service") >= 0 || /\u0443\u0441\u043b\u0443\u0433/i.test(warehouse)) return "service";
    return "product";
  }

  function draftLineFromSaleLine(line, sale) {
    var kind = lineKind(line);
    var price = numericText(lineValue(line, ["price", "unit_price", "price_label"], ""));
    var discountMode = textValue(lineValue(line, ["discount_mode", "discountMode"], "discount")) || "discount";
    var discountUnit = textValue(lineValue(line, ["discount_unit", "discountUnit"], "percent")) || "percent";
    return {
      kind: kind,
      product: textValue(lineValue(line, ["product", "product_name", "name", "service", "title"], "")),
      warehouse: kind === "service" ? "\u0423\u0441\u043b\u0443\u0433\u0438" : textValue(lineValue(line, ["warehouse", "stock_warehouse"], sale.warehouse || "")),
      quantity: numericText(lineValue(line, ["quantity", "qty", "count"], "1")) || "1",
      price: price,
      discountMode: discountMode === "markup" ? "markup" : "discount",
      discountValue: numericText(lineValue(line, ["discount_value", "discountValue"], "0")) || "0",
      discountUnit: discountUnit === "amount" ? "amount" : "percent",
      category: textValue(lineValue(line, ["category", "service_category"], "")),
      basePrice: numericText(lineValue(line, ["base_price", "basePrice", "original_price", "price", "unit_price"], price)),
      baseCurrency: textValue(lineValue(line, ["base_currency", "baseCurrency"], sale.currency || "")),
      priceTypeId: textValue(lineValue(line, ["price_type_id", "priceTypeId"], ""))
    };
  }

  function returnDraftFromSale(sale) {
    var draft = {
      client: sale.client || "",
      currency: sale.currency || "UZS",
      priceTypeId: sale.price_type_id || sale.priceTypeId || "",
      paidAmount: "",
      paymentType: "",
      paymentLines: "[]",
      products: [],
      services: []
    };
    var lines = Array.isArray(sale.lines) ? sale.lines : [];
    lines.forEach(function (line) {
      var draftLine = draftLineFromSaleLine(line, sale);
      if (!draftLine.product) return;
      if (draftLine.kind === "service") {
        draft.services.push(draftLine);
      } else {
        draft.products.push(draftLine);
      }
    });
    return draft;
  }

  function openReturnFromSale(sale) {
    if (!sale || textValue(sale.doc_type).toLowerCase() === "return") return;
    saveSalesDraftText(JSON.stringify(returnDraftFromSale(sale)));
    window.location.href = RETURN_FORM_URL;
  }

  function updateReturnButton(panel, sale) {
    var button = panel.querySelector("[data-sales-detail-return]");
    if (!button) return;
    var isReturn = textValue(sale.doc_type).toLowerCase() === "return";
    button.hidden = isReturn;
    button.dataset.saleId = isReturn ? "" : String(sale.id || "");
    panel.querySelectorAll("[data-sales-detail-menu-return]").forEach(function (menuButton) {
      menuButton.hidden = isReturn;
    });
  }

  function setDetailMenu(panel, open) {
    if (!panel) return;
    var menu = panel.querySelector("[data-sales-detail-menu]");
    var toggle = panel.querySelector("[data-sales-detail-menu-toggle]");
    if (!menu || !toggle) return;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.classList.toggle("is-active", open);
  }

  function closeDetailMenu(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-sales-journal-detail]").forEach(function (panel) {
      setDetailMenu(panel, false);
    });
  }

  function appendCell(row, value) {
    var cell = document.createElement("td");
    cell.textContent = value == null || value === "" ? "-" : String(value);
    row.append(cell);
    return cell;
  }

  function renderLines(panel, sale) {
    var linesRoot = panel.querySelector("[data-sales-detail-lines]");
    if (!linesRoot) return;
    var lines = Array.isArray(sale.lines) ? sale.lines : [];
    var currency = sale.currency || "UZS";
    linesRoot.replaceChildren();
    if (!lines.length) {
      var emptyRow = document.createElement("tr");
      appendCell(emptyRow, "1");
      appendCell(emptyRow, sale.number || "Продажа");
      appendCell(emptyRow, sale.warehouse || "-");
      appendCell(emptyRow, "-");
      appendCell(emptyRow, "-");
      appendCell(emptyRow, moneyWithCurrency(sale.amount, currency));
      linesRoot.append(emptyRow);
      return;
    }
    lines.forEach(function (line, index) {
      var row = document.createElement("tr");
      var name = lineValue(line, ["product", "product_name", "name", "service", "title"], "Товар");
      var warehouse = lineValue(line, ["warehouse", "stock_warehouse"], sale.warehouse || "-");
      var quantity = lineValue(line, ["quantity", "qty", "count"], "-");
      var price = lineValue(line, ["price", "unit_price", "price_label"], "");
      var total = lineValue(line, ["total", "sum", "amount", "line_total"], "");
      appendCell(row, index + 1);
      appendCell(row, name);
      appendCell(row, warehouse);
      appendCell(row, quantity);
      appendCell(row, price === "" ? "-" : moneyWithCurrency(price, currency));
      appendCell(row, total === "" ? "-" : moneyWithCurrency(total, currency));
      linesRoot.append(row);
    });
  }

  function renderDetail(panel, sale) {
    var currency = sale.currency || "UZS";
    var dateText = sale.date_label || sale.date || "";
    if (dateText && sale.status_label) dateText += " · " + sale.status_label;
    setText(panel, "[data-sales-detail-title]", (sale.doc_type_label || "Продажа") + ": " + (sale.number || "-"));
    setText(panel, "[data-sales-detail-date]", dateText || sale.status_label || "Новый");
    setText(panel, "[data-sales-detail-client]", sale.client || "Клиент не указан");
    setText(panel, "[data-sales-detail-warehouse]", sale.warehouse || "Склад не указан");
    setText(panel, "[data-sales-detail-status]", sale.status_label || "Новый");
    setText(panel, "[data-sales-detail-paid]", moneyWithCurrency(sale.paid_amount, currency));
    setText(panel, "[data-sales-detail-debt]", moneyWithCurrency(sale.debt_amount, currency));
    setText(panel, "[data-sales-detail-total]", moneyWithCurrency(sale.amount, currency));
    updateReturnButton(panel, sale);
    renderLines(panel, sale);
  }

  function openDetail(root, saleId) {
    var panel = root.querySelector("[data-sales-journal-detail]");
    var backdrop = root.querySelector(".sales-document-detail-backdrop");
    var sale = readSale(saleId);
    if (!panel || !sale) return;
    renderDetail(panel, sale);
    closeDetailMenu(root);
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(function () {
      panel.classList.add("is-open");
      if (backdrop) backdrop.classList.add("is-open");
    });
  }

  function closeDetail(root) {
    var panel = root.querySelector("[data-sales-journal-detail]");
    var backdrop = root.querySelector(".sales-document-detail-backdrop");
    if (!panel) return;
    closeDetailMenu(root);
    panel.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    window.setTimeout(function () {
      panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 180);
  }

  function statusClass(value) {
    if (value === "paid") return "confirmed";
    if (value === "return") return "rejected";
    if (value === "reserved" || value === "partial" || value === "debt") return "pending";
    return "draft";
  }

  function updateStatusSelect(select) {
    ["confirmed", "draft", "pending", "rejected"].forEach(function (name) {
      select.classList.remove("kassa-status-select--" + name);
    });
    select.classList.add("kassa-status-select--" + statusClass(select.value));
  }

  function initStatusSelects(scope) {
    scope.querySelectorAll("[data-sales-status-select]").forEach(function (select) {
      if (select.dataset.salesStatusReady === "1") return;
      select.dataset.salesStatusReady = "1";
      updateStatusSelect(select);
      select.addEventListener("change", function () {
        var form = select.closest("form");
        updateStatusSelect(select);
        if (form && typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else if (form) {
          form.submit();
        }
      });
    });
  }

  function init(root) {
    var scope = root || document;
    initStatusSelects(scope);
    scope.querySelectorAll("[data-sales-journal-open]").forEach(function (trigger) {
      if (trigger.dataset.salesJournalOpenReady === "1") return;
      trigger.dataset.salesJournalOpenReady = "1";
      trigger.addEventListener("click", function () {
        openDetail(scope, trigger.dataset.saleId || "");
      });
      trigger.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openDetail(scope, trigger.dataset.saleId || "");
      });
    });
    scope.querySelectorAll("[data-sales-detail-return]").forEach(function (trigger) {
      if (trigger.dataset.salesDetailReturnReady === "1") return;
      trigger.dataset.salesDetailReturnReady = "1";
      trigger.addEventListener("click", function () {
        var sale = readSale(trigger.dataset.saleId || "");
        openReturnFromSale(sale);
      });
    });
    scope.querySelectorAll("[data-sales-detail-menu-toggle]").forEach(function (toggle) {
      if (toggle.dataset.salesDetailMenuReady === "1") return;
      toggle.dataset.salesDetailMenuReady = "1";
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        var panel = toggle.closest("[data-sales-journal-detail]");
        var menu = panel ? panel.querySelector("[data-sales-detail-menu]") : null;
        var isOpen = !!menu && !menu.hidden;
        closeDetailMenu(scope);
        setDetailMenu(panel, !isOpen);
      });
    });
    scope.querySelectorAll("[data-sales-detail-menu]").forEach(function (menu) {
      if (menu.dataset.salesDetailMenuPanelReady === "1") return;
      menu.dataset.salesDetailMenuPanelReady = "1";
      menu.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    });
    scope.querySelectorAll("[data-sales-detail-menu-return]").forEach(function (trigger) {
      if (trigger.dataset.salesDetailMenuReturnReady === "1") return;
      trigger.dataset.salesDetailMenuReturnReady = "1";
      trigger.addEventListener("click", function () {
        var panel = trigger.closest("[data-sales-journal-detail]");
        var button = panel ? panel.querySelector("[data-sales-detail-return]") : null;
        closeDetailMenu(scope);
        if (button && !button.hidden) button.click();
      });
    });
    scope.querySelectorAll("[data-sales-detail-menu-print], [data-sales-detail-print]").forEach(function (trigger) {
      if (trigger.dataset.salesDetailPrintReady === "1") return;
      trigger.dataset.salesDetailPrintReady = "1";
      trigger.addEventListener("click", function () {
        closeDetailMenu(scope);
        window.print();
      });
    });
    scope.querySelectorAll("[data-sales-detail-menu-close]").forEach(function (trigger) {
      if (trigger.dataset.salesDetailMenuCloseReady === "1") return;
      trigger.dataset.salesDetailMenuCloseReady = "1";
      trigger.addEventListener("click", function () {
        closeDetailMenu(scope);
        closeDetail(scope);
      });
    });
    scope.querySelectorAll("[data-sales-journal-close]").forEach(function (trigger) {
      if (trigger.dataset.salesJournalCloseReady === "1") return;
      trigger.dataset.salesJournalCloseReady = "1";
      trigger.addEventListener("click", function () {
        closeDetail(scope);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeDetailMenu(scope);
        closeDetail(scope);
      }
    });
    document.addEventListener("click", function () {
      closeDetailMenu(scope);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(document); });
  } else {
    init(document);
  }
})();
