chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "upos:phone:dial") return;
  const phone = String(message.phone || "");
  if (!/^\+?\d{2,15}$/.test(phone)) {
    sendResponse({ok: false});
    return;
  }
  window.dispatchEvent(new CustomEvent("upos:phone:dial", {detail: {phone}}));
  sendResponse({ok: true});
});
