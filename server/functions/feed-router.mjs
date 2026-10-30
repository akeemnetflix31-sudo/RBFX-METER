import { normalizeMarketPayload } from './market-payload.mjs';
import { createMarketHandler } from './market.mjs';
import { createMt5FeedHandler } from './mt5-feed.mjs';

// Vercel RAM is ephemeral and instance-local. Both legacy URLs rewrite to this
// function so a warm instance can share its most recent validated batch.
let latestFeed = null;
let latestFeedStoredAt = 0;
const RAM_FEED_TTL_MS = 60_000;

const memoryStoreFactory = () => ({
  async setJSON(key, value) {
    if (key !== 'latest') throw new Error('unsupported volatile feed key');
    latestFeed = value;
    latestFeedStoredAt = Date.now();
    return { modified: true, etag: `ram-${latestFeedStoredAt}` };
  }
});

async function readFreshRamFeed() {
  if (!latestFeed || Date.now() - latestFeedStoredAt >= RAM_FEED_TTL_MS) return null;
  return latestFeed;
}

function feedHeartbeatStatus(now = Date.now()) {
  const hasFeed = Boolean(latestFeed);
  const ageMs = hasFeed ? Math.max(0, now - latestFeedStoredAt) : null;
  const fresh = ageMs !== null && ageMs < RAM_FEED_TTL_MS;
  const assets = Object.keys(latestFeed?.instruments || {});
  return {
    ok: true,
    source: fresh ? 'RBFX_MT5' : null,
    connected: fresh,
    stale: !fresh,
    storage: 'IN_MEMORY_EPHEMERAL',
    cacheScope: 'THIS_WARM_VERCEL_INSTANCE_ONLY',
    feedHeartbeatAgeSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    receivedAt: Number.isFinite(Number(latestFeed?.receivedAt)) ? Number(latestFeed.receivedAt) : null,
    instrumentCount: fresh ? assets.length : 0,
    acceptedInstruments: fresh ? assets : [],
    ttlSecondsRemaining: fresh ? Math.max(0, Math.ceil((RAM_FEED_TTL_MS - ageMs) / 1000)) : 0
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  }});
}

const receiveFeed = createMt5FeedHandler({ storeFactory: memoryStoreFactory, storageMode: 'IN_MEMORY_EPHEMERAL' });
const readMarket = createMarketHandler({ feedReader: readFreshRamFeed });

async function normalizedMarketResponse(request, context) {
  const response = await readMarket(request, context);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return response;
  let data;
  try { data = await response.json(); } catch { return response; }
  if (!response.ok || !data || typeof data !== 'object' || !data.ok) {
    return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  data.enableStructureReference = ['RBFX_MT5', 'BIQUOTE'].includes(data.source) && data.stale === false;
  normalizeMarketPayload(data, Date.now());
  return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
}

export default async function handler(request, context) {
  if (request.method === 'POST') return receiveFeed(request, context);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');
    if (mode === 'feed' || mode === 'status' || (!url.searchParams.has('asset') && mode !== 'market')) {
      return json(feedHeartbeatStatus());
    }
    return normalizedMarketResponse(request, context);
  }
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
}

export { RAM_FEED_TTL_MS, readFreshRamFeed, feedHeartbeatStatus };
