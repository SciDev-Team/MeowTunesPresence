/**
 * Runs in the page's MAIN world at document_start.
 *
 * MeowTunes builds its player with `new Audio()` and never attaches the element
 * to the DOM, so `document.querySelector('audio')` finds nothing. The only
 * reliable way to get at playback position is to wrap the prototype's play()
 * before the app ever calls it, hence MAIN world + document_start.
 *
 * Track metadata comes from navigator.mediaSession, which the site does
 * populate (title / artist / album / real CDN artwork URL). It does NOT call
 * setPositionState() and leaves playbackState as "none", so neither of those
 * can be used; position always comes from the captured element.
 */
(() => {
  "use strict";

  if (window.__meowTunesPresenceInstalled) return;
  window.__meowTunesPresenceInstalled = true;

  const POLL_MS = 1000;
  const SEEK_TOLERANCE_S = 2;
  // Nothing changes during steady playback, so without a heartbeat the server
  // would see silence and assume the browser died. It must stay well under the
  // server's idleClearMs.
  const HEARTBEAT_MS = 10_000;

  /** @type {HTMLMediaElement|null} */
  let current = null;
  const wired = new WeakSet();

  let lastSent = null;
  let lastTickAt = 0;

  /* ---------------- capture the element ---------------- */

  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(...args) {
    try {
      adopt(this);
    } catch {
      /* never let our bookkeeping break playback */
    }
    return nativePlay.apply(this, args);
  };

  function adopt(el) {
    if (current !== el) {
      current = el;
      lastSent = null; // force a fresh send for the new element
    }
    if (wired.has(el)) return;
    wired.add(el);

    const push = () => tick(true);
    for (const evt of ["play", "pause", "ended", "loadedmetadata", "seeked", "emptied", "ratechange"]) {
      el.addEventListener(evt, push);
    }
  }

  /* ---------------- read the current state ---------------- */

  function pickArtwork(metadata) {
    const list = metadata?.artwork;
    if (!Array.isArray(list) || list.length === 0) return null;

    let best = null;
    let bestArea = -1;
    for (const art of list) {
      const src = art?.src;
      if (typeof src !== "string" || !/^https?:\/\//i.test(src)) continue;
      // The site falls back to its own vite.svg when a track has no cover.
      // Discord cannot render SVG anyway, so treat those as "no artwork".
      if (/\.svg(\?|$)/i.test(src)) continue;

      const [w, h] = (art.sizes || "").split("x").map(Number);
      const area = Number.isFinite(w) && Number.isFinite(h) ? w * h : 0;
      if (area > bestArea) {
        bestArea = area;
        best = src;
      }
    }
    return best;
  }

  function domFallback() {
    const mini = document.querySelector(".vmt-mini-meta");
    if (!mini) return {};
    const spans = mini.querySelectorAll("span");
    return {
      title: spans[0]?.textContent?.trim() || undefined,
      artist: mini.querySelector(".vmt-mini-artist")?.textContent?.trim() || undefined,
    };
  }

  function readState() {
    const el = current;
    if (!el) return null;

    const meta = navigator.mediaSession?.metadata;
    const fallback = meta?.title ? {} : domFallback();

    const title = meta?.title || fallback.title;
    const artist = meta?.artist || fallback.artist;
    if (!title) return null;

    const duration = Number.isFinite(el.duration) ? el.duration : null;

    return {
      title,
      artist: artist || "",
      album: meta?.album || "",
      artwork: pickArtwork(meta),
      paused: el.paused || el.ended,
      position: Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration,
    };
  }

  /* ---------------- change detection ---------------- */

  function isInteresting(next) {
    if (!lastSent) return true;
    if (next.title !== lastSent.title) return true;
    if (next.artist !== lastSent.artist) return true;
    if (next.artwork !== lastSent.artwork) return true;
    if (next.paused !== lastSent.paused) return true;
    if (next.duration !== lastSent.duration) return true;

    // While playing, position should advance in step with the wall clock.
    // A larger gap than that means the user seeked.
    if (!next.paused) {
      const elapsed = (Date.now() - lastTickAt) / 1000;
      const expected = lastSent.position + elapsed;
      if (Math.abs(next.position - expected) > SEEK_TOLERANCE_S) return true;
    }

    return false;
  }

  function tick(force) {
    const state = readState();
    if (!state) return;

    // The server dedupes identical activities, so a heartbeat costs nothing on
    // the Discord side - it only proves the page is still alive.
    const dueForHeartbeat = Date.now() - lastTickAt >= HEARTBEAT_MS;
    if (!force && !dueForHeartbeat && !isInteresting(state)) return;

    lastSent = state;
    lastTickAt = Date.now();

    window.postMessage({ __meowTunesPresence: true, type: "update", payload: state }, location.origin);
  }

  setInterval(() => tick(false), POLL_MS);
})();
