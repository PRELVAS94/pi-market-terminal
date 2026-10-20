import { base, r, j } from "./runtime.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const { createQualityPlayer, qualityPlayerArgs } = await j.import(
  "../quality-player.ts",
);
const args = qualityPlayerArgs("/tools/yt-dlp");
assert.ok(args.includes("--ytdl-format=bestvideo+bestaudio/best"));
assert.ok(args.includes("--vo=gpu-next"));
assert.ok(args.includes("--interpolation=yes"));
assert.ok(
  !args.some((a) => a.includes("fps=60") || a.includes("fps-override")),
  "never label a 30 fps source as native 60 fps",
);
let child,
  count = 0;
const spawn = (command, argv, options) => {
  assert.equal(command, "/tools/mpv");
  assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
  count++;
  child = new EventEmitter();
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kill(signal) {
      this.exitCode = 0;
      this.emit("close", 0);
      return true;
    },
  });
  return child;
};
const player = createQualityPlayer(() => {}, {
  spawn,
  resolveBinary: (n) => "/tools/" + n,
});
player.start();
player.start();
assert.equal(count, 1, "repeated starts do not duplicate windows");
assert.ok(player.snapshot().playing);
child.stdout.write("PI_MARKET_HQ 1920x1080 @ 30 fps\n");
assert.ok(player.snapshot().status.includes("1920x1080 @ 30 fps"));
player.stop();
assert.ok(!player.snapshot().playing);
player.start();
player.dispose();
assert.ok(!player.snapshot().playing);
child.stdout.write("PI_MARKET_HQ 999x999 @ 99 fps");
assert.ok(!player.snapshot().status.includes("999"));
const missing = createQualityPlayer(() => {}, {
  resolveBinary: () => undefined,
});
missing.start();
assert.ok(missing.snapshot().status.includes("needs mpv"));
missing.dispose();
console.log(
  "PASS: maximum source quality, GPU/sync options, truthful source FPS, captured output, single player, status updates and process cleanup",
);
