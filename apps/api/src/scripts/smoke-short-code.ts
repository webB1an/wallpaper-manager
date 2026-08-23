import { legacyShortCodeCandidates, normalizeLegacyResourceId } from "../common/short-code";

const cases: Array<[number | string, string[]]> = [
  [1, ["1", "1-2", "1-3"]],
  [35, ["z", "z-2", "z-3"]],
  [36, ["10", "10-2", "10-3"]],
  ["123", ["3f", "3f-2", "3f-3"]],
  ["旧资源 001", ["001", "001-2", "001-3"]],
  ["", ["legacy", "legacy-2", "legacy-3"]],
];

for (const [input, expected] of cases) {
  const candidates = legacyShortCodeCandidates(input, 3);
  assert(JSON.stringify(candidates) === JSON.stringify(expected), `${String(input)} candidates mismatch: ${JSON.stringify(candidates)}`);
}

assert(normalizeLegacyResourceId("A/B C") === "a-b-c", "non numeric ids must be URL-safe");
assert(legacyShortCodeCandidates(1, 0).length === 1, "candidate count must be clamped to at least one");
assert(legacyShortCodeCandidates(1, 200).length === 100, "candidate count must be clamped to one hundred");

console.log("Short code smoke passed");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
