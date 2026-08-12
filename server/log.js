import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 512 * 1024;

let logFile = null;

// When the helper runs from the Startup folder there is no console attached,
// so a file is the only way a user can tell us what went wrong.
export function setLogFile(path) {
  logFile = path;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.old`);
  } catch {
    /* first run, or the file simply is not there yet */
  }
}

export function log(...args) {
  const line = `[${new Date().toLocaleTimeString("en-GB")}] ${args.join(" ")}`;
  console.log(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, line + "\n", "utf8");
  } catch {
    /* never let logging take the helper down */
  }
}
