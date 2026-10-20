import { base, r, j } from "./runtime.mjs";

import assert from "node:assert/strict";

const require = r;
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent":
      base + "@earendil-works/pi-coding-agent/dist/config.js",
    typebox: base + "typebox/build/index.mjs",
    "@earendil-works/pi-tui": base + "@earendil-works/pi-tui/dist/index.js",
  },
});
let requests = 0;
globalThis.fetch = async (url) => {
  requests++;
  if (url.includes("BAD")) throw Error("unavailable");
  if (url.includes("rss"))
    return {
      ok: true,
      text: async () =>
        `<rss><item><title>Markets &amp; earnings</title><link>https://example.com/story</link><pubDate>${new Date().toUTCString()}</pubDate></item></rss>`,
    };
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
                ...(symbol === "NOCLOSE" ? {} : { chartPreviousClose: 90 }),
                regularMarketTime: Math.floor(Date.now() / 1000),
                marketState: "REGULAR",
                fullExchangeName: "Test",
              },
              indicators: {
                quote: [
                  { close: Array.from({ length: 260 }, (_, i) => i + 1) },
                ],
              },
            },
          ],
        },
      }),
  };
};
const mod = await jiti.import("../index.ts");
assert.deepEqual(mod.expandSymbols(["vwce", "smsn"]), ["VWCE.DE", "SMSN.IL"]);
const quotes = await mod.fetchQuotes({
  symbols: ["spx", "BAD"],
  context: true,
});
assert.equal(quotes.results.length, 1);
assert.equal(quotes.failures.length, 1);
assert.equal(quotes.results[0].context.avg_30d, 245.5);
assert.equal(quotes.results[0].marketState, "REGULAR");
assert.ok(quotes.results[0].quoteTime);
assert.equal(
  (await mod.fetchQuotes({ symbols: ["spx"] })).results[0].context,
  undefined,
);
const unknown = await mod.fetchQuote("NOCLOSE");
assert.equal(unknown.changePct, null);
assert.equal(unknown.change, null);
const news = await mod.fetchNews({ sources: ["cnbc-markets"] });
assert.equal(news.results[0].title, "Markets & earnings");
const commands = {},
  events = {};
mod.default({
  registerTool() {},
  registerCommand(n, c) {
    commands[n] = c;
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
for (const handler of events.session_shutdown) await handler({}, {});
console.log(
  "PASS: history, quote cache isolation, partial failures, RSS and dashboard-only command registration",
);
