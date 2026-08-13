/**
 * Isolated-world bridge: inject.js can touch the page but not chrome.*,
 * this script can touch chrome.* but not the page. postMessage joins them.
 */
(() => {
  "use strict";

  function send(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch {
      // Extension reloaded or context invalidated. Nothing useful to do.
    }
  }

  // Listen Along requests travel the other way: worker -> here -> page.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "play" || !message.payload?.title) return;
    window.postMessage({ __meowTunesPresence: true, type: "play", payload: message.payload }, location.origin);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__meowTunesPresence !== true) return;
    // Anything the page posts with type "play" is not ours; only the worker
    // sends those, and it does not round-trip back through here.
    if (data.type === "play") return;
    send({ type: data.type, payload: data.payload });
  });

  // Closing or navigating away should take the presence down with it.
  window.addEventListener("pagehide", () => send({ type: "clear" }));

  // Tells the worker this tab can accept a queued Listen Along request.
  if (document.readyState === "complete") send({ type: "ready" });
  else window.addEventListener("load", () => send({ type: "ready" }));
})();
