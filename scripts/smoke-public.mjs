const apiOrigin = (process.env.PUBLIC_API_ORIGIN || "https://wall-api.wdbzk.com").replace(/\/$/, "");
const shortOrigin = (process.env.SHORT_LINK_ORIGIN || "https://r.wdbzk.com").replace(/\/$/, "");

async function get(path) {
  const response = await fetch(`${apiOrigin}${path}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 200) {
    throw new Error(`${path} failed with ${response.status}: ${body.message || body.error || "invalid response"}`);
  }
  return body.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertCoverUrl(value, label) {
  assert(typeof value === "string" && value.startsWith(`${apiOrigin}/assets/`), `${label} coverUrl must be served from ${apiOrigin}/assets`);
}

function assertShortUrl(value, label) {
  assert(typeof value === "string" && value.startsWith(`${shortOrigin}/`), `${label} short link must be served from ${shortOrigin}`);
}

const health = await get("/health");
assert(health.ok === true, "health endpoint must return ok");
const list = await get("/api/wallpapers?page=1&pageSize=3");
assert(Array.isArray(list.list), "wallpaper list must be an array");
assert(list.list.length > 0, "wallpaper list must not be empty");
for (const item of list.list) {
  assert(typeof item.id === "string" && item.id, "wallpaper id is required");
  assert(typeof item.title === "string" && item.title, "wallpaper title is required");
  assertCoverUrl(item.coverUrl, `wallpaper ${item.id}`);
}

const first = list.list[0];
const detail = await get(`/api/wallpapers/${encodeURIComponent(first.id)}`);
assert(detail.id === first.id, "detail id must match list item id");
assertCoverUrl(detail.coverUrl, `detail ${detail.id}`);
assert(Array.isArray(detail.shortLinks) && detail.shortLinks.length > 0, "detail must expose at least one short link");
for (const link of detail.shortLinks) {
  assertShortUrl(link.url, `${detail.id} ${link.provider || "storage"}`);
}

const facets = await get("/api/wallpapers/facets");
assert(Array.isArray(facets.types), "facets.types must be an array");
assert(Array.isArray(facets.tags), "facets.tags must be an array");

console.log(JSON.stringify({
  ok: true,
  apiOrigin,
  shortOrigin,
  health: health.ok,
  checkedListItems: list.list.length,
  detailId: detail.id,
  shortLinks: detail.shortLinks.length,
  facetTypes: facets.types.length,
  facetTags: facets.tags.length,
}, null, 2));
