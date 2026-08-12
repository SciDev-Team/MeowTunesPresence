import { readSync } from "node:fs";
import { WebSocketServer } from "ws";
import { Client } from "@xhayper/discord-rpc";
import { loadConfig, isPackaged } from "./config.js";
import { log, setLogFile } from "./log.js";
import { install, uninstall, isInstalled, isInstalledCopy, launchDetached, logPath } from "./install.js";

const config = loadConfig();

const PORT = config.port ?? 6472;
const IDLE_CLEAR_MS = config.idleClearMs ?? 30_000;
const DEFAULT_COVER = config.defaultCoverKey || null;
const PLAYING_ICON = config.playingIconKey || null;
const PAUSED_ICON = config.pausedIconKey || null;

// Discord accepts at most 2 buttons, labels up to 32 chars, http(s) only.
// Anything malformed makes the whole setActivity call fail, so filter here once
// rather than letting a bad config break every update.
const BUTTONS = (Array.isArray(config.buttons) ? config.buttons : [])
  .filter((b) => b && typeof b.label === "string" && /^https?:\/\//i.test(b.url ?? ""))
  .slice(0, 2)
  .map((b) => ({ label: b.label.trim().slice(0, 32), url: b.url }));

// Discord rate-limits SET_ACTIVITY to roughly 5 requests per 20 seconds.
// Everything funnels through a coalescer that holds at most one pending update.
const MIN_UPDATE_INTERVAL_MS = 3_000;
const RECONNECT_DELAY_MS = 10_000;
const RPC_TIMEOUT_MS = 5_000;

/* ------------------------------------------------------------------ *
 * Startup mode
 *
 * Packaged builds double as their own installer: the first run (from wherever
 * the user downloaded it) copies the exe into LOCALAPPDATA, registers a hidden
 * Startup entry, hands off to that copy and exits. Every later run comes from
 * the Startup entry with --service and goes straight to serving.
 * ------------------------------------------------------------------ */

const flags = new Set(process.argv.slice(2));

// Synchronous by necessity: the bundle compiles to CommonJS for Node SEA,
// which cannot represent top-level await.
function pause() {
  if (!process.stdin.isTTY) return;
  process.stdout.write("\n  Press Enter to close...");
  try {
    readSync(0, Buffer.alloc(1));
  } catch {
    /* no readable stdin, just exit */
  }
}

if (flags.has("--uninstall")) {
  const removed = uninstall();
  console.log(
    removed.length ? `\n  Removed: ${removed.join(", ")}\n` : "\n  Nothing to remove. It was not installed.\n"
  );
  pause();
  process.exit(0);
}

if (isPackaged && !flags.has("--service") && !isInstalledCopy()) {
  const alreadyInstalled = isInstalled();
  try {
    const target = install();
    launchDetached(target);
    console.log(
      [
        "",
        `  MeowTunes Presence ${alreadyInstalled ? "updated" : "installed"}.`,
        "",
        "  It is running now and will start automatically with Windows.",
        "  Next: install the browser extension, then play something on MeowTunes.",
        "",
        `  Log file: ${logPath()}`,
        "  To remove it, run this file again with:  --uninstall",
        "",
      ].join("\n")
    );
  } catch (err) {
    console.error(`\n  Install failed: ${err.message}\n`);
    pause();
    process.exit(1);
  }
  pause();
  process.exit(0);
}

if (isPackaged) setLogFile(logPath());

if (!config.clientId || config.clientId.startsWith("PUT_YOUR")) {
  console.error(
    [
      "",
      "  Discord Application ID is not set.",
      "",
      "  1. Go to https://discord.com/developers/applications",
      '  2. New Application -> name it "MeowTunes"',
      "     (this name is what shows up after \"Listening to\")",
      "  3. Put the Application ID in server/config.js (DEFAULTS.clientId)",
      "",
    ].join("\n")
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Discord RPC connection
 * ------------------------------------------------------------------ */

let client = null;
let ready = false;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectDiscord();
  }, RECONNECT_DELAY_MS);
}

