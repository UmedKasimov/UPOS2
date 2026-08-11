/* Обновляет разделы и серверную пагинацию без перезагрузки всей страницы. */
(() => {
  "use strict";

  function reinit(names) {
    (names || []).forEach((name) => {
      const fn = window[name];
      if (typeof fn !== "function") return;
      try {
        fn(document);
      } catch {
        /* Один модуль не должен останавливать обновление остальных. */
      }
    });
  }

  function readConfig(source) {
    const owner = source?.closest?.("[data-ajax-targets]") || source;
    return {
      targets: (owner?.getAttribute?.("data-ajax-targets") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      reinitNames: (owner?.getAttribute?.("data-ajax-reinit") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }

  function swapParsed(parsed, selectors) {
    let swapped = 0;
    selectors.forEach((selector) => {
      const fresh = parsed.querySelector(selector);
      const current = document.querySelector(selector);
      if (fresh && current && current.isConnected) {
        current.replaceWith(fresh);
        swapped += 1;
      }
    });
    return swapped;
  }

  function fetchParsed(href) {
    return fetch(href, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => new DOMParser().parseFromString(html, "text/html"));
  }

  const prefetchCache = new Map();

  function prefetch(href) {
    if (!href || href.startsWith("#") || prefetchCache.has(href)) return;
    const pending = fetchParsed(href).catch(() => {
      prefetchCache.delete(href);
      return null;
    });
    prefetchCache.set(href, pending);
  }

  async function load(href, source, options = {}) {
    const config = options.config || readConfig(source);
    const { targets, reinitNames } = config;
    if (!targets.length) {
      window.location.href = href;
      return;
    }

    const currentTargets = targets.map((selector) => document.querySelector(selector)).filter(Boolean);
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const busyTimer = window.setTimeout(() => {
      currentTargets.forEach((node) => node.setAttribute("aria-busy", "true"));
    }, 160);

    try {
      const parsed =
        (prefetchCache.has(href) ? await prefetchCache.get(href) : null) || (await fetchParsed(href));
      prefetchCache.delete(href);
      if (!swapParsed(parsed, targets)) throw new Error("targets not found");
      if (options.history !== false) {
        const currentState = window.history.state && typeof window.history.state === "object"
          ? window.history.state
          : {};
        if (!currentState.ajaxSection) {
          window.history.replaceState({ ...currentState, ajaxSection: config }, "", window.location.href);
        }
        window.history.pushState({ ajaxSection: config }, "", href);
      }
      reinit(reinitNames);
      if (typeof window.initWorkspaceModuleTabs === "function") {
        window.initWorkspaceModuleTabs(document);
      }
      requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
    } catch {
      window.location.href = href;
    } finally {
      window.clearTimeout(busyTimer);
      currentTargets.forEach((node) => node.removeAttribute("aria-busy"));
    }
  }

  function pageSizeHref(select) {
    const value = String(select.value || "").trim();
    if (/^(?:https?:\/\/|\/|\?)/i.test(value)) {
      return new URL(value, window.location.href).toString();
    }
    const url = new URL(window.location.href);
    url.searchParams.set(select.dataset.ajaxPageParam || select.name || "page_size", value);
    (select.dataset.ajaxResetParams || "page")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .forEach((name) => url.searchParams.delete(name));
    if (select.dataset.ajaxHash) url.hash = select.dataset.ajaxHash;
    return url.toString();
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
    if (!link || link.classList.contains("disabled") || link.getAttribute("aria-disabled") === "true") return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) return;
    const nav = link.closest("[data-ajax-nav]");
    const href = link.getAttribute("href") || "";
    if (!nav || !href || href.startsWith("#")) return;
    event.preventDefault();
    markActiveLink(nav, link);
    load(href, nav);
  });

  document.addEventListener("change", (event) => {
    const select = event.target.closest?.("select[data-ajax-page-size]");
    if (select) load(pageSizeHref(select), select);
  });

  ["pointerdown", "mouseover", "focusin"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      const link = event.target.closest("[data-ajax-nav] a[href]");
      if (link && !link.classList.contains("disabled")) prefetch(link.getAttribute("href") || "");
    });
  });

  window.addEventListener("popstate", (event) => {
    const config = event.state?.ajaxSection;
    if (config?.targets?.length) {
      load(window.location.href, null, { config, history: false });
    }
  });
})();
