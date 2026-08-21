import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";

export interface CliResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(command: string, args: string[], options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  stdinFilePath?: string;
  timeoutMs?: number;
}): Promise<CliResult> {
  return new Promise((resolve) => {
    const stdinFd = options?.stdinFilePath ? openSync(options.stdinFilePath, "r") : undefined;
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      windowsHide: true,
      shell: false,
      stdio: [stdinFd ?? "pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, options?.timeoutMs || 300_000);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (stdinFd !== undefined) closeSync(stdinFd);
      resolve({ ok: false, code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdinFd !== undefined) closeSync(stdinFd);
      resolve({
        ok: !timedOut && code === 0,
        code,
        stdout: stdout.trim(),
        stderr: timedOut ? `${stderr}\nCommand timed out`.trim() : stderr.trim(),
      });
    });

    if (stdinFd === undefined) {
      if (options?.stdin) child.stdin?.end(options.stdin);
      else child.stdin?.end();
    }
  });
}

export function parseNdjson(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function lastResult(stdout: string): Record<string, unknown> | null {
  const lines = parseNdjson(stdout);
  return [...lines].reverse().find((line) => line.type === "result") || null;
}
