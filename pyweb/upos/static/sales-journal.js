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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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

  function receiptLineRows(sale) {
    var lines = Array.isArray(sale.lines) ? sale.lines : [];
    var currency = sale.currency || "UZS";
    if (!lines.length) {
      return (
        "<tr>" +
        "<td>" + escapeHtml(sale.number || "Продажа") + "</td>" +
        "<td class=\"num\">1</td>" +
        "<td class=\"num\">" + escapeHtml(moneyWithCurrency(sale.amount, currency)) + "</td>" +
        "</tr>"
      );
    }
    return lines.map(function (line) {
      var name = lineValue(line, ["product", "product_name", "name", "service", "title"], "Товар");
      var qty = lineValue(line, ["quantity", "qty", "count"], "1");
      var total = lineValue(line, ["total", "sum", "amount", "line_total"], "");
      var price = lineValue(line, ["price", "unit_price", "price_label"], "");
      var amount = total === "" ? price : total;
      return (
        "<tr>" +
        "<td>" + escapeHtml(name) + "</td>" +
        "<td class=\"num\">" + escapeHtml(qty) + "</td>" +
        "<td class=\"num\">" + escapeHtml(amount === "" ? "-" : moneyWithCurrency(amount, currency)) + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function printSaleReceipt(sale) {
    if (!sale) return;
    var currency = sale.currency || "UZS";
    var title = (sale.doc_type_label || "Продажа") + " " + (sale.number || "");
    var html =
      "<!doctype html><html><head><meta charset=\"utf-8\">" +
      "<title>" + escapeHtml(title) + "</title>" +
      "<style>" +
      "@page{size:80mm auto;margin:4mm}" +
      "body{font-family:Arial,'Inter',sans-serif;color:#111;margin:0;font-size:11px}" +
      ".receipt{width:72mm;margin:0 auto}" +
      ".center{text-align:center}.muted{color:#555}.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}" +
      "h1{font-size:15px;margin:0 0 3px;font-weight:800}.meta{border-top:1px dashed #999;border-bottom:1px dashed #999;padding:6px 0;margin:7px 0}" +
      "table{width:100%;border-collapse:collapse;margin:7px 0}th,td{padding:4px 0;border-bottom:1px dashed #bbb;text-align:left;vertical-align:top}" +
      "th{font-size:10px;text-transform:uppercase}.num{text-align:right;white-space:nowrap}.total{font-size:13px;font-weight:800}.footer{margin-top:10px;border-top:1px dashed #999;padding-top:7px}" +
      "</style></head><body><main class=\"receipt\">" +
      "<div class=\"center\"><h1>UPOS FINANCE</h1><div class=\"muted\">Чек продажи</div></div>" +
      "<section class=\"meta\">" +
      "<div class=\"row\"><span>Документ</span><strong>" + escapeHtml(sale.number || "-") + "</strong></div>" +
      "<div class=\"row\"><span>Дата</span><strong>" + escapeHtml(sale.date_label || sale.date || "-") + "</strong></div>" +
      "<div class=\"row\"><span>Клиент</span><strong>" + escapeHtml(sale.client || "-") + "</strong></div>" +
      "<div class=\"row\"><span>Склад</span><strong>" + escapeHtml(sale.warehouse || "-") + "</strong></div>" +
      "</section>" +
      "<table><thead><tr><th>Товар</th><th class=\"num\">К-во</th><th class=\"num\">Сумма</th></tr></thead><tbody>" +
      receiptLineRows(sale) +
      "</tbody></table>" +
      "<section class=\"meta\">" +
      "<div class=\"row total\"><span>Итого</span><strong>" + escapeHtml(moneyWithCurrency(sale.amount, currency)) + "</strong></div>" +
      "<div class=\"row\"><span>Оплачено</span><strong>" + escapeHtml(moneyWithCurrency(sale.paid_amount, currency)) + "</strong></div>" +
      "<div class=\"row\"><span>Долг</span><strong>" + escapeHtml(moneyWithCurrency(sale.debt_amount, currency)) + "</strong></div>" +
      "</section>" +
      "<div class=\"footer center muted\">Спасибо за покупку</div>" +
      "</main></body></html>";
    var frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.left = "-10000px";
    frame.style.top = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";
    document.body.appendChild(frame);
    var printWindow = frame.contentWindow;
    if (!printWindow || !printWindow.document) {
      frame.remove();
      window.print();
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    try {
      printWindow.focus();
      printWindow.print();
    } catch (_err) {
      window.print();
    } finally {
      window.setTimeout(function () {
        frame.remove();
      }, 1200);
    }
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

  function amountNumber(value) {
    var normalized = numericText(value).replace(/\s+/g, "").replace(",", ".");
    var number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
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

  function activateSalesDetailTab(panel, tabName) {
    if (!panel) return;
    var activeTab = tabName || "items";
    panel.querySelectorAll("[data-sales-detail-tab]").forEach(function (button) {
      var isActive = button.dataset.salesDetailTab === activeTab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    panel.querySelectorAll("[data-sales-detail-pane]").forEach(function (pane) {
      var isActive = pane.dataset.salesDetailPane === activeTab;
      pane.hidden = !isActive;
      pane.classList.toggle("active", isActive);
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
    setText(panel, "[data-sales-payment-total]", moneyWithCurrency(sale.amount, currency));
    setText(panel, "[data-sales-payment-paid]", moneyWithCurrency(sale.paid_amount, currency));
    setText(panel, "[data-sales-payment-debt]", moneyWithCurrency(sale.debt_amount, currency));
    setText(panel, "[data-sales-payment-status]", sale.status_label || "Новый");
    setText(panel, "[data-sales-payment-type]", sale.payment_type || "Не указано");
    setText(panel, "[data-sales-payment-date]", sale.date_label || sale.date || "-");
    setText(panel, "[data-sales-payment-client]", sale.client || "Клиент не указан");
    setText(panel, "[data-sales-detail-note]", sale.note || "Комментарий не указан");
    var paymentPane = panel.querySelector('[data-sales-detail-pane="payment"]');
    if (paymentPane) {
      paymentPane.dataset.paymentState = amountNumber(sale.debt_amount || sale.debt_value) > 0 ? "debt" : "paid";
    }
    updateReturnButton(panel, sale);
    renderLines(panel, sale);
  }

  function openDetail(root, saleId) {
    var panel = root.querySelector("[data-sales-journal-detail]");
    var backdrop = root.querySelector(".sales-document-detail-backdrop");
    var sale = readSale(saleId);
    if (!panel || !sale) return;
    panel.dataset.saleId = saleId || "";
    renderDetail(panel, sale);
    activateSalesDetailTab(panel, "items");
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
    scope.querySelectorAll("[data-sales-detail-tab]").forEach(function (tab) {
      if (tab.dataset.salesDetailTabReady === "1") return;
      tab.dataset.salesDetailTabReady = "1";
      tab.addEventListener("click", function () {
        var panel = tab.closest("[data-sales-journal-detail]");
        activateSalesDetailTab(panel, tab.dataset.salesDetailTab || "items");
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
        var panel = trigger.closest("[data-sales-journal-detail]");
        var sale = panel ? readSale(panel.dataset.saleId || "") : null;
        printSaleReceipt(sale);
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
