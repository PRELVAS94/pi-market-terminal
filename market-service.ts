import type { fetchQuotes, fetchNews, Quote, NewsItem } from "./index";
type QuoteBatch = Awaited<ReturnType<typeof fetchQuotes>>;
type NewsBatch = Awaited<ReturnType<typeof fetchNews>>;
type Kind = "quotes" | "news";
type Resource = {
  kind: Kind;
  key: string;
  data?: Quote | NewsItem[];
  error?: string;
  checked?: number;
  success?: number;
  pending: boolean;
  failures?: number;
  retry?: number;
};
type Consumer = {
  kind: Kind;
  keys: string[];
  every: number;
  callback: (batch: any) => void;
};
export type Subscription = { dispose(): void; refresh(): void };
export type MarketService = ReturnType<typeof createMarketService>;
export function createMarketService(deps: {
  fetchQuotes: typeof fetchQuotes;
  fetchNews: typeof fetchNews;
  expandSymbols(symbols: string[]): string[];
  retryAt?(source: string): number | undefined;
}) {
  const resources = new Map<string, Resource>(),
    consumers = new Set<Consumer>();
  let timer: ReturnType<typeof setTimeout> | undefined,
    generation = 0;
  const id = (kind: Kind, key: string) => `${kind}:${key}`;
  const intervals = () => {
    const wanted = new Map<string, number>();
    for (const consumer of consumers)
      for (const key of consumer.keys) {
        const name = id(consumer.kind, key);
        wanted.set(
          name,
          Math.min(wanted.get(name) ?? Infinity, consumer.every),
        );
      }
    return wanted;
  };
  const snapshot = (consumer: Consumer) => {
    const rows = consumer.keys
      .map((key) => resources.get(id(consumer.kind, key)))
      .filter((r): r is Resource => Boolean(r));
    const checked = Math.max(0, ...rows.map((r) => r.checked ?? 0));
    const results = rows.flatMap<Quote | NewsItem>((r) =>
      r.data === undefined
        ? []
        : Array.isArray(r.data)
          ? r.data.map((item) => ({ ...item }))
          : [{ ...r.data }],
    );
    const failures = rows
      .filter((r) => r.error)
      .map((r) =>
        consumer.kind === "quotes"
          ? { symbol: r.key, error: r.error! }
          : { source: r.key, error: r.error! },
      );
    return {
      asOf: new Date(checked || Date.now()).toISOString(),
      results,
      failures,
    };
  };
  const emit = (changed: Resource) => {
    for (const consumer of [...consumers])
      if (
        consumer.kind === changed.kind &&
        consumer.keys.includes(changed.key)
      ) {
        // A broken display must not stop polling for other subscribers.
        try {
          consumer.callback(snapshot(consumer));
        } catch {
          /* isolated view */
        }
      }
  };
  const due = (resource: Resource, interval: number) =>
    Math.max(
      resource.checked === undefined ? 0 : resource.checked + interval,
      resource.kind === "news"
        ? (deps.retryAt?.(resource.key) ?? 0)
        : (resource.retry ?? 0),
    );
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    let next = Infinity;
    for (const [name, interval] of intervals()) {
      const resource = resources.get(name)!;
      if (!resource.pending) next = Math.min(next, due(resource, interval));
    }
    if (Number.isFinite(next))
      timer = setTimeout(run, Math.max(0, next - Date.now()));
  };
  const pull = async (resource: Resource) => {
    const version = generation;
    resource.pending = true;
    try {
      if (resource.kind === "quotes") {
        const batch = await deps.fetchQuotes({ symbols: [resource.key] });
        if (version !== generation) return;
        const failure = batch.failures.find((f) => f.symbol === resource.key);
        if (failure || !batch.results.length)
          throw new Error(failure?.error ?? "Quote unavailable");
        resource.data = { ...batch.results[0] };
      } else {
        const batch = await deps.fetchNews({
          sources: [resource.key],
          window: resource.key === "fed" ? "30d" : "24h",
          maxPerSource: 25,
          refresh: true,
        });
        if (version !== generation) return;
        if (batch.failures.length) throw new Error(batch.failures[0].error);
        resource.data = batch.results.map((item) => ({ ...item }));
      }
      resource.error = undefined;
      resource.failures = 0;
      resource.retry = undefined;
      resource.success = Date.now();
    } catch (error) {
      if (version === generation) {
        resource.error = error instanceof Error ? error.message : String(error);
        if (resource.kind === "quotes") {
          resource.failures = (resource.failures ?? 0) + 1;
          resource.retry =
            Date.now() +
            Math.min(300_000, 15_000 * 2 ** Math.min(resource.failures - 1, 5));
        }
      }
    } finally {
      if (version === generation) {
        resource.pending = false;
        resource.checked = Date.now();
        emit(resource);
        schedule();
      }
    }
  };
  function run() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const now = Date.now();
    for (const [name, interval] of intervals()) {
      const resource = resources.get(name)!;
      if (!resource.pending && due(resource, interval) <= now)
        void pull(resource);
    }
    schedule();
  }
  const subscribe = (consumer: Consumer): Subscription => {
    for (const key of consumer.keys) {
      const name = id(consumer.kind, key);
      if (!resources.has(name))
        resources.set(name, { kind: consumer.kind, key, pending: false });
    }
    consumers.add(consumer);
    try {
      consumer.callback(snapshot(consumer));
    } catch {
      /* isolated view */
    }
    run();
    return {
      dispose() {
        consumers.delete(consumer);
        schedule();
      },
      refresh() {
        if (!consumers.has(consumer)) return;
        for (const key of consumer.keys)
          resources.get(id(consumer.kind, key))!.checked = undefined;
        run();
      },
    };
  };
  return {
    subscribeQuotes(
      input: { symbols: string[]; every: number },
      callback: (batch: QuoteBatch) => void,
    ) {
      return subscribe({
        kind: "quotes",
        keys: deps.expandSymbols(input.symbols),
        every: Math.max(5, input.every) * 1000,
        callback,
      });
    },
    subscribeNews(
      input: { sources: string[]; every: number },
      callback: (batch: NewsBatch) => void,
    ) {
      return subscribe({
        kind: "news",
        keys: [...new Set(input.sources)],
        every: Math.max(10, input.every) * 1000,
        callback,
      });
    },
    health() {
      const active = intervals();
      return [...resources.values()].map((resource) => ({
        kind: resource.kind,
        key: resource.key,
        active: active.has(id(resource.kind, resource.key)),
        pending: resource.pending,
        error: resource.error,
        lastCheck: resource.checked,
        lastSuccess: resource.success,
        quoteTime:
          resource.kind === "quotes"
            ? (resource.data as Quote | undefined)?.quoteTime
            : undefined,
        latestPublication:
          resource.kind === "news"
            ? Math.max(
                0,
                ...((resource.data as NewsItem[] | undefined) ?? []).map(
                  (item) => Date.parse(item.published) || 0,
                ),
              ) || undefined
            : undefined,
        retryAt:
          resource.kind === "news"
            ? deps.retryAt?.(resource.key)
            : resource.retry,
        nextCheck:
          active.has(id(resource.kind, resource.key)) && !resource.pending
            ? due(resource, active.get(id(resource.kind, resource.key))!)
            : undefined,
      }));
    },
    reset() {
      generation++;
      consumers.clear();
      resources.clear();
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
