import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import access from '../server/functions/access.mjs';
import market, { createMarketHandler, mt5InstrumentToMarket } from '../server/functions/market.mjs';
import { createMt5FeedHandler } from '../server/functions/mt5-feed.mjs';
import feedRouter, { feedHeartbeatStatus, readFreshRamFeed, RAM_FEED_TTL_MS } from '../server/functions/feed-router.mjs';
import news from '../server/functions/news.mjs';
import ownerStats from '../server/functions/owner-stats.mjs';
import { vercelHandler } from '../api/_shared.mjs';

const projectRoot = new URL('../', import.meta.url);
const now = Date.now();
const makeBars = (intervalMs, count = 40) => {
  const lastOpen = Math.floor(now / intervalMs) * intervalMs - intervalMs;
  return Array.from({ length: count }, (_, index) => {
    const close = 2600 + index * 0.01;
    return { t: lastOpen - (count - 1 - index) * intervalMs, o: close - 0.02, h: close + 0.05, l: close - 0.05, c: close };
  });
};
const sampleInstrument = {
  asset: 'XAUUSD', symbol: 'XAUUSD', quote: { bid: 2600.39, ask: 2600.41, t: now },
  m1: makeBars(60_000), m5: makeBars(300_000), m15: makeBars(900_000), h1: makeBars(3_600_000)
};

// Portal syntax endpoint remains an 8-digit format check, not an identity validator.
const validAccess = await access(new Request('https://example.test/api/access', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountNumber: '12345678' })
}));
assert.equal(validAccess.status, 200);
assert.equal((await validAccess.json()).access, 'PUBLIC_TERMINAL');
const invalidAccess = await access(new Request('https://example.test/api/access', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountNumber: '1234' })
}));
assert.equal(invalidAccess.status, 400);

// MT5 ingestion validates the batch; the unified router uses only an ephemeral RAM adapter.
let latestFeed = null;
const feedHandler = createMt5FeedHandler({ clock: () => now, storeFactory: () => ({ setJSON: async (_key, feed) => { latestFeed = feed; } }) });
const feedResponse = await feedHandler(new Request('https://example.test/api/mt5-feed', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ version: 1, instruments: [sampleInstrument] })
}));
assert.equal(feedResponse.status, 200);
assert.deepEqual((await feedResponse.json()).accepted, ['XAUUSD']);
assert.equal(latestFeed.source, 'RBFX_MT5');
const marketData = mt5InstrumentToMarket('XAUUSD', latestFeed, now);
assert.equal(marketData?.source, 'RBFX_MT5');
assert.equal(marketData?.charts.M15.length, 40);
assert.equal(marketData?.rawTimeframes.join(','), 'H1,M15,M5,M1');
const defaultRamFeedHandler = createMt5FeedHandler({ clock: () => now });
const defaultRamFeedResponse = await defaultRamFeedHandler(new Request('https://example.test/api/mt5-feed', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ version: 1, instruments: [sampleInstrument] })
}));
assert.equal(defaultRamFeedResponse.status, 200);
assert.equal((await defaultRamFeedResponse.json()).storage, 'IN_MEMORY_EPHEMERAL');

const noFeed = createMarketHandler({ feedReader: async () => null, fallbackLoader: async () => { throw new Error('fallback unavailable in this test'); }, clock: () => now });
const staticFallbackResponse = await noFeed(new Request('https://example.test/api/market?asset=XAUUSD'));
assert.equal(staticFallbackResponse.status, 200);
const staticFallbackData = await staticFallbackResponse.json();
assert.equal(staticFallbackData.source, 'STATIC_BASELINE');
assert.equal(staticFallbackData.fallbackTier, 3);
assert.equal(staticFallbackData.stale, true);
assert.equal(staticFallbackData.levels.length, 0);
assert.equal(staticFallbackData.charts.M15.length, 1);
assert.equal(staticFallbackData.timeframes.M15.direction, 'WARMING UP');
assert.equal((await noFeed(new Request('https://example.test/api/market?asset=NOTASSET'))).status, 400);
const publicOnlyMarket = createMarketHandler({ fallbackLoader: async () => ({ ok: true, source: 'BIQUOTE', dataSource: 'BIQUOTE_FREE_FALLBACK' }), clock: () => now });
const publicOnlyResponse = await publicOnlyMarket(new Request('https://example.test/api/market?asset=XAUUSD&mode=market'));
assert.equal(publicOnlyResponse.status, 200);
assert.equal((await publicOnlyResponse.json()).source, 'BIQUOTE');

