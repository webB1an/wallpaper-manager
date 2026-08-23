import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};
const adminOrigin = (env.ADMIN_ORIGIN || "https://wall-admin.wdbzk.com").replace(/\/$/, "");
const username = env.ADMIN_USERNAME || "admin";
const password = env.ADMIN_PASSWORD;
const authStart = process.argv.includes("--auth-start");

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
const runId = `codex-smoke-${Date.now()}`;
const providers = ["baidu", "quark"];
const created = [];
const authResults = [];

await cleanupSmokeAccounts();

try {
  for (const provider of providers) {
    const account = await request("/api/admin/storage-accounts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider,
        label: `${runId}-${provider}`,
        isDefault: false,
      }),
    });
    assert(account.id && account.provider === provider, `${provider} storage account must be created`);
    created.push(account);
  }

  const listed = await request("/api/admin/storage-accounts", { headers });
  for (const account of created) {
    assert(listed.some((item) => item.id === account.id), `${account.provider} storage account must be listed before delete`);
  }

  if (authStart) {
    for (const account of created) {
      const result = await request(`/api/admin/storage-accounts/${account.id}/auth/start`, { method: "POST", headers });
      authResults.push(summarizeAuthResult(account.provider, result));
    }
  }
} finally {
  for (const account of created) {
    await request(`/api/admin/storage-accounts/${account.id}`, { method: "DELETE", headers }).catch((error) => {
      console.error(`failed to delete temporary ${account.provider} account ${account.id}: ${error.message}`);
    });
  }
  await cleanupSmokeAccounts();
}

const after = await request("/api/admin/storage-accounts", { headers });
const leaked = after.filter((account) => String(account.label || "").startsWith("codex-smoke-"));
assert(leaked.length === 0, `temporary storage accounts must be hidden after delete: ${leaked.map((item) => item.id).join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  adminOrigin,
  created: created.map((account) => ({ id: account.id, provider: account.provider, becameDefault: account.isDefault })),
  authStart,
  authResults,
  remainingAccounts: after.length,
}, null, 2));

async function cleanupSmokeAccounts() {
  const accounts = await request("/api/admin/storage-accounts", { headers });
  const stale = accounts.filter((account) => String(account.label || "").startsWith("codex-smoke-"));
  for (const account of stale) {
    await request(`/api/admin/storage-accounts/${account.id}`, { method: "DELETE", headers });
  }
}

function summarizeAuthResult(provider, result) {
  const authUrl = typeof result?.authUrl === "string" ? result.authUrl : "";
  return {
    provider,
    authUrl: Boolean(authUrl),
    authHost: authUrl ? new URL(authUrl).host : undefined,
    message: result?.message ? String(result.message).slice(0, 160) : undefined,
    authorized: Boolean(result?.lastProbeOk),
  };
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
