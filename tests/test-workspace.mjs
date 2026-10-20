import { j, base } from "./runtime.mjs";
import assert from "node:assert/strict";
const { registerTerminal } = await j.import("../terminal.ts");
const { visibleWidth, stripTerminalSequences } = await j.import(
  base + "@earendil-works/pi-tui/dist/index.js",
);
const fetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 503 });
try {
  let command,
    component,
    newsCallback,
    hdPlaying = false,
    hdPaused = false,
    hdStarts = 0,
    hdStops = 0,
    hdDisposes = 0,
    volume = 60,
    muted = true,
    region;
  const none = () => ({ dispose() {}, refresh() {} });
  const service = {
    health: () => [],
    subscribeQuotes(_c, fn) {
      fn({
        results: [
          { symbol: "AAA", name: "Alpha", price: 100, changePct: -2 },
          { symbol: "BBB", name: "Beta", price: 50, changePct: 4 },
        ],
        failures: [],
      });
      return none();
    },
    subscribeNews(_c, fn) {
      newsCallback = fn;
      fn({
        results: [
          {
            title: "First story",
            source: "News",
            url: "https://example.com/story",
            published: new Date().toISOString(),
          },
        ],
        failures: [],
      });
      return none();
    },
  };
  const createEmbedded = () => ({
    snapshot: () => ({
      playing: hdPlaying,
      paused: hdPaused,
      muted,
      volume,
      frames: 100,
      source: "1920×1080 @ 29.97 fps",
      status: "TV ready",
    }),
    start() {
      hdStarts++;
      hdPlaying = true;
    },
    stop() {
      hdStops++;
      hdPlaying = false;
    },
    region: (r) => (region = r),
    pause: (p) => (hdPaused = p),
    mute() {
      muted = !muted;
    },
    volume: (d) => (volume += d),
    dispose() {
      hdDisposes++;
    },
  });
  let previewStarts = 0;
  const createVideo = () => ({
    snapshot: () => ({ playing: false, frame: [], status: "Fallback" }),
    resize() {},
    start() {
      previewStarts++;
    },
    stop() {},
    dispose() {},
  });
  let nativePlaying = false;
  const createPlayer = () => ({
    snapshot: () => ({ playing: nativePlaying, status: "Window" }),
    start() {
      nativePlaying = true;
    },
    stop() {
      nativePlaying = false;
    },
    dispose() {},
  });
  registerTerminal(
    {
      registerCommand(_n, c) {
        command = c;
      },
      on() {},
    },
    service,
    () => ({
      symbols: ["AAA", "BBB"],
      sources: ["feed"],
      stockEvery: 5,
      newsEvery: 15,
    }),
    undefined,
    {
      autoVideo: false,
      embeddedSupported: true,
      createEmbedded,
      createVideo,
      createPlayer,
    },
  );
  const terminal = { rows: 40, write() {} };
  await command.handler("", {
    hasUI: true,
    mode: "tui",
    ui: {
      notify() {},
      custom: async (factory) => {
        component = factory(
          { terminal, requestRender() {} },
          { fg: (_, s) => s },
          {},
          () => {},
        );
      },
    },
  });
  component.handleInput("v");
  assert.equal(hdStarts, 1);
  assert.equal(previewStarts, 0);
  component.render(140);
  assert.ok(region && region.top > 1 && region.left > 1);
  for (const [width, height] of [
    [80, 24],
    [100, 24],
    [140, 40],
    [180, 50],
  ]) {
    terminal.rows = height;
    const lines = component.render(width);
    assert.equal(lines.length, height);
    assert.ok(lines.every((l) => visibleWidth(l) <= width));
    assert.ok(region.top + region.rows - 1 < height);
    assert.ok(region.left + region.columns - 1 <= width);
  }
  terminal.rows = 40;
  component.handleInput("4");
  component.handleInput("f");
  component.render(140);
  assert.equal(region.top, 6);
  assert.ok(region.columns > 100);
  component.handleInput("1");
  component.handleInput("f");
  component.render(140);
  assert.equal(region, undefined, "expanded quotes hide TV");
  component.handleInput("4");
  component.handleInput("m");
  assert.equal(muted, false);
  component.handleInput("+");
  assert.equal(volume, 65);
  component.handleInput("-");
  assert.equal(volume, 60);
  component.handleInput("p");
  assert.equal(hdPaused, true);
  component.handleInput("p");
  assert.equal(hdPaused, false);
  assert.equal(hdStarts, 1, "pause resumes same process");
  component.handleInput("?");
  assert.ok(
    component
      .render(140)
      .some((l) => l.includes("KEYBOARD / MARKET WORKSPACE")),
  );
  assert.equal(region, undefined);
  component.handleInput("\x1b");
  component.render(140);
  assert.ok(region);
  component.handleInput("s");
  component.handleInput("1");
  assert.ok(component.render(140).some((l) => l.includes("GAINERS")));
  assert.ok(
    component
      .render(140)
      .some((l) => stripTerminalSequences(l).includes("> AAA")),
    "sort preserves the selected instrument",
  );
  component.handleInput("g");
  assert.equal(hdPlaying, false);
  assert.equal(nativePlaying, true);
  component.handleInput("v");
  assert.equal(nativePlaying, false);
  assert.equal(hdPlaying, true);
  component.handleInput("q");
  assert.equal(hdDisposes, 1);
  console.log(
    "PASS: 1080p dashboard integration, region bounds/resize/expand, same-process pause, audio, help, sorting and exclusive player modes",
  );
} finally {
  globalThis.fetch = fetch;
}
