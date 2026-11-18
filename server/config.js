import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULTS = {
  clientId: "1536131379409199104", // an app id, not a credential; safe to ship
  port: 6472,
  defaultCoverKey: "default_cover",
  playingIconKey: "playing",
  pausedIconKey: "paused",
  idleClearMs: 30_000,
  listenAlong: false, // replaces the buttons with a Join button that only friends can see
  partyMax: 5,
  // Max 2, labels up to 32 chars. The first one turns into the current artist's page when known.
  buttons: [
    { label: "Open MeowTunes", url: "https://vasl.social/meowtunes" },
    { label: "Get this for yourself", url: "https://meowtunes.scidev.ir" },
  ],
};

export const isPackaged = !/[\\/]node(\.exe)?$/i.test(process.execPath);

export function appDir() {
  return isPackaged ? dirname(process.execPath) : process.cwd();
}

export function loadConfig() {
  const override = join(appDir(), "config.json");
  if (!existsSync(override)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(override, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}
