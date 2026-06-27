(() => {
  function getCsrf() {
    const el = document.querySelector("[data-crm-csrf]");
    return (el && el.dataset.crmCsrf) || "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function postStage(root, recordId, stageId) {
    const template = root.dataset.crmStageUrlTemplate || "/crm/__record__/stage";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || getCsrf());
    body.set("stage_id", stageId);
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
  }

  function updateColumnState(column) {
    const cards = Array.from(column.querySelectorAll(".crm-kanban-card"));
    const count = column.querySelector("header strong");
    if (count) count.textContent = String(cards.length);
    const empty = column.querySelector(".crm-kanban-empty");
    if (empty) empty.hidden = cards.length > 0;
  }

  let lastDragEnd = 0;

  function initKanban(root) {
    let dragged = null;
    root.querySelectorAll(".crm-kanban-card").forEach((card) => {
      card.addEventListener("dragstart", (event) => {
        dragged = card;
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", card.dataset.crmRecordId || "");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("is-dragging");
        dragged = null;
        lastDragEnd = Date.now();
      });
    });

    root.querySelectorAll(".crm-kanban-column").forEach((column) => {
      const dropzone = column.querySelector("[data-crm-dropzone]");
      if (!dropzone) return;
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        column.classList.add("is-over");
        event.dataTransfer.dropEffect = "move";
      });
      dropzone.addEventListener("dragleave", (event) => {
        if (!column.contains(event.relatedTarget)) column.classList.remove("is-over");
      });
      dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        column.classList.remove("is-over");
        const recordId = event.dataTransfer.getData("text/plain") || dragged?.dataset.crmRecordId || "";
        const card = dragged || root.querySelector(`[data-crm-record-id="${CSS.escape(recordId)}"]`);
        const stageId = column.dataset.crmStageId || "";
        if (!card || !recordId || !stageId) return;
        const previousColumn = card.closest(".crm-kanban-column");
        dropzone.appendChild(card);
        if (previousColumn) updateColumnState(previousColumn);
        updateColumnState(column);
        postStage(root, recordId, stageId).catch(() => {
          window.location.reload();
        });
      });
    });

    root.querySelectorAll(".crm-kanban-column").forEach(updateColumnState);
  }

  // ---- Record dialog (create / edit) ----
  function recordDialogApi() {
    const dialog = document.getElementById("crm-record-dialog");
    if (!dialog) return null;
    const form = dialog.querySelector("form");
    const titleEl = document.getElementById("crm-record-dialog-title");

    const setField = (name, value) => {
      if (!form) return;
      const field = form.querySelector(`[name="${CSS.escape(name)}"]`);
      if (!field) return;
      field.value = value == null ? "" : value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const setKind = (kind) => {
      if (!kind) return;
      const input = dialog.querySelector(`input[name="item_type"][value="${CSS.escape(kind)}"]`);
      if (input) input.checked = true;
    };
    const setSelect = (name, value, textNeedle) => {
      const select = form && form.querySelector(`select[name="${CSS.escape(name)}"]`);
      if (!select) { setField(name, value); return; }
      const v = String(value || "").toLowerCase();
      const t = String(textNeedle || value || "").toLowerCase();
      const match = Array.from(select.options).find(
        (o) => String(o.value || "").toLowerCase() === v || (t && String(o.textContent || "").toLowerCase().includes(t)),
      );
      if (match) { select.value = match.value; select.dispatchEvent(new Event("change", { bubbles: true })); }
    };
    const open = () => {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    };
    const close = () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
    return { dialog, form, titleEl, setField, setKind, setSelect, open, close };
  }

  function openCreate(api, kind) {
    if (!api) return;
    if (api.form) api.form.reset();
    api.setField("record_id", "");
    api.setField("counterparty_id", "");
    api.setKind(kind || "deal");
    if (api.titleEl) api.titleEl.textContent = "Новая запись";
    api.open();
    const first = api.dialog.querySelector('input[name="title"]');
    if (first) first.focus();
  }

  function openEdit(api, record) {
    if (!api || !record) return;
    if (api.form) api.form.reset();
    api.setKind(record.item_type || "deal");
    api.setField("record_id", record.id || "");
    api.setField("counterparty_id", record.counterparty_id || "");
    api.setField("title", record.title || "");
    api.setField("client", record.client || "");
    api.setField("responsible", record.responsible || "");
    api.setField("contact_type", record.contact_type || "");
    api.setField("chat_ref", record.chat_ref || "");
    api.setField("note", record.note || "");
    api.setField("date", (record.date || "").slice(0, 10));
    api.setField("due_date", (record.due_date || "").slice(0, 10));
    api.setField("amount", record.amount_value || "");
    api.setField("currency", record.currency || "UZS");
    api.setSelect("lead_source", record.lead_source, record.lead_source);
    api.setSelect("stage_id", record.stage_id, record.stage);
    api.setSelect("status", record.status, record.status_label);
    api.setSelect("related_deal_id", record.related_deal_id, record.related_deal_title);
    if (api.titleEl) api.titleEl.textContent = "Редактирование записи";
    api.open();
  }

  function initDialog(api) {
    if (!api) return;
    document.querySelectorAll("[data-crm-open-dialog]").forEach((button) => {
      button.addEventListener("click", () => openCreate(api, button.dataset.crmKind || "deal"));
    });
    api.dialog.querySelectorAll("[data-crm-close-dialog]").forEach((button) => {
      button.addEventListener("click", api.close);
    });
    api.dialog.addEventListener("click", (event) => {
      if (event.target === api.dialog) api.close();
    });

    // Префилл из мессенджера (?crm_open=deal&...)
    const params = new URLSearchParams(window.location.search || "");
    if (params.get("crm_open") === "deal") {
      openCreate(api, "deal");
      api.setField("title", params.get("crm_title") || "Сделка из мессенджера");
      api.setField("client", params.get("crm_client") || "");
      api.setField("contact_type", params.get("crm_contact_type") || "Чат Telegram");
      api.setField("chat_ref", params.get("crm_chat_ref") || "");
      api.setField("note", params.get("crm_note") || "Создано из диалога мессенджера");
      api.setSelect("lead_source", params.get("crm_source") || "Telegram", params.get("crm_source") || "Telegram");
      api.setSelect("stage_id", params.get("crm_stage") || "leads", "лид");
      api.setSelect("status", params.get("crm_status") || "new", "нов");
    }
  }

  // ---- Detail dialog (card + timeline) ----
  function initDetail(recordApi) {
    const dialog = document.getElementById("crm-detail-dialog");
    if (!dialog) return;
    const titleEl = dialog.querySelector("[data-crm-detail-title]");
    const subEl = dialog.querySelector("[data-crm-detail-sub]");
    const fieldsEl = dialog.querySelector("[data-crm-detail-fields]");
    const timelineEl = dialog.querySelector("[data-crm-timeline]");
    const editBtn = dialog.querySelector("[data-crm-detail-edit]");
    const callBtn = dialog.querySelector("[data-crm-detail-call]");
    const clientBtn = dialog.querySelector("[data-crm-detail-client]");
    const noteForm = dialog.querySelector("[data-crm-note-form]");
    let current = null;

    const open = () => {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    };
    const close = () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
    dialog.querySelectorAll("[data-crm-detail-close]").forEach((b) => b.addEventListener("click", close));
    dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });

    function field(label, value) {
      if (!value) return "";
      return `<div class="crm-detail-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    }

    function renderFields(r) {
      const amount = r.amount && String(r.amount) !== "0" ? `${r.amount} ${r.currency || ""}`.trim() : "";
      fieldsEl.innerHTML = [
        field("Тип", r.item_type_label),
        field("Статус", r.status_label),
        field("Этап", r.stage),
        field("Клиент", r.client),
        field("Телефон", r.client_phone),
        field("Ответственный", r.responsible),
        field("Источник", r.lead_source),
        field("Тип контакта", r.contact_type),
        field("Чат", r.chat_ref),
        field("Сумма", amount),
        field("Срок", (r.due_date || "").slice(0, 10)),
        field("Комментарий", r.note),
      ].join("");
    }

    function activityHtml(a) {
      const channel = a.channel_label && a.channel !== "manual" ? ` · ${escapeHtml(a.channel_label)}` : "";
      const body = a.body ? `<p class="crm-detail-activity-body">${escapeHtml(a.body)}</p>` : "";
      return `<li class="crm-detail-activity crm-detail-activity--${escapeHtml(a.kind)}">
        <div class="crm-detail-activity-head">
          <span class="crm-detail-activity-kind">${escapeHtml(a.kind_label)}${channel}</span>
          <time>${escapeHtml(a.occurred_label)}</time>
        </div>
        <div class="crm-detail-activity-title">${escapeHtml(a.title)}</div>
        ${body}
      </li>`;
    }

    function renderTimeline(activities) {
      if (!activities || !activities.length) {
        timelineEl.innerHTML = '<li class="crm-detail-timeline-empty">Активностей пока нет.</li>';
        return;
      }
      timelineEl.innerHTML = activities.map(activityHtml).join("");
    }

    function applyActions(r) {
      const phone = (r.client_phone || "").replace(/[^\d+]/g, "");
      if (phone) { callBtn.href = `tel:${phone}`; callBtn.style.display = ""; }
      else { callBtn.style.display = "none"; }
      if (r.client_href) { clientBtn.href = r.client_href; clientBtn.style.display = ""; }
      else { clientBtn.style.display = "none"; }
    }

    function load(recordId) {
      titleEl.textContent = "Загрузка…";
      subEl.textContent = "";
      fieldsEl.innerHTML = "";
      renderTimeline([]);
      open();
      fetch(`/crm/${encodeURIComponent(recordId)}`, { headers: { Accept: "application/json" } })
        .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
        .then((data) => {
          if (!data || !data.ok) throw new Error("bad");
          current = data.record;
          titleEl.textContent = current.title || "Карточка";
          subEl.textContent = [current.item_type_label, current.stage].filter(Boolean).join(" · ");
          renderFields(current);
          applyActions(current);
          renderTimeline(data.activities);
        })
        .catch(() => {
          titleEl.textContent = "Не удалось загрузить карточку";
        });
    }

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        if (!current) return;
        close();
        openEdit(recordApi, current);
      });
    }

    if (callBtn) {
      callBtn.addEventListener("click", () => {
        if (!current) return;
        const body = new URLSearchParams();
        body.set("csrf_token", getCsrf());
        body.set("counterparty_id", current.counterparty_id || "");
        body.set("record_id", current.id || "");
        body.set("phone", current.client_phone || "");
        fetch("/api/telephony/click-to-call", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: body.toString(),
          keepalive: true,
        }).catch(() => {});
      });
    }

    if (noteForm) {
      noteForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!current) return;
        const fd = new FormData(noteForm);
        const body = new URLSearchParams();
        body.set("csrf_token", getCsrf());
        body.set("kind", String(fd.get("kind") || "note"));
        body.set("body", String(fd.get("body") || ""));
        fetch(`/crm/${encodeURIComponent(current.id)}/activity`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: body.toString(),
        })
          .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
          .then((data) => {
            if (!data || !data.ok) throw new Error("bad");
            const empty = timelineEl.querySelector(".crm-detail-timeline-empty");
            if (empty) empty.remove();
            timelineEl.insertAdjacentHTML("afterbegin", activityHtml(data.activity));
            noteForm.reset();
          })
          .catch(() => {});
      });
    }

    // Клики по карточкам / строкам открывают деталь
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-crm-open-card]");
      if (!trigger) return;
      if (event.target.closest("a, button, form, select, input, textarea")) return;
      if (Date.now() - lastDragEnd < 250) return;
      const id = trigger.dataset.crmOpenCard;
      if (id) load(id);
    });
  }

  function init() {
    const recordApi = recordDialogApi();
    document.querySelectorAll("[data-crm-kanban]").forEach(initKanban);
    initDialog(recordApi);
    initDetail(recordApi);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
