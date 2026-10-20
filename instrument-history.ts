export type HistoryPoint = { at: string; close: number };
export function parseDailyHistory(data: any): HistoryPoint[] {
  const result = data?.chart?.result?.[0],
    times = result?.timestamp,
    closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(times) || !Array.isArray(closes))
    throw new Error("No daily close series supplied");
  const points: HistoryPoint[] = [];
  for (let i = 0; i < Math.min(times.length, closes.length); i++) {
    if (
      typeof times[i] !== "number" ||
      !Number.isFinite(times[i]) ||
      typeof closes[i] !== "number" ||
      !Number.isFinite(closes[i])
    )
      continue;
    const date = new Date(times[i] * 1000);
    if (Number.isNaN(date.getTime())) continue;
    points.push({ at: date.toISOString().slice(0, 10), close: closes[i] });
  }
  if (points.length < 2) throw new Error("Not enough daily closes");
  return points.slice(-32);
}
export function historyLines(points: HistoryPoint[]): string[] {
  const values = points.map((p) => p.close),
    low = Math.min(...values),
    high = Math.max(...values),
    blocks = "▁▂▃▄▅▆▇█";
  const spark = values
    .map(
      (value) =>
        blocks[
          high === low
            ? 3
            : Math.min(7, Math.floor(((value - low) / (high - low)) * 7))
        ],
    )
    .join("");
  const first = values[0],
    last = values.at(-1)!,
    change = first ? ((last - first) / first) * 100 : undefined;
  return [
    "DAILY CLOSES / 1 MONTH",
    spark,
    `${points[0].at} → ${points.at(-1)!.at}`,
    `Low ${low.toFixed(2)} · High ${high.toFixed(2)} · ${points.length} sessions`,
    `${change === undefined ? "Change unknown" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}% over displayed period`} · Yahoo daily chart`,
    "Daily close values may include the current incomplete session; not an intraday chart.",
    "",
  ];
}
export function createHistoryReader() {
  const cache = new Map<string, { at: number; points: HistoryPoint[] }>();
  return async (
    symbol: string,
    signal: AbortSignal,
  ): Promise<HistoryPoint[]> => {
    if (!/^[A-Za-z0-9^=._-]{1,32}$/.test(symbol))
      throw new Error("Invalid history symbol");
    if (signal.aborted) throw new Error("History request cancelled");
    const hit = cache.get(symbol);
    if (hit && Date.now() - hit.at < 300000) return hit.points;
    let last: unknown;
    for (const host of [
      "query1.finance.yahoo.com",
      "query2.finance.yahoo.com",
    ]) {
      if (signal.aborted) throw new Error("History request cancelled");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 8000);
      try {
        const response = await fetch(
          `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`,
          {
            signal: controller.signal,
            redirect: "error",
            headers: { "User-Agent": "Pi-Market-Terminal/0.8" },
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.text();
        if (raw.length > 2000000) throw new Error("History response too large");
        const points = parseDailyHistory(JSON.parse(raw));
        if (signal.aborted) throw new Error("History request cancelled");
        cache.set(symbol, { at: Date.now(), points });
        if (cache.size > 20) cache.delete(cache.keys().next().value!);
        return points;
      } catch (error) {
        last = error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
    }
    throw last ?? new Error("History unavailable");
  };
}
