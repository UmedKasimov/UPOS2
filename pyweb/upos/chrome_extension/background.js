const MENU_ID = "upos-call-selected-number";
const APP_URL = "https://app.u-pos.uz/telephony";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Позвонить через U-POS",
    contexts: ["selection"],
  });
});

function selectedPhone(text) {
  const candidate = String(text || "").trim();
  if (!/^\+?[\d\s().-]{2,30}$/.test(candidate)) return "";
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 2 || digits.length > 15) return "";
  return (candidate.startsWith("+") ? "+" : "") + digits;
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  const phone = selectedPhone(info.selectionText);
  if (!phone) return;
  const tabs = await chrome.tabs.query({url: "https://app.u-pos.uz/*"});
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {type: "upos:phone:dial", phone});
      if (response?.ok) {
        if (tab.windowId) await chrome.windows.update(tab.windowId, {focused: true});
        await chrome.tabs.update(tab.id, {active: true});
        return;
      }
    } catch (_) {
      // The existing tab may predate installation of the extension.
    }
  }
  await chrome.tabs.create({url: `${APP_URL}?dial=${encodeURIComponent(phone)}`});
});
