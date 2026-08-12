/**
 * Packages the extension for each store.
 *
 *   dist/chrome/   + meowtunes-chrome.zip    Chrome and Edge (same Chromium build)
 *   dist/firefox/  + meowtunes-firefox.zip   Firefox / AMO
 *
 * The folder in dist/chrome is what a Chrome user points "Load unpacked" at,
 * so it is left unzipped as well as zipped.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "extension");
const dist = join(here, "dist");

const GECKO_ID = "meowtunes-presence@scidev.ir";
// world: "MAIN" for declarative content scripts landed in Firefox 128.
const FIREFOX_MIN = "128.0";

const step = (msg) => console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`);

function zip(folder, outFile) {
  rmSync(outFile, { force: true });
  try {
    // Cross-platform enough: zip on unix, Compress-Archive on Windows.
    execFileSync("zip", ["-r", "-q", outFile, "."], { cwd: folder });
  } catch {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${folder}\\*' -DestinationPath '${outFile}' -Force`],
      { stdio: "ignore" }
    );
  }
  if (!existsSync(outFile)) throw new Error(`could not create ${outFile}`);
  return (statSync(outFile).size / 1024).toFixed(0);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const baseManifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));

/* ---------------- Chromium (Chrome + Edge) ---------------- */

step("Chrome / Edge");
const chromeDir = join(dist, "chrome");
cpSync(src, chromeDir, { recursive: true });
const chromeZip = zip(chromeDir, join(dist, "meowtunes-chrome.zip"));
console.log(`   dist/chrome/  +  meowtunes-chrome.zip (${chromeZip} KB)`);

/* ---------------- Firefox ---------------- */

step("Firefox");
const firefoxDir = join(dist, "firefox");
cpSync(src, firefoxDir, { recursive: true });

const ff = structuredClone(baseManifest);
// Firefox MV3 uses an event page, not a service worker.
delete ff.background.service_worker;
delete ff.background.type;
ff.background.scripts = ["background.js"];
// AMO needs a stable extension id to sign against.
ff.browser_specific_settings = { gecko: { id: GECKO_ID, strict_min_version: FIREFOX_MIN } };
writeFileSync(join(firefoxDir, "manifest.json"), JSON.stringify(ff, null, 2) + "\n");

const firefoxZip = zip(firefoxDir, join(dist, "meowtunes-firefox.zip"));
console.log(`   dist/firefox/ +  meowtunes-firefox.zip (${firefoxZip} KB)`);

console.log(`
\x1b[32m✔ done\x1b[0m

  Chrome   → users unzip meowtunes-chrome.zip, then Load unpacked
  Edge     → upload meowtunes-chrome.zip to Partner Center
  Firefox  → upload meowtunes-firefox.zip to addons.mozilla.org
`);
