import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ChannelAccountUnavailableError,
  ChannelPermissionDeniedError,
  ChannelService,
  isAccountUnavailableResult,
  isPermissionDeniedResult,
  scrub,
  sortChannelCandidates,
} from "./channel.service";
import { encryptSecret } from "../../common/crypto";

function harness(errors: Array<Error | null>) {
  const secret = "fixture-secret-123456789012345678901234567890";
  const accounts = ["a", "b", "c"].map((id, index) => ({
    id,
    label: id,
    guildId: "guild",
    channelId: "board",
    tokenCipher: encryptSecret(id, secret),
    unavailableAt: null,
    lastAutoPublishAt: null,
    createdAt: new Date(2026, 0, index + 1),
  }));
  const calls: string[] = [];
  const notices: string[] = [];
  const marked: string[] = [];
  const cleared: string[] = [];
  let lookups = 0;
  const service: ChannelService = Object.assign(Object.create(ChannelService.prototype), {
    secret: () => secret,
    prisma: { channelAccount: {
      findUnique: async () => accounts[0],
      findMany: async (query: { where: unknown }) => {
        lookups++;
        assert.deepEqual(query.where, { id: { not: "a" }, autoPublish: true, guildId: "guild", channelId: "board" });
        return accounts.slice(1);
      },
      update: async (args: { where: { id: string }; data: { unavailableReason?: string } }) => {
        marked.push(`${args.where.id}:${args.data.unavailableReason || ""}`);
        return {};
      },
      updateMany: async (args: { where: { id: string } }) => {
        cleared.push(args.where.id);
        return { count: 1 };
      },
    } },
    runPublish: async (input: { token: string; guildId: string; channelId: string; content: string }) => {
      assert.equal(input.guildId, "guild"); assert.equal(input.channelId, "board"); assert.equal(input.content, "fixture");
      calls.push(input.token);
      const error = errors[calls.length - 1];
      if (error) throw error;
      return { message: "成功", raw: {} };
    },
  });
  return {
    calls,
    notices,
    marked,
    cleared,
    lookups: () => lookups,
    run: () => service.publish({ accountId: "a", content: "fixture", onAccountSwitch: async (message) => { notices.push(message); } }),
  };
}

test("explicit permission rejection switches to next same-board account", async () => {
  const h = harness([new ChannelPermissionDeniedError("暂无权限"), null]);
  const result = await h.run();
  assert.deepEqual(h.calls, ["a", "b"]);
  assert.equal(result.accountId, "b"); assert.equal(result.switchedAccounts, 1);
  assert.equal(h.notices.length, 1);
});

test("success never tries another account", async () => {
  const h = harness([null]); await h.run();
  assert.deepEqual(h.calls, ["a"]); assert.equal(h.lookups(), 0);
});

test("all accounts denied stop after one attempt each", async () => {
  const h = harness(Array.from({ length: 3 }, () => new ChannelPermissionDeniedError("暂无权限")));
  await assert.rejects(h.run(), /3 个候选账号均无法发帖/);
  assert.deepEqual(h.calls, ["a", "b", "c"]);
});

test("expired token marks the account unavailable and switches to the next one", async () => {
  const h = harness([new ChannelAccountUnavailableError("token is expired (100051)"), null]);
  const result = await h.run();
  assert.deepEqual(h.calls, ["a", "b"]);
  assert.equal(result.accountId, "b");
  assert.equal(h.marked.length, 1);
  assert.match(h.marked[0], /^a:token is expired/);
  assert.match(h.notices[0], /Token 已失效/);
});

test("a successful publish clears a stale unavailable flag", async () => {
  const h = harness([null]);
  await h.run();
  assert.deepEqual(h.cleared, ["a"]);
  assert.equal(h.marked.length, 0);
});

test("timeouts and ambiguous failures never trigger fallback", async () => {
  for (const error of [new Error("timeout"), new Error("fetch failed"), new Error("暂无权限")]) {
    const h = harness([error]); await assert.rejects(h.run());
    assert.deepEqual(h.calls, ["a"]); assert.equal(h.lookups(), 0);
  }
  const h = harness([new ChannelPermissionDeniedError("暂无权限"), new Error("timeout")]);
  await assert.rejects(h.run(), /timeout/); assert.deepEqual(h.calls, ["a", "b"]);
});

test("only structured rejection is retryable, never timeout output or title text", () => {
  assert.equal(isPermissionDeniedResult({ success: false, error: { message: "暂无权限" } }, ""), true);
  assert.equal(isPermissionDeniedResult({ success: false, error: { message: "暂无权限" } }, "Command timed out"), false);
  assert.equal(isPermissionDeniedResult({ success: true, error: { message: "暂无权限" } }, ""), false);
  assert.equal(isPermissionDeniedResult(null, "暂无权限"), false);
  assert.equal(isPermissionDeniedResult({ error: { message: "发帖失败（错误码 10023）：当前暂无权限" } }, "", true), true);
  assert.equal(isPermissionDeniedResult({ error: { message: "发帖失败（错误码 10023）：当前暂无权限" } }, "Command timed out", true), false);
});

test("token expiry is recognized from business code and message, never from timeouts", () => {
  const expired = 'apply_media_upload 失败: 业务错误 (retCode=8011): {"message":"token is expired","retcode":100051}';
  assert.equal(isAccountUnavailableResult({ success: false, error: { message: expired } }, ""), true);
  assert.equal(isAccountUnavailableResult(null, expired), true);
  assert.equal(isAccountUnavailableResult({ success: false, error: { message: "token 已过期" } }, ""), true);
  assert.equal(isAccountUnavailableResult({ success: false, error: { message: "token is invalid" } }, ""), true);
  assert.equal(isAccountUnavailableResult({ success: false, error: { message: expired } }, "Command timed out"), false);
  assert.equal(isAccountUnavailableResult({ success: false, error: { message: "暂无权限" } }, ""), false);
  assert.equal(isAccountUnavailableResult({ success: false, error: { message: "错误码 1000510" } }, ""), false);
});

test("candidate ordering prefers healthy accounts, then least recently used", () => {
  const rows = [
    { id: "stale", unavailableAt: new Date("2026-10-28"), lastAutoPublishAt: null, createdAt: new Date("2026-01-01") },
    { id: "fresh", unavailableAt: null, lastAutoPublishAt: new Date("2026-10-28"), createdAt: new Date("2026-01-02") },
    { id: "never", unavailableAt: null, lastAutoPublishAt: null, createdAt: new Date("2026-01-03") },
  ];
  assert.deepEqual(sortChannelCandidates(rows).map((row) => row.id), ["never", "fresh", "stale"]);
});

test("error redaction does not insert text between every character", () => {
  assert.equal(scrub("暂无权限", "fixture-token"), "暂无权限");
  assert.equal(scrub("fixture-token path.env", "fixture-token", "path.env"), "<redacted-token> <redacted-dotenv>");
});
