/* Prepare likely same-origin destinations before activation and acknowledge input instantly. */
(() => {
  "use strict";

  const BLOCKED_PATH_PREFIXES = [
    "/api/",
    "/auth",
    "/billing",
    "/admin",
    "/static/",
    "/installer",
  ];
  const TRANSIENT_PARAMS = new Set([
    "err",
    "error",
    "msg",
    "perf_refresh",
    "saved_id",
  ]);
  const TARGET_SELECTOR = [
    "a[href]",
    "[data-workspace-navigate-href]",
    "[data-workspace-tab-href]",
    "[data-workspace-sync-url]",
  ].join(",");
  const pendingTimers = new WeakMap();
  const warmAttempts = new Map();
  const WARM_DEDUPE_MS = 15_000;
  let hoverTimer = 0;
  const recentRoutesKey = "upos:instant-navigation:recent:v1";

  function destination(target) {
    if (!target) return null;
    const value =
      target.dataset?.workspaceNavigateHref ||
      target.dataset?.workspaceTabHref ||
      target.dataset?.workspaceSyncUrl ||
      target.getAttribute?.("href") ||
      "";
    if (!value || value.startsWith("#")) return null;
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (BLOCKED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
      TRANSIENT_PARAMS.forEach((name) => url.searchParams.delete(name));
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash === window.location.hash
      ) {
        return null;
      }
      url.hash = "";
      return url;
    } catch {
      return null;
    }
  }

  function eligibleLink(link) {
    if (!(link instanceof HTMLAnchorElement)) return false;
    if (link.hasAttribute("download") || link.target || link.relList.contains("external")) return false;
    if (link.dataset.noInstantNavigation === "1") return false;
    return Boolean(destination(link));
  }

  function markEligible(root = document) {
    root.querySelectorAll?.("a[href]").forEach((link) => {
      if (eligibleLink(link)) {
        link.dataset.instantNavigation = "1";
      } else {
        delete link.dataset.instantNavigation;
      }
    });
  }

  function requestWarm(url) {
    if (!url) return Promise.resolve(false);
    const lastAttempt = warmAttempts.get(url.href) || 0;
    if (Date.now() - lastAttempt < WARM_DEDUPE_MS) return Promise.resolve(true);
    warmAttempts.set(url.href, Date.now());

    const workspaceWarmup = window.UPOSWorkspaceWarmup;
    if (workspaceWarmup?.warm) {
      return Promise.resolve(workspaceWarmup.warm(url.href));
    }

    return fetch(url.href, {
      cache: "default",
      credentials: "same-origin",
      headers: { Accept: "text/html", "X-UPOS-Prefetch": "1" },
      priority: "high",
    }).then((response) => response.ok).catch(() => false);
  }

  function scheduleWarm(target, delayMs = 0) {
    window.clearTimeout(hoverTimer);
    const url = destination(target);
    if (!url) return;
    hoverTimer = window.setTimeout(() => void requestWarm(url), delayMs);
  }

  function interactionTarget(event) {
    return event.target.closest?.(TARGET_SELECTOR) || null;
  }

  function showPending(target) {
    if (!target) return;
    const prior = pendingTimers.get(target);
    if (prior) window.clearTimeout(prior);
    target.classList.add("instant-navigation-target", "is-navigation-pending");
    target.setAttribute("aria-busy", "true");
    const timer = window.setTimeout(() => {
      target.classList.remove("is-navigation-pending");
      target.removeAttribute("aria-busy");
      pendingTimers.delete(target);
    }, 2200);
    pendingTimers.set(target, timer);
  }

  function rememberCurrentRoute() {
    let recent = [];
    try {
      recent = JSON.parse(window.sessionStorage.getItem(recentRoutesKey) || "[]");
    } catch {
      recent = [];
    }
    const current = new URL(window.location.href);
    current.hash = "";
    TRANSIENT_PARAMS.forEach((name) => current.searchParams.delete(name));
    const currentHref = current.href;
    const previous = recent.find((href) => href && href !== currentHref) || "";
    const next = [currentHref, ...recent.filter((href) => href && href !== currentHref)].slice(0, 4);
    try {
      window.sessionStorage.setItem(recentRoutesKey, JSON.stringify(next));
    } catch {
      // Navigation still works when browser storage is unavailable.
    }
    return previous;
  }

  function initialize() {
    markEligible();
    const previousRoute = rememberCurrentRoute();
    if (previousRoute) {
      const warmPrevious = () => window.setTimeout(() => void requestWarm(new URL(previousRoute)), 180);
      window.addEventListener("upos:workspace-warmed", warmPrevious, { once: true });
      window.setTimeout(warmPrevious, 1600);
    }

    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches?.("a[href]") && eligibleLink(node)) {
            node.dataset.instantNavigation = "1";
          }
          markEligible(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener("pointerover", (event) => {
      scheduleWarm(interactionTarget(event));
    }, { capture: true, passive: true });

    document.addEventListener("focusin", (event) => {
      scheduleWarm(interactionTarget(event), 0);
    }, { capture: true, passive: true });

    document.addEventListener("pointerdown", (event) => {
      const target = interactionTarget(event);
      window.clearTimeout(hoverTimer);
      void requestWarm(destination(target));
      showPending(target);
    }, { capture: true, passive: true });

    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const submitter = event.submitter || form.querySelector("[type='submit']");
        showPending(submitter || form);
      },
      true
    );
  }

  window.UPOSInstantNavigation = {
    warm: (value) => requestWarm(destination({ getAttribute: () => String(value || "") })),
    prerender: (value) => requestWarm(destination({ getAttribute: () => String(value || "") })),
  };

  if (document.prerendering) {
    document.addEventListener("prerenderingchange", initialize, { once: true });
  } else {
    initialize();
  }
})();
