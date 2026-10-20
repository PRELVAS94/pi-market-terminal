import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Prefer this checkout's peer dependencies; also support Pi's managed install.
const local = createRequire(new URL("../package.json", import.meta.url));
let manifest;
try {
  let directory = dirname(local.resolve("@earendil-works/pi-coding-agent"));
  while (directory !== dirname(directory)) {
    const candidate = join(directory, "package.json");
    if (
      existsSync(candidate) &&
      JSON.parse(readFileSync(candidate, "utf8")).name ===
        "@earendil-works/pi-coding-agent"
    ) {
      manifest = candidate;
      break;
    }
    directory = dirname(directory);
  }
  if (!manifest) throw new Error("Pi package manifest not found");
} catch {
  const install = join(homedir(), ".pi/agent/install");
  const version = readFileSync(join(install, "current-version"), "utf8").trim();
  manifest = join(
    install,
    "releases",
    version,
    "node_modules/@earendil-works/pi-coding-agent/package.json",
  );
  if (!existsSync(manifest))
    throw new Error("Install Pi peer dependencies before running tests");
}
export const r = createRequire(manifest);
export const base = join(manifest, "../../..") + "/";
export const j = r("jiti").createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent":
      base + "@earendil-works/pi-coding-agent/dist/config.js",
    "@earendil-works/pi-tui": base + "@earendil-works/pi-tui/dist/index.js",
    typebox: base + "typebox/build/index.mjs",
  },
});
