import { createHistoryReader, historyLines } from "./instrument-history";
import { createEmbeddedPlayer } from "./embedded-player";
import { createQualityPlayer } from "./quality-player";
import { createTerminalVideo, BLOOMBERG_URL } from "./terminal-video";
import { createDetailedArticleReader, canReadArticle } from "./article-reader";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  Key,
  getCapabilities,
  allocateImageId,
  renderImage,
  deleteKittyImage,
  getCellDimensions,
} from "@earendil-works/pi-tui";
import type { MarketService, Subscription } from "./market-service";
import type { Quote, NewsItem } from "./index";
import { createCalendarClient } from "./calendar";
import {
  renderMarketDashboard,
  marketGeometry,
  detailLines,
  safeText,
  type MarketPane,
  type MarketRow,
} from "./market-layout";

export function registerTerminal(
  pi: ExtensionAPI,
  service: MarketService,
  getConfig: () => any,
  expandSymbols: (symbols: string[]) => string[] = (symbols) => symbols,
  options: {
    onConfigChange?: (fn: () => void) => () => void;
    updateConfig?: (config: any) => void;
    createVideo?: typeof createTerminalVideo;
    createPlayer?: typeof createQualityPlayer;
    createEmbedded?: typeof createEmbeddedPlayer;
    embeddedSupported?: boolean;
    autoVideo?: boolean;
  } = {},
) {
  const videoUrl = BLOOMBERG_URL;
  const calendar = createCalendarClient();
  let closeView: (() => void) | undefined;
  pi.registerCommand("market-terminal", {
    description:
      "One-screen Quotes, interactive News, Calendar and Bloomberg TV; 1–4/Tab focus, Enter details, p pause, r refresh",
    handler: async (args, ctx) => {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify(
          "The market terminal requires Pi terminal mode",
          "warning",
        );
        return;
      }
      if (args.trim()) {
        ctx.ui.notify(
          "Use /market-terminal; configure symbols and feeds with /ticker and /ticker-news",
          "info",
        );
        return;
      }
      closeView?.();
      await ctx.ui.custom<void>(
        (tui, theme, _keys, done) => {
          const readArticle = createDetailedArticleReader(),
            readHistory = createHistoryReader();
          let articleAbort: AbortController | undefined,
            historyAbort: AbortController | undefined,
            historySymbol = "",
            instrumentLines: string[] = [];
          let config = getConfig(),
            wanted = expandSymbols(config.symbols);
          let search = "",
            inputMode: "search" | "watchlist" | undefined,
            inputText = "",
            tickerOffset = 0,
            sort: "watchlist" | "gainers" | "losers" = "watchlist",
            helpMode = false;
          let quotes: Quote[] = [],
            news: NewsItem[] = [],
            quoteErrors = new Set<string>();
          let focus = 0,
            selected = [0, 0, 0, 0],
            paused = false,
            details = false,
            detailOffset = 0,
            disposed = false,
            lastWidth = 140,
            seconds = 0;
          let bodyText = "",
            articleStatus = "",
            points: string[] = [],
            pointsOnly = false,
            healthMode = false,
            resumeVideo = false,
            resumePlayer = false,
            resumeEmbedded = false,
            expanded: number | undefined;
          let calendarState = calendar.snapshot(),
            reading: NewsItem | undefined,
            launchStatus = "o opens browser playback with audio";
          const openUrl = async (url: string) => {
            try {
              const parsed = new URL(url);
              if (!["https:", "http:"].includes(parsed.protocol))
                throw new Error("Unsupported URL");
              const command =
                process.platform === "darwin"
                  ? "open"
                  : process.platform === "win32"
                    ? "rundll32"
                    : "xdg-open";
              const result = await pi.exec(
                command,
                process.platform === "win32"
                  ? ["url.dll,FileProtocolHandler", parsed.href]
                  : [parsed.href],
              );
              if (result.code !== 0) throw new Error("Browser launch failed");
              if (!disposed) {
                launchStatus = "Browser opened · playback may require Play";
                draw();
              }
            } catch {
              if (!disposed) {
                launchStatus = "Could not open browser; use the URL below";
                ctx.ui.notify("Could not open browser: " + url, "warning");
                draw();
              }
            }
          };
          const articleLines = (n: NewsItem) => [
            n.title,
            n.source,
            `Published: ${n.published || "unknown"}`,
            n.url,
            "",
            ...(reading === n && pointsOnly
              ? [
                  "PUBLISHER KEY POINTS",
                  ...(points.length
                    ? points.map((p) => "• " + p)
                    : ["No publisher Key Points supplied."]),
                ]
              : reading === n && bodyText
                ? bodyText.split("\n")
                : [n.summary || "This publisher supplied a headline only."]),
            "",
            reading === n && articleStatus
              ? articleStatus
              : "Publisher feed text; may be an excerpt. Press o for the full source article.",
          ];
          let quoteSub: Subscription | undefined,
            newsSub: Subscription | undefined;
          const time = (n: number | undefined) =>
            n ? new Date(n).toLocaleString() : "unknown";
          const loadArticle = (item: NewsItem | undefined) => {
            articleAbort?.abort();
            bodyText = "";
            articleStatus = "";
            points = [];
            pointsOnly = false;
            if (!item || !canReadArticle(item.url)) return;
            const controller = new AbortController();
            articleAbort = controller;
            articleStatus = "Loading publisher article…";
            const timeout = setTimeout(() => controller.abort(), 10000);
            void readArticle(item.url, controller.signal)
              .then((article) => {
                if (
                  !disposed &&
                  reading === item &&
                  !controller.signal.aborted
                ) {
                  bodyText = article.body;
                  points = article.points;
                  articleStatus = `${article.attribution} · ${article.coverage} · a: publisher Key Points`;
                  draw();
                }
              })
              .catch((error) => {
                if (!disposed && reading === item) {
                  articleStatus = `Article unavailable: ${error instanceof Error ? error.message : String(error)}. Feed excerpt retained; o opens source.`;
                  draw();
                }
              })
              .finally(() => clearTimeout(timeout));
          };
          const loadInstrument = (symbol: string | undefined) => {
            historyAbort?.abort();
            historySymbol = symbol ?? "";
            instrumentLines = [];
            if (!symbol) return;
            const controller = new AbortController();
            historyAbort = controller;
            instrumentLines = ["Loading daily closes…", ""];
            void readHistory(symbol, controller.signal)
              .then((points) => {
                if (
                  !disposed &&
                  !controller.signal.aborted &&
                  historySymbol === symbol
                ) {
                  instrumentLines = historyLines(points);
                  draw();
                }
              })
              .catch((error) => {
                if (
                  !disposed &&
                  !controller.signal.aborted &&
                  historySymbol === symbol
                ) {
                  instrumentLines = [
                    `Daily history unavailable: ${safeText(error instanceof Error ? error.message : String(error))}`,
                    "",
                  ];
                  draw();
                }
              });
          };
          const rows = (pane: number): MarketRow[] => {
            if (pane === 0)
              return [...wanted]
                .sort((a, b) => {
                  if (sort === "watchlist") return 0;
                  const av = quotes.find((q) => q.symbol === a)?.changePct,
                    bv = quotes.find((q) => q.symbol === b)?.changePct;
                  if (av == null) return bv == null ? 0 : 1;
                  if (bv == null) return -1;
                  return sort === "gainers" ? bv - av : av - bv;
                })
                .filter(
                  (symbol) =>
                    !search ||
                    `${symbol} ${quotes.find((q) => q.symbol === symbol)?.name ?? ""}`
                      .toLowerCase()
                      .includes(search),
                )
                .map((symbol) => {
                  const q = quotes.find((quote) => quote.symbol === symbol),
                    stale = quoteErrors.has(symbol);
                  if (!q)
                    return {
                      id: symbol,
                      label: `${symbol} — ${stale ? "UNAVAILABLE" : "loading"}`,
                      detail: [
                        symbol,
                        stale
                          ? "Quote request failed; press h for source health"
                          : "Waiting for first quote",
                      ],
                      color: stale ? "warning" : "dim",
                    };
                  const change =
                    q.changePct !== null && Number.isFinite(q.changePct)
                      ? `${q.changePct > 0 ? "▲ +" : q.changePct < 0 ? "▼ " : "▪ "}${q.changePct.toFixed(2)}%`
                      : "? unknown";
                  const price = q.price.toLocaleString("en-US", {
                    minimumFractionDigits: Math.abs(q.price) < 1 ? 4 : 2,
                    maximumFractionDigits: Math.abs(q.price) < 1 ? 4 : 2,
                  });
                  return {
                    id: symbol,
                    parts: [
                      { text: q.symbol.padEnd(10), color: "symbol" },
                      { text: price.padStart(11) + " ", color: "text" },
                      { text: (q.currency ?? "—").padEnd(4), color: "dim" },
                      {
                        text: change.padStart(10),
                        color: stale
                          ? "warning"
                          : (q.changePct ?? 0) > 0
                            ? "success"
                            : (q.changePct ?? 0) < 0
                              ? "error"
                              : "dim",
                      },
                      {
                        text: ` ${stale ? "STALE" : (q.marketState ?? "UNKNOWN")}`,
                        color: stale ? "warning" : "dim",
                      },
                    ],
                    subtitle: q.name ?? q.symbol,
                    label: `${q.symbol.padEnd(9)} ${price.padStart(10)} ${q.currency ?? ""} ${change} ${stale ? "STALE" : (q.marketState ?? "UNKNOWN")}`,
                    detail: [
                      q.name ?? q.symbol,
                      `Last: ${price} ${q.currency ?? ""} | ${change}`,
                      "",
                      ...(historySymbol === symbol ? instrumentLines : []),
                      `Quote time: ${q.quoteTime ?? "unknown"}`,
                      `Received: ${q.fetchedAt ?? "unknown"}`,
                      `Previous close: ${q.prevClose ?? "unknown"}`,
                      `Session: ${q.marketState ?? "UNKNOWN"}`,
                      stale
                        ? "STALE: displaying last successful quote"
                        : "Feed may be delayed",
                    ],
                    color: stale
                      ? "warning"
                      : (q.changePct ?? 0) > 0
                        ? "success"
                        : (q.changePct ?? 0) < 0
                          ? "error"
                          : "dim",
                  };
                });
            if (pane === 1)
              return news
                .filter(
                  (n) =>
                    !search ||
                    `${n.title} ${n.source} ${n.summary ?? ""}`
                      .toLowerCase()
                      .includes(search),
                )
                .map((n) => ({
                  id: n.url,
                  parts: [
                    {
                      text: `${Number.isFinite(Date.parse(n.published)) ? `${Math.max(0, Math.floor((Date.now() - Date.parse(n.published)) / 60000))}m` : "?"}  ${n.source.toUpperCase()}  `,
                      color: "newsSource",
                    },
                    { text: n.title, color: "text" },
                  ],
                  label: `${Number.isFinite(Date.parse(n.published)) ? new Date(n.published).toLocaleTimeString() : "time unknown"} ${n.source} | ${canReadArticle(n.url) ? "▣ " : ""}${n.title}`,
                  detail: articleLines(n),
                  color: "text",
                }));
            if (pane === 2)
              return calendarState.events.map((e) => ({
                id: e.at + e.title,
                label: `${new Date(e.at).toLocaleString()} | ${e.title}`,
                detail: [e.title, e.source, e.at, e.url],
                color: calendarState.error ? "warning" : "text",
              }));
            if (healthMode)
              return service.health().map((h) => ({
                id: h.kind + ":" + h.key,
                label: `${h.error ? "STALE" : h.pending ? "WAIT" : h.lastSuccess ? "OK" : "WAIT"} ${h.kind} ${h.key}`,
                detail: [
                  `${h.kind} ${h.key}`,
                  h.error ?? "No source error",
                  `Last success: ${time(h.lastSuccess)}`,
                  `Next check: ${time(h.nextCheck)}`,
                  `Retry: ${time(h.retryAt)}`,
                ],
                color: h.error ? "warning" : "text",
              }));
            return [
              {
                id: "bloomberg-tv",
                label: "▶ BLOOMBERG BUSINESS NEWS LIVE · v / Enter: play",
                detail: [
                  "Bloomberg Business News Live",
                  embeddedSupported
                    ? embedded.snapshot().status
                    : video.snapshot().status,
                  videoUrl,
                  "",
                  embeddedSupported
                    ? "Local Kitty: mpv shared-memory video up to 1080p at the source frame rate. m toggles audio; + / - adjusts volume."
                    : "Portable fallback: Kitty graphics preview at 640×360 / 6 fps, or a silent 2 fps character preview.",
                  qualityPlayer.snapshot().status,
                  "g: maximum source quality + audio in a native GPU window.",
                  "Source frame rate is preserved; display smoothing does not create native 60 fps.",
                  "v / Enter: start or stop · o: browser playback",
                  launchStatus,
                ],
                color: "accent",
              },
            ];
          };
          const update = (pane: number, apply: () => void) => {
            if (disposed) return;
            const key = rows(pane)[selected[pane]]?.id;
            apply();
            if (key) {
              const found = rows(pane).findIndex((row) => row.id === key);
              if (found >= 0) selected[pane] = found;
            }
            selected[pane] = Math.min(
              selected[pane],
              Math.max(0, rows(pane).length - 1),
            );
            draw();
          };
          const qualityPlayer = (options.createPlayer ?? createQualityPlayer)(
            () => {
              if (!disposed) tui.requestRender();
            },
          );
          const graphics = getCapabilities().images === "kitty";
          const embeddedSupported =
            options.embeddedSupported ??
            (graphics &&
              Boolean(
                process.env.KITTY_WINDOW_ID ||
                  process.env.TERM_PROGRAM === "kitty",
              ) &&
              !process.env.SSH_CONNECTION &&
              !process.env.TMUX &&
              !process.env.STY);
          const embedded = (options.createEmbedded ?? createEmbeddedPlayer)(
            () => {
              if (!disposed) tui.requestRender();
            },
            {
              write: (data) => tui.terminal.write(data),
              imageId: allocateImageId(),
            },
          );
          const startTV = () => {
            qualityPlayer.stop();
            if (embeddedSupported) {
              video.stop();
              embedded.start();
            } else {
              embedded.stop();
              video.start();
            }
          };
          const stopTV = () => {
            video.stop();
            embedded.stop();
          };
          const tvPlaying = () =>
            video.snapshot().playing || embedded.snapshot().playing;
          const imageId = allocateImageId();
          let imageVisible = false;
          const clearImage = () => {
            if (imageVisible) {
              tui.terminal.write(deleteKittyImage(imageId));
              imageVisible = false;
            }
          };
          const video = (options.createVideo ?? createTerminalVideo)(
            () => {
              if (!disposed) tui.requestRender();
            },
            { graphics },
          );
          const draw = () => {
            if (disposed) return;
            tui.requestRender();
          };
          const refreshCalendar = (force = false) =>
            void calendar.refresh(force).then(() => {
              if (!disposed && !paused)
                update(2, () => (calendarState = calendar.snapshot()));
            });
          const stop = () => {
            quoteSub?.dispose();
            newsSub?.dispose();
            quoteSub = newsSub = undefined;
          };
          const subscribe = () => {
            quoteSub = service.subscribeQuotes(
              { symbols: config.symbols, every: config.stockEvery },
              (batch) =>
                update(0, () => {
                  quotes = batch.results;
                  quoteErrors = new Set(batch.failures.map((f) => f.symbol));
                }),
            );
            newsSub = service.subscribeNews(
              { sources: config.sources, every: config.newsEvery },
              (batch) =>
                update(1, () => {
                  const unique = new Map<string, NewsItem>();
                  for (const item of batch.results)
                    if (
                      !config.filter ||
                      `${item.title} ${item.source}`
                        .toLowerCase()
                        .includes(config.filter.toLowerCase())
                    ) {
                      try {
                        const url = new URL(item.url);
                        url.hash = "";
                        for (const key of [...url.searchParams.keys()])
                          if (/^(utm_|fbclid$|gclid$)/i.test(key))
                            url.searchParams.delete(key);
                        unique.set(url.toString(), {
                          ...item,
                          url: url.toString(),
                        });
                      } catch {}
                    }
                  news = [...unique.values()].sort(
                    (a, b) =>
                      (Date.parse(b.published) || 0) -
                      (Date.parse(a.published) || 0),
                  );
                }),
            );
          };
          const close = () => {
            if (disposed) return;
            disposed = true;
            articleAbort?.abort();
            historyAbort?.abort();
            clearImage();
            video.dispose();
            embedded.dispose();
            qualityPlayer.dispose();
            unsubscribeConfig?.();
            stop();
            clearInterval(clock);
            if (autoPlay) clearTimeout(autoPlay);
            closeView = undefined;
            done();
          };
          const autoPlay =
            options.autoVideo === false
              ? undefined
              : setTimeout(() => {
                  if (
                    !disposed &&
                    !paused &&
                    !qualityPlayer.snapshot().playing &&
                    !tvPlaying()
                  )
                    startTV();
                }, 150);
          const clock = setInterval(() => {
            if (!paused) {
              seconds++;
              if (seconds % 4 === 0) tickerOffset++;
              if (seconds % 30 === 0) refreshCalendar();
              draw();
            }
          }, 1000);
          const unsubscribeConfig = options.onConfigChange?.(() => {
            if (disposed) return;
            stop();
            config = getConfig();
            wanted = expandSymbols(config.symbols);
            if (!paused) subscribe();
            draw();
          });
          closeView = close;
          subscribe();
          refreshCalendar();
          return {
            invalidate() {},
            dispose() {
              if (!disposed) {
                disposed = true;
                articleAbort?.abort();
                historyAbort?.abort();
                clearImage();
                video.dispose();
                embedded.dispose();
                qualityPlayer.dispose();
                unsubscribeConfig?.();
                stop();
                clearInterval(clock);
                if (autoPlay) clearTimeout(autoPlay);
                closeView = undefined;
              }
            },
            handleInput(data: string) {
              if (inputMode) {
                if (matchesKey(data, Key.escape)) {
                  inputMode = undefined;
                  inputText = "";
                } else if (matchesKey(data, Key.enter)) {
                  if (inputMode === "search") {
                    search = inputText.trim().toLowerCase();
                    selected = [0, 0, 0, 0];
                    details = false;
                    reading = undefined;
                    articleAbort?.abort();
                    inputMode = undefined;
                  } else if (options.updateConfig)
                    try {
                      options.updateConfig({
                        ...config,
                        symbols: inputText
                          .trim()
                          .split(/[\s,]+/)
                          .filter(Boolean),
                      });
                      search = "";
                      inputMode = undefined;
                    } catch (error) {
                      ctx.ui.notify(
                        error instanceof Error ? error.message : String(error),
                        "warning",
                      );
                    }
                } else if (data === "\x7f" || data === "\b")
                  inputText = inputText.slice(0, -1);
                else if (
                  /^[^\x00-\x1f\x7f]+$/u.test(data) &&
                  inputText.length + data.length <= 200
                )
                  inputText += safeText(data);
                draw();
                return;
              }
              if (data === "/") {
                inputMode = "search";
                inputText = search;
                draw();
                return;
              }
              if (data === "w" && options.updateConfig) {
                inputMode = "watchlist";
                inputText = config.symbols.join(" ");
                draw();
                return;
              }
              if (data === "t" && options.updateConfig) {
                const rates = [5, 15, 60];
                options.updateConfig({
                  ...config,
                  stockEvery:
                    rates[
                      (rates.indexOf(config.stockEvery) + 1) % rates.length
                    ],
                });
                draw();
                return;
              }
              if (data === "?") {
                helpMode = !helpMode;
                draw();
                return;
              }
              if (data === "s") {
                const id = rows(0)[selected[0]]?.id;
                sort =
                  sort === "watchlist"
                    ? "gainers"
                    : sort === "gainers"
                      ? "losers"
                      : "watchlist";
                selected[0] = Math.max(
                  0,
                  rows(0).findIndex((r) => r.id === id),
                );
                draw();
                return;
              }
              if (data === "m") {
                embedded.mute();
                draw();
                return;
              }
              if (data === "+" || data === "=") {
                embedded.volume(5);
                draw();
                return;
              }
              if (data === "-") {
                embedded.volume(-5);
                draw();
                return;
              }
              if (data === "q") {
                close();
                return;
              }
              if (matchesKey(data, Key.escape)) {
                if (helpMode) {
                  helpMode = false;
                } else if (search) {
                  search = "";
                } else if (expanded !== undefined) {
                  expanded = undefined;
                } else if (details) {
                  details = false;
                  reading = undefined;
                  articleAbort?.abort();
                  historyAbort?.abort();
                  detailOffset = 0;
                } else {
                  close();
                  return;
                }
              } else if (
                matchesKey(data, Key.tab) ||
                matchesKey(data, "shift+tab")
              ) {
                focus = (focus + (matchesKey(data, "shift+tab") ? 3 : 1)) % 4;
                details = false;
                reading = undefined;
                articleAbort?.abort();
                historyAbort?.abort();
                detailOffset = 0;
                expanded = undefined;
              } else if (/^[1-4]$/.test(data)) {
                focus = Number(data) - 1;
                expanded = undefined;
                details = false;
                reading = undefined;
                articleAbort?.abort();
                historyAbort?.abort();
                detailOffset = 0;
              } else if (
                matchesKey(data, Key.up) ||
                matchesKey(data, Key.down)
              ) {
                const direction = matchesKey(data, Key.up) ? -1 : 1;
                if (details) {
                  const geometry = marketGeometry(
                    lastWidth,
                    Math.max(1, tui.terminal.rows - 1),
                  );
                  const max =
                    detailLines(
                      reading
                        ? articleLines(reading)
                        : (rows(focus)[selected[focus]]?.detail ?? []),
                      expanded === focus
                        ? lastWidth
                        : (geometry?.panes[focus].width ?? lastWidth),
                    ).length - 1;
                  detailOffset = Math.max(
                    0,
                    Math.min(max, detailOffset + direction),
                  );
                } else
                  selected[focus] = Math.max(
                    0,
                    Math.min(
                      Math.max(0, rows(focus).length - 1),
                      selected[focus] + direction,
                    ),
                  );
              } else if (matchesKey(data, Key.enter)) {
                if (focus === 3 && !healthMode) {
                  if (paused) return;
                  tvPlaying() ? stopTV() : startTV();
                } else {
                  details = !details;
                  reading =
                    details && focus === 1
                      ? news.find((n) => n.url === rows(1)[selected[1]]?.id)
                      : undefined;
                  loadArticle(reading);
                  if (focus === 0)
                    loadInstrument(
                      details ? rows(0)[selected[0]]?.id : undefined,
                    );
                }
                detailOffset = 0;
              } else if (data === "f") {
                expanded = expanded === focus ? undefined : focus;
                detailOffset = 0;
              } else if (data === "v") {
                if (paused) return;
                healthMode = false;
                details = focus === 3 ? false : details;
                tvPlaying() ? stopTV() : startTV();
              } else if (data === "g") {
                if (paused) return;
                stopTV();
                qualityPlayer.snapshot().playing
                  ? qualityPlayer.stop()
                  : qualityPlayer.start();
              } else if (data === "h") {
                healthMode = !healthMode;
                focus = 3;
                expanded = undefined;
                details = false;
                reading = undefined;
                articleAbort?.abort();
                historyAbort?.abort();
                detailOffset = 0;
              } else if (data === "a" && focus === 1 && reading) {
                pointsOnly = !pointsOnly;
                detailOffset = 0;
              } else if (data === "o") {
                const url =
                  focus === 3
                    ? videoUrl
                    : focus === 1
                      ? (
                          reading ??
                          news.find((n) => n.url === rows(1)[selected[1]]?.id)
                        )?.url
                      : undefined;
                if (url) void openUrl(url);
              } else if (data === "p") {
                paused = !paused;
                if (paused) {
                  resumeVideo = video.snapshot().playing;
                  resumeEmbedded = embedded.snapshot().playing;
                  resumePlayer = qualityPlayer.snapshot().playing;
                  stop();
                  video.stop();
                  embedded.pause(true);
                  qualityPlayer.stop();
                } else {
                  if (resumePlayer) qualityPlayer.start();
                  else if (resumeEmbedded) embedded.pause(false);
                  else if (resumeVideo) video.start();
                  subscribe();
                  calendarState = calendar.snapshot();
                  refreshCalendar();
                }
              } else if (data === "r" && !paused) {
                quoteSub?.refresh();
                newsSub?.refresh();
                refreshCalendar(true);
              }
              draw();
            },
            render(width: number) {
              lastWidth = width;
              const geometry = marketGeometry(
                width,
                Math.max(1, tui.terminal.rows - 1),
              );
              if (geometry)
                video.resize(
                  expanded === 3 ? width - 2 : geometry.panes[3].width - 2,
                  expanded === 3
                    ? Math.max(2, tui.terminal.rows - 8)
                    : geometry.panes[3].height - 3,
                );
              const hd = embedded.snapshot();
              if (
                embeddedSupported &&
                hd.playing &&
                geometry &&
                !healthMode &&
                !helpMode &&
                (expanded === undefined || expanded === 3)
              ) {
                const size =
                  expanded === 3
                    ? { width, height: tui.terminal.rows - 4 }
                    : geometry.panes[3];
                const cells = getCellDimensions(),
                  maxColumns = Math.max(1, size.width - 2),
                  maxRows = Math.max(1, size.height - 3);
                const scale = Math.min(
                  (maxColumns * cells.widthPx) / 1920,
                  (maxRows * cells.heightPx) / 1080,
                );
                const columns = Math.max(
                    1,
                    Math.floor((1920 * scale) / cells.widthPx),
                  ),
                  rows = Math.max(
                    1,
                    Math.floor((1080 * scale) / cells.heightPx),
                  );
                const left =
                  (expanded === 3 || !geometry.grid
                    ? 0
                    : geometry.panes[0].width + 1) +
                  2 +
                  Math.floor((maxColumns - columns) / 2);
                const top =
                  (expanded === 3
                    ? 3
                    : geometry.grid
                      ? 3 + geometry.panes[0].height + 1
                      : 3 +
                        geometry.panes
                          .slice(0, 3)
                          .reduce((n, p) => n + p.height + 1, 0)) + 3;
                embedded.region({ top, left, columns, rows });
              } else embedded.region(undefined);
              // Portable preview stays in Pi's native image-rendering path.
              let pixels = hd.playing
                ? Array(Math.max(1, geometry?.panes[3].height ?? 1)).fill("")
                : video.snapshot().frame;
              const image = video.snapshot().image;
              const showImage =
                graphics &&
                image &&
                geometry &&
                !healthMode &&
                (expanded === undefined || expanded === 3) &&
                !paused &&
                !hd.playing &&
                !helpMode;
              if (showImage) {
                const size =
                  expanded === 3
                    ? { width, height: Math.max(1, tui.terminal.rows - 4) }
                    : geometry.panes[3];
                const rendered = renderImage(
                  image,
                  { widthPx: 640, heightPx: 360 },
                  {
                    maxWidthCells: Math.max(1, size.width - 2),
                    maxHeightCells: Math.max(1, size.height - 3),
                    imageId,
                    moveCursor: false,
                  },
                );
                if (rendered) {
                  pixels = [
                    rendered.sequence,
                    ...Array(Math.max(0, rendered.rows - 1)).fill(""),
                  ];
                  imageVisible = true;
                }
              } else clearImage();
              const titles = [
                `QUOTES · ${sort.toUpperCase()}`,
                "NEWS / ANALYSIS",
                "ECONOMIC CALENDAR",
                healthMode ? "SOURCE HEALTH" : "BLOOMBERG TV",
              ];
              const empties = [
                "Waiting for quotes",
                config.filter
                  ? `No headlines match: ${config.filter}`
                  : "Waiting for publisher headlines",
                calendarState.error
                  ? `STALE: ${calendarState.error}`
                  : "No upcoming BLS releases",
                "Waiting for sources",
              ];
              const panes: MarketPane[] = titles.map((title, index) => ({
                title,
                rows: rows(index),
                selected: selected[index],
                empty: empties[index],
                wrap: index === 1 || index === 2,
                ...(index === 3 && !healthMode ? { pixels } : {}),
                caption:
                  index === 1
                    ? "Enter: article · a: publisher Key Points · f: expand"
                    : index === 3 && !healthMode
                      ? qualityPlayer.snapshot().playing
                        ? qualityPlayer.snapshot().status
                        : hd.playing
                          ? `${hd.source} · ${hd.paused ? "PAUSED" : hd.frames ? "PLAYING" : "CONNECTING"} · ${hd.muted ? "MUTED · m sound" : `AUDIO ${hd.volume}%`} · f expand`
                          : embeddedSupported
                            ? hd.status
                            : video.snapshot().status
                      : index === 0
                        ? `  ${"SYMBOL".padEnd(10)}${"LAST".padStart(11)} ${"CCY".padEnd(4)}${"DAY %".padStart(10)} SESSION`
                        : index === 2
                          ? calendarState.error
                            ? `STALE: ${calendarState.error}`
                            : "BLS releases · local time"
                          : undefined,
                ...(details &&
                focus === index &&
                ((reading && index === 1) || rows(index)[selected[index]])
                  ? {
                      details:
                        reading && index === 1
                          ? articleLines(reading)
                          : rows(index)[selected[index]].detail,
                      detailOffset,
                    }
                  : {}),
              }));
              const tape = quotes.length
                ? Array.from({ length: quotes.length }, (_, i) => {
                    const q = quotes[(i + tickerOffset) % quotes.length];
                    const change =
                      q.changePct == null
                        ? "?"
                        : `${q.changePct > 0 ? "+" : ""}${q.changePct.toFixed(2)}%`;
                    return `${quoteErrors.has(q.symbol) ? "STALE " : ""}${q.symbol} ${q.price.toFixed(2)} ${q.currency ?? ""} ${change}`;
                  }).join("  │  ")
                : "Waiting for watchlist quotes…";
              const latest = quotes.reduce(
                (n, q) => Math.max(n, Date.parse(q.fetchedAt ?? "") || 0),
                0,
              );
              return renderMarketDashboard({
                width,
                height: Math.max(1, tui.terminal.rows),
                panes,
                focus,
                expanded,
                ticker: tape,
                helpMode,
                title: ` PI / MARKET TERMINAL   ${paused ? "Ⅱ PAUSED" : "● LIVE"}   ↑ ${quotes.filter((q) => (q.changePct ?? 0) > 0).length}  ↓ ${quotes.filter((q) => (q.changePct ?? 0) < 0).length}  — ${quotes.filter((q) => q.changePct === 0).length}   ${new Date().toLocaleTimeString()}`,
                status: inputMode
                  ? `${inputMode === "search" ? "SEARCH symbol/company/headline" : "WATCHLIST symbols separated by spaces"}: ${inputText}▏ · Enter apply · Esc cancel`
                  : `Quotes ${config.stockEvery}s · News ${config.newsEvery}s · ${Intl.DateTimeFormat().resolvedOptions().timeZone} · ${service.health().filter((h) => h.error).length} feed errors · Received ${latest ? `${Math.max(0, Math.floor((Date.now() - latest) / 1000))}s ago` : "pending"} · Feed delays apply${search ? ` · Search: ${search}` : ""}${config.filter ? ` · Filter: ${safeText(config.filter)}` : ""}`,
                help: inputMode
                  ? "Type to edit · Backspace delete · Enter apply · Esc cancel"
                  : details
                    ? "↑↓ scroll details · Enter/Esc back · a Key Points · f expand · o source · h health · g HD player · v preview · q exit"
                    : "1–4 focus  / search  w watchlist  s sort  f expand  v TV  m sound  +/− vol  p pause  ? help  q exit",
                fg: (color, text) =>
                  color === "brand"
                    ? `\x1b[48;2;255;176;0m\x1b[38;2;10;14;20m\x1b[1m${text}\x1b[0m`
                    : color === "selected"
                      ? `\x1b[48;2;26;39;55m${text.replace(/\x1b\[0m/g, "\x1b[0m\x1b[48;2;26;39;55m")}\x1b[0m`
                      : color === "symbol"
                        ? `\x1b[1m${theme.fg("text", text)}\x1b[0m`
                        : color === "newsSource"
                          ? theme.fg("accent", text)
                          : theme.fg(color as any, text),
              });
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            width: "100%",
            maxHeight: "100%",
            anchor: "center",
            margin: 0,
          },
        },
      );
    },
  });
  pi.on("session_shutdown", async () => closeView?.());
  pi.on("session_start", async () => closeView?.());
}