const ramPost = await feedRouter(new Request('https://example.test/api/mt5-feed', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ version: 1, instruments: [sampleInstrument] })
}));
assert.equal(ramPost.status, 200);
assert.equal((await ramPost.json()).storage, 'IN_MEMORY_EPHEMERAL');
assert.equal((await readFreshRamFeed())?.source, 'RBFX_MT5');
const ramStatusResponse = await feedRouter(new Request('https://example.test/api/mt5-feed?mode=feed'));
assert.equal(ramStatusResponse.status, 200);
const ramStatus = await ramStatusResponse.json();
assert.equal(ramStatus.connected, true);
assert.equal(ramStatus.instrumentCount, 1);
assert.deepEqual(ramStatus.acceptedInstruments, ['XAUUSD']);
assert.equal(ramStatus.storage, 'IN_MEMORY_EPHEMERAL');
assert.equal(ramStatus.cacheScope, 'THIS_WARM_VERCEL_INSTANCE_ONLY');
assert.equal(RAM_FEED_TTL_MS, 60_000);
const ramMarket = await feedRouter(new Request('https://example.test/api/market?asset=XAUUSD'));
assert.equal(ramMarket.status, 200);
const ramMarketData = await ramMarket.json();
assert.equal(ramMarketData.source, 'RBFX_MT5');
assert.equal(ramMarketData.feedMode, 'IN_MEMORY_EPHEMERAL');
assert.equal(ramMarketData.fallbackTier, 1);
const staleQuoteFeed = JSON.parse(JSON.stringify(latestFeed));
staleQuoteFeed.instruments.XAUUSD.quote.t = now - 181_000;
let fallbackCalledForRecentEa = false;
const recentEaMarket = createMarketHandler({ feedReader: async () => staleQuoteFeed, fallbackLoader: async () => { fallbackCalledForRecentEa = true; return { ok: true, source: 'BIQUOTE' }; }, clock: () => now });
const recentEaResponse = await recentEaMarket(new Request('https://example.test/api/market?asset=XAUUSD'));
assert.equal(recentEaResponse.status, 200);
const recentEaData = await recentEaResponse.json();
assert.equal(recentEaData.source, 'RBFX_MT5');
assert.equal(recentEaData.stale, true);
assert.equal(fallbackCalledForRecentEa, false);
const oldFeed = { ...latestFeed, receivedAt: now - 61_000 };
const expiredEaMarket = createMarketHandler({ feedReader: async () => oldFeed, fallbackLoader: async () => ({ ok: true, source: 'BIQUOTE' }), clock: () => now });
assert.equal((await (await expiredEaMarket(new Request('https://example.test/api/market?asset=XAUUSD'))).json()).source, 'BIQUOTE');
const originalDateNow = Date.now;
Date.now = () => originalDateNow() + 61_000;
assert.equal(await readFreshRamFeed(), null);
assert.equal(feedHeartbeatStatus().connected, false);
Date.now = originalDateNow;
assert.equal((await market(new Request('https://example.test/api/market', { method: 'POST' }))).status, 405);
assert.equal((await news(new Request('https://example.test/api/news', { method: 'POST' }))).status, 405);

const originalSecret = process.env.OWNER_STATS_PASSWORD;
delete process.env.OWNER_STATS_PASSWORD;
assert.equal((await ownerStats(new Request('https://example.test/api/owner-stats'))).status, 503);
process.env.OWNER_STATS_PASSWORD = 'migration-test-secret-with-more-than-thirty-two-characters';
assert.equal((await ownerStats(new Request('https://example.test/api/owner-stats'))).status, 401);
if (originalSecret === undefined) delete process.env.OWNER_STATS_PASSWORD; else process.env.OWNER_STATS_PASSWORD = originalSecret;

