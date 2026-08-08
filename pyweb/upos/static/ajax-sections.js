/* Быстрое переключение разделов списка без полной перезагрузки страницы.
 *
 * Раньше клик по разделу (например, в журнале продаж: Все / Заказы / Продажи /
 * Рассрочки / Возвраты / Архив) перезагружал всю страницу — долго и с «прыжком»
 * якоря на промежуточный экран. Здесь клик подгружает страницу в фоне (fetch) и
 * заменяет только нужные контейнеры, сохраняя позицию прокрутки.
 *
 * Разметка:
 *   <nav data-ajax-nav data-ajax-targets="#sales-journal-filter,#sales-journal">
 *     <a href="...">Раздел</a> ...
 *   </nav>
 * data-ajax-targets — список селекторов контейнеров, которые нужно заменить
 * свежими из ответа. После замены вызываются реинициализаторы (data-ajax-reinit).
 *
 * Столбцы (table-column-controls.js) переинициализируются сами — через свой
 * MutationObserver, поэтому здесь их трогать не нужно.
 */
(() => {
  "use strict";

  // Реинициализаторы клиентских модулей после подмены разметки. Идемпотентны
  // (внутри — свои data-*Ready-флаги), поэтому повторный вызов безопасен.
  function reinit(names) {
    (names || []).forEach((name) => {
      const fn = window[name];
      if (typeof fn === "function") {
        try {
          fn(document);
        } catch (error) {
          /* один сломавшийся модуль не должен ронять остальные */
        }
      }
    });
  }

  function swapTargets(html, selectors) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    let swapped = 0;
    selectors.forEach((selector) => {
      const fresh = parsed.querySelector(selector);
      const current = document.querySelector(selector);
      // current.isConnected: если контейнер уже удалён из DOM (был вложен в
      // ранее заменённый target), пропускаем — иначе потеряем свежую разметку.
      if (fresh && current && current.isConnected) {
        current.replaceWith(fresh);
        swapped += 1;
      }
    });
    return swapped;
  }

  async function load(href, nav) {
    const targets = (nav.getAttribute("data-ajax-targets") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const reinitNames = (nav.getAttribute("data-ajax-reinit") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!targets.length) {
      window.location.href = href;
      return;
    }

    const panel = nav.closest(".products-list-panel") || nav;
    panel.classList.add("ajax-section-loading");
    try {
      const response = await fetch(href, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const html = await response.text();
      const swapped = swapTargets(html, targets);
      if (!swapped) throw new Error("targets not found");
      window.history.pushState({ ajaxSection: true }, "", href);
      reinit(reinitNames);
    } catch (error) {
      // Любой сбой — честный полный переход, чтобы не оставить список сломанным.
      window.location.href = href;
    } finally {
      panel.classList.remove("ajax-section-loading");
    }
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-ajax-nav] a[href]");
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) return;
    const nav = link.closest("[data-ajax-nav]");
    if (!nav) return;
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    load(href, nav);
  });

  // Назад/вперёд по истории после AJAX-переключения: проще всего честно
  // перезагрузить нужный адрес — состояние списка полностью серверное.
  window.addEventListener("popstate", (event) => {
    if (event.state && event.state.ajaxSection) {
      window.location.reload();
    }
  });
})();
