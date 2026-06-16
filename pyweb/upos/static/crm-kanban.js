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
