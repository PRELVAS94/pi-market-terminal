import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BLOOMBERG_URL } from "./terminal-video";
const findBinary = (name: string) =>
  [
    ...(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ]
    .map((p) => join(p, name))
    .find(existsSync);
export function qualityPlayerArgs(ytdlp: string) {
  return [
    "--no-config",
    "--force-window=yes",
    "--title=Bloomberg TV — maximum source quality",
    "--hwdec=auto-safe",
    "--vo=gpu-next",
    "--video-sync=display-resample",
    "--interpolation=yes",
    "--tscale=oversample",
    "--ytdl-format=bestvideo+bestaudio/best",
    `--script-opts=ytdl_hook-ytdl_path=${ytdlp}`,
    "--ytdl-raw-options=ignore-config=",
    "--input-terminal=no",
    "--msg-level=all=warn,cplayer=info,term-msg=info",
    "--term-playing-msg=PI_MARKET_HQ ${video-params/w}x${video-params/h} @ ${container-fps} fps",
    BLOOMBERG_URL,
  ];
}
/** Native GPU window, with captured output so it cannot corrupt Pi's terminal. */
export function createQualityPlayer(
  onChange: () => void,
  options: {
    spawn?: typeof spawn;
    resolveBinary?: (name: string) => string | undefined;
  } = {},
) {
  const launch = options.spawn ?? spawn,
    find = options.resolveBinary ?? findBinary;
  let child: ChildProcess | undefined,
    version = 0,
    disposed = false,
    status = "g: maximum quality + audio (separate GPU window)",
    playing = false;
  const notify = () => {
    if (!disposed) onChange();
  };
  const stop = () => {
    version++;
    const previous = child;
    child = undefined;
    if (previous) {
      previous.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (previous.exitCode === null) previous.kill("SIGKILL");
      }, 1000);
      timer.unref();
    }
    playing = false;
    status = "HQ player closed · g: open maximum quality";
    notify();
  };
  return {
    snapshot: () => ({ status, playing }),
    start() {
      if (disposed) return;
      if (child) return;
      const mpv = find("mpv"),
        ytdlp = find("yt-dlp");
      if (!mpv || !ytdlp) {
        status = "HQ needs mpv and yt-dlp · o: browser";
        notify();
        return;
      }
      const token = ++version;
      status = "Opening maximum-quality GPU player…";
      playing = true;
      notify();
      let text = "";
      const current = launch(mpv, qualityPlayerArgs(ytdlp), {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = current;
      current.stdout?.on("data", (chunk: Buffer) => {
        if (token !== version || disposed) return;
        text = (text + chunk.toString()).slice(-8000);
        const match = text.match(/PI_MARKET_HQ ([^\r\n]+)/);
        if (match) {
          status = `HQ: ${match[1]} · native window · display-synced`;
          notify();
        }
      });
      current.stderr?.on("data", () => {});
      current.on("error", () => {
        if (token !== version) return;
        child = undefined;
        playing = false;
        status = "HQ player could not launch · o: browser";
        notify();
      });
      current.on("close", (code) => {
        if (token !== version) return;
        child = undefined;
        playing = false;
        status =
          code === 0
            ? "HQ player closed · g: reopen"
            : "HQ playback failed · g: retry · o: browser";
        notify();
      });
    },
    stop,
    dispose() {
      disposed = true;
      stop();
    },
  };
}
