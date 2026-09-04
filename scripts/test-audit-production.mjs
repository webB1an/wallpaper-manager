import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("./audit-production.mjs", import.meta.url), "utf8")
  .replace('import { spawnSync } from "node:child_process";', "");
for (const [name, result, expected] of [
  ["clean", { status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }) }, 0],
  ["vulnerable", { status: 1, stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 1 } } }) }, 1],
  ["network timeout", { status: 1, stderr: "network timeout at registry.npmjs.org" }, 0],
  ["process timeout", { error: { code: "ETIMEDOUT" } }, 0],
  ["bad lockfile", { status: 1, stderr: "audit endpoint returned an error: 400 Invalid package tree" }, 1],
  ["missing npm", { error: { code: "ENOENT", message: "npm not found" } }, 1],
  ["invalid report", { status: 0, stdout: "not json" }, 1],
]) {
  let exitCode;
  const stop = new Error("exit");
  try {
    runInNewContext(source, {
      spawnSync: () => result,
      console: { log() {}, warn() {}, error() {} },
      process: { exit(code) { exitCode = code; throw stop; } },
    });
  } catch (error) { if (error !== stop) throw error; }
  assert.equal(exitCode, expected, name);
}
console.log("Audit policy tests passed (7 cases).");
