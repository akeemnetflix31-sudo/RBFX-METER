import { normalizeMarketPayload } from '../../api/market.mjs';
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
  if (!latestFeed) return null;
  if (Date.now() - latestFeedStoredAt > RAM_FEED_TTL_MS) {
    latestFeed = null;
    latestFeedStoredAt = 0;
    return null;
  }
  return latestFeed;
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
  normalizeMarketPayload(data, Date.now());
  return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
}

export default async function handler(request, context) {
  if (request.method === 'POST') return receiveFeed(request, context);
  if (request.method === 'GET') return normalizedMarketResponse(request, context);
  return new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

export { RAM_FEED_TTL_MS, readFreshRamFeed };
