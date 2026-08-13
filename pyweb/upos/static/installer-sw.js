const INSTALLER_BUILD = "32";
const CACHE_NAME = `upos-installer-v${INSTALLER_BUILD}`;
const APP_SHELL = [
  `/installer?pwa_v=${INSTALLER_BUILD}`,
  "/static/installer.css?v=32",
  "/static/installer.js?v=32",
  "/static/installer-softphone.js?v=12",
  "/static/jssip.min.js?v=1",
  "/static/installer-manifest.webmanifest",
  "/static/favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async (path) => {
      try {
        const response = await fetch(path, {cache: "reload"});
        if (response.ok) await cache.put(path, response);
      } catch (_error) {
        // A transient asset failure must not prevent the update from activating.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("upos-installer-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();

    // Existing Android installations can keep the old document open for days.
    // Reload installer windows once when this worker activates so the versioned
    // softphone code reaches the device without clearing application data.
    const clients = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    await Promise.all(clients.map((client) => {
      const url = new URL(client.url);
      if (url.origin !== self.location.origin || url.pathname !== "/installer") return null;
      client.postMessage({type: "UPOS_INSTALLER_UPDATE", build: INSTALLER_BUILD});
      if (url.searchParams.get("pwa_v") === INSTALLER_BUILD) return null;
      url.searchParams.set("pwa_v", INSTALLER_BUILD);
      return client.navigate(url.href).catch(() => null);
    }));
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {body: event.data ? event.data.text() : ""};
  }
  const title = payload.title || "U-POS Integrator";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/static/installer-icon-192.png",
      badge: "/static/installer-icon-192.png",
      tag: payload.tag || undefined,
      renotify: Boolean(payload.tag),
      data: {url: payload.url || "/installer"}
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/installer";
  event.waitUntil(
    self.clients.matchAll({type: "window", includeUncontrolled: true}).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/installer") && "focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/installer/")) {
    event.respondWith(fetch(event.request, {cache: "no-store"}));
    return;
  }

  event.respondWith(
    fetch(event.request, {cache: "no-store"})
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(
        (cached) => cached || caches.match(`/installer?pwa_v=${INSTALLER_BUILD}`)
      ))
  );
});
