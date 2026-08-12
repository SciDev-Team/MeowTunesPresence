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

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__meowTunesPresence !== true) return;
    send({ type: data.type, payload: data.payload });
  });

  // Closing or navigating away should take the presence down with it.
  window.addEventListener("pagehide", () => send({ type: "clear" }));
})();
