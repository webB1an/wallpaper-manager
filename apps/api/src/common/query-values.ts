import { BadRequestException } from "@nestjs/common";

export function positiveInt(value: unknown, defaultValue: number, label: string, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = optionalNumber(value, defaultValue);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException(`${label}不正确`);
  return Math.min(parsed, max);
}

export function nonNegativeInt(value: unknown, defaultValue: number, label: string, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = optionalNumber(value, defaultValue);
  if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException(`${label}不正确`);
  return Math.min(parsed, max);
}

function optionalNumber(value: unknown, defaultValue: number) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return Number(value);
}
