const apiOrigin = (process.env.PUBLIC_API_ORIGIN || "https://wall-api.wdbzk.com").replace(/\/$/, "");
const shortOrigin = (process.env.SHORT_LINK_ORIGIN || "https://r.wdbzk.com").replace(/\/$/, "");
const requestRetries = Number(process.env.SMOKE_REQUEST_RETRIES || 12);
const retryDelayMs = Number(process.env.SMOKE_RETRY_DELAY_MS || 5000);

async function get(path) {
  let lastError;
  for (let attempt = 1; attempt <= requestRetries; attempt += 1) {
    try {
      const response = await fetch(`${apiOrigin}${path}`);
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.code === 200) {
        return body.data;
      }
      lastError = new Error(`${path} failed with ${response.status}: ${body.message || body.error || "invalid response"}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < requestRetries) {
      await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
let passcodedShortLinks = 0;
for (const link of detail.shortLinks) {
  assertShortUrl(link.url, `${detail.id} ${link.provider || "storage"}`);
  assert(["quark", "baidu"].includes(link.provider), `${detail.id} short link provider must be quark or baidu`);
  assert(typeof link.label === "string" && link.label.length > 0, `${detail.id} short link label is required`);
  assert(link.passcode === undefined || typeof link.passcode === "string", `${detail.id} short link passcode must be a string when present`);
  if (link.passcode) passcodedShortLinks += 1;
  if (link.provider === "baidu") {
    assert(typeof link.passcode === "string" && link.passcode.length > 0, `${detail.id} baidu short link must expose passcode`);
  }
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
  passcodedShortLinks,
  facetTypes: facets.types.length,
  facetTags: facets.tags.length,
}, null, 2));
