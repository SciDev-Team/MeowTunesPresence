import { copyFileSync, mkdirSync, writeFileSync, rmSync, unlinkSync, existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

export const EXE_NAME = "MeowTunesPresence.exe";

export function installDir() {
  const base = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || ".", "AppData", "Local");
  return join(base, "SciDev", "MeowTunesPresence");
}

export function logPath() {
  return join(installDir(), "presence.log");
}

function startupDir() {
  return join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

function startupFile() {
  return join(startupDir(), "MeowTunesPresence.vbs");
}

export function isInstalledCopy() {
  return process.execPath.toLowerCase().startsWith(installDir().toLowerCase());
}

export function isInstalled() {
  return existsSync(join(installDir(), EXE_NAME));
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// taskkill exits 0 even when its filter matched nothing, so trust the output instead.
function stopRunning() {
  try {
    const out = execFileSync("taskkill", ["/F", "/IM", EXE_NAME, "/FI", `PID ne ${process.pid}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /SUCCESS/i.test(out);
  } catch {
    return false;
  }
}

// Windows keeps an exe locked until its process has fully exited, which lags behind taskkill.
function copyWhenUnlocked(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return copyFileSync(from, to);
    } catch (err) {
      if ((err.code !== "EBUSY" && err.code !== "EPERM") || attempt >= 20) throw err;
      sleep(250);
    }
  }
}

export function install() {
  const dir = installDir();
  mkdirSync(dir, { recursive: true });

  const target = join(dir, EXE_NAME);
  if (process.execPath.toLowerCase() !== target.toLowerCase()) {
    stopRunning();
    copyWhenUnlocked(process.execPath, target);
  }

  // A .vbs avoids the COM plumbing a .lnk needs; window style 0 keeps a console from flashing at login.
  const vbs = ['Set shell = CreateObject("WScript.Shell")', `shell.Run """${target}"" --service", 0, False`, ""].join(
    "\r\n"
  );
  mkdirSync(startupDir(), { recursive: true });
  writeFileSync(startupFile(), vbs, "utf8");

  return target;
}

export function uninstall() {
  const removed = [];

  if (existsSync(startupFile())) {
    try {
      unlinkSync(startupFile());
      removed.push("startup entry");
    } catch {}
  }

  if (stopRunning()) removed.push("running helper");

  if (!isInstalledCopy() && existsSync(installDir())) {
    try {
      rmSync(installDir(), { recursive: true, force: true });
      removed.push("installed files");
    } catch {}
  }

  return removed;
}

export function launchDetached(exe) {
  const child = spawn(exe, ["--service"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
