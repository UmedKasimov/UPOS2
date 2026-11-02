(function () {
  "use strict";

  var STORAGE_PREFIX = "upos.menuOrder.v1:";
  var controllers = new WeakMap();
  var gripSvg = '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="7" cy="5" r="1.4"/><circle cx="13" cy="5" r="1.4"/><circle cx="7" cy="10" r="1.4"/><circle cx="13" cy="10" r="1.4"/><circle cx="7" cy="15" r="1.4"/><circle cx="13" cy="15" r="1.4"/></svg>';

  function itemsFor(container) {
    var selector = container.classList.contains("general-report-launcher")
      ? ".general-report-card"
      : container.classList.contains("nav-folder-panel") ? ".nav-sublink" : ".nav-link";
    return Array.prototype.filter.call(container.children, function (child) {
      return child.matches(selector);
    });
  }

  function identity(item) {
    var attrs = ["data-workspace-card", "data-org-report-card", "data-gr-tab", "data-shipment-card", "data-org-settings-launch-tab"];
    for (var i = 0; i < attrs.length; i += 1) {
      var value = item.getAttribute(attrs[i]);
      if (value) return attrs[i] + ":" + value;
    }
    var href = item.getAttribute("href");
    if (href) return "href:" + href.split("?")[0];
    return "text:" + (item.textContent || "").trim().replace(/\s+/g, " ");
  }

  function ensureIds(items) {
    var seen = Object.create(null);
    items.forEach(function (item) {
      if (item.dataset.menuOrderId) return;
      var base = identity(item);
      seen[base] = (seen[base] || 0) + 1;
      item.dataset.menuOrderId = base + (seen[base] > 1 ? ":" + seen[base] : "");
    });
  }

  function orderOf(container) {
    return itemsFor(container).map(function (item) { return item.dataset.menuOrderId; });
  }

  function applyOrder(container, order) {
    if (!Array.isArray(order) || !order.length) return;
    var items = itemsFor(container);
    ensureIds(items);
    var byId = Object.create(null);
    items.forEach(function (item) { byId[item.dataset.menuOrderId] = item; });
    var desired = [];
    order.forEach(function (id) {
      if (byId[id]) {
        desired.push(byId[id]);
        delete byId[id];
      }
    });
    items.forEach(function (item) {
      if (byId[item.dataset.menuOrderId]) desired.push(item);
    });
    if (items.every(function (item, index) { return item === desired[index]; })) return;
    desired.forEach(function (item) { container.appendChild(item); });
  }

  function readOrder(key) {
    try {
      var value = JSON.parse(window.localStorage.getItem(key) || "null");
      return Array.isArray(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function storageKey(container, index) {
    var user = document.body.dataset.userId || "anonymous";
    if (container.classList.contains("nav-folder-panel")) return STORAGE_PREFIX + user + ":sidebar-general";
    if (container.classList.contains("nav")) return STORAGE_PREFIX + user + ":sidebar-main";
    return STORAGE_PREFIX + user + ":cards:" + window.location.pathname + ":" +
      (container.getAttribute("aria-label") || "launcher") + ":" + index;
  }

  function makeButton(action, label, content) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "menu-order-button menu-order-button--" + action;
    button.dataset.menuOrderAction = action;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = content;
    return button;
  }

  function setup(container, index) {
    var items = itemsFor(container);
    if (items.length < 2) return;
    var controller = controllers.get(container);
    if (controller) {
      ensureIds(items);
      addGrips(items);
      if (!controller.editing) applyOrder(container, readOrder(controller.key));
      return;
    }

    ensureIds(items);
    var key = storageKey(container, index);
    applyOrder(container, readOrder(key));
    var toolbar = document.createElement("div");
    toolbar.className = "menu-order-toolbar";
    toolbar.setAttribute("aria-label", "Порядок кнопок меню");
    var edit = makeButton("edit", "Изменить порядок кнопок", gripSvg);
    var save = makeButton("save", "Сохранить порядок", '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
    var cancel = makeButton("cancel", "Отменить изменение порядка", "×");
    toolbar.appendChild(edit);
    toolbar.appendChild(save);
    toolbar.appendChild(cancel);
    var switcher = container.querySelector(":scope > .workspace-switcher");
    if (switcher) switcher.after(toolbar);
    else container.prepend(toolbar);
    addGrips(items);

    controller = { key: key, editing: false, original: [], dragged: null };
    controllers.set(container, controller);

    function finish(restore) {
      if (restore) applyOrder(container, controller.original);
      controller.editing = false;
      controller.dragged = null;
      container.classList.remove("menu-order-editing");
      itemsFor(container).forEach(function (item) {
        item.classList.remove("menu-order-dragging");
      });
    }

    edit.addEventListener("click", function () {
      controller.original = orderOf(container);
      controller.editing = true;
      container.classList.add("menu-order-editing");
    });
    cancel.addEventListener("click", function () { finish(true); });
    save.addEventListener("click", function () {
      try {
        window.localStorage.setItem(key, JSON.stringify(orderOf(container)));
        finish(false);
      } catch (error) {
        save.title = "Не удалось сохранить порядок в браузере";
        save.setAttribute("aria-label", save.title);
      }
    });

    container.addEventListener("click", function (event) {
      if (!controller.editing) return;
      if (!event.target.closest(".menu-order-toolbar") && event.target.closest(".general-report-card, .nav-link, .nav-sublink")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    container.addEventListener("pointerdown", function (event) {
      if (!controller.editing || !event.target.closest(".menu-order-grip")) return;
      var item = event.target.closest(".general-report-card, .nav-link, .nav-sublink");
      if (!item || item.parentElement !== container) return;
      event.preventDefault();
      controller.dragged = item;
      item.classList.add("menu-order-dragging");
      container.setPointerCapture(event.pointerId);
    });

    container.addEventListener("pointermove", function (event) {
      if (!controller.dragged) return;
      var target = document.elementFromPoint(event.clientX, event.clientY);
      target = target && target.closest(".general-report-card, .nav-link, .nav-sublink");
      if (!target || target.parentElement !== container || target === controller.dragged) return;
      var rect = target.getBoundingClientRect();
      var grid = container.classList.contains("general-report-launcher");
      var before = grid
        ? (event.clientY < rect.top ? true : event.clientY > rect.bottom ? false : event.clientX < rect.left + rect.width / 2)
        : event.clientY < rect.top + rect.height / 2;
      container.insertBefore(controller.dragged, before ? target : target.nextSibling);
    });

    function stopDrag() {
      if (controller.dragged) controller.dragged.classList.remove("menu-order-dragging");
      controller.dragged = null;
    }
    container.addEventListener("pointerup", stopDrag);
    container.addEventListener("pointercancel", stopDrag);
    container.addEventListener("keydown", function (event) {
      if (!controller.editing || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      var item = event.target.closest(".general-report-card, .nav-link, .nav-sublink");
      if (!item || item.parentElement !== container) return;
      var list = itemsFor(container);
      var position = list.indexOf(item);
      var next = position + ((event.key === "ArrowLeft" || event.key === "ArrowUp") ? -1 : 1);
      if (next < 0 || next >= list.length) return;
      event.preventDefault();
      container.insertBefore(item, next < position ? list[next] : list[next].nextSibling);
      item.focus();
    });
    document.addEventListener("keydown", function (event) {
      if (controller.editing && event.key === "Escape") finish(true);
    });
  }

  function addGrips(items) {
    items.forEach(function (item) {
      if (item.querySelector(":scope > .menu-order-grip")) return;
      var grip = document.createElement("span");
      grip.className = "menu-order-grip";
      grip.setAttribute("aria-hidden", "true");
      grip.innerHTML = gripSvg;
      item.appendChild(grip);
    });
  }

  function scan() {
    var main = document.querySelector("#app-sidebar > .nav");
    if (main) setup(main, 0);
    document.querySelectorAll(".nav-folder-panel").forEach(function (panel, index) { setup(panel, index); });
    document.querySelectorAll(".general-report-launcher").forEach(function (launcher, index) { setup(launcher, index); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
  var pending = 0;
  new MutationObserver(function (records) {
    var relevant = records.some(function (record) {
      if (record.target.matches && record.target.matches(".general-report-launcher, .nav, .nav-folder-panel")) return true;
      return Array.prototype.some.call(record.addedNodes, function (node) {
        return node.nodeType === 1 && (node.matches(".general-report-launcher, .nav, .nav-folder-panel") || node.querySelector(".general-report-launcher, .nav, .nav-folder-panel"));
      });
    });
    if (!relevant || pending) return;
    pending = window.setTimeout(function () { pending = 0; scan(); }, 50);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
