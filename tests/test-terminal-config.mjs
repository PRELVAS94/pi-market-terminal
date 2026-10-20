import { base, r, j } from "./runtime.mjs";
import assert from "node:assert/strict";
const { registerTerminalConfig, DEFAULT_TICKERS } = await j.import(
  "../terminal-config.ts",
);
const commands = {},
  events = {},
  entries = [],
  notices = [];
let changes = 0;
const sources = { fed: {}, "cnbc-markets": {}, "cnbc-top": {}, investing: {} };
const settings = registerTerminalConfig(
  {
    registerCommand(n, c) {
      commands[n] = c;
    },
    on(n, c) {
      events[n] = c;
    },
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data });
    },
  },
  sources,
);
const unsubscribe = settings.onChange(() => changes++);
const ctx = {
  sessionManager: { getEntries: () => entries },
  ui: { notify: (message, kind) => notices.push({ message, kind }) },
};
await events.session_start({}, ctx);
assert.deepEqual(settings.getConfig().symbols, DEFAULT_TICKERS);
assert.ok(DEFAULT_TICKERS.includes("VWCE.DE"));
assert.ok(DEFAULT_TICKERS.includes("SMSN.IL"));
const cmd = async (n, s) => commands[n].handler(s, ctx);
await cmd("ticker", "set AAPL MSFT");
await cmd("ticker", "add NVDA");
await cmd("ticker", "remove msft");
assert.deepEqual(settings.getConfig().symbols, ["AAPL", "NVDA"]);
await cmd("ticker", "remove AAPL NVDA");
assert.deepEqual(
  settings.getConfig().symbols,
  ["AAPL", "NVDA"],
  "cannot empty watchlist",
);
await cmd("ticker-news", "sources set cnbc-markets");
await cmd("ticker-news", "sources add fed");
assert.deepEqual(settings.getConfig().sources, ["cnbc-markets", "fed"]);
await cmd("ticker-news", "sources remove fed");
assert.deepEqual(settings.getConfig().sources, ["cnbc-markets"]);
await cmd("ticker-news", "sources add invalid");
assert.deepEqual(settings.getConfig().sources, ["cnbc-markets"]);
await cmd("ticker-news", "filter China rates");
assert.equal(settings.getConfig().filter, "China rates");
await cmd("ticker-news", "filter off");
assert.equal(settings.getConfig().filter, "");
await cmd("ticker", "every 1");
assert.equal(settings.getConfig().stockEvery, 15);
await cmd("ticker", "every 5");
assert.equal(settings.getConfig().stockEvery, 5);
await cmd("ticker-news", "every 10");
assert.equal(settings.getConfig().newsEvery, 10);
await events.session_start({}, ctx);
assert.deepEqual(settings.getConfig().symbols, ["AAPL", "NVDA"]);
assert.equal(settings.getConfig().newsEvery, 10);
const before = changes;
unsubscribe();
await cmd("ticker", "add TSLA");
assert.equal(changes, before);
await cmd("ticker", "reset");
assert.deepEqual(settings.getConfig().symbols, DEFAULT_TICKERS);
console.log(
  "PASS: watchlist add/remove/set, source add/remove/set, validation, filters, polling limits, session restore and change subscriptions",
);
