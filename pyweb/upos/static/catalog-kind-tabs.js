/* Мгновенное переключение разделов каталога «Все / Товары / Услуги».
 *
 * Раньше клик по вкладке перезагружал всю страницу (1 МБ, ~0.8 с) и мелькал
 * промежуточным «меню». Все товары уже в таблице, поэтому переключаем на
 * месте: прячем строки не того вида. Ссылка остаётся рабочей (открытие в
 * новой вкладке, обновление страницы), но обычный клик обрабатываем сами.
 */
(() => {
  "use strict";

  function init() {
    const panel = document.querySelector(".products-list-panel");
    if (!panel || panel.dataset.catalogKindReady === "1") return;
    const table = panel.querySelector("#products-catalog-table");
    const tabs = [...panel.querySelectorAll(".messenger-channel-tab")].filter((tab) =>
      /[?&]kind=/.test(tab.getAttribute("href") || "")
    );
    if (!table || !tabs.length) return;
    panel.dataset.catalogKindReady = "1";

    const kindOf = (href) => {
      try {
        return new URL(href, window.location.href).searchParams.get("kind") || "all";
      } catch (error) {
        return "all";
      }
    };

    const rows = () => table.querySelectorAll("tbody [data-product-row]");
    const totalLabel = panel.querySelector("[data-products-total-count]");
    const shownLabel = panel.querySelector("[data-products-shown-range]");

    function apply(kind) {
      let shown = 0;
      rows().forEach((row) => {
        const rowKind = row.getAttribute("data-product-kind") || "product";
        const visible = kind === "all" || rowKind === kind;
        row.hidden = !visible;
        if (visible) {
          shown += 1;
          const indexCell = row.querySelector(".product-history-index");
          if (indexCell) indexCell.textContent = String(shown);
        }
      });
      tabs.forEach((tab) => {
        const active = kindOf(tab.getAttribute("href")) === kind;
        tab.classList.toggle("active", active);
        if (active) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
      });
      if (totalLabel) totalLabel.textContent = String(shown);
      if (shownLabel) shownLabel.textContent = shown ? "1-" + shown : "0";
    }

    tabs.forEach((tab) => {
      tab.addEventListener("click", (event) => {
        // Ctrl/Cmd/средняя кнопка — обычное открытие в новой вкладке.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
        event.preventDefault();
        const kind = kindOf(tab.getAttribute("href"));
        apply(kind);
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

    // При загрузке применяем вид из адреса: сервер отдаёт все товары, а
    // активный раздел показываем сами.
    const initial = new URLSearchParams(window.location.search).get("kind") || "product";
    apply(initial);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
