import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Baked in so a distributed build needs zero setup from the user. The Discord
// Application ID identifies the app and is not a credential, so shipping it in
// the binary (and in a public repo) is expected and safe.
const DEFAULTS = {
  clientId: "1536131379409199104",
  port: 6472,
  defaultCoverKey: null,
  playingIconKey: null,
  pausedIconKey: null,
  idleClearMs: 30_000,
  // Listen Along: advertises a joinable party on the activity card so friends
  // get a Join button. Clicking it opens the same track in their MeowTunes.
  listenAlong: true,
  partyMax: 5,
  // Up to 2, labels max 32 chars, URLs must be http(s). MeowTunes has no
  // per-track permalink (the app never leaves /meowtunes), so these point at
  // the app itself rather than the song. Set to [] to hide them.
  buttons: [
    { label: "Open MeowTunes", url: "https://vasl.social/meowtunes" },
    { label: "Get this for yourself", url: "https://meowtunes.scidev.ir" },
  ],
};

// In a packaged build process.execPath is our own exe; running from source it
// is node itself.
export const isPackaged = !/[\\/]node(\.exe)?$/i.test(process.execPath);

export function appDir() {
  return isPackaged ? dirname(process.execPath) : process.cwd();
}

// An optional config.json next to the executable overrides any default, which
// keeps development flexible without asking end users to configure anything.
export function loadConfig() {
  const override = join(appDir(), "config.json");
  if (!existsSync(override)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(override, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}