async function connectDiscord() {
  if (ready || client) return;

  const c = new Client({ clientId: config.clientId });
  client = c;

  c.on("ready", () => {
    ready = true;
    const tag = c.user?.username ?? "unknown";
    log(`Connected to Discord as ${tag}`);
    // Re-apply whatever the browser last told us, so restarting Discord
    // does not leave the presence blank until the next track change.
    if (lastPayload) applyPayload(lastPayload);
  });

  c.on("disconnected", () => {
    log("Discord disconnected, will retry...");
    ready = false;
    client = null;
    lastActivity = null;
    scheduleReconnect();
  });

  try {
    await c.login();
  } catch (err) {
    // Almost always "Discord is not running". Stay quiet-ish and keep trying.
    ready = false;
    client = null;
    lastActivity = null;
    log(`Cannot reach Discord (${err.message}). Retrying in ${RECONNECT_DELAY_MS / 1000}s.`);
    scheduleReconnect();
  }
}

/* ------------------------------------------------------------------ *
 * Activity building
 * ------------------------------------------------------------------ */

const NBSP = " ";

// Discord rejects details/state shorter than 2 chars and longer than 128.
function clampField(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 128) return trimmed.slice(0, 127) + "…";
  if (trimmed.length < 2) return trimmed + NBSP;
  return trimmed;
}

function buildActivity(p) {
  const activity = {
    type: 2, // Listening -> renders as "Listening to <app name>"
    details: clampField(p.title) ?? "Unknown track",
    state: clampField(p.artist) ?? "Unknown artist",
  };

  const cover = p.artwork || DEFAULT_COVER;
  if (cover) {
    // External https URLs are accepted for image keys, so CDN artwork works
    // without uploading anything to the developer portal.
    activity.largeImageKey = cover;
    const album = clampField(p.album);
    const label = p.paused ? `${album ?? "MeowTunes"} • Paused` : album;
    if (label) activity.largeImageText = clampField(label);
  }

  const smallIcon = p.paused ? PAUSED_ICON : PLAYING_ICON;
  if (smallIcon) {
    activity.smallImageKey = smallIcon;
    activity.smallImageText = p.paused ? "Paused" : "Playing";
  }

  // Discord does not render buttons on the profile of the user who set them.
  // Only other people see them.
  if (BUTTONS.length) activity.buttons = BUTTONS;

  // Timestamps are what give Discord the moving progress bar. While paused we
  // omit them entirely, otherwise the bar keeps running on a stopped track.
  if (!p.paused && Number.isFinite(p.position) && Number.isFinite(p.duration) && p.duration > 0) {
    const start = Date.now() - Math.max(0, p.position) * 1000;
    activity.startTimestamp = Math.round(start);
    activity.endTimestamp = Math.round(start + p.duration * 1000);
  }

  return activity;
}

// The extension heartbeats every 10s even when nothing changed, so dedupe has
// to be solid. startTimestamp is derived (now - position) and jitters by a few
// milliseconds each time, which rounding alone can flap across a boundary --
// compare it with a tolerance instead. 2s matches the seek threshold the
// extension already applies, so nothing a user would notice gets swallowed.
const TIMESTAMP_TOLERANCE_MS = 2_000;
const COMPARED_FIELDS = [
  "type",
  "details",
  "state",
  "largeImageKey",
  "largeImageText",
  "smallImageKey",
  "smallImageText",
];

function sameActivity(a, b) {
  if (!a || !b) return false;
  for (const key of COMPARED_FIELDS) {
    if (a[key] !== b[key]) return false;
  }
  if (JSON.stringify(a.buttons ?? null) !== JSON.stringify(b.buttons ?? null)) return false;
  const aStart = a.startTimestamp ?? 0;
  const bStart = b.startTimestamp ?? 0;
  // One playing and one paused is always a real change.
  if (!aStart !== !bStart) return false;
  return Math.abs(aStart - bStart) <= TIMESTAMP_TOLERANCE_MS;
}

