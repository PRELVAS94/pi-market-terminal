import { j, base } from "./runtime.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
const { createTerminalVideo, takePngFrames } = await j.import(
  "../terminal-video.ts",
);
const { renderMarketDashboard } = await j.import("../market-layout.ts");
const { renderImage, setCapabilities, allocateImageId, visibleWidth } =
  await j.import(base + "@earendil-works/pi-tui/dist/index.js");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=",
  "base64",
);
for (let n = 0; n < png.length; n++) {
  const a = takePngFrames(png.subarray(0, n));
  assert.equal(a.frames.length, 0);
  const b = takePngFrames(Buffer.concat([a.pending, png.subarray(n), png]));
  assert.equal(b.frames.length, 2);
  assert.equal(b.pending.length, 0);
}
assert.throws(() => takePngFrames(Buffer.alloc(8)));
const bad = Buffer.from(png);
bad.writeUInt32BE(5 * 1024 * 1024, 8);
assert.throws(() => takePngFrames(bad));
const launches = [];
const spawn = (file, args) => {
  const child = new EventEmitter();
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kill() {
      this.exitCode = 0;
      this.emit("close", 0);
    },
  });
  launches.push({ file, args, child });
  return child;
};
const video = createTerminalVideo(() => {}, {
  spawn,
  resolveBinary: (n) => n,
  graphics: true,
});
video.start();
launches[0].child.stdout.write("https://example.com/live.m3u8\n");
launches[0].child.emit("close", 0);
assert.ok(launches[1].args.includes("image2pipe"));
assert.ok(launches[1].args.some((a) => a.includes("fps=6")));
launches[1].child.stdout.write(png.subarray(0, 22));
assert.equal(video.snapshot().frames, 0);
launches[1].child.stdout.write(Buffer.concat([png.subarray(22), png]));
assert.equal(video.snapshot().image, png.toString("base64"));
assert.equal(video.snapshot().frame.length, 0);
assert.match(video.snapshot().status, /KITTY PIXELS/);
setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
for (const [width, height] of [
  [140, 38],
  [80, 38],
  [180, 48],
]) {
  const image = renderImage(
    video.snapshot().image,
    { widthPx: 640, heightPx: 360 },
    {
      maxWidthCells: 30,
      maxHeightCells: 3,
      imageId: allocateImageId(),
      moveCursor: false,
    },
  );
  const panes = Array.from({ length: 4 }, (_, i) => ({
    title: "Test",
    rows: [],
    selected: 0,
    empty: "Empty",
    ...(i === 3 ? { pixels: [image.sequence, "", ""] } : {}),
  }));
  const lines = renderMarketDashboard({
    width,
    height,
    title: "Title",
    status: "Status",
    panes,
    focus: 3,
    help: "Help",
    fg: (_, text) => text,
  });
  assert.ok(
    lines.some((l) => l.includes(image.sequence)),
    "complete graphics protocol survives pane layout",
  );
  assert.ok(lines.every((l) => visibleWidth(l) <= width));
}
video.stop();
assert.equal(video.snapshot().image, undefined);
launches[1].child.stdout.write(png);
assert.equal(video.snapshot().image, undefined);
video.dispose();
console.log(
  "PASS: bounded PNG framing, partial/multiple frames, Kitty decode mode, protocol survives pane layout, stop and late frame cleanup",
);
// Exercise the actual dashboard integration, including placement removal on navigation.
const { registerTerminal } = await j.import("../terminal.ts");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 503 });
try {
  let component,
    command,
    graphicsRequested = false;
  const writes = [];
  const fakeVideo = (_onChange, opts) => {
    graphicsRequested = opts.graphics;
    return {
      snapshot: () => ({
        playing: true,
        status: "Pixels",
        frame: [],
        image: png.toString("base64"),
      }),
      resize() {},
      start() {},
      stop() {},
      dispose() {},
    };
  };
  const sub = () => ({ dispose() {}, refresh() {} });
  registerTerminal(
    {
      registerCommand(_n, c) {
        command = c;
      },
      on() {},
    },
    { subscribeQuotes: sub, subscribeNews: sub, health: () => [] },
    () => ({
      symbols: ["AAPL"],
      sources: ["fed"],
      stockEvery: 5,
      newsEvery: 15,
    }),
    undefined,
    {
      autoVideo: false,
      createVideo: fakeVideo,
      createPlayer: () => ({
        snapshot: () => ({ playing: false, status: "" }),
        start() {},
        stop() {},
        dispose() {},
      }),
    },
  );
  await command.handler("", {
    hasUI: true,
    mode: "tui",
    ui: {
      notify() {},
      custom: async (factory) => {
        component = factory(
          {
            requestRender() {},
            terminal: { rows: 40, write: (s) => writes.push(s) },
          },
          { fg: (_, s) => s },
          {},
          () => {},
        );
      },
    },
  });
  assert.equal(graphicsRequested, true);
  assert.ok(component.render(140).some((l) => l.includes("\x1b_G")));
  component.handleInput("h");
  component.render(140);
  assert.ok(
    writes.some((s) => s.includes("a=d")),
    "health view clears image",
  );
  component.handleInput("h");
  component.handleInput("4");
  component.handleInput("f");
  assert.ok(component.render(140).some((l) => l.includes("\x1b_G")));
  component.handleInput("1");
  component.handleInput("f");
  component.render(140);
  assert.equal(writes.length, 2, "expanding another pane clears image");
  component.handleInput("4");
  component.render(140);
  component.handleInput("q");
  assert.equal(writes.length, 3, "close deletes only owned image");
  console.log(
    "PASS: dashboard enables graphics, embeds protocol, removes image on health/other pane expansion/close",
  );
} finally {
  globalThis.fetch = originalFetch;
}
