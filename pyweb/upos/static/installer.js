(() => {
  "use strict";

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const canManage = document.body.dataset.canManage === "1";
  const listNode = document.getElementById("installer-order-list");
  const detailDialog = document.getElementById("installer-detail");
  const detailBody = document.getElementById("installer-detail-body");
  const calendarDialog = document.getElementById("installer-calendar");
  const calendarGrid = document.getElementById("installer-calendar-grid");
  const calendarOrders = document.getElementById("installer-calendar-orders");
  const menuToggle = document.getElementById("installer-menu-toggle");
  const menuNode = document.getElementById("installer-menu");
  const menuClose = document.getElementById("installer-menu-close");
  const menuBackdrop = document.getElementById("installer-menu-backdrop");
  const helpDialog = document.getElementById("installer-help");
  const toastNode = document.getElementById("installer-toast");

  const TAB_STATUSES = {
    new: ["new", "pending"],
    calendar: ["accepted", "date_negotiation", "scheduled", "postponed"],
    work: ["en_route", "started", "in_progress"],
    done: ["awaiting_payment"],
    archive: ["completed", "cancelled"],
  };

  const STATUS_ACTIONS = {
    new: [{ status: "accepted", label: "Принять заказ", primary: true }],
    pending: [{ status: "accepted", label: "Принять заказ", primary: true }],
    accepted: [{ status: "date_negotiation", label: "Согласовать дату" }],
    date_negotiation: [],
    scheduled: [{ status: "en_route", label: "Выехал", primary: true }],
    en_route: [{ status: "started", label: "Начать установку", primary: true }],
    started: [{ status: "in_progress", label: "Продолжить работу", primary: true }],
    in_progress: [{ status: "awaiting_payment", label: "Ожидает оплаты" }],
    awaiting_payment: [],
    postponed: [{ status: "accepted", label: "Вернуть в работу" }],
    completed: [],
    cancelled: [],
  };

  const state = {
    orders: [],
    activeTab: "new",
    activeId: "",
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calendarDate: "",
    deferredInstallPrompt: null,
    busy: false,
    pushKey: "",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function numberValue(value) {
    const parsed = Number.parseFloat(String(value ?? "0").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatMoney(value, currency) {
    const amount = numberValue(value);
    const fraction = Math.abs(amount % 1) > 0.0001 ? 2 : 0;
    return `${new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    }).format(amount)} ${escapeHtml(currency || "UZS")}`;
  }

  function parseLocalDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    const date = parseLocalDate(value);
    if (!date) return "Дата не назначена";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function isToday(value) {
    const date = parseLocalDate(value);
    if (!date) return false;
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  }

  function dateKey(value) {
    const date = value instanceof Date ? value : parseLocalDate(value);
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function calendarDateLabel(value) {
    const date = dateFromKey(value);
    if (!date) return "Заказы на выбранный день";
    return new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function ordersForDate(value) {
    return state.orders
      .filter((order) => dateKey(order.scheduled_at) === value)
      .sort((left, right) => {
        const leftTime = parseLocalDate(left.scheduled_at)?.getTime() || 0;
        const rightTime = parseLocalDate(right.scheduled_at)?.getTime() || 0;
        return leftTime - rightTime;
      });
  }

  function phoneHref(phone) {
    const clean = String(phone || "").replace(/[^\d+]/g, "");
    return clean ? `tel:${clean}` : "";
  }

  function mapHref(order) {
    const lat = String(order.latitude || "").trim();
    const lng = String(order.longitude || "").trim();
    if (lat && lng) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    }
    const address = String(order.client?.address || "").trim();
    return address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : "";
  }

  function groupForStatus(status) {
    return Object.keys(TAB_STATUSES).find((key) => TAB_STATUSES[key].includes(status)) || "new";
  }

  function setBusy(value) {
    state.busy = value;
    document.body.classList.toggle("is-busy", value);
  }

  function showToast(message, isError = false) {
    toastNode.textContent = message;
    toastNode.classList.toggle("is-error", isError);
    toastNode.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toastNode.classList.remove("is-visible");
    }, 3200);
  }

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        ...(options.headers || {}),
      },
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      payload = {};
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Не удалось выполнить действие");
    }
    return payload;
  }

  function replaceOrder(order) {
    const index = state.orders.findIndex((item) => item.id === order.id);
    if (index >= 0) state.orders[index] = order;
    else state.orders.unshift(order);
    render();
    if (state.activeId === order.id && detailDialog.open) renderDetail(order);
  }

  function renderCounters() {
    const counts = {
      new: state.orders.filter((order) => groupForStatus(order.status) === "new").length,
      calendar: state.orders.filter((order) => groupForStatus(order.status) === "calendar").length,
      work: state.orders.filter((order) => groupForStatus(order.status) === "work").length,
      done: state.orders.filter((order) => order.status === "completed").length,
      archive: state.orders.filter((order) => groupForStatus(order.status) === "archive").length,
      today: state.orders.filter((order) => isToday(order.scheduled_at)).length,
    };
    document.getElementById("installer-count-new").textContent = counts.new;
    document.getElementById("installer-count-today").textContent = counts.today;
    document.getElementById("installer-count-work").textContent = counts.work;
    document.getElementById("installer-count-done").textContent = counts.done;
    document.getElementById("installer-tab-new").textContent = counts.new;
    document.getElementById("installer-tab-calendar").textContent = counts.calendar;
    document.getElementById("installer-tab-work").textContent = counts.work;
    document.getElementById("installer-tab-done").textContent =
      state.orders.filter((order) => groupForStatus(order.status) === "done").length;
    document.getElementById("installer-tab-archive").textContent = counts.archive;
  }

  function progressMarkup(order) {
    const percent = Math.max(0, Math.min(100, Number(order.progress?.percent || 0)));
    const label = order.progress?.label || "Задач нет";
    return `
      <div class="installer-progress">
        <div class="installer-progress-label">
          <span>${escapeHtml(label)}</span>
          <strong>${percent}%</strong>
        </div>
        <div class="installer-progress-track"><i style="width:${percent}%"></i></div>
      </div>
    `;
  }

  function quickActionMarkup(order) {
    if (order.status === "new" || order.status === "pending") {
      return `<button class="installer-primary-button" type="button" data-action="accept" data-id="${escapeHtml(order.id)}">Принять</button>`;
    }
    if (["accepted", "date_negotiation", "postponed"].includes(order.status)) {
      return `<button class="installer-secondary-button" type="button" data-action="open" data-id="${escapeHtml(order.id)}">Назначить дату</button>`;
    }
    if (order.status === "scheduled") {
      return `<button class="installer-primary-button" type="button" data-action="status" data-status="en_route" data-id="${escapeHtml(order.id)}">Выехал</button>`;
    }
    return `<button class="installer-secondary-button" type="button" data-action="open" data-id="${escapeHtml(order.id)}">Открыть</button>`;
  }

  function orderCardMarkup(order) {
    const client = order.client || {};
    const paid = numberValue(order.paid_amount);
    const total = numberValue(order.amount);
    const balance = Math.max(0, total - paid);
    const scheduleClass = order.scheduled_at ? "" : " installer-warning";
    return `
      <article class="installer-order-card" data-priority="${escapeHtml(order.priority)}">
        <div class="installer-order-top">
          <span class="installer-order-number">№ ${escapeHtml(order.number || order.id.slice(0, 8))}</span>
          <span class="installer-status">${escapeHtml(order.status_label)}</span>
        </div>
        <h2>${escapeHtml(client.name || "Клиент")}</h2>
        <div class="installer-order-meta">
          <span class="${scheduleClass}">${escapeHtml(formatDateTime(order.scheduled_at))}</span>
          <strong>${formatMoney(order.amount, order.currency)}</strong>
          <span>${escapeHtml(client.address || "Адрес не указан")}</span>
          <strong>${balance > 0 ? `Остаток ${formatMoney(balance, order.currency)}` : "Оплачено"}</strong>
        </div>
        ${order.conflict_warning ? `<p class="installer-warning">${escapeHtml(order.conflict_warning)}</p>` : ""}
        ${progressMarkup(order)}
        <div class="installer-order-actions">
          ${quickActionMarkup(order)}
          <button class="installer-secondary-button" type="button" data-action="open" data-id="${escapeHtml(order.id)}">Детали</button>
        </div>
      </article>
    `;
  }

  function renderList() {
    const orders = state.orders
      .filter((order) => groupForStatus(order.status) === state.activeTab)
      .sort((left, right) => {
        const leftTime = parseLocalDate(left.scheduled_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = parseLocalDate(right.scheduled_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });

    if (!orders.length) {
      const messages = {
        new: "Новых заказов пока нет",
        calendar: "В календаре пока нет установок",
        work: "Нет активных установок",
        done: "Нет установок, ожидающих закрытия",
        archive: "Архив завершённых проектов пока пуст",
      };
      listNode.innerHTML = `<div class="installer-empty">${messages[state.activeTab]}</div>`;
      return;
    }
    listNode.innerHTML = orders.map(orderCardMarkup).join("");
  }

  function render() {
    renderCounters();
    renderList();
    document.querySelectorAll(".installer-tab").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === state.activeTab);
    });
    if (calendarDialog.open) renderOrderCalendar();
  }

  function calendarEventMarkup(order) {
    const clientName = order.client?.name || order.number || "Клиент";
    return `
      <button
        class="installer-calendar-event"
        type="button"
        data-calendar-order-id="${escapeHtml(order.id)}"
        title="${escapeHtml(clientName)}"
      >${escapeHtml(clientName)}</button>
    `;
  }

  function calendarOrderMarkup(order) {
    const clientName = order.client?.name || "Клиент";
    const orderNumber = order.number || order.id.slice(0, 8);
    return `
      <button
        class="installer-calendar-order"
        type="button"
        data-calendar-order-id="${escapeHtml(order.id)}"
      >
        <strong>${escapeHtml(clientName)}</strong>
        <span>${formatMoney(order.amount, order.currency)}</span>
        <small>${escapeHtml(formatDateTime(order.scheduled_at))} · Заказ № ${escapeHtml(orderNumber)} · ${escapeHtml(order.status_label || "")}</small>
      </button>
    `;
  }

  function renderOrderCalendar() {
    if (!state.calendarDate) state.calendarDate = dateKey(new Date());

    const month = state.calendarMonth;
    document.getElementById("installer-calendar-month").textContent =
      new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(month);

    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - mondayOffset);
    const todayKey = dateKey(new Date());
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = dateKey(day);
      const orders = ordersForDate(key);
      const classes = ["installer-calendar-day"];
      if (day.getMonth() !== month.getMonth()) classes.push("is-outside");
      if (key === state.calendarDate) classes.push("is-selected");
      if (key === todayKey) classes.push("is-today");
      cells.push(`
        <div class="${classes.join(" ")}" data-calendar-date="${key}">
          <button class="installer-calendar-date" type="button" data-calendar-date="${key}">
            ${day.getDate()}
          </button>
          ${orders.slice(0, 2).map(calendarEventMarkup).join("")}
          ${orders.length > 2 ? `<span class="installer-calendar-more">+ ещё ${orders.length - 2}</span>` : ""}
        </div>
      `);
    }
    calendarGrid.innerHTML = cells.join("");

    const selectedOrders = ordersForDate(state.calendarDate);
    document.getElementById("installer-calendar-selected-title").textContent =
      calendarDateLabel(state.calendarDate);
    calendarOrders.innerHTML = selectedOrders.length
      ? selectedOrders.map(calendarOrderMarkup).join("")
      : '<div class="installer-empty">На выбранный день установок нет</div>';
  }

  const earningsDialog = document.getElementById("installer-earnings");
  const notificationsDialog = document.getElementById("installer-notifications");

  // Разделы меню — полноэкранные страницы, поэтому каждая добавляет запись в
  // историю: системная кнопка «Назад» должна возвращать к заказам, а не
  // закрывать приложение.
  function openScreen(dialog, name) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    window.history.pushState({installerScreen: name}, "");
  }

  function closeScreen(dialog) {
    if (!dialog?.open) return;
    // Закрытие идёт через историю, чтобы состояние совпадало с кнопкой «Назад».
    if (window.history.state && window.history.state.installerScreen) window.history.back();
    else dialog.close();
  }

  window.addEventListener("popstate", () => {
    [notificationsDialog, earningsDialog, phonebookDialog, newOrderDialog, clientsDialog, document.getElementById("installer-calendar")].forEach((dialog) => {
      if (dialog?.open) dialog.close();
    });
  });

  const phonebookDialog = document.getElementById("installer-phonebook");
  const newOrderDialog = document.getElementById("installer-new-order");
  const clientsDialog = document.getElementById("installer-clients");
  let phonebookContacts = [];
  let clientCache = [];

  async function loadClients(query) {
    const url = query ? `/api/installer/clients?q=${encodeURIComponent(query)}` : "/api/installer/clients";
    const data = await apiRequest(url);
    clientCache = data.clients || [];
    return clientCache;
  }

  function renderClientList(rows) {
    const list = document.getElementById("installer-client-list");
    if (!list) return;
    list.innerHTML = rows.length
      ? rows.map((row) => `
          <article class="installer-phone-item">
            <div class="installer-phone-info">
              <strong>${escapeHtml(row.name)}</strong>
              <span>${escapeHtml(row.phone || "телефон не указан")}</span>
              <small>${escapeHtml(row.address || "")}</small>
            </div>
          </article>`).join("")
      : '<div class="installer-empty">Клиентов не найдено</div>';
  }

  async function openClients() {
    closeInstallerMenu();
    if (!clientsDialog) return;
    const list = document.getElementById("installer-client-list");
    if (list) list.innerHTML = '<div class="installer-loading">Загрузка...</div>';
    openScreen(clientsDialog, "clients");
    try {
      renderClientList(await loadClients(""));
    } catch (error) {
      if (list) list.innerHTML = `<div class="installer-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  document.getElementById("installer-client-search")?.addEventListener("input", (event) => {
    const needle = String(event.target.value || "").trim().toLowerCase();
    renderClientList(
      needle
        ? clientCache.filter((row) => `${row.name} ${row.phone}`.toLowerCase().includes(needle))
        : clientCache
    );
  });

  document.getElementById("installer-client-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("installer-client-name");
    const phone = document.getElementById("installer-client-phone");
    const address = document.getElementById("installer-client-address");
    const submit = event.target.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await apiRequest("/api/installer/clients", {
        method: "POST",
        body: JSON.stringify({name: name.value, phone: phone.value, address: address.value}),
      });
      showToast("Клиент добавлен");
      name.value = ""; phone.value = ""; address.value = "";
      renderClientList(await loadClients(""));
    } catch (error) {
      showToast(error.message || "Не удалось добавить", true);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  document.getElementById("installer-clients-close")?.addEventListener("click", () => {
    closeScreen(clientsDialog);
  });

  async function openNewOrder() {
    closeInstallerMenu();
    if (!newOrderDialog) return;
    openScreen(newOrderDialog, "new-order");
    try {
      const [clients, agents] = await Promise.all([
        loadClients(""),
        apiRequest("/api/installer/agents"),
      ]);
      const options = document.getElementById("installer-client-options");
      if (options) {
        options.innerHTML = clients
          .map((row) => `<option value="${escapeHtml(row.name)}"></option>`)
          .join("");
      }
      // Список агентов нужен только руководителю: установщик оформляет на себя.
      const wrap = document.getElementById("installer-order-agent-wrap");
      const select = document.getElementById("installer-order-agent");
      if (wrap && select) {
        const list = agents.agents || [];
        wrap.hidden = !list.length;
        select.innerHTML = list
          .map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`)
          .join("");
      }
    } catch (error) {
      showToast(error.message || "Не удалось загрузить справочники", true);
    }
  }

  document.getElementById("installer-order-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const clientInput = document.getElementById("installer-order-client");
    const typed = String(clientInput.value || "").trim();
    const matched = clientCache.find((row) => row.name.toLowerCase() === typed.toLowerCase());
    const agent = document.getElementById("installer-order-agent");
    const agentWrap = document.getElementById("installer-order-agent-wrap");
    const submit = event.target.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const payload = {
        client_id: matched ? matched.id : "",
        client_name: matched ? "" : typed,
        scheduled_at: document.getElementById("installer-order-date").value,
        amount: document.getElementById("installer-order-amount").value,
        note: document.getElementById("installer-order-note").value,
      };
      if (agentWrap && !agentWrap.hidden && agent) payload.installer_user_id = agent.value;
      const data = await apiRequest("/api/installer/orders/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast(`Заказ ${data.order.number} создан`);
      event.target.reset();
      closeScreen(newOrderDialog);
      loadOrders();
    } catch (error) {
      showToast(error.message || "Не удалось создать заказ", true);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  document.getElementById("installer-new-order-close")?.addEventListener("click", () => {
    closeScreen(newOrderDialog);
  });

  function renderPhonebook(filter) {
    const list = document.getElementById("installer-phone-list");
    if (!list) return;
    const needle = String(filter || "").trim().toLowerCase();
    const rows = needle
      ? phonebookContacts.filter((row) =>
          `${row.name} ${row.phone} ${row.order_number}`.toLowerCase().includes(needle))
      : phonebookContacts;
    list.innerHTML = rows.length
      ? rows.map((row) => `
          <article class="installer-phone-item">
            <div class="installer-phone-info">
              <strong>${escapeHtml(row.name)}</strong>
              <span>${escapeHtml(row.phone)}</span>
              <small>${escapeHtml([row.order_number, row.address].filter(Boolean).join(" · "))}</small>
            </div>
            <button type="button" class="installer-primary-button installer-phone-call"
              data-call-phone="${escapeHtml(row.phone)}" data-call-name="${escapeHtml(row.name)}">Позвонить</button>
          </article>`).join("")
      : '<div class="installer-empty">Клиентов с телефоном не найдено</div>';
  }

  async function openPhonebook() {
    closeInstallerMenu();
    if (!phonebookDialog) return;
    const list = document.getElementById("installer-phone-list");
    const calls = document.getElementById("installer-phone-calls");
    if (list) list.innerHTML = '<div class="installer-loading">Загрузка...</div>';
    if (calls) calls.innerHTML = "";
    openScreen(phonebookDialog, "phonebook");
    try {
      const data = await apiRequest("/api/installer/phonebook");
      phonebookContacts = data.contacts || [];
      renderPhonebook(document.getElementById("installer-phone-search")?.value);
      if (calls) {
        calls.innerHTML = (data.calls || []).length
          ? data.calls.map((row) => `
              <article class="installer-phone-call-row">
                <div>
                  <strong>${escapeHtml(row.name || row.phone)}</strong>
                  <small>${escapeHtml(notifyTime(row.started_at))}</small>
                </div>
                <span>${escapeHtml(row.phone)}</span>
              </article>`).join("")
          : '<div class="installer-empty">Звонков пока нет</div>';
      }
    } catch (error) {
      if (list) list.innerHTML = `<div class="installer-empty">${escapeHtml(error.message || "Не удалось загрузить")}</div>`;
    }
  }

  document.getElementById("installer-phone-search")?.addEventListener("input", (event) => {
    renderPhonebook(event.target.value);
  });

  document.getElementById("installer-phone-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-call-phone]");
    if (!button) return;
    const phone = button.dataset.callPhone;
    // Звонок уходит средствами телефона, а факт набора пишем в журнал,
    // чтобы руководитель видел активность по клиентам.
    apiRequest("/api/installer/calls", {
      method: "POST",
      body: JSON.stringify({phone: phone, name: button.dataset.callName || ""}),
    }).catch(() => {});
    window.location.href = `tel:${String(phone).replace(/[^\d+]/g, "")}`;
  });

  document.getElementById("installer-phonebook-close")?.addEventListener("click", () => {
    closeScreen(phonebookDialog);
  });

  function notifyTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("ru-RU", {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"});
  }

  function renderNotifications(items) {
    const list = document.getElementById("installer-notify-list");
    if (!list) return;
    list.innerHTML = items.length
      ? items.map((item) => `
          <article class="installer-notify-item${item.is_read ? " is-read" : ""}" data-notify-id="${escapeHtml(item.id)}">
            <div class="installer-notify-top">
              <strong>${escapeHtml(item.title || "Уведомление")}</strong>
              ${item.is_read ? "" : '<span class="installer-notify-new">NEW</span>'}
            </div>
            ${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}
            <small>${escapeHtml(notifyTime(item.created_at))}</small>
          </article>`).join("")
      : '<div class="installer-empty">Уведомлений пока нет</div>';
  }

  function setNotifyBadge(count) {
    const badge = document.getElementById("installer-notify-badge");
    if (!badge) return;
    badge.textContent = String(count || 0);
    badge.hidden = !count;
  }

  async function refreshNotifyBadge() {
    try {
      const data = await apiRequest("/api/installer/notifications");
      setNotifyBadge(data.unread);
    } catch (error) {
      setNotifyBadge(0);
    }
  }

  async function openNotifications() {
    closeInstallerMenu();
    if (!notificationsDialog) return;
    const list = document.getElementById("installer-notify-list");
    if (list) list.innerHTML = '<div class="installer-loading">Загрузка...</div>';
    openScreen(notificationsDialog, "notifications");
    try {
      const data = await apiRequest("/api/installer/notifications");
      renderNotifications(data.items || []);
      setNotifyBadge(data.unread);
    } catch (error) {
      if (list) list.innerHTML = `<div class="installer-empty">${escapeHtml(error.message || "Не удалось загрузить")}</div>`;
    }
  }

  // Читаем по клику на само уведомление — так пользователь сам решает,
  // что уже просмотрел.
  document.getElementById("installer-notify-list")?.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-notify-id]");
    if (!item || item.classList.contains("is-read")) return;
    item.classList.add("is-read");
    item.querySelector(".installer-notify-new")?.remove();
    try {
      const data = await apiRequest("/api/installer/notifications/read", {
        method: "POST",
        body: JSON.stringify({id: item.dataset.notifyId}),
      });
      setNotifyBadge(data.unread);
    } catch (error) {
      /* пометка о прочтении не критична */
    }
  });

  document.getElementById("installer-notify-read-all")?.addEventListener("click", async () => {
    try {
      const data = await apiRequest("/api/installer/notifications/read", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotifyBadge(data.unread);
      const fresh = await apiRequest("/api/installer/notifications");
      renderNotifications(fresh.items || []);
    } catch (error) {
      showToast(error.message || "Не удалось отметить", true);
    }
  });

  document.getElementById("installer-notifications-close")?.addEventListener("click", () => {
    closeScreen(notificationsDialog);
  });

  function money(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return String(value || "0");
    return number.toLocaleString("ru-RU", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }

  async function openEarnings() {
    closeInstallerMenu();
    const totals = document.getElementById("installer-earnings-totals");
    const list = document.getElementById("installer-earnings-list");
    const title = document.getElementById("installer-earnings-title");
    if (!earningsDialog) return;
    totals.innerHTML = '<div class="installer-loading">Загрузка...</div>';
    list.innerHTML = "";
    openScreen(earningsDialog, "earnings");
    try {
      const data = await apiRequest("/api/installer/earnings");
      if (title && data.employee_name) title.textContent = data.employee_name;
      totals.innerHTML = data.totals.length
        ? data.totals.map((row) => `
            <article class="installer-earnings-card">
              <span>${escapeHtml(row.currency)}</span>
              <dl>
                <div><dt>Начислено</dt><dd>${money(row.accrued)}</dd></div>
                <div><dt>Выплачено</dt><dd>${money(row.paid)}</dd></div>
                <div class="is-balance"><dt>К выплате</dt><dd>${money(row.balance)}</dd></div>
              </dl>
            </article>`).join("")
        : '<div class="installer-empty">Начислений пока нет</div>';
      list.innerHTML = data.entries.length
        ? data.entries.map((row) => `
            <article class="installer-earnings-row${row.kind === "payout" ? " is-payout" : ""}">
              <div>
                <strong>${escapeHtml(row.title || row.kind_label)}</strong>
                <small>${escapeHtml(row.date)}${row.auto ? " · авто" : ""}</small>
              </div>
              <b>${row.kind === "payout" ? "−" : "+"}${money(row.amount)} ${escapeHtml(row.currency)}</b>
            </article>`).join("")
        : '<div class="installer-empty">Движений пока нет</div>';
    } catch (error) {
      totals.innerHTML = `<div class="installer-empty">${escapeHtml(error.message || "Не удалось загрузить")}</div>`;
    }
  }

  document.getElementById("installer-earnings-close")?.addEventListener("click", () => {
    closeScreen(earningsDialog);
  });

  function openInstallerMenu() {
    menuNode.hidden = false;
    if (menuBackdrop) menuBackdrop.hidden = false;
    menuToggle.setAttribute("aria-expanded", "true");
  }

  function closeInstallerMenu() {
    menuNode.hidden = true;
    if (menuBackdrop) menuBackdrop.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
  }

  function openOrderCalendar() {
    closeInstallerMenu();
    const selectedDate = dateFromKey(state.calendarDate) || new Date();
    state.calendarMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    renderOrderCalendar();
    if (!calendarDialog.open) openScreen(calendarDialog, "calendar");
  }

  function shiftCalendarMonth(offset) {
    const selectedDate = dateFromKey(state.calendarDate) || state.calendarMonth;
    const targetMonth = new Date(
      state.calendarMonth.getFullYear(),
      state.calendarMonth.getMonth() + offset,
      1,
    );
    const lastDay = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth() + 1,
      0,
    ).getDate();
    state.calendarMonth = targetMonth;
    state.calendarDate = dateKey(
      new Date(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        Math.min(selectedDate.getDate(), lastDay),
      ),
    );
    renderOrderCalendar();
  }

  function detailActionMarkup(order) {
    const actions = STATUS_ACTIONS[order.status] || [];
    const allowed = new Set(order.allowed_transitions || []);
    const actionButtons = actions
      .filter((action) => allowed.has(action.status))
      .map(
        (action) => `
          <button
            class="${action.primary ? "installer-primary-button" : "installer-secondary-button"}"
            type="button"
            data-action="detail-status"
            data-status="${escapeHtml(action.status)}"
          >${escapeHtml(action.label)}</button>
        `,
      )
      .join("");
    const completeButton = allowed.has("completed")
      ? `<button class="installer-primary-button" type="button" data-action="complete">Завершить заказ</button>`
      : "";
    return actionButtons + completeButton;
  }

  function taskMarkup(order, task) {
    const disabled = ["completed", "cancelled"].includes(order.status) ? " disabled" : "";
    return `
      <label class="installer-task${task.done ? " is-done" : ""}">
        <input type="checkbox" data-action="task" data-task-id="${escapeHtml(task.id)}"${task.done ? " checked" : ""}${disabled}>
        <span>
          <strong>${escapeHtml(task.title)}${task.required ? " *" : ""}</strong>
          ${task.description ? `<small>${escapeHtml(task.description)}</small>` : ""}
        </span>
      </label>
    `;
  }

  function lineMarkup(line, index, order) {
    const product = typeof line.product === "object" ? line.product : null;
    const name = line.product_name
      || (typeof line.product === "string" ? line.product : "")
      || product?.name
      || product?.title
      || line.name
      || line.title
      || line.service_name
      || line.item_name
      || `Позиция ${index + 1}`;
    const quantity = line.quantity ?? line.qty ?? line.count ?? "1";
    const amount = line.amount ?? line.total ?? line.sum ?? line.price ?? 0;
    return `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(quantity)}</td>
        <td>${formatMoney(amount, line.currency || order.currency)}</td>
      </tr>
    `;
  }

  function renderDetail(order) {
    const client = order.client || {};
    const phone = phoneHref(client.phone);
    const map = mapHref(order);
    document.getElementById("installer-detail-number").textContent =
      `Заказ № ${order.number || order.id.slice(0, 8)}`;
    document.getElementById("installer-detail-client").textContent = client.name || "Клиент";
    detailBody.innerHTML = `
      <section class="installer-detail-section">
        <div class="installer-detail-grid">
          <div><span>Статус</span><strong class="installer-detail-value">${escapeHtml(order.status_label)}</strong></div>
          <div><span>Сумма</span><strong class="installer-detail-value">${formatMoney(order.amount, order.currency)}</strong></div>
          <div><span>Телефон</span><strong class="installer-detail-value">${escapeHtml(client.phone || "Не указан")}</strong></div>
          <div><span>Адрес</span><strong class="installer-detail-value">${escapeHtml(client.address || "Не указан")}</strong></div>
        </div>
        <div class="installer-client-actions">
          ${phone ? `<a class="installer-primary-button" href="${escapeHtml(phone)}">Позвонить</a>` : ""}
          ${map ? `<a class="installer-secondary-button" href="${escapeHtml(map)}" target="_blank" rel="noopener">Открыть карту</a>` : ""}
        </div>
      </section>

      <section class="installer-detail-section">
        <h3>Дата установки</h3>
        <div class="installer-schedule-row">
          <input id="installer-schedule" type="datetime-local" value="${escapeHtml(order.scheduled_at || "")}" ${["completed", "cancelled"].includes(order.status) ? "disabled" : ""}>
          ${["completed", "cancelled"].includes(order.status) ? "" : '<button class="installer-secondary-button" type="button" data-action="schedule">Сохранить</button>'}
        </div>
        ${order.scheduled_confirmed ? '<p class="installer-detail-value">Дата подтверждена</p>' : ""}
      </section>

      <section class="installer-detail-section">
        <h3>Выполнение</h3>
        ${progressMarkup(order)}
        <div class="installer-checklist">
          ${(order.tasks || []).length
            ? order.tasks.map((task) => taskMarkup(order, task)).join("")
            : '<div class="installer-empty">Чек-лист не добавлен</div>'}
        </div>
      </section>

      <section class="installer-detail-section">
        <h3>Состав заказа</h3>
        ${(order.lines || []).length
          ? `<table class="installer-lines">
              <thead><tr><th>Товар или услуга</th><th>К-во</th><th>Сумма</th></tr></thead>
              <tbody>${order.lines.map((line, index) => lineMarkup(line, index, order)).join("")}</tbody>
            </table>`
          : '<div class="installer-empty">Позиции заказа не указаны</div>'}
      </section>

      ${order.notes ? `<section class="installer-detail-section"><h3>Комментарий продавца</h3><p>${escapeHtml(order.notes)}</p></section>` : ""}

      <section class="installer-detail-section">
        <h3>Итог установки</h3>
        <textarea class="installer-comment" id="installer-result-comment" placeholder="Что установлено, что проверено, результат">${escapeHtml(order.result_comment || "")}</textarea>
        ${(order.completion_blockers || []).length
          ? `<p class="installer-warning">${escapeHtml(order.completion_blockers.join(" "))}</p>`
          : ""}
      </section>

      <div class="installer-detail-actions">
        ${detailActionMarkup(order)}
      </div>
    `;
  }

  function openDetail(id) {
    const order = state.orders.find((item) => item.id === id);
    if (!order) return;
    state.activeId = id;
    renderDetail(order);
    if (!detailDialog.open) detailDialog.showModal();
  }

  async function updateStatus(id, status, resultComment = "") {
    if (state.busy) return;
    setBusy(true);
    try {
      const payload = await apiRequest(`/api/installer/orders/${encodeURIComponent(id)}/status`, {
        method: "POST",
        body: JSON.stringify({ status, result_comment: resultComment }),
      });
      replaceOrder(payload.order);
      showToast(payload.order.status_label);
      if (status === "accepted") {
        state.activeTab = "calendar";
        render();
        openDetail(id);
      }
      if (status === "completed") {
        detailDialog.close();
        state.activeTab = "archive";
        render();
      }
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule() {
    const order = state.orders.find((item) => item.id === state.activeId);
    const input = document.getElementById("installer-schedule");
    if (!order || !input?.value || state.busy) {
      if (!input?.value) showToast("Выберите дату и время", true);
      return;
    }
    setBusy(true);
    try {
      const payload = await apiRequest(
        `/api/installer/orders/${encodeURIComponent(order.id)}/schedule`,
        {
          method: "POST",
          body: JSON.stringify({ scheduled_at: input.value, confirmed: true }),
        },
      );
      replaceOrder(payload.order);
      showToast("Дата установки подтверждена");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(input) {
    const order = state.orders.find((item) => item.id === state.activeId);
    if (!order || state.busy) return;
    input.disabled = true;
    try {
      const payload = await apiRequest(
        `/api/installer/orders/${encodeURIComponent(order.id)}/tasks/${encodeURIComponent(input.dataset.taskId)}`,
        {
          method: "POST",
          body: JSON.stringify({ done: input.checked }),
        },
      );
      replaceOrder(payload.order);
    } catch (error) {
      input.checked = !input.checked;
      showToast(error.message, true);
    } finally {
      input.disabled = false;
    }
  }

  async function loadOrders({ quiet = false } = {}) {
    if (!quiet) listNode.innerHTML = '<div class="installer-loading">Загрузка заказов...</div>';
    try {
      const payload = await apiRequest("/api/installer/orders");
      state.orders = Array.isArray(payload.orders) ? payload.orders : [];
      render();
    } catch (error) {
      listNode.innerHTML = `<div class="installer-empty">${escapeHtml(error.message)}</div>`;
      showToast(error.message, true);
    }
  }

  menuToggle.addEventListener("click", () => {
    if (menuNode.hidden) openInstallerMenu();
    else closeInstallerMenu();
  });

  menuNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-menu-action]");
    if (!button) return;
    if (button.dataset.menuAction === "orders-calendar") openOrderCalendar();
    if (button.dataset.menuAction === "earnings") openEarnings();
    if (button.dataset.menuAction === "notifications") openNotifications();
    if (button.dataset.menuAction === "phonebook") openPhonebook();
    if (button.dataset.menuAction === "new-order") openNewOrder();
    if (button.dataset.menuAction === "clients") openClients();
  });

  menuClose?.addEventListener("click", closeInstallerMenu);
  menuBackdrop?.addEventListener("click", closeInstallerMenu);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menuNode.hidden) closeInstallerMenu();
  });

  document.getElementById("installer-calendar-prev").addEventListener("click", () => {
    shiftCalendarMonth(-1);
  });

  document.getElementById("installer-calendar-next").addEventListener("click", () => {
    shiftCalendarMonth(1);
  });

  document.getElementById("installer-calendar-close").addEventListener("click", () => {
    calendarDialog.close();
  });

  calendarDialog.addEventListener("click", (event) => {
    if (event.target === calendarDialog) {
      calendarDialog.close();
      return;
    }
    const orderButton = event.target.closest("[data-calendar-order-id]");
    if (orderButton) {
      calendarDialog.close();
      openDetail(orderButton.dataset.calendarOrderId);
      return;
    }
    const dateButton = event.target.closest("[data-calendar-date]");
    if (!dateButton) return;
    state.calendarDate = dateButton.dataset.calendarDate;
    const selectedDate = dateFromKey(state.calendarDate);
    if (selectedDate && selectedDate.getMonth() !== state.calendarMonth.getMonth()) {
      state.calendarMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    }
    renderOrderCalendar();
  });

  listNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.action === "open") openDetail(id);
    if (button.dataset.action === "accept") updateStatus(id, "accepted");
    if (button.dataset.action === "status") updateStatus(id, button.dataset.status);
  });

  detailBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const order = state.orders.find((item) => item.id === state.activeId);
    if (!order) return;
    if (button.dataset.action === "schedule") saveSchedule();
    if (button.dataset.action === "detail-status") {
      updateStatus(order.id, button.dataset.status, document.getElementById("installer-result-comment")?.value || "");
    }
    if (button.dataset.action === "complete") {
      const comment = document.getElementById("installer-result-comment")?.value.trim() || "";
      if (!comment) {
        showToast("Добавьте итоговый комментарий", true);
        document.getElementById("installer-result-comment")?.focus();
        return;
      }
      updateStatus(order.id, "completed", comment);
    }
  });

  detailBody.addEventListener("change", (event) => {
    if (event.target.matches('input[data-action="task"]')) toggleTask(event.target);
  });

  document.querySelectorAll(".installer-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });

  document.getElementById("installer-detail-close").addEventListener("click", () => {
    detailDialog.close();
  });
  detailDialog.addEventListener("click", (event) => {
    if (event.target === detailDialog) detailDialog.close();
  });
  document.getElementById("installer-refresh").addEventListener("click", () => loadOrders());

  document.querySelectorAll("[data-close-help]").forEach((button) => {
    button.addEventListener("click", () => helpDialog.close());
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    document.getElementById("installer-install").hidden = false;
  });

  document.getElementById("installer-install").addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) {
      helpDialog.showModal();
      return;
    }
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
  });

  function updateConnection() {
    const node = document.getElementById("installer-connection");
    node.textContent = navigator.onLine ? "Онлайн" : "Нет сети";
    node.classList.toggle("is-offline", !navigator.onLine);
  }

  window.addEventListener("online", () => {
    updateConnection();
    loadOrders({ quiet: true });
  });
  window.addEventListener("offline", updateConnection);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadOrders({ quiet: true });
  });

  // --- Push-уведомления ---------------------------------------------------

  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(normalized);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }

  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  async function syncPushButton() {
    const button = document.getElementById("installer-push-toggle");
    if (!button) return;
    if (!pushSupported()) {
      button.hidden = true;
      return;
    }
    try {
      const info = await apiRequest("/api/installer/push/key");
      if (!info.enabled) {
        button.hidden = true;
        return;
      }
      state.pushKey = info.public_key || "";
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const active = Boolean(subscription) && Boolean(info.subscribed);
      button.hidden = false;
      button.dataset.state = active ? "on" : "off";
      button.textContent = active ? "Уведомления включены" : "Включить уведомления";
    } catch (error) {
      button.hidden = true;
    }
  }

  async function togglePush() {
    const button = document.getElementById("installer-push-toggle");
    if (!button || !pushSupported()) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();

    if (button.dataset.state === "on" && existing) {
      const endpoint = existing.endpoint;
      await existing.unsubscribe().catch(() => {});
      await apiRequest("/api/installer/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint })
      }).catch(() => {});
      showToast("Уведомления отключены");
      await syncPushButton();
      return;
    }

    // Кэшированная версия приложения могла показать кнопку до того, как ключи
    // убрали с сервера. Без ключа PushManager падает с непонятной ошибкой.
    if (!state.pushKey) {
      showToast("Push не настроен на сервере — обратитесь к администратору", true);
      await syncPushButton();
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Разрешите уведомления в настройках браузера", true);
      return;
    }
    try {
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(state.pushKey)
        }));
      await apiRequest("/api/installer/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      showToast("Уведомления включены");
    } catch (error) {
      showToast(error.message || "Не удалось включить уведомления", true);
    }
    await syncPushButton();
  }

  document.getElementById("installer-push-toggle")?.addEventListener("click", () => {
    closeInstallerMenu();
    togglePush();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/installer-sw.js")
        .then(() => syncPushButton())
        .catch(() => {});
    });
  }

  if (canManage) document.getElementById("installer-manager-note").hidden = false;
  updateConnection();
  refreshNotifyBadge();
  window.setInterval(refreshNotifyBadge, 120000);
  loadOrders();
  window.setInterval(() => loadOrders({ quiet: true }), 60000);
})();
