import { base, r, j } from "./runtime.mjs";

import assert from "node:assert/strict";

const { fetchNews } = await j.import("../index.ts");
let calls = 0,
  mode = 200;
globalThis.fetch = async (url, options) => {
  calls++;
  if (calls > 1) assert.equal(options.headers["If-None-Match"], "test-etag");
  return {
    ok: mode === 200,
    status: mode,
    headers: {
      get(k) {
        return k === "etag" ? "test-etag" : k === "retry-after" ? "120" : null;
      },
    },
    text: async () =>
      `<rss><item><title>Fresh headline</title><link>https://example.com/story</link><pubDate>${new Date().toUTCString()}</pubDate></item></rss>`,
  };
};
const input = { sources: ["ft"], refresh: true };
assert.equal((await fetchNews(input)).results.length, 1);
mode = 304;
assert.equal((await fetchNews(input)).results.length, 1);
assert.equal(calls, 2);
mode = 429;
assert.equal((await fetchNews(input)).failures[0].error, "HTTP 429");
assert.match((await fetchNews(input)).failures[0].error, /cooling down/);
assert.equal(calls, 3);
console.log(
  "PASS: conditional HTTP validators, 304 reuse, forced refresh, rate-limit cooldown",
);
