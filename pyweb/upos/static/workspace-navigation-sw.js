/* Session-scoped navigation cache for warmed UPOS workspace routes. */
"use strict";

const CACHE_PREFIX = "upos-navigation-v8-";
const META_CACHE = "upos-navigation-meta-v8";
const META_REQUEST = new Request(`${self.location.origin}/__upos-navigation-cache__/active`);
const MAX_CACHED_ROUTES = 48;
const REVALIDATE_AFTER_MS = 45_000;
const CACHEABLE_PATHS = new Set([
  "/", "/dashboard", "/finance", "/sales", "/products", "/warehouse",
  "/clients", "/crm", "/suppliers", "/telephony", "/messengers", "/reports",
  "/schet", "/kassa", "/settings", "/organizations", "/organizations/kassa",
  "/organizations/schet", "/organizations/reports", "/organizations/settings",
  "/organizations/users", "/organizations/shipments", "/shipments", "/earnings",
  "/employees",
]);
const TRANSIENT_PARAMS = new Set([
  "err", "error", "msg", "perf_refresh", "saved_id",
]);
const QUIET_MUTATIONS = new Set([
  "/api/me/devices/heartbeat",
  "/api/messengers/threads/read",
  "/api/messengers/telegram/send",
  "/api/messengers/instagram/send",
  "/api/messengers/site/send",
  "/api/telephony/incoming-call",
  "/api/telephony/recordings/upload",
  "/api/telephony/softphone/login",
]);

let activeCacheName = "";
let activeCachePromise = null;

function safeCacheKey(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function canonicalRouteRequest(value) {
  let url;
  try {
    url = new URL(typeof value === "string" ? value : value.url, self.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== self.location.origin || !CACHEABLE_PATHS.has(url.pathname)) return null;
  if ([...TRANSIENT_PARAMS].some((name) => url.searchParams.has(name))) return null;
  url.hash = "";
  return new Request(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "text/html" },
  });
}

async function routeCacheNames() {
  return (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
}

async function persistActiveCacheName(name) {
  const cache = await caches.open(META_CACHE);
  await cache.put(META_REQUEST, new Response(name || "", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }));
}

async function loadActiveCacheName() {
  if (activeCacheName) return activeCacheName;
  if (!activeCachePromise) {
    activeCachePromise = (async () => {
      const cache = await caches.open(META_CACHE);
      const response = await cache.match(META_REQUEST);
      const stored = response ? await response.text() : "";
      activeCacheName = stored.startsWith(CACHE_PREFIX) ? stored : "";
      return activeCacheName;
    })().finally(() => {
      activeCachePromise = null;
    });
  }
  return activeCachePromise;
}

async function deleteRouteCaches(keep = "") {
  const names = await routeCacheNames();
  await Promise.all(names.filter((name) => name !== keep).map((name) => caches.delete(name)));
}

async function notifyCacheInvalidated() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: "UPOS_ROUTE_CACHE_INVALIDATED" }));
}

async function clearNavigationCache() {
  activeCacheName = "";
  activeCachePromise = null;
  await Promise.all([
    deleteRouteCaches(),
    caches.delete(META_CACHE),
  ]);
  await notifyCacheInvalidated();
}

async function invalidateNavigationCache() {
  const cacheName = await loadActiveCacheName();
  if (cacheName) await caches.delete(cacheName);
  await notifyCacheInvalidated();
}

async function configureNavigationCache(key) {
  const safeKey = safeCacheKey(key);
  if (!safeKey) {
    await clearNavigationCache();
    return;
  }
  const nextName = `${CACHE_PREFIX}${safeKey}`;
  activeCacheName = nextName;
  activeCachePromise = null;
  await Promise.all([
    persistActiveCacheName(nextName),
    deleteRouteCaches(nextName),
  ]);
}

async function cacheableCopy(response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set("X-UPOS-Navigation-Cached-At", String(Date.now()));
  return new Response(await response.clone().arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function responseCanBeCached(response, requestedUrl) {
  if (!response || !response.ok) return false;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html")) return false;
  try {
    return new URL(response.url).pathname === new URL(requestedUrl).pathname;
  } catch {
    return false;
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_CACHED_ROUTES;
  if (overflow > 0) {
    await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
  }
}

async function fetchAndStore(networkRequest, cacheRequest, cacheName) {
  const response = await fetch(networkRequest);
  if (!responseCanBeCached(response, cacheRequest.url)) return response;
  const cache = await caches.open(cacheName);
  await cache.put(cacheRequest, await cacheableCopy(response));
  await trimCache(cache);
  return response;
}

async function serveNavigation(event, cacheRequest, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(cacheRequest);
  if (cached) {
    const cachedAt = Number(cached.headers.get("X-UPOS-Navigation-Cached-At") || 0);
    if (!cachedAt || Date.now() - cachedAt >= REVALIDATE_AFTER_MS) {
      event.waitUntil(
        fetchAndStore(event.request, cacheRequest, cacheName).catch(() => undefined)
      );
    }
    return cached;
  }
  return fetchAndStore(event.request, cacheRequest, cacheName);
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await clearNavigationCache();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "UPOS_ROUTE_CACHE_CONFIG") {
    event.waitUntil((async () => {
      await configureNavigationCache(data.key);
      event.ports[0]?.postMessage({ ok: true });
    })());
  } else if (data.type === "UPOS_ROUTE_CACHE_CLEAR") {
    event.waitUntil((async () => {
      await clearNavigationCache();
      event.ports[0]?.postMessage({ ok: true });
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) {
    event.respondWith((async () => {
      await clearNavigationCache();
      return fetch(request);
    })());
    return;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (!QUIET_MUTATIONS.has(url.pathname)) {
      event.respondWith((async () => {
        await invalidateNavigationCache();
        return fetch(request);
      })());
    }
    return;
  }

  const isWarmup = request.headers.get("X-UPOS-Prefetch") === "1";
  const isNavigation = request.mode === "navigate";
  if (!isWarmup && !isNavigation) return;

  const cacheRequest = canonicalRouteRequest(request);
  if (!cacheRequest) return;

  event.respondWith((async () => {
    const cacheName = await loadActiveCacheName();
    if (!cacheName) return fetch(request);
    if (isNavigation) return serveNavigation(event, cacheRequest, cacheName);
    return fetchAndStore(request, cacheRequest, cacheName);
  })());
});
