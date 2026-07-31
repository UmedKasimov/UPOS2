const CACHE_NAME = "upos-installer-v9";
// Версии совпадают с installer.html: иначе в кэш кладётся URL, который страница
// никогда не запрашивает, и предзагрузка не работает.
const APP_SHELL = [
  "/installer",
  "/static/installer.css?v=9",
  "/static/installer.js?v=8",
  "/static/installer-manifest.webmanifest",
  "/static/favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "U-POS Установщик";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/static/installer-icon-192.png",
      badge: "/static/installer-icon-192.png",
      // tag схлопывает повторные уведомления об одном и том же заказе.
      tag: payload.tag || undefined,
      renotify: Boolean(payload.tag),
      data: { url: payload.url || "/installer" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/installer";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Если приложение уже открыто — фокусируем его, а не плодим вкладки.
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
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/installer")))
  );
});
