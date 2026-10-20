import { base, r, j } from "./runtime.mjs";
import assert from "node:assert/strict";

const { createMarketService } = await j.import("../market-service.ts");
const original = { setTimeout, clearTimeout, now: Date.now };
let now = 1000000,
  id = 0;
const timers = new Map();
globalThis.setTimeout = (fn, ms) => {
  timers.set(++id, { fn, at: now + ms });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);
Date.now = () => now;
try {
  let q = 0,
    n = 0,
    failed = false,
    pending,
    until = 0;
  const received = [];
  const service = createMarketService({
    expandSymbols: (s) => s,
    retryAt: () => until,
    fetchQuotes: async ({ symbols }) => {
      q++;
      if (pending) return pending;
      return {
        asOf: new Date(now).toISOString(),
        results: [
          {
            symbol: symbols[0],
            price: 100,
            changePct: 1,
            quoteTime: new Date(now).toISOString(),
          },
        ],
        failures: [],
      };
    },
    fetchNews: async () => {
      n++;
      return {
        asOf: new Date(now).toISOString(),
        results: failed
          ? []
          : [
              {
                source: "source",
                title: "story",
                url: "https://example.com",
                published: new Date(now).toISOString(),
              },
            ],
        failures: failed ? [{ source: "source", error: "HTTP 429" }] : [],
      };
    },
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const advance = async (ms) => {
    now += ms;
    for (const [key, t] of [...timers])
      if (t.at <= now) {
        timers.delete(key);
        t.fn();
      }
    await flush();
  };
  const a = service.subscribeQuotes({ symbols: ["AAPL"], every: 60 }, (b) =>
    received.push(b),
  );
  const b = service.subscribeQuotes({ symbols: ["AAPL"], every: 60 }, () => {});
  const c = service.subscribeNews({ sources: ["source"], every: 15 }, () => {});
  const d = service.subscribeNews({ sources: ["source"], every: 10 }, (b) =>
    received.push(b),
  );
  await flush();
  assert.equal(q, 1);
  assert.equal(n, 1);
  assert.equal(timers.size, 1, "one scheduler");
  await advance(5000);
  const e = service.subscribeNews({ sources: ["source"], every: 15 }, () => {});
  await flush();
  assert.equal(n, 1, "staggered view uses snapshot");
  await advance(5000);
  assert.equal(n, 2, "fastest subscriber wins");
  d.dispose();
  await advance(10000);
  assert.equal(n, 2);
  await advance(5000);
  assert.equal(n, 3, "slower interval resumes");
  failed = true;
  until = now + 120000;
  c.refresh();
  await flush();
  assert.equal(n, 3, "retry deadline blocks even manual refresh");
  until = 0;
  c.refresh();
  await flush();
  assert.equal(n, 4);
  assert.ok(received.some((x) => x.results.length));
  assert.equal(
    service.health().find((x) => x.kind === "news").error,
    "HTTP 429",
  );
  a.dispose();
  b.dispose();
  c.dispose();
  e.dispose();
  assert.equal(timers.size, 0);
  let resolve;
  pending = new Promise((r) => (resolve = r));
  service.subscribeQuotes({ symbols: ["OTHER"], every: 60 }, () => {});
  service.reset();
  resolve({ results: [], failures: [] });
  await flush();
  assert.equal(timers.size, 0);
  assert.equal(service.health().length, 0);
  let fastCalls = 0,
    failQuotes = false;
  const fast = createMarketService({
    expandSymbols: (s) => s,
    fetchNews: async () => ({ results: [], failures: [] }),
    fetchQuotes: async ({ symbols }) => {
      fastCalls++;
      return {
        results: failQuotes ? [] : [{ symbol: symbols[0], price: 123 }],
        failures: failQuotes ? [{ symbol: symbols[0], error: "HTTP 429" }] : [],
      };
    },
  });
  const fastSub = fast.subscribeQuotes(
    { symbols: ["FAST"], every: 5 },
    () => {},
  );
  await flush();
  assert.equal(fastCalls, 1);
  await advance(4999);
  assert.equal(fastCalls, 1);
  await advance(1);
  assert.equal(fastCalls, 2, "5-second polling works");
  failQuotes = true;
  await advance(5000);
  assert.equal(fastCalls, 3);
  assert.equal(fast.health()[0].retryAt, now + 15000);
  fastSub.refresh();
  await flush();
  assert.equal(fastCalls, 3, "manual refresh respects quote backoff");
  await advance(15000);
  assert.equal(fastCalls, 4);
  assert.equal(fast.health()[0].retryAt, now + 30000);
  failQuotes = false;
  await advance(30000);
  assert.equal(fast.health()[0].error, undefined);
  assert.equal(fast.health()[0].retryAt, undefined);
  fast.reset();
  console.log(
    "PASS: shared per-symbol/source requests, staggered subscribers, one scheduler, fastest interval, interval removal, retry deadlines, retained health, cleanup and reset during in-flight request",
  );
} finally {
  globalThis.setTimeout = original.setTimeout;
  globalThis.clearTimeout = original.clearTimeout;
  Date.now = original.now;
}
