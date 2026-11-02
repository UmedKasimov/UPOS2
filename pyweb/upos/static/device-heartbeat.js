/* Keeps the authenticated device session fresh without loading settings UI. */
(() => {
  "use strict";

  const HEARTBEAT_KEY = "upos:device-heartbeat:last";

  function sendHeartbeat() {
    if (document.body?.getAttribute("data-device-heartbeat") !== "1") return;

    const now = Date.now();
    try {
      const lastHeartbeat = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
      if (now - lastHeartbeat < 45_000) return;
      localStorage.setItem(HEARTBEAT_KEY, String(now));
    } catch {
      /* Storage may be unavailable in private browsing. */
    }

    const meta = {
      language: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      platform: navigator.platform || "",
    };
    void fetch("/api/me/devices/heartbeat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_meta: meta }),
    }).catch(() => null);
  }

  function start() {
    sendHeartbeat();
    window.setInterval(sendHeartbeat, 60_000);
  }

  if (document.prerendering) {
    document.addEventListener("prerenderingchange", start, { once: true });
  } else {
    start();
  }
})();
