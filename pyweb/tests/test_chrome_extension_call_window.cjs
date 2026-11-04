const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const folder = path.join(__dirname, "../upos/chrome_extension");
const html = fs.readFileSync(path.join(folder, "call.html"), "utf8");
const script = fs.readFileSync(path.join(folder, "call.js"), "utf8");

function callWindow(client) {
  const elements = new Map();
  const tabs = [];
  const messages = [];
  let microphoneRequests = 0;
  let phoneState = {phase: "incoming", phone: "997390521", answeredAt: 0};
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
    elements.set(id, {
      hidden: false, disabled: false, textContent: "", value: "", title: "", listeners: {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute(name, value) { this[name] = value; },
      querySelector() { return {disabled: false}; },
      append() {}, focus() {},
      click() { return this.listeners.click?.(); },
    });
  }
  const card = {dataset: {}};
  const document = {
    getElementById(id) { return elements.get(id); },
    querySelector(selector) { return selector === ".card" ? card : null; },
    createElement() { return {type: "", textContent: "", addEventListener() {}}; },
  };
  const chrome = {
    runtime: {sendMessage: async (message) => {
      messages.push(message);
      if (message.type === "getState") return {ok: true, state: phoneState};
      if (message.type === "answer") {
        phoneState = {...phoneState, phase: "active", answeredAt: Date.now() - 3100};
      }
      return {ok: true};
    }},
    storage: {local: {get: async () => ({transferTargets: []})}},
    tabs: {create: async (options) => { tabs.push(options.url); }},
  };
  const fetch = async () => ({ok: true, status: 200, json: async () => ({ok: true, client})});
  const navigator = {mediaDevices: {getUserMedia: async () => {
    microphoneRequests += 1;
    return {getTracks: () => [{stop() {}}]};
  }}};
  const context = vm.createContext({document, chrome, fetch, navigator, window: {close() {}},
    URL, setInterval() {}, Date, console});
  vm.runInContext(script, context);
  return {context, elements, card, tabs, messages, get microphoneRequests() { return microphoneRequests; }};
}

test("answer stays in the compact window, starts timer and avoids duplicate placeholder number", async () => {
  const app = callWindow({name: "Контакт +997390521", href: "/clients?client=123#client-card"});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.elements.get("caller").textContent, "997390521");
  assert.equal(app.elements.get("phone").hidden, true);
  await app.elements.get("answer").click();
  assert.equal(app.microphoneRequests, 1);
  assert.equal(app.card.dataset.phase, "active");
  assert.equal(app.elements.get("timer").hidden, false);
  assert.match(app.elements.get("timer").textContent, /^00:0[3-9]$/);
  assert.equal(app.elements.get("active-actions").hidden, false);
  assert.equal(app.messages.find((item) => item.type === "answer").target, "background");
  await app.elements.get("caller").click();
  assert.deepEqual(app.tabs, ["https://app.u-pos.uz/clients?client=123#history"]);
});

test("unknown caller opens the contact form from the number", async () => {
  const app = callWindow(null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.elements.get("caller").textContent, "997390521");
  assert.equal(app.elements.get("show-contact").hidden, false);
  await app.elements.get("caller").click();
  assert.equal(app.elements.get("contact-form").hidden, false);
  assert.equal(app.elements.get("contact-phone").value, "997390521");
  assert.deepEqual(app.tabs, []);
});
