/* Warm every accessible workspace route after login and keep it warm. */
(() => {
  "use strict";

  const CACHEABLE_PATHS = new Set([
    "/", "/dashboard", "/finance", "/sales", "/products", "/warehouse",
    "/clients", "/crm", "/suppliers", "/telephony", "/messengers", "/reports",
    "/schet", "/kassa", "/settings", "/organizations", "/organizations/kassa",
    "/organizations/schet", "/organizations/reports", "/organizations/settings",
    "/organizations/users", "/organizations/shipments", "/shipments", "/earnings",
    "/employees",
  ]);
  const ROUTE_LABELS = {
    "/": "Главная", "/dashboard": "Дашборд", "/finance": "Финансы",
    "/sales": "Продажи", "/products": "Товары", "/warehouse": "Склад",
    "/clients": "Клиенты", "/crm": "CRM", "/suppliers": "Поставщики",
    "/telephony": "Телефония", "/messengers": "Мессенджеры", "/reports": "Отчёты",
    "/schet": "Счета", "/kassa": "Касса", "/settings": "Настройки",
    "/organizations": "Организации", "/organizations/kassa": "Касса",
    "/organizations/schet": "Счета", "/organizations/reports": "Отчёты",
    "/organizations/settings": "Настройки", "/organizations/users": "Сотрудники",
    "/organizations/shipments": "Доставка", "/shipments": "Доставка",
    "/earnings": "Начисления", "/employees": "Сотрудники",
  };
  const WARMUP_PRIORITY = new Map([
    ["/reports", 0],
    ["/warehouse", 1],
    ["/products", 2],
    ["/sales", 3],
    ["/clients", 4],
    ["/crm", 5],
    ["/finance", 6],
    ["/dashboard", 7],
    ["/telephony", 8],
    ["/messengers", 9],
    ["/settings", 10],
  ]);
  const TRANSIENT_PARAMS = new Set([
    "err", "error", "msg", "perf_refresh", "saved_id",
  ]);
  const REQUEST_TIMEOUT_MS = 25_000;
  const DONE_TTL_MS = 7 * 60 * 1000;
  const LOADING_TTL_MS = 35_000;
  const MIN_BLOCK_MS = 5_000;
  const MAX_BLOCK_MS = 10_000;
  const REFRESH_DELAY_MS = DONE_TTL_MS + 15_000;
  const inFlight = new Map();
  const warmedAssets = new Set();
  const root = document.documentElement;
  const runtimeVersion = (() => {
    try {
      return new URL(document.currentScript?.src || window.location.href).searchParams.get("v") || "0";
    } catch {
      return "0";
    }
  })();
  const cacheGeneration = root.dataset.uposCacheGeneration || "0";
  const sessionScope = root.dataset.uposSessionScope || document.body.dataset.userId || "workspace";
  const generalScope = window.location.pathname === "/organizations" ||
    window.location.pathname.startsWith("/organizations/");
  const routeScope = generalScope ? "general" : "workspace";
  const stateKey = `upos:page-warmup:v13:${runtimeVersion}:${sessionScope}:${routeScope}:${cacheGeneration}`;
  const readyKey = `upos:workspace-ready:v5:${runtimeVersion}:${sessionScope}:${routeScope}:${cacheGeneration}`;
  const connection = navigator.connection;
  const constrained = Boolean(
    connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "") ||
    /3g/.test(connection?.effectiveType || "") || Number(navigator.deviceMemory || 8) <= 4
  );
  const maxConcurrency = constrained ? 1 : 3;
  const navigationCacheKey = `${runtimeVersion}-${sessionScope}-${cacheGeneration}`;
  let rewarmTimer = 0;
  let warmupSuspendedUntil = 0;

  function clearWarmupState() {
    try {
      localStorage.removeItem(stateKey);
    } catch {
      /* Navigation caching still invalidates without sessionStorage. */
    }
  }

  function sendNavigationCacheConfig(timeoutMs = 2000) {
    const controller = navigator.serviceWorker?.controller;
    if (!controller || typeof MessageChannel !== "function") return Promise.resolve(false);
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        channel.port1.onmessage = null;
        resolve(value);
      };
      const timeout = window.setTimeout(() => finish(false), timeoutMs);
      channel.port1.onmessage = (event) => finish(Boolean(event.data?.ok));
      controller.postMessage({
        type: "UPOS_ROUTE_CACHE_CONFIG",
        key: navigationCacheKey,
      }, [channel.port2]);
    });
  }

  function waitForServiceWorkerController(timeoutMs = 2500) {
    if (navigator.serviceWorker?.controller) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
        resolve(value);
      };
      const onControllerChange = () => finish(Boolean(navigator.serviceWorker?.controller));
      navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);
      window.setTimeout(() => finish(Boolean(navigator.serviceWorker?.controller)), timeoutMs);
    });
  }

  async function setupNavigationCache() {
    if (!("serviceWorker" in navigator) || !sessionScope) return false;
    try {
      await navigator.serviceWorker.register(
        `/static/workspace-navigation-sw.js?v=10`,
        { scope: "/", updateViaCache: "none" }
      );
      await navigator.serviceWorker.ready;
      const controlled = await waitForServiceWorkerController();
      if (!controlled) return false;
      return await sendNavigationCacheConfig();
    } catch {
      return false;
    }
  }

  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type !== "UPOS_ROUTE_CACHE_INVALIDATED") return;
    clearWarmupState();
    window.clearTimeout(rewarmTimer);
    rewarmTimer = window.setTimeout(() => {
      void backgroundWarmup({ force: true, priority: "low" });
    }, 600);
  });

  function readJson(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Storage can be unavailable in hardened browser modes. */
    }
  }

  function storageValue(key) {
    try {
      return sessionStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function setStorageValue(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* The warmup still works without persisted client state. */
    }
  }

  function stateFresh(url) {
    const entry = readJson(stateKey)[url];
    if (!entry || !entry.at) return false;
    const ttl = entry.status === "done" ? DONE_TTL_MS : LOADING_TTL_MS;
    return Date.now() - Number(entry.at) < ttl;
  }

  function setState(url, status) {
    const state = readJson(stateKey);
    if (!status) delete state[url];
    else state[url] = { at: Date.now(), status };
    const cutoff = Date.now() - DONE_TTL_MS * 2;
    Object.keys(state).forEach((key) => {
      if (Number(state[key]?.at || 0) < cutoff) delete state[key];
    });
    writeJson(stateKey, state);
  }

  function canonicalUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin || !CACHEABLE_PATHS.has(url.pathname)) return null;
      TRANSIENT_PARAMS.forEach((name) => url.searchParams.delete(name));
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function canonicalLink(link) {
    return canonicalUrl(link?.href || "");
  }

  function canonicalRouteLink(link) {
    if (!link) return null;
    const baseHref = link.dataset.workspaceBaseHref || link.getAttribute("href") || link.href;
    try {
      const url = new URL(baseHref, window.location.href);
      if (url.origin !== window.location.origin || !CACHEABLE_PATHS.has(url.pathname)) return null;
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function accessibleUrls() {
    const selector = generalScope
      ? "a.nav-link[href], a.nav-sublink[href]"
      : "#app-sidebar a.nav-link[href], #app-sidebar a.nav-sublink[href]";
    const links = Array.from(document.querySelectorAll(selector));
    // Warm the stable module entry first, then the remembered working tab. This keeps
    // a stale client/document URL from delaying every other module at login while
    // preserving the existing "return to the last open tab" behavior.
    const urls = [
      ...links.map((link) => canonicalRouteLink(link)),
      ...links.map((link) => canonicalLink(link)),
    ].filter(Boolean);
    const current = canonicalUrl(window.location.href);
    return [...new Set(urls)]
      .filter((url) => url !== current)
      .sort((left, right) => {
        const leftUrl = new URL(left);
        const rightUrl = new URL(right);
        const leftPriority = WARMUP_PRIORITY.get(leftUrl.pathname) ?? 100;
        const rightPriority = WARMUP_PRIORITY.get(rightUrl.pathname) ?? 100;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        if (leftUrl.pathname !== rightUrl.pathname) {
          return leftUrl.pathname.localeCompare(rightUrl.pathname);
        }
        return leftUrl.search.length - rightUrl.search.length;
      });
  }

  function assetUrls(html, pageUrl) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return Array.from(parsed.querySelectorAll('link[rel="stylesheet"][href], script[src]'))
      .map((node) => node.getAttribute("href") || node.getAttribute("src") || "")
      .map((value) => {
        try {
          return new URL(value, pageUrl).toString();
        } catch {
          return "";
        }
      })
      .filter((value) => value.startsWith(`${window.location.origin}/static/`));
  }

  async function warmAsset(url) {
    if (!url || warmedAssets.has(url)) return;
    warmedAssets.add(url);
    try {
      await fetch(url, { cache: "force-cache", credentials: "same-origin", priority: "low" });
    } catch {
      warmedAssets.delete(url);
    }
  }

  function warm(url, options = {}) {
    const { force = false, priority = "low" } = options;
    if (!url || (!force && stateFresh(url))) return Promise.resolve(true);
    const existing = inFlight.get(url);
    if (existing) {
      if (priority === "high" && existing.priority !== "high") {
        existing.controller.abort();
        inFlight.delete(url);
        setState(url, "");
      } else {
        return existing.promise;
      }
    }

    const controller = new AbortController();
    let entry = null;
    const task = (async () => {
      setState(url, "loading");
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          cache: force ? "reload" : "default",
          credentials: "same-origin",
          headers: { Accept: "text/html", "X-UPOS-Prefetch": "1" },
          priority,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Warmup failed: ${response.status}`);
        const requestedUrl = new URL(url);
        const finalUrl = new URL(response.url, window.location.href);
        if (response.redirected && finalUrl.pathname !== requestedUrl.pathname) {
          throw new Error(`Warmup redirected to ${finalUrl.pathname}`);
        }
        const html = await response.text();
        await Promise.all(assetUrls(html, url).map(warmAsset));
        if (inFlight.get(url) === entry) setState(url, "done");
        return true;
      } catch {
        if (inFlight.get(url) === entry) setState(url, "");
        return false;
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    entry = { controller, priority, promise: task };
    inFlight.set(url, entry);
    task.finally(() => {
      if (inFlight.get(url) === entry) inFlight.delete(url);
    });
    return task;
  }

  async function warmQueue(urls, options = {}) {
    const unique = [...new Set(urls)].filter(Boolean);
    let cursor = 0;
    let completed = 0;
    let succeeded = 0;

    async function worker() {
      while (cursor < unique.length) {
        if (options.priority !== "high" && Date.now() < warmupSuspendedUntil) {
          await delay(Math.min(2500, warmupSuspendedUntil - Date.now()));
        }
        const index = cursor;
        cursor += 1;
        const url = unique[index];
        options.onStart?.(url, index, unique.length);
        const ok = await warm(url, options);
        completed += 1;
        if (ok) succeeded += 1;
        options.onProgress?.({ completed, succeeded, total: unique.length, url, ok });
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(maxConcurrency, Math.max(1, unique.length)) }, worker)
    );
    return { completed, succeeded, total: unique.length };
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function idle(callback, timeout = 1200) {
    if ("requestIdleCallback" in window) window.requestIdleCallback(callback, { timeout });
    else window.setTimeout(callback, Math.min(timeout, 500));
  }

  function createOverlay(total) {
    const overlay = document.createElement("div");
    overlay.className = "workspace-warmup";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <section class="workspace-warmup-panel">
        <div class="workspace-warmup-brand">UPOS</div>
        <h1>Загружается рабочее пространство</h1>
        <p data-workspace-warmup-status>Подготавливаем основные разделы</p>
        <div class="workspace-warmup-track" aria-hidden="true">
          <span data-workspace-warmup-progress></span>
        </div>
        <small data-workspace-warmup-count>0 из ${total}</small>
      </section>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    return overlay;
  }

  function updateOverlay(overlay, payload) {
    if (!overlay) return;
    const total = Math.max(1, payload.total);
    const percent = Math.min(100, Math.round((payload.completed / total) * 100));
    const path = payload.url ? new URL(payload.url).pathname : "";
    const label = ROUTE_LABELS[path] || "Рабочее пространство";
    const status = overlay.querySelector("[data-workspace-warmup-status]");
    const progress = overlay.querySelector("[data-workspace-warmup-progress]");
    const count = overlay.querySelector("[data-workspace-warmup-count]");
    if (status) status.textContent = payload.completed >= payload.total
      ? "Рабочее пространство готово" : `Подготавливаем: ${label}`;
    if (progress) progress.style.width = `${percent}%`;
    if (count) count.textContent = `${payload.completed} из ${payload.total}`;
  }

  async function blockingWarmup(urls) {
    const overlay = createOverlay(urls.length);
    const startedAt = performance.now();
    const queue = warmQueue(urls, {
      priority: "high",
      onStart: (url, index, total) => updateOverlay(overlay, { completed: index, total, url }),
      onProgress: (payload) => updateOverlay(overlay, payload),
    });
    const completedQueue = queue.then((result) => {
      if (result.succeeded === result.total) setStorageValue(readyKey, "1");
      window.dispatchEvent(new CustomEvent("upos:workspace-warmed", {
        detail: {
          ...result,
          durationMs: Math.round(performance.now() - startedAt),
        },
      }));
      return result;
    });
    await Promise.race([
      Promise.all([completedQueue, delay(MIN_BLOCK_MS)]),
      delay(MAX_BLOCK_MS),
    ]);
    overlay.classList.remove("is-visible");
    window.setTimeout(() => overlay.remove(), 220);
    void completedQueue;
  }

  function backgroundWarmup(options = {}) {
    const urls = accessibleUrls();
    if (!urls.length) return Promise.resolve({ completed: 0, succeeded: 0, total: 0 });
    return warmQueue(urls, options);
  }

  function prioritizeUserNavigation() {
    warmupSuspendedUntil = Date.now() + 3000;
    inFlight.forEach((entry, url) => {
      if (entry.priority === "high") return;
      entry.controller.abort();
      inFlight.delete(url);
      setState(url, "");
    });
  }

  function scheduleRefresh() {
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        void backgroundWarmup({ force: true, priority: "low" });
      }
      scheduleRefresh();
    }, REFRESH_DELAY_MS);
  }

  ["pointerover", "focusin"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      const link = event.target.closest?.("a[href]");
      const url = canonicalLink(link);
      if (url) void warm(url, { priority: "auto" });
    }, { capture: true, passive: true });
  });

  document.addEventListener("pointerdown", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!canonicalLink(link)) return;
    prioritizeUserNavigation();
  }, { capture: true, passive: true });

  document.addEventListener("submit", prioritizeUserNavigation, { capture: true });

  async function start() {
    const urls = accessibleUrls();
    // A ready marker belongs to one concrete app bundle/runtime version. Rebuilds
    // must perform one genuine warmup even when the server-side login flag was
    // already consumed by an older page in the same authenticated session.
    const requiresBlocking = storageValue(readyKey) !== "1";
    await setupNavigationCache();
    if (requiresBlocking) await blockingWarmup(urls);
    else if (!connection?.saveData) idle(() => void backgroundWarmup(), 300);
    scheduleRefresh();
  }

  window.UPOSWorkspaceWarmup = {
    refresh: () => backgroundWarmup({ force: true, priority: "high" }),
    warm: (value) => warm(canonicalUrl(value), { priority: "high" }),
  };

  if (document.prerendering) {
    document.addEventListener("prerenderingchange", () => void start(), { once: true });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void start(), { once: true });
  } else {
    void start();
  }
})();
