import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type TerminalConfig = {
  symbols: string[];
  sources: string[];
  filter: string;
  stockEvery: number;
  newsEvery: number;
};
const ENTRY = "market-terminal-config-v1";
export const DEFAULT_TICKERS = [
  "MSFT",
  "AAPL",
  "VWCE.DE",
  "TSM",
  "GOOGL",
  "NVDA",
  "SONY",
  "AMZN",
  "ORCL",
  "SMSN.IL",
  "AVGO",
];
export const defaultTerminalConfig = (): TerminalConfig => ({
  symbols: [...DEFAULT_TICKERS],
  sources: ["cnbc-markets", "cnbc-top", "fed", "investing"],
  filter: "",
  stockEvery: 15,
  newsEvery: 15,
});
export function validateTerminalConfig(
  value: any,
  sources: Record<string, unknown>,
): TerminalConfig {
  if (
    !value ||
    !Array.isArray(value.symbols) ||
    !value.symbols.length ||
    value.symbols.length > 20 ||
    value.symbols.some(
      (s: any) => typeof s !== "string" || !/^[a-zA-Z0-9^=._-]{1,32}$/.test(s),
    )
  )
    throw new Error("Use 1–20 valid ticker symbols or aliases");
  if (
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.some(
      (s: any) => typeof s !== "string" || !Object.hasOwn(sources, s),
    )
  )
    throw new Error("Unknown or empty news sources");
  if (typeof value.filter !== "string" || value.filter.length > 200)
    throw new Error("Filter must be at most 200 characters");
  if (
    !Number.isInteger(value.stockEvery) ||
    value.stockEvery < 5 ||
    value.stockEvery > 3600 ||
    !Number.isInteger(value.newsEvery) ||
    value.newsEvery < 10 ||
    value.newsEvery > 3600
  )
    throw new Error("Quotes: 5–3600 seconds; news: 10–3600 seconds");
  return {
    symbols: [...new Set<string>(value.symbols as string[])],
    sources: [...new Set<string>(value.sources as string[])],
    filter: value.filter,
    stockEvery: value.stockEvery,
    newsEvery: value.newsEvery,
  };
}
export function registerTerminalConfig(
  pi: ExtensionAPI,
  sources: Record<string, unknown>,
) {
  let config = defaultTerminalConfig();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  pi.on("session_start", async (_event, ctx) => {
    config = defaultTerminalConfig();
    const entries = ctx.sessionManager.getEntries();
    const saved = [...entries]
      .reverse()
      .find(
        (e: any) =>
          e.type === "custom" &&
          [ENTRY, "market-terminal-footer-v1"].includes(e.customType),
      ) as any;
    if (saved)
      try {
        config = validateTerminalConfig(saved.data, sources);
      } catch {
        ctx.ui.notify(
          "Invalid saved market settings; using defaults",
          "warning",
        );
      }
    changed();
  });
  for (const name of ["ticker", "ticker-news"])
    pi.registerCommand(name, {
      description:
        name === "ticker"
          ? "Market terminal watchlist: add/remove/set SYMBOL... | reset | list | every SECONDS"
          : "Market terminal news: sources [add/remove/set] SOURCE... | filter TEXT/off | every SECONDS | list",
      handler: async (args, ctx) => {
        const words = args
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean),
          action = words[0]?.toLowerCase();
        const rest = words.slice(1);
        const next = structuredClone(config);
        const news = name === "ticker-news";
        const usage = news
          ? `/ticker-news sources [add|remove|set] SOURCE... | filter TEXT/off | every 10..3600 | list. Sources: ${Object.keys(sources).join(", ")}`
          : "/ticker add|remove|set SYMBOL... | reset | list | every 5..3600";
        if (!action || action === "list" || action === "status") {
          ctx.ui.notify(
            news
              ? `Sources: ${config.sources.join(", ")} | filter: ${config.filter || "none"} | ${config.newsEvery}s`
              : `Watchlist: ${config.symbols.join(", ")} | ${config.stockEvery}s`,
            "info",
          );
          return;
        }
        try {
          if (!news && action === "reset" && !rest.length) {
            next.symbols = [...DEFAULT_TICKERS];
          } else if (action === "every" && rest.length === 1) {
            if (news) next.newsEvery = Number(rest[0]);
            else next.stockEvery = Number(rest[0]);
          } else if (news && action === "filter" && rest.length) {
            next.filter = rest.join(" ") === "off" ? "" : rest.join(" ");
          } else if (news && action === "sources" && rest.length) {
            const mode = ["add", "remove", "set"].includes(rest[0])
              ? rest.shift()
              : "set";
            if (!rest.length || rest.some((s) => !Object.hasOwn(sources, s)))
              throw new Error(usage);
            next.sources =
              mode === "add"
                ? [...next.sources, ...rest]
                : mode === "remove"
                  ? next.sources.filter((s) => !rest.includes(s))
                  : rest;
          } else if (
            !news &&
            ["add", "remove", "set"].includes(action) &&
            rest.length
          ) {
            next.symbols =
              action === "add"
                ? [...next.symbols, ...rest]
                : action === "remove"
                  ? next.symbols.filter(
                      (s) =>
                        !rest.some((r) => r.toLowerCase() === s.toLowerCase()),
                    )
                  : rest;
          } else throw new Error(usage);
          const valid = validateTerminalConfig(next, sources);
          pi.appendEntry(ENTRY, valid);
          config = valid;
          changed();
          ctx.ui.notify(
            "Market terminal settings updated. Open /market-terminal.",
            "info",
          );
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "warning",
          );
        }
      },
    });
  return {
    update: (next: TerminalConfig) => {
      const valid = validateTerminalConfig(next, sources);
      pi.appendEntry(ENTRY, valid);
      config = valid;
      changed();
    },
    getConfig: () => structuredClone(config),
    onChange: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