/* ------------------------------------------------------------------ *
 * Coalescing sender
 * ------------------------------------------------------------------ */

let pendingActivity = null;
let flushTimer = null;
let lastSentAt = 0;
let lastActivity = null; // what Discord is currently showing, null = nothing
let lastPayload = null;
let sending = false;

function queueActivity(activity) {
  pendingActivity = activity;
  if (flushTimer || sending) return;
  const wait = Math.max(0, MIN_UPDATE_INTERVAL_MS - (Date.now() - lastSentAt));
  flushTimer = setTimeout(flush, wait);
}

// Discord sometimes accepts a request and never answers, usually when rate
// limited. Without a ceiling the await would sit there forever and the presence
// would freeze on one track, so every RPC call races a timer.
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${RPC_TIMEOUT_MS}ms`)), RPC_TIMEOUT_MS)
    ),
  ]);
}

async function flush() {
  flushTimer = null;
  if (sending) return; // a slow send is still in flight; it will re-arm below

  const activity = pendingActivity;
  pendingActivity = null;
  if (!activity) return;

  if (!ready || !client?.user) return;

  if (sameActivity(activity, lastActivity)) return;

  sending = true;
  try {
    await withTimeout(client.user.setActivity(activity), "setActivity");
    lastActivity = activity;
    const mark = activity.startTimestamp ? "▶" : "⏸";
    log(`${mark} ${activity.details} — ${activity.state}`);
  } catch (err) {
    log(`setActivity failed: ${err.message}`);
    lastActivity = null; // force a retry on the next update
  } finally {
    sending = false;
    lastSentAt = Date.now();
    // Anything that arrived while we were busy still needs to go out.
    if (pendingActivity && !flushTimer) {
      flushTimer = setTimeout(flush, MIN_UPDATE_INTERVAL_MS);
    }
  }
}

async function clearActivity(reason) {
  pendingActivity = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  lastPayload = null;
  if (!ready || !client?.user) return;
  if (lastActivity === null) return;
  lastActivity = null;
  try {
    await withTimeout(client.user.clearActivity(), "clearActivity");
    log(`Presence cleared (${reason})`);
  } catch (err) {
    log(`clearActivity failed: ${err.message}`);
  }
}

function applyPayload(p) {
  lastPayload = p;
  queueActivity(buildActivity(p));
}

/* ------------------------------------------------------------------ *
 * WebSocket server (browser extension talks to this)
 * ------------------------------------------------------------------ */

let idleTimer = null;

function bumpIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => clearActivity("idle"), IDLE_CLEAR_MS);
}

// Bound to loopback only. Never expose this to the network.
const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("listening", () => {
  log(`Listening for the browser extension on ws://127.0.0.1:${PORT}`);
});

wss.on("error", (err) => {
  // Must go through log(), not console: when launched from the Startup entry
  // there is no console attached, so anything written there vanishes and the
  // helper looks like it silently did nothing.
  if (err.code === "EADDRINUSE") {
    log(`Port ${PORT} is already in use. Another copy of the helper is probably running. Exiting.`);
    process.exit(1);
  }
  log(`WebSocket server error: ${err.message}`);
});

wss.on("connection", (socket, req) => {
  // Loopback bind already restricts this, but reject odd origins anyway.
  log(`Extension connected (${req.socket.remoteAddress})`);

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "clear") {
      clearActivity("browser asked");
      if (idleTimer) clearTimeout(idleTimer);
      return;
    }

    if (msg.type === "update" && msg.payload) {
      applyPayload(msg.payload);
      bumpIdleTimer();
    }
  });

  socket.on("close", () => {
    log("Extension disconnected");
    if (wss.clients.size === 0) clearActivity("no browser connected");
  });

  socket.on("error", () => {});
});

/* ------------------------------------------------------------------ */

async function shutdown() {
  log("Shutting down...");
  await clearActivity("shutdown");
  try {
    await client?.destroy();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (err) => {
  log(`Unhandled rejection: ${err?.message ?? err}`);
});

connectDiscord();
