const APP_URL = "https://app.u-pos.uz";
const MENU_ID = "upos-call-selected-number";
const ALARM_ID = "upos-softphone-reconnect";
let creatingOffscreen = null;

function selectedPhone(text) {
  const candidate = String(text || "").trim();
  if (!/^\+?[\d\s().-]{2,30}$/.test(candidate)) return "";
  const digits = candidate.replace(/\D/g, "");
  return digits.length >= 2 && digits.length <= 15
    ? (candidate.startsWith("+") ? "+" : "") + digits : "";
}

async function ensureOffscreen() {
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen.html")],
    });
    if (contexts.length) return;
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WEB_RTC", "USER_MEDIA"],
      justification: "Receive SIP calls and play call audio while the U-POS tab is closed",
    });
  })().finally(() => { creatingOffscreen = null; });
  return creatingOffscreen;
}

async function sendToPhone(command) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({target: "offscreen", ...command});
}

async function showPhoneWindow() {
  const url = chrome.runtime.getURL("popup.html");
  const windows = await chrome.windows.getAll({populate: true});
  const existing = windows.find((window) => window.tabs?.some((tab) => tab.url === url));
  if (existing) return chrome.windows.update(existing.id, {focused: true});
  return chrome.windows.create({url, type: "popup", width: 370, height: 560});
}

async function resumePhone() {
  const {session} = await chrome.storage.session.get("session");
  if (session?.account) await sendToPhone({type: "connect", session});
}

async function onPhoneState(state) {
  const previous = (await chrome.storage.session.get("phoneState")).phoneState || {};
  await chrome.storage.session.set({phoneState: state});
  const label = state.phase === "incoming" ? "!" : state.phase === "active" ? "●" : "";
  await chrome.action.setBadgeText({text: label});
  if (label) await chrome.action.setBadgeBackgroundColor({color: state.phase === "incoming" ? "#16a34a" : "#2563eb"});
  if (state.phase === "incoming" && previous.phase !== "incoming") {
    await chrome.notifications.create("upos-incoming", {
      type: "basic", iconUrl: chrome.runtime.getURL("icon.png"),
      title: "Входящий звонок U-POS", message: state.phone || "Неизвестный номер",
      buttons: [{title: "Принять"}, {title: "Отклонить"}], requireInteraction: true,
    }).catch(() => {});
    await showPhoneWindow().catch(() => {});
  } else if (previous.phase === "incoming" && state.phase !== "incoming") {
    await chrome.notifications.clear("upos-incoming");
  }
}

async function login(message) {
  const response = await fetch(`${APP_URL}/api/telephony/softphone/login`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({account_id: String(message.accountId || "").trim(),
      login: String(message.login || "").trim(), password: String(message.password || ""),
      device_id: String(message.deviceId || "").trim()}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok || !result.accounts?.length) {
    throw new Error(result.error === "bad_credentials" ? "Неверный аккаунт, логин или пароль SIP" : "Не удалось подключить SIP");
  }
  const raw = result.accounts[0];
  const account = {id: raw.id, host: raw.host, extension: raw.extension,
    auth_id: raw.auth_id, password: raw.password, realm: raw.realm,
    registrar_server: raw.registrar_server, display_name: raw.display_name,
    ws_url: raw.ws_url, sip_uri: `sip:${raw.extension}@${raw.host}`,
    register_expires: raw.expire_time || 300};
  if (!account.ws_url || !account.password) throw new Error("У линии нет SIP WebSocket или пароля");
  const session = {account, token: result.token, workspaceId: result.workspace_owner_id,
    label: raw.label || raw.extension, deviceId: String(message.deviceId || "")};
  await chrome.storage.session.set({session});
  await chrome.alarms.create(ALARM_ID, {periodInMinutes: 0.5});
  try {
    const connected = await sendToPhone({type: "connect", session});
    if (!connected?.ok) throw new Error(connected?.error || "SIP не зарегистрирован");
  } catch (error) {
    await chrome.storage.session.remove("session");
    await chrome.alarms.clear(ALARM_ID);
    throw error;
  }
  return {ok: true, label: session.label};
}

async function logout() {
  try { await sendToPhone({type: "disconnect"}); } catch (_) { /* Already stopped. */ }
  await chrome.storage.session.remove(["session", "phoneState"]);
  await chrome.alarms.clear(ALARM_ID);
  await chrome.action.setBadgeText({text: ""});
  await chrome.notifications.clear("upos-incoming");
  return {ok: true};
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.contextMenus.removeAll().then(() => {
    chrome.contextMenus.create({id: MENU_ID, title: "Позвонить через U-POS", contexts: ["selection"]});
  });
});
chrome.runtime.onStartup.addListener(() => { void resumePhone().catch(() => {}); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_ID) void resumePhone().catch(() => {});
});
chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (id === "upos-incoming") void sendToPhone({type: index === 0 ? "answer" : "reject"}).catch(() => {});
});
chrome.notifications.onClicked.addListener((id) => {
  if (id === "upos-incoming") void showPhoneWindow().catch(() => {});
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  const phone = selectedPhone(info.selectionText);
  if (!phone) return;
  const {session} = await chrome.storage.session.get("session");
  if (session?.account) {
    await sendToPhone({type: "dial", phone});
    await showPhoneWindow();
  } else {
    await chrome.tabs.create({url: `${APP_URL}/telephony?dial=${encodeURIComponent(phone)}`});
  }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "background") return;
  (async () => {
    if (message.type === "state") return onPhoneState(message.state || {}).then(() => ({ok: true}));
    if (message.type === "getState") {
      const stored = await chrome.storage.session.get(["session", "phoneState"]);
      return {ok: true, connected: Boolean(stored.session), label: stored.session?.label || "",
        state: stored.phoneState || {phase: "offline"}};
    }
    if (message.type === "login") return login(message);
    if (message.type === "logout") return logout();
    if (["dial", "answer", "reject", "redirect", "hangup", "dtmf"].includes(message.type)) return sendToPhone(message);
    return {ok: false, error: "unknown_action"};
  })().then(sendResponse, (error) => sendResponse({ok: false, error: error?.message || "Ошибка подключения"}));
  return true;
});
