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
  const homePhoneButton = document.getElementById("installer-home-phone");
  const installerMain = document.querySelector(".installer-app > main");

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
      if (homePhoneButton) homePhoneButton.hidden = state.activeTab !== "new";
      return;
    }
    if (homePhoneButton) homePhoneButton.hidden = true;
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

  // Разделы меню — полноэкранные страницы, каждая добавляет запись в историю:
  // системная кнопка «Назад» закрывает ВЕРХНИЙ экран (а не все сразу), поэтому
  // из формы «Новый клиент» возвращаемся к списку клиентов, а не к заказам.
  const screenStack = [];

  function openScreen(dialog, name) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    screenStack.push(dialog);
    window.history.pushState({installerScreen: name}, "");
  }

  function closeScreen(dialog) {
    if (!dialog?.open) return;
    // Закрытие идёт через историю, чтобы состояние совпадало с кнопкой «Назад».
    if (window.history.state && window.history.state.installerScreen) window.history.back();
    else dialog.close();
  }

  window.addEventListener("popstate", () => {
    const top = screenStack.pop();
    if (top?.open) top.close();
    // Браузер при переходе по истории сам закрывает все модальные окна —
    // возвращаем нижний экран стека, чтобы «Назад» снимал ровно один слой.
    const below = screenStack[screenStack.length - 1];
    if (below && !below.open) {
      if (typeof below.showModal === "function") below.showModal();
      else below.setAttribute("open", "");
    }
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

  const clientNewDialog = document.getElementById("installer-client-new");

  document.getElementById("installer-client-add-open")?.addEventListener("click", () => {
    openScreen(clientNewDialog, "client-new");
    document.getElementById("installer-client-name")?.focus();
  });

  document.getElementById("installer-client-new-close")?.addEventListener("click", () => {
    closeScreen(clientNewDialog);
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
      // Возвращаемся к списку: новый клиент уже в нём.
      closeScreen(clientNewDialog);
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

  let productCache = [];
  let orderLines = [];
  let selectedClientId = "";

  // Свой список подсказок: <datalist> на телефонах открывается ненадёжно.
  function renderSuggest(node, rows, render) {
    if (!node) return;
    node.innerHTML = rows.length ? rows.map(render).join("") : "";
    node.hidden = !rows.length;
  }

  function renderOrderLines() {
    const box = document.getElementById("installer-order-lines");
    const amount = document.getElementById("installer-order-amount");
    const hint = document.getElementById("installer-order-amount-hint");
    if (!box) return;
    box.innerHTML = orderLines.length
      ? orderLines.map((line, index) => `
          <article class="installer-order-line">
            <div>
              <strong>${escapeHtml(line.name)}</strong>
              <small>${escapeHtml(line.price)} × ${escapeHtml(String(line.qty))}</small>
            </div>
            <div class="installer-order-line-actions">
              <button type="button" data-line-minus="${index}">−</button>
              <b>${escapeHtml(String(line.qty))}</b>
              <button type="button" data-line-plus="${index}">+</button>
              <button type="button" data-line-remove="${index}" aria-label="Удалить">×</button>
            </div>
          </article>`).join("")
      : '<p class="installer-order-lines-empty">Товары не добавлены</p>';
    const total = orderLines.reduce((sum, line) => sum + numberValue(line.price) * line.qty, 0);
    if (amount) {
      amount.readOnly = orderLines.length > 0;
      if (orderLines.length) amount.value = String(total);
    }
    if (hint) hint.hidden = !orderLines.length;
  }

  document.getElementById("installer-order-lines")?.addEventListener("click", (event) => {
    const plus = event.target.closest("[data-line-plus]");
    const minus = event.target.closest("[data-line-minus]");
    const remove = event.target.closest("[data-line-remove]");
    if (plus) orderLines[Number(plus.dataset.linePlus)].qty += 1;
    if (minus) {
      const line = orderLines[Number(minus.dataset.lineMinus)];
      line.qty = Math.max(1, line.qty - 1);
    }
    if (remove) orderLines.splice(Number(remove.dataset.lineRemove), 1);
    if (plus || minus || remove) renderOrderLines();
  });

  document.getElementById("installer-order-client")?.addEventListener("input", (event) => {
    selectedClientId = "";
    const needle = String(event.target.value || "").trim().toLowerCase();
    const rows = needle
      ? clientCache.filter((row) => `${row.name} ${row.phone}`.toLowerCase().includes(needle)).slice(0, 8)
      : clientCache.slice(0, 8);
    renderSuggest(
      document.getElementById("installer-client-suggest"),
      rows,
      (row) => `<button type="button" data-client-id="${escapeHtml(row.id)}" data-client-name="${escapeHtml(row.name)}">
          <strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.phone || "")}</small></button>`
    );
  });

  document.getElementById("installer-client-suggest")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-client-id]");
    if (!button) return;
    selectedClientId = button.dataset.clientId;
    document.getElementById("installer-order-client").value = button.dataset.clientName;
    const node = document.getElementById("installer-client-suggest");
    node.hidden = true;
  });

  document.getElementById("installer-order-product")?.addEventListener("input", (event) => {
    const needle = String(event.target.value || "").trim().toLowerCase();
    const rows = needle
      ? productCache.filter((row) => `${row.name} ${row.sku}`.toLowerCase().includes(needle)).slice(0, 8)
      : productCache.slice(0, 8);
    renderSuggest(
      document.getElementById("installer-product-suggest"),
      rows,
      (row) => `<button type="button" data-product-id="${escapeHtml(row.id)}" data-product-name="${escapeHtml(row.name)}" data-product-price="${escapeHtml(row.price)}">
          <strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.price)} ${escapeHtml(row.unit || "")}</small></button>`
    );
  });

  document.getElementById("installer-product-suggest")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-product-id]");
    if (!button) return;
    const id = button.dataset.productId;
    const existing = orderLines.find((line) => line.id === id);
    if (existing) existing.qty += 1;
    else orderLines.push({id: id, name: button.dataset.productName, price: button.dataset.productPrice, qty: 1});
    document.getElementById("installer-order-product").value = "";
    document.getElementById("installer-product-suggest").hidden = true;
    renderOrderLines();
  });

  async function openNewOrder() {
    closeInstallerMenu();
    if (!newOrderDialog) return;
    orderLines = [];
    selectedClientId = "";
    openScreen(newOrderDialog, "new-order");
    renderOrderLines();
    try {
      const [, agents, products] = await Promise.all([
        loadClients(""),
        apiRequest("/api/installer/agents"),
        apiRequest("/api/installer/products"),
      ]);
      productCache = products.products || [];
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
    // Выбор из подсказок точнее, чем сверка по имени: названия повторяются.
    const matched = selectedClientId
      ? {id: selectedClientId}
      : clientCache.find((row) => row.name.toLowerCase() === typed.toLowerCase());
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
        lines: orderLines.map((line) => ({id: line.id, name: line.name, price: line.price, qty: line.qty})),
      };
      if (agentWrap && !agentWrap.hidden && agent) payload.installer_user_id = agent.value;
      const data = await apiRequest("/api/installer/orders/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast(`Заказ ${data.order.number} создан`);
      event.target.reset();
      orderLines = [];
      selectedClientId = "";
      renderOrderLines();
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
    const meta = document.getElementById("installer-phone-list-meta");
    if (!list) return;
    const needle = String(filter || "").trim().toLowerCase();
    const rows = needle
      ? phonebookContacts.filter((row) =>
          `${row.name} ${row.phone}`.toLowerCase().includes(needle))
      : phonebookContacts;
    if (meta) {
      meta.textContent = needle
        ? `Найдено: ${rows.length}`
        : `Контактов: ${rows.length}`;
    }
    list.innerHTML = rows.length
      ? rows.map((row) => `
          <article class="installer-phone-item">
            <span class="installer-phone-avatar" aria-hidden="true">${escapeHtml((row.name || "?").trim().charAt(0).toUpperCase())}</span>
            <div class="installer-phone-info">
              <strong>${escapeHtml(row.name)}</strong>
              <span>${escapeHtml(row.phone)}</span>
            </div>
            <button type="button" class="installer-phone-call"
              data-call-phone="${escapeHtml(row.phone)}" data-call-name="${escapeHtml(row.name)}"
              title="Позвонить" aria-label="Позвонить ${escapeHtml(row.name)}">&#128222;</button>
          </article>`).join("")
      : '<div class="installer-empty">Клиентов с телефоном не найдено</div>';
  }

  // --- Номеронабиратель и SIP-звонки -------------------------------------

  let sipAccounts = [];
  const callScreen = document.getElementById("installer-call-screen");
  let callTimer = null;
  let callSeconds = 0;
  let callLogId = "";
  let activeCall = null;
  let callCloseTimer = null;
  let sipDiagnosticQueue = [];
  let sipDiagnosticTimer = null;
  let sipAccountsLoadPromise = null;
  const SIP_ACCOUNT_STORAGE_KEY = "upos.installer.sipAccount";

  function dialInput() {
    return document.getElementById("installer-dial-number");
  }

  function currentSipAccount() {
    const id = document.getElementById("installer-sip-account")?.value || "";
    return sipAccounts.find((account) => String(account.id) === id) || sipAccounts[0] || null;
  }

  function fmtCallTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function setCallState(text, phase) {
    const node = document.getElementById("installer-call-state");
    if (node) node.textContent = text;
    if (callScreen && phase) callScreen.dataset.phase = phase;
  }

  function preferredSipAccount(accounts) {
    let savedId = "";
    try {
      savedId = window.localStorage.getItem(SIP_ACCOUNT_STORAGE_KEY) || "";
    } catch (_error) {
      // Storage may be unavailable in private browser sessions.
    }
    const activeId = String(window.InstallerSoftphone?.account()?.id || "");
    return accounts.find((account) => String(account.extension || "").trim() === "210")
      || accounts.find((account) => activeId && String(account.id || "") === activeId)
      || accounts.find((account) => String(account.id || "") === savedId)
      || accounts[0]
      || null;
  }

  function queueSipDiagnostic(payload) {
    sipDiagnosticQueue.push({
      ...payload,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
    });
    window.clearTimeout(sipDiagnosticTimer);
    sipDiagnosticTimer = window.setTimeout(async () => {
      const events = sipDiagnosticQueue.splice(0, sipDiagnosticQueue.length);
      if (!events.length) return;
      try {
        await apiRequest("/api/installer/sip/diagnostics", {
          method: "POST",
          body: JSON.stringify({events}),
        });
      } catch (_error) {
        // Diagnostics never block calling.
      }
    }, 250);
  }

  function setCallAudioState(text, state) {
    const node = document.getElementById("installer-call-audio-state");
    const label = document.getElementById("installer-call-audio-label");
    if (label) label.textContent = text;
    if (node) node.dataset.state = state || "waiting";
  }

  function startCallTimer() {
    callSeconds = 0;
    const timer = document.getElementById("installer-call-timer");
    if (timer) { timer.hidden = false; timer.textContent = "00:00"; }
    setCallState("Соединено", "connected");
    if (activeCall) activeCall.connected = true;
    window.clearInterval(callTimer);
    callTimer = window.setInterval(() => {
      callSeconds += 1;
      if (timer) timer.textContent = fmtCallTime(callSeconds);
    }, 1000);
  }

  function openCallScreen(name, number, incoming) {
    if (!callScreen) return;
    window.clearTimeout(callCloseTimer);
    callCloseTimer = null;
    activeCall = {name: name || "", number: number || "", direction: incoming ? "incoming" : "outgoing", connected: false};
    document.getElementById("installer-call-name").textContent = name || number || "Клиент";
    document.getElementById("installer-call-number").textContent = number || "";
    document.getElementById("installer-call-avatar").textContent = (name || number || "?").trim().charAt(0).toUpperCase();
    document.getElementById("installer-call-timer").hidden = true;
    document.getElementById("installer-call-actions-incoming").hidden = !incoming;
    document.getElementById("installer-call-actions-active").hidden = incoming;
    setCallState(incoming ? "Входящий SIP-звонок" : "Подготовка SIP-звонка…", incoming ? "incoming" : "preparing");
    setCallAudioState(incoming ? "Нажмите «Принять», чтобы подключить голос" : "Подключаем голос…", "waiting");
    const mute = document.getElementById("installer-call-mute");
    const speaker = document.getElementById("installer-call-speaker");
    mute?.classList.remove("is-on");
    mute?.setAttribute("aria-pressed", "false");
    speaker?.classList.add("is-on");
    speaker?.setAttribute("aria-pressed", "true");
    callScreen.hidden = false;
    if (typeof callScreen.showModal === "function" && !callScreen.open) callScreen.showModal();
    else callScreen.setAttribute("open", "");
    callScreen.classList.add("is-ringing");
  }

  function closeCallScreen(delay) {
    window.clearInterval(callTimer);
    callTimer = null;
    window.clearTimeout(callCloseTimer);
    const close = () => {
      if (callScreen) {
        if (callScreen.open && typeof callScreen.close === "function") callScreen.close();
        else callScreen.removeAttribute("open");
        callScreen.hidden = true;
        callScreen.classList.remove("is-ringing");
        delete callScreen.dataset.phase;
      }
      activeCall = null;
    };
    if (delay) callCloseTimer = window.setTimeout(close, delay);
    else close();
    const mute = document.getElementById("installer-call-mute");
    if (mute) mute.classList.remove("is-on");
  }

  function sipCallErrorMessage(error) {
    const code = String((error && (error.code || error.name || error.message)) || "").toLowerCase();
    const statusCode = Number(error && error.statusCode) || 0;
    if (code.includes("notallowed") || code.includes("permission") || code.includes("microphone_denied")) {
      return "Разрешите U-POS доступ к микрофону в настройках браузера";
    }
    if (code.includes("notfound") || code.includes("microphone_unavailable")) {
      return "Микрофон на телефоне не найден";
    }
    if (statusCode === 401 || statusCode === 403) {
      return "SIP-сервер отклонил логин или пароль";
    }
    if (code.includes("timeout") || code.includes("disconnected") || code.includes("connection")) {
      return "Нет соединения с SIP-сервером MySputnik";
    }
    if (code.includes("no_ws")) return "У SIP-аккаунта не указан WebSocket";
    return "Не удалось начать SIP-звонок";
  }

  async function placeCall(number, name) {
    const clean = String(number || "").replace(/[^\d+*#]/g, "");
    queueSipDiagnostic({event: "call_button_pressed", detail: {hasNumber: Boolean(clean)}});
    if (!clean) { showToast("Введите номер", true); return; }
    if (!sipAccounts.length) await loadSipAccounts();
    const account = currentSipAccount();
    const sip = window.InstallerSoftphone;
    const callButton = document.getElementById("installer-dial-call");

    if (!account || !sip || !sip.available() || !account.ws_url || !account.sip_uri) {
      const message = "SIP-аккаунт MySputnik не настроен";
      setSipHint(message);
      showToast(message, true);
      return;
    }
    if (callButton && callButton.disabled) return;
    if (callButton) callButton.disabled = true;
    openCallScreen(name, clean, false);
    try {
      // iOS and Android allow media playback reliably only while handling the
      // original tap. Unlock the remote audio element before async SIP work.
      sip.setSpeaker(true);
      await sip.unlockAudio?.();
      setSipHint("Разрешите доступ к микрофону…");
      setCallState("Проверяем микрофон…", "preparing");
      await sip.prepareAudio();
      const registeredAccountId = String(sip.account()?.id || "");
      if (!sip.isRegistered() || registeredAccountId !== String(account.id || "")) {
        setSipHint("Подключение к SIP MySputnik…");
        setCallState("Подключаем SIP MySputnik…", "connecting");
        await sip.connect(account);
      }
      setCallState("Набираем номер…", "dialing");
      if (!sip.call(clean)) throw new Error("sip_not_registered");
      setSipHint("");
      logCall({phone: clean, name: name || "", status: "dialed"}).then((id) => { callLogId = id; });
    } catch (error) {
      queueSipDiagnostic({
        event: "call_preflight_failed",
        detail: {
          code: String((error && (error.code || error.name)) || ""),
          message: String((error && error.message) || ""),
        },
      });
      const message = sipCallErrorMessage(error);
      sip.disconnect();
      setSipHint(message);
      setCallState(message, "failed");
      setCallAudioState("Голос не подключён", "failed");
      callScreen?.classList.remove("is-ringing");
      showToast(message, true);
    } finally {
      if (callButton) callButton.disabled = false;
    }
  }

  async function logCall(payload) {
    try {
      const data = await apiRequest("/api/installer/calls", {method: "POST", body: JSON.stringify(payload)});
      return data.id || "";
    } catch (_e) {
      return "";
    }
  }

  document.getElementById("installer-dialpad")?.addEventListener("click", (event) => {
    const key = event.target.closest("[data-dial]");
    if (!key) return;
    const input = dialInput();
    if (input) input.value += key.dataset.dial;
    // Во время разговора цифра уходит тоном (DTMF).
    const sip = window.InstallerSoftphone;
    if (sip && sip.isRegistered() && callScreen && !callScreen.hidden && typeof sip.sendDtmf === "function") {
      sip.sendDtmf(key.dataset.dial);
    }
  });

  document.getElementById("installer-dial-backspace")?.addEventListener("click", () => {
    const input = dialInput();
    if (input) input.value = input.value.slice(0, -1);
  });

  document.getElementById("installer-dial-call")?.addEventListener("click", () => {
    placeCall(dialInput()?.value, "");
  });

  // Кнопки экрана звонка.
  document.getElementById("installer-call-hangup")?.addEventListener("click", () => {
    window.InstallerSoftphone?.hangup();
    setCallState("Звонок завершён", "ended");
    setCallAudioState("Соединение закрыто", "ended");
    closeCallScreen(700);
  });
  document.getElementById("installer-call-accept")?.addEventListener("click", async () => {
    try {
      setCallState("Подключаем разговор…", "connecting");
      setCallAudioState("Включаем микрофон и голос…", "waiting");
      window.InstallerSoftphone?.setSpeaker(true);
      await window.InstallerSoftphone?.unlockAudio?.();
      await window.InstallerSoftphone?.answer();
    } catch (error) {
      const message = sipCallErrorMessage(error);
      setCallState(message, "failed");
      setCallAudioState("Голос не подключён", "failed");
      showToast(message, true);
    }
  });
  document.getElementById("installer-call-decline")?.addEventListener("click", () => {
    window.InstallerSoftphone?.reject();
    setCallState("Вызов отклонён", "ended");
    closeCallScreen(500);
  });
  document.getElementById("installer-call-mute")?.addEventListener("click", (event) => {
    const on = !event.currentTarget.classList.contains("is-on");
    event.currentTarget.classList.toggle("is-on", on);
    event.currentTarget.setAttribute("aria-pressed", String(on));
    event.currentTarget.setAttribute("aria-label", on ? "Включить микрофон" : "Выключить микрофон");
    const label = event.currentTarget.querySelector("small");
    if (label) label.textContent = on ? "Без звука" : "Микрофон";
    window.InstallerSoftphone?.setMuted(on);
  });
  document.getElementById("installer-call-speaker")?.addEventListener("click", async (event) => {
    const on = !event.currentTarget.classList.contains("is-on");
    event.currentTarget.classList.toggle("is-on", on);
    event.currentTarget.setAttribute("aria-pressed", String(on));
    event.currentTarget.setAttribute("aria-label", on ? "Выключить звук" : "Включить звук");
    const label = event.currentTarget.querySelector("small");
    if (label) label.textContent = on ? "Динамик" : "Звук выкл.";
    window.InstallerSoftphone?.setSpeaker(on);
    setCallAudioState(on ? "Подключаем голос…" : "Звук выключен", on ? "waiting" : "muted");
    if (on) await window.InstallerSoftphone?.resumeRemoteAudio();
  });

  callScreen?.addEventListener("cancel", (event) => {
    event.preventDefault();
    window.InstallerSoftphone?.hangup();
    setCallState("Звонок завершён", "ended");
    closeCallScreen(500);
  });

  function wireSoftphoneEvents() {
    const sip = window.InstallerSoftphone;
    if (!sip) return;
    sip.on("sessionConnecting", () => setCallState("Отправляем SIP-вызов…", "dialing"));
    sip.on("progress", (detail) => {
      const statusCode = Number(detail && detail.statusCode) || 0;
      setCallState(statusCode === 183 ? "Подключается голосовой канал…" : "У абонента звонит…", "ringing");
    });
    sip.on("accepted", () => {
      document.getElementById("installer-call-actions-incoming").hidden = true;
      document.getElementById("installer-call-actions-active").hidden = false;
      callScreen?.classList.remove("is-ringing");
      startCallTimer();
      setCallAudioState("Подключаем голос собеседника…", "waiting");
    });
    sip.on("incoming", (detail) => {
      const number = String((detail && detail.from) || "");
      const digits = number.replace(/\D/g, "");
      const contact = phonebookContacts.find((row) => {
        const candidate = String(row.phone || "").replace(/\D/g, "");
        return candidate && (candidate === digits || candidate.endsWith(digits) || digits.endsWith(candidate));
      });
      const name = (contact && contact.name) || (detail && detail.name) || "Входящий звонок";
      openCallScreen(name, number, true);
      logCall({phone: number, name, direction: "incoming", status: "ringing"}).then((id) => { callLogId = id; });
    });
    const finish = (status) => {
      if (callLogId && activeCall) {
        logCall({
          id: callLogId,
          phone: activeCall.number,
          direction: activeCall.direction,
          status,
          duration: callSeconds,
        });
      }
      callLogId = "";
      setCallState(status === "answered" ? "Звонок завершён" : "Соединение не состоялось", "ended");
      setCallAudioState("Соединение закрыто", "ended");
      closeCallScreen(800);
    };
    sip.on("ended", () => finish(callSeconds > 0 ? "answered" : "cancelled"));
    sip.on("failed", (detail) => {
      finish("missed");
      showToast("Звонок не удался" + (detail && detail.cause ? `: ${detail.cause}` : ""), true);
    });
    sip.on("audioWaiting", () => setCallAudioState("Подключаем голос собеседника…", "waiting"));
    sip.on("audioPlaying", () => setCallAudioState("Голос подключён", "playing"));
    sip.on("audioBlocked", () => {
      setCallAudioState("Нажмите «Динамик», чтобы включить голос", "blocked");
      showToast("Браузер заблокировал звук. Нажмите «Динамик» на экране звонка.", true);
    });
    sip.on("speakerChanged", (detail) => {
      if (detail && detail.enabled === false) setCallAudioState("Звук выключен", "muted");
    });
    sip.on("connectionState", (detail) => {
      const state = String((detail && detail.state) || "");
      if (state === "connected" && callSeconds === 0) setCallAudioState("Голосовой канал подключён", "waiting");
      if (state === "failed") setCallAudioState("Ошибка голосового канала", "failed");
      if (state === "disconnected") setCallAudioState("Восстанавливаем голос…", "waiting");
    });
    sip.on("noResponse", () => {
      setCallState("АТС не ответила на вызов", "failed");
      setCallAudioState("Проверьте SIP-маршрут исходящих звонков", "failed");
      showToast("MySputnik не ответил на SIP-вызов за 15 секунд", true);
    });
    sip.on("transportLost", () => {
      setCallState("SIP-соединение прервано", "failed");
      setCallAudioState("Переподключаемся к MySputnik", "failed");
      showToast("Связь с SIP-сервером прервалась. Повторите звонок.", true);
    });
    sip.on("diagnostic", (detail) => queueSipDiagnostic(detail || {}));
  }

  async function loadSipAccounts() {
    if (sipAccountsLoadPromise) return sipAccountsLoadPromise;
    sipAccountsLoadPromise = loadSipAccountsOnce();
    try {
      return await sipAccountsLoadPromise;
    } finally {
      sipAccountsLoadPromise = null;
    }
  }

  async function loadSipAccountsOnce() {
    const select = document.getElementById("installer-sip-account");
    const dot = document.getElementById("installer-sip-dot");
    if (!select) return;
    try {
      const data = await apiRequest("/api/installer/sip");
      sipAccounts = data.accounts || [];
      if (!sipAccounts.length) {
        select.innerHTML = '<option value="">SIP не настроен</option>';
        dot?.classList.remove("is-online");
        return;
      }
      select.innerHTML = sipAccounts
        .map((acc) => `<option value="${escapeHtml(acc.id || "")}">${escapeHtml(acc.label || acc.extension || "Аккаунт")} · ${escapeHtml(acc.server || "")}</option>`)
        .join("");
      const preferred = preferredSipAccount(sipAccounts);
      if (preferred) select.value = String(preferred.id || "");
      // Пытаемся зарегистрировать выбранный аккаунт на SIP-сервере.
      const activeAccountId = String(window.InstallerSoftphone?.account()?.id || "");
      if (!window.InstallerSoftphone?.inCall()
          && (!window.InstallerSoftphone?.isRegistered() || activeAccountId !== String(preferred?.id || ""))) {
        await registerSelectedAccount();
      }
    } catch (error) {
      select.innerHTML = '<option value="">SIP недоступен</option>';
      dot?.classList.remove("is-online");
    }
  }

  function registerSelectedAccount() {
    const dot = document.getElementById("installer-sip-dot");
    const account = currentSipAccount();
    const sip = window.InstallerSoftphone;
    if (!account || !sip || !sip.available() || !account.ws_url || !account.sip_uri) {
      dot?.classList.remove("is-online");
      return Promise.resolve(false);
    }
    if (sip.inCall()) return Promise.resolve(true);
    setSipHint("Подключение к SIP…");
    return sip.connect(account)
      .then(() => { dot?.classList.add("is-online"); setSipHint(""); return true; })
      .catch((error) => {
        dot?.classList.remove("is-online");
        setSipHint(sipCallErrorMessage(error));
        return false;
      });
  }

  function setSipHint(text) {
    let hint = document.getElementById("installer-sip-hint");
    if (!hint) {
      const panel = document.querySelector(".installer-sip-panel");
      if (!panel) return;
      hint = document.createElement("small");
      hint.id = "installer-sip-hint";
      hint.className = "installer-sip-hint";
      panel.insertBefore(hint, panel.querySelector(".installer-dial-row"));
    }
    hint.textContent = text || "";
    hint.hidden = !text;
  }

  document.getElementById("installer-sip-account")?.addEventListener("change", (event) => {
    const sip = window.InstallerSoftphone;
    if (sip?.inCall()) {
      event.currentTarget.value = String(sip.account()?.id || "");
      showToast("Завершите текущий звонок перед сменой SIP-аккаунта", true);
      return;
    }
    try {
      window.localStorage.setItem(SIP_ACCOUNT_STORAGE_KEY, String(event.currentTarget.value || ""));
    } catch (_error) {
      // Calling still works when storage is blocked.
    }
    registerSelectedAccount();
  });

  async function openPhonebook() {
    closeInstallerMenu();
    if (!phonebookDialog) return;
    const list = document.getElementById("installer-phone-list");
    const calls = document.getElementById("installer-phone-calls");
    if (list) list.innerHTML = '<div class="installer-loading">Загрузка...</div>';
    if (calls) calls.innerHTML = "";
    openScreen(phonebookDialog, "phonebook");
    activatePhoneTab("dial");
    loadSipAccounts();
    try {
      const data = await apiRequest("/api/installer/phonebook");
      phonebookContacts = data.contacts || [];
      renderPhonebook(document.getElementById("installer-phone-search")?.value);
      if (calls) {
        calls.innerHTML = (data.calls || []).length
          ? data.calls.map((row) => {
              const missed = row.status === "missed" || row.status === "cancelled";
              const icon = row.direction === "incoming" ? "↙" : "↗";
              const meta = [notifyTime(row.started_at), row.duration ? fmtCallTime(row.duration) : ""].filter(Boolean).join(" · ");
              return `
              <article class="installer-phone-call-row${missed ? " is-missed" : ""}" data-call-phone="${escapeHtml(row.phone)}" data-call-name="${escapeHtml(row.name || "")}">
                <div>
                  <strong>${escapeHtml(icon)} ${escapeHtml(row.name || row.phone)}</strong>
                  <small>${escapeHtml(meta)}</small>
                </div>
                <span>${escapeHtml(row.phone)}</span>
              </article>`;
            }).join("")
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
    placeCall(button.dataset.callPhone, button.dataset.callName || "");
  });

  document.getElementById("installer-phone-calls")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-call-phone]");
    if (row) placeCall(row.dataset.callPhone, row.dataset.callName || "");
  });

  // Нижние вкладки телефонии: Набор / Журнал / Контакты — как в UposSip.
  function activatePhoneTab(name) {
    phonebookDialog?.querySelectorAll("[data-phone-tab]").forEach((tab) => {
      tab.hidden = tab.dataset.phoneTab !== name;
    });
    phonebookDialog?.querySelectorAll("[data-phone-nav]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.phoneNav === name);
    });
  }

  phonebookDialog?.querySelector(".installer-phone-nav")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-phone-nav]");
    if (button) activatePhoneTab(button.dataset.phoneNav);
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
          <article class="installer-notify-item${item.is_read ? " is-read" : ""}"
            data-notify-id="${escapeHtml(item.id)}" data-notify-tag="${escapeHtml(item.tag || "")}">
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
  // Тег события вида sale-<id> / order-<id> указывает на конкретный заказ.
  function orderIdFromTag(tag) {
    const raw = String(tag || "");
    const orderMatch = /^order-(.+)$/.exec(raw);
    if (orderMatch) return state.orders.find((item) => item.id === orderMatch[1])?.id || "";
    const saleMatch = /^(?:sale|pay)-(.+)$/.exec(raw);
    if (saleMatch) {
      return state.orders.find((item) => item.sale_document_id === saleMatch[1])?.id || "";
    }
    return "";
  }

  document.getElementById("installer-notify-list")?.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-notify-id]");
    if (!item) return;

    // Уведомление о заказе открывает его карточку, не покидая приложение.
    const orderId = orderIdFromTag(item.dataset.notifyTag);
    if (orderId) {
      closeScreen(notificationsDialog);
      openDetail(orderId);
    }

    if (item.classList.contains("is-read")) return;
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
    const phone = String(client.phone || "").replace(/[^\d+*#]/g, "");
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
          ${phone ? `<button class="installer-primary-button" type="button" data-action="call-client" data-phone="${escapeHtml(phone)}">Позвонить</button>` : ""}
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
    if (!quiet) {
      listNode.innerHTML = '<div class="installer-loading">Загрузка заказов...</div>';
      if (homePhoneButton) homePhoneButton.hidden = true;
    }
    try {
      const payload = await apiRequest("/api/installer/orders");
      state.orders = Array.isArray(payload.orders) ? payload.orders : [];
      render();
    } catch (error) {
      listNode.innerHTML = `<div class="installer-empty">${escapeHtml(error.message)}</div>`;
      if (homePhoneButton) homePhoneButton.hidden = true;
      showToast(error.message, true);
    }
  }

  homePhoneButton?.addEventListener("click", openPhonebook);

  const phoneSwipe = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startedAt: 0,
  };

  function resetPhoneSwipe() {
    phoneSwipe.active = false;
    phoneSwipe.pointerId = null;
  }

  installerMain?.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, input, select, textarea, [contenteditable], dialog")) return;
    if (document.querySelector("dialog[open]") || !menuNode.hidden) return;
    phoneSwipe.active = true;
    phoneSwipe.pointerId = event.pointerId;
    phoneSwipe.startX = event.clientX;
    phoneSwipe.startY = event.clientY;
    phoneSwipe.startedAt = performance.now();
    try {
      installerMain.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      // Pointer capture is optional and can be unavailable in embedded webviews.
    }
  });

  installerMain?.addEventListener("pointerup", (event) => {
    if (!phoneSwipe.active || event.pointerId !== phoneSwipe.pointerId) return;
    const deltaX = event.clientX - phoneSwipe.startX;
    const deltaY = event.clientY - phoneSwipe.startY;
    const elapsed = performance.now() - phoneSwipe.startedAt;
    resetPhoneSwipe();
    if (deltaX <= -64 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35 && elapsed <= 900) {
      openPhonebook();
    }
  });

  installerMain?.addEventListener("pointercancel", resetPhoneSwipe);

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
      // Карточка открывается поверх календаря: закрыл её — вернулся к календарю,
      // а не вылетел на главный экран.
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
    if (button.dataset.action === "call-client") {
      placeCall(button.dataset.phone, order.client?.name || "");
    }
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
  wireSoftphoneEvents();
  refreshNotifyBadge();
  window.setInterval(refreshNotifyBadge, 120000);
  loadOrders();
  window.setInterval(() => loadOrders({ quiet: true }), 60000);
})();
