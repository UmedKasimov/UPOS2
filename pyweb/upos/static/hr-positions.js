(function () {
  function csrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  }

  function apiErrorText(code) {
    if (code === "position_name_required") return "Введите название должности";
    if (code === "position_exists") return "Такая должность уже есть";
    if (code === "csrf") return "Обновите страницу и повторите";
    if (code === "forbidden") return "Нет доступа для сохранения должности";
    if (code === "organization_required") return "Выберите организацию";
    return "Не удалось сохранить";
  }

  function requestJson(url, method, payload) {
    return fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken(),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    }).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (body) {
        if (!res.ok) {
          const err = new Error(apiErrorText(body.error || res.statusText));
          err.code = body.error || res.statusText;
          throw err;
        }
        return body;
      });
    });
  }

  function initPositionSelect(root) {
    const trigger = root.querySelector("[data-position-trigger]");
    const menu = root.querySelector("[data-position-menu]");
    const options = root.querySelector("[data-position-options]");
    const label = root.querySelector("[data-position-label]");
    const idInput = root.querySelector("[data-position-id]");
    const nameInput = root.querySelector("[data-position-name]");
    const addToggle = root.querySelector("[data-position-add-toggle]");
    const inline = root.querySelector("[data-position-inline]");
    const inlineTitle = root.querySelector("[data-position-inline-title]");
    const inlineInput = root.querySelector("[data-position-input]");
    const saveBtn = root.querySelector("[data-position-save]");
    const organizationId = (root.dataset.organizationId || "").trim();
    let editingId = "";

    if (!trigger || !menu || !options || !label || !idInput || !nameInput) return;

    function withOrganization(payload) {
      const body = Object.assign({}, payload || {});
      if (organizationId && !body.organization_id) body.organization_id = organizationId;
      return body;
    }

    function apiUrl(positionId) {
      let url = "/api/positions";
      if (positionId) url += "/" + encodeURIComponent(positionId);
      if (organizationId) url += "?organization_id=" + encodeURIComponent(organizationId);
      return url;
    }

    function rows() {
      return Array.from(options.querySelectorAll("[data-position-row]"));
    }

    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      hideInline();
    }

    function hideInline() {
      if (inline) inline.hidden = true;
      editingId = "";
      if (inlineInput) inlineInput.value = "";
      if (inlineTitle) inlineTitle.textContent = "Новая должность:";
      root.classList.remove("is-error");
    }

    function showInline(mode, row) {
      if (!inline || !inlineInput) return;
      editingId = mode === "edit" && row ? row.dataset.id || "" : "";
      inline.hidden = false;
      inlineInput.value = row ? row.dataset.name || "" : "";
      if (inlineTitle) inlineTitle.textContent = editingId ? "Редактировать должность:" : "Новая должность:";
      inlineInput.focus();
      inlineInput.select();
    }

    function selectPosition(id, name) {
      idInput.value = id || "";
      nameInput.value = name || "";
      label.textContent = name || "Выберите должность";
      rows().forEach(function (row) {
        row.classList.toggle("is-selected", row.dataset.id === id);
      });
    }

    function createRow(position) {
      const row = document.createElement("div");
      row.className = "org-position-row";
      row.dataset.positionRow = "";
      row.dataset.id = position.id || "";
      row.dataset.name = position.name || "";
      if (position.local) row.dataset.local = "1";

      const option = document.createElement("button");
      option.type = "button";
      option.className = "org-position-option";
      option.dataset.positionOption = "";
      option.textContent = position.name || "";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "org-position-action";
      edit.dataset.positionEdit = "";
      edit.setAttribute("aria-label", "Редактировать должность " + (position.name || ""));
      edit.textContent = "✎";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "org-position-action";
      del.dataset.positionDelete = "";
      del.setAttribute("aria-label", "Удалить должность " + (position.name || ""));
      del.textContent = "×";

      row.append(option, edit, del);
      return row;
    }

    function upsertRow(position) {
      let row = options.querySelector('[data-position-row][data-id="' + CSS.escape(position.id || "") + '"]');
      if (!row) {
        row = createRow(position);
        options.appendChild(row);
      } else {
        row.dataset.name = position.name || "";
        const option = row.querySelector("[data-position-option]");
        if (option) option.textContent = position.name || "";
        row.querySelectorAll("[aria-label]").forEach(function (btn) {
          if (btn.hasAttribute("data-position-edit")) btn.setAttribute("aria-label", "Редактировать должность " + (position.name || ""));
          if (btn.hasAttribute("data-position-delete")) btn.setAttribute("aria-label", "Удалить должность " + (position.name || ""));
        });
      }
      selectPosition(position.id || "", position.name || "");
    }

    trigger.addEventListener("click", function () {
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    options.addEventListener("click", function (ev) {
      const edit = ev.target.closest("[data-position-edit]");
      const del = ev.target.closest("[data-position-delete]");
      const option = ev.target.closest("[data-position-option]");
      const row = ev.target.closest("[data-position-row]");
      if (!row) return;
      if (edit) {
        ev.preventDefault();
        showInline("edit", row);
        return;
      }
      if (del) {
        ev.preventDefault();
        if (row.dataset.local === "1") {
          if (idInput.value === row.dataset.id) selectPosition("", "");
          row.remove();
          return;
        }
        const name = row.dataset.name || "";
        if (name && !window.confirm("Удалить должность «" + name + "»?")) return;
        del.disabled = true;
        requestJson(apiUrl(row.dataset.id || ""), "DELETE")
          .then(function () {
            if (idInput.value === row.dataset.id) selectPosition("", "");
            row.remove();
          })
          .catch(function (err) {
            root.classList.add("is-error");
            if (inlineTitle) inlineTitle.textContent = err.message;
            if (inline) inline.hidden = false;
          })
          .finally(function () {
            del.disabled = false;
          });
        return;
      }
      if (option) {
        selectPosition(row.dataset.id || "", row.dataset.name || option.textContent.trim());
        closeMenu();
      }
    });

    if (addToggle) {
      addToggle.addEventListener("click", function () {
        openMenu();
        showInline("create");
      });
    }

    if (saveBtn && inlineInput) {
      saveBtn.addEventListener("click", function () {
        const name = inlineInput.value.trim();
        if (!name) {
          root.classList.add("is-error");
          if (inlineTitle) inlineTitle.textContent = "Введите название должности";
          return;
        }
        root.classList.remove("is-error");
        saveBtn.disabled = true;
        const method = editingId ? "PUT" : "POST";
        const editingRow = editingId ? options.querySelector('[data-position-row][data-id="' + CSS.escape(editingId) + '"]') : null;
        if (editingRow && editingRow.dataset.local === "1") {
          editingRow.dataset.name = name;
          const option = editingRow.querySelector("[data-position-option]");
          if (option) option.textContent = name;
          selectPosition(editingId, name);
          hideInline();
          openMenu();
          saveBtn.disabled = false;
          return;
        }
        requestJson(apiUrl(editingId), method, withOrganization({ name: name }))
          .then(function (body) {
            if (body.position) upsertRow(body.position);
            hideInline();
            openMenu();
          })
          .catch(function (err) {
            if (!editingId && err.code === "organization_required") {
              upsertRow({ id: "local-" + Date.now().toString(36), name: name, local: true });
              hideInline();
              openMenu();
              return;
            }
            root.classList.add("is-error");
            if (inlineTitle) inlineTitle.textContent = err.message;
          })
          .finally(function () {
            saveBtn.disabled = false;
          });
      });

      inlineInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          saveBtn.click();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          hideInline();
        }
      });
    }

    document.addEventListener("click", function (ev) {
      if (!root.contains(ev.target)) closeMenu();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-position-select]").forEach(initPositionSelect);
  });
})();
