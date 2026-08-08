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

  function updateSale(id, values) {
    var node = document.getElementById("sales-journal-data-" + id);
    if (!node) return null;
    var sale = readSale(id);
    if (!sale) return null;
    Object.keys(values || {}).forEach(function (key) {
      sale[key] = values[key];
    });
    node.textContent = JSON.stringify(sale);
    return sale;
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
        "<td>Позиции не указаны</td>" +
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
      sourceSaleId: sale.id || "",
      client: sale.client || "",
      businessSegmentId: sale.business_segment_id || "",
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

  function editDraftFromSale(sale) {
    var draft = returnDraftFromSale(sale);
    draft.documentId = sale.id || "";
    draft.docType = textValue(sale.doc_type || "sale").toLowerCase() || "sale";
    draft.number = sale.number || "";
    draft.sourceSaleId = sale.source_sale_id || "";
    draft.crmRecordId = sale.crm_record_id || "";
    draft.date = sale.date || "";
    draft.dateTo = sale.date_to || sale.date || "";
    draft.priceTypeId = sale.price_type_id || "";
    draft.paidAmount = numericText(sale.paid_value || sale.paid_amount || "");
    draft.paymentType = sale.payment_type || "";
    draft.paymentLines = JSON.stringify(Array.isArray(sale.payment_lines) ? sale.payment_lines : []);
    draft.note = sale.note || "";
    draft.installerUserId = sale.installer_user_id || "";
    draft.installationScheduledAt = sale.installation_scheduled_at || "";
    draft.installationTemplateId = sale.installation_template_id || "";
    draft.installationPriority = sale.installation_priority || "normal";
    draft.installationNotes = sale.installation_notes || "";
    draft.installationAttachmentUrls = Array.isArray(sale.installation_attachment_urls)
      ? sale.installation_attachment_urls.join("\n")
      : "";
    return draft;
  }

  function openEditFromSale(sale, options) {
    if (!sale || !sale.id) return;
    var draft = editDraftFromSale(sale);
    // nextStatus — статус, в который продажа перейдёт после сохранения
    // (продажа из заказа сразу идёт в отгрузку).
    if (options && options.nextStatus) draft.nextStatus = String(options.nextStatus);
    saveSalesDraftText(JSON.stringify(draft));
    var docType = encodeURIComponent(textValue(sale.doc_type || "sale").toLowerCase() || "sale");
    window.location.href = "/sales?doc_type=" + docType + "&edit_id=" + encodeURIComponent(sale.id) + "#sales-form";
  }

  function openReturnFromSale(sale) {
    if (!sale || textValue(sale.doc_type).toLowerCase() !== "sale") return;
    saveSalesDraftText(JSON.stringify(returnDraftFromSale(sale)));
    window.location.href = RETURN_FORM_URL;
  }

  function updateReturnButton(panel, sale) {
    var button = panel.querySelector("[data-sales-detail-return]");
    if (!button) return;
    var canReturn = textValue(sale.doc_type).toLowerCase() === "sale";
    button.hidden = !canReturn;
    button.dataset.saleId = canReturn ? String(sale.id || "") : "";
    panel.querySelectorAll("[data-sales-detail-menu-return]").forEach(function (menuButton) {
      menuButton.hidden = !canReturn;
    });
  }

  function updateConvertButton(panel, sale) {
    var form = panel.querySelector("[data-sales-detail-convert-form]");
    var button = panel.querySelector("[data-sales-detail-convert]");
    if (!form || !button) return;
    var canConvert = textValue(sale.doc_type).toLowerCase() === "order";
    form.hidden = !canConvert;
    button.disabled = !canConvert;
    if (!canConvert) {
      form.removeAttribute("action");
      return;
    }
    var template = form.dataset.actionTemplate || "";
    form.action = template.replace("__sale_id__", encodeURIComponent(String(sale.id || "")));
  }

  /* Архив — финальный шаг документа: только после него продажа попадает в
     прибыль. Возвраты и уже архивные документы кнопку не показывают. */
  function updateArchiveButton(panel, sale) {
    var form = panel.querySelector("[data-sales-detail-archive-form]");
    if (!form) return;
    var status = textValue(sale.status).toLowerCase();
    var docType = textValue(sale.doc_type).toLowerCase();
    var canArchive = docType !== "return" && status !== "archived";
    form.hidden = !canArchive;
    if (!canArchive) {
      form.removeAttribute("action");
      return;
    }
    var template = form.dataset.actionTemplate || "";
    form.action = template.replace("__sale_id__", encodeURIComponent(String(sale.id || "")));
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
      appendCell(emptyRow, "Позиции не указаны");
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

  function renderCompletedTasks(panel, sale) {
    var root = panel.querySelector("[data-sales-detail-tasks]");
    var count = panel.querySelector("[data-sales-detail-task-count]");
    var tasks = Array.isArray(sale.completed_tasks) ? sale.completed_tasks : [];
    if (count) count.textContent = String(sale.completed_tasks_count == null ? tasks.length : sale.completed_tasks_count);
    if (!root) return;
    root.replaceChildren();
    if (!tasks.length) {
      var empty = document.createElement("div");
      empty.className = "sales-document-tasks-empty";
      empty.textContent = "Выполненных задач нет.";
      root.append(empty);
      return;
    }

    tasks.forEach(function (task) {
      var article = document.createElement("article");
      article.className = "sales-document-task";

      var row = document.createElement("label");
      row.className = "sales-document-task-main";
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.disabled = true;
      checkbox.setAttribute("aria-label", "Задача выполнена");
      var content = document.createElement("span");
      var title = document.createElement("strong");
      title.textContent = String(task.title || "Задача");
      content.append(title);

      var metaParts = [];
      if (task.completed_at) metaParts.push("Выполнено " + String(task.completed_at));
      else if (task.due_date) metaParts.push(String(task.due_date));
      if (task.assignee) metaParts.push(String(task.assignee));
      if (metaParts.length) {
        var meta = document.createElement("small");
        meta.textContent = metaParts.join(" · ");
        content.append(meta);
      }
      row.append(checkbox, content);
      article.append(row);

      var checklist = Array.isArray(task.checklist) ? task.checklist : [];
      if (checklist.length) {
        var list = document.createElement("ul");
        list.className = "sales-document-task-checklist";
        checklist.forEach(function (entry) {
          var listItem = document.createElement("li");
          var itemLabel = document.createElement("label");
          var itemCheckbox = document.createElement("input");
          itemCheckbox.type = "checkbox";
          itemCheckbox.checked = true;
          itemCheckbox.disabled = true;
          itemCheckbox.setAttribute("aria-label", "Пункт выполнен");
          var itemText = document.createElement("span");
          itemText.textContent = String(entry);
          itemLabel.append(itemCheckbox, itemText);
          listItem.append(itemLabel);
          list.append(listItem);
        });
        article.append(list);
      }
      root.append(article);
    });
  }

  // Остаток к оплате: долг в отчётности появляется только на поздних статусах,
  // а оплатить продажу или заказ можно сразу после создания.
  function salesOutstanding(sale) {
    var outstanding = amountNumber(sale.outstanding_value || sale.outstanding_amount);
    if (outstanding > 0) return outstanding;
    if (sale.outstanding_value != null || sale.outstanding_amount != null) return Math.max(0, outstanding);
    var total = amountNumber(sale.amount || sale.amount_value);
    var paid = amountNumber(sale.paid_amount || sale.paid_value);
    return Math.max(0, total - paid);
  }

  function updatePaymentButton(panel, sale) {
    var form = panel.querySelector("[data-sales-payment-form]");
    var button = panel.querySelector("[data-sales-payment-pay]");
    if (!form || !button) return;
    var saleId = String(sale.id || panel.dataset.saleId || "").trim();
    var template = String(form.dataset.salesPaymentUrlTemplate || "");
    var outstanding = salesOutstanding(sale);
    var isReturn = String(sale.doc_type || "").toLowerCase() === "return";
    if (saleId && template) {
      form.action = template.replace("__sale_id__", encodeURIComponent(saleId));
    }
    form.dataset.paymentDue = String(outstanding);
    form.dataset.paymentCurrency = String(sale.currency || "UZS").toUpperCase();
    var canPay = Boolean(saleId && outstanding > 0 && !isReturn);
    form.hidden = !canPay;
    button.disabled = !canPay;
    button.textContent = canPay ? "Оплатить " + moneyWithCurrency(outstanding, sale.currency || "UZS") : "Оплачено";
  }

  function renderSalesPayments(panel, sale) {
    var paymentList = panel.querySelector("[data-sales-payment-list]");
    var paymentLinesRoot = panel.querySelector("[data-sales-payment-lines]");
    if (!paymentList || !paymentLinesRoot) return;

    var currency = String(sale.currency || "UZS").toUpperCase();
    var paymentLines = (Array.isArray(sale.payment_lines) ? sale.payment_lines : [])
      .filter(function (payment) {
        return amountNumber(payment && payment.amount) > 0;
      })
      .map(function (payment) {
        return {
          date: String(payment.date || "").trim(),
          account: String(payment.account || payment.type || "Оплата").trim() || "Оплата",
          type: String(payment.type || payment.account || "Оплата").trim() || "Оплата",
          amount: payment.amount,
          currency: String(payment.currency || currency).toUpperCase(),
        };
      });

    var paidAmount = amountNumber(sale.paid_amount || sale.paid_value);
    if (!paymentLines.length && paidAmount > 0) {
      paymentLines.push({
        date: String(sale.date || "").trim(),
        account: String(sale.payment_type || "Оплата").trim() || "Оплата",
        type: String(sale.payment_type || "Оплата").trim() || "Оплата",
        amount: paidAmount,
        currency: currency,
      });
    }

    paymentLinesRoot.replaceChildren();
    paymentList.hidden = paymentLines.length === 0;
    paymentLines.forEach(function (payment, index) {
      var row = document.createElement("tr");
      [index + 1, payment.date || "—", payment.account, payment.type].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      });
      var amountCell = document.createElement("td");
      var amount = document.createElement("strong");
      amount.textContent = moneyWithCurrency(payment.amount, payment.currency);
      amountCell.append(amount);
      row.append(amountCell);
      paymentLinesRoot.append(row);
    });

    renderInstallmentSchedule(panel, sale, paidAmount, currency);
  }

  // Прибавляет месяцы к дате ISO (YYYY-MM-DD), сохраняя число месяца.
  function addMonthsIso(iso, months) {
    var base = new Date(iso);
    if (isNaN(base.getTime())) return "";
    var target = new Date(base.getFullYear(), base.getMonth() + months, base.getDate());
    var y = target.getFullYear();
    var m = ("0" + (target.getMonth() + 1)).slice(-2);
    var d = ("0" + target.getDate()).slice(-2);
    return y + "-" + m + "-" + d;
  }

  /** График рассрочки: первый взнос и помесячные платежи с датами. */
  function renderInstallmentSchedule(panel, sale, paidAmount, currency) {
    var box = panel.querySelector("[data-sales-installment-schedule]");
    var rowsRoot = panel.querySelector("[data-sales-installment-schedule-rows]");
    if (!box || !rowsRoot) return;
    var installment = sale.installment && typeof sale.installment === "object" ? sale.installment : null;
    if (!installment || !installment.enabled) {
      box.hidden = true;
      rowsRoot.replaceChildren();
      return;
    }
    var months = Math.max(1, Math.round(amountNumber(installment.months) || 1));
    var initial = amountNumber(installment.initial);
    var monthly = amountNumber(installment.monthly);
    var startDate = String(sale.date || "").trim();

    var schedule = [];
    if (initial > 0) {
      schedule.push({ label: "Первый взнос", date: startDate, amount: initial });
    }
    for (var i = 1; i <= months; i += 1) {
      schedule.push({
        label: "Платёж " + i,
        date: startDate ? addMonthsIso(startDate, i) : "",
        amount: monthly,
      });
    }

    // Помечаем платежи как оплаченные по накопленной сумме факта.
    var covered = paidAmount;
    rowsRoot.replaceChildren();
    schedule.forEach(function (entry, index) {
      var row = document.createElement("tr");
      var paid = covered >= entry.amount - 0.01 && entry.amount > 0;
      if (paid) covered -= entry.amount;
      else if (covered > 0.01) { entry.partial = covered; covered = 0; }
      [
        String(index + 1),
        entry.date || "—",
        moneyWithCurrency(entry.amount, currency),
        paid ? "Оплачен" : entry.partial ? "Частично" : "Ожидается",
      ].forEach(function (value, cellIndex) {
        var cell = document.createElement("td");
        if (cellIndex === 3) {
          var badge = document.createElement("span");
          badge.className =
            "sales-schedule-status sales-schedule-status--" +
            (paid ? "paid" : entry.partial ? "partial" : "pending");
          badge.textContent = value;
          cell.append(badge);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      rowsRoot.append(row);
    });
    box.hidden = schedule.length === 0;
  }

  function renderSalesPaymentSummary(panel, sale) {
    var summary = panel.querySelector("[data-sales-payment-summary]");
    if (!summary) return;

    var currency = String(sale.currency || "UZS").toUpperCase();
    var total = amountNumber(sale.amount || sale.amount_value);
    var paid = amountNumber(sale.paid_amount || sale.paid_value);
    var outstanding = salesOutstanding(sale);
    setText(summary, "[data-sales-payment-total]", moneyWithCurrency(total, currency));
    setText(summary, "[data-sales-payment-paid]", moneyWithCurrency(paid, currency));
    setText(summary, "[data-sales-payment-debt]", moneyWithCurrency(outstanding, currency));
    summary.dataset.paymentState = outstanding > 0 ? (paid > 0 ? "partial" : "debt") : "paid";
  }

  function renderDetail(panel, sale) {
    var currency = sale.currency || "UZS";
    var dateText = sale.date_label || sale.date || "";
    if (dateText && sale.status_label) dateText += " · " + sale.status_label;
    setText(panel, "[data-sales-detail-title]", (sale.doc_type_label || "Продажа") + ": " + (sale.number || "-"));
    setText(panel, "[data-sales-detail-date]", dateText || sale.status_label || "Новый");
    setText(panel, "[data-sales-detail-client]", sale.client || "Клиент не указан");
    setText(panel, "[data-sales-detail-warehouse]", sale.warehouse || "Склад не указан");
    // Ответственный: агент из CRM, если назначен, иначе автор документа.
    setText(
      panel,
      "[data-sales-detail-manager]",
      textValue(sale.crm_responsible) || textValue(sale.manager) || "Не назначен"
    );
    setText(panel, "[data-sales-detail-status]", sale.status_label || "Новый");
    var crmStatus = panel.querySelector("[data-sales-detail-crm-status]");
    if (crmStatus) {
      var selectedStage = sale.crm_status || "";
      crmStatus.value = Array.from(crmStatus.options).some(function (option) {
        return option.value === selectedStage;
      }) ? selectedStage : "";
      crmStatus.dataset.crmStatus = sale.crm_status || "unassigned";
      crmStatus.title = "Этап CRM: " + (sale.crm_status_label || "Не назначен");
    }
    setText(panel, "[data-sales-detail-paid]", moneyWithCurrency(sale.paid_amount, currency));
    setText(panel, "[data-sales-detail-debt]", moneyWithCurrency(sale.debt_amount, currency));
    setText(panel, "[data-sales-detail-total]", moneyWithCurrency(sale.amount, currency));
    setText(panel, "[data-sales-detail-note]", sale.note || "Комментарий не указан");
    var paymentPane = panel.querySelector('[data-sales-detail-pane="payment"]');
    if (paymentPane) {
      paymentPane.dataset.paymentState = salesOutstanding(sale) > 0 ? "debt" : "paid";
    }
    renderSalesPayments(panel, sale);
    renderSalesPaymentSummary(panel, sale);
    updatePaymentButton(panel, sale);
    updateReturnButton(panel, sale);
    updateConvertButton(panel, sale);
    updateArchiveButton(panel, sale);
    renderLines(panel, sale);
    renderCompletedTasks(panel, sale);
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

  function hideDetailImmediately(root) {
    var panel = root.querySelector("[data-sales-journal-detail]");
    var backdrop = root.querySelector(".sales-document-detail-backdrop");
    if (panel) {
      panel.classList.remove("is-open");
      panel.hidden = true;
    }
    if (backdrop) {
      backdrop.classList.remove("is-open");
      backdrop.hidden = true;
    }
    closeDetailMenu(root);
  }

  function statusClass(value) {
    if (value === "completed" || value === "archived") return "confirmed";
    if (value === "return") return "rejected";
    if (value === "shipped" || value === "installation") return "pending";
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
    var bindCheckboxFilter = function (root, allSelector, optionSelector, summarySelector) {
      if (!root) return;
      var allOption = root.querySelector(allSelector);
      var options = Array.from(root.querySelectorAll(optionSelector));
      var summary = root.querySelector(summarySelector);
      var updateSummary = function () {
        var checked = options.filter(function (field) {
          return field.checked;
        });
        if (summary) {
          summary.textContent =
            checked.length === 0
              ? "Все"
              : checked.length === 1
                ? String(checked[0].closest("label").querySelector("span").textContent || "").trim()
                : "Выбрано: " + checked.length;
        }
        if (allOption) allOption.checked = checked.length === 0;
      };
      if (allOption) {
        allOption.addEventListener("change", function () {
          if (allOption.checked) {
            options.forEach(function (field) {
              field.checked = false;
            });
          }
          updateSummary();
        });
      }
      options.forEach(function (field) {
        field.addEventListener("change", updateSummary);
      });
      updateSummary();
    };
    bindCheckboxFilter(
      form.querySelector("[data-sales-doc-type-filter]"),
      "[data-sales-doc-type-all]",
      "[data-sales-doc-type-option]",
      "[data-sales-doc-type-summary]"
    );
    bindCheckboxFilter(
      form.querySelector("[data-sales-payment-status-filter]"),
      "[data-sales-payment-status-all]",
      "[data-sales-payment-status-option]",
      "[data-sales-payment-status-summary]"
    );
    bindCheckboxFilter(
      form.querySelector("[data-sales-crm-stage-filter]"),
      "[data-sales-crm-stage-all]",
      "[data-sales-crm-stage-option]",
      "[data-sales-crm-stage-summary]"
    );
    bindCheckboxFilter(
      form.querySelector("[data-sales-status-filter]"),
      "[data-sales-status-all]",
      "[data-sales-status-option]",
      "[data-sales-status-summary]"
    );
    var navigate = function () {
      var params = new URLSearchParams();
      ["q", "client", "date_from", "date_to", "journal_page_size", "debt_page_size", "view"].forEach(function (name) {
        var field = form.querySelector("[name=\"" + name + "\"]");
        var value = field ? String(field.value || "").trim() : "";
        if (!value) return;
        params.set(name, value);
      });
      form.querySelectorAll("[data-sales-doc-type-option]:checked").forEach(function (field) {
        params.append("doc_type", String(field.value || "").trim());
      });
      form.querySelectorAll("[data-sales-status-option]:checked").forEach(function (field) {
        params.append("status", String(field.value || "").trim());
      });
      form.querySelectorAll("[data-sales-payment-status-option]:checked").forEach(function (field) {
        params.append("payment_status", String(field.value || "").trim());
      });
      form.querySelectorAll("[data-sales-crm-stage-option]:checked").forEach(function (field) {
        params.append("crm_stage", String(field.value || "").trim());
      });
      if (!params.has("doc_type")) params.set("doc_type", "all");
      var query = params.toString();
      var targetHash = params.get("status") === "debt" ? "#debt" : "#sales-journal";
      window.location.href = "/sales" + (query ? "?" + query : "") + targetHash;
    };
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      navigate();
    });
    var navigateTimer = 0;
    var scheduleNavigate = function (delay) {
      window.clearTimeout(navigateTimer);
      navigateTimer = window.setTimeout(navigate, delay);
    };
    form.addEventListener("change", function (event) {
      var field = event.target;
      if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)) return;
      scheduleNavigate(field.type === "checkbox" ? 650 : 120);
    });
    form.addEventListener("input", function (event) {
      var field = event.target;
      if (!(field instanceof HTMLInputElement)) return;
      if (field.name !== "q" && field.name !== "client") return;
      scheduleNavigate(450);
    });
    var search = form.querySelector("input[name=\"q\"]");
    if (search) {
      search.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        window.clearTimeout(navigateTimer);
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

  function salesJournalSortValue(row, columnIndex, kind) {
    var cell = row.cells[columnIndex];
    if (!cell) return kind === "text" ? "" : 0;
    var raw = cell.dataset.sortValue || cell.textContent || "";
    if (kind === "number") return amountNumber(raw);
    if (kind === "date") {
      var timestamp = Date.parse(String(raw).trim());
      return Number.isFinite(timestamp) ? timestamp : 0;
    }
    return String(raw).trim().toLocaleLowerCase("ru-RU");
  }

  function bindSalesJournalSort(scope) {
    var table = scope.querySelector("#sales-journal-table");
    if (!table || table.dataset.salesJournalSortReady === "1") return;
    table.dataset.salesJournalSortReady = "1";
    var numericColumns = new Set([6, 7, 8, 9]);
    var dateColumns = new Set([2]);

    table.querySelectorAll("thead .sales-journal-sort-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        var header = button.closest("th");
        var body = table.tBodies[0];
        if (!header || !body) return;
        var columnIndex = header.cellIndex;
        var kind = header.dataset.sortKind || (numericColumns.has(columnIndex) ? "number" : dateColumns.has(columnIndex) ? "date" : "text");
        var direction = header.getAttribute("aria-sort") === "descending" ? "ascending" : "descending";
        var rows = Array.from(body.querySelectorAll("tr[data-sales-journal-row]"));

        rows.forEach(function (row, index) {
          row.dataset.salesOriginalIndex = row.dataset.salesOriginalIndex || String(index);
        });
        rows.sort(function (left, right) {
          var leftValue = salesJournalSortValue(left, columnIndex, kind);
          var rightValue = salesJournalSortValue(right, columnIndex, kind);
          var result = kind === "text"
            ? leftValue.localeCompare(rightValue, "ru-RU", { numeric: true, sensitivity: "base" })
            : leftValue - rightValue;
          if (result === 0) {
            result = Number(left.dataset.salesOriginalIndex) - Number(right.dataset.salesOriginalIndex);
          }
          return direction === "ascending" ? result : -result;
        });

        table.querySelectorAll("thead th[aria-sort]").forEach(function (item) {
          item.setAttribute("aria-sort", item === header ? direction : "none");
          var arrow = item.querySelector(".org-shipments-sort-arrow");
          if (arrow) arrow.textContent = item === header ? (direction === "ascending" ? "↑" : "↓") : "↕";
        });
        rows.forEach(function (row, index) {
          body.appendChild(row);
          var indexCell = row.querySelector(".sales-journal-row-index");
          if (indexCell) indexCell.textContent = String(index + 1);
        });
      });
    });
  }

  function bindDetailTaskForm(scope) {
    var panel = scope.querySelector("[data-sales-journal-detail]");
    var form = panel ? panel.querySelector("[data-sales-detail-task-form]") : null;
    if (!form || form.dataset.salesDetailTaskReady === "1") return;
    form.dataset.salesDetailTaskReady = "1";
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var saleId = panel.dataset.saleId || "";
      if (!saleId) return;
      var status = form.querySelector("[data-sales-detail-task-status]");
      var submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      if (status) {
        status.hidden = false;
        status.textContent = "Сохраняю...";
      }
      fetch("/sales/" + encodeURIComponent(saleId) + "/crm-task", {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok || !body.ok) throw new Error(body.error === "csrf" ? "Обновите страницу и повторите" : "Не удалось добавить задачу");
            return body;
          });
        })
        .then(function () {
          if (status) status.textContent = "Задача добавлена в CRM";
          form.querySelectorAll('input[name="crm_task_text"], input[name="crm_task_due_date"], input[name="crm_task_due_time"], input[name="crm_task_assignee"]').forEach(function (input) {
            input.value = "";
          });
        })
        .catch(function (error) {
          if (status) {
            status.hidden = false;
            status.textContent = error.message || "Не удалось добавить задачу";
          }
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  }

  function init(root) {
    var scope = root || document;
    bindSalesJournalFilter(scope);
    bindSalesJournalSort(scope);
    bindDetailTaskForm(scope);
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
    scope.querySelectorAll("[data-sales-journal-edit]").forEach(function (trigger) {
      if (trigger.dataset.salesJournalEditReady === "1") return;
      trigger.dataset.salesJournalEditReady = "1";
      trigger.addEventListener("click", function () {
        openEditFromSale(readSale(trigger.dataset.saleId || ""));
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
    scope.querySelectorAll("[data-sales-detail-crm-status]").forEach(function (select) {
      if (select.dataset.salesCrmStageReady === "1") return;
      select.dataset.salesCrmStageReady = "1";
      select.addEventListener("change", async function () {
        var panel = select.closest("[data-sales-journal-detail]");
        var saleId = panel ? panel.dataset.saleId || "" : "";
        var sale = readSale(saleId);
        var stageId = String(select.value || "").trim();
        if (!panel || !sale || !saleId || !stageId) return;
        var previousStage = sale.crm_status || "";
        var actionTemplate = select.dataset.actionTemplate || "";
        var action = actionTemplate.replace("__sale_id__", encodeURIComponent(saleId));
        var csrf = panel.querySelector("[name=\"csrf_token\"]");
        var formData = new FormData();
        formData.set("csrf_token", csrf ? csrf.value : "");
        formData.set("stage_id", stageId);
        select.disabled = true;
        select.setAttribute("aria-busy", "true");
        try {
          var response = await fetch(action, {
            method: "POST",
            body: formData,
            headers: { "X-Requested-With": "XMLHttpRequest" },
          });
          var payload = {};
          try {
            payload = await response.json();
          } catch (_err) {}
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Не удалось сохранить этап CRM");
          }
          var updatedSale = updateSale(saleId, {
            crm_record_id: payload.crm_record_id || sale.crm_record_id || "",
            crm_status: payload.crm_status || stageId,
            crm_status_label: payload.crm_status_label || select.options[select.selectedIndex].text,
          });
          if (updatedSale) renderDetail(panel, updatedSale);
        } catch (error) {
          select.value = previousStage;
          window.alert(error && error.message ? error.message : "Не удалось сохранить этап CRM");
        } finally {
          select.disabled = false;
          select.removeAttribute("aria-busy");
        }
      });
    });
    // Этап CRM можно менять прямо в строке журнала, не открывая карточку —
    // используется тот же endpoint, что и селект внутри карточки.
    scope.querySelectorAll("[data-sales-journal-crm-stage]").forEach(function (select) {
      if (select.dataset.salesJournalCrmReady === "1") return;
      select.dataset.salesJournalCrmReady = "1";
      select.addEventListener("click", function (event) {
        event.stopPropagation();
      });
      select.addEventListener("change", async function () {
        var saleId = String(select.dataset.saleId || "").trim();
        var stageId = String(select.value || "").trim();
        if (!saleId || !stageId) return;
        var sale = readSale(saleId) || {};
        var previousStage = String(sale.crm_status || "");
        var row = select.closest("tr");
        var csrf = row ? row.querySelector('input[name="csrf_token"]') : null;
        var action = String(select.dataset.actionTemplate || "").replace(
          "__sale_id__",
          encodeURIComponent(saleId)
        );
        if (!action) return;
        var formData = new FormData();
        formData.set("csrf_token", csrf ? csrf.value : "");
        formData.set("stage_id", stageId);
        select.disabled = true;
        select.setAttribute("aria-busy", "true");
        try {
          var response = await fetch(action, {
            method: "POST",
            body: formData,
            headers: { "X-Requested-With": "XMLHttpRequest" },
          });
          var payload = {};
          try {
            payload = await response.json();
          } catch (_err) {}
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Не удалось сохранить этап CRM");
          }
          var stageLabel = payload.crm_status_label || select.options[select.selectedIndex].text;
          select.dataset.crmStatus = payload.crm_status || stageId;
          select.title = "Этап CRM: " + stageLabel;
          var cell = select.closest("td");
          if (cell) cell.dataset.sortValue = stageLabel;
          var updated = updateSale(saleId, {
            crm_record_id: payload.crm_record_id || sale.crm_record_id || "",
            crm_status: payload.crm_status || stageId,
            crm_status_label: stageLabel,
          });
          var panel = scope.querySelector("[data-sales-journal-detail]");
          if (updated && panel && panel.dataset.saleId === saleId && !panel.hidden) {
            renderDetail(panel, updated);
          }
        } catch (error) {
          select.value = previousStage;
          window.alert(error && error.message ? error.message : "Не удалось сохранить этап CRM");
        } finally {
          select.disabled = false;
          select.removeAttribute("aria-busy");
        }
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
    scope.querySelectorAll("[data-sales-debt-pay]").forEach(function (button) {
      if (button.dataset.salesDebtPayReady === "1") return;
      button.dataset.salesDebtPayReady = "1";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var saleId = button.dataset.saleId || "";
        var sale = readSale(saleId);
        var panel = scope.querySelector("[data-sales-journal-detail]");
        if (!panel || !sale) return;
        panel.dataset.saleId = saleId;
        renderDetail(panel, sale);
        hideDetailImmediately(scope);
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
    scope.querySelectorAll("[data-sales-detail-menu-edit]").forEach(function (trigger) {
      if (trigger.dataset.salesDetailMenuEditReady === "1") return;
      trigger.dataset.salesDetailMenuEditReady = "1";
      trigger.addEventListener("click", function () {
        var panel = trigger.closest("[data-sales-journal-detail]");
        var sale = panel ? readSale(panel.dataset.saleId || "") : null;
        closeDetailMenu(scope);
        openEditFromSale(sale);
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

    // Ссылка вида /sales?document=<id> открывает карточку документа сразу:
    // по таким ссылкам сюда приходят касса и карточка клиента в мессенджере.
    var requestedDocumentId = String(
      new URLSearchParams(window.location.search).get("document") || ""
    ).trim();
    if (requestedDocumentId && readSale(requestedDocumentId)) {
      openDetail(scope, requestedDocumentId);
      // Без анимации: requestAnimationFrame в фоновой вкладке не срабатывает,
      // и открытая по ссылке карточка оставалась выдвинутой за экран.
      var requestedPanel = scope.querySelector("[data-sales-journal-detail]");
      var requestedBackdrop = scope.querySelector(".sales-document-detail-backdrop");
      if (requestedPanel) requestedPanel.classList.add("is-open");
      if (requestedBackdrop) requestedBackdrop.classList.add("is-open");
    }

    // Продажа только что создана из заказа: сразу открываем её на
    // редактирование, а после сохранения она уйдёт в отгрузку.
    var params = new URLSearchParams(window.location.search);
    if (params.get("edit_after") === "shipment") {
      var savedId = String(params.get("saved_id") || "").trim();
      var savedSale = savedId ? readSale(savedId) : null;
      if (savedSale) {
        openEditFromSale(savedSale, { nextStatus: "shipped" });
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(document); });
  } else {
    init(document);
  }
})();
