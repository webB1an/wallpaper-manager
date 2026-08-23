export function legacyShortCodeCandidates(resourceId: number | string, maxCandidates = 20): string[] {
  const normalized = normalizeLegacyResourceId(resourceId);
  const count = Math.max(1, Math.min(100, Math.floor(maxCandidates)));
  return Array.from({ length: count }, (_, index) => index === 0 ? normalized : `${normalized}-${index + 1}`);
}

export function normalizeLegacyResourceId(resourceId: number | string): string {
  const raw = String(resourceId).trim();
  const numeric = typeof resourceId === "number" ? resourceId : raw ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(numeric) && numeric >= 0) {
    return numeric.toString(36);
  }

  const text = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return text.slice(0, 24) || "legacy";
}
