(() => {
  const root = document.querySelector("[data-callfab]");
  if (!root) return;
  const btn = root.querySelector("[data-callfab-toggle]");
  const panel = root.querySelector("[data-callfab-panel]");
  const input = root.querySelector("[data-callfab-input]");
  const dialpad = root.querySelector("[data-callfab-dialpad]");
  const callBtn = root.querySelector("[data-callfab-call]");
  const closeBtn = root.querySelector("[data-callfab-close]");
  if (!btn || !panel || !input) return;
  let csrf = "";

  function ensureCsrf() {
    if (csrf) return;
    fetch("/api/csrf-token", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((d) => { csrf = (d && d.csrf_token) || ""; })
      .catch(() => {});
  }

  function open() {
    panel.hidden = false;
    root.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
    ensureCsrf();
    input.focus();
  }
  function close() {
    panel.hidden = true;
    root.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (panel.hidden) open();
    else close();
  });
  if (closeBtn) closeBtn.addEventListener("click", close);
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  if (dialpad) {
    dialpad.addEventListener("click", (event) => {
      const key = event.target.closest(".upos-callfab-key");
      if (!key) return;
      input.value += key.textContent.trim();
      input.focus();
    });
  }

  function doCall() {
    const phone = String(input.value || "").trim();
    if (!phone) { input.focus(); return; }
    const body = new URLSearchParams();
    body.set("csrf_token", csrf);
    body.set("phone", phone);
    fetch("/api/telephony/click-to-call", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(),
      keepalive: true,
    }).catch(() => {});
    window.location.href = "tel:" + phone.replace(/[^\d+]/g, "");
  }

  if (callBtn) callBtn.addEventListener("click", doCall);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); doCall(); }
  });
})();
