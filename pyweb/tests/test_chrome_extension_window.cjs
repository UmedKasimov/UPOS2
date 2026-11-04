const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../upos/chrome_extension/background.js"), "utf8");

function phoneBackground() {
  const created = [];
  const updated = [];
  const notifications = [];
  const windows = [];
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
      create: async (options) => {
        created.push(options);
        const window = {id: created.length, type: "popup", tabs: [{url: options.url}]};
        windows.push(window);
        return window;
      },
      update: async (id, options) => { updated.push({id, options}); return windows.find((window) => window.id === id); },
    },
    storage: {session: {get: async (keys) => {
      if (typeof keys === "string") return {[keys]: stored[keys]};
      return Object.fromEntries(keys.map((key) => [key, stored[key]]));
    }, set: async (value) => Object.assign(stored, value)}},
    tabs: {query: async () => []},
    notifications: {create: async (id) => { notifications.push(id); }, clear: async () => {} ,
      onButtonClicked: event("notificationButton"), onClicked: event("notificationClick")},
    contextMenus: {onClicked: event("contextMenu"), removeAll: async () => {}, create: () => {}},
    alarms: {onAlarm: event("alarm")},
  };
  const context = vm.createContext({chrome, setTimeout, clearTimeout, crypto: globalThis.crypto});
  vm.runInContext(script, context);
  return {context, created, updated, notifications, stored, listeners};
}

test("incoming call opens one dedicated phone window and focuses the same window again", async () => {
  const app = phoneBackground();
  await vm.runInContext("Promise.all([openStandaloneWindow(), openStandaloneWindow()])", app.context);
  assert.equal(app.created.length, 1);
  assert.match(app.created[0].url, /popup\.html\?setup=1$/);
  await vm.runInContext("openStandaloneWindow()", app.context);
  assert.equal(app.created.length, 1);
  assert.equal(app.updated.length, 1);
  await vm.runInContext("onPhoneState({phase: 'incoming', phone: '210'})", app.context);
  assert.equal(app.notifications.length, 1);
  assert.equal(app.created.length, 1);
  assert.equal(app.updated.length, 2);
});
