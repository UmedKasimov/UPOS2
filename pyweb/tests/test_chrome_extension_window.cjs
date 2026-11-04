const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../upos/chrome_extension/background.js"), "utf8");

function phoneBackground() {
  const created = [];
  const updated = [];
  const createdTabs = [];
  const updatedTabs = [];
  const notifications = [];
  const windows = [{id: 10, type: "normal", tabs: []}];
  const tabs = [];
  const stored = {phoneState: {phase: "ready"}};
  const listeners = {};
  const event = (name) => ({addListener(callback) { listeners[name] = callback; }});
  const chrome = {
    runtime: {getURL: (file) => `chrome-extension://test/${file}`, onInstalled: event("installed"),
      onStartup: event("startup"), onMessage: event("message")},
    action: {onClicked: event("action"), setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {}},
    windows: {
      getAll: async () => windows,
      getLastFocused: async () => windows.find((window) => window.type === "normal"),
      create: async (options) => {
        created.push(options);
        const window = {id: 10 + created.length, type: options.type, tabs: [{url: options.url}]};
        windows.push(window);
        return window;
      },
      update: async (id, options) => { updated.push({id, options}); return windows.find((window) => window.id === id); },
    },
    storage: {local: {get: async () => ({incomingSurface: stored.incomingSurface})}, session: {get: async (keys) => {
      if (typeof keys === "string") return {[keys]: stored[keys]};
      return Object.fromEntries(keys.map((key) => [key, stored[key]]));
    }, set: async (value) => Object.assign(stored, value)}},
    tabs: {query: async (query) => query?.url ? [] : tabs,
      create: async (options) => {
        createdTabs.push(options);
        const tab = {id: 100 + createdTabs.length, windowId: options.windowId, url: options.url};
        tabs.push(tab);
        return tab;
      },
      update: async (id, options) => { updatedTabs.push({id, options}); return tabs.find((tab) => tab.id === id); }},
    notifications: {create: async (id) => { notifications.push(id); }, clear: async () => {} ,
      onButtonClicked: event("notificationButton"), onClicked: event("notificationClick")},
    contextMenus: {onClicked: event("contextMenu"), removeAll: async () => {}, create: () => {}},
    alarms: {onAlarm: event("alarm")},
  };
  const context = vm.createContext({chrome, setTimeout, clearTimeout, crypto: globalThis.crypto});
  vm.runInContext(script, context);
  return {context, created, updated, createdTabs, updatedTabs, notifications, stored, listeners};
}

test("incoming call opens its own compact popup beside the existing phone", async () => {
  const app = phoneBackground();
  await vm.runInContext("Promise.all([openStandaloneWindow(), openStandaloneWindow()])", app.context);
  assert.equal(app.created.length, 1);
  assert.match(app.created[0].url, /popup\.html\?setup=1$/);
  await vm.runInContext("onPhoneState({phase: 'incoming', phone: '210'})", app.context);
  assert.equal(app.notifications.length, 1);
  assert.equal(app.created.length, 2);
  assert.match(app.created[1].url, /call\.html$/);
  assert.equal(app.created[1].type, "popup");
  assert.equal(app.createdTabs.length, 0);
});

test("repeated incoming events focus the same call popup", async () => {
  const app = phoneBackground();
  await vm.runInContext("onPhoneState({phase: 'incoming', phone: '210'})", app.context);
  await vm.runInContext("Promise.all([openIncomingWindow(), openIncomingWindow()])", app.context);
  assert.equal(app.created.length, 1);
  assert.equal(app.updated.length, 1);
  assert.equal(app.updated[0].id, 11);
  assert.equal(app.createdTabs.length, 0);
});
