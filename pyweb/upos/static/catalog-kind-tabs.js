/* Мгновенные фильтры каталога — без перезагрузки страницы.
 *
 * Раньше каждый фильтр (раздел, поиск, категория, группа, бренд, папка)
 * отправлял форму и перезагружал всю страницу (~1 МБ, ~0.8 с) с «прыжком»
 * якоря. Сервер теперь отдаёт весь справочник целиком, а отбор строк идёт
 * здесь, на клиенте — мгновенно.
 *
 * Разделы «Все / Товары / Услуги / Подписки» (вкладки-«стрелки») и чекбоксы «Тип» — это
 * один и тот же фильтр вида: клик по вкладке отмечает нужный чекбокс, а общий
 * apply() читает состояние формы. products-table.js вызывает
 * window.CatalogClientFilter.apply() при изменении клиентских полей.
 *
 * Серверными остаются статус (по умолчанию «активные»), прайс-лист и валюта —
 * они меняют состав колонок цен, а не набор строк.
 */
(() => {
  "use strict";

  const KIND_LABELS = { all: "Все типы", product: "Товары", service: "Услуги", subscription: "Подписки" };

  // Число с разделителями тысяч и не более чем 3 знаками после запятой.
  function formatQuantity(value) {
    const rounded = Math.round(value * 1000) / 1000;
    const [intPart, frac] = String(rounded).split(".");
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return frac ? grouped + "." + frac : grouped;
  }

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
    const totalCountCell = table.querySelector("[data-catalog-total-count]");
    const totalQtyCell = table.querySelector("[data-catalog-total-quantities]");

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

    // Поле-мультифильтр «без ограничений», если отмечено «all» или ничего.
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
      table.classList.toggle("is-subscription-kind", kind === "subscription");
    }

    // Пересчёт итоговой строки под видимые строки: число позиций и суммы
    // остатков по единицам измерения (как на сервере, но по текущему фильтру).
    function updateTotals(shown, qtyByUnit) {
      if (totalCountCell) totalCountCell.textContent = shown + " позиций";
      if (!totalQtyCell) return;
      const parts = Object.keys(qtyByUnit)
        .map((unit) => ({ unit, value: qtyByUnit[unit] }))
        .filter((part) => Math.abs(part.value) > 1e-9);
      totalQtyCell.replaceChildren();
      if (!parts.length) {
        const span = document.createElement("span");
        span.textContent = "0";
        totalQtyCell.append(span);
        return;
      }
      parts.forEach((part) => {
        const span = document.createElement("span");
        // «Штука» — единица по умолчанию, в итоге её не подписываем.
        const suffix = part.unit && part.unit !== "штука" ? " " + part.unit : "";
        span.textContent = formatQuantity(part.value) + suffix;
        totalQtyCell.append(span);
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
      const qtyByUnit = {};
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
          // Номер строки рисует CSS-счётчик (::before): скрытые строки он
          // пропускает сам, поэтому вручную его писать не нужно — иначе номер
          // дублируется (было «11» → «1111»).
          const qty = parseFloat((row.getAttribute("data-sort-quantity") || "0").replace(",", ".")) || 0;
          const unit = attr(row, "data-sort-unit");
          qtyByUnit[unit] = (qtyByUnit[unit] || 0) + qty;
        }
      });

      updateTabs(effectiveKind());
      updateTotals(shown, qtyByUnit);
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
