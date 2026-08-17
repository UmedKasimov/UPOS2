(function () {
  var quickProductTargetCombo = null;
  var quickClientTargetCombo = null;
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
    // Ноль по складу строки часто значит лишь, что стоки товара привязаны
    // к складу с другим названием (например, из iBox) — тогда показываем
    // суммарный остаток по всем складам.
    if (!total) total = stockTotal(product, "");
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

  function comboValueExists(combo, value) {
    var type = combo.getAttribute("data-sales-combobox") || "";
    var name = normalize(value);
    if (!name) return false;
    var options = readOptions();
    if (type === "client") {
      return (options.client_rows || []).some(function (row) {
        return normalize(row.name) === name;
      });
    }
    if (type === "product" || type === "service") {
      return (options.product_rows || []).some(function (row) {
        return productKind(row) === type && normalize(row.name) === name;
      });
    }
    return false;
  }

  function commitCombo(combo, value) {
    var input = combo.querySelector("[data-sales-combo-input]");
    if (!input) return;
    input.value = value || "";
    // Блокируем поле только под настоящую запись справочника: черновик с
    // недописанным названием оставлял readonly-поле, из которого список
    // товаров уже не открывался.
    setLocked(combo, comboValueExists(combo, input.value));
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
    var clientInput = root.querySelector('[data-sales-combobox="client"] [data-sales-combo-input]');
    if (clientInput) {
      if (item && item.id) clientInput.dataset.salesClientId = String(item.id);
      else if (!item) delete clientInput.dataset.salesClientId;
    }
    var segmentSelect = root.querySelector("[data-sales-segment-select]");
    if (segmentSelect) {
      segmentSelect.value = item ? String(item.business_segment_id || "") : "";
    }
    node.dataset.balanceKind = kind;
    node.hidden = !text;
    node.textContent = text ? String(item.balance_note || "Баланс") + ": " + text : "";
  }

  function clientCardTable(headers, rows, emptyText) {
    return (
      '<div class="sales-client-card-table-wrap"><table class="sales-client-card-table"><thead><tr>' +
      headers.map(function (header) { return "<th>" + escapeHtml(header) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      (rows.length ? rows.join("") : '<tr><td colspan="' + headers.length + '" class="sales-client-card-empty">' + escapeHtml(emptyText) + "</td></tr>") +
      "</tbody></table></div>"
    );
  }

  function clientCardField(label, name, value, type) {
    var input = type === "textarea"
      ? '<textarea name="' + name + '" rows="2">' + escapeHtml(value || "") + "</textarea>"
      : '<input type="' + (type || "text") + '" name="' + name + '" value="' + escapeHtml(value || "") + '" />';
    return '<label><span>' + escapeHtml(label) + "</span>" + input + "</label>";
  }

  function clientCardSelect(label, name, value, options) {
    var html = options.map(function (option) {
      var selected = String(value || "") === option[0] ? " selected" : "";
      return '<option value="' + escapeHtml(option[0]) + '"' + selected + ">" + escapeHtml(option[1]) + "</option>";
    }).join("");
    return '<label><span>' + escapeHtml(label) + '</span><select name="' + name + '">' + html + "</select></label>";
  }

  function clientCardEditForm(card) {
    // clients_save перезаписывает карточку целиком: поля, которых нет в форме,
    // затёрлись бы пустыми. Поэтому редкие атрибуты едут скрытыми полями.
    var hiddenNames = [
      "legal_name", "legal_address", "photo_url", "okved", "industry", "map_icon",
      "business_segment_id", "program", "is_blacklisted", "sort_order",
      "consignment_days", "cashback_percent", "delivery_frequency_days",
      "owner_user", "owner_group", "latitude", "longitude", "crm_status",
    ];
    var hidden = hiddenNames.map(function (name) {
      var raw = card[name];
      if (name === "is_blacklisted") raw = card.is_blacklisted ? "1" : "";
      return '<input type="hidden" name="' + name + '" value="' + escapeHtml(raw == null ? "" : String(raw)) + '" />';
    }).join("");
    var programs = Array.isArray(card.programs) ? card.programs : [];
    hidden += programs.map(function (program) {
      return '<input type="hidden" name="programs" value="' + escapeHtml(program) + '" />';
    }).join("");
    if (card.is_supplier) hidden += '<input type="hidden" name="is_supplier" value="1" />';

    return (
      '<form class="sales-client-card-form" data-sales-client-card-form data-client-id="' + escapeHtml(card.id || "") + '">' +
      hidden +
      '<input type="hidden" name="client_id" value="' + escapeHtml(card.id || "") + '" />' +
      '<input type="hidden" name="response" value="json" />' +
      '<div class="sales-client-card-form-grid">' +
      clientCardField("Название*", "name", card.name) +
      clientCardField("Официальное название", "official_name", card.official_name) +
      clientCardField("Телефон", "phone", card.phone) +
      clientCardField("Telegram", "telegram", card.telegram_phone || card.telegram) +
      clientCardField("Email", "email", card.email, "email") +
      clientCardField("ИНН", "tax_id", card.inn || card.tax_id) +
      clientCardField("ПИНФЛ", "pinfl", card.pinfl) +
      clientCardField("Категория", "category", card.category) +
      clientCardField("Территория", "territory", card.territory) +
      clientCardField("Маршрут", "route", card.route) +
      clientCardField("Прайс-лист", "price_type", card.price_type) +
      clientCardField("Кредитный лимит", "credit_limit", card.credit_limit) +
      clientCardField("Код", "code", card.code) +
      clientCardSelect("Тип клиента", "client_type", card.client_type, [["company", "Компания"], ["individual", "Физлицо"]]) +
      clientCardSelect("Статус", "status", card.status, [["active", "Активный"], ["inactive", "Неактивный"]]) +
      '<label class="wide"><span>Адрес</span><input type="text" name="address" value="' + escapeHtml(card.address || "") + '" /></label>' +
      '<label class="wide"><span>Комментарий</span><textarea name="note" rows="2">' + escapeHtml(card.note || card.comment || "") + "</textarea></label>" +
      "</div>" +
      '<div class="sales-client-card-form-actions">' +
      '<button class="btn" type="submit">Сохранить</button>' +
      '<span class="sales-client-card-form-status" data-sales-client-card-form-status></span>' +
      "</div>" +
      '<dl class="sales-client-card-info sales-client-card-readonly">' +
      "<div><dt>CRM статус</dt><dd>" + escapeHtml(card.crm_status_label || "-") + "</dd></div>" +
      "<div><dt>Последний документ</dt><dd>" + escapeHtml(card.last_date || "-") + "</dd></div>" +
      "<div><dt>Создан</dt><dd>" + escapeHtml(card.created_at || "-") + "</dd></div>" +
      "</dl>" +
      "</form>"
    );
  }

  function renderSalesClientCard(dialog, card) {
    var title = dialog.querySelector("[data-sales-client-card-title]");
    var metrics = dialog.querySelector("[data-sales-client-card-metrics]");
    var tabs = dialog.querySelector("[data-sales-client-card-tabs]");
    var panels = dialog.querySelector("[data-sales-client-card-panels]");
    var content = dialog.querySelector("[data-sales-client-card-content]");
    var loading = dialog.querySelector("[data-sales-client-card-loading]");
    var error = dialog.querySelector("[data-sales-client-card-error]");
    var summary = card.summary || {};
    var balanceLines = Array.isArray(card.balance_lines) ? card.balance_lines : [];
    if (title) title.textContent = card.name || "Клиент";
    if (metrics) {
      var balance = balanceLines.length
        ? balanceLines.map(function (line) { return escapeHtml(line.amount_abs || line.amount || "0") + " " + escapeHtml(line.currency || "UZS"); }).join(" / ")
        : escapeHtml(card.balance_abs || "0") + " UZS";
      metrics.innerHTML = [
        ["Баланс", balance, escapeHtml(card.balance_note || "")],
        ["Продажи", escapeHtml(summary.sales || "0") + " UZS", ""],
        ["Оплачено", escapeHtml(summary.paid || "0") + " UZS", ""],
        ["Заказы / задачи", escapeHtml(summary.orders_count || 0) + " / " + escapeHtml(summary.tasks_count || 0), ""],
      ].map(function (item) {
        return '<div><span>' + item[0] + '</span><strong>' + item[1] + '</strong><small>' + item[2] + '</small></div>';
      }).join("");
    }

    var documents = [].concat(card.orders || [], card.sales || [], card.returns || []);
    var documentRows = documents.map(function (row) {
      return '<tr><td><strong>' + escapeHtml(row.number || "-") + '</strong></td><td>' + escapeHtml(row.doc_type_label || "-") + '</td><td>' + escapeHtml(row.date || "-") + '</td><td>' + escapeHtml(row.amount || "0") + " " + escapeHtml(row.currency || "UZS") + '</td><td>' + escapeHtml(row.status_label || "-") + '</td></tr>';
    });
    var reconciliationRows = (card.reconciliation || []).map(function (row) {
      return '<tr><td>' + escapeHtml(row.date || "-") + '</td><td><strong>' + escapeHtml(row.document || "-") + '</strong></td><td>' + escapeHtml(row.debit || "0") + " " + escapeHtml(row.currency || "UZS") + '</td><td>' + escapeHtml(row.credit || "0") + " " + escapeHtml(row.currency || "UZS") + '</td><td>' + escapeHtml(row.balance || "0") + " " + escapeHtml(row.currency || "UZS") + '</td></tr>';
    });
    var taskRows = (card.tasks || []).map(function (row) {
      return '<tr><td><strong>' + escapeHtml(row.title || "-") + '</strong><small>' + escapeHtml(row.note || row.stage || "") + '</small></td><td>' + escapeHtml(row.responsible || "-") + '</td><td>' + escapeHtml(row.due_date || row.date || "-") + '</td><td>' + escapeHtml(row.status_label || "-") + '</td></tr>';
    });
    var conversationItems = [].concat(card.conversations || [], card.correspondence || [], card.calls || []);
    var conversationHtml = conversationItems.length ? conversationItems.map(function (row) {
      return '<article class="sales-client-card-event"><strong>' + escapeHtml(row.channel || row.direction_label || "CRM") + '</strong><span>' + escapeHtml(row.title || row.phone || row.username || "Контакт") + '</span><small>' + escapeHtml(row.started_at || row.note || row.status || row.status_label || "") + '</small></article>';
    }).join("") : '<p class="sales-client-card-empty">Переписок и звонков пока нет.</p>';
    var historyHtml = (card.history || []).length ? (card.history || []).map(function (row) {
      return '<article class="sales-client-card-event"><time>' + escapeHtml(row.date || "-") + '</time><strong>' + escapeHtml(row.title || "Событие") + '</strong><span>' + escapeHtml(row.detail || "") + '</span><small>' + escapeHtml([row.amount, row.status].filter(Boolean).join(" · ")) + '</small></article>';
    }).join("") : '<p class="sales-client-card-empty">История пока пуста.</p>';
    var infoHtml = clientCardEditForm(card);
    var sections = [
      ["info", "Информация", infoHtml],
      ["documents", "Документы", clientCardTable(["№", "Тип", "Дата", "Сумма", "Статус"], documentRows, "Документов пока нет.")],
      ["reconciliation", "Акт сверки", clientCardTable(["Дата", "Документ", "Дебит", "Кредит", "Баланс"], reconciliationRows, "Операций пока нет.")],
      ["tasks", "Задачи", clientCardTable(["Задача", "Исполнитель", "Срок", "Статус"], taskRows, "Задач пока нет.")],
      ["messages", "Переписка", '<div class="sales-client-card-events">' + conversationHtml + '</div>'],
      ["notes", "Заметки", '<div class="sales-client-card-note">' + escapeHtml(card.comment || card.note || "Заметок пока нет.") + '</div>'],
      ["history", "История", '<div class="sales-client-card-events">' + historyHtml + '</div>'],
    ];
    if (tabs) tabs.innerHTML = sections.map(function (section, index) {
      return '<button type="button" data-sales-client-card-tab="' + section[0] + '" class="' + (index === 0 ? "active" : "") + '" aria-selected="' + (index === 0 ? "true" : "false") + '">' + section[1] + '</button>';
    }).join("");
    if (panels) panels.innerHTML = sections.map(function (section, index) {
      return '<section data-sales-client-card-panel="' + section[0] + '"' + (index === 0 ? "" : " hidden") + '>' + section[2] + '</section>';
    }).join("");
    if (loading) loading.hidden = true;
    if (error) error.hidden = true;
    if (content) content.hidden = false;
  }

  function submitClientCardForm(root, dialog, form) {
    var url = String(root.dataset.salesClientSaveUrl || "");
    var status = form.querySelector("[data-sales-client-card-form-status]");
    var submit = form.querySelector('button[type="submit"]');
    if (!url) return;
    var body = new FormData(form);
    var csrfInput = root.querySelector('input[name="csrf_token"]');
    body.set("csrf_token", csrfInput ? csrfInput.value : "");
    if (status) {
      status.textContent = "Сохраняем...";
      status.className = "sales-client-card-form-status";
    }
    if (submit) submit.disabled = true;
    fetch(url, {method: "POST", body: body, headers: {Accept: "application/json"}})
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok || !payload.ok) throw new Error(payload.error || "Не удалось сохранить");
          return payload;
        });
      })
      .then(function (payload) {
        if (status) {
          status.textContent = "Сохранено";
          status.className = "sales-client-card-form-status is-ok";
        }
        var title = dialog.querySelector("[data-sales-client-card-title]");
        if (title && payload.client && payload.client.name) title.textContent = payload.client.name;
        // Метрики и списки считаются на сервере — перечитываем карточку целиком.
        var template = String(root.dataset.salesClientCardUrlTemplate || "");
        var clientId = form.getAttribute("data-client-id") || "";
        if (template && clientId) {
          fetch(template.replace("__client_id__", encodeURIComponent(clientId)), {headers: {Accept: "application/json"}})
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (card) {
              if (!card) return;
              renderSalesClientCard(dialog, card);
              activateSalesClientCardTab(dialog, "info");
              var freshStatus = dialog.querySelector("[data-sales-client-card-form-status]");
              if (freshStatus) {
                freshStatus.textContent = "Сохранено";
                freshStatus.className = "sales-client-card-form-status is-ok";
              }
            })
            .catch(function () {});
        }
      })
      .catch(function (error) {
        if (status) {
          status.textContent = error.message || "Не удалось сохранить";
          status.className = "sales-client-card-form-status is-error";
        }
      })
      .then(function () {
        if (submit) submit.disabled = false;
      });
  }

  function activateSalesClientCardTab(dialog, tabName) {
    dialog.querySelectorAll("[data-sales-client-card-tab]").forEach(function (button) {
      var active = button.getAttribute("data-sales-client-card-tab") === tabName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    dialog.querySelectorAll("[data-sales-client-card-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-sales-client-card-panel") !== tabName;
    });
  }

  function closeSalesClientCard(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function openSalesClientCard(root, clientId) {
    var dialog = document.querySelector("[data-sales-client-card-dialog]");
    var template = String(root.dataset.salesClientCardUrlTemplate || "");
    if (!dialog || !clientId || !template) return;
    var loading = dialog.querySelector("[data-sales-client-card-loading]");
    var content = dialog.querySelector("[data-sales-client-card-content]");
    var error = dialog.querySelector("[data-sales-client-card-error]");
    if (loading) loading.hidden = false;
    if (content) content.hidden = true;
    if (error) error.hidden = true;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    fetch(template.replace("__client_id__", encodeURIComponent(clientId)), {headers: {Accept: "application/json"}})
      .then(function (response) {
        if (!response.ok) throw new Error("client_card");
        return response.json();
      })
      .then(function (card) { renderSalesClientCard(dialog, card || {}); })
      .catch(function () {
        if (loading) loading.hidden = true;
        if (content) content.hidden = true;
        if (error) error.hidden = false;
      });
  }

  function rowProductValue(row) {
    var input = row ? row.querySelector('[data-sales-combobox="product"] [data-sales-combo-input]') : null;
    if (!input && row) input = row.querySelector('[data-sales-combobox="service"] [data-sales-combo-input]');
    return input ? input.value.trim() : "";
  }

  function syncRowState(row) {
    if (!row) return;
    var isEmpty = !rowProductValue(row);
    var isProductSearch = isEmpty && (row.getAttribute("data-sales-line-kind") || "product") === "product";
    var removeButton = row.querySelector("[data-sales-line-remove]");
    row.classList.toggle("is-empty", isEmpty);
    row.classList.toggle("is-search-row", isProductSearch);
    if (removeButton) {
      removeButton.hidden = isProductSearch;
      removeButton.disabled = isProductSearch;
    }
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
    if (row && row.dataset.salesSubscriptionMonthly) {
      var subscriptionPrice = convertPrice(
        row.dataset.salesSubscriptionMonthly,
        row.dataset.salesSubscriptionCurrency || selectedCurrency(root),
        selectedCurrency(root),
        options
      );
      var subscriptionMonths = Math.max(1, Math.floor(numberValue(row.dataset.salesSubscriptionMonths) || 1));
      var subscriptionPriceInput = row.querySelector('input[name="line_price"]');
      if (subscriptionPriceInput) {
        subscriptionPriceInput.value = formatMoney(subscriptionPrice * subscriptionMonths, selectedCurrency(root));
      }
      row.dataset.salesBasePrice = String(numberValue(row.dataset.salesSubscriptionMonthly) * subscriptionMonths);
      row.dataset.salesBaseCurrency = row.dataset.salesSubscriptionCurrency || selectedCurrency(root);
      return;
    }
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
          delete row.dataset.salesSubscriptionMonthly;
          delete row.dataset.salesSubscriptionCurrency;
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
    clearSubscriptionLine(row);
    syncRowState(row);
  }

  function clearSubscriptionLine(row) {
    if (!row) return;
    ["line_subscription_program", "line_subscription_plan", "line_subscription_months"].forEach(function (name) {
      var input = row.querySelector('input[name="' + name + '"]');
      if (input) input.value = "";
    });
    delete row.dataset.salesSubscriptionMonthly;
    delete row.dataset.salesSubscriptionCurrency;
    delete row.dataset.salesSubscriptionMonths;
    var meta = row.querySelector("[data-sales-subscription-line-meta]");
    if (meta) {
      meta.textContent = "";
      meta.hidden = true;
    }
  }

  function removeLine(root, row, options) {
    if (!row) return;
    if (root.dataset.salesApplyingTotal !== "1") clearManualTotal(root, false);
    var kind = row.getAttribute("data-sales-line-kind") || "product";
    if (kind === "product" && !rowProductValue(row)) return;
    var rows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="' + kind + '"]'));
    if (kind === "product" && rows.length <= 1) {
      clearLine(row);
    } else {
      row.remove();
    }
    if (kind === "product") {
      var productRows = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"]'));
      if (productRows.length && !productRows.some(function (item) { return !rowProductValue(item); })) {
        cloneLine(root, productRows[productRows.length - 1], options);
      }
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
    clearSubscriptionLine(row);
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
    var subscriptionProgram = row.querySelector('input[name="line_subscription_program"]');
    var subscriptionPlan = row.querySelector('input[name="line_subscription_plan"]');
    var subscriptionMonths = row.querySelector('input[name="line_subscription_months"]');
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
      priceTypeId: row.dataset.salesPriceTypeId || "",
      subscriptionProgram: subscriptionProgram ? subscriptionProgram.value || "" : "",
      subscriptionPlan: subscriptionPlan ? subscriptionPlan.value || "" : "",
      subscriptionMonths: subscriptionMonths ? subscriptionMonths.value || "" : "",
      subscriptionMonthly: row.dataset.salesSubscriptionMonthly || "",
      subscriptionCurrency: row.dataset.salesSubscriptionCurrency || ""
    };
  }

  function hasDraftLine(line) {
    return !!(line && (String(line.product || "").trim() || String(line.quantity || "").trim() || String(line.price || "").trim() || numberValue(line.discountValue)));
  }

  function collectSalesDraft(root) {
    return {
      documentId: root.querySelector('input[name="sale_id"]')?.value || "",
      docType: root.querySelector('input[name="doc_type"]')?.value || "sale",
      number: root.querySelector('input[name="number"]')?.value || "",
      crmRecordId: root.querySelector('input[name="crm_record_id"]')?.value || "",
      sourceSaleId: root.querySelector('input[name="source_sale_id"]')?.value || "",
      nextStatus: root.querySelector("[data-sales-next-status]")?.value || "",
      date: root.querySelector('input[name="date"]')?.value || "",
      dateTo: root.querySelector('input[name="date_to"]')?.value || "",
      client: root.querySelector('[data-sales-combobox="client"] [data-sales-combo-input]')?.value || "",
      businessSegmentId: root.querySelector("[data-sales-segment-select]")?.value || "",
      installerUserId: root.querySelector('select[name="installer_user_id"]')?.value || "",
      installationScheduledAt: root.querySelector('input[name="installation_scheduled_at"]')?.value || "",
      installationTemplateId: root.querySelector('select[name="installation_template_id"]')?.value || "",
      installationPriority: root.querySelector('select[name="installation_priority"]')?.value || "normal",
      installationNotes: root.querySelector('textarea[name="installation_notes"]')?.value || "",
      installationAttachmentUrls: root.querySelector('textarea[name="installation_attachment_urls"]')?.value || "",
      currency: root.querySelector('select[name="currency"]')?.value || "",
      priceTypeId: root.querySelector('select[name="price_type_id"]')?.value || "",
      paidAmount: root.querySelector("[data-sales-paid-amount]")?.value || "",
      paymentType: root.querySelector("[data-sales-payment-type]")?.value || "",
      paymentLines: root.querySelector("[data-sales-payment-lines]")?.value || "",
      note: root.querySelector('textarea[name="note"]')?.value || "",
      installmentEnabled: root.querySelector("[data-sales-installment-enabled]")?.value || "0",
      installmentMonths: root.querySelector("[data-sales-installment-months-field]")?.value || "",
      installmentInitial: root.querySelector("[data-sales-installment-initial-field]")?.value || "",
      installmentMarkup: root.querySelector("[data-sales-installment-markup-field]")?.value || "",
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
      return ["saved", "order_saved", "return_saved", "updated"].indexOf(new URLSearchParams(window.location.search).get("msg")) >= 0;
    } catch (_) {
      return false;
    }
  }

  function writeOptions(options) {
    var node = document.getElementById("sales-form-options");
    if (node) node.textContent = JSON.stringify(options || {});
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
    var subscriptionProgram = row.querySelector('input[name="line_subscription_program"]');
    var subscriptionPlan = row.querySelector('input[name="line_subscription_plan"]');
    var subscriptionMonths = row.querySelector('input[name="line_subscription_months"]');
    if (subscriptionProgram) subscriptionProgram.value = line.subscriptionProgram || "";
    if (subscriptionPlan) subscriptionPlan.value = line.subscriptionPlan || "";
    if (subscriptionMonths) subscriptionMonths.value = line.subscriptionMonths || "";
    if (line.subscriptionMonthly) row.dataset.salesSubscriptionMonthly = line.subscriptionMonthly;
    if (line.subscriptionCurrency) row.dataset.salesSubscriptionCurrency = line.subscriptionCurrency;
    if (line.subscriptionMonths) row.dataset.salesSubscriptionMonths = line.subscriptionMonths;
    var subscriptionMeta = row.querySelector("[data-sales-subscription-line-meta]");
    if (subscriptionMeta && (line.subscriptionProgram || line.subscriptionPlan)) {
      subscriptionMeta.textContent = [line.subscriptionProgram, line.subscriptionPlan, line.subscriptionMonths ? line.subscriptionMonths + " мес." : ""].filter(Boolean).join(" · ");
      subscriptionMeta.hidden = false;
    }
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
    setDraftField(root, 'input[name="sale_id"]', draft.documentId);
    setDraftField(root, 'input[name="doc_type"]', draft.docType);
    setDraftField(root, 'input[name="number"]', draft.number);
    setDraftField(root, 'input[name="crm_record_id"]', draft.crmRecordId);
    setDraftField(root, 'input[name="source_sale_id"]', draft.sourceSaleId);
    // Продажа из заказа: после сохранения сразу уходит в отгрузку.
    setDraftField(root, "[data-sales-next-status]", draft.nextStatus || "");
    setDraftField(root, 'input[name="date"]', draft.date);
    setDraftField(root, 'input[name="date_to"]', draft.dateTo);
    var restoredDate = root.querySelector('input[name="date"]');
    if (restoredDate) {
      // The custom date picker is enhanced before the saved draft is restored.
      // Notify it after both date fields are populated so the visible label and
      // the submitted values cannot disagree.
      restoredDate.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setDraftField(root, 'select[name="installer_user_id"]', draft.installerUserId);
    setDraftField(root, 'input[name="installation_scheduled_at"]', draft.installationScheduledAt);
    setDraftField(root, 'select[name="installation_template_id"]', draft.installationTemplateId);
    setDraftField(root, 'select[name="installation_priority"]', draft.installationPriority);
    setDraftField(root, 'textarea[name="installation_notes"]', draft.installationNotes);
    setDraftField(root, 'textarea[name="installation_attachment_urls"]', draft.installationAttachmentUrls);
    setDraftField(root, 'select[name="currency"]', draft.currency);
    setDraftField(root, 'select[name="price_type_id"]', draft.priceTypeId);
    setDraftField(root, "[data-sales-paid-amount]", draft.paidAmount);
    setDraftField(root, "[data-sales-payment-type]", draft.paymentType);
    setDraftField(root, "[data-sales-payment-lines]", draft.paymentLines);
    setDraftField(root, 'textarea[name="note"]', draft.note);
    // Рассрочку из черновика не восстанавливаем: она задаётся заново для
    // каждой продажи и раскрывается только нажатием «+ Рассрочка». Иначе
    // блок наследовался от прошлой продажи и открывался сам.
    setDraftField(root, "[data-sales-installment-enabled]", "0");
    setDraftField(root, "[data-sales-installment-months-field]", "");
    setDraftField(root, "[data-sales-installment-initial-field]", "");
    setDraftField(root, "[data-sales-installment-markup-field]", "");
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
    setDraftField(root, "[data-sales-segment-select]", draft.businessSegmentId);
    var editing = !!String(draft.documentId || "").trim();
    var typeLabel = draft.docType === "order" ? "заказа" : draft.docType === "return" ? "возврата" : "продажи";
    var title = root.closest("#sales-form")?.querySelector("[data-sales-form-title]");
    var submit = root.querySelector("[data-sales-form-submit]");
    if (editing && title) title.textContent = "Редактирование " + typeLabel + " " + (draft.number || "");
    if (editing && submit) submit.textContent = "Сохранить изменения";
    root.dataset.salesEditMode = editing ? "1" : "0";
    syncInstallationSection(root);
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
    updateInstallmentSummary(root);
    scheduleSalesDraft(root);
  }

  /* ── Рассрочка ───────────────────────────────────────────────────────────
     Итого — сумма позиций. Клиент вносит начальную сумму, на остаток
     начисляется процент, и результат делится на срок. */
  function installmentState(root) {
    var enabled = root.querySelector("[data-sales-installment-enabled]");
    return {
      on: String(enabled?.value || "0") === "1",
      months: Math.max(1, Math.round(numberValue(root.querySelector("[data-sales-installment-months-field]")?.value) || 1)),
      initial: Math.max(0, numberValue(root.querySelector("[data-sales-installment-initial-field]")?.value)),
      markup: Math.max(0, numberValue(root.querySelector("[data-sales-installment-markup-field]")?.value)),
    };
  }

  function installmentNumbers(root) {
    var state = installmentState(root);
    var currency = selectedCurrency(root);
    var total = roundCurrency(rowsTotal(root, false), currency);
    var initial = Math.min(state.initial, total);
    var rest = Math.max(total - initial, 0);
    var profit = roundCurrency((rest * state.markup) / 100, currency);
    var restTotal = roundCurrency(rest + profit, currency);
    return {
      currency: currency,
      months: state.months,
      total: total,
      initial: initial,
      rest: rest,
      profit: profit,
      restTotal: restTotal,
      grand: roundCurrency(initial + restTotal, currency),
      monthly: roundCurrency(restTotal / state.months, currency),
    };
  }

  function setMoneyText(root, selector, value, currency) {
    var node = root.querySelector(selector);
    if (node) node.textContent = formatMoney(value, currency) + " " + currency;
  }

  function updateInstallmentSummary(root) {
    var section = root.querySelector("[data-sales-installment-section]");
    if (!section) return;
    var state = installmentState(root);
    section.hidden = !state.on;
    var addButton = root.querySelector("[data-sales-installment-add]");
    if (addButton) addButton.hidden = state.on;
    if (!state.on) return;
    var numbers = installmentNumbers(root);
    var monthsInput = root.querySelector("[data-sales-installment-months]");
    if (monthsInput && document.activeElement !== monthsInput) monthsInput.value = String(numbers.months);
    // Расчёт показываем, когда условия заданы: пустая сводка с нулями
    // человеку ничего не говорила.
    var summary = root.querySelector("[data-sales-installment-summary]");
    if (summary) summary.hidden = !(state.initial || state.markup || state.months > 1);
    setMoneyText(root, "[data-sales-installment-total]", numbers.total, numbers.currency);
    setMoneyText(root, "[data-sales-installment-initial]", numbers.initial, numbers.currency);
    setMoneyText(root, "[data-sales-installment-rest]", numbers.rest, numbers.currency);
    setMoneyText(root, "[data-sales-installment-profit]", numbers.profit, numbers.currency);
    setMoneyText(root, "[data-sales-installment-rest-total]", numbers.restTotal, numbers.currency);
    setMoneyText(root, "[data-sales-installment-month]", numbers.monthly, numbers.currency);
  }

  function fillInstallmentDialog(root) {
    var dialog = document.querySelector("[data-sales-installment-dialog]");
    if (!dialog) return;
    var state = installmentState(root);
    var numbers = installmentNumbers(root);
    var setValue = function (selector, value) {
      var node = dialog.querySelector(selector);
      if (node) node.value = value;
    };
    setValue("[data-sales-installment-dialog-total]", formatMoney(numbers.total, numbers.currency) + " " + numbers.currency);
    setValue("[data-sales-installment-dialog-initial]", state.initial ? formatMoney(state.initial, numbers.currency) : "");
    setValue("[data-sales-installment-dialog-rest]", formatMoney(numbers.rest, numbers.currency) + " " + numbers.currency);
    setValue("[data-sales-installment-dialog-markup]", state.markup ? String(state.markup) : "");
    setValue("[data-sales-installment-dialog-months]", String(numbers.months));
    setValue("[data-sales-installment-dialog-month]", formatMoney(numbers.monthly, numbers.currency) + " " + numbers.currency);
    var restTotal = dialog.querySelector("[data-sales-installment-dialog-rest-total]");
    if (restTotal) restTotal.textContent = formatMoney(numbers.restTotal, numbers.currency) + " " + numbers.currency;
    var grand = dialog.querySelector("[data-sales-installment-dialog-grand]");
    if (grand) grand.textContent = formatMoney(numbers.grand, numbers.currency) + " " + numbers.currency;
  }

  function recalcInstallmentDialog(root) {
    var dialog = document.querySelector("[data-sales-installment-dialog]");
    if (!dialog) return;
    var currency = selectedCurrency(root);
    var total = roundCurrency(rowsTotal(root, false), currency);
    var initial = Math.min(Math.max(numberValue(dialog.querySelector("[data-sales-installment-dialog-initial]")?.value), 0), total);
    var markup = Math.max(numberValue(dialog.querySelector("[data-sales-installment-dialog-markup]")?.value), 0);
    var months = Math.max(1, Math.round(numberValue(dialog.querySelector("[data-sales-installment-dialog-months]")?.value) || 1));
    var rest = Math.max(total - initial, 0);
    var restTotal = roundCurrency(rest + (rest * markup) / 100, currency);
    var set = function (selector, value) {
      var node = dialog.querySelector(selector);
      if (node) node.value = formatMoney(value, currency) + " " + currency;
    };
    set("[data-sales-installment-dialog-rest]", rest);
    set("[data-sales-installment-dialog-month]", roundCurrency(restTotal / months, currency));
    var restNode = dialog.querySelector("[data-sales-installment-dialog-rest-total]");
    if (restNode) restNode.textContent = formatMoney(restTotal, currency) + " " + currency;
    var grandNode = dialog.querySelector("[data-sales-installment-dialog-grand]");
    if (grandNode) grandNode.textContent = formatMoney(roundCurrency(initial + restTotal, currency), currency) + " " + currency;
  }

  function openInstallmentDialog(root) {
    var dialog = document.querySelector("[data-sales-installment-dialog]");
    if (!dialog) return;
    fillInstallmentDialog(root);
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch (_) {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeInstallmentDialog() {
    var dialog = document.querySelector("[data-sales-installment-dialog]");
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function wireInstallment(root) {
    if (root.dataset.salesInstallmentReady === "1") return;
    root.dataset.salesInstallmentReady = "1";
    var enabledField = root.querySelector("[data-sales-installment-enabled]");
    var monthsField = root.querySelector("[data-sales-installment-months-field]");
    var initialField = root.querySelector("[data-sales-installment-initial-field]");
    var markupField = root.querySelector("[data-sales-installment-markup-field]");
    var dialog = document.querySelector("[data-sales-installment-dialog]");

    root.querySelector("[data-sales-installment-add]")?.addEventListener("click", function () {
      // Нажатие открывает блок рассрочки: срок и кнопка «Условия рассрочки».
      // Расчёт появляется, когда условия заданы.
      if (enabledField) enabledField.value = "1";
      if (monthsField && !monthsField.value) monthsField.value = "1";
      updateInstallmentSummary(root);
      scheduleSalesDraft(root);
    });
    root.querySelector("[data-sales-installment-remove]")?.addEventListener("click", function () {
      if (enabledField) enabledField.value = "0";
      if (monthsField) monthsField.value = "";
      if (initialField) initialField.value = "";
      if (markupField) markupField.value = "";
      updateInstallmentSummary(root);
      scheduleSalesDraft(root);
    });
    root.querySelector("[data-sales-installment-open]")?.addEventListener("click", function () {
      openInstallmentDialog(root);
    });
    root.querySelector("[data-sales-installment-months]")?.addEventListener("input", function (event) {
      if (monthsField) monthsField.value = String(Math.max(1, Math.round(numberValue(event.target.value) || 1)));
      updateInstallmentSummary(root);
      scheduleSalesDraft(root);
    });
    root.querySelector("[data-sales-installment-details-toggle]")?.addEventListener("click", function (event) {
      var details = root.querySelector("[data-sales-installment-details]");
      if (!details) return;
      details.hidden = !details.hidden;
      event.target.textContent = details.hidden ? "Показать детали" : "Скрыть детали";
    });

    if (dialog) {
      dialog.querySelectorAll("[data-sales-installment-close]").forEach(function (button) {
        button.addEventListener("click", closeInstallmentDialog);
      });
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeInstallmentDialog();
      });
      ["[data-sales-installment-dialog-initial]", "[data-sales-installment-dialog-markup]", "[data-sales-installment-dialog-months]"].forEach(function (selector) {
        dialog.querySelector(selector)?.addEventListener("input", function () {
          recalcInstallmentDialog(root);
        });
      });
      dialog.querySelector("[data-sales-installment-save]")?.addEventListener("click", function () {
        var initial = Math.max(numberValue(dialog.querySelector("[data-sales-installment-dialog-initial]")?.value), 0);
        var markup = Math.max(numberValue(dialog.querySelector("[data-sales-installment-dialog-markup]")?.value), 0);
        var months = Math.max(1, Math.round(numberValue(dialog.querySelector("[data-sales-installment-dialog-months]")?.value) || 1));
        if (enabledField) enabledField.value = "1";
        if (initialField) initialField.value = String(initial);
        if (markupField) markupField.value = String(markup);
        if (monthsField) monthsField.value = String(months);
        closeInstallmentDialog();
        updateInstallmentSummary(root);
        scheduleSalesDraft(root);
      });
    }
    updateInstallmentSummary(root);
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

  function applyProductSelection(root, combo, options, item, allowDuplicate) {
    if (!combo || !item) return;
    if (root.dataset.salesApplyingTotal !== "1") clearManualTotal(root, false);
    var comboType = combo.getAttribute("data-sales-combobox") === "service" ? "service" : "product";
    var line = combo.closest(".sales-line-grid");
    if (!allowDuplicate && selectedLineNames(root, comboType, line).indexOf(normalize(item.name)) !== -1) {
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

  function setClientCreateStatus(form, text, kind) {
    var status = form?.querySelector("[data-sales-client-create-status]");
    if (!status) return;
    status.textContent = text || "";
    status.dataset.status = kind || "";
  }

  function upsertClientOption(client) {
    if (!client || !client.name) return;
    var options = readOptions();
    var rows = Array.isArray(options.client_rows) ? options.client_rows : [];
    var index = rows.findIndex(function (item) {
      return normalize(item.id) === normalize(client.id) || normalize(item.name) === normalize(client.name);
    });
    var next = Object.assign({
      id: "",
      name: "",
      phone: "",
      tax_id: "",
      price_type: "",
      business_segment_id: "",
      business_segment: "",
      business_segment_icon: "",
      balance_kind: "zero",
      balance_note: "Баланс: 0",
      balance: "0",
      balance_lines: [],
    }, client);
    if (index >= 0) rows[index] = Object.assign({}, rows[index], next);
    else rows.push(next);
    rows.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), "ru");
    });
    options.client_rows = rows;
    options.clients = Array.from(new Set([...(options.clients || []), next.name].filter(Boolean))).sort(function (a, b) {
      return String(a || "").localeCompare(String(b || ""), "ru");
    });
    writeOptions(options);
  }

  function closeClientCreateDialog() {
    var dialog = document.querySelector("[data-sales-client-create-dialog]");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
    quickClientTargetCombo = null;
  }

  function openClientCreateDialog(root, combo, query) {
    var dialog = document.querySelector("[data-sales-client-create-dialog]");
    var form = dialog?.querySelector("[data-sales-client-create-form]");
    if (!dialog || !form) return;
    quickClientTargetCombo = combo || root.querySelector('[data-sales-combobox="client"]');
    closePanel(quickClientTargetCombo);
    form.reset();
    var nameInput = form.querySelector("[data-sales-client-create-name]");
    if (nameInput) nameInput.value = String(query || "").trim();
    var clientSegment = form.querySelector("[data-sales-client-segment-select]");
    var selectedSegment = root.querySelector("[data-sales-segment-select]");
    if (clientSegment && selectedSegment) clientSegment.value = selectedSegment.value;
    setClientCreateStatus(form, "", "");
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

  function wireClientCreateDialog(root) {
    var dialog = document.querySelector("[data-sales-client-create-dialog]");
    var form = dialog?.querySelector("[data-sales-client-create-form]");
    if (!dialog || !form || dialog.dataset.salesClientCreateReady === "1") return;
    dialog.dataset.salesClientCreateReady = "1";
    dialog.querySelectorAll("[data-sales-client-create-close], [data-sales-client-create-cancel]").forEach(function (button) {
      button.addEventListener("click", closeClientCreateDialog);
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeClientCreateDialog();
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var submit = form.querySelector("[data-sales-client-create-submit]");
      var endpoint = root.getAttribute("data-sales-client-save-url") || "/clients/save";
      setClientCreateStatus(form, "Сохраняю...", "");
      if (submit) submit.disabled = true;
      fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" },
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok || !body.client) throw new Error(body.error || "Не удалось сохранить клиента");
            return body.client;
          });
        })
        .then(function (client) {
          upsertClientOption(client);
          var combo = quickClientTargetCombo && document.contains(quickClientTargetCombo)
            ? quickClientTargetCombo
            : root.querySelector('[data-sales-combobox="client"]');
          commitCombo(combo, client.name || "");
          updateClientBalance(root, client);
          setClientCreateStatus(form, "Сохранено", "ok");
          closeClientCreateDialog();
        })
        .catch(function (error) {
          setClientCreateStatus(form, error.message || "Не удалось сохранить клиента", "err");
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  }

  function setSegmentStatus(form, text, kind) {
    var status = form?.querySelector("[data-sales-segment-status]");
    if (!status) return;
    status.textContent = text || "";
    status.dataset.status = kind || "";
  }

  function closeSegmentDialog() {
    var dialog = document.querySelector("[data-sales-segment-dialog]");
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    dialog.removeAttribute("open");
  }

  function syncSegmentOptions(segment) {
    if (!segment || !segment.id || !segment.name) return;
    document.querySelectorAll("[data-sales-segment-select], [data-sales-client-segment-select]").forEach(function (select) {
      var option = Array.from(select.options).find(function (item) {
        return String(item.value) === String(segment.id);
      });
      if (!option) {
        option = document.createElement("option");
        option.value = String(segment.id);
        select.appendChild(option);
      }
      option.textContent = [segment.icon || "", segment.name].filter(Boolean).join(" ");
    });
    var options = readOptions();
    var segments = Array.isArray(options.business_segments) ? options.business_segments : [];
    var index = segments.findIndex(function (item) {
      return String(item.id) === String(segment.id) || normalize(item.name) === normalize(segment.name);
    });
    if (index >= 0) segments[index] = Object.assign({}, segments[index], segment);
    else segments.push(segment);
    options.business_segments = segments;
    writeOptions(options);
  }

  function openSegmentDialog() {
    var dialog = document.querySelector("[data-sales-segment-dialog]");
    var form = dialog?.querySelector("[data-sales-segment-form]");
    if (!dialog || !form) return;
    form.reset();
    setSegmentStatus(form, "", "");
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
      form.querySelector("[data-sales-segment-name]")?.focus();
    }, 0);
  }

  function wireSegmentDialog(root) {
    var dialog = document.querySelector("[data-sales-segment-dialog]");
    var form = dialog?.querySelector("[data-sales-segment-form]");
    if (!dialog || !form || dialog.dataset.salesSegmentReady === "1") return;
    dialog.dataset.salesSegmentReady = "1";
    root.querySelector("[data-sales-segment-create-open]")?.addEventListener("click", openSegmentDialog);
    dialog.querySelectorAll("[data-sales-segment-close], [data-sales-segment-cancel]").forEach(function (button) {
      button.addEventListener("click", closeSegmentDialog);
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeSegmentDialog();
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var submit = form.querySelector("[data-sales-segment-submit]");
      setSegmentStatus(form, "Сохраняю...", "");
      if (submit) submit.disabled = true;
      fetch(root.getAttribute("data-sales-segment-save-url") || "/api/sales/business-segments", {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" },
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (body) {
            if (!response.ok || !body.segment) throw new Error(body.error || "Не удалось сохранить сегмент");
            return body.segment;
          });
        })
        .then(function (segment) {
          syncSegmentOptions(segment);
          var select = root.querySelector("[data-sales-segment-select]");
          if (select) select.value = String(segment.id);
          setSegmentStatus(form, "Сегмент добавлен", "ok");
          closeSegmentDialog();
          scheduleSalesDraft(root);
        })
        .catch(function (error) {
          setSegmentStatus(form, error.message || "Не удалось сохранить сегмент", "err");
        })
        .finally(function () {
          if (submit) submit.disabled = false;
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
    var createButton = combo.querySelector("[data-sales-client-create-open]");
    if (createButton && type === "client") {
      createButton.addEventListener("mousedown", function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      createButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openClientCreateDialog(root, combo, input.value);
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

  function paymentListTotalInCurrency(payments, targetCurrency) {
    var options = readOptions();
    var target = String(targetCurrency || "UZS").toUpperCase();
    return (Array.isArray(payments) ? payments : []).reduce(function (sum, item) {
      return sum + convertPrice(item.amount, item.currency || target, target, options);
    }, 0);
  }

  function paymentTotalInCurrency(root, targetCurrency) {
    return paymentListTotalInCurrency(collectPayments(root), targetCurrency || selectedCurrency(root));
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
    var paid = paymentListTotalInCurrency(items, currency);
    var debt = Math.max(0, total - paid);
    var totalOutput = box.querySelector("[data-sales-payment-breakdown-total]");
    var paidOutput = box.querySelector("[data-sales-payment-breakdown-paid]");
    var debtOutput = box.querySelector("[data-sales-payment-breakdown-debt]");
    var lines = box.querySelector("[data-sales-payment-breakdown-lines]");
    if (totalOutput) totalOutput.textContent = formatMoney(total, currency) + " " + currency;
    if (paidOutput) paidOutput.textContent = formatMoney(paid, currency) + " " + currency;
    if (debtOutput) debtOutput.textContent = formatMoney(debt, currency) + " " + currency;
    if (lines) {
      lines.innerHTML = "";
      items.forEach(function (item, index) {
        var amount = numberValue(item.amount);
        if (!amount) return;
        var row = document.createElement("div");
        row.className = "sales-payment-breakdown-row sales-payment-breakdown-row--line";
        var label = document.createElement("span");
        label.textContent = item.account || item.type || "Оплата " + String(index + 1);
        var value = document.createElement("strong");
        var itemCurrency = String(item.currency || currency).toUpperCase();
        value.textContent = formatMoney(amount, itemCurrency) + " " + itemCurrency;
        row.appendChild(label);
        row.appendChild(value);
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
      var defaultAccount = row.querySelector("[data-sales-payment-account]");
      var defaultCurrency = row.querySelector("[data-sales-payment-currency]");
      if (defaultAccount && defaultAccount.options.length) defaultAccount.selectedIndex = 0;
      setPaymentSelect(defaultCurrency, selectedCurrency(root));
      row.dataset.salesPaymentCurrency = paymentCurrency(row, root);
    }
    wrap.appendChild(row);
    wirePaymentLine(root, row);
    updatePaymentSummary(root);
    return row;
  }

  function resetPaymentLine(root, row) {
    if (!row) return;
    var amount = row.querySelector("[data-sales-payment-amount]");
    var account = row.querySelector("[data-sales-payment-account]");
    var currency = row.querySelector("[data-sales-payment-currency]");
    if (amount) amount.value = "";
    if (account && account.options.length) account.selectedIndex = 0;
    if (currency) {
      setPaymentSelect(currency, selectedCurrency(root));
      row.dataset.salesPaymentCurrency = paymentCurrency(row, root);
    }
  }

  function fillPaymentLine(root, row, values) {
    if (!row) return;
    var account = row.querySelector("[data-sales-payment-account]");
    var currency = row.querySelector("[data-sales-payment-currency]");
    var amount = row.querySelector("[data-sales-payment-amount]");
    var paymentCurrencyValue = String((values && values.currency) || selectedCurrency(root)).toUpperCase();
    setPaymentSelect(account, values ? values.account_id || values.account : "");
    setPaymentSelect(currency, paymentCurrencyValue);
    if (amount) {
      amount.value = values && numberValue(values.amount)
        ? formatMoney(numberValue(values.amount), paymentCurrencyValue)
        : "";
    }
    row.dataset.salesPaymentCurrency = paymentCurrency(row, root);
  }

  function hydratePaymentRows(root, payments) {
    var savedPayments = (Array.isArray(payments) ? payments : []).filter(function (item) {
      return item && numberValue(item.amount);
    });
    var first = ensureSingleEmptyPaymentLine(root);
    removeExtraPaymentLines(root);
    if (!first) return [];
    if (!savedPayments.length) {
      resetPaymentLine(root, first);
      return [first];
    }
    fillPaymentLine(root, first, savedPayments[0]);
    savedPayments.slice(1).forEach(function (item) {
      addPaymentLine(root, item);
    });
    return paymentRows(root);
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
    var savedPayments = parsePaymentLines(root);
    var rows = hydratePaymentRows(root, savedPayments);
    var first = rows[0] || ensureSingleEmptyPaymentLine(root);
    var currentPaid = numberValue(root.querySelector("[data-sales-paid-amount]")?.value || "");
    var total = rowsTotal(root, false);
    var amountInput;
    if (savedPayments.length) {
      var extraRow = addPaymentLine(root, null);
      amountInput = extraRow ? extraRow.querySelector("[data-sales-payment-amount]") : null;
    } else {
      amountInput = first ? first.querySelector("[data-sales-payment-amount]") : null;
      if (first) first.dataset.salesPaymentCurrency = paymentCurrency(first, root);
      if (amountInput && currentPaid) amountInput.value = formatMoney(currentPaid, selectedCurrency(root));
      else if (amountInput && total) amountInput.value = formatMoney(total, selectedCurrency(root));
    }
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

  function syncInstallationSection(root) {
    var section = root.querySelector("[data-sales-installation-section]");
    if (!section) return;
    var docType = root.querySelector('input[name="doc_type"]')?.value || "sale";
    var isOrder = docType === "order";
    section.hidden = !isOrder;
    section.querySelectorAll("input, select, textarea, button").forEach(function (control) {
      control.disabled = !isOrder;
    });
  }

  function installationDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function installationLocalDate(value) {
    var parts = String(value || "").slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function shortInstallationAddress(value) {
    var text = String(value || "").trim();
    if (!text) return "Адрес не указан";
    return text.length > 42 ? text.slice(0, 39).trimEnd() + "..." : text;
  }

  function wireInstallationCalendar(root) {
    var dialog = document.querySelector("[data-sales-installation-calendar-dialog]");
    var dateInput = root.querySelector("[data-sales-installation-date]");
    var installerSelect = root.querySelector("[data-sales-installation-installer]");
    if (!dialog || !dateInput || !installerSelect || dialog.dataset.salesCalendarReady === "1") return;
    dialog.dataset.salesCalendarReady = "1";

    var grid = dialog.querySelector("[data-sales-installation-calendar-grid]");
    var monthLabel = dialog.querySelector("[data-sales-installation-calendar-month]");
    var installerLabel = dialog.querySelector("[data-sales-installation-calendar-installer]");
    var status = dialog.querySelector("[data-sales-installation-calendar-status]");
    var selectedLabel = dialog.querySelector("[data-sales-installation-calendar-selected]");
    var timeInput = dialog.querySelector("[data-sales-installation-calendar-time]");
    var applyButton = dialog.querySelector("[data-sales-installation-calendar-apply]");
    var state = {
      orders: [],
      viewDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      selectedDate: null,
      requestId: 0
    };
    var monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
    var selectedFormatter = new Intl.DateTimeFormat("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

    function ordersByDate() {
      return state.orders.reduce(function (result, order) {
        var key = String(order.scheduled_at || "").slice(0, 10);
        if (!key) return result;
        if (!result[key]) result[key] = [];
        result[key].push(order);
        return result;
      }, {});
    }

    function render() {
      if (!grid) return;
      var monthStart = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth(), 1);
      var firstCell = new Date(monthStart);
      var mondayOffset = (monthStart.getDay() + 6) % 7;
      firstCell.setDate(firstCell.getDate() - mondayOffset);
      var grouped = ordersByDate();
      var todayKey = installationDateKey(new Date());
      var selectedKey = installationDateKey(state.selectedDate);
      monthLabel.textContent = monthFormatter.format(monthStart);
      grid.innerHTML = "";

      for (var index = 0; index < 42; index += 1) {
        var date = new Date(firstCell);
        date.setDate(firstCell.getDate() + index);
        var key = installationDateKey(date);
        var dayOrders = grouped[key] || [];
        var day = document.createElement("button");
        day.type = "button";
        day.className = "sales-installation-calendar-day";
        day.dataset.date = key;
        if (date.getMonth() !== monthStart.getMonth()) day.classList.add("is-outside");
        if (date.getDay() === 0 || date.getDay() === 6) day.classList.add("is-weekend");
        if (key === todayKey) day.classList.add("is-today");
        if (key === selectedKey) day.classList.add("is-selected");

        var number = document.createElement("span");
        number.className = "sales-installation-calendar-day-number";
        number.textContent = String(date.getDate());
        day.appendChild(number);

        var events = document.createElement("span");
        events.className = "sales-installation-calendar-events";
        dayOrders.slice(0, 3).forEach(function (order) {
          var event = document.createElement("span");
          event.className = "sales-installation-calendar-order";
          // Завершённая установка — зелёная с галочкой. Статуса «archived»
          // у установок нет, это был остаток от статусов документа продажи.
          if (String(order.status || "") === "completed") {
            event.classList.add("is-completed");
          }
          var client = order.client || {};
          var time = String(order.scheduled_at || "").slice(11, 16);
          var money = formatMoney(order.amount, order.currency || "UZS") + " " + String(order.currency || "UZS");
          // Статус в подсказке: по цвету видно «выполнено или нет», а тут
          // точная стадия — «В пути», «Ожидает оплаты» и прочие.
          event.title = [
            client.name || "Клиент",
            money,
            client.address || "Адрес не указан",
            order.status_label || ""
          ].filter(Boolean).join(" · ");
          event.innerHTML =
            '<strong>' + escapeHtml((time ? time + " " : "") + (client.name || "Клиент")) + "</strong>" +
            '<small>' + escapeHtml(money) + " · " + escapeHtml(shortInstallationAddress(client.address)) + "</small>";
          events.appendChild(event);
        });
        if (dayOrders.length > 3) {
          var more = document.createElement("span");
          more.className = "sales-installation-calendar-more";
          more.textContent = "+" + String(dayOrders.length - 3) + " заказа";
          events.appendChild(more);
        }
        day.appendChild(events);
        day.addEventListener("click", function () {
          state.selectedDate = installationLocalDate(this.dataset.date);
          state.viewDate = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth(), 1);
          selectedLabel.textContent = selectedFormatter.format(state.selectedDate);
          applyButton.disabled = false;
          render();
        });
        grid.appendChild(day);
      }
    }

    function loadSchedule() {
      var installerId = String(installerSelect.value || "").trim();
      var option = installerSelect.selectedOptions && installerSelect.selectedOptions[0];
      var installerName = option ? String(option.textContent || "").trim() : "";
      installerLabel.textContent = installerId
        ? "График: " + installerName
        : "Сначала выберите установщика";
      state.orders = [];
      render();
      if (!installerId) {
        status.textContent = "Выберите установщика, чтобы увидеть его занятые даты.";
        return;
      }
      var requestId = ++state.requestId;
      status.textContent = "Загружаем заказы установщика...";
      fetch("/api/installer/orders?installer_user_id=" + encodeURIComponent(installerId), {
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      })
        .then(function (response) {
          if (!response.ok) throw new Error("Не удалось загрузить календарь");
          return response.json();
        })
        .then(function (payload) {
          if (requestId !== state.requestId) return;
          state.orders = Array.isArray(payload.orders) ? payload.orders : [];
          status.textContent = state.orders.length
            ? "Назначено заказов: " + String(state.orders.length)
            : "У этого установщика пока нет назначенных заказов.";
          render();
        })
        .catch(function (error) {
          if (requestId !== state.requestId) return;
          status.textContent = error && error.message
            ? error.message
            : "Не удалось загрузить календарь.";
        });
    }

    function openCalendar() {
      var current = installationLocalDate(dateInput.value) || new Date();
      state.selectedDate = installationLocalDate(dateInput.value);
      state.viewDate = new Date(current.getFullYear(), current.getMonth(), 1);
      if (dateInput.value && String(dateInput.value).includes("T")) {
        timeInput.value = String(dateInput.value).split("T")[1].slice(0, 5) || "09:00";
      }
      selectedLabel.textContent = state.selectedDate
        ? selectedFormatter.format(state.selectedDate)
        : "Дата не выбрана";
      applyButton.disabled = !state.selectedDate;
      loadSchedule();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }

    function closeCalendar() {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }

    root.querySelectorAll("[data-sales-installation-calendar-open], [data-sales-installation-date]").forEach(function (control) {
      control.addEventListener("click", openCalendar);
    });
    installerSelect.addEventListener("change", function () {
      if (dialog.open) loadSchedule();
    });
    dialog.querySelector("[data-sales-installation-calendar-prev]")?.addEventListener("click", function () {
      state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() - 1, 1);
      render();
    });
    dialog.querySelector("[data-sales-installation-calendar-next]")?.addEventListener("click", function () {
      state.viewDate = new Date(state.viewDate.getFullYear(), state.viewDate.getMonth() + 1, 1);
      render();
    });
    dialog.querySelector("[data-sales-installation-calendar-today]")?.addEventListener("click", function () {
      var today = new Date();
      state.viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
      render();
    });
    dialog.querySelectorAll("[data-sales-installation-calendar-close], [data-sales-installation-calendar-cancel]").forEach(function (button) {
      button.addEventListener("click", closeCalendar);
    });
    applyButton.addEventListener("click", function () {
      if (!state.selectedDate) return;
      dateInput.value = installationDateKey(state.selectedDate) + "T" + (timeInput.value || "09:00");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
      closeCalendar();
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeCalendar();
    });
  }

  function salesSubscriptionCatalog(root, options) {
    var rows = (options.product_rows || []).filter(function (item) {
      return String(item.kind || "").toLowerCase() === "subscription";
    });
    var catalog = [];
    rows.forEach(function (item) {
      var modifiers = Array.isArray(item.subscription_modifiers) ? item.subscription_modifiers : [];
      if (!modifiers.length) {
        var fallback = productPrice(item, selectedPriceTypeId(root));
        modifiers = [{
          name: item.name || "Подписка",
          description: "",
          amount: fallback.price || "",
          currency: fallback.currency || selectedCurrency(root)
        }];
      }
      modifiers.forEach(function (modifier) {
        var amount = numberValue(modifier.amount);
        if (!amount) return;
        var planName = String(modifier.name || item.name || "Подписка").trim();
        var productName = String(item.name || "").trim();
        catalog.push({
          item: item,
          program: String(item.category || "Без программы").trim() || "Без программы",
          productName: productName,
          planName: planName,
          label: normalize(productName) === normalize(planName) ? productName : productName + " · " + planName,
          description: String(modifier.description || "").trim(),
          amount: amount,
          currency: String(modifier.currency || selectedCurrency(root)).toUpperCase()
        });
      });
    });
    return catalog;
  }

  function wireSubscriptionDialog(root, options) {
    var dialog = document.querySelector("[data-sales-subscription-dialog]");
    var form = dialog ? dialog.querySelector("[data-sales-subscription-form]") : null;
    var openButton = root.querySelector("[data-sales-subscription-open]");
    if (!dialog || !form || !openButton) return;
    var programSelect = dialog.querySelector("[data-sales-subscription-program]");
    var linesContainer = dialog.querySelector("[data-sales-subscription-lines]");
    var lineTemplate = dialog.querySelector("[data-sales-subscription-line-template]");
    var addRowButton = dialog.querySelector("[data-sales-subscription-add-row]");
    var total = dialog.querySelector("[data-sales-subscription-total]");
    var formula = dialog.querySelector("[data-sales-subscription-formula]");
    var empty = dialog.querySelector("[data-sales-subscription-empty]");
    var summary = dialog.querySelector("[data-sales-subscription-summary]");
    var addButton = dialog.querySelector("[data-sales-subscription-add]");
    var catalog = [];

    function subscriptionLines() {
      return linesContainer ? Array.from(linesContainer.querySelectorAll("[data-sales-subscription-line]")) : [];
    }

    function selectedChoice(line) {
      var planSelect = line ? line.querySelector("[data-sales-subscription-plan]") : null;
      var index = Number(planSelect ? planSelect.value : -1);
      return Number.isInteger(index) && index >= 0 ? catalog[index] || null : null;
    }

    function renderSummary() {
      var currency = selectedCurrency(root);
      var grandTotal = 0;
      var selectedCount = 0;
      subscriptionLines().forEach(function (line) {
        var choice = selectedChoice(line);
        var quantityInput = line.querySelector("[data-sales-subscription-quantity]");
        var monthsInput = line.querySelector("[data-sales-subscription-months]");
        var description = line.querySelector("[data-sales-subscription-description]");
        var quantity = Math.max(1, Math.floor(numberValue(quantityInput ? quantityInput.value : 1) || 1));
        var months = Math.max(1, Math.floor(numberValue(monthsInput ? monthsInput.value : 1) || 1));
        if (!choice) {
          if (description) description.hidden = true;
          return;
        }
        var monthly = convertPrice(choice.amount, choice.currency, currency, options);
        grandTotal += monthly * quantity * months;
        selectedCount += 1;
        if (description) {
          description.textContent = choice.description;
          description.hidden = !choice.description;
        }
      });
      if (total) total.textContent = formatMoney(grandTotal, currency) + " " + currency;
      if (formula) {
        formula.textContent = selectedCount
          ? selectedCount + " " + (selectedCount === 1 ? "подписка" : "подписки") + " по выбранному периоду"
          : "";
      }
    }

    function renderPlans(line) {
      var planSelect = line ? line.querySelector("[data-sales-subscription-plan]") : null;
      if (!planSelect) return;
      var previous = planSelect.value;
      var program = programSelect ? programSelect.value : "";
      planSelect.replaceChildren();
      catalog.forEach(function (choice, index) {
        if (choice.program !== program) return;
        planSelect.add(new Option(choice.label, String(index)));
      });
      if (Array.from(planSelect.options).some(function (option) { return option.value === previous; })) {
        planSelect.value = previous;
      }
      planSelect.disabled = !planSelect.options.length;
    }

    function syncRemoveButtons() {
      var lines = subscriptionLines();
      lines.forEach(function (line) {
        var removeButton = line.querySelector("[data-sales-subscription-remove-row]");
        if (removeButton) removeButton.hidden = lines.length === 1;
      });
    }

    function addSubscriptionLine() {
      if (!linesContainer || !lineTemplate) return null;
      var fragment = lineTemplate.content.cloneNode(true);
      var line = fragment.querySelector("[data-sales-subscription-line]");
      linesContainer.appendChild(fragment);
      renderPlans(line);
      syncRemoveButtons();
      renderSummary();
      return line;
    }

    function renderAllPlans() {
      subscriptionLines().forEach(renderPlans);
      renderSummary();
    }

    function openDialog() {
      catalog = salesSubscriptionCatalog(root, options);
      var programs = Array.from(new Set(catalog.map(function (choice) { return choice.program; }))).sort(function (a, b) {
        return a.localeCompare(b, "ru");
      });
      if (programSelect) {
        programSelect.replaceChildren();
        programs.forEach(function (program) { programSelect.add(new Option(program, program)); });
        programSelect.disabled = !programs.length;
      }
      if (linesContainer) linesContainer.replaceChildren();
      if (catalog.length) addSubscriptionLine();
      if (empty) empty.hidden = !!catalog.length;
      if (summary) summary.hidden = !catalog.length;
      if (addButton) addButton.disabled = !catalog.length;
      if (addRowButton) addRowButton.disabled = !catalog.length;
      renderSummary();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }

    function closeDialog() {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }

    openButton.addEventListener("click", openDialog);
    programSelect?.addEventListener("change", renderAllPlans);
    addRowButton?.addEventListener("click", function () {
      var line = addSubscriptionLine();
      line?.querySelector("[data-sales-subscription-plan]")?.focus();
    });
    linesContainer?.addEventListener("change", function (event) {
      if (event.target.matches("[data-sales-subscription-plan]")) renderSummary();
    });
    linesContainer?.addEventListener("input", function (event) {
      if (event.target.matches("[data-sales-subscription-quantity], [data-sales-subscription-months]")) renderSummary();
    });
    linesContainer?.addEventListener("click", function (event) {
      var removeButton = event.target.closest("[data-sales-subscription-remove-row]");
      if (!removeButton) return;
      removeButton.closest("[data-sales-subscription-line]")?.remove();
      syncRemoveButtons();
      renderSummary();
    });
    dialog.querySelectorAll("[data-sales-subscription-close]").forEach(function (button) {
      button.addEventListener("click", closeDialog);
    });
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeDialog();
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var selections = subscriptionLines().map(function (line) {
        var choice = selectedChoice(line);
        if (!choice) return null;
        var quantityInput = line.querySelector("[data-sales-subscription-quantity]");
        var monthsInput = line.querySelector("[data-sales-subscription-months]");
        return {
          choice: choice,
          quantity: Math.max(1, Math.floor(numberValue(quantityInput ? quantityInput.value : 1) || 1)),
          months: Math.max(1, Math.floor(numberValue(monthsInput ? monthsInput.value : 1) || 1))
        };
      }).filter(Boolean);
      if (!selections.length) return;
      var usedRows = new Set();
      var added = 0;
      selections.forEach(function (selection) {
        var choice = selection.choice;
        var existingRow = Array.from(root.querySelectorAll('.sales-line-grid[data-sales-line-kind="product"]')).find(function (row) {
          var planField = row.querySelector('input[name="line_subscription_plan"]');
          return !usedRows.has(row)
            && normalize(rowProductValue(row)) === normalize(choice.productName)
            && normalize(planField ? planField.value : "") === normalize(choice.planName);
        });
        var combo = existingRow
          ? existingRow.querySelector('[data-sales-combobox="product"]')
          : firstAvailableCombo(root, "product", options);
        if (!combo) return;
        if (!existingRow) applyProductSelection(root, combo, options, choice.item, true);
        var row = combo.closest(".sales-line-grid");
        if (!row) return;
        usedRows.add(row);
        var monthly = convertPrice(choice.amount, choice.currency, selectedCurrency(root), options);
        var quantityField = row.querySelector('input[name="line_quantity"]');
        var priceField = row.querySelector('input[name="line_price"]');
        var programField = row.querySelector('input[name="line_subscription_program"]');
        var planField = row.querySelector('input[name="line_subscription_plan"]');
        var monthsField = row.querySelector('input[name="line_subscription_months"]');
        if (quantityField) quantityField.value = String(selection.quantity);
        if (priceField) priceField.value = formatMoney(monthly * selection.months, selectedCurrency(root));
        if (programField) programField.value = choice.program;
        if (planField) planField.value = choice.planName;
        if (monthsField) monthsField.value = String(selection.months);
        row.dataset.salesSubscriptionMonthly = String(choice.amount);
        row.dataset.salesSubscriptionCurrency = choice.currency;
        row.dataset.salesSubscriptionMonths = String(selection.months);
        row.dataset.salesBasePrice = String(choice.amount * selection.months);
        row.dataset.salesBaseCurrency = choice.currency;
        var meta = row.querySelector("[data-sales-subscription-line-meta]");
        if (meta) {
          meta.textContent = choice.program + " · " + choice.planName + " · " + selection.months + " мес.";
          meta.hidden = false;
        }
        syncRowState(row);
        added += 1;
      });
      if (!added) return;
      updateTotal(root);
      scheduleSalesDraft(root);
      closeDialog();
    });
  }

  function init() {
    var root = document.querySelector(".sales-form");
    if (!root) return;
    var options = readOptions();
    var clientCardDialog = document.querySelector("[data-sales-client-card-dialog]");
    var clientInput = root.querySelector('[data-sales-combobox="client"] [data-sales-combo-input]');
    if (clientInput) {
      clientInput.addEventListener("dblclick", function () {
        openSalesClientCard(root, clientInput.dataset.salesClientId || "");
      });
    }
    if (clientCardDialog) {
      clientCardDialog.querySelector("[data-sales-client-card-close]")?.addEventListener("click", function () {
        closeSalesClientCard(clientCardDialog);
      });
      clientCardDialog.addEventListener("click", function (event) {
        var tab = event.target.closest("[data-sales-client-card-tab]");
        if (tab) activateSalesClientCardTab(clientCardDialog, tab.getAttribute("data-sales-client-card-tab") || "info");
        if (event.target === clientCardDialog) closeSalesClientCard(clientCardDialog);
      });
      // Форма живёт внутри перерисовываемой панели, поэтому слушаем на диалоге.
      clientCardDialog.addEventListener("submit", function (event) {
        var form = event.target.closest("[data-sales-client-card-form]");
        if (!form) return;
        event.preventDefault();
        submitClientCardForm(root, clientCardDialog, form);
      });
    }
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
        syncInstallationSection(root);
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
    syncInstallationSection(root);
    wireInstallationCalendar(root);
    wireInstallment(root);
    wireSubscriptionDialog(root, options);
    hydratePaymentRows(root, parsePaymentLines(root));
    updatePaymentBreakdown(root);
    root.addEventListener("input", function () {
      scheduleSalesDraft(root);
    });
    root.addEventListener("change", function () {
      scheduleSalesDraft(root);
    });
    wireQuickProductDialog(root, options);
    wireClientCreateDialog(root);
    wireSegmentDialog(root);
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
