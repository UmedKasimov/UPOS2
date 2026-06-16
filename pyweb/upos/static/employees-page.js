(function () {
  "use strict";

  function t(key, fallback) {
    var bag = window.upos_i18n || {};
    return bag[key] || fallback || key;
  }

  function bindPwdToggles(root) {
    (root || document).querySelectorAll(".pwd-toggle").forEach(function (btn) {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var wrap = btn.closest(".pwd-wrap");
        var input = wrap ? wrap.querySelector(".pwd-input") : null;
        if (!input) return;
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.setAttribute("aria-pressed", show ? "true" : "false");
        var showLabel = btn.getAttribute("data-label-show") || "";
        var hideLabel = btn.getAttribute("data-label-hide") || "";
        btn.setAttribute("aria-label", show ? hideLabel : showLabel);
      });
    });
  }

  function openDialog(dialog) {
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog && dialog.open) dialog.close();
  }

  function splitIds(raw) {
    return String(raw || "")
      .split(",")
      .map(function (item) { return item.trim(); })
      .filter(Boolean);
  }

  function setCheckedValues(form, name, values) {
    if (!form) return;
    var selected = new Set(values || []);
    form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
      input.checked = selected.has(input.value);
    });
  }

  function refreshAccessSummary(dropdown) {
    if (!dropdown) return;
    var summary = dropdown.querySelector("[data-access-summary]");
    if (!summary) return;
    var checked = Array.prototype.slice.call(dropdown.querySelectorAll('input[type="checkbox"]:checked'));
    var fallback = summary.getAttribute("data-empty") || "Выберите";
    if (!checked.length) {
      summary.textContent = fallback;
      return;
    }
    var labels = checked.map(function (input) {
      return input.getAttribute("data-access-label") || input.value || "";
    }).filter(Boolean);
    if (labels.length === 1) {
      summary.textContent = labels[0] || fallback;
      return;
    }
    summary.textContent = labels.length + " выбрано";
  }

  function refreshAccessSummaries(root) {
    (root || document).querySelectorAll("[data-access-dropdown]").forEach(refreshAccessSummary);
  }

  function selectedOrganizationIds(form) {
    var selected = new Set();
    if (!form) return selected;
    form.querySelectorAll('input[name$="_organization_ids"]:checked').forEach(function (input) {
      if (input.value) selected.add(input.value);
    });
    return selected;
  }

  function updateAccountVisibility(form, pruneHidden) {
    if (!form) return;
    var selectedOrgs = selectedOrganizationIds(form);
    var accountDropdown = form.querySelector(".employees-access-dropdown--accounts");
    if (!accountDropdown) return;
    var empty = accountDropdown.querySelector("[data-account-empty]");
    var visibleGroups = 0;
    accountDropdown.querySelectorAll("[data-account-group]").forEach(function (group) {
      var orgId = group.getAttribute("data-organization-id") || "";
      var visible = selectedOrgs.has(orgId);
      group.hidden = !visible;
      if (visible) visibleGroups += 1;
      if (!visible && pruneHidden) {
        group.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
          input.checked = false;
        });
      }
    });
    if (empty) {
      empty.textContent = selectedOrgs.size ? "В выбранных организациях нет счетов" : "Сначала выберите организацию";
      empty.hidden = visibleGroups > 0;
    }
    refreshAccessSummary(accountDropdown);
  }

  function bindAccessDropdowns(root) {
    (root || document).querySelectorAll("[data-access-dropdown]").forEach(function (dropdown) {
      if (dropdown.dataset.bound === "1") {
        refreshAccessSummary(dropdown);
        return;
      }
      dropdown.dataset.bound = "1";
      dropdown.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
        input.addEventListener("change", function () {
          refreshAccessSummary(dropdown);
          if (input.name.indexOf("organization_ids") !== -1) {
            updateAccountVisibility(input.closest("form"), true);
          }
        });
      });
      refreshAccessSummary(dropdown);
    });
    (root || document).querySelectorAll("form").forEach(function (form) {
      updateAccountVisibility(form, false);
    });
  }

  function fillAddPreset(form, trigger) {
    if (!form || !trigger) return;
    var name = trigger.getAttribute("data-preset-name") || "";
    var login = trigger.getAttribute("data-preset-login") || "";
    var position = trigger.getAttribute("data-preset-position") || "";
    var roleId = trigger.getAttribute("data-preset-role-id") || "";
    if (!name && !login && !position && !roleId) return;
    var nameInput = form.querySelector('[name="new_name"]');
    var loginInput = form.querySelector('[name="new_username"]');
    var positionInput = form.querySelector('[name="new_position"]');
    var roleInput = form.querySelector('[name="new_employee_role_id"]');
    if (nameInput) nameInput.value = name;
    if (loginInput) loginInput.value = login;
    if (positionInput) positionInput.value = position;
    if (roleInput && roleId) roleInput.value = roleId;
    refreshRolePermissions(form);
  }

  function fillEditForm(card) {
    var form = document.getElementById("employee-edit-form");
    if (!form || !card) return;
    var username = card.getAttribute("data-username") || "";
    var isFrozen = card.getAttribute("data-is-frozen") === "1";
    document.getElementById("employee-edit-old-username").value = username;
    document.getElementById("employee-delete-username").value = username;
    var freezeUsername = document.getElementById("employee-freeze-username");
    var unfreezeUsername = document.getElementById("employee-unfreeze-username");
    if (freezeUsername) freezeUsername.value = username;
    if (unfreezeUsername) unfreezeUsername.value = username;
    form.querySelector('[name="edit_username"]').value = username;
    form.querySelector('[name="edit_email"]').value = "";
    form.querySelector('[name="edit_name"]').value = card.getAttribute("data-name") || "";
    form.querySelector('[name="edit_position"]').value = card.getAttribute("data-position") || "";
    var role = card.getAttribute("data-staff-role") || "viewer";
    var roleSel = form.querySelector('[name="edit_staff_role"]');
    if (roleSel) roleSel.value = role;
    var employeeRole = card.getAttribute("data-employee-role-id") || "";
    var employeeRoleSel = form.querySelector('[name="edit_employee_role_id"]');
    if (employeeRoleSel) employeeRoleSel.value = employeeRole;
    refreshRolePermissions(form);
    setCheckedValues(form, "edit_organization_ids", splitIds(card.getAttribute("data-organization-ids")));
    setCheckedValues(form, "edit_account_ids", splitIds(card.getAttribute("data-account-ids")));
    updateAccountVisibility(form, true);
    refreshAccessSummaries(form);
    var pw = form.querySelector('[name="edit_password"]');
    if (pw) pw.value = "";
    document.querySelectorAll("[data-employee-freeze-submit]").forEach(function (btn) {
      btn.hidden = isFrozen;
    });
    document.querySelectorAll("[data-employee-unfreeze-submit]").forEach(function (btn) {
      btn.hidden = !isFrozen;
    });
  }

  function selectedRoleOption(form) {
    if (!form) return null;
    var select = form.querySelector(".employees-role-select");
    if (!select || select.selectedIndex < 0) return null;
    return select.options[select.selectedIndex] || null;
  }

  function parseRolePermissions(option) {
    if (!option) return {};
    var raw = option.getAttribute("data-role-permissions") || "{}";
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function refreshRolePermissions(form) {
    if (!form) return;
    var panel = form.querySelector("[data-role-permissions-panel]");
    var perms = parseRolePermissions(selectedRoleOption(form));
    if (panel) {
      panel.querySelectorAll("[data-role-permission-toggle]").forEach(function (box) {
        var key = box.getAttribute("data-role-permission-toggle") || "";
        box.checked = !!perms[key];
      });
    }
    refreshButtonPermissions(form, perms);
    refreshCategoryAccess(form, perms);
    syncRolePermissionSummaries(form);
  }

  function buttonAccessFor(perms, section, action) {
    var access = perms && perms.button_access && typeof perms.button_access === "object" ? perms.button_access : null;
    var group = access && access[section] && typeof access[section] === "object" ? access[section] : null;
    if (!group || !Object.prototype.hasOwnProperty.call(group, action)) return true;
    return !!group[action];
  }

  function refreshButtonPermissions(form, perms) {
    var panel = form ? form.querySelector("[data-role-permissions-panel]") : null;
    if (!panel) return;
    panel.querySelectorAll("[data-role-button-permission-toggle]").forEach(function (box) {
      var section = box.getAttribute("data-role-button-section") || "";
      var action = box.getAttribute("data-role-button-action") || "";
      box.checked = buttonAccessFor(perms || {}, section, action);
    });
    syncButtonGroupStates(form);
  }

  function collectButtonAccess(form) {
    var panel = form ? form.querySelector("[data-role-permissions-panel]") : null;
    if (!panel) return null;
    var buttonAccess = {};
    var hasButtons = false;
    panel.querySelectorAll("[data-role-button-permission-toggle]").forEach(function (box) {
      var section = box.getAttribute("data-role-button-section") || "";
      var action = box.getAttribute("data-role-button-action") || "";
      if (!section || !action) return;
      if (!buttonAccess[section]) buttonAccess[section] = {};
      buttonAccess[section][action] = !!box.checked;
      hasButtons = true;
    });
    return hasButtons ? buttonAccess : null;
  }

  function syncButtonGroupStates(form) {
    var panel = form ? form.querySelector("[data-role-permissions-panel]") : null;
    if (!panel) return;
    panel.querySelectorAll("[data-role-permission-group]").forEach(function (group) {
      var main = group.querySelector("[data-role-permission-toggle]");
      var enabled = !main || !!main.checked;
      group.classList.toggle("is-permission-off", !enabled);
      group.querySelectorAll("[data-role-button-permission-toggle]").forEach(function (box) {
        box.disabled = !enabled;
      });
    });
    syncButtonPermissionSummaries(form);
  }

  function syncButtonPermissionSummaries(form) {
    var panel = form ? form.querySelector("[data-role-permissions-panel]") : null;
    if (!panel) return;
    panel.querySelectorAll("[data-role-permission-group]").forEach(function (group) {
      var boxes = Array.prototype.slice.call(group.querySelectorAll("[data-role-button-permission-toggle]"));
      var checked = boxes.filter(function (box) { return box.checked; }).length;
      var summary = group.querySelector("[data-role-button-count]");
      if (summary) summary.textContent = selectedSummaryText(checked, boxes.length);
    });
  }

  function categoryPanel(form) {
    return form ? form.querySelector("[data-role-category-panel]") : null;
  }

  function refreshCategoryAccess(form, perms) {
    var panel = categoryPanel(form);
    if (!panel) return;
    var access = perms && typeof perms.category_access === "object" ? perms.category_access : null;
    var restricted = !!(access && access.enabled);
    var selected = new Set(restricted ? (access.category_ids || []).map(String) : []);
    var subcats = restricted && access.subcategories && typeof access.subcategories === "object" ? access.subcategories : {};
    panel.querySelectorAll("[data-role-category-toggle]").forEach(function (box) {
      var id = box.getAttribute("data-role-category-toggle") || "";
      box.checked = restricted ? selected.has(id) : true;
      panel.querySelectorAll('[data-role-subcategory-category="' + cssEscape(id) + '"]').forEach(function (subBox) {
        var values = Array.isArray(subcats[id]) ? subcats[id].map(String) : null;
        subBox.checked = box.checked && (values ? values.indexOf(subBox.value) !== -1 : true);
        subBox.disabled = !box.checked;
      });
    });
    syncCategoryAll(panel);
    syncCategorySummaries(panel);
  }

  function collectCategoryAccess(form) {
    var panel = categoryPanel(form);
    if (!panel) return null;
    var boxes = Array.prototype.slice.call(panel.querySelectorAll("[data-role-category-toggle]"));
    var allSelected = boxes.length > 0 && boxes.every(function (box) { return box.checked; });
    if (allSelected) return null;
    var categoryIds = [];
    var subcategories = {};
    boxes.forEach(function (box) {
      var id = box.getAttribute("data-role-category-toggle") || "";
      if (!id || !box.checked) return;
      categoryIds.push(id);
      var values = [];
      panel.querySelectorAll('[data-role-subcategory-category="' + cssEscape(id) + '"]').forEach(function (subBox) {
        if (subBox.checked && subBox.value) values.push(subBox.value);
      });
      if (values.length) subcategories[id] = values;
    });
    return {
      enabled: true,
      category_ids: categoryIds,
      subcategories: subcategories,
    };
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value || "").replace(/"/g, '\\"');
  }

  function syncCategoryAll(panel) {
    var all = panel ? panel.querySelector("[data-role-category-all]") : null;
    if (!all) return;
    var boxes = Array.prototype.slice.call(panel.querySelectorAll("[data-role-category-toggle]"));
    all.checked = !!boxes.length && boxes.every(function (box) { return box.checked; });
    all.indeterminate = boxes.some(function (box) { return box.checked; }) && !all.checked;
  }

  function syncRolePermissionAll(form) {
    var panel = form ? form.querySelector("[data-role-permissions-panel]") : null;
    var all = panel ? panel.querySelector("[data-role-permission-all]") : null;
    if (!all) return;
    var boxes = Array.prototype.slice.call(panel.querySelectorAll("[data-role-permission-toggle], [data-role-button-permission-toggle]"));
    var checked = boxes.filter(function (box) { return box.checked; }).length;
    all.checked = !!boxes.length && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }

  function selectedSummaryText(count, total) {
    if (!total) return "Нет";
    return count + " из " + total;
  }

  function syncRolePermissionSummaries(form) {
    if (!form) return;
    var panel = form.querySelector("[data-role-permissions-panel]");
    if (panel) {
      var boxes = Array.prototype.slice.call(panel.querySelectorAll("[data-role-permission-toggle]"));
      var checked = boxes.filter(function (box) { return box.checked; }).length;
      var mainSummary = panel.querySelector("[data-role-main-summary]");
      if (mainSummary) mainSummary.textContent = selectedSummaryText(checked, boxes.length);
      syncButtonGroupStates(form);
      syncRolePermissionAll(form);
    }
    var categories = categoryPanel(form);
    if (categories) syncCategorySummaries(categories);
  }

  function syncCategorySummaries(panel) {
    if (!panel) return;
    panel.querySelectorAll("[data-role-category-type]").forEach(function (group) {
      var boxes = Array.prototype.slice.call(group.querySelectorAll("[data-role-category-toggle]"));
      var checked = boxes.filter(function (box) { return box.checked; }).length;
      var summary = group.querySelector("[data-role-category-type-summary]");
      if (summary) summary.textContent = selectedSummaryText(checked, boxes.length);
    });
    panel.querySelectorAll("[data-role-category-row]").forEach(function (row) {
      var boxes = Array.prototype.slice.call(row.querySelectorAll("[data-role-subcategory-toggle]"));
      var checked = boxes.filter(function (box) { return box.checked; }).length;
      var summary = row.querySelector("[data-role-subcategory-summary]");
      if (summary) summary.textContent = selectedSummaryText(checked, boxes.length);
    });
  }

  function bindCategoryAccess(root) {
    (root || document).querySelectorAll("[data-role-category-panel]").forEach(function (panel) {
      if (panel.dataset.bound === "1") {
        syncCategoryAll(panel);
        syncCategorySummaries(panel);
        return;
      }
      panel.dataset.bound = "1";
      var all = panel.querySelector("[data-role-category-all]");
      if (all) {
        all.addEventListener("change", function () {
          panel.querySelectorAll("[data-role-category-toggle]").forEach(function (box) {
            box.checked = all.checked;
          });
          panel.querySelectorAll("[data-role-subcategory-toggle]").forEach(function (box) {
            box.checked = all.checked;
            box.disabled = !all.checked;
          });
          syncCategoryAll(panel);
          syncCategorySummaries(panel);
        });
      }
      panel.querySelectorAll("[data-role-category-toggle]").forEach(function (box) {
        box.addEventListener("change", function () {
          var id = box.getAttribute("data-role-category-toggle") || "";
          panel.querySelectorAll('[data-role-subcategory-category="' + cssEscape(id) + '"]').forEach(function (subBox) {
            subBox.checked = box.checked;
            subBox.disabled = !box.checked;
          });
          syncCategoryAll(panel);
          syncCategorySummaries(panel);
        });
      });
      panel.querySelectorAll("[data-role-subcategory-toggle]").forEach(function (box) {
        box.addEventListener("change", function () {
          var id = box.getAttribute("data-role-subcategory-category") || "";
          var parent = panel.querySelector('[data-role-category-toggle="' + cssEscape(id) + '"]');
          if (parent && box.checked) parent.checked = true;
          syncCategoryAll(panel);
          syncCategorySummaries(panel);
        });
      });
      syncCategoryAll(panel);
      syncCategorySummaries(panel);
    });
  }

  function collectRolePermissions(form) {
    if (!form) return null;
    var panel = form.querySelector("[data-role-permissions-panel]");
    var select = form.querySelector(".employees-role-select");
    if (!panel || !select || !select.value) return null;
    var permissions = {};
    panel.querySelectorAll("[data-role-permission-toggle]").forEach(function (box) {
      var key = box.getAttribute("data-role-permission-toggle") || "";
      if (key) permissions[key] = !!box.checked;
    });
    var buttonAccess = collectButtonAccess(form);
    if (buttonAccess) permissions.button_access = buttonAccess;
    var categoryAccess = collectCategoryAccess(form);
    if (categoryAccess) permissions.category_access = categoryAccess;
    return { roleId: select.value, permissions: permissions };
  }

  function applyRolesPayload(roles) {
    if (!Array.isArray(roles)) return;
    var byId = {};
    roles.forEach(function (role) {
      if (role && role.id) byId[String(role.id)] = role.permissions || {};
    });
    document.querySelectorAll(".employees-role-select option").forEach(function (option) {
      var roleId = option.value || "";
      if (Object.prototype.hasOwnProperty.call(byId, roleId)) {
        option.setAttribute("data-role-permissions", JSON.stringify(byId[roleId] || {}));
      }
    });
  }

  function saveRolePermissionsForForm(form) {
    var state = collectRolePermissions(form);
    if (!state) return Promise.resolve();
    var payload = {};
    payload[state.roleId] = state.permissions;
    return fetch("/api/settings/roles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken(),
      },
      body: JSON.stringify({ roles: payload }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || !body.ok) throw new Error(body.error || "Не удалось сохранить права роли");
          return body;
        });
      })
      .then(function (body) {
        applyRolesPayload(body.roles);
      });
  }

  function bindRolePermissionForms(root) {
    (root || document).querySelectorAll("form").forEach(function (form) {
      if (!form.querySelector("[data-role-permissions-panel]")) return;
      if (form.dataset.rolePermissionsBound === "1") {
        refreshRolePermissions(form);
        return;
      }
      form.dataset.rolePermissionsBound = "1";
      bindCategoryAccess(form);
      var select = form.querySelector(".employees-role-select");
      if (select) {
        select.addEventListener("change", function () {
          refreshRolePermissions(form);
        });
      }
      var allPermissions = form.querySelector("[data-role-permission-all]");
      if (allPermissions) {
        allPermissions.addEventListener("change", function () {
          allPermissions.indeterminate = false;
          form.querySelectorAll("[data-role-permission-toggle]").forEach(function (box) {
            box.checked = allPermissions.checked;
          });
          form.querySelectorAll("[data-role-button-permission-toggle]").forEach(function (box) {
            box.checked = allPermissions.checked;
          });
          syncButtonGroupStates(form);
          syncRolePermissionSummaries(form);
        });
      }
      form.querySelectorAll("[data-role-permission-toggle]").forEach(function (box) {
        box.addEventListener("click", function (event) {
          event.stopPropagation();
        });
        box.addEventListener("change", function () {
          syncButtonGroupStates(form);
          syncRolePermissionSummaries(form);
        });
      });
      form.querySelectorAll("[data-role-button-permission-toggle]").forEach(function (box) {
        box.addEventListener("change", function () {
          syncButtonPermissionSummaries(form);
          syncRolePermissionAll(form);
        });
      });
      form.addEventListener("submit", function (event) {
        if (form.dataset.rolePermissionsSubmitting === "1") {
          form.dataset.rolePermissionsSubmitting = "";
          return;
        }
        event.preventDefault();
        saveRolePermissionsForForm(form)
          .then(function () {
            form.dataset.rolePermissionsSubmitting = "1";
            HTMLFormElement.prototype.submit.call(form);
          })
          .catch(function (err) {
            window.alert(err.message || "Не удалось сохранить права роли");
          });
      });
      refreshRolePermissions(form);
    });
    bindCategoryAccess(root);
  }

  function csrfToken() {
    var el = document.querySelector('input[name="csrf_token"]');
    return el ? el.value || "" : "";
  }

  window.employeeConfirmDelete = function () {
    var uname = document.getElementById("employee-delete-username").value || "";
    var tpl = window.employeeDeleteConfirmTemplate || "Удалить доступ {username}?";
    return window.confirm(tpl.replace("{username}", uname));
  };

  function init() {
    bindPwdToggles(document);
    bindAccessDropdowns(document);
    bindCategoryAccess(document);
    bindRolePermissionForms(document);

    var addDialog = document.getElementById("employee-add-dialog");
    var editDialog = document.getElementById("employee-edit-dialog");
    var devicesDialog = document.getElementById("employee-devices-dialog");
    var devicesTitle = document.getElementById("employee-devices-title");
    var devicesList = document.querySelector("[data-employee-devices-list]");

    document.querySelectorAll("[data-employee-add-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var form = document.getElementById("employee-add-form");
        if (form) form.reset();
        fillAddPreset(form, btn);
        updateAccountVisibility(form, true);
        refreshAccessSummaries(form);
        openDialog(addDialog);
        bindPwdToggles(addDialog);
        bindAccessDropdowns(addDialog);
        bindCategoryAccess(addDialog);
        bindRolePermissionForms(addDialog);
      });
    });

    document.querySelectorAll("[data-employee-add-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeDialog(addDialog);
      });
    });

    document.querySelectorAll("[data-employee-edit-open]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest("[data-employee-id]");
        fillEditForm(card);
        openDialog(editDialog);
        bindPwdToggles(editDialog);
        bindAccessDropdowns(editDialog);
        bindCategoryAccess(editDialog);
        bindRolePermissionForms(editDialog);
      });
    });

    document.querySelectorAll("[data-employee-edit-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeDialog(editDialog);
      });
    });

    document.querySelectorAll("[data-employee-reset-password]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var card = btn.closest("[data-employee-id]");
        var eid = card ? card.getAttribute("data-employee-id") || "" : "";
        var name = card ? card.getAttribute("data-name") || card.getAttribute("data-username") || "" : "";
        if (!eid) return;
        if (!window.confirm("Сбросить пароль сотруднику " + name + "?")) return;
        btn.disabled = true;
        fetch("/api/employees/" + encodeURIComponent(eid) + "/reset-password", {
          method: "POST",
          headers: { "X-CSRF-Token": csrfToken() },
        })
          .then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
              if (!res.ok || !body.ok) throw new Error(body.error || "Не удалось сбросить пароль");
              return body;
            });
          })
          .then(function (body) {
            window.alert("Временный пароль: " + (body.temporary_password || ""));
          })
          .catch(function (err) {
            window.alert(err.message || "Не удалось сбросить пароль");
          })
          .finally(function () {
            btn.disabled = false;
          });
      });
    });

    if (window.uposDeviceSessions && devicesDialog && devicesList) {
      var titleTpl = window.employeeDevicesTitleTemplate || "Устройства · {name}";
      window.uposDeviceSessions.initDevicesDialog({
        dialog: devicesDialog,
        listEl: devicesList,
        i18nPrefix: "employees.devices.",
        showCurrentDevice: false,
        titleEl: devicesTitle,
        getApiBase: function (trigger) {
          var card = trigger ? trigger.closest("[data-employee-id]") : null;
          var eid = card ? card.getAttribute("data-employee-id") : "";
          return eid ? "/api/employees/" + encodeURIComponent(eid) + "/devices" : "";
        },
        getTitle: function (trigger) {
          var card = trigger ? trigger.closest("[data-employee-id]") : null;
          var name = card ? card.getAttribute("data-name") || card.getAttribute("data-username") : "";
          return titleTpl.replace("{name}", name || "");
        },
        openTriggers: document.querySelectorAll("[data-employee-devices-open]"),
        closeTriggers: document.querySelectorAll("[data-employee-devices-close]"),
      });
    }

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
