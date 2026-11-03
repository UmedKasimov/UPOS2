(() => {
  "use strict";
  if (window.top !== window || document.getElementById("upos-chrome-phone-host")) return;

  const host = document.createElement("div");
  host.id = "upos-chrome-phone-host";
  for (const [name, value] of Object.entries({position: "fixed", "z-index": "2147483647",
    width: "52px", height: "52px", "pointer-events": "auto"})) {
    host.style.setProperty(name, value, "important");
  }
  const shadow = host.attachShadow({mode: "closed"});
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { cursor: pointer; font: 700 14px system-ui,sans-serif; }
    .toggle { display:grid;place-items:center;width:52px;height:52px;border:1px solid #66a5ff;
      border-radius:50%;background:#2467d6;color:white;font-size:25px;box-shadow:0 8px 24px #0008; }
    .toggle.incoming { background:#159c55;animation:ring .65s ease-in-out infinite alternate; }
    .toggle.offline { background:#343d4b;border-color:#687483; }
    @keyframes ring { from { transform:scale(.95); } to { transform:scale(1.08); } }
    .panel { position:absolute;width:min(400px,calc(100vw - 24px));height:min(650px,calc(100vh - 90px));
      overflow:hidden;border:1px solid #40516c;border-radius:16px;background:#101722;
      box-shadow:0 16px 48px #000b; }
    .panel[hidden] { display:none; }
    .bar { display:flex;align-items:center;gap:8px;height:38px;padding:0 10px;background:#1d2b3d;
      color:#dceaff;font:700 12px system-ui,sans-serif; }
    .bar span { flex:1; }
    .bar button { border:0;background:transparent;color:#dceaff;padding:4px 7px; }
    iframe { display:block;width:100%;height:calc(100% - 38px);border:0;background:#0c1018; }
    @media (prefers-reduced-motion:reduce) { .toggle.incoming { animation:none; } }
  `;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "toggle offline";
  toggle.title = "U-POS Телефон · перетащите для перемещения";
  toggle.setAttribute("aria-label", "Открыть U-POS Телефон");
  toggle.textContent = "☎";
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.hidden = true;
  const bar = document.createElement("div");
  bar.className = "bar";
  const title = document.createElement("span");
  title.textContent = "U-POS Телефон";
  const separate = document.createElement("button");
  separate.type = "button";
  separate.title = "Открыть отдельным окном";
  separate.textContent = "↗";
  const close = document.createElement("button");
  close.type = "button";
  close.title = "Свернуть";
  close.textContent = "×";
  bar.append(title, separate, close);
  panel.append(bar);
  shadow.append(style, toggle, panel);

  let position = {x: window.innerWidth - 68, y: window.innerHeight - 68};
  let expanded = false;
  let dragged = false;
  let pointerStart = null;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  function place() {
    position.x = clamp(position.x, 12, Math.max(12, window.innerWidth - 64));
    position.y = clamp(position.y, 12, Math.max(12, window.innerHeight - 64));
    host.style.setProperty("left", `${position.x}px`, "important");
    host.style.setProperty("top", `${position.y}px`, "important");
    const panelWidth = Math.min(400, window.innerWidth - 24);
    const aboveSpace = Math.max(120, position.y - 18);
    const belowSpace = Math.max(120, window.innerHeight - position.y - 76);
    const alignRight = position.x + panelWidth > window.innerWidth - 12;
    const above = aboveSpace >= belowSpace;
    panel.style.height = `${Math.min(650, above ? aboveSpace : belowSpace)}px`;
    panel.style.left = alignRight ? "auto" : "0";
    panel.style.right = alignRight ? "0" : "auto";
    panel.style.top = above ? "auto" : "58px";
    panel.style.bottom = above ? "58px" : "auto";
  }
  function setOpen(open) {
    expanded = Boolean(open);
    panel.hidden = !expanded;
    toggle.setAttribute("aria-expanded", String(expanded));
    if (expanded && !panel.querySelector("iframe")) {
      const frame = document.createElement("iframe");
      frame.title = "U-POS Телефон";
      frame.src = chrome.runtime.getURL("popup.html?embed=1");
      panel.append(frame);
    }
    if (!expanded) panel.querySelector("iframe")?.remove();
    place();
  }

  toggle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerStart = {x: event.clientX, y: event.clientY, left: position.x, top: position.y};
    dragged = false;
    toggle.setPointerCapture(event.pointerId);
  });
  toggle.addEventListener("pointermove", (event) => {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !dragged) return;
    dragged = true;
    position = {x: pointerStart.left + dx, y: pointerStart.top + dy};
    place();
  });
  toggle.addEventListener("pointerup", () => {
    pointerStart = null;
    if (dragged) void chrome.storage.local.set({overlayPosition: position});
  });
  toggle.addEventListener("click", () => {
    if (dragged) { dragged = false; return; }
    setOpen(!expanded);
  });
  close.addEventListener("click", () => setOpen(false));
  separate.addEventListener("click", () => {
    void chrome.runtime.sendMessage({target: "background", type: "openFallbackWindow"});
  });
  window.addEventListener("resize", place);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "upos:open-overlay") return;
    setOpen(true);
    sendResponse({ok: true});
  });

  document.documentElement.append(host);
  if (location.hostname === "app.u-pos.uz") {
    const siteStyle = document.createElement("style");
    siteStyle.textContent = 'html[data-upos-extension-phone="active"] .upos-floating-phone{display:none!important}';
    document.documentElement.append(siteStyle);
  }
  void chrome.storage.local.get("overlayPosition").then(({overlayPosition}) => {
    if (Number.isFinite(overlayPosition?.x) && Number.isFinite(overlayPosition?.y)) position = overlayPosition;
    place();
  });
  async function refreshState() {
    try {
      const result = await chrome.runtime.sendMessage({target: "background", type: "getState"});
      const phase = result?.state?.phase || "offline";
      toggle.classList.toggle("incoming", phase === "incoming");
      toggle.classList.toggle("offline", !result?.connected || ["offline", "error"].includes(phase));
      toggle.title = `U-POS Телефон · ${phase === "incoming" ? "входящий звонок" : result?.connected ? "на линии" : "отключён"}`;
      if (phase === "incoming" && !expanded) setOpen(true);
    } catch (_) { toggle.classList.add("offline"); }
  }
  void refreshState();
  window.setInterval(refreshState, 3000);
})();
