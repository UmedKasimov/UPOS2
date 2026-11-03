(() => {
  "use strict";

  function report(active) {
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", () => report(active), {once: true});
      return;
    }
    document.documentElement.dataset.uposExtensionPhone = active ? "active" : "inactive";
    window.dispatchEvent(new Event("upos:extension-phone-status"));
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "upos:extension-phone-status") report(Boolean(message.active));
  });

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin
      || data?.source !== "upos-site" || data?.type !== "extension-dial") return;
    const phone = String(data.phone || "");
    if (!/^\+?\d{2,15}$/.test(phone)) return;
    let response;
    try {
      response = await chrome.runtime.sendMessage({target: "background", type: "dial", phone});
    } catch (error) {
      response = {ok: false, error: error?.message || "Расширение недоступно"};
    }
    window.postMessage({source: "upos-extension", type: "extension-dial-result",
      requestId: data.requestId, ok: Boolean(response?.ok), error: response?.error || ""}, location.origin);
  });

  void chrome.runtime.sendMessage({target: "background", type: "getState"}).then((result) => {
    report(Boolean(result?.handoff || (result?.connected &&
      ["ready", "incoming", "dialing", "active"].includes(result.state?.phase))));
  }).catch(() => report(false));
})();
