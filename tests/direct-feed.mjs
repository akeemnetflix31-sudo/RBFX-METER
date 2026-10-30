import assert from 'node:assert/strict';
import router, { readFreshRamFeed } from '../server/functions/feed-router.mjs';
import { normalizeAsset } from '../server/functions/mt5-feed.mjs';

const now = Date.now();
const bars = (step, count) => {
  const last = Math.floor(now / step) * step - step;
  return Array.from({ length: count }, (_, i) => {
    const t = last - (count - i - 1) * step, c = 2600 + i * .01;
    return { t, o: c - .01, h: c + .04, l: c - .04, c };
  });
};
assert.equal(normalizeAsset('GOLD'), 'XAUUSD');
assert.equal(normalizeAsset('XAUUSD.m'), 'XAUUSD');
assert.equal(normalizeAsset('EURUSD_raw'), 'EURUSD');
// Actual EA contract: M5 and H1 may be empty if broker history is unavailable.
const payload = { version: 1, instruments: [{ asset: 'XAUUSD', symbol: 'XAUUSD.m',
  quote: { bid: 2600.39, ask: 2600.41, t: now },
  m1: bars(60_000, 200), m5: [], m15: bars(900_000, 140), h1: [] }] };
const post = await router(new Request('https://example.test/api/mt5-feed', {
  method: 'POST', body: JSON.stringify(payload)
}));
const result = await post.json();
assert.equal(post.status, 200, JSON.stringify(result));
assert.equal(result.stored, true);
assert.deepEqual(result.accepted, ['XAUUSD']);
const feed = await readFreshRamFeed();
assert.ok(feed.instruments.XAUUSD.m5.length >= 30);
assert.ok(feed.instruments.XAUUSD.h1.length >= 30);
const market = await router(new Request('https://example.test/api/market?asset=XAUUSD'));
assert.equal((await market.json()).source, 'RBFX_MT5');
assert.equal((await router(new Request('https://example.test/api/feed?mode=feed'))).status, 200);
console.log('PASS direct feed: optional M5/H1 reconstruction, broker suffix, same-instance POST/GET');
