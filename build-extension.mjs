import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "extension");
const dist = join(here, "dist");

const GECKO_ID = "meowtunes-presence@scidev.ir";
const FIREFOX_MIN = "140.0"; // first release that understands data_collection_permissions

const step = (msg) => console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`);

// Windows PowerShell's Compress-Archive stores "icons\icon16.png", which AMO rejects; bsdtar writes "/".
function zip(folder, outFile) {
  rmSync(outFile, { force: true });
  const entries = readdirSync(folder);
  if (process.platform === "win32") {
    execFileSync(join(process.env.SystemRoot, "System32", "tar.exe"), ["-a", "-c", "-f", outFile, ...entries], {
      cwd: folder,
    });
  } else {
    execFileSync("zip", ["-r", "-q", outFile, ...entries], { cwd: folder });
  }
  if (!existsSync(outFile)) throw new Error(`could not create ${outFile}`);
  return (statSync(outFile).size / 1024).toFixed(0);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const baseManifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));

step("Chrome / Edge");
const chromeDir = join(dist, "chrome");
cpSync(src, chromeDir, { recursive: true });
console.log(`   dist/chrome/  +  meowtunes-chrome.zip (${zip(chromeDir, join(dist, "meowtunes-chrome.zip"))} KB)`);

step("Firefox");
const firefoxDir = join(dist, "firefox");
cpSync(src, firefoxDir, { recursive: true });

const ff = structuredClone(baseManifest);
delete ff.background.service_worker;
delete ff.background.type;
ff.background.scripts = ["background.js"];
// Firefox's default MV3 policy adds upgrade-insecure-requests, which turns ws://127.0.0.1 into a failing wss://.
ff.content_security_policy = { extension_pages: "script-src 'self'" };
ff.browser_specific_settings = {
  gecko: {
    id: GECKO_ID,
    strict_min_version: FIREFOX_MIN,
    data_collection_permissions: { required: ["none"] },
  },
  gecko_android: { strict_min_version: "142.0" },
};
writeFileSync(join(firefoxDir, "manifest.json"), JSON.stringify(ff, null, 2) + "\n");
console.log(`   dist/firefox/ +  meowtunes-firefox.zip (${zip(firefoxDir, join(dist, "meowtunes-firefox.zip"))} KB)`);

console.log(`
\x1b[32m✔ done\x1b[0m

  Chrome   → users unzip meowtunes-chrome.zip, then Load unpacked
  Edge     → upload meowtunes-chrome.zip to Partner Center
  Firefox  → upload meowtunes-firefox.zip to addons.mozilla.org
`);
