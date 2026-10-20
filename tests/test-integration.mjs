import { base, r, j } from "./runtime.mjs";
import assert from "node:assert/strict";

const mod = await j.import("../index.ts");
const original = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch,
  now: Date.now,
};
let now = Date.now(),
  next = 0,
  quoteCalls = 0,
  newsCalls = 0;
const timers = new Map(),
  intervals = new Map();
globalThis.setTimeout = (fn, ms) => {
  timers.set(++next, { fn, at: now + ms, ms });
  return next;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.setInterval = (fn, ms) => {
  intervals.set(++next, { fn, ms });
  return next;
};
globalThis.clearInterval = (id) => intervals.delete(id);
Date.now = () => now;
globalThis.fetch = async (url) => {
  if (url.includes("/chart/")) {
    quoteCalls++;
    const symbol = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          chart: {
            result: [
              {
                meta: {
                  symbol,
                  regularMarketPrice: 100,
                  chartPreviousClose: 90,
                  regularMarketTime: Math.floor(now / 1000),
                  currentTradingPeriod: {
                    regular: {
                      start: Math.floor(now / 1000) - 3600,
                      end: Math.floor(now / 1000) + 3600,
                    },
                  },
                },
              },
            ],
          },
        }),
    };
  }
  if (url.includes("bls.ics"))
    return { ok: true, text: async () => `BEGIN:VCALENDAR\nEND:VCALENDAR` };
  newsCalls++;
  return {
    ok: true,
    text: async () =>
      `<rss><item><title>Fresh news</title><link>https://example.com/story</link><pubDate>${new Date(now).toUTCString()}</pubDate></item></rss>`,
  };
};
try {
  const commands = {},
    events = {},
    entries = [];
  let component,
    done = 0;
  const ctx = {
    hasUI: true,
    mode: "tui",
    sessionManager: { getEntries: () => entries },
    ui: {
      notify() {},
      custom: async (factory) => {
        component = factory(
          { requestRender() {}, terminal: { rows: 40 } },
          { fg: (_, s) => s },
          {},
          () => {
            done++;
          },
        );
      },
    },
  };
  mod.default({
    registerCommand(n, c) {
      assert.ok(!commands[n]);
      commands[n] = c;
    },
    registerTool() {},
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data: structuredClone(data) });
    },
    on(n, c) {
      (events[n] ??= []).push(c);
    },
  });
  assert.deepEqual(Object.keys(commands).sort(), [
    "market-terminal",
    "ticker",
    "ticker-news",
  ]);
  const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
  };
  const cmd = async (n, args = "") => {
    await commands[n].handler(args, ctx);
    await flush();
  };
  for (const handler of events.session_start) await handler({}, ctx);
  await Promise.all([mod.fetchQuote("DIRECT"), mod.fetchQuote("DIRECT")]);
  assert.equal(quoteCalls, 1, "direct quote in-flight dedup");
  quoteCalls = 0;
  await cmd("ticker", "set AAPL");
  await cmd("ticker-news", "sources set cnbc-markets");
  await cmd("ticker-news", "every 10");
  assert.equal(newsCalls, 0, "settings commands never start feeds");
  await cmd("market-terminal");
  assert.equal(quoteCalls, 1);
  assert.equal(newsCalls, 1);
  assert.ok(component.render(140).some((l) => l.includes("AAPL")));
  // Autoplay's separate subprocess pipeline is exercised in test-terminal-video; only advance the feed scheduler here.
  now += 10000;
  for (const [id, t] of [...timers])
    if (t.at <= now && t.ms >= 10000) {
      timers.delete(id);
      t.fn();
    }
  await flush();
  assert.equal(newsCalls, 2, "one request per source per interval");
  assert.equal(quoteCalls, 1);
  await cmd("ticker", "add MSFT");
  assert.ok(
    component.render(140).some((l) => l.includes("MSFT")),
    "watchlist edits update the open dashboard",
  );
  assert.equal(quoteCalls, 2);
  component.handleInput("h");
  assert.ok(component.render(140).some((l) => l.includes("SOURCE HEALTH")));
  component.handleInput("q");
  await flush();
  assert.equal(done, 1);
  assert.equal(timers.size, 0);
  assert.equal(intervals.size, 0);
  for (const handler of events.session_shutdown) await handler({}, ctx);
  console.log(
    "PASS: three-command surface, settings-only mutations, live dashboard configuration, shared requests, independent polling, source health and full cleanup",
  );
} finally {
  Object.assign(globalThis, {
    setTimeout: original.setTimeout,
    clearTimeout: original.clearTimeout,
    setInterval: original.setInterval,
    clearInterval: original.clearInterval,
    fetch: original.fetch,
  });
  Date.now = original.now;
}
