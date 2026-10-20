import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { BLOOMBERG_URL } from "./terminal-video";

export type VideoRegion = {
  top: number;
  left: number;
  columns: number;
  rows: number;
};
export type EmbeddedState = {
  playing: boolean;
  paused: boolean;
  muted: boolean;
  volume: number;
  frames: number;
  source: string;
  status: string;
};
const findBinary = (name: string) =>
  [
    ...(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ]
    .map((p) => join(p, name))
    .find(existsSync);

/** Extract only complete shared-memory video packets. All terminal controls/logs are discarded. */
export function createKittyFrameParser(
  onFrame: (frame: {
    width: number;
    height: number;
    format: number;
    payload: string;
  }) => void,
) {
  let pending = "";
  return (chunk: Buffer | string) => {
    pending += chunk.toString();
    for (;;) {
      const start = pending.indexOf("\x1b_G");
      if (start < 0) {
        pending = pending.slice(-2);
        return;
      }
      pending = pending.slice(start);
      const end = pending.indexOf("\x1b\\", 3);
      if (end < 0) {
        if (pending.length > 65536) pending = "";
        return;
      }
      const packet = pending.slice(3, end);
      pending = pending.slice(end + 2);
      const semicolon = packet.indexOf(";");
      if (semicolon < 0) continue;
      const fields = Object.fromEntries(
        packet
          .slice(0, semicolon)
          .split(",")
          .map((s) => s.split("=")),
      );
      const width = Number(fields.s),
        height = Number(fields.v),
        format = Number(fields.f),
        payload = packet.slice(semicolon + 1);
      if (
        fields.a !== "T" ||
        fields.t !== "s" ||
        ![24, 32].includes(format) ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 1920 ||
        height > 1080
      )
        continue;
      if (!/^[A-Za-z0-9+/]{1,256}={0,2}$/.test(payload)) continue;
      const name = Buffer.from(payload, "base64").toString("utf8");
      if (!/^\/?mpv-kitty-[a-zA-Z0-9._-]+$/.test(name)) continue;
      // mpv 0.41 on macOS omits the POSIX leading slash; Kitty 0.49 rejects that name.
      const normalizedName = name.startsWith("/") ? name : `/${name}`;
      onFrame({
        width,
        height,
        format,
        payload: Buffer.from(normalizedName, "utf8").toString("base64"),
      });
    }
  };
}
export function embeddedPlayerArgs(ytdlp: string, url = BLOOMBERG_URL) {
  return [
    "--no-config",
    "--profile=sw-fast",
    "--vo=kitty",
    "--vo-kitty-use-shm=yes",
    "--vo-kitty-width=1920",
    "--vo-kitty-height=1080",
    "--vo-kitty-cols=192",
    "--vo-kitty-rows=54",
    "--vo-kitty-alt-screen=no",
    "--vo-kitty-config-clear=no",
    "--input-terminal=no",
    "--input-media-keys=no",
    "--input-ipc-client=fd://3",
    "--osc=no",
    "--osd-level=0",
    "--term-osd=no",
    "--msg-level=all=warn",
    "--hwdec=auto-safe",
    "--mute=yes",
    "--volume=60",
    "--ytdl-format=bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    `--script-opts=ytdl_hook-ytdl_path=${ytdlp}`,
    "--ytdl-raw-options=ignore-config=",
    url,
  ];
}

/** mpv owns decoding/audio. Only bounded Kitty packets reach Pi; never mpv's terminal commands. */
export function createEmbeddedPlayer(
  onChange: () => void,
  options: {
    write: (data: string) => void;
    imageId: number;
    spawn?: typeof spawn;
    resolveBinary?: (name: string) => string | undefined;
    url?: string;
  },
) {
  const launch = options.spawn ?? spawn,
    find = options.resolveBinary ?? findBinary;
  let child: ChildProcess | undefined,
    ipc: Duplex | undefined,
    version = 0,
    disposed = false,
    region: VideoRegion | undefined,
    visible = false,
    hasFrame = false;
  let sourceWidth = 0,
    sourceHeight = 0,
    sourceFps = 0;
  const describeSource = () => {
    state.source =
      sourceWidth && sourceHeight
        ? `${sourceWidth}×${sourceHeight}${sourceFps ? ` @ ${sourceFps.toFixed(2)} fps` : ""}`
        : "Source pending";
  };
  let deadline: ReturnType<typeof setTimeout> | undefined,
    repaint: ReturnType<typeof setTimeout> | undefined;
  let state: EmbeddedState = {
    playing: false,
    paused: false,
    muted: true,
    volume: 60,
    frames: 0,
    source: "Source pending",
    status: "v: 1080p terminal TV · m: sound",
  };
  const notify = () => {
    if (!disposed) onChange();
  };
  const write = (sequence: string) => {
    if (!disposed) options.write(sequence);
  };
  const remove = (free = false) => {
    if (visible || (free && hasFrame))
      write(`\x1b_Ga=d,d=${free ? "I" : "i"},i=${options.imageId},q=2;\x1b\\`);
    visible = false;
  };
  const atRegion = (sequence: string) => {
    if (!region) return;
    write(`\x1b7\x1b[${region.top};${region.left}H${sequence}\x1b8`);
    visible = true;
  };
  const place = () => {
    if (hasFrame && region)
      atRegion(
        `\x1b_Ga=p,i=${options.imageId},c=${region.columns},r=${region.rows},C=1,q=2,z=1;\x1b\\`,
      );
  };
  const send = (command: unknown[]) => {
    if (ipc && !ipc.destroyed) ipc.write(JSON.stringify({ command }) + "\n");
  };
  const kill = () => {
    version++;
    if (deadline) clearTimeout(deadline);
    deadline = undefined;
    if (repaint) clearTimeout(repaint);
    repaint = undefined;
    const previous = child;
    child = undefined;
    ipc = undefined;
    if (previous) {
      previous.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (previous.exitCode === null) previous.kill("SIGKILL");
      }, 1000);
      timer.unref();
    }
    remove(true);
    hasFrame = false;
  };
  const fail = (status: string) => {
    kill();
    state = { ...state, playing: false, paused: false, status };
    notify();
  };
  return {
    snapshot: () => ({
      ...state,
      status: state.playing
        ? `TERMINAL TV · ${state.source} · ${state.paused ? "PAUSED" : state.frames ? "PLAYING" : "CONNECTING"} · ${state.muted ? "MUTED" : "AUDIO"} ${state.volume}%`
        : state.status,
    }),
    start() {
      if (disposed || child) return;
      const mpv = find("mpv"),
        ytdlp = find("yt-dlp");
      if (!mpv || !ytdlp) {
        state = {
          ...state,
          status: "Terminal TV needs mpv + yt-dlp · g: window · o: browser",
        };
        notify();
        return;
      }
      sourceWidth = sourceHeight = sourceFps = 0;
      const token = ++version;
      state = {
        ...state,
        playing: true,
        paused: false,
        frames: 0,
        source: "Source pending",
        status: "Connecting 1080p terminal TV…",
      };
      notify();
      const current = launch(mpv, embeddedPlayerArgs(ytdlp, options.url), {
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      });
      child = current;
      ipc = current.stdio[3] as Duplex;
      let ipcText = "",
        lastNotify = 0;
      const parse = createKittyFrameParser((frame) => {
        if (token !== version || disposed) return;
        if (deadline) clearTimeout(deadline);
        deadline = undefined;
        if (region) {
          atRegion(
            `\x1b_Ga=T,t=s,f=${frame.format},s=${frame.width},v=${frame.height},i=${options.imageId},c=${region.columns},r=${region.rows},C=1,q=2,z=1;${frame.payload}\x1b\\`,
          );
          hasFrame = true;
        }
        state.frames++;
        state.status = `TERMINAL TV · ${state.source} · ${state.muted ? "MUTED" : "AUDIO"} ${state.volume}%`;
        if (Date.now() - lastNotify > 1000 || state.frames === 1) {
          lastNotify = Date.now();
          notify();
        }
      });
      current.stdout?.on("data", parse);
      current.stderr?.on("data", () => {});
      ipc?.on("error", () => {
        if (token === version)
          fail("TV control connection failed · v: retry · g: window");
      });
      ipc?.on("data", (chunk: Buffer) => {
        if (token !== version || disposed) return;
        ipcText += chunk.toString();
        if (ipcText.length > 65536) {
          ipcText = "";
          return;
        }
        let end;
        while ((end = ipcText.indexOf("\n")) >= 0) {
          const line = ipcText.slice(0, end);
          ipcText = ipcText.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (event.event === "property-change") {
              if (event.name === "video-params" && event.data) {
                const { w, h } = event.data;
                if (Number.isFinite(w) && Number.isFinite(h)) {
                  sourceWidth = w;
                  sourceHeight = h;
                  describeSource();
                }
              }
              if (
                event.name === "container-fps" &&
                Number.isFinite(event.data) &&
                event.data > 0
              ) {
                sourceFps = event.data;
                describeSource();
              }
              if (event.name === "pause") state.paused = event.data === true;
              if (event.name === "mute") state.muted = event.data === true;
              if (event.name === "volume" && Number.isFinite(event.data))
                state.volume = Math.round(event.data);
              notify();
            }
          } catch {
            /* Non-JSON diagnostics never reach the screen. */
          }
        }
      });
      for (const property of [
        "video-params",
        "container-fps",
        "pause",
        "mute",
        "volume",
      ])
        send([
          "observe_property",
          ["video-params", "container-fps", "pause", "mute", "volume"].indexOf(
            property,
          ) + 1,
          property,
        ]);
      send(["set_property", "mute", state.muted]);
      send(["set_property", "volume", state.volume]);
      current.on("error", () => {
        if (token === version)
          fail("Could not launch terminal TV · g: window · o: browser");
      });
      current.on("close", (code) => {
        if (token === version)
          fail(
            code === 0
              ? "Terminal TV ended · v: reconnect"
              : "Terminal TV failed · v: retry · g: window",
          );
      });
      deadline = setTimeout(() => {
        if (token === version)
          fail("Terminal TV timed out · v: retry · g: window");
      }, 45000);
      deadline.unref();
    },
    region(next: VideoRegion | undefined) {
      if (
        next &&
        (!Number.isInteger(next.top) ||
          !Number.isInteger(next.left) ||
          !Number.isInteger(next.columns) ||
          !Number.isInteger(next.rows) ||
          next.top < 1 ||
          next.left < 1 ||
          next.columns < 1 ||
          next.rows < 1)
      )
        next = undefined;
      const changed = JSON.stringify(region) !== JSON.stringify(next);
      if (changed) remove();
      region = next;
      // Pi paints the text first. Re-place already-uploaded pixels afterward, without replaying a shared-memory filename.
      if (repaint) clearTimeout(repaint);
      repaint = setTimeout(() => {
        repaint = undefined;
        if (!disposed) place();
      }, 0);
    },
    pause(value: boolean) {
      if (!child) return;
      state.paused = value;
      send(["set_property", "pause", value]);
      notify();
    },
    mute() {
      state.muted = !state.muted;
      send(["set_property", "mute", state.muted]);
      notify();
    },
    volume(delta: number) {
      state.volume = Math.max(0, Math.min(100, state.volume + delta));
      send(["set_property", "volume", state.volume]);
      notify();
    },
    stop() {
      kill();
      state = {
        ...state,
        playing: false,
        paused: false,
        frames: 0,
        status: "Terminal TV stopped · v: play",
      };
      notify();
    },
    dispose() {
      if (disposed) return;
      kill();
      disposed = true;
    },
  };
}
