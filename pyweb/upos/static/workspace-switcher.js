(function () {
  const storagePrefix = "upos.workspaceSwitcher.openOrder.";

  function storageKey() {
    const userId = (document.body && document.body.dataset.userId) || "anonymous";
    return storagePrefix + userId;
  }

  function readOrder() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey()) || "[]");
      return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function writeOrder(order) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(order));
    } catch (_) {
      // Storage can be unavailable in private or restricted browser modes.
    }
  }

  function organizationId(form) {
    const input = form.querySelector('input[name="organization_id"]');
    return input ? String(input.value || "").trim() : "";
  }

  function rememberOrganization(orgId) {
    if (!orgId) return;
    const order = readOrder();
    if (order.includes(orgId)) return;
    order.push(orgId);
    writeOrder(order);
  }

  function sortSwitcher(scope) {
    const panel = scope.querySelector(".workspace-options");
    if (!panel) return;

    const forms = Array.from(panel.querySelectorAll(".workspace-option-form"));
    if (!forms.length) return;

    const order = readOrder();
    const byId = new Map(order.map((orgId, index) => [orgId, index]));
    let changed = false;

    forms.forEach((form, index) => {
      form.dataset.workspaceOriginalIndex = String(index);
      const orgId = organizationId(form);
      if (form.querySelector(".workspace-option.active") && orgId && !byId.has(orgId)) {
        rememberOrganization(orgId);
        byId.set(orgId, order.length);
        order.push(orgId);
        changed = true;
      }
    });

    forms
      .slice()
      .sort((left, right) => {
        const leftId = organizationId(left);
        const rightId = organizationId(right);
        const leftSeen = byId.has(leftId);
        const rightSeen = byId.has(rightId);
        if (leftSeen && rightSeen) return byId.get(leftId) - byId.get(rightId);
        if (leftSeen) return -1;
        if (rightSeen) return 1;
        return Number(left.dataset.workspaceOriginalIndex || 0) - Number(right.dataset.workspaceOriginalIndex || 0);
      })
      .forEach((form) => panel.appendChild(form));

    if (changed) writeOrder(order);
  }

  function setupSwitcher(scope) {
    sortSwitcher(scope);
    scope.querySelectorAll(".workspace-option-form").forEach((form) => {
      form.addEventListener("submit", () => rememberOrganization(organizationId(form)));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-workspace-switcher]").forEach(setupSwitcher);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll("[data-workspace-switcher][open]").forEach((scope) => {
      scope.open = false;
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    document.querySelectorAll("[data-workspace-switcher][open]").forEach((scope) => {
      if (!target || !scope.contains(target)) scope.open = false;
    });
  });
})();
