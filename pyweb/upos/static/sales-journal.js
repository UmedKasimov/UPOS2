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

  function readSalesOptions() {
    var node = document.getElementById("sales-form-options");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}") || {};
    } catch (_err) {
      return {};
    }
  }

  function detailCurrencyDigits(currency) {
    return String(currency || "").toUpperCase() === "UZS" ? 0 : 2;
  }

  function detailFormatAmount(value, currency) {
    var digits = detailCurrencyDigits(currency);
    var factor = Math.pow(10, digits);
    var numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return "0";
    var rounded = Math.round(numeric * factor) / factor;
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(rounded);
  }

  function detailFormatAmountInput(input, currency) {
    if (!input) return;
    var value = String(input.value || "").replace(/\s+/g, "");
    var hasDecimal = detailCurrencyDigits(currency) > 0 && /[.,]/.test(value);
    var parts = value.split(/[.,]/);
    var integerDigits = String(parts[0] || "").replace(/\D/g, "");
    var fractionDigits = String(parts[1] || "").replace(/\D/g, "").slice(0, detailCurrencyDigits(currency));
    if (!integerDigits && !hasDecimal) {
      input.value = "";
      return;
    }
    input.value = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (hasDecimal ? "," + fractionDigits : "");
  }

  function detailConvertCurrency(value, fromCurrency, toCurrency) {
    var options = readSalesOptions();
    var fx = options.fx || {};
    var rate = amountNumber(fx.USD_UZS || fx.usd_uzs || fx.usdUzs || "12000") || 12000;
    var amount = amountNumber(value);
    var source = String(fromCurrency || "UZS").toUpperCase();
    var target = String(toCurrency || "UZS").toUpperCase();
    if (!amount || source === target) return amount;
    if (source === "USD" && target === "UZS") return amount * rate;
    if (source === "UZS" && target === "USD") return amount / rate;
    return amount;
  }

  function detailPaymentDialog(scope) {
    return (scope || document).querySelector("[data-sales-detail-payment-dialog]");
  }

  function detailPaymentRows(dialog) {
    return dialog ? Array.from(dialog.querySelectorAll("[data-detail-payment-line]")) : [];
  }

  function detailPaymentLabel(select) {
    if (!select) return "";
    var option = select.selectedOptions ? select.selectedOptions[0] : null;
    return option ? option.getAttribute("data-label") || option.textContent.trim() || select.value : select.value || "";
  }

  function detailPaymentCurrency(row, dialog) {
    return String(row?.querySelector("[data-detail-payment-currency]")?.value || dialog?.dataset.paymentCurrency || "UZS").toUpperCase();
  }

  function collectDetailPayments(dialog) {
    if (!dialog) return [];
    return detailPaymentRows(dialog).map(function (row) {
      var amountInput = row.querySelector("[data-detail-payment-amount]");
      var currency = detailPaymentCurrency(row, dialog);
      detailFormatAmountInput(amountInput, currency);
      var amount = amountNumber(amountInput ? amountInput.value : "");
      if (!amount) return null;
      var account = row.querySelector("[data-detail-payment-account]");
      var accountLabel = detailPaymentLabel(account);
      return {
        account_id: account ? account.value : "",
        account: accountLabel,
        currency: currency,
        type: accountLabel || "Оплата",
        amount: String(amount)
      };
    }).filter(Boolean);
  }

  function detailPaymentTotal(dialog) {
    var currency = String(dialog?.dataset.paymentCurrency || "UZS").toUpperCase();
    return collectDetailPayments(dialog).reduce(function (sum, item) {
      return sum + detailConvertCurrency(item.amount, item.currency || currency, currency);
    }, 0);
  }

  function updateDetailPaymentSummary(dialog) {
    if (!dialog) return;
    var currency = String(dialog.dataset.paymentCurrency || "UZS").toUpperCase();
    var due = amountNumber(dialog.dataset.paymentDue || "0");
    var paid = detailPaymentTotal(dialog);
    var rest = Math.max(0, due - paid);
    var overpaid = Math.max(0, paid - due);
    setText(dialog, "[data-detail-payment-due]", moneyWithCurrency(due, currency));
    setText(dialog, "[data-detail-payment-paid]", moneyWithCurrency(paid, currency));
    setText(dialog, "[data-detail-payment-rest]", moneyWithCurrency(rest, currency));
    setText(dialog, "[data-detail-payment-over]", moneyWithCurrency(overpaid, currency));
    var overRow = dialog.querySelector("[data-detail-payment-over-row]");
    if (overRow) overRow.hidden = overpaid <= 0;
    dialog.querySelector("[data-detail-payment-summary]")?.classList.toggle("is-overpaid", overpaid > 0);
    var submit = dialog.querySelector("[data-detail-payment-submit]");
    if (submit) {
      submit.disabled = paid <= 0 || overpaid > 0;
      submit.title = overpaid > 0 ? "Оплата больше суммы на " + moneyWithCurrency(overpaid, currency) : "";
    }
  }

  function wireDetailPaymentRow(dialog, row) {
    if (!dialog || !row || row.dataset.detailPaymentReady === "1") return;
    row.dataset.detailPaymentReady = "1";
    row.querySelectorAll("[data-detail-payment-amount], [data-detail-payment-account], [data-detail-payment-currency]").forEach(function (input) {
      input.addEventListener("input", function () {
        if (input.matches("[data-detail-payment-amount]")) detailFormatAmountInput(input, detailPaymentCurrency(row, dialog));
        updateDetailPaymentSummary(dialog);
      });
      input.addEventListener("change", function () {
        if (input.matches("[data-detail-payment-amount]")) detailFormatAmountInput(input, detailPaymentCurrency(row, dialog));
        updateDetailPaymentSummary(dialog);
      });
    });
    row.querySelector("[data-detail-payment-remove]")?.addEventListener("click", function () {
      if (detailPaymentRows(dialog).length <= 1) {
        row.querySelectorAll("input").forEach(function (input) { input.value = ""; });
      } else {
        row.remove();
      }
      updateDetailPaymentSummary(dialog);
    });
  }

  function addDetailPaymentRow(dialog) {
    var wrap = dialog ? dialog.querySelector("[data-detail-payment-lines-ui]") : null;
    var source = dialog ? dialog.querySelector("[data-detail-payment-line]") : null;
    if (!wrap || !source) return null;
    var row = source.cloneNode(true);
    row.removeAttribute("data-detail-payment-ready");
    row.querySelectorAll("input").forEach(function (input) { input.value = ""; });
    var currency = row.querySelector("[data-detail-payment-currency]");
    if (currency) currency.value = dialog.dataset.paymentCurrency || currency.value || "UZS";
    wrap.appendChild(row);
    wireDetailPaymentRow(dialog, row);
    updateDetailPaymentSummary(dialog);
    return row;
  }

  function closeDetailPaymentDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    dialog.removeAttribute("open");
  }

  function openDetailPaymentDialog(scope, panel) {
    var dialog = detailPaymentDialog(scope);
    var actionForm = panel ? panel.querySelector("[data-sales-payment-form]") : null;
    var modalForm = dialog ? dialog.querySelector("[data-sales-detail-payment-modal-form]") : null;
    if (!dialog || !actionForm || !modalForm) return;
    var currency = String(actionForm.dataset.paymentCurrency || "UZS").toUpperCase();
    var due = amountNumber(actionForm.dataset.paymentDue || "0");
    dialog.dataset.paymentCurrency = currency;
    dialog.dataset.paymentDue = String(due);
    modalForm.action = actionForm.action || "";
    detailPaymentRows(dialog).forEach(function (row, index) {
      if (index > 0) row.remove();
    });
    var row = detailPaymentRows(dialog)[0] || addDetailPaymentRow(dialog);
    var currencyInput = row ? row.querySelector("[data-detail-payment-currency]") : null;
    var amountInput = row ? row.querySelector("[data-detail-payment-amount]") : null;
    if (currencyInput) currencyInput.value = currency;
    if (amountInput) amountInput.value = detailFormatAmount(due, currency);
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
    window.setTimeout(function () {
      if (amountInput) {
        amountInput.focus();
        amountInput.select();
      }
    }, 0);
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

  function updatePaymentButton(panel, sale) {
    var form = panel.querySelector("[data-sales-payment-form]");
    var button = panel.querySelector("[data-sales-payment-pay]");
    if (!form || !button) return;
    var saleId = String(sale.id || panel.dataset.saleId || "").trim();
    var template = String(form.dataset.salesPaymentUrlTemplate || "");
    var debt = amountNumber(sale.debt_amount || sale.debt_value);
    var isReturn = String(sale.doc_type || "").toLowerCase() === "return";
    if (saleId && template) {
      form.action = template.replace("__sale_id__", encodeURIComponent(saleId));
    }
    form.dataset.paymentDue = String(debt);
    form.dataset.paymentCurrency = String(sale.currency || "UZS").toUpperCase();
    var canPay = Boolean(saleId && debt > 0 && !isReturn);
    form.hidden = !canPay;
    button.disabled = !canPay;
    button.textContent = canPay ? "Оплатить " + moneyWithCurrency(debt, sale.currency || "UZS") : "Оплачено";
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
    updatePaymentButton(panel, sale);
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

  function bindSalesJournalFilter(scope) {
    var form = scope.querySelector("#sales-journal-filter");
    if (!form || form.dataset.salesJournalFilterReady === "1") return;
    form.dataset.salesJournalFilterReady = "1";
    var navigate = function () {
      var params = new URLSearchParams();
      ["q", "doc_type", "client", "status"].forEach(function (name) {
        var field = form.querySelector("[name=\"" + name + "\"]");
        var value = field ? String(field.value || "").trim() : "";
        if (!value) return;
        params.set(name, value);
      });
      if (!params.has("doc_type")) params.set("doc_type", "all");
      if (!params.has("status")) params.set("status", "all");
      var query = params.toString();
      window.location.href = "/sales" + (query ? "?" + query : "") + "#sales-journal";
    };
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      navigate();
    });
    var search = form.querySelector("input[name=\"q\"]");
    if (search) {
      search.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        navigate();
      });
    }
  }

  function highlightSalesJournalMatches(scope) {
    var table = scope.querySelector("#sales-journal-table");
    if (!table) return;
    var query = String(new URLSearchParams(window.location.search).get("q") || "").trim();
    if (!query) return;
    var needle = query.toLocaleLowerCase("ru-RU");
    table.querySelectorAll("tbody tr").forEach(function (row) {
      [row.cells[1], row.cells[4]].forEach(function (cell) {
        if (!cell) return;
        Array.from(cell.childNodes).forEach(function highlightNode(node) {
          if (node.nodeType === 3) {
            var text = node.nodeValue || "";
            var lower = text.toLocaleLowerCase("ru-RU");
            var start = lower.indexOf(needle);
            if (start < 0) return;
            var fragment = document.createDocumentFragment();
            var cursor = 0;
            while (start >= 0) {
              fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
              var mark = document.createElement("mark");
              mark.className = "sales-journal-search-match";
              mark.textContent = text.slice(start, start + query.length);
              fragment.appendChild(mark);
              cursor = start + query.length;
              start = lower.indexOf(needle, cursor);
            }
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
            node.replaceWith(fragment);
            return;
          }
          if (node.nodeType === 1 && node.tagName !== "MARK") {
            Array.from(node.childNodes).forEach(highlightNode);
          }
        });
      });
    });
  }

  function init(root) {
    var scope = root || document;
    bindSalesJournalFilter(scope);
    highlightSalesJournalMatches(scope);
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
    var detailDialog = detailPaymentDialog(scope);
    if (detailDialog && detailDialog.dataset.detailPaymentDialogReady !== "1") {
      detailDialog.dataset.detailPaymentDialogReady = "1";
      detailPaymentRows(detailDialog).forEach(function (row) {
        wireDetailPaymentRow(detailDialog, row);
      });
      detailDialog.querySelector("[data-detail-payment-add-line]")?.addEventListener("click", function () {
        var row = addDetailPaymentRow(detailDialog);
        row?.querySelector("[data-detail-payment-amount]")?.focus();
      });
      detailDialog.querySelectorAll("[data-detail-payment-close], [data-detail-payment-cancel]").forEach(function (button) {
        button.addEventListener("click", function () {
          closeDetailPaymentDialog(detailDialog);
        });
      });
      detailDialog.querySelector("[data-sales-detail-payment-modal-form]")?.addEventListener("submit", function (event) {
        event.preventDefault();
        updateDetailPaymentSummary(detailDialog);
        var payments = collectDetailPayments(detailDialog);
        var paid = detailPaymentTotal(detailDialog);
        var due = amountNumber(detailDialog.dataset.paymentDue || "0");
        if (!payments.length || paid <= 0 || paid > due) return;
        var hidden = detailDialog.querySelector("[data-detail-payment-lines]");
        if (hidden) hidden.value = JSON.stringify(payments);
        event.currentTarget.submit();
      });
    }
    scope.querySelectorAll("[data-sales-payment-pay]").forEach(function (button) {
      if (button.dataset.salesPaymentOpenReady === "1") return;
      button.dataset.salesPaymentOpenReady = "1";
      button.addEventListener("click", function () {
        var panel = button.closest("[data-sales-journal-detail]");
        openDetailPaymentDialog(scope, panel);
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
