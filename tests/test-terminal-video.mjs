import { base, r, j } from "./runtime.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const { rgbFrameLines, createTerminalVideo } = await j.import(
  "../terminal-video.ts",
);
const frame = rgbFrameLines(Uint8Array.from([255, 0, 0, 0, 255, 0]), 1, 2);
assert.equal(frame.length, 1);
assert.ok(frame[0].includes("38;2;255;0;0"));
assert.ok(frame[0].includes("48;2;0;255;0"));
assert.throws(() => rgbFrameLines(new Uint8Array(1), 1, 2));
let launches = [],
  changes = 0;
const fakeSpawn = (file, args) => {
  const child = new EventEmitter();
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    kills: [],
    kill(signal) {
      this.kills.push(signal);
      this.exitCode = 0;
      this.emit("close", 0);
      return true;
    },
  });
  launches.push({ file, args, child });
  return child;
};
const v = createTerminalVideo(() => changes++, {
  spawn: fakeSpawn,
  resolveBinary: (n) => "/tools/" + n,
});
v.resize(8, 2);
v.start();
assert.equal(launches.length, 1);
assert.ok(launches[0].args.includes("--ignore-config"));
assert.ok(
  launches[0].args.includes("worstvideo[protocol^=m3u8]/worstvideo/worst"),
);
launches[0].child.stdout.write("https://video.example/live.m3u8\n");
launches[0].child.exitCode = 0;
launches[0].child.emit("close", 0);
assert.equal(launches.length, 2);
assert.equal(launches[1].file, "/tools/ffmpeg");
assert.ok(launches[1].args.includes("-an"));
const raw = Buffer.alloc(8 * 4 * 3, 127);
launches[1].child.stdout.write(raw.subarray(0, 13));
assert.equal(v.snapshot().frames, 0);
launches[1].child.stdout.write(raw.subarray(13));
assert.equal(v.snapshot().frames, 1);
assert.equal(v.snapshot().frame.length, 2);
v.resize(12, 3);
await new Promise((r) => setTimeout(r, 280));
assert.equal(launches.length, 3);
assert.ok(launches[1].child.kills.includes("SIGTERM"));
assert.ok(launches[2].args.some((a) => a.includes("scale=12:6")));
v.stop();
assert.equal(v.snapshot().playing, false);
assert.equal(v.snapshot().frame.length, 0);
launches[2].child.stdout.write(raw);
assert.equal(v.snapshot().frames, 0, "late frames ignored");
v.dispose();
const missing = createTerminalVideo(() => {}, {
  resolveBinary: () => undefined,
});
missing.start();
assert.ok(missing.snapshot().status.includes("yt-dlp missing"));
missing.dispose();
const invalid = createTerminalVideo(() => {}, {
  spawn: fakeSpawn,
  resolveBinary: (n) => n,
});
invalid.start();
const child = launches.at(-1).child;
child.stdout.write("file:///etc/passwd");
child.exitCode = 0;
child.emit("close", 0);
assert.equal(invalid.snapshot().playing, false);
assert.ok(invalid.snapshot().status.includes("unavailable"));
invalid.dispose();
console.log(
  "PASS: RGB half-block rendering, resolver/decoder arguments, chunked frames, resize restart, stop/late-frame guard, missing tools and non-HTTPS rejection",
);
