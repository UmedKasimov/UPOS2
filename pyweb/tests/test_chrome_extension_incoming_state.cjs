const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("incoming progress keeps answer state and missed call replaces ringing message", () => {
  const handlers = {};
  const published = [];
  const softphone = {
    on(name, callback) { handlers[name] = callback; },
    isRegistered() { return true; },
  };
  const chrome = {runtime: {
    onMessage: {addListener() {}},
    sendMessage: async (message) => { published.push(message.state); return {ok: true}; },
  }};
  const file = path.join(__dirname, "../upos/chrome_extension/offscreen.js");
  const context = vm.createContext({window: {UposSoftphone: softphone}, chrome, crypto: globalThis.crypto,
    clearInterval, setInterval, Date});
  vm.runInContext(fs.readFileSync(file, "utf8"), context);
  handlers.incoming({from: "998901234567"});
  assert.equal(published.at(-1).phase, "incoming");
  handlers.progress();
  assert.equal(published.at(-1).phase, "incoming");
  handlers.failed();
  assert.equal(published.at(-1).phase, "ready");
  assert.equal(published.at(-1).message, "Пропущенный входящий звонок");
  assert.equal(published.at(-1).lastCall.phone, "998901234567");
});
