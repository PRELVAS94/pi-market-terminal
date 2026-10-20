import { base, r, j } from "./runtime.mjs";

import assert from "node:assert/strict";

const { renderMarketDashboard, marketGeometry } = await j.import(
  "../market-layout.ts",
);
const { visibleWidth } = await j.import(
  base + "@earendil-works/pi-tui/dist/index.js",
);
const panes = ["QUOTES", "NEWS", "CALENDAR", "FEED HEALTH"].map(
  (title, index) => ({
    title,
    selected: 0,
    empty: "Waiting",
    wrap: index === 1,
    rows: [
      {
        id: "first",
        label: [
          "AAPL 342.00 USD ▼ -0.28%",
          "09:33 CNBC | 삼성 서울 東京 headline readable across two lines",
          "16 Oct BLS economic release",
          "N cnbc-markets STALE age 15s",
        ][index],
        detail: ["Full headline", "https://example.com/article/long-path"],
      },
    ],
  }),
);
const draw = (width, height, focus = 0, items = panes) =>
  renderMarketDashboard({
    width,
    height,
    focus,
    panes: items,
    title: "PI MARKET TERMINAL",
    status: "Live polling · Europe/Lisbon",
    help: "Tab focus · Enter details",
    fg: (_, s) => s,
  });
for (const [width, height] of [
  [140, 38],
  [100, 22],
  [80, 22],
  [80, 38],
  [200, 48],
]) {
  const lines = draw(width, height);
  assert.equal(lines.length, height);
  for (const line of lines) assert.ok(visibleWidth(line) <= width);
  for (const pane of panes)
    assert.ok(
      lines.some((l) => l.includes(pane.title)),
      `${pane.title} at ${width}x${height}`,
    );
  assert.ok(lines.some((l) => l.includes("AAPL")));
  assert.ok(lines.some((l) => l.includes("CNBC")));
  assert.ok(lines.some((l) => l.includes("BLS")));
  assert.ok(lines.some((l) => l.includes("STALE")));
  for (let focus = 0; focus < 4; focus++) {
    const focused = draw(width, height, focus);
    for (const pane of panes)
      assert.ok(focused.some((l) => l.includes(pane.title)));
    assert.ok(focused.some((l) => l.includes(`${panes[focus].title} *`)));
  }
}
assert.equal(marketGeometry(140, 38).grid, true);
assert.equal(marketGeometry(80, 22).grid, false);
for (const [width, height] of [
  [0, 22],
  [1, 22],
  [60, 22],
  [140, 4],
]) {
  const lines = draw(width, height);
  assert.equal(lines.length, height);
  for (const line of lines) assert.ok(visibleWidth(line) <= width);
}
assert.ok(draw(60, 22).some((l) => l.includes("Resize")));
const details = panes.map((pane, index) =>
  index === 1
    ? {
        ...pane,
        details: [
          "A headline\x1b[2J with injected controls",
          "https://example.com/very/long/article/path",
        ],
        detailOffset: 1,
      }
    : pane,
);
const result = draw(80, 22, 1, details);
for (const pane of panes) assert.ok(result.some((l) => l.includes(pane.title)));
assert.ok(result.some((l) => l.includes("https://example.com")));
assert.ok(result.every((l) => !l.includes("\x1b")));
console.log(
  "PASS: all four panes visible in grid and compact stack, independent focus, Unicode/width/height safety, explicit small-window state, pane-local wrapped URL details and sanitization",
);

for (const expanded of [0, 1, 2, 3]) {
  const lines = renderMarketDashboard({
    width: 140,
    height: 38,
    panes,
    focus: expanded,
    expanded,
    title: "Terminal",
    status: "Status",
    help: "f restore",
    fg: (_, s) => s,
  });
  assert.equal(lines.length, 38);
  assert.ok(lines.some((l) => l.includes(panes[expanded].title)));
  for (const line of lines) assert.ok(visibleWidth(line) <= 140);
}
const pixels = ["\x1b[38;2;255;0;0m▀\x1b[0m"];
const videoPanes = panes.map((p, i) => (i === 3 ? { ...p, pixels } : p));
const rendered = draw(140, 38, 3, videoPanes);
assert.ok(
  rendered.some((l) => l.includes("38;2;255;0;0")),
  "trusted generated video colours survive layout",
);
