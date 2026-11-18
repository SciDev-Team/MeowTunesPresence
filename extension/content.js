(() => {
  "use strict";

  function send(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch {}
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "play" || !message.payload?.title) return;
    window.postMessage({ __meowTunesPresence: true, type: "play", payload: message.payload }, location.origin);
  });

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || data?.__meowTunesPresence !== true || data.type === "play") return;
    send({ type: data.type, payload: data.payload });
  });

  window.addEventListener("pagehide", () => send({ type: "clear" }));

  if (document.readyState === "complete") send({ type: "ready" });
  else window.addEventListener("load", () => send({ type: "ready" }));
})();
