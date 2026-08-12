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

export function install() {
  const dir = installDir();
  mkdirSync(dir, { recursive: true });

  const target = join(dir, EXE_NAME);
  if (process.execPath.toLowerCase() !== target.toLowerCase()) {
    copyFileSync(process.execPath, target);
  }

  // Windows runs .vbs files dropped straight into the Startup folder, so this
  // avoids creating a .lnk (which would need COM plumbing from Node). The 0
  // window style is what keeps a console from flashing up at every login.
  const vbs = [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run """${target}"" --service", 0, False`,
    "",
  ].join("\r\n");
  mkdirSync(startupDir(), { recursive: true });
  writeFileSync(startupFile(), vbs, "utf8");

  return target;
}

export function uninstall() {
  const removed = [];

  // Each step checks first and only reports what it actually did, so an
  // uninstaller that claims to have removed things that were never there is
  // worse than one that says nothing.
  if (existsSync(startupFile())) {
    try {
      unlinkSync(startupFile());
      removed.push("startup entry");
    } catch {
      /* leave it out of the report */
    }
  }

  // Stop any copy that is currently running, but never ourselves. taskkill
  // exits 0 even when its filter matches nothing, so trust the output instead.
  try {
    const out = execFileSync("taskkill", ["/F", "/IM", EXE_NAME, "/FI", `PID ne ${process.pid}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (/SUCCESS/i.test(out)) removed.push("running helper");
  } catch {
    /* nothing was running */
  }

  // The installed exe cannot delete itself while it is the one executing.
  if (!isInstalledCopy() && existsSync(installDir())) {
    try {
      rmSync(installDir(), { recursive: true, force: true });
      removed.push("installed files");
    } catch {
      /* locked; the startup entry is gone either way */
    }
  }

  return removed;
}

export function launchDetached(exe) {
  const child = spawn(exe, ["--service"], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
