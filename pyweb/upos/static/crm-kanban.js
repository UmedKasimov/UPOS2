(() => {
  function postStage(root, recordId, stageId) {
    const template = root.dataset.crmStageUrlTemplate || "/crm/__record__/stage";
    const url = template.replace("__record__", encodeURIComponent(recordId));
    const body = new URLSearchParams();
    body.set("csrf_token", root.dataset.crmCsrf || "");
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

  function initDialog() {
    const dialog = document.getElementById("crm-record-dialog");
    if (!dialog) return;
    const form = dialog.querySelector("form");

    const setKind = (kind) => {
      if (!kind) return;
      const input = dialog.querySelector(`input[name="item_type"][value="${CSS.escape(kind)}"]`);
      if (input) input.checked = true;
    };
    const openDialog = (kind) => {
      setKind(kind);
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      const firstField = dialog.querySelector('input[name="title"]');
      if (firstField) firstField.focus();
    };
    const closeDialog = () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    };

    document.querySelectorAll("[data-crm-open-dialog]").forEach((button) => {
      button.addEventListener("click", () => openDialog(button.dataset.crmKind || "deal"));
    });
    dialog.querySelectorAll("[data-crm-close-dialog]").forEach((button) => {
      button.addEventListener("click", closeDialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });

    const setField = (name, value) => {
      if (!form || value == null || value === "") return;
      const field = form.querySelector(`[name="${CSS.escape(name)}"]`);
      if (!field) return;
      field.value = value;
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const setSelectByValueOrText = (name, value, textNeedle) => {
      if (!form) return;
      const select = form.querySelector(`select[name="${CSS.escape(name)}"]`);
      if (!select) {
        setField(name, value);
        return;
      }
      const normalizedValue = String(value || "").toLowerCase();
      const normalizedText = String(textNeedle || value || "").toLowerCase();
      const match = Array.from(select.options).find((option) => {
        return (
          String(option.value || "").toLowerCase() === normalizedValue ||
          String(option.textContent || "").toLowerCase().includes(normalizedText)
        );
      });
      if (match) {
        select.value = match.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };

    const openFromMessenger = () => {
      const params = new URLSearchParams(window.location.search || "");
      if (params.get("crm_open") !== "deal") return;
      setKind("deal");
      setField("title", params.get("crm_title") || "Сделка из мессенджера");
      setField("client", params.get("crm_client") || "");
      setField("contact_type", params.get("crm_contact_type") || "Чат Telegram");
      setField("chat_ref", params.get("crm_chat_ref") || "");
      setField("note", params.get("crm_note") || "Создано из диалога мессенджера");
      setSelectByValueOrText("lead_source", params.get("crm_source") || "Telegram", params.get("crm_source") || "Telegram");
      setSelectByValueOrText("stage_id", params.get("crm_stage") || "leads", "лид");
      setSelectByValueOrText("status", params.get("crm_status") || "new", "нов");
      openDialog("deal");
    };

    openFromMessenger();
  }

  function init() {
    document.querySelectorAll("[data-crm-kanban]").forEach(initKanban);
    initDialog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