// Vercel's Node adapter preserves URL/query, method, headers, JSON body, and response headers.
const wrapped = vercelHandler(async request => new Response(JSON.stringify({
  method: request.method, path: new URL(request.url).pathname, query: new URL(request.url).searchParams.get('asset'),
  payload: await request.json()
}), { status: 201, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }));
const fakeReq = {
  method: 'POST', url: '/api/access?asset=XAUUSD', headers: { host: 'rbfxmeter.vercel.app', 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
  body: Buffer.from('{"accountNumber":"12345678"}')
};
const responseHeaders = {};
const fakeRes = { statusCode: 0, setHeader: (key, value) => { responseHeaders[key.toLowerCase()] = value; }, end: value => { fakeRes.body = value?.toString() || ''; } };
await wrapped(fakeReq, fakeRes);
assert.equal(fakeRes.statusCode, 201);
assert.equal(responseHeaders['cache-control'], 'no-store');
assert.deepEqual(JSON.parse(fakeRes.body), { method: 'POST', path: '/api/access', query: 'XAUUSD', payload: { accountNumber: '12345678' } });
// When the runtime throws during JSON body parsing, the adapter must return 400.
const malformedReq = {
  method: 'POST', url: '/api/feed', headers: { host: 'example.test', 'content-type': 'application/json' },
  get body() { throw new SyntaxError('Unexpected token in JSON'); }
};
const malformedRes = { statusCode: 0, setHeader() {}, end(value) { this.body = value.toString(); } };
await vercelHandler(async () => { throw new Error('should not run'); })(malformedReq, malformedRes);
assert.equal(malformedRes.statusCode, 400);
assert.equal(JSON.parse(malformedRes.body).error, 'INVALID_JSON_OR_REQUEST');


const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const apiFiles = await readdir(new URL('../api/', import.meta.url));
assert.equal(apiFiles.includes('market.mjs'), false, 'market alias must not shadow the shared feed rewrite');
assert.equal(apiFiles.includes('mt5-feed.mjs'), false, 'MT5 alias must not shadow the shared feed rewrite');
assert.equal(config.outputDirectory, 'public');
assert.equal(config.buildCommand, 'npm run build');
assert.ok(config.functions['api/**/*.mjs']);
assert.ok(config.rewrites.some(route => route.source === '/api/market' && route.destination === '/api/feed?mode=market'));
assert.ok(config.rewrites.some(route => route.source === '/api/mt5-feed' && route.destination === '/api/feed?mode=feed'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.ok(packageJson.dependencies['@vercel/blob']);
const marketSource = await readFile(new URL('../server/functions/market.mjs', import.meta.url), 'utf8');
const feedRouterSource = await readFile(new URL('../server/functions/feed-router.mjs', import.meta.url), 'utf8');
const accessSource = await readFile(new URL('../server/functions/access.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(marketSource, /getStore|readLatestMt5Feed|publicDataStore/);
assert.doesNotMatch(feedRouterSource, /getMt5FeedStore|publicDataStore|@vercel\/blob/);
assert.doesNotMatch(accessSource, /recordAnonymousFormatCheck|getStore|setJSON/);
const legacyPackage = ['@', ['net', 'lify'].join(''), '/blobs'].join('');
assert.equal(Object.hasOwn(packageJson.dependencies, legacyPackage), false);

const legacyProvider = ['net', 'lify'].join('');
const forbidden = new RegExp(`${legacyProvider}|\\.${legacyProvider}|@${legacyProvider}`, 'i');
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.vercel', '.git'].includes(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) await scan(full);
    else if (!entry.name.endsWith('.lock') && !entry.name.endsWith('.png') && !entry.name.endsWith('.jpg')) {
      const text = await readFile(full, 'utf8').catch(() => '');
      assert.doesNotMatch(text, forbidden, `legacy platform reference in ${relative(resolve(projectRoot.pathname), full)}`);
    }
  }
}
await scan(resolve(projectRoot.pathname));
console.log('PASS: 60-second EA priority, shared API route wiring, per-instance heartbeat, and fallback behavior.');
