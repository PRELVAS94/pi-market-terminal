import { base, r, j } from "./runtime.mjs";
import assert from "node:assert/strict";

const { registerTerminal } = await j.import("../terminal.ts");
const { parseCalendar, createCalendarClient } =
  await j.import("../calendar.ts");
const { visibleWidth } = await j.import(
  base + "@earendil-works/pi-tui/dist/index.js",
);
const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20400706T083000
SUMMARY:Jobs report\\, July
URL:https://www.bls.gov/
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=US-Eastern:20400106T083000
SUMMARY:Jobs report winter
END:VEVENT
END:VCALENDAR`;
assert.equal(parseCalendar(ics)[0].at, "2040-01-06T13:30:00.000Z");
assert.equal(parseCalendar(ics)[1].at, "2040-07-06T12:30:00.000Z");
assert.throws(() => parseCalendar("<html>oops</html>"));
const originalFetch = globalThis.fetch;
let fetches = 0,
  fail = false;
globalThis.fetch = async () => {
  fetches++;
  return { ok: !fail, status: fail ? 503 : 200, text: async () => ics };
};
try {
  const client = createCalendarClient();
  await client.refresh();
  assert.equal(client.snapshot().events.length, 2);
  await client.refresh();
  assert.equal(fetches, 1);
  fail = true;
  await client.refresh(true);
  assert.equal(client.snapshot().events.length, 2);
  assert.equal(client.snapshot().error, "HTTP 503");
  fail = false;
  const commands = {},
    events = {};
  let newsCallback;
  let component,
    qs = 0,
    ns = 0,
    disposed = 0,
    refreshes = 0,
    done = 0;
  const config = {
    symbols: ["AAPL"],
    sources: ["source"],
    stockEvery: 60,
    newsEvery: 15,
    filter: "",
  };
  let mutations = [];
  const service = {
    subscribeQuotes(input, fn) {
      qs++;
      fn({
        results: [
          {
            symbol: "AAPL",
            price: 100,
            changePct: 1,
            currency: "USD",
            quoteTime: "2040-01-01",
            marketState: "REGULAR",
          },
        ],
        failures: [],
      });
      return {
        dispose() {
          disposed++;
        },
        refresh() {
          refreshes++;
        },
      };
    },
    subscribeNews(input, fn) {
      newsCallback = fn;
      ns++;
      fn({
        results: [
          {
            title: "Samsung 삼성 headline",
            summary: "Publisher supplied article details for the reader.",
            source: "CNBC",
            url: "https://example.com/story",
            published: new Date().toISOString(),
          },
        ],
        failures: [],
      });
      return {
        dispose() {
          disposed++;
        },
        refresh() {
          refreshes++;
        },
      };
    },
    health: () => [{ kind: "quotes", key: "AAPL", lastSuccess: Date.now() }],
  };
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: {
      notify() {},
      setWidget() {},
      custom: async (factory) => {
        component = factory(
          { requestRender() {}, terminal: { rows: 24 } },
          { fg: (_, s) => s },
          {},
          () => {
            done++;
            component.dispose();
          },
        );
      },
    },
  };
  let playerPlaying = false,
    playerStarts = 0,
    playerStops = 0;
  const fakePlayer = () => ({
    snapshot: () => ({ playing: playerPlaying, status: "Test HQ" }),
    start() {
      playerPlaying = true;
      playerStarts++;
    },
    stop() {
      playerPlaying = false;
      playerStops++;
    },
    dispose() {
      playerPlaying = false;
    },
  });
  let opened = [];
  let videoPlaying = false,
    videoStarts = 0,
    videoStops = 0,
    videoDisposes = 0;
  const fakeVideo = () => ({
    snapshot: () => ({
      playing: videoPlaying,
      frame: [],
      status: "Test video",
    }),
    start() {
      videoPlaying = true;
      videoStarts++;
    },
    stop() {
      videoPlaying = false;
      videoStops++;
    },
    resize() {},
    dispose() {
      videoDisposes++;
    },
  });
  registerTerminal(
    {
      exec: async (command, args) => {
        opened.push([command, args]);
        return { code: 0 };
      },
      registerCommand(n, c) {
        commands[n] = c;
      },
      on(n, c) {
        events[n] = c;
      },
    },
    service,
    () => config,
    undefined,
    {
      autoVideo: false,
      createVideo: fakeVideo,
      createPlayer: fakePlayer,
      updateConfig: (next) => {
        mutations.push(next);
      },
    },
  );
  await commands["market-terminal"].handler("", ctx);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(qs, 1);
  assert.equal(ns, 1);
  for (const width of [0, 1, 20, 80]) {
    const lines = component.render(width);
    assert.equal(lines.length, 24);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
  }
  assert.ok(component.render(100).some((l) => l.includes("AAPL")));
  assert.ok(!commands.terminal, "old command is removed");
  for (const label of ["QUOTES", "NEWS", "CALENDAR", "BLOOMBERG TV"])
    assert.ok(
      component.render(100).some((l) => l.includes(label)),
      label + " visible",
    );
  component.handleInput("\t");
  assert.ok(component.render(100).some((l) => l.includes("삼성")));
  component.handleInput("\r");
  assert.ok(
    component.render(100).some((l) => l.includes("https://example.com/story")),
  );
  component.handleInput("\x1b[B");
  component.handleInput("\x1b[B");
  assert.ok(
    component
      .render(140)
      .some((l) => l.includes("Publisher supplied article details")),
  );
  component.handleInput("o");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(opened.pop()[1][0], "https://example.com/story");
  component.handleInput("4");
  component.handleInput("\r");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(videoStarts, 1);
  component.handleInput("o");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(opened[0][1][0], "https://www.youtube.com/watch?v=QB5BNdBFujE");
  assert.ok(component.render(100).some((l) => l.includes("BLOOMBERG TV *")));
  component.handleInput("\x1b[Z");
  assert.ok(component.render(100).some((l) => l.includes("CALENDAR *")));
  component.handleInput("1");
  newsCallback({
    results: [
      {
        title: "New latest story",
        source: "CNBC",
        url: "https://example.com/new",
        published: new Date(Date.now() + 1000).toISOString(),
      },
      {
        title: "Samsung 삼성 headline",
        summary: "Publisher supplied article details for the reader.",
        source: "CNBC",
        url: "https://example.com/story",
        published: new Date().toISOString(),
      },
    ],
    failures: [],
  });
  component.handleInput("2");
  component.handleInput("\r");
  assert.ok(
    component.render(100).some((l) => l.includes("https://example.com/story")),
    "unfocused headline selection survives new arrivals",
  );
  component.handleInput("\x1b");
  assert.ok(
    component.render(100).some((l) => l.includes("NEWS / ANALYSIS *")),
    "escape returns to pane instead of exiting",
  );
  assert.equal(done, 0);
  for (const title of ["QUOTES", "NEWS", "CALENDAR", "BLOOMBERG TV"])
    assert.ok(
      component.render(80).some((l) => l.includes(title)),
      "compact view retains " + title,
    );
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () =>
      '<script>window.__s_data={"premium":false}</script><div class="RenderKeyPoints-keyPoints"><ul><li>Publisher market context from CNBC.</li></ul></div><div class="ArticleBody-articleBody"><p>' +
      "Readable public article paragraph. ".repeat(10) +
      "</p></div>",
  });
  newsCallback({
    results: [
      {
        title: "CNBC public analysis",
        source: "CNBC",
        url: "https://www.cnbc.com/2026/10/16/story.html",
        published: new Date().toISOString(),
      },
    ],
    failures: [],
  });
  component.handleInput("2");
  component.handleInput("\r");
  await new Promise((r) => setTimeout(r, 5));
  component.handleInput("a");
  component.handleInput("f");
  assert.ok(
    component
      .render(140)
      .some((l) => l.includes("Publisher market context from CNBC.")),
    "publisher Key Points loaded inside terminal",
  );
  component.handleInput("\x1b");
  component.handleInput("\x1b");
  globalThis.fetch = savedFetch;
  component.handleInput("/");
  component.handleInput("notmatching");
  component.handleInput("\r");
  assert.ok(
    component.render(140).some((l) => l.includes("Search: notmatching")),
  );
  component.handleInput("1");
  component.handleInput("\r");
  assert.ok(
    !component.render(140).some((l) => l.includes("Last: 100")),
    "search hides unmatched quotes",
  );
  component.handleInput("/");
  for (let i = 0; i < 11; i++) component.handleInput("\x7f");
  component.handleInput("\r");
  component.handleInput("t");
  assert.equal(mutations.at(-1).stockEvery, 5);
  component.handleInput("w");
  for (let i = 0; i < 4; i++) component.handleInput("\x7f");
  component.handleInput("NVDA MSFT");
  component.handleInput("\r");
  assert.deepEqual(mutations.at(-1).symbols, ["NVDA", "MSFT"]);
  component.handleInput("g");
  assert.equal(playerPlaying, true);
  const startsBeforePause = playerStarts;
  component.handleInput("p");
  assert.equal(playerPlaying, false);
  component.handleInput("g");
  assert.equal(playerStarts, startsBeforePause, "cannot start HQ while paused");
  assert.equal(disposed, 2);
  assert.ok(component.render(80)[0].includes("PAUSED"));
  component.handleInput("p");
  assert.equal(playerPlaying, true, "HQ resumes after pause");
  assert.equal(qs, 2);
  component.handleInput("r");
  assert.equal(refreshes, 2);
  component.handleInput("q");
  assert.equal(done, 1);
  assert.equal(disposed, 4);
  assert.equal(videoDisposes, 1);
  await events.session_shutdown({}, ctx);
  console.log(
    "PASS: BLS timezone/DST parsing, calendar cache and outage retention, terminal width/height, keyboard panes/details/URLs, pause/resume/refresh/close cleanup",
  );
} finally {
  globalThis.fetch = originalFetch;
}
