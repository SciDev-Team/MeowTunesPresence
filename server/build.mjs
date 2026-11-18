import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// postject refuses a PE that still carries a certificate table, and signtool only ships with the Windows SDK.
function stripSignature(path) {
  const buf = readFileSync(path);

  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOffset) !== 0x00004550) throw new Error("not a PE file");

  const optionalHeader = peOffset + 4 + 20;
  const magic = buf.readUInt16LE(optionalHeader);
  const dataDirectory = optionalHeader + (magic === 0x20b ? 112 : 96);
  const securityEntry = dataDirectory + 4 * 8; // index 4 = IMAGE_DIRECTORY_ENTRY_SECURITY

  const certOffset = buf.readUInt32LE(securityEntry);
  const certSize = buf.readUInt32LE(securityEntry + 4);
  if (certOffset === 0 || certSize === 0) return false;

  buf.writeUInt32LE(0, securityEntry);
  buf.writeUInt32LE(0, securityEntry + 4);
  writeFileSync(path, buf.subarray(0, certOffset));
  return true;
}

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const work = join(dist, ".build");
const exeName = "MeowTunesPresence.exe";
const exePath = join(dist, exeName);

const step = (msg) => console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`);

rmSync(dist, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

step("Bundling sources");
const bundlePath = join(work, "bundle.cjs");
await build({
  entryPoints: [join(here, "index.js")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: bundlePath,
  legalComments: "none",
  // optional native speedups for ws; bundling them would drag in native modules
  external: ["bufferutil", "utf-8-validate"],
});
console.log(`   bundle: ${(statSync(bundlePath).size / 1024).toFixed(0)} KB`);

step("Creating SEA blob");
const seaConfig = join(work, "sea-config.json");
const blobPath = join(work, "sea.blob");
writeFileSync(
  seaConfig,
  JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true }, null, 2)
);
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

step("Injecting into node binary");
copyFileSync(process.execPath, exePath);
console.log(`   signature: ${stripSignature(exePath) ? "stripped" : "none present"}`);
execFileSync(
  process.execPath,
  [
    join(here, "node_modules", "postject", "dist", "cli.js"),
    exePath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ],
  { stdio: "inherit" }
);

rmSync(work, { recursive: true, force: true });

const mb = (statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`\n\x1b[32m✔ dist/${exeName}\x1b[0m  (${mb} MB)\n`);
console.log("  Test it with:  dist\\MeowTunesPresence.exe --uninstall");
console.log("  (that path is safe, it only clears a previous install)\n");
