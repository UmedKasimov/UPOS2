(function () {
  "use strict";

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    const first = dialog.querySelector("input, button, select, textarea");
    if (first && typeof first.focus === "function") first.focus();
  }

  function setField(form, name, value) {
    const input = form.querySelector('[data-hr-edit-field="' + name + '"]');
    if (!input) return;
    if (input.type === "checkbox") {
      const clean = String(value || "").toLowerCase();
      input.checked = value === true || clean === "1" || clean === "true" || clean === "on";
      return;
    }
    input.value = value || "";
    if (input.matches("[data-upos-money-format]") && window.UPOS_MONEY_AUTO) {
      window.UPOS_MONEY_AUTO.format(input);
    }
  }

  function setPositionSelect(form, positionId, positionName) {
    const root = form.querySelector("[data-position-select]");
    if (!root) return;
    const idInput = root.querySelector("[data-position-id]");
    const nameInput = root.querySelector("[data-position-name]");
    const label = root.querySelector("[data-position-label]");
    const cleanId = positionId || "";
    const cleanName = positionName || "";
    if (idInput) idInput.value = cleanId;
    if (nameInput) nameInput.value = cleanName;
    if (label) label.textContent = cleanName || "Выберите должность";
    root.querySelectorAll("[data-position-row]").forEach(function (row) {
      row.classList.toggle("is-selected", !!cleanId && row.dataset.id === cleanId);
    });
    const menu = root.querySelector("[data-position-menu]");
    const trigger = root.querySelector("[data-position-trigger]");
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function fillEditForm(row) {
    const form = document.getElementById("hr-employee-edit-form");
    if (!form || !row) return null;
    form.reset();
    setField(form, "employee_id", row.dataset.employeeId || "");
    setField(form, "first_name", row.dataset.firstName || "");
    setField(form, "last_name", row.dataset.lastName || "");
    setField(form, "passport_series", row.dataset.passportSeries || "");
    setField(form, "passport_number", row.dataset.passportNumber || "");
    setField(form, "monthly_salary", row.dataset.monthlySalary || "0");
    setField(form, "is_courier", row.dataset.isCourier || "0");
    setField(form, "hired_at", row.dataset.hiredAt || "");
    setPositionSelect(form, row.dataset.positionId || "", row.dataset.position || "");
    return form;
  }

  const cardModal = document.getElementById("hr-employee-card-modal");
  const card = cardModal ? {
    name: cardModal.querySelector("[data-hr-card-name]"),
    fullName: cardModal.querySelector("[data-hr-card-full-name]"),
    position: cardModal.querySelector("[data-hr-card-position]"),
    avatar: cardModal.querySelector("[data-hr-card-avatar]"),
    present: cardModal.querySelector("[data-hr-card-present]"),
    absent: cardModal.querySelector("[data-hr-card-absent]"),
    earned: cardModal.querySelector("[data-hr-card-earned]"),
    due: cardModal.querySelector("[data-hr-card-due]"),
    salary: cardModal.querySelector("[data-hr-card-salary]"),
    passport: cardModal.querySelector("[data-hr-card-passport]"),
    hired: cardModal.querySelector("[data-hr-card-hired]"),
    status: cardModal.querySelector("[data-hr-card-status]"),
    bonus: cardModal.querySelector("[data-hr-card-bonus]"),
    penalty: cardModal.querySelector("[data-hr-card-penalty]"),
    edit: cardModal.querySelector("[data-hr-card-edit]"),
    dateFrom: cardModal.querySelector("[data-hr-card-date-from]"),
    dateTo: cardModal.querySelector("[data-hr-card-date-to]"),
    dateRange: cardModal.querySelector("[data-hr-card-date-range]"),
    period: cardModal.querySelector("[data-hr-card-period]"),
    accruals: cardModal.querySelector("[data-hr-card-accruals]"),
    payments: cardModal.querySelector("[data-hr-card-payments]"),
    balance: cardModal.querySelector("[data-hr-card-balance]"),
    balanceText: cardModal.querySelector("[data-hr-card-balance-text]"),
    state: cardModal.querySelector("[data-hr-card-state]"),
  } : null;

  function setText(node, value, fallback) {
    if (!node) return;
    const clean = String(value || "").trim();
    node.textContent = clean || fallback || "—";
  }

  function pageSelectedDate() {
    const paramsDate = new URLSearchParams(window.location.search).get("date");
    if (paramsDate) return paramsDate.slice(0, 10);
    const raw = document.getElementById("hr-calendar-data")?.textContent || "";
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.selectedDate) return String(parsed.selectedDate).slice(0, 10);
    } catch (error) {
      // Keep the card usable even if the embedded payload is not available.
    }
    return new Date().toISOString().slice(0, 10);
  }

  function activeOrganizationId() {
    if (!window.location.pathname.startsWith("/organizations/")) return "";
    const paramsOrg = new URLSearchParams(window.location.search).get("organization_id");
    if (paramsOrg) return paramsOrg.trim();
    const raw = document.getElementById("hr-calendar-data")?.textContent || "";
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.organizationId) return String(parsed.organizationId).trim();
    } catch (error) {
      // Organization id is optional outside the general organization HR page.
    }
    return "";
  }

  function parseIsoDate(value) {
    const raw = String(value || "").trim().slice(0, 10);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function isoDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function monthBounds(value) {
    const base = parseIsoDate(value) || new Date();
    return {
      from: isoDate(new Date(base.getFullYear(), base.getMonth(), 1)),
      to: isoDate(new Date(base.getFullYear(), base.getMonth() + 1, 0)),
    };
  }

  function formatDate(value) {
    if (window.UPOS_DATE_RANGE?.display) return window.UPOS_DATE_RANGE.display(value) || value || "";
    const date = parseIsoDate(value);
    if (!date) return value || "";
    const pad = (part) => String(part).padStart(2, "0");
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  }

  function periodLabel(from, to) {
    const cleanFrom = String(from || "").trim().slice(0, 10);
    const cleanTo = String(to || cleanFrom || "").trim().slice(0, 10);
    if (cleanFrom && cleanTo && cleanFrom !== cleanTo) return `${formatDate(cleanFrom)} - ${formatDate(cleanTo)}`;
    if (cleanFrom) return formatDate(cleanFrom);
    return "";
  }

  let cardDatePicker = null;

  function setCardRange(from, to, preset) {
    if (!card) return;
    const nextFrom = String(from || "").trim().slice(0, 10);
    const nextTo = String(to || nextFrom || "").trim().slice(0, 10);
    if (card.dateFrom) card.dateFrom.value = nextFrom;
    if (card.dateTo) card.dateTo.value = nextTo;
    setText(card.period, periodLabel(nextFrom, nextTo), "");
    cardDatePicker?.setValue({
      preset: preset || "custom",
      date_from: nextFrom,
      date_to: nextTo,
      label: periodLabel(nextFrom, nextTo),
    });
  }

  function initCardDatePicker() {
    if (!card?.dateRange || cardDatePicker || !window.UPOS_DATE_RANGE) return;
    const bounds = monthBounds(pageSelectedDate());
    cardDatePicker = window.UPOS_DATE_RANGE.create(card.dateRange, {
      preset: "month",
      date_from: bounds.from,
      date_to: bounds.to,
      label: periodLabel(bounds.from, bounds.to),
      onApply: function (range) {
        const nextFrom = range.date_from || range.date_to || "";
        const nextTo = range.date_to || range.date_from || "";
        setCardRange(nextFrom, nextTo, range.preset || "custom");
        loadSalaryAct();
      },
    });
  }

  function setCardState(message) {
    if (!card?.state) return;
    const clean = String(message || "").trim();
    card.state.hidden = !clean;
    card.state.textContent = clean;
  }

  function clearLedger(node, emptyText) {
    if (!node) return;
    node.replaceChildren();
    if (!emptyText) return;
    const empty = document.createElement("p");
    empty.className = "org-ops-empty";
    empty.textContent = emptyText;
    node.append(empty);
  }

  function appendLedgerRow(node, title, amount, meta, note, tone) {
    if (!node) return;
    const row = document.createElement("div");
    row.className = "org-hr-card-ledger-row";
    if (tone) row.classList.add("is-" + tone);
    const left = document.createElement("div");
    const rowTitle = document.createElement("strong");
    rowTitle.textContent = title || "—";
    left.append(rowTitle);
    if (meta) {
      const rowMeta = document.createElement("span");
      rowMeta.textContent = meta;
      left.append(rowMeta);
    }
    if (note) {
      const rowNote = document.createElement("small");
      rowNote.textContent = note;
      left.append(rowNote);
    }
    const value = document.createElement("b");
    value.textContent = amount || "0 UZS";
    row.append(left, value);
    node.append(row);
  }

  function monthKeyFromValue(value) {
    const raw = String(value || "").trim();
    let match = raw.match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
    match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (match) return `${match[3]}-${match[2]}`;
    return "";
  }

  function monthLabelFromKey(monthKey) {
    const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "Без месяца";
    const names = [
      "",
      "Январь",
      "Февраль",
      "Март",
      "Апрель",
      "Май",
      "Июнь",
      "Июль",
      "Август",
      "Сентябрь",
      "Октябрь",
      "Ноябрь",
      "Декабрь",
    ];
    const index = Number(match[2]);
    return `${names[index] || match[2]} ${match[1]}`;
  }

  function ledgerMonthInfo(row, fallbackDate) {
    const monthKey =
      row?.month_key ||
      monthKeyFromValue(row?.sort_date) ||
      monthKeyFromValue(row?.date_from) ||
      monthKeyFromValue(row?.work_date) ||
      monthKeyFromValue(row?.created_label) ||
      monthKeyFromValue(fallbackDate);
    return {
      key: monthKey || "unknown",
      label: row?.month_label || monthLabelFromKey(monthKey),
    };
  }

  function appendLedgerMonth(node, label) {
    const section = document.createElement("section");
    section.className = "org-hr-card-ledger-month";
    const title = document.createElement("h4");
    title.textContent = label || "Без месяца";
    const body = document.createElement("div");
    body.className = "org-hr-card-ledger-month-body";
    section.append(title, body);
    node.append(section);
    return body;
  }

  function renderGroupedLedger(node, rows, emptyText, renderRow, fallbackDate) {
    if (!node) return;
    const cleanRows = (rows || []).filter(Boolean);
    if (!cleanRows.length) {
      clearLedger(node, emptyText);
      return;
    }
    clearLedger(node, "");
    const groups = new Map();
    cleanRows.forEach(function (row) {
      const info = ledgerMonthInfo(row, fallbackDate);
      if (!groups.has(info.key)) groups.set(info.key, { label: info.label, rows: [] });
      groups.get(info.key).rows.push(row);
    });
    Array.from(groups.entries())
      .sort(function (a, b) {
        return String(b[0]).localeCompare(String(a[0]));
      })
      .forEach(function ([, group]) {
        const body = appendLedgerMonth(node, group.label);
        group.rows
          .sort(function (a, b) {
            const order = Number(a.order || 0) - Number(b.order || 0);
            if (order) return order;
            return String(b.sort_date || "").localeCompare(String(a.sort_date || ""));
          })
          .forEach(function (row) {
            renderRow(body, row);
          });
      });
  }

  function setBalance(state, label) {
    if (!card?.balance || !card.balanceText) return;
    card.balance.classList.remove("is-due", "is-overpaid", "is-closed");
    const cleanState = state === "overpaid" ? "overpaid" : state === "closed" ? "closed" : "due";
    card.balance.classList.add("is-" + cleanState);
    const rawAmount = String(label || "0").trim() || "0";
    const amount = /\b[A-Z]{3}\b/.test(rawAmount) ? rawAmount : `${rawAmount} UZS`;
    if (cleanState === "overpaid") {
      card.balanceText.textContent = `Сотрудник должен: ${amount}`;
    } else if (cleanState === "closed") {
      card.balanceText.textContent = "Баланс закрыт: 0 UZS";
    } else {
      card.balanceText.textContent = `Мы должны: ${amount}`;
    }
  }

  function renderSalaryAct(act) {
    if (!card || !act) return;
    const employee = act.employee || {};
    const period = act.date_from && act.date_to ? periodLabel(act.date_from, act.date_to) : periodLabel(act.date, act.date);
    setText(card.period, period, "");
    setText(card.present, employee.present_days, "0");
    setText(card.absent, employee.absent_days, "0");
    setText(card.earned, `${act.salary_due_label || employee.salary_due_label || "0"} UZS`, "0 UZS");
    setText(
      card.due,
      act.balance_state === "due" ? `${act.balance_uzs_label || "0"} UZS` : "0 UZS",
      "0 UZS"
    );
    setText(card.salary, `${employee.monthly_salary_label || "0"} UZS`, "0 UZS");
    setText(card.bonus, `${employee.salary_bonus_label || "0"} UZS`, "0 UZS");
    setText(card.penalty, `${employee.salary_penalty_label || "0"} UZS`, "0 UZS");
    setBalance(act.balance_state, act.balance_uzs_label);

    const baseRows = (act.salary_base_months || []).map(function (row) {
      return {
        ...row,
        order: 0,
        sort_date: row.date_from || act.date_from || act.date,
      };
    });
    if (!baseRows.length) {
      baseRows.push({
        type: "base",
        type_label: "Зарплата по табелю",
        amount_label: employee.salary_base_due_label || act.salary_due_label || "0",
        date_from: act.date_from || act.date,
        date_to: act.date_to || act.date,
        month_key: monthKeyFromValue(act.date_from || act.date),
        month_label: monthLabelFromKey(monthKeyFromValue(act.date_from || act.date)),
        present_days: employee.present_days || 0,
        absent_days: employee.absent_days || 0,
        monthly_salary_label: employee.monthly_salary_label || "0",
        order: 0,
        sort_date: act.date_from || act.date,
      });
    }
    const adjustmentRows = (employee.salary_adjustments || []).map(function (item) {
      return {
        ...item,
        order: 1,
        sort_date: item.work_date || act.date_from || act.date,
      };
    });
    renderGroupedLedger(
      card.accruals,
      baseRows.concat(adjustmentRows),
      "Начислений за выбранный период пока нет.",
      function (node, row) {
        if (row.type === "base") {
          const rowPeriod =
            row.date_from && row.date_to ? periodLabel(row.date_from, row.date_to) : row.date_from || period;
          appendLedgerRow(
            node,
            row.type_label || "Зарплата по табелю",
            `${row.amount_label || "0"} UZS`,
            rowPeriod,
            `Оклад ${row.monthly_salary_label || employee.monthly_salary_label || "0"} UZS, пришёл ${row.present_days || 0}, не пришёл ${row.absent_days || 0}`,
            "base"
          );
          return;
        }
        appendLedgerRow(
          node,
          row.type_label || "Начисление",
          `${row.amount_label || "0"} UZS`,
          row.work_date || "",
          row.comment || "",
          row.type === "penalty" ? "negative" : "positive"
        );
      },
      act.date_from || act.date
    );

    const payments = (act.payments || []).map(function (row) {
      return {
        ...row,
        order: 0,
        sort_date: row.created_label || act.date_from || act.date,
      };
    });
    renderGroupedLedger(
      card.payments,
      payments,
      "Выплат за выбранный период пока нет.",
      function (node, row) {
        appendLedgerRow(
          node,
          `#${row.number || "—"}`,
          `${row.amount_label || "0"} ${row.currency || "UZS"}`,
          row.created_label || "",
          row.account || row.note || "",
          "payment"
        );
      },
      act.date_from || act.date
    );
  }

  async function loadSalaryAct() {
    if (!cardModal || !card) return;
    const id = cardModal.dataset.employeeId || "";
    const fallback = pageSelectedDate();
    const dateFrom = card.dateFrom?.value || fallback;
    const dateTo = card.dateTo?.value || dateFrom;
    if (!id) return;
    setCardState("Загружаем начисления и оплаты...");
    try {
      const url = new URL(`/api/hr/salary-act/${encodeURIComponent(id)}`, window.location.origin);
      url.searchParams.set("date", dateFrom);
      url.searchParams.set("date_from", dateFrom);
      url.searchParams.set("date_to", dateTo);
      const organizationId = activeOrganizationId();
      if (organizationId) url.searchParams.set("organization_id", organizationId);
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "salary_act_failed");
      renderSalaryAct(data.act);
      setCardState("");
    } catch (error) {
      clearLedger(card.accruals, "Не удалось загрузить начисления.");
      clearLedger(card.payments, "Не удалось загрузить оплаты.");
      setCardState("Не удалось загрузить акт сотрудника за выбранную дату.");
    }
  }

  function setCardAvatar(row) {
    if (!card?.avatar) return;
    card.avatar.replaceChildren();
    const url = String(row.dataset.photoUrl || "").trim();
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      card.avatar.append(img);
      return;
    }
    const name = String(row.dataset.fullName || row.dataset.firstName || "?").trim();
    card.avatar.textContent = (name[0] || "?").toUpperCase();
  }

  function fillCard(row) {
    if (!cardModal || !card || !row) return;
    const fullName = row.dataset.fullName || `${row.dataset.firstName || ""} ${row.dataset.lastName || ""}`.trim();
    const position = row.dataset.position || "Без должности";
    const passport = `${row.dataset.passportSeries || ""} ${row.dataset.passportNumber || ""}`.trim();
    cardModal.dataset.employeeId = row.dataset.employeeId || "";
    setText(card.name, fullName, "Сотрудник");
    setText(card.fullName, fullName, "Сотрудник");
    setText(card.position, position, "Без должности");
    setText(card.present, row.dataset.presentDays, "0");
    setText(card.absent, row.dataset.absentDays, "0");
    setText(card.earned, row.dataset.salaryDueLabel, "0 UZS");
    setText(card.due, row.dataset.salaryDueLabel, "0 UZS");
    setText(card.salary, row.dataset.monthlySalaryLabel, "0 UZS");
    setText(card.passport, passport, "—");
    setText(card.hired, row.dataset.hiredAt, "—");
    setText(card.status, row.dataset.status === "dismissed" ? "Уволен" : "Активный", "Активный");
    setText(card.bonus, row.dataset.salaryBonusLabel, "0 UZS");
    setText(card.penalty, row.dataset.salaryPenaltyLabel, "0 UZS");
    setCardAvatar(row);
    initCardDatePicker();
    const bounds = monthBounds(pageSelectedDate());
    setCardRange(bounds.from, bounds.to, "month");
    clearLedger(card.accruals, "Загружаем начисления...");
    clearLedger(card.payments, "Загружаем оплаты...");
    setBalance("due", row.dataset.salaryDueLabel || "0");
    loadSalaryAct();
  }

  function closeCard() {
    if (!cardModal) return;
    if (typeof cardModal.close === "function") cardModal.close();
    else cardModal.removeAttribute("open");
  }

  document.addEventListener("click", function (event) {
    const cardTrigger = event.target.closest("[data-hr-card-open]");
    if (cardTrigger) {
      event.preventDefault();
      const row = cardTrigger.closest("[data-hr-employee-row]");
      fillCard(row);
      openDialog(cardModal);
      return;
    }

    const cardClose = event.target.closest("[data-hr-card-close]");
    if (cardClose) {
      event.preventDefault();
      closeCard();
      return;
    }

    const cardEdit = event.target.closest("[data-hr-card-edit]");
    if (cardEdit) {
      event.preventDefault();
      const id = cardModal?.dataset.employeeId || "";
      const row = id ? document.querySelector('[data-hr-employee-row][data-employee-id="' + CSS.escape(id) + '"]') : null;
      const form = fillEditForm(row);
      if (!form) return;
      closeCard();
      openDialog(document.getElementById("hr-employee-edit-modal"));
      return;
    }

    const trigger = event.target.closest("[data-hr-edit-open]");
    if (!trigger) return;
    event.preventDefault();
    const row = trigger.closest("[data-hr-employee-row]");
    const form = fillEditForm(row);
    if (!form) return;
    openDialog(document.getElementById("hr-employee-edit-modal"));
  });

  cardModal?.addEventListener("click", function (event) {
    if (event.target === cardModal) closeCard();
  });

  initCardDatePicker();
})();
