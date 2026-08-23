import { normalizeAuthCode } from "../modules/storage/storage-account.service";

const cases: Array<[string | undefined, string]> = [
  [undefined, ""],
  ["", ""],
  ["  plain-code-123  ", "plain-code-123"],
  ["https://callback.example.com/oauth?code=query-code&state=ok", "query-code"],
  ["https://callback.example.com/oauth?auth_code=auth-code&state=ok", "auth-code"],
  ["https://callback.example.com/oauth#code=hash-code&state=ok", "hash-code"],
  ["https://callback.example.com/oauth#/done?code=hash-query-code&state=ok", "hash-query-code"],
  ["授权完成：https://callback.example.com/oauth?code=embedded-code&state=ok 请复制", "embedded-code"],
  ["code=loose-code", "loose-code"],
  ["auth_code=loose-auth-code", "loose-auth-code"],
  ["https://callback.example.com/oauth?code=%E4%B8%AD%E6%96%87code", "中文code"],
];

for (const [input, expected] of cases) {
  const actual = normalizeAuthCode(input);
  if (actual !== expected) {
    throw new Error(`normalizeAuthCode(${JSON.stringify(input)}) expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("Storage auth code normalization smoke passed");
