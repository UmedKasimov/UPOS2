(function () {
  function t(key) {
    var pack = window.upos_i18n || null;
    if (!pack || !pack[key]) return key;
    return pack[key];
  }

  function csrfToken() {
    var el = document.querySelector('input[name="csrf_token"]');
    return el ? el.value || "" : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function humanError(error) {
    var code = String(error || "");
    var map = {
      token_required: t("settings.tg.token_required"),
      invalid_token: t("settings.tg.invalid_token"),
      not_connected: t("settings.tg.not_connected"),
      no_targets: t("settings.tg.no_targets"),
      no_transactions: t("settings.tg.no_transactions"),
      organization_required: t("settings.tg.organization_required"),
      forbidden: t("settings.tg.forbidden"),
      csrf: "CSRF",
    };
    return map[code] || code || t("settings.js.req_err");
  }

  function telegramOrganizationId() {
    var select = document.querySelector("[data-tg-organization-select]");
    return select ? String(select.value || "").trim() : "";
  }

  function scopedTelegramUrl(url) {
    var orgId = telegramOrganizationId();
    if (!orgId || String(url || "").indexOf("/api/telegram/") !== 0) return url;
    var glue = url.indexOf("?") >= 0 ? "&" : "?";
    return url + glue + "organization_id=" + encodeURIComponent(orgId);
  }

  function api(method, url, body) {
    var opts = {
      method: method,
      headers: { "X-CSRF-Token": csrfToken() },
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(scopedTelegramUrl(url), opts).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (data) {
        if (!res.ok) throw new Error(humanError(data.error));
        return data;
      });
    });
  }

  function init() {
    var root = document.querySelector("[data-telegram-settings]");
    if (!root) return;
    if (root.getAttribute("data-tg-inited") === "1") {
      if (typeof root._uposTelegramActive === "function") {
        var panel = document.getElementById("panel-telegram");
        if (panel && !panel.hidden) root._uposTelegramActive();
      }
      return;
    }
    root.setAttribute("data-tg-inited", "1");

    var canManage = root.getAttribute("data-can-manage") === "1";
    var canApprove = root.getAttribute("data-can-approve") === "1";
    var statusEl = root.querySelector("[data-tg-status]");
    var pillEl = root.querySelector("[data-tg-connection-pill]");
    var connectPlate = root.querySelector("[data-tg-connect-plate]");
    var connectedHub = root.querySelector("[data-tg-connected-hub]");
    var tokenInput = root.querySelector(".js-tg-token-input");
    var botCard = root.querySelector("[data-tg-bot-card]");
    var hubCard = connectedHub ? connectedHub.querySelector(".tg-hub-card") : null;
    var botName = connectedHub ? connectedHub.querySelector("[data-tg-bot-name]") : root.querySelector("[data-tg-bot-name]");
    var botUsername = connectedHub ? connectedHub.querySelector("[data-tg-bot-username]") : root.querySelector("[data-tg-bot-username]");
    var botId = connectedHub ? connectedHub.querySelector("[data-tg-bot-id]") : root.querySelector("[data-tg-bot-id]");
    var activityDot = root.querySelector("[data-tg-activity-dot]");
    var activityText = root.querySelector("[data-tg-activity-text]");
    var lastSentEl = root.querySelector("[data-tg-last-sent]");
    var webhookBanner = root.querySelector("[data-tg-webhook-banner]");
    var btnVerify = root.querySelector("[data-tg-verify]");
    var btnDisconnect = root.querySelector("[data-tg-disconnect]");
    var btnDelete = root.querySelector("[data-tg-delete]");
    var btnOpenTests = root.querySelector("[data-tg-open-tests]");
    var btnOpenDest = root.querySelector("[data-tg-open-dest]");
    var btnOpenPrefs = root.querySelector("[data-tg-open-prefs]");
    var testPopover = root.querySelector("[data-tg-test-popover]");
    var destDialog = document.getElementById("tg-dest-dialog");
    var prefsDialog = document.getElementById("tg-prefs-dialog");
    var prefsStatus = root.querySelector("[data-tg-prefs-status]");
    var btnPrefsSave = root.querySelector("[data-tg-prefs-save]");
    var dailyHourSelect = root.querySelector("[data-tg-daily-hour]");
    var limitEnabledInput = root.querySelector("[data-tg-limit-enabled]");
    var limitIncomeEnabledInput = root.querySelector("[data-tg-limit-income-enabled]");
    var limitIncomeAmountInput = root.querySelector("[data-tg-limit-income-amount]");
    var limitExpenseEnabledInput = root.querySelector("[data-tg-limit-expense-enabled]");
    var limitExpenseAmountInput = root.querySelector("[data-tg-limit-expense-amount]");
    var btnRefresh = root.querySelector("[data-tg-chats-refresh]");
    var organizationSelect = root.querySelector("[data-tg-organization-select]");
    var chatsList = root.querySelector("[data-tg-chats-list]");
    var chatsEmpty = root.querySelector("[data-tg-chats-empty]");
    var enabledGroups = root.querySelector("[data-tg-enabled-groups]");
    var pendingList = root.querySelector("[data-tg-pending-list]");
    var approvedList = root.querySelector("[data-tg-approved-list]");
    var pendingEmpty = root.querySelector("[data-tg-pending-empty]");
    var approvedEmpty = root.querySelector("[data-tg-approved-empty]");
    var pendingCount = root.querySelector("[data-tg-pending-count]");
    var approvedCount = root.querySelector("[data-tg-approved-count]");
    var telephonyTargetSelect = root.querySelector("[data-tg-telephony-target]");
    var tokenSavedEl = root.querySelector("[data-tg-token-saved]");
    var webhookHintEl = root.querySelector("[data-tg-webhook-hint]");
    var eventSource = null;
    var pollTimer = null;
    var reloadTimer = null;
    var sseActive = false;
    var loadInFlight = false;
    var state = {
      connected: false,
      config: null,
      chats: [],
      pending: [],
      approved: [],
      notification_prefs: null,
      webhook: null,
      last_success_delivery: null,
      webhookRepairing: false,
      webhookRepairAttempted: {},
    };

    function resetDashboardForOrganization() {
      disconnectSse();
      state.connected = false;
      state.config = null;
      state.chats = [];
      state.pending = [];
      state.approved = [];
      state.notification_prefs = null;
      state.webhook = null;
      state.last_success_delivery = null;
      setPill(false);
      renderBot(null);
      renderChats([]);
      renderSubscribers([], []);
      renderRoutingPrefs();
      setStatus("", "");
    }

    function isTelegramPanelVisible() {
      var panel = document.getElementById("panel-telegram");
      return panel && !panel.hidden;
    }

    function setStatus(message, variant) {
      if (!statusEl) return;
      statusEl.textContent = message || "";
      if (variant) statusEl.setAttribute("data-variant", variant);
      else statusEl.removeAttribute("data-variant");
    }

    function setBusy(el, busy) {
      if (el) el.disabled = !!busy;
    }

    function setPill(connected) {
      if (!pillEl) return;
      pillEl.textContent = connected ? t("settings.tg.connected_ok") : t("settings.tg.not_connected");
      pillEl.setAttribute("data-variant", connected ? "ok" : "muted");
    }

    function isTransientWebhookNoise(message) {
      var m = String(message || "").toLowerCase();
      if (!m) return false;
      return (
        m.indexOf("connection reset") >= 0 ||
        m.indexOf("reset by peer") >= 0 ||
        m.indexOf("connection aborted") >= 0 ||
        m.indexOf("broken pipe") >= 0 ||
        m.indexOf("timeout") >= 0 ||
        m.indexOf("timed out") >= 0 ||
        m.indexOf("temporarily unavailable") >= 0 ||
        m.indexOf("network error") >= 0
      );
    }

    function webhookHasActionableIssue(webhook) {
      webhook = webhook || {};
      if (webhook.repaired) return "";
      if (webhook.error && !isTransientWebhookNoise(webhook.error)) return webhook.error;
      if (webhook.last_error_message && !isTransientWebhookNoise(webhook.last_error_message)) {
        return webhook.last_error_message;
      }
      return "";
    }

    function webhookNeedsRepair(webhook) {
      webhook = webhook || {};
      var issue = webhookHasActionableIssue(webhook).toLowerCase();
      return !!(
        webhook.url_mismatch ||
        issue.indexOf("404 not found") >= 0 ||
        issue.indexOf("wrong response from the webhook") >= 0
      );
    }

    function formatDateTime(iso) {
      if (!iso) return "";
      try {
        var d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "";
        return new Intl.DateTimeFormat(undefined, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(d);
      } catch (e) {
        return "";
      }
    }

    function setConnectedMode(connected) {
      if (connectPlate) connectPlate.hidden = !!connected;
      if (connectedHub) connectedHub.hidden = !connected;
    }

    function renderWebhookBanner(webhook) {
      var msg = "";
      webhook = webhook || {};
      var issue = webhookHasActionableIssue(webhook);
      if (webhook.url_mismatch) issue = "Webhook URL устарел. Подключение будет обновлено автоматически.";
      if (issue) msg = t("settings.tg.webhook_error") + ": " + issue;
      if (webhookBanner) {
        webhookBanner.hidden = !msg;
        webhookBanner.textContent = msg;
      }
      if (webhookHintEl) {
        webhookHintEl.hidden = true;
        webhookHintEl.textContent = "";
      }
    }

    function renderWebhook(webhook) {
      state.webhook = webhook || null;
      renderWebhookBanner(webhook);
    }

    function getActivityState(cfg, webhook, lastOk) {
      webhook = webhook || {};
      if (cfg && cfg.last_error) return "err";
      if (webhookHasActionableIssue(webhook)) return "err";
      if (lastOk && lastOk.at) {
        var age = Date.now() - new Date(lastOk.at).getTime();
        if (!Number.isNaN(age) && age < 48 * 3600 * 1000) return "online";
      }
      return "warn";
    }

    function renderHub(cfg, webhook, lastOk) {
      if (!connectedHub || !cfg) return;
      if (botName) botName.textContent = cfg.bot_first_name || cfg.bot_username || "Telegram Bot";
      if (botUsername) botUsername.textContent = cfg.bot_username || "—";
      if (botId) botId.textContent = cfg.bot_id != null ? String(cfg.bot_id) : "—";
      var activity = getActivityState(cfg, webhook, lastOk);
      if (activityDot) {
        activityDot.classList.remove("is-online", "is-warn", "is-err");
        activityDot.classList.add(
          activity === "online" ? "is-online" : activity === "err" ? "is-err" : "is-warn",
        );
      }
      if (activityText) {
        activityText.textContent =
          activity === "online"
            ? t("settings.tg.hub_activity_ok")
            : activity === "err"
              ? t("settings.tg.hub_activity_err")
              : t("settings.tg.hub_activity_warn");
      }
      if (lastSentEl) {
        var formatted = lastOk && lastOk.at ? formatDateTime(lastOk.at) : "";
        lastSentEl.textContent = formatted
          ? t("settings.tg.hub_last_sent").replace("{time}", formatted)
          : t("settings.tg.hub_last_sent_never");
      }
      renderWebhookBanner(webhook);
    }

    function renderBot(cfg) {
      if (!cfg) {
        if (botCard) botCard.hidden = true;
        if (btnDisconnect) btnDisconnect.hidden = true;
        if (tokenInput) {
          tokenInput.value = "";
          tokenInput.placeholder = "123456789:AAHe...";
        }
        if (tokenSavedEl) tokenSavedEl.hidden = true;
        setConnectedMode(false);
        return;
      }
      if (botCard) botCard.hidden = true;
      if (btnDisconnect) btnDisconnect.hidden = true;
      if (tokenInput) {
        tokenInput.value = "";
        tokenInput.placeholder = cfg.masked_token || "123456789:AAHe...";
      }
      if (tokenSavedEl) tokenSavedEl.hidden = true;
      setConnectedMode(true);
      renderHub(cfg, state.webhook, state.last_success_delivery);
    }

    function openDialog(dlg) {
      if (!dlg || typeof dlg.showModal !== "function") return;
      if (!dlg.open) dlg.showModal();
    }

    function closeDialog(dlg) {
      if (!dlg || typeof dlg.close !== "function") return;
      if (dlg.open) dlg.close();
    }

    function closeTestPopover() {
      if (testPopover) testPopover.hidden = true;
    }

    function fillPrefsForm(prefs) {
      prefs = prefs || {};
      var reports = prefs.reports || {};
      root.querySelectorAll("[data-tg-pref]").forEach(function (input) {
        var key = input.getAttribute("data-tg-pref");
        if (key && Object.prototype.hasOwnProperty.call(reports, key)) {
          input.checked = !!reports[key];
        }
      });
      if (dailyHourSelect && prefs.schedule && prefs.schedule.daily_hour != null) {
        dailyHourSelect.value = String(prefs.schedule.daily_hour);
      }
      var telephony = prefs.telephony || {};
      root.querySelectorAll("[data-tg-telephony-pref]").forEach(function (input) {
        var key = input.getAttribute("data-tg-telephony-pref");
        if (key && Object.prototype.hasOwnProperty.call(telephony, key)) {
          input.checked = !!telephony[key];
        }
      });
      renderTelephonyTarget();
      var limits = prefs.limits || {};
      var incomeLimit = limits.income || {};
      var expenseLimit = limits.expense || {};
      if (limitEnabledInput) limitEnabledInput.checked = !!limits.enabled;
      if (limitIncomeEnabledInput) limitIncomeEnabledInput.checked = incomeLimit.enabled !== false;
      if (limitIncomeAmountInput) limitIncomeAmountInput.value = incomeLimit.amount || "";
      if (limitExpenseEnabledInput) limitExpenseEnabledInput.checked = expenseLimit.enabled !== false;
      if (limitExpenseAmountInput) limitExpenseAmountInput.value = expenseLimit.amount || "";
      renderRoutingPrefs();
    }

    function routeLabel(key) {
      var row = root.querySelector('[data-tg-route-key="' + String(key).replace(/"/g, '\\"') + '"]');
      var title = row && row.querySelector(".tg-rule-head span");
      return title ? title.textContent.trim() : key;
    }

    var routeDefaultTemplates = {
      income: "{text}",
      courier_payment:
        "🚚 <b>ПОСТУПЛЕНИЕ ДЕНЕГ ОТ ДОСТАВЩИКА</b>\n" +
        "Организация: {organization}\n" +
        "Дата и время: {date} {time}\n\n" +
        "<b>{courier_name}</b> (операция №{number})\n" +
        "<pre>{courier_table}</pre>",
      expense: "{text}",
      limits: "{text}",
      transaction_deleted: "{text}",
      transfer: "{text}",
      hr_attendance:
        "🧾 <b>ДНЕВНОЙ ТАБЕЛЬ</b>\n" +
        "Организация: {organization}\n" +
        "Дата: {date}\n\n" +
        "{text}\n\n" +
        "<b>Кто пришёл</b>\n" +
        "{present_list}\n\n" +
        "<b>Кто не пришёл и причина</b>\n" +
        "{absent_list}",
      daily:
        "🧾 <b>КАССОВЫЙ ОТЧЁТ</b>\n" +
        "Организация: {organization}\n" +
        "Дата формирования: {date} {time}\n\n" +
        "{text}\n\n" +
        "Нажмите кнопку ниже, чтобы посмотреть остатки по счетам организации.",
      balance:
        "🏦 <b>ОСТАТКИ КАССЫ</b>\n" +
        "Организация: {organization}\n" +
        "Дата формирования: {date} {time}\n\n" +
        "{text}",
    };

    function defaultRouteTemplate(key) {
      return routeDefaultTemplates[key] || "{text}";
    }

    function chatOptionsHtml(selected) {
      selected = String(selected || "");
      var options = ['<option value="">Все включенные группы</option>'];
      state.chats
        .filter(function (chat) { return chat.bot_is_admin !== false; })
        .forEach(function (chat) {
          var id = String(chat.id || "");
          options.push(
            '<option value="' + escapeHtml(id) + '" ' + (id === selected ? "selected" : "") + ">" +
              escapeHtml(chat.title || chat.chat_id || "Telegram") +
            "</option>",
          );
        });
      return options.join("");
    }

    function renderTelephonyTarget() {
      if (!telephonyTargetSelect) return;
      var prefs = state.notification_prefs || {};
      var targets = prefs.targets || {};
      telephonyTargetSelect.innerHTML = chatOptionsHtml(targets.telephony);
      telephonyTargetSelect.value = String(targets.telephony || "");
    }

    function renderRoutingPrefs() {
      var prefs = state.notification_prefs || {};
      var reports = prefs.reports || {};
      var targets = prefs.targets || {};
      var templates = prefs.templates || {};
      root.querySelectorAll("[data-tg-route-key]").forEach(function (rule) {
        var key = rule.getAttribute("data-tg-route-key");
        var body = rule.querySelector(".tg-rule-body");
        if (!key || !body) return;
        var enabled = Object.prototype.hasOwnProperty.call(reports, key) ? !!reports[key] : true;
        var template = String(templates[key] || "{text}");
        if (template.trim() === "{text}") template = defaultRouteTemplate(key);
        var isReportRoute = key === "daily" || key === "balance";
        var enableText = isReportRoute ? "Включить отчет" : "Включить уведомления";
        body.innerHTML =
          '<div class="tg-route-grid">' +
            '<label class="tg-route-check"><input type="checkbox" data-tg-route-enable="' + escapeHtml(key) + '" ' +
              (enabled ? "checked" : "") + (canManage ? "" : " disabled") + " /> <span>" + enableText + "</span></label>" +
            '<label class="tg-route-field"><span>Телеграм группа</span><select data-tg-route-target="' + escapeHtml(key) + '" ' +
              (canManage ? "" : "disabled") + ">" + chatOptionsHtml(targets[key]) + "</select></label>" +
            '<label class="tg-route-template"><span>Шаблон сообщения</span><textarea data-tg-route-template="' + escapeHtml(key) + '" rows="7" ' +
              (canManage ? "" : "disabled") + ">" + escapeHtml(template) + "</textarea></label>" +
            '<button type="button" class="btn btn-secondary btn-sm tg-route-template-reset" data-tg-template-default="' + escapeHtml(key) + '" ' +
              (canManage ? "" : "disabled") + ">Вставить готовый шаблон</button>" +
            '<p class="tg-route-hint">Выберите группу и измените шаблон для "' + escapeHtml(routeLabel(key)) + '". Переменные: {text}, {organization}, {date}, {time}, {amount}, {currency}, {credit_amount}, {credit_currency}, {category}, {number}, {counterparty}, {from_account}, {to_account}, {note}, {balances}, {balance_table}, {courier_name}, {courier_table}, {shipment_total}, {debt_base}, {transfer}, {terminal}, {return_goods}, {discount}, {current_debt}, {old_debt}, {expense}, {expense_type}, {cash}, {difference}, {present_list}, {absent_list}.</p>' +
          "</div>";
      });
    }

    function readPrefsForm() {
      var reports = {};
      root.querySelectorAll("[data-tg-pref]").forEach(function (input) {
        var key = input.getAttribute("data-tg-pref");
        if (key) reports[key] = !!input.checked;
      });
      root.querySelectorAll("[data-tg-route-enable]").forEach(function (input) {
        var key = input.getAttribute("data-tg-route-enable");
        if (key) reports[key] = !!input.checked;
      });
      var targets = {};
      root.querySelectorAll("[data-tg-route-target]").forEach(function (select) {
        var key = select.getAttribute("data-tg-route-target");
        if (key) targets[key] = select.value || "";
      });
      var templates = {};
      root.querySelectorAll("[data-tg-route-template]").forEach(function (input) {
        var key = input.getAttribute("data-tg-route-template");
        if (key) templates[key] = input.value || "{text}";
      });
      var hour = dailyHourSelect ? parseInt(dailyHourSelect.value, 10) : 21;
      if (!Number.isFinite(hour)) hour = 21;
      var telephony = {};
      root.querySelectorAll("[data-tg-telephony-pref]").forEach(function (input) {
        var key = input.getAttribute("data-tg-telephony-pref");
        if (key) telephony[key] = !!input.checked;
      });
      var result = {
        reports: reports,
        targets: targets,
        templates: templates,
        schedule: { daily_hour: hour },
        telephony: telephony,
      };
      if (
        limitEnabledInput ||
        limitIncomeEnabledInput ||
        limitIncomeAmountInput ||
        limitExpenseEnabledInput ||
        limitExpenseAmountInput
      ) {
        result.limits = {
          enabled: !!(limitEnabledInput && limitEnabledInput.checked),
          income: {
            enabled: limitIncomeEnabledInput ? !!limitIncomeEnabledInput.checked : true,
            amount: limitIncomeAmountInput ? limitIncomeAmountInput.value || "" : "",
          },
          expense: {
            enabled: limitExpenseEnabledInput ? !!limitExpenseEnabledInput.checked : true,
            amount: limitExpenseAmountInput ? limitExpenseAmountInput.value || "" : "",
          },
        };
      }
      return result;
    }

    function chatRowHtml(chat) {
      return (
        '<label class="tg-row-main">' +
        (canManage
          ? '<input type="checkbox" data-chat-enable="' +
            escapeHtml(chat.id) +
            '" ' +
            (chat.is_enabled ? "checked" : "") +
            " />"
          : "") +
        '<span class="tg-row-copy"><strong>' +
        escapeHtml(chat.title) +
        '</strong><span class="tg-muted">' +
        escapeHtml(chat.chat_type || "group") +
        (chat.is_enabled ? " · " + escapeHtml(t("settings.tg.enabled")) : "") +
        "</span></span></label>" +
        (canManage
          ? '<button type="button" class="btn btn-ghost btn-sm" data-chat-delete="' +
            escapeHtml(chat.id) +
            '">' +
            escapeHtml(t("settings.tg.remove")) +
            "</button>"
          : "")
      );
    }

    function subscriberRowHtml(sub, mode) {
      var username = sub.username ? " @" + escapeHtml(sub.username) : "";
      var phone = sub.phone ? '<span class="tg-muted">' + escapeHtml(sub.phone) + "</span>" : "";
      var actionHtml = "";
      if (mode === "pending" && canApprove) {
        actionHtml =
          '<div class="tg-row-actions">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-sub-approve="' +
          escapeHtml(sub.id) +
          '">' +
          escapeHtml(t("settings.tg.approve")) +
          '</button><button type="button" class="btn btn-ghost btn-sm" data-sub-reject="' +
          escapeHtml(sub.id) +
          '">' +
          escapeHtml(t("settings.tg.reject")) +
          "</button></div>";
      } else if (mode === "approved" && canManage) {
        actionHtml =
          '<button type="button" class="btn btn-ghost btn-sm" data-sub-delete="' +
          escapeHtml(sub.id) +
          '">' +
          escapeHtml(t("settings.tg.remove")) +
          "</button>";
      }
      return (
        '<div class="tg-row-main"><span class="tg-row-copy"><strong>' +
        escapeHtml(sub.display_name || "—") +
        username +
        "</strong>" +
        phone +
        "</span></div>" +
        actionHtml
      );
    }

    function upsertRow(listEl, idAttr, id, html) {
      if (!listEl) return;
      var sel = "[" + idAttr + '="' + id.replace(/"/g, '\\"') + '"]';
      var existing = listEl.querySelector(sel);
      if (existing) {
        var row = existing.closest(".tg-row");
        if (row) row.outerHTML = '<div class="tg-row" ' + idAttr + '="' + escapeHtml(id) + '">' + html + "</div>";
        return;
      }
      var row = document.createElement("div");
      row.className = "tg-row";
      row.setAttribute(idAttr, id);
      row.innerHTML = html;
      listEl.appendChild(row);
    }

    function removeRow(listEl, idAttr, id) {
      if (!listEl) return;
      var el = listEl.querySelector("[" + idAttr + '="' + id + '"]');
      if (el) {
        var row = el.closest(".tg-row");
        if (row) row.remove();
      }
    }

    function updateChatCounts() {
      if (enabledGroups) {
        var n = state.chats.filter(function (c) { return !!c.is_enabled; }).length;
        enabledGroups.textContent = n + " / " + state.chats.length;
      }
      if (chatsEmpty) chatsEmpty.hidden = state.chats.length > 0;
    }

    function updateSubscriberCounts() {
      if (pendingCount) pendingCount.textContent = String(state.pending.length);
      if (approvedCount) approvedCount.textContent = String(state.approved.length);
      if (pendingEmpty) pendingEmpty.hidden = state.pending.length > 0 || (pendingList && pendingList.hidden);
      if (approvedEmpty) approvedEmpty.hidden = state.approved.length > 0 || (approvedList && approvedList.hidden);
    }

    function renderChats(chats) {
      state.chats = chats || [];
      if (!chatsList) return;
      chatsList.innerHTML = "";
      state.chats.forEach(function (chat) {
        var row = document.createElement("div");
        row.className = "tg-row";
        row.setAttribute("data-chat-id", chat.id);
        row.innerHTML = chatRowHtml(chat);
        chatsList.appendChild(row);
      });
      updateChatCounts();
      renderRoutingPrefs();
      renderTelephonyTarget();
    }

    function renderSubscribers(pending, approved) {
      state.pending = pending || [];
      state.approved = approved || [];
      if (pendingList) pendingList.innerHTML = "";
      if (approvedList) approvedList.innerHTML = "";
      state.pending.forEach(function (sub) {
        if (!pendingList) return;
        var row = document.createElement("div");
        row.className = "tg-row";
        row.setAttribute("data-sub-id", sub.id);
        row.innerHTML = subscriberRowHtml(sub, "pending");
        pendingList.appendChild(row);
      });
      state.approved.forEach(function (sub) {
        if (!approvedList) return;
        var row = document.createElement("div");
        row.className = "tg-row";
        row.setAttribute("data-sub-id", sub.id);
        row.innerHTML = subscriberRowHtml(sub, "approved");
        approvedList.appendChild(row);
      });
      updateSubscriberCounts();
    }

    function applySnapshot(data) {
      state.connected = !!data.connected;
      state.config = data.connected ? data.config : null;
      state.notification_prefs = data.notification_prefs || null;
      state.webhook = data.webhook || null;
      state.last_success_delivery = data.last_success_delivery || null;
      setPill(state.connected);
      renderBot(state.config);
      renderWebhook(data.webhook);
      if (state.connected && state.config) {
        renderHub(state.config, state.webhook, state.last_success_delivery);
      }
      renderChats(data.chats || []);
      renderSubscribers(data.pending || [], data.approved || []);
      renderRoutingPrefs();
      repairWebhookIfNeeded();
      if (prefsDialog && prefsDialog.open && state.notification_prefs) {
        fillPrefsForm(state.notification_prefs);
      }
    }

    function repairWebhookIfNeeded() {
      if (!canManage || !state.connected || !state.config || state.webhookRepairing) return;
      if (!webhookNeedsRepair(state.webhook)) return;
      var key = telegramOrganizationId() || String(state.config.workspace_owner_id || "default");
      if (state.webhookRepairAttempted[key]) return;
      state.webhookRepairAttempted[key] = true;
      state.webhookRepairing = true;
      setStatus("Обновляем webhook Telegram...", "");
      api("POST", "/api/telegram/webhook/repair")
        .then(function (data) {
          if (data.webhook) renderWebhook(data.webhook);
          if (data.chats) renderChats(data.chats);
          setStatus("Webhook обновлен. Если группа уже добавлена, она появится в списке групп.", "ok");
          setTimeout(loadAll, 1500);
        })
        .catch(function (err) {
          setStatus(err.message, "err");
        })
        .finally(function () {
          state.webhookRepairing = false;
        });
    }

    function patchChat(chat) {
      if (!chat || !chat.id) return;
      var idx = state.chats.findIndex(function (c) { return c.id === chat.id; });
      if (idx >= 0) state.chats[idx] = chat;
      else if (chat.bot_is_admin !== false) state.chats.push(chat);
      state.chats = state.chats.filter(function (c) { return c.bot_is_admin !== false; });
      state.chats.sort(function (a, b) { return String(a.title || "").localeCompare(String(b.title || "")); });
      renderChats(state.chats);
    }

    function removeChat(rowId) {
      state.chats = state.chats.filter(function (c) { return c.id !== rowId; });
      removeRow(chatsList, "data-chat-id", rowId);
      updateChatCounts();
    }

    function patchSubscriber(sub) {
      if (!sub || !sub.id) return;
      state.pending = state.pending.filter(function (s) { return s.id !== sub.id; });
      state.approved = state.approved.filter(function (s) { return s.id !== sub.id; });
      removeRow(pendingList, "data-sub-id", sub.id);
      removeRow(approvedList, "data-sub-id", sub.id);
      if (sub.status === "pending") {
        state.pending.push(sub);
        upsertRow(pendingList, "data-sub-id", sub.id, subscriberRowHtml(sub, "pending"));
      } else if (sub.status === "approved") {
        state.approved.push(sub);
        upsertRow(approvedList, "data-sub-id", sub.id, subscriberRowHtml(sub, "approved"));
      }
      updateSubscriberCounts();
    }

    function removeSubscriber(rowId) {
      state.pending = state.pending.filter(function (s) { return s.id !== rowId; });
      state.approved = state.approved.filter(function (s) { return s.id !== rowId; });
      removeRow(pendingList, "data-sub-id", rowId);
      removeRow(approvedList, "data-sub-id", rowId);
      updateSubscriberCounts();
    }

    function applySseEvent(payload) {
      var type = payload && payload.type;
      var data = (payload && payload.data) || {};
      if (type === "config_connected") {
        scheduleReload();
        return;
      }
      if (type === "config_disconnected") {
        applySnapshot({ connected: false, chats: [], pending: [], approved: [] });
        return;
      }
      if (type === "chats_refreshed") {
        scheduleReload();
        return;
      }
      if (type === "chat_discovered" || type === "chat_updated") {
        patchChat(data);
        return;
      }
      if (type === "chat_removed") {
        removeChat(data.id || "");
        return;
      }
      if (type === "subscriber_pending" || type === "subscriber_updated" || type === "subscriber_decided") {
        patchSubscriber(data);
        return;
      }
      if (type === "subscriber_removed") {
        removeSubscriber(data.id || "");
        return;
      }
      if (type === "prefs_updated" && data.notification_prefs) {
        state.notification_prefs = data.notification_prefs;
        if (prefsDialog && prefsDialog.open) fillPrefsForm(data.notification_prefs);
      }
    }

    function loadAll() {
      if (loadInFlight) return Promise.resolve();
      loadInFlight = true;
      return api("GET", "/api/telegram/snapshot")
        .then(function (res) {
          applySnapshot(res);
        })
        .catch(function (err) {
          setStatus(err.message, "err");
        })
        .finally(function () {
          loadInFlight = false;
        });
    }

    function scheduleReload() {
      if (!isTelegramPanelVisible()) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () {
        reloadTimer = null;
        loadAll();
      }, 250);
    }

    function disconnectSse() {
      sseActive = false;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function connectSse() {
      if (sseActive || !isTelegramPanelVisible()) return;
      disconnectSse();
      sseActive = true;
      if (typeof EventSource === "undefined") {
        pollTimer = setInterval(function () {
          if (isTelegramPanelVisible()) loadAll();
        }, 60000);
        return;
      }
      eventSource = new EventSource(scopedTelegramUrl("/api/telegram/events"));
      eventSource.onmessage = function (ev) {
        if (!isTelegramPanelVisible()) return;
        try {
          var payload = JSON.parse(ev.data);
          if (!payload || payload.type === "connected") return;
          applySseEvent(payload);
        } catch (e) {
          /* ignore malformed SSE */
        }
      };
      eventSource.onerror = function () {
        disconnectSse();
        if (isTelegramPanelVisible() && !pollTimer) {
          pollTimer = setInterval(function () {
            if (isTelegramPanelVisible()) loadAll();
          }, 60000);
        }
      };
    }

    function onTelegramTabActive() {
      loadAll();
      connectSse();
    }

    if (organizationSelect) {
      organizationSelect.addEventListener("change", function () {
        var url = new URL(window.location.href);
        if (organizationSelect.value) url.searchParams.set("organization_id", organizationSelect.value);
        else url.searchParams.delete("organization_id");
        window.history.replaceState({}, "", url.toString());
        resetDashboardForOrganization();
        if (isTelegramPanelVisible()) {
          loadAll();
          connectSse();
        }
      });
    }

    function onTelegramTabInactive() {
      disconnectSse();
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
    }

    if (tokenInput) {
      tokenInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          if (btnVerify) btnVerify.click();
        }
      });
    }

    if (btnVerify) {
      btnVerify.addEventListener("click", function () {
        var token = tokenInput ? tokenInput.value.trim() : "";
        if (!token) {
          setStatus(t("settings.tg.token_required"), "err");
          return;
        }
        setBusy(btnVerify, true);
        setStatus(t("settings.tg.verifying"), "");
        api("POST", "/api/telegram/verify", { token: token })
          .then(function (data) {
            setStatus(t("settings.tg.connected_ok"), "ok");
            state.connected = true;
            state.config = data.config;
            renderBot(data.config);
            setPill(true);
            return loadAll();
          })
          .catch(function (err) {
            setStatus(err.message, "err");
          })
          .finally(function () {
            setBusy(btnVerify, false);
          });
      });
    }

    function disconnectBot(btn) {
      if (!confirm(t("settings.tg.delete_confirm"))) return;
      setBusy(btn, true);
      closeTestPopover();
      closeDialog(destDialog);
      closeDialog(prefsDialog);
      api("DELETE", "/api/telegram/disconnect")
        .then(function () {
          setStatus(t("settings.tg.disconnected"), "ok");
          applySnapshot({ connected: false, chats: [], pending: [], approved: [] });
        })
        .catch(function (err) {
          setStatus(err.message, "err");
        })
        .finally(function () {
          setBusy(btn, false);
        });
    }

    if (btnDisconnect) {
      btnDisconnect.addEventListener("click", function () {
        disconnectBot(btnDisconnect);
      });
    }

    if (btnDelete) {
      btnDelete.addEventListener("click", function () {
        disconnectBot(btnDelete);
      });
    }

    if (btnOpenDest && destDialog) {
      btnOpenDest.addEventListener("click", function () {
        closeTestPopover();
        openDialog(destDialog);
        loadAll();
      });
    }

    if (btnOpenPrefs && prefsDialog) {
      btnOpenPrefs.addEventListener("click", function () {
        closeTestPopover();
        fillPrefsForm(state.notification_prefs);
        if (prefsStatus) prefsStatus.hidden = true;
        openDialog(prefsDialog);
      });
    }

    if (btnOpenTests && testPopover) {
      btnOpenTests.addEventListener("click", function (ev) {
        ev.stopPropagation();
        testPopover.hidden = !testPopover.hidden;
      });
    }

    document.addEventListener("click", function (ev) {
      if (!testPopover || testPopover.hidden) return;
      if (ev.target.closest("[data-tg-open-tests]") || ev.target.closest("[data-tg-test-popover]")) return;
      closeTestPopover();
    });

    root.querySelectorAll("[data-tg-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dlg = btn.closest("dialog");
        closeDialog(dlg);
      });
    });

    [destDialog, prefsDialog].forEach(function (dlg) {
      if (!dlg) return;
      dlg.addEventListener("click", function (ev) {
        if (ev.target === dlg) closeDialog(dlg);
      });
      dlg.addEventListener("cancel", function (ev) {
        ev.preventDefault();
        closeDialog(dlg);
      });
    });

    root.querySelectorAll("[data-tg-dest-tab]").forEach(function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        var tab = tabBtn.getAttribute("data-tg-dest-tab");
        root.querySelectorAll("[data-tg-dest-tab]").forEach(function (el) {
          el.classList.toggle("active", el === tabBtn);
        });
        root.querySelectorAll("[data-tg-dest-panel]").forEach(function (panel) {
          panel.hidden = panel.getAttribute("data-tg-dest-panel") !== tab;
        });
      });
    });

    if (btnPrefsSave) {
      btnPrefsSave.addEventListener("click", function () {
        setBusy(btnPrefsSave, true);
        if (prefsStatus) prefsStatus.hidden = true;
        api("PATCH", "/api/telegram/preferences", readPrefsForm())
          .then(function (res) {
            state.notification_prefs = res.notification_prefs;
            renderRoutingPrefs();
            if (prefsStatus) {
              prefsStatus.hidden = false;
              prefsStatus.textContent = t("settings.tg.prefs_saved");
            }
          })
          .catch(function (err) {
            setStatus(err.message, "err");
          })
          .finally(function () {
            setBusy(btnPrefsSave, false);
          });
      });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener("click", function () {
        setBusy(btnRefresh, true);
        setStatus(t("settings.tg.refreshing"), "");
        api("POST", "/api/telegram/chats/refresh")
          .then(function (data) {
            renderChats(data.chats || []);
            setStatus(t("settings.tg.refresh_done"), "ok");
          })
          .catch(function (err) {
            setStatus(err.message, "err");
          })
          .finally(function () {
            setBusy(btnRefresh, false);
          });
      });
    }

    root.addEventListener("change", function (ev) {
      var target = ev.target;
      if (!target || !target.getAttribute) return;
      var chatId = target.getAttribute("data-chat-enable");
      if (!chatId) return;
      target.disabled = true;
      api("PATCH", "/api/telegram/chats/" + encodeURIComponent(chatId), { is_enabled: target.checked })
        .then(function (res) {
          if (res.chat) patchChat(res.chat);
        })
        .catch(function (err) {
          setStatus(err.message, "err");
          target.checked = !target.checked;
        })
        .finally(function () {
          target.disabled = false;
        });
    });

    function activateRulesTab(activeTab) {
      root.querySelectorAll("[data-tg-rules-tab]").forEach(function (el) {
        el.classList.toggle("active", el.getAttribute("data-tg-rules-tab") === activeTab);
      });
      root.querySelectorAll("[data-tg-rules-panel]").forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-tg-rules-panel") !== activeTab;
      });
    }

    if (window.location.hash === "#telegram-limits") {
      activateRulesTab("limits");
    }

    root.addEventListener("click", function (ev) {
      var routeTab = ev.target.closest("[data-tg-rules-tab]");
      if (routeTab) {
        var activeTab = routeTab.getAttribute("data-tg-rules-tab");
        activateRulesTab(activeTab);
        return;
      }
      var routeToggle = ev.target.closest("[data-tg-route-toggle]");
      if (routeToggle) {
        var rule = routeToggle.closest("[data-tg-route-key]");
        var body = rule && rule.querySelector(".tg-rule-body");
        if (body) {
          if (!body.innerHTML.trim()) {
            renderRoutingPrefs();
          }
          var opening = body.hidden;
          body.hidden = !opening;
          rule.classList.toggle("is-open", opening);
        }
        return;
      }
      var templateDefault = ev.target.closest("[data-tg-template-default]");
      if (templateDefault) {
        var templateKey = templateDefault.getAttribute("data-tg-template-default");
        var templateInput = root.querySelector('[data-tg-route-template="' + String(templateKey).replace(/"/g, '\\"') + '"]');
        if (templateInput) {
          templateInput.value = defaultRouteTemplate(templateKey);
          templateInput.focus();
        }
        return;
      }
      var btn = ev.target.closest("button");
      if (!btn) return;
      var deleteChat = btn.getAttribute("data-chat-delete");
      if (deleteChat) {
        setBusy(btn, true);
        api("DELETE", "/api/telegram/chats/" + encodeURIComponent(deleteChat))
          .then(function () {
            removeChat(deleteChat);
          })
          .catch(function (err) { setStatus(err.message, "err"); })
          .finally(function () { setBusy(btn, false); });
        return;
      }
      var approve = btn.getAttribute("data-sub-approve");
      if (approve) {
        setBusy(btn, true);
        api("POST", "/api/telegram/subscribers/" + encodeURIComponent(approve) + "/approve")
          .then(function (res) {
            if (res.subscriber) patchSubscriber(res.subscriber);
          })
          .catch(function (err) { setStatus(err.message, "err"); })
          .finally(function () { setBusy(btn, false); });
        return;
      }
      var reject = btn.getAttribute("data-sub-reject");
      if (reject) {
        setBusy(btn, true);
        api("POST", "/api/telegram/subscribers/" + encodeURIComponent(reject) + "/reject")
          .then(function (res) {
            if (res.subscriber) patchSubscriber(res.subscriber);
          })
          .catch(function (err) { setStatus(err.message, "err"); })
          .finally(function () { setBusy(btn, false); });
        return;
      }
      var deleteSub = btn.getAttribute("data-sub-delete");
      if (deleteSub) {
        setBusy(btn, true);
        api("DELETE", "/api/telegram/subscribers/" + encodeURIComponent(deleteSub))
          .then(function () {
            removeSubscriber(deleteSub);
          })
          .catch(function (err) { setStatus(err.message, "err"); })
          .finally(function () { setBusy(btn, false); });
        return;
      }
      var testKind = btn.getAttribute("data-tg-test");
      if (testKind) {
        setBusy(btn, true);
        setStatus(t("settings.tg.sending_test"), "");
        api("POST", "/api/telegram/test/" + encodeURIComponent(testKind))
          .then(function (data) {
            var sent = data.result && data.result.sent;
            setStatus(
              sent != null ? t("settings.tg.test_sent") + " (" + sent + ")" : t("settings.tg.test_sent"),
              "ok",
            );
            loadAll();
          })
          .catch(function (err) {
            setStatus(err.message, "err");
          })
          .finally(function () {
            setBusy(btn, false);
          });
      }
    });

    root.querySelectorAll("[data-tg-sub-tab]").forEach(function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        var tab = tabBtn.getAttribute("data-tg-sub-tab");
        root.querySelectorAll(".tg-sub-tab").forEach(function (el) {
          el.classList.toggle("active", el === tabBtn);
        });
        if (pendingList) pendingList.hidden = tab !== "pending";
        if (pendingEmpty) pendingEmpty.hidden = tab !== "pending" || state.pending.length > 0;
        if (approvedList) approvedList.hidden = tab !== "approved";
        if (approvedEmpty) approvedEmpty.hidden = tab !== "approved" || state.approved.length > 0;
      });
    });

    document.addEventListener("upos-settings-tab", function (ev) {
      var tab = ev.detail && ev.detail.tab;
      if (tab === "telegram") onTelegramTabActive();
      else onTelegramTabInactive();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") {
        onTelegramTabInactive();
      } else if (isTelegramPanelVisible()) {
        loadAll();
        connectSse();
      }
    });

    root._uposTelegramActive = onTelegramTabActive;
    if (isTelegramPanelVisible()) onTelegramTabActive();
  }

  window.uposInitTelegramSettings = init;

  if (document.querySelector("[data-telegram-settings][data-tg-eager]")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
