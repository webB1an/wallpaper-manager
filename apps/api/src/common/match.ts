const KNOWN_EXTENSIONS = /\.(mp4|mpkg|jpg|jpeg|png|webp|gif|mov|avi|mkv|webm|m4v)$/i;
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": "\"",
  "&#34;": "\"",
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(amp|quot|apos|lt|gt);|&#(34|39);/g, (entity) => HTML_ENTITIES[entity] || entity);
}

export function stripKnownExtension(value: string): string {
  return value.replace(KNOWN_EXTENSIONS, "");
}

export function candidateTitleFromCoverFile(fileName: string): string {
  const decoded = decodeHtmlEntities(stripKnownExtension(fileName).replace(/\.+$/, ""));
  if (!decoded.includes("__")) return decoded.trim();
  const parts = decoded.split("__").filter(Boolean);
  return (parts[parts.length - 1] || decoded).trim();
}

export function legacyResourceMatchKey(value: string): string {
  const decoded = decodeHtmlEntities(stripKnownExtension(String(value || "")).replace(/\.+$/, ""));
  const subject = decoded.includes("__") ? decoded.split("__").filter(Boolean).at(-1) || decoded : decoded;
  return subject
    .toLowerCase()
    .replace(/[\s\-_【】[\]()（）.,，。!！:：'"“”&~～]+/g, "")
    .trim();
}

export function matchConfidence(coverName: string, resourceName: string): number {
  const coverKey = legacyResourceMatchKey(coverName);
  const resourceKey = legacyResourceMatchKey(resourceName);
  if (!coverKey || !resourceKey) return 0;
  if (coverKey === resourceKey) return 1;
  if (coverKey.includes(resourceKey) || resourceKey.includes(coverKey)) return 0.92;
  return jaccardBigrams(coverKey, resourceKey);
}

function jaccardBigrams(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function bigrams(value: string): Set<string> {
  if (value.length <= 1) return new Set(value ? [value] : []);
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}
