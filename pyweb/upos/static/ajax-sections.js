/* Быстрое переключение разделов списка без полной перезагрузки страницы.
 *
 * Раньше клик по разделу (например, в журнале продаж: Все / Заказы / Продажи /
 * Рассрочки / Возвраты / Архив) перезагружал всю страницу — долго и с «прыжком»
 * якоря на промежуточный экран. Здесь клик подгружает страницу в фоне (fetch) и
 * заменяет только нужные контейнеры, сохраняя позицию прокрутки.
 *
 * Разметка:
 *   <nav data-ajax-nav data-ajax-targets="#sales-journal" data-ajax-reinit="Fn">
 *     <a href="...">Раздел</a> ...
 *   </nav>
 * data-ajax-targets — список селекторов контейнеров, которые нужно заменить
 * свежими из ответа. После замены вызываются реинициализаторы (data-ajax-reinit).
 *
 * Скорость: при наведении/фокусе на раздел его страница не только скачивается,
 * но и СРАЗУ парсится в фоне (dom-дерево кэшируется). К моменту клика остаётся
 * лишь подменить узлы — переход ощущается почти мгновенным, как клиентский
 * фильтр в товарах. Затемнение панели показываем только если данные всё же не
 * успели прийти (задержка появления), иначе оно мельтешит на быстрых переходах.
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

  function swapParsed(parsed, selectors) {
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

  // fetch + парсинг сразу (тяжёлый DOMParser уходит в фон предзагрузки, а не в
  // момент клика). Возвращает Document.
  function fetchParsed(href) {
    return fetch(href, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
    })
      .then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then((html) => new DOMParser().parseFromString(html, "text/html"));
  }

  // Кэш предзагрузки: href -> Promise<Document>.
  const prefetchCache = new Map();

  function prefetch(href) {
    if (!href || href.startsWith("#") || prefetchCache.has(href)) return;
    const pending = fetchParsed(href).catch(() => {
      // Промах (сеть/ошибка) убираем — при клике попробуем ещё раз.
      prefetchCache.delete(href);
      return null;
    });
    prefetchCache.set(href, pending);
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

    try {
      const parsed =
        (prefetchCache.has(href) ? await prefetchCache.get(href) : null) || (await fetchParsed(href));
      prefetchCache.delete(href);
      const swapped = swapParsed(parsed, targets);
      if (!swapped) throw new Error("targets not found");
      window.history.pushState({ ajaxSection: true }, "", href);
      reinit(reinitNames);
      if (typeof window.initWorkspaceModuleTabs === "function") {
        window.initWorkspaceModuleTabs(document);
      }
    } catch (error) {
      // Любой сбой — честный полный переход, чтобы не оставить список сломанным.
      window.location.href = href;
    }
  }

  function markActiveLink(nav, activeLink) {
    nav.querySelectorAll("a[href]").forEach((link) => {
      const active = link === activeLink;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
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
    markActiveLink(nav, link);
    load(href, nav);
  });

  // Touch/pointer users do not have a hover phase. Start the same background
  // request on pointer down so the click can reuse the in-flight response.
  document.addEventListener("pointerdown", (event) => {
    const link = event.target.closest("[data-ajax-nav] a[href]");
    if (link) prefetch(link.getAttribute("href") || "");
  });

  // Предзагрузка при наведении/фокусе: к моменту клика раздел уже скачан и
  // разобран в фоне.
  document.addEventListener("mouseover", (event) => {
    const link = event.target.closest("[data-ajax-nav] a[href]");
    if (link) prefetch(link.getAttribute("href") || "");
  });
  document.addEventListener("focusin", (event) => {
    const link = event.target.closest("[data-ajax-nav] a[href]");
    if (link) prefetch(link.getAttribute("href") || "");
  });

  // Назад/вперёд по истории после AJAX-переключения: проще всего честно
  // перезагрузить нужный адрес — состояние списка полностью серверное.
  window.addEventListener("popstate", (event) => {
    if (event.state && event.state.ajaxSection) {
      window.location.reload();
    }
  });
})();
