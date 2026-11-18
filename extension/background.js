// Firefox's promise-based API lives on `browser`; its `chrome` alias is callback-only.
const api = globalThis.browser ?? globalThis.chrome;

const SERVER_URL = "ws://127.0.0.1:6472";
const MEOWTUNES_URL = "https://vasl.social/meowtunes";
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const KEEPALIVE_ALARM = "meowtunes-keepalive";

let socket = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer = null;
let lastPayload = null;
let enabled = true;
let pendingPlay = null;

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
    if (lastPayload) rawSend({ type: "update", payload: lastPayload });
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg?.type === "play" && msg.payload?.title) playInTab(msg.payload);
  });

  ws.addEventListener("close", () => {
    if (socket === ws) socket = null;
    scheduleReconnect();
  });

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

async function playInTab(track) {
  try {
    const tabs = await api.tabs.query({ url: "https://vasl.social/*" });
    const tab = tabs.find((t) => t.url?.includes("/meowtunes")) ?? tabs[0];

    if (tab) {
      await api.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) await api.windows.update(tab.windowId, { focused: true });
      api.tabs.sendMessage(tab.id, { type: "play", payload: track }, () => void api.runtime.lastError);
      return;
    }

    // A fresh tab has no content script yet; it claims the track once it reports "ready".
    pendingPlay = track;
    await api.tabs.create({ url: MEOWTUNES_URL, active: true });
  } catch (err) {
    console.log("[MeowTunes] could not honour join request:", err?.message ?? err);
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ready") {
    if (pendingPlay && sender.tab?.id != null) {
      const track = pendingPlay;
      pendingPlay = null;
      api.tabs.sendMessage(sender.tab.id, { type: "play", payload: track }, () => void api.runtime.lastError);
    }
    return;
  }

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

api.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 }); // Chrome's minimum
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
