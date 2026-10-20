// Headless integration check: actual mpv frames are decoded by Kitty's native graphics parser.
// No desktop window, UI automation, settings changes or network access.
import { j } from "../tests/runtime.mjs";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { createEmbeddedPlayer } = await j.import("../embedded-player.ts");
const fixture = mkdtempSync(join(tmpdir(), "pi-kitty-transfer-"));
const clip = join(fixture, "source.mp4");
let receiver, player;
try {
  const generated = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1920x1080:rate=30",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-y",
      clip,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    generated.status,
    0,
    generated.stderr || "FFmpeg is required for the native transfer test",
  );
  const kitty =
    process.env.PI_TEST_KITTY ?? "/Applications/kitty.app/Contents/MacOS/kitty";
  const script = fileURLToPath(
    new URL("../tests/kitty-transfer-receiver.py", import.meta.url),
  );
  receiver = spawn(
    kitty,
    ["+runpy", `import runpy; runpy.run_path(${JSON.stringify(script)})`],
    {
      env: { ...process.env, KITTY_CACHE_DIRECTORY: join(fixture, "cache") },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise((resolve) => receiver.once("close", resolve));
  let good = 0,
    bad = 0,
    removed = false,
    lines = "",
    diagnostics = "";
  let failed;
  receiver.on("error", (error) => (failed = error));
  receiver.stdin.on("error", (error) => (failed = error));
  receiver.stderr.on("data", (data) => {
    diagnostics = (diagnostics + data).slice(-4000);
  });
  receiver.stdout.on("data", (chunk) => {
    lines += chunk;
    let end;
    while ((end = lines.indexOf("\n")) >= 0) {
      const raw = lines.slice(0, end);
      lines = lines.slice(end + 1);
      const state = JSON.parse(raw);
      if (
        state.image?.bytes === 1920 * 1080 * 3 &&
        state.image.nonzero &&
        state.image["refs.count"] === 1
      )
        good++;
      if (/;(?:E[A-Z]+):/.test(state.replies.join(""))) bad++;
      if (good && state.image === null) removed = true;
    }
  });
  player = createEmbeddedPlayer(() => {}, {
    imageId: 2222,
    url: clip,
    spawn: (file, args, opts) =>
      spawn(
        file,
        [...args.slice(0, -1), "--ao=null", "--loop-file=inf", args.at(-1)],
        opts,
      ),
    write: (data) => receiver.stdin.write(data.replaceAll("q=2", "q=0")),
  });
  player.region({ top: 5, left: 2, columns: 100, rows: 30 });
  player.start();
  for (let n = 0; n < 80 && good < 10 && !failed; n++)
    await new Promise((r) => setTimeout(r, 50));
  player.stop();
  receiver.stdin.end();
  await closed;
  if (failed) throw failed;
  assert.equal(bad, 0, diagnostics);
  assert.ok(good >= 10, `Only ${good} accepted frames. ${diagnostics}`);
  assert.ok(removed, "Owned image must be removed on stop");
  console.log(
    `PASS: Kitty natively accepted ${good} non-black 1920×1080 mpv frames, reported zero graphics errors, maintained one placement and removed the image on stop`,
  );
} finally {
  player?.dispose();
  receiver?.kill();
  rmSync(fixture, { recursive: true, force: true });
}
