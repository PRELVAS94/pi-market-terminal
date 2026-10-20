import { j } from "./runtime.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const { createKittyFrameParser, embeddedPlayerArgs, createEmbeddedPlayer } =
  await j.import("../embedded-player.ts");
const payload = Buffer.from("mpv-kitty-0x123").toString("base64");
const packet = `\x1b_Ga=T,t=s,f=24,s=1920,v=1080,C=1,q=2,m=1;${payload}\x1b\\`;
for (let n = 0; n < packet.length; n++) {
  const frames = [];
  const parse = createKittyFrameParser((f) => frames.push(f));
  parse(packet.slice(0, n));
  parse(packet.slice(n));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].width, 1920);
  assert.equal(
    Buffer.from(frames[0].payload, "base64").toString(),
    "/mpv-kitty-0x123",
    "macOS mpv SHM name normalized for Kitty",
  );
}
const frames = [];
const parse = createKittyFrameParser((f) => frames.push(f));
parse("\x1b[2J\x1b]0;Bad title\x07\x1b_Ga=d;\x1b\\");
assert.equal(frames.length, 0);
parse(packet.replace("s=1920", "s=8000"));
parse(packet.replace(payload, Buffer.from("/etc/passwd").toString("base64")));
assert.equal(frames.length, 0);
parse(packet + packet);
assert.equal(frames.length, 2);
parse(
  packet.replace(
    payload,
    Buffer.from("/mpv-kitty-already-valid").toString("base64"),
  ),
);
assert.equal(
  Buffer.from(frames.at(-1).payload, "base64").toString(),
  "/mpv-kitty-already-valid",
  "valid POSIX name preserved",
);
parse("\x1b_G" + "x".repeat(70000));
parse(packet);
assert.equal(
  frames.length,
  4,
  "oversized packet cannot exhaust pending buffer",
);
const args = embeddedPlayerArgs("/tools/yt-dlp");
for (const value of [
  "--vo=kitty",
  "--vo-kitty-use-shm=yes",
  "--vo-kitty-alt-screen=no",
  "--vo-kitty-config-clear=no",
  "--input-ipc-client=fd://3",
])
  assert.ok(args.includes(value));
assert.ok(
  !args.some((a) => a.includes("fps=") || a.includes("interpolation")),
  "preserve source FPS rather than inventing it",
);
const launches = [];
const writes = [];
let changes = 0;
const spawn = (file, args, opts) => {
  const child = new EventEmitter();
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdio: [null, null, null, new PassThrough()],
    exitCode: null,
    kills: [],
    kill(signal) {
      this.kills.push(signal);
      this.exitCode = 0;
      this.emit("close", 0);
    },
  });
  launches.push({ file, args, opts, child });
  return child;
};
const player = createEmbeddedPlayer(() => changes++, {
  spawn,
  resolveBinary: (n) => n,
  write: (s) => writes.push(s),
  imageId: 987,
});
player.region({ top: 10, left: 40, columns: 80, rows: 24 });
player.start();
assert.equal(launches.length, 1);
player.start();
assert.equal(launches.length, 1, "one player");
const child = launches[0].child;
child.stdout.write("\x1b[2J\x1b_Ga=d;\x1b\\" + packet);
assert.equal(player.snapshot().frames, 1);
assert.equal(writes.length, 1);
assert.ok(writes[0].startsWith("\x1b7\x1b[10;40H"));
assert.ok(writes[0].includes("i=987,c=80,r=24"));
assert.ok(!writes[0].includes("2J"));
assert.ok(!writes[0].includes("a=d"));
player.region(undefined);
assert.ok(writes.at(-1).includes("d=i"));
const before = writes.length;
child.stdout.write(packet);
assert.equal(writes.length, before, "hidden pane receives no frame placement");
player.region({ top: 5, left: 2, columns: 120, rows: 30 });
await new Promise((r) => setTimeout(r, 5));
assert.ok(
  writes.at(-1).includes("a=p"),
  "repaint uses existing image instead of replaying shared-memory path",
);
assert.ok(!writes.at(-1).includes(payload));
player.pause(true);
assert.equal(player.snapshot().paused, true);
player.mute();
assert.equal(player.snapshot().muted, false);
player.volume(1000);
assert.equal(player.snapshot().volume, 100);
player.volume(-1000);
assert.equal(player.snapshot().volume, 0);
player.stop();
assert.equal(player.snapshot().playing, false);
assert.ok(child.kills.includes("SIGTERM"));
assert.ok(writes.at(-1).includes("d=I,i=987"));
const stopped = writes.length;
child.stdout.write(packet);
assert.equal(writes.length, stopped, "late frames ignored");
player.dispose();
const missing = createEmbeddedPlayer(() => {}, {
  resolveBinary: () => undefined,
  write() {},
  imageId: 9,
});
missing.start();
assert.equal(missing.snapshot().playing, false);
assert.match(missing.snapshot().status, /needs mpv/);
missing.dispose();
console.log(
  "PASS: restricted shared-memory parser, arbitrary chunking, 1080p arguments, owned image IDs, placement, visibility, IPC controls, single-player and cleanup",
);
