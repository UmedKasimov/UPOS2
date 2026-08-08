/* Мгновенные фильтры каталога — без перезагрузки страницы.
 *
 * Раньше каждый фильтр (раздел, поиск, категория, группа, бренд, папка)
 * отправлял форму и перезагружал всю страницу (~1 МБ, ~0.8 с) с «прыжком»
 * якоря. Сервер теперь отдаёт весь справочник целиком, а отбор строк идёт
 * здесь, на клиенте — мгновенно.
 *
 * Разделы «Все / Товары / Услуги» (вкладки-«стрелки») и чекбоксы «Тип» — это
 * один и тот же фильтр вида: клик по вкладке отмечает нужный чекбокс, а общий
 * apply() читает состояние формы. products-table.js вызывает
 * window.CatalogClientFilter.apply() при изменении клиентских полей.
 *
 * Серверными остаются статус (по умолчанию «активные»), прайс-лист и валюта —
 * они меняют состав колонок цен, а не набор строк.
 */
(() => {
  "use strict";

  const KIND_LABELS = { all: "Все типы", product: "Товары", service: "Услуги" };

  function init() {
    const panel = document.querySelector(".products-list-panel");
    if (!panel || panel.dataset.catalogKindReady === "1") return;
    const table = panel.querySelector("#products-catalog-table");
    const form = panel.querySelector("#products-catalog-filter");
    const tabs = [...panel.querySelectorAll(".messenger-channel-tab")].filter((tab) =>
      /[?&]kind=/.test(tab.getAttribute("href") || "")
    );
    if (!table || !form || !tabs.length) return;
    panel.dataset.catalogKindReady = "1";

    const searchInput = form.querySelector('input[name="q"]');
    const totalLabel = panel.querySelector("[data-products-total-count]");
    const shownLabel = panel.querySelector("[data-products-shown-range]");

    const kindOf = (href) => {
      try {
        return new URL(href, window.location.href).searchParams.get("kind") || "all";
      } catch (error) {
        return "all";
      }
    };
    const rows = () => table.querySelectorAll("tbody [data-product-row]");
    const attr = (row, name) => (row.getAttribute(name) || "").trim().toLowerCase();

    // Отмеченные значения поля (в нижнем регистре, без служебного «all»).
    const checkedValues = (name) =>
      [...form.querySelectorAll('input[name="' + name + '"]:checked')]
        .map((el) => (el.value || "").trim().toLowerCase())
        .filter((value) => value && value !== "all");

    // Поле-мультифильтр считается «без ограничений», если отмечено «all» или
    // не отмечено ничего.
    const isAll = (name) => {
      const checked = [...form.querySelectorAll('input[name="' + name + '"]:checked')];
      return !checked.length || checked.some((el) => el.value === "all");
    };

    function effectiveKind() {
      if (isAll("kind")) return "all";
      const vals = checkedValues("kind");
      return vals.length === 1 ? vals[0] : "all";
    }

    function updateTabs(kind) {
      tabs.forEach((tab) => {
        const active = kindOf(tab.getAttribute("href")) === kind;
        tab.classList.toggle("active", active);
        if (active) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
      });
    }

    function apply() {
      const kindAll = isAll("kind");
      const kindVals = checkedValues("kind");
      const catVals = checkedValues("category");
      const groupVals = checkedValues("group");
      const brandVals = checkedValues("brand");
      const folderVals = checkedValues("folder");
      const query = (searchInput && searchInput.value ? searchInput.value : "").trim().toLowerCase();
      const qTerms = query ? query.split(/\s+/).filter(Boolean) : [];

      let shown = 0;
      rows().forEach((row) => {
        const rkind = row.getAttribute("data-product-kind") || "product";
        const rcat = attr(row, "data-sort-category");
        const rgroup = attr(row, "data-filter-group");
        const rbrand = attr(row, "data-filter-brand");
        const rfolder = attr(row, "data-filter-folder");

        let ok = true;
        if (!kindAll && kindVals.length && !kindVals.includes(rkind)) ok = false;
        if (ok && catVals.length && !catVals.includes(rcat)) ok = false;
        if (ok && groupVals.length && !groupVals.includes(rgroup)) ok = false;
        if (ok && brandVals.length && !brandVals.includes(rbrand)) ok = false;
        if (ok && folderVals.length && !folderVals.includes(rfolder)) ok = false;
        if (ok && qTerms.length) {
          const hay = [
            attr(row, "data-sort-name"),
            attr(row, "data-sort-sku"),
            attr(row, "data-sort-barcode"),
            rcat,
            rbrand,
            rfolder,
          ].join(" ");
          if (!qTerms.every((term) => hay.includes(term))) ok = false;
        }

        row.hidden = !ok;
        if (ok) {
          shown += 1;
          const indexCell = row.querySelector(".product-history-index");
          if (indexCell) indexCell.textContent = String(shown);
        }
      });

      updateTabs(effectiveKind());
      if (totalLabel) totalLabel.textContent = String(shown);
      if (shownLabel) shownLabel.textContent = shown ? "1-" + shown : "0";
    }

    // Клик по вкладке = выбор одного вида: синхронизируем чекбоксы «Тип»,
    // подпись фильтра и применяем отбор без перезагрузки.
    function selectKind(kind) {
      form.querySelectorAll('input[name="kind"]').forEach((cb) => {
        cb.checked = cb.value === kind;
      });
      const kindLabel = form.querySelector(".products-kind-filter [data-products-multi-filter-label]");
      if (kindLabel) kindLabel.textContent = KIND_LABELS[kind] || kindLabel.textContent;
    }

    tabs.forEach((tab) => {
      tab.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
        event.preventDefault();
        const kind = kindOf(tab.getAttribute("href"));
        selectKind(kind);
        apply();
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("kind", kind);
          url.hash = "catalog";
          window.history.replaceState(null, "", url.toString());
        } catch (error) {
          /* адрес не критичен для фильтра */
        }
      });
    });

    window.CatalogClientFilter = { apply };
    apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
