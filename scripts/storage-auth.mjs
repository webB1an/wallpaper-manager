import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};

const action = process.argv[2] || "help";
const rest = process.argv.slice(3);
const bdpan = env.BDPAN_PATH?.trim() || "bdpan";
const quarkSkillDir = env.QUARK_SKILL_DIR?.trim() || "/www/server/quarkclouddrive-1.0.14";
const quarkCli = join(quarkSkillDir, "scripts", "quark-drive.cjs");

const commands = {
  "baidu-url": {
    description: "Print the Baidu authorization URL.",
    command: quoteCommand([bdpan, "login", "--accept-disclaimer", "--get-auth-url"]),
  },
  "baidu-code": {
    description: "Finish Baidu authorization with the code copied from the browser.",
    command: quoteCommand([bdpan, "login", "--accept-disclaimer", "--set-code", "<code>"]),
  },
  "baidu-whoami": {
    description: "Check whether bdpan is logged in.",
    command: quoteCommand([bdpan, "whoami"]),
  },
  "quark-login": {
    description: "Start Quark skill login.",
    command: `cd ${quoteShell(quarkSkillDir)} && CODEX_ENV=1 AI_AGENT=codex node scripts/quark-drive.cjs login`,
  },
  "quark-whoami": {
    description: "Check whether Quark skill is logged in.",
    command: `cd ${quoteShell(quarkSkillDir)} && CODEX_ENV=1 AI_AGENT=codex node scripts/quark-drive.cjs get-user-info`,
  },
};

if (action === "help" || action === "--help" || action === "-h") {
  printHelp();
  process.exit(0);
}

if (action === "baidu-url") {
  run(bdpan, ["login", "--accept-disclaimer", "--get-auth-url"]);
} else if (action === "baidu-code") {
  const code = rest[0];
  if (!code) fail("Usage: npm run auth:storage -- baidu-code <code>");
  run(bdpan, ["login", "--accept-disclaimer", "--set-code", code]);
} else if (action === "baidu-whoami") {
  run(bdpan, ["whoami"]);
} else if (action === "quark-login") {
  ensureQuarkCli();
  run(process.execPath, [quarkCli, "login"], { cwd: quarkSkillDir, env: quarkEnv() });
} else if (action === "quark-whoami") {
  ensureQuarkCli();
  run(process.execPath, [quarkCli, "get-user-info"], { cwd: quarkSkillDir, env: quarkEnv() });
} else {
  printHelp();
  fail(`Unknown storage auth action: ${action}`);
}

function printHelp() {
  console.log("Wallpaper Manager storage authorization helper");
  console.log("");
  console.log("Usage:");
  console.log("  npm run auth:storage -- baidu-url");
  console.log("  npm run auth:storage -- baidu-code <code>");
  console.log("  npm run auth:storage -- baidu-whoami");
  console.log("  npm run auth:storage -- quark-login");
  console.log("  npm run auth:storage -- quark-whoami");
  console.log("");
  console.log("Resolved commands:");
  for (const [key, item] of Object.entries(commands)) {
    console.log(`- ${key}: ${item.description}`);
    console.log(`  ${item.command}`);
  }
}

function run(command, args, options = {}) {
  console.log(`Running: ${quoteCommand([command, ...args])}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) fail(result.error.message);
  process.exit(typeof result.status === "number" ? result.status : 1);
}

function ensureQuarkCli() {
  if (!existsSync(quarkCli)) {
    fail(`Quark skill CLI not found: ${quarkCli}`);
  }
}

function quarkEnv() {
  return {
    CODEX_ENV: "1",
    AI_AGENT: "codex",
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function quoteCommand(parts) {
  return parts.map(quoteShell).join(" ");
}

function quoteShell(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function readDotenv(path) {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) return {};
  return Object.fromEntries(
    readFileSync(fullPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
