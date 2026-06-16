(function () {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  const tabsShell = document.querySelector("[data-adjustments-open-tabs]");
  const homeTab = document.querySelector("[data-adjustments-home-tab]");
  const syncButton = document.querySelector("[data-adjustments-sync]");
  const launcher = document.querySelector("[data-adjustments-launcher]");
  const panelsRoot = document.querySelector("[data-adjustments-panels-root]");
  const cards = Array.from(document.querySelectorAll("[data-adjustments-card]"));
  const panels = Array.from(document.querySelectorAll("[data-adjustments-panel]"));
  if (!tabsShell || !homeTab || !launcher || !panelsRoot || !cards.length) return;

  const titles = {
    employees: "Сотрудники",
    accounts: "Счета",
    couriers: "Доставщики",
    suppliers: "Поставщики",
  };
  const sectionLabels = {
    employees: "Сотрудники",
    accounts: "Счета",
    couriers: "Доставщики",
    suppliers: "Поставщики",
  };
  const storageKey = "upos.adjustments.openTabs";
  let data = parseBootstrap();
  let openTabs = [];
  let activeTab = "";

  function parseBootstrap() {
    const el = document.getElementById("adjustments-bootstrap-json");
    if (!el) return { accounts: [], employees: [], couriers: [], suppliers: [], history: [] };
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (_) {
      return { accounts: [], employees: [], couriers: [], suppliers: [], history: [] };
    }
  }

  function normalize(tab) {
    return titles[tab] ? tab : "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function amountPlain(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/\u00a0/g, " ");
  }

  function parseAmount(value) {
    const cleaned = String(value || "0").replace(/\s+/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function formatDate(value) {
    const dt = new Date(value || "");
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ openTabs, activeTab }));
    } catch (_) {}
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "{}");
      openTabs = Array.isArray(raw.openTabs) ? raw.openTabs.map(normalize).filter(Boolean) : [];
      activeTab = normalize(raw.activeTab) || openTabs[0] || "";
    } catch (_) {
      openTabs = [];
      activeTab = "";
    }
  }

  function renderTabs() {
    tabsShell.querySelectorAll("[data-adjustments-open-tab]").forEach((node) => node.remove());
    openTabs.forEach((tab) => {
      const holder = document.createElement("span");
      holder.className = "general-module-tab general-module-tab--report" + (tab === activeTab ? " active" : "");
      holder.dataset.adjustmentsOpenTab = tab;

      const activateButton = document.createElement("button");
      activateButton.type = "button";
      activateButton.className = "general-module-tab-activate";
      activateButton.dataset.adjustmentsActivateTab = tab;
      activateButton.textContent = titles[tab];

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "general-module-tab-close";
      closeButton.dataset.adjustmentsCloseTab = tab;
      closeButton.setAttribute("aria-label", `Закрыть ${titles[tab]}`);
      closeButton.textContent = "×";

      holder.append(activateButton, closeButton);
      tabsShell.insertBefore(holder, syncButton || null);
    });
    const homeActive = !activeTab;
    homeTab.classList.toggle("active", homeActive);
    homeTab.setAttribute("aria-current", homeActive ? "page" : "false");
  }

  function renderPanels() {
    const hasActive = !!activeTab;
    launcher.hidden = hasActive;
    panelsRoot.hidden = !hasActive;
    cards.forEach((card) => {
      const tab = normalize(card.dataset.adjustmentsCard || "");
      card.setAttribute("aria-selected", tab === activeTab ? "true" : "false");
    });
    panels.forEach((panel) => {
      panel.hidden = normalize(panel.dataset.adjustmentsPanel || "") !== activeTab;
    });
  }

  function rowHtml(section, row) {
    const isAccounts = section === "accounts";
    const isEmployees = section === "employees";
    const target = isAccounts ? row.id : row.id || row.name;
    const currency = isEmployees ? "UZS" : row.currency || "UZS";
    return `<tr data-adjustment-row data-section="${escapeHtml(section)}" data-id="${escapeHtml(target)}" data-name="${escapeHtml(row.name || "")}" data-currency="${escapeHtml(currency)}" data-current="${escapeHtml(row.amount || 0)}">
      <td><strong>${escapeHtml(row.name || "—")}</strong></td>
      ${isAccounts || !isEmployees ? `<td>${escapeHtml(currency)}</td>` : ""}
      <td><strong>${escapeHtml(row.amount_label || amountPlain(row.amount))} ${escapeHtml(currency)}</strong></td>
      <td><input class="adjustments-input" data-adjustment-amount type="text" inputmode="decimal" value="${escapeHtml(amountPlain(row.amount))}" /></td>
      <td><input class="adjustments-input" data-adjustment-note type="text" placeholder="Причина корректировки" /></td>
      <td><button type="button" class="btn btn-secondary btn-sm" data-adjustment-save>Сохранить</button></td>
    </tr>`;
  }

  function renderTable(section) {
    const body = document.querySelector(`[data-adjustments-table="${section}"]`);
    if (!body) return;
    const rows = Array.isArray(data[section]) ? data[section] : [];
    if (!rows.length) {
      const colspan = section === "employees" ? 5 : 6;
      body.innerHTML = `<tr><td colspan="${colspan}" class="org-ops-empty">Нет данных для корректировки.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((row) => rowHtml(section, row)).join("");
  }

  function renderHistory() {
    const body = document.querySelector("[data-adjustments-history]");
    if (!body) return;
    const rows = Array.isArray(data.history) ? data.history : [];
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="org-ops-empty">Корректировок пока нет.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((row) => {
      const currency = row.currency || "UZS";
      const delta = Number(row.delta || 0);
      const tone = delta < 0 ? "is-negative" : delta > 0 ? "is-positive" : "";
      return `<tr>
        <td>${escapeHtml(formatDate(row.created_at))}</td>
        <td>${escapeHtml(sectionLabels[row.section] || row.section || "—")}</td>
        <td><strong>${escapeHtml(row.target_name || "—")}</strong></td>
        <td>${escapeHtml(row.old_amount_label || "0")} ${escapeHtml(currency)}</td>
        <td>${escapeHtml(row.new_amount_label || "0")} ${escapeHtml(currency)}</td>
        <td class="${tone}">${escapeHtml(row.delta_label || "0")} ${escapeHtml(currency)}</td>
        <td>${escapeHtml(row.note || "")}</td>
      </tr>`;
    }).join("");
  }

  function renderData() {
    ["employees", "accounts", "couriers", "suppliers"].forEach(renderTable);
    renderHistory();
  }

  function activate(tab) {
    tab = normalize(tab);
    activeTab = tab;
    if (tab && !openTabs.includes(tab)) openTabs.push(tab);
    saveState();
    renderTabs();
    renderPanels();
    renderData();
  }

  function closeTab(tab) {
    tab = normalize(tab);
    const index = openTabs.indexOf(tab);
    if (index >= 0) openTabs.splice(index, 1);
    if (activeTab === tab) activeTab = openTabs[index] || openTabs[index - 1] || "";
    saveState();
    renderTabs();
    renderPanels();
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw new Error(body.error || "save_failed");
    data = body;
    renderData();
  }

  async function refreshData() {
    const response = await fetch(`/api/adjustments?t=${Date.now()}`, {
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw new Error(body.error || "refresh_failed");
    data = body;
    renderData();
  }

  async function saveRow(row) {
    const section = row.dataset.section || "";
    const amount = parseAmount(row.querySelector("[data-adjustment-amount]")?.value || "0");
    const note = row.querySelector("[data-adjustment-note]")?.value || "";
    const payload = {
      amount,
      note,
      currency: row.dataset.currency || "UZS",
      old_amount: row.dataset.current || 0,
      target_id: row.dataset.id || "",
      target_name: row.dataset.name || "",
    };
    if (section === "accounts") {
      await postJson("/api/adjustments/account", {
        account_id: row.dataset.id || "",
        currency: row.dataset.currency || "UZS",
        amount,
        note,
      });
    } else if (section === "employees") {
      await postJson("/api/adjustments/salary", {
        employee_id: row.dataset.id || "",
        amount,
        note,
      });
    } else {
      await postJson("/api/adjustments/manual", { ...payload, section });
    }
  }

  cards.forEach((card) => {
    card.addEventListener("click", () => activate(card.dataset.adjustmentsCard || ""));
  });

  tabsShell.addEventListener("click", (event) => {
    const close = event.target.closest("[data-adjustments-close-tab]");
    if (close) {
      event.stopPropagation();
      closeTab(close.dataset.adjustmentsCloseTab || "");
      return;
    }
    const tab = event.target.closest("[data-adjustments-open-tab]");
    if (tab) activate(tab.dataset.adjustmentsOpenTab || "");
  });

  if (syncButton) {
    syncButton.addEventListener("click", async () => {
      if (syncButton.disabled) return;
      syncButton.disabled = true;
      syncButton.classList.add("is-syncing");
      try {
        await refreshData();
      } catch (err) {
        alert(err && err.message ? err.message : "Не удалось синхронизировать корректировки");
      } finally {
        syncButton.disabled = false;
        syncButton.classList.remove("is-syncing");
      }
    });
  }

  panelsRoot.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-adjustment-save]");
    if (!btn) return;
    const row = btn.closest("[data-adjustment-row]");
    if (!row) return;
    btn.disabled = true;
    try {
      await saveRow(row);
    } catch (err) {
      alert(err && err.message ? err.message : "Не удалось сохранить корректировку");
    } finally {
      btn.disabled = false;
    }
  });

  homeTab.addEventListener("click", () => activate(""));

  loadState();
  renderTabs();
  renderPanels();
  renderData();
})();
