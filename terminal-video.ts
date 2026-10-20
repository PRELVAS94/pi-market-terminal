import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
export const BLOOMBERG_URL = "https://www.youtube.com/watch?v=QB5BNdBFujE";
export type VideoState = {
  status: string;
  playing: boolean;
  frame: string[];
  frames: number;
  image?: string;
};
/** Bounded PNG framing: chunks may arrive split across arbitrary stdout reads. */
export function takePngFrames(data: Buffer): {
  frames: Buffer[];
  pending: Buffer;
} {
  const frames: Buffer[] = [];
  let offset = 0;
  while (data.length - offset >= 8) {
    if (
      !data
        .subarray(offset, offset + 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Invalid PNG stream");
    let cursor = offset + 8,
      complete = false;
    while (data.length - cursor >= 12) {
      const length = data.readUInt32BE(cursor);
      if (
        length > 4 * 1024 * 1024 ||
        cursor - offset + length > 4 * 1024 * 1024
      )
        throw new Error("PNG frame too large");
      if (data.length - cursor < length + 12) break;
      const end = data.toString("ascii", cursor + 4, cursor + 8) === "IEND";
      cursor += length + 12;
      if (end) {
        frames.push(data.subarray(offset, cursor));
        offset = cursor;
        complete = true;
        break;
      }
    }
    if (!complete) break;
  }
  const pending = data.subarray(offset);
  if (pending.length > 4 * 1024 * 1024) throw new Error("PNG frame too large");
  return { frames, pending };
}
export function rgbFrameLines(
  rgb: Uint8Array,
  width: number,
  height: number,
): string[] {
  if (
    width < 1 ||
    height < 2 ||
    height % 2 ||
    rgb.length !== width * height * 3
  )
    throw new Error("Invalid RGB frame");
  const lines: string[] = [];
  for (let y = 0; y < height; y += 2) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const a = (y * width + x) * 3,
        b = ((y + 1) * width + x) * 3;
      line += `\x1b[38;2;${rgb[a]};${rgb[a + 1]};${rgb[a + 2]}m\x1b[48;2;${rgb[b]};${rgb[b + 1]};${rgb[b + 2]}m▀`;
    }
    lines.push(line + "\x1b[0m");
  }
  return lines;
}
const binary = (name: string) =>
  [
    ...(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ]
    .map((dir) => join(dir, name))
    .find(existsSync);
export function createTerminalVideo(
  onChange: () => void,
  options: {
    spawn?: typeof spawn;
    resolveBinary?: (name: string) => string | undefined;
    graphics?: boolean;
  } = {},
) {
  const launch = options.spawn ?? spawn,
    find = options.resolveBinary ?? binary,
    graphics = options.graphics === true;
  let state: VideoState = {
    status: "v / Enter: start embedded TV · o: browser",
    playing: false,
    frame: [],
    frames: 0,
  };
  let generation = 0,
    child: ChildProcess | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let columns = 64,
    rows = 12,
    streamUrl = "",
    disposed = false;
  const notify = () => {
    if (!disposed) onChange();
  };
  const kill = () => {
    const running = child;
    child = undefined;
    if (running) {
      running.kill("SIGTERM");
      const force = setTimeout(() => {
        if (running.exitCode === null) running.kill("SIGKILL");
      }, 750);
      force.unref();
    }
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const fail = (message: string) => {
    generation++;
    kill();
    state = { ...state, playing: false, status: message };
    notify();
  };
  const decode = (token: number) => {
    if (token !== generation || disposed) return;
    kill();
    const ffmpeg = find("ffmpeg");
    if (!ffmpeg) {
      fail("FFmpeg missing · install ffmpeg · o: browser");
      return;
    }
    const width = columns,
      height = rows * 2,
      bytes = width * height * 3;
    let pending: Buffer = Buffer.alloc(0);
    let sawFrame = false;
    state = {
      ...state,
      status: `Connecting live video… (silent, ${graphics ? 6 : 2} fps)`,
      frame: [],
      image: undefined,
    };
    notify();
    const processChild = launch(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-rw_timeout",
        "15000000",
        "-i",
        streamUrl,
        "-an",
        "-sn",
        "-dn",
        "-vf",
        graphics
          ? "fps=6,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:black"
          : `fps=2,scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgb24,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
        ...(graphics
          ? ["-c:v", "png", "-f", "image2pipe"]
          : ["-pix_fmt", "rgb24", "-f", "rawvideo"]),
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child = processChild;
    const deadline = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (token === generation)
          fail("Stream stalled · v: retry · o: browser");
      }, 25000);
    };
    deadline();
    processChild.stdout?.on("data", (chunk: Buffer) => {
      if (token !== generation || disposed) return;
      pending = Buffer.concat([pending, chunk]);
      let latest: Buffer | undefined;
      if (graphics) {
        try {
          const result = takePngFrames(pending);
          pending = result.pending;
          latest = result.frames.at(-1);
        } catch {
          fail("Invalid video frame · v: retry · o: browser");
          return;
        }
      } else
        while (pending.length >= bytes) {
          latest = pending.subarray(0, bytes);
          pending = pending.subarray(bytes);
        }
      if (latest) {
        sawFrame = true;
        state = {
          playing: true,
          status: graphics
            ? "KITTY PIXELS · 640×360 · 6 fps · silent · g: audio/HQ"
            : "TEXT PREVIEW · 2 fps · g: HD player · v: stop",
          frame: graphics ? [] : rgbFrameLines(latest, width, height),
          ...(graphics ? { image: latest.toString("base64") } : {}),
          frames: state.frames + 1,
        };
        deadline();
        notify();
      }
    });
    processChild.stderr?.on("data", () => {});
    processChild.on("error", () => {
      if (token === generation)
        fail("Video decoder failed · v: retry · o: browser");
    });
    processChild.on("close", () => {
      if (token === generation)
        fail(
          sawFrame
            ? "Stream ended · v: reconnect"
            : "Video connection failed · v: retry · o: browser",
        );
    });
  };
  const stop = () => {
    generation++;
    kill();
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = undefined;
    streamUrl = "";
    state = {
      status: "TV stopped · v / Enter: start · o: browser",
      playing: false,
      frame: [],
      frames: 0,
    };
    notify();
  };
  return {
    snapshot: () => state,
    start() {
      if (disposed) return;
      stop();
      const ytdlp = find("yt-dlp");
      if (!ytdlp) {
        fail("yt-dlp missing · o: browser");
        return;
      }
      if (!find("ffmpeg")) {
        fail("FFmpeg missing · install ffmpeg · o: browser");
        return;
      }
      const token = ++generation;
      state = {
        status: "Resolving Bloomberg stream with yt-dlp…",
        playing: true,
        frame: [],
        frames: 0,
      };
      notify();
      let output = "";
      const processChild = launch(
        ytdlp,
        [
          "--ignore-config",
          "--no-playlist",
          "--no-warnings",
          "--socket-timeout",
          "10",
          "--retries",
          "0",
          "--get-url",
          "-f",
          "worstvideo[protocol^=m3u8]/worstvideo/worst",
          BLOOMBERG_URL,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      child = processChild;
      timer = setTimeout(() => {
        if (token === generation)
          fail("yt-dlp timed out · v: retry · o: browser");
      }, 30000);
      processChild.stdout?.on("data", (chunk: Buffer) => {
        if (output.length < 100000) output += chunk.toString();
      });
      processChild.stderr?.on("data", () => {});
      processChild.on("error", () => {
        if (token === generation) fail("Could not start yt-dlp · o: browser");
      });
      processChild.on("close", (code) => {
        if (token !== generation || disposed) return;
        child = undefined;
        if (timer) clearTimeout(timer);
        timer = undefined;
        try {
          if (code !== 0) throw new Error();
          const url = new URL(output.trim().split(/\r?\n/)[0]);
          if (url.protocol !== "https:") throw new Error();
          streamUrl = url.href;
          decode(token);
        } catch {
          fail("YouTube stream unavailable · v: retry · o: browser");
        }
      });
    },
    stop,
    resize(width: number, height: number) {
      const w = Math.max(8, Math.min(120, Math.floor(width))),
        h = Math.max(2, Math.min(40, Math.floor(height)));
      if (w === columns && h === rows) return;
      columns = w;
      rows = h;
      if (state.playing && streamUrl) {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = undefined;
          const token = ++generation;
          decode(token);
        }, 250);
      }
    },
    dispose() {
      stop();
      disposed = true;
    },
  };
}
