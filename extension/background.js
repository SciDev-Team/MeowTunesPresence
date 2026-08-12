/**
 * Holds the WebSocket to the local presence server.
 *
 * This lives in the service worker rather than the page because an extension
 * origin may talk to ws://127.0.0.1 freely. From the site's own https origin
 * it would run into mixed-content and Private Network Access restrictions.
 */

// Firefox exposes the promise-based API as `browser`; its `chrome` alias is
// callback-only, so `await chrome.storage...` would silently yield undefined
// there. Chromium's MV3 `chrome` already returns promises, so this alias makes
// the same code correct on both.
const api = globalThis.browser ?? globalThis.chrome;

const SERVER_URL = "ws://127.0.0.1:6472";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const KEEPALIVE_ALARM = "meowtunes-keepalive";

let socket = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer = null;
let lastPayload = null;
let enabled = true;

/* ---------------- connection handling ---------------- */

function connect() {
  if (!enabled) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  let ws;
  try {
    ws = new WebSocket(SERVER_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.addEventListener("open", () => {
    reconnectDelay = RECONNECT_MIN_MS;
    console.log("[MeowTunes] connected to presence server");
    // Restore whatever was playing before the server restarted.
    if (lastPayload) rawSend({ type: "update", payload: lastPayload });
  });

  ws.addEventListener("close", () => {
    if (socket === ws) socket = null;
    scheduleReconnect();
  });

  // A failed connection also fires close; keep this quiet so the console does
  // not fill up while the server simply is not running yet.
  ws.addEventListener("error", () => {});
}

function scheduleReconnect() {
  if (!enabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function rawSend(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function disconnect() {
  rawSend({ type: "clear" });
  lastPayload = null;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  try {
    socket?.close();
  } catch {}
  socket = null;
}

/* ---------------- messages from the page ---------------- */

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "status") {
    sendResponse({
      enabled,
      connected: socket?.readyState === WebSocket.OPEN,
      track: lastPayload ? { title: lastPayload.title, artist: lastPayload.artist, paused: lastPayload.paused } : null,
    });
    return true;
  }

  if (message?.type === "setEnabled") {
    enabled = !!message.value;
    api.storage.local.set({ enabled });
    if (enabled) {
      reconnectDelay = RECONNECT_MIN_MS;
      connect();
    } else {
      disconnect();
    }
    sendResponse({ enabled });
    return true;
  }

  if (!enabled) return;

  if (message?.type === "update" && message.payload) {
    lastPayload = message.payload;
    if (!rawSend(message)) connect();
    return;
  }

  if (message?.type === "clear") {
    lastPayload = null;
    rawSend({ type: "clear" });
  }
});

/* ---------------- lifecycle ---------------- */

// WebSocket traffic already pushes back the service worker idle timer, but a
// silent track (nobody listening, nothing playing) would eventually let it die.
api.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) connect();
});

async function boot() {
  const stored = await api.storage.local.get({ enabled: true });
  enabled = stored.enabled;
  connect();
}

api.runtime.onStartup.addListener(boot);
api.runtime.onInstalled.addListener(boot);
boot();
