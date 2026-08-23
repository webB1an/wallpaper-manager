import { BadRequestException } from "@nestjs/common";
import { nonNegativeInt, positiveInt } from "../common/query-values";

assert(positiveInt(undefined, 1, "页码") === 1, "undefined should use default");
assert(positiveInt("12", 1, "页码") === 12, "numeric strings should parse");
assert(positiveInt(120, 1, "每页数量", 100) === 100, "positive values should clamp to max");
assert(nonNegativeInt("", 0, "迁移数量") === 0, "empty values should use default");
assert(nonNegativeInt("0", 10, "迁移数量") === 0, "zero should be allowed for non-negative values");
assert(nonNegativeInt("300", 0, "迁移数量", 200) === 200, "non-negative values should clamp to max");

assertBadRequest(() => positiveInt("abc", 1, "页码"), "non-numeric values should reject");
assertBadRequest(() => positiveInt("0", 1, "页码"), "positive values should reject zero");
assertBadRequest(() => nonNegativeInt("-1", 0, "迁移数量"), "non-negative values should reject negative numbers");
assertBadRequest(() => positiveInt("1.5", 1, "页码"), "integer values should reject decimals");

console.log("Query value smoke passed");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertBadRequest(fn: () => unknown, message: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof BadRequestException) return;
    throw new Error(`${message}: expected BadRequestException, got ${(error as Error).message}`);
  }
  throw new Error(`${message}: expected BadRequestException`);
}
