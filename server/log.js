import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 512 * 1024;

let logFile = null;

export function setLogFile(path) {
  logFile = path;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.old`);
  } catch {}
}

export function log(...args) {
  const line = `[${new Date().toLocaleString("sv-SE")}] ${args.join(" ")}`;
  console.log(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, line + "\n", "utf8");
  } catch {}
}
