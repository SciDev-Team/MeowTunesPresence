(() => {
  "use strict";

  if (window.__meowTunesPresenceInstalled) return;
  window.__meowTunesPresenceInstalled = true;

  const POLL_MS = 1000;
  const SEEK_TOLERANCE_S = 2;
  const HEARTBEAT_MS = 10_000; // must stay well under the helper's idleClearMs
  const MAX_TRACKED = 4;

  const played = [];
  const wired = new WeakSet();
  let lastSent = null;
  let lastTickAt = 0;

  // The site never attaches its Audio elements to the DOM, so play() is the only place to catch them.
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(...args) {
    try {
      adopt(this);
    } catch {}
    return nativePlay.apply(this, args);
  };

  function adopt(el) {
    const i = played.indexOf(el);
    if (i !== -1) played.splice(i, 1);
    played.push(el);
    if (played.length > MAX_TRACKED) played.shift();

    if (wired.has(el)) return;
    wired.add(el);
    for (const evt of ["play", "pause", "ended", "loadedmetadata", "seeked", "emptied", "ratechange"]) {
      el.addEventListener(evt, () => tick(true));
    }
  }

  // Crossfade starts the standby element and pauses it again if the fade is aborted.
  function activeElement() {
    for (let i = played.length - 1; i >= 0; i--) {
      if (!played[i].paused && !played[i].ended) return played[i];
    }
    return played[played.length - 1] ?? null;
  }

  function pickArtwork(metadata) {
    let best = null;
    let bestArea = -1;
    for (const art of metadata?.artwork ?? []) {
      const src = art?.src;
      // The site's vite.svg placeholder means "no cover", and Discord cannot render SVG anyway.
      if (typeof src !== "string" || !/^https?:\/\//i.test(src) || /\.svg(\?|$)/i.test(src)) continue;
      const [w, h] = (art.sizes || "").split("x").map(Number);
      const area = Number.isFinite(w) && Number.isFinite(h) ? w * h : 0;
      if (area > bestArea) {
        bestArea = area;
        best = src;
      }
    }
    return best;
  }

  function readState() {
    const el = activeElement();
    const meta = navigator.mediaSession?.metadata;
    if (!el || !meta?.title) return null;

    return {
      title: meta.title,
      artist: meta.artist || "",
      album: meta.album || "",
      artwork: pickArtwork(meta),
      paused: el.paused || el.ended,
      position: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: Number.isFinite(el.duration) ? el.duration : null,
    };
  }

  function isInteresting(next) {
    if (!lastSent) return true;
    for (const key of ["title", "artist", "artwork", "paused", "duration"]) {
      if (next[key] !== lastSent[key]) return true;
    }
    if (next.paused) return false;
    const expected = lastSent.position + (Date.now() - lastTickAt) / 1000;
    return Math.abs(next.position - expected) > SEEK_TOLERANCE_S;
  }

  function tick(force) {
    const state = readState();
    if (!state) return;
    const dueForHeartbeat = Date.now() - lastTickAt >= HEARTBEAT_MS;
    if (!force && !dueForHeartbeat && !isInteresting(state)) return;

    lastSent = state;
    lastTickAt = Date.now();
    window.postMessage({ __meowTunesPresence: true, type: "update", payload: state }, location.origin);
  }

  setInterval(() => tick(false), POLL_MS);

  const SEARCH_TIMEOUT_MS = 8000;
  const normalize = (s) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  function waitFor(test, timeout) {
    return new Promise((resolve) => {
      const found = test();
      if (found) return resolve(found);
      const observer = new MutationObserver(() => {
        const hit = test();
        if (!hit) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(hit);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // The search box is a controlled React input; a plain .value assignment is reverted on the next render.
  function typeSearch(input, text) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function playTrack(track) {
    const input = document.querySelector("input[type='search']");
    if (!input) return;
    typeSearch(input, track.title);

    const title = normalize(track.title);
    const artist = normalize(track.artist);
    const row = await waitFor(() => {
      const matches = [...document.querySelectorAll(".mt-tr[role='button'][title]")].filter((r) =>
        normalize(r.getAttribute("title")).startsWith(title)
      );
      return matches.find((r) => artist && normalize(r.getAttribute("title")).includes(artist)) ?? matches[0];
    }, SEARCH_TIMEOUT_MS);
    row?.click();
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || data?.__meowTunesPresence !== true || data.type !== "play") return;
    if (data.payload?.title) playTrack(data.payload);
  });
})();
