import { j } from "./runtime.mjs";
import assert from "node:assert/strict";
const module = await j.import("../index.ts");
const tools = new Map();
module.default({
  registerTool(tool) {
    tools.set(tool.name, tool);
  },
  registerCommand() {},
  on() {},
  appendEntry() {},
});
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        chart: {
          result: [
            {
              meta: {
                symbol: "AAPL",
                regularMarketPrice: 100,
                chartPreviousClose: 90,
              },
            },
          ],
        },
      }),
  });
  const quote = await tools
    .get("market_data")
    .execute("quote", { symbols: ["AAPL"] });
  assert.equal(quote.details.results[0].symbol, "AAPL");
  assert.deepEqual(
    JSON.parse(quote.content[0].text),
    JSON.parse(JSON.stringify(quote.details)),
  );
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get() {} },
    text: async () => "<rss><channel></channel></rss>",
  });
  const news = await tools
    .get("market_news")
    .execute("news", { sources: ["cnbc-markets"] });
  assert.ok(news.details);
  assert.deepEqual(JSON.parse(news.content[0].text), news.details);
  const article = await tools
    .get("market_article")
    .execute("article", { url: "https://example.com/unsupported" });
  assert.equal(article.isError, true);
  assert.equal(article.details.url, "https://example.com/unsupported");
  console.log(
    "PASS: Pi tool results carry typed details alongside readable source payloads and structured article failures",
  );
} finally {
  globalThis.fetch = originalFetch;
}
