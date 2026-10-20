import { j } from "./runtime.mjs";
import assert from "node:assert/strict";
const { parseDailyHistory, historyLines, createHistoryReader } = await j.import(
  "../instrument-history.ts",
);
const data = {
  chart: {
    result: [
      {
        timestamp: [1700000000, 1700086400, 1700172800, 1700259200],
        indicators: { quote: [{ close: [100, null, 102, 105] }] },
      },
    ],
  },
};
const points = parseDailyHistory(data);
assert.equal(points.length, 3);
assert.equal(points[1].close, 102);
assert.ok(historyLines(points).some((l) => l.includes("+5.00%")));
assert.throws(() => parseDailyHistory({}));
assert.ok(
  historyLines([
    { at: "2026-01-01", close: 5 },
    { at: "2026-01-02", close: 5 },
  ]).includes("▄▄"),
);
const fetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new Error("Host unavailable");
    return { ok: true, text: async () => JSON.stringify(data) };
  };
  const reader = createHistoryReader();
  await reader("AAPL", new AbortController().signal);
  assert.equal(calls, 2);
  await reader("AAPL", new AbortController().signal);
  assert.equal(calls, 2, "daily history uses 5-minute cache");
  await assert.rejects(() =>
    reader("https://evil.example", new AbortController().signal),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => reader("MSFT", abort.signal));
} finally {
  globalThis.fetch = fetch;
}
console.log(
  "PASS: actual daily-series parsing, missing values, honest chart range, flat series, cache, host fallback, validation and cancellation",
);
