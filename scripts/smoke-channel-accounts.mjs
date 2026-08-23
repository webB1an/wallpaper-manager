import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};
const adminOrigin = (env.ADMIN_ORIGIN || "https://wall-admin.wdbzk.com").replace(/\/$/, "");
const username = env.ADMIN_USERNAME || "admin";
const password = env.ADMIN_PASSWORD;

if (!password) {
  throw new Error("ADMIN_PASSWORD is required. Run this on the server or provide ADMIN_PASSWORD in the environment.");
}

async function request(path, init = {}) {
  const response = await fetch(`${adminOrigin}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 200) {
    throw new Error(`${path} failed with ${response.status}: ${body.message || body.error || "invalid response"}`);
  }
  return body.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const login = await request("/api/admin/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
assert(typeof login.token === "string" && login.token.length > 20, "admin login must return a token");

const headers = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
const runId = `codex-smoke-channel-${Date.now()}`;
const created = [];

await cleanupSmokeAccounts();

try {
  for (const index of [1, 2]) {
    const token = `codex-smoke-token-${runId}-${index}`;
    const account = await request("/api/admin/channels", {
      method: "POST",
      headers,
      body: JSON.stringify({
        label: `${runId}-${index}`,
        token,
        guildId: `guild-${index}`,
        guildName: `Smoke Guild ${index}`,
        channelId: `channel-${index}`,
        channelName: `Smoke Channel ${index}`,
        isDefault: false,
      }),
    });
    assert(account.id, "channel account must be created");
    assert(account.tokenTail === token.slice(-6), "channel token tail must be persisted without exposing the token");
    created.push(account);
  }

  const listed = await request("/api/admin/channels", { headers });
  for (const account of created) {
    assert(listed.some((item) => item.id === account.id), "created channel account must be listed");
  }

  const selected = await request(`/api/admin/channels/${created.at(-1).id}/default`, { method: "POST", headers });
  assert(selected.isDefault === true, "channel account must be settable as default");
} finally {
  for (const account of created) {
    await request(`/api/admin/channels/${account.id}`, { method: "DELETE", headers }).catch((error) => {
      console.error(`failed to delete temporary channel account ${account.id}: ${error.message}`);
    });
  }
  await cleanupSmokeAccounts();
}

const after = await request("/api/admin/channels", { headers });
const leaked = after.filter((account) => String(account.label || "").startsWith("codex-smoke-channel-"));
assert(leaked.length === 0, `temporary channel accounts must be deleted: ${leaked.map((item) => item.id).join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  adminOrigin,
  created: created.map((account) => ({ id: account.id, becameDefault: account.isDefault, tokenTail: account.tokenTail })),
  remainingAccounts: after.length,
}, null, 2));

async function cleanupSmokeAccounts() {
  const accounts = await request("/api/admin/channels", { headers });
  const stale = accounts.filter((account) => String(account.label || "").startsWith("codex-smoke-channel-"));
  for (const account of stale) {
    await request(`/api/admin/channels/${account.id}`, { method: "DELETE", headers });
  }
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
