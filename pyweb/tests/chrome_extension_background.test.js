const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const data = {};
const notifications = [];
const openedWindows = [];
const forwarded = [];
let offscreenCreated = false;
let listener;
let fetched;
const event = () => ({addListener(fn) { return fn; }});
const chrome = {
  runtime: {
    getURL: (name) => `chrome-extension://test/${name}`,
    getContexts: async () => offscreenCreated ? [{}] : [],
    sendMessage: async (message) => {
      forwarded.push(message);
      return message.target === "offscreen" ? {ok: true} : null;
    },
    onMessage: {addListener(fn) { listener = fn; }},
    onInstalled: event(), onStartup: event(),
  },
  offscreen: {async createDocument(options) {
    assert.deepEqual(Array.from(options.reasons), ["WEB_RTC", "USER_MEDIA"]);
    offscreenCreated = true;
  }},
  storage: {
    session: {
      async get(keys) {
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = data[key];
        return result;
      },
      async set(values) { Object.assign(data, values); },
      async remove(keys) { for (const key of keys) delete data[key]; },
    },
  },
  action: {onClicked: event(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}},
  alarms: {create: async () => {}, clear: async () => {}, onAlarm: event()},
  notifications: {
    async create(id, options) { notifications.push({id, options}); },
    clear: async () => {}, onButtonClicked: event(), onClicked: event(),
  },
  contextMenus: {create: () => {}, onClicked: event()},
  windows: {getAll: async () => openedWindows, update: async () => {},
    create: async (options) => {
      const result = {id: openedWindows.length + 1, type: options.type, tabs: [{url: options.url}]};
      openedWindows.push(result);
      return result;
    }},
  tabs: {query: async () => [], create: async () => {}},
};
const source = fs.readFileSync(path.join(__dirname, "../upos/chrome_extension/background.js"), "utf8");
vm.runInNewContext(source, {chrome, setTimeout, clearTimeout, crypto: globalThis.crypto, fetch: async (url, options) => {
  fetched = {url, body: JSON.parse(options.body)};
  return {ok: true, json: async () => ({ok: true, token: "sensitive-token", workspace_owner_id: "workspace",
    accounts: [{id: "line-210", host: "sip.example", extension: "210", password: "sip-secret",
      ws_url: "wss://sip.example/ws", label: "Line 210"}]})};
}});
function message(type, extra = {}) {
  return new Promise((resolve) => listener({target: "background", type, ...extra}, {}, resolve));
}

(async () => {
  const connected = await message("login", {accountId: "ORG", login: "210", password: "password", deviceId: "device"});
  if (!connected.ok) throw new Error(connected.error);
  assert.equal(connected.ok, true);
  assert.equal(fetched.url, "https://app.u-pos.uz/api/telephony/softphone/login");
  assert.equal(fetched.body.account_id, "ORG");
  assert.equal(data.session.account.extension, "210");
  assert.equal(offscreenCreated, true);
  const state = await message("getState");
  assert.equal(state.connected, true);
  assert.equal(JSON.stringify(state).includes("sensitive-token"), false);
  await message("state", {state: {phase: "incoming", phone: "998557016060"}});
  assert.equal(notifications[0].options.buttons.length, 2);
  assert.equal(openedWindows.length, 1);
  assert.equal(openedWindows[0].tabs[0].url, "chrome-extension://test/call.html");
  assert.equal((await message("answer")).ok, true);
  assert.equal(forwarded.at(-1).target, "offscreen");
  assert.equal(forwarded.at(-1).type, "answer");
  assert.equal((await message("reject")).ok, true);
  assert.equal(forwarded.at(-1).target, "offscreen");
  assert.equal((await message("transfer", {phone: "220"})).ok, true);
  assert.equal(forwarded.at(-1).target, "offscreen");
  assert.equal(forwarded.at(-1).phone, "220");
  await message("logout");
  assert.equal(data.session, undefined);
  console.log("Chrome background flow OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
