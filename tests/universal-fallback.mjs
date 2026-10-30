import assert from 'node:assert/strict';
import router from '../server/functions/feed-router.mjs';
import { calculateInstitutionalLevels } from '../scripts/institutional-levels.mjs';

const now = Date.now(), originalFetch = globalThis.fetch;
function candles(step, count, price = 1.12) {
  const last = Math.floor(now / step) * step - step;
  return Array.from({ length: count }, (_, index) => {
    const t = last - (count - index - 1) * step;
    return { t, o: price, h: price + .001, l: price - .001, c: price };
  });
}
assert.equal(calculateInstitutionalLevels([], 1.12, 'BULLISH'), null);
assert.equal(calculateInstitutionalLevels(null, 1.12, 'BULLISH'), null);
assert.equal(calculateInstitutionalLevels(candles(900000, 40), null, 'BULLISH'), null);
globalThis.fetch = async url => {
  const request = new URL(url), parts = request.pathname.split('/');
  const symbol = parts[2], interval = request.searchParams.get('interval');
  const step = interval === '1m' ? 60000 : 900000;
  return Response.json({ symbol, interval,
    bars: candles(step, interval === '1m' ? 400 : 160).map(row => ({
      openTime: new Date(row.t).toISOString(), open: row.o, high: row.h, low: row.l, close: row.c,
      isOpen: false
    })) });
};
try {
  const feed = await router(new Request('https://example.test/api/feed?mode=feed'));
  assert.equal((await feed.json()).connected, false, 'offline EA');
  const response = await router(new Request('https://example.test/api/market?asset=EURUSD'));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.source, 'BIQUOTE');
  assert.equal(data.stale, false);
  assert.equal(data.levelType, 'STRUCTURE_REFERENCE');
  assert.deepEqual(data.levels.map(item => item.label), ['ENTRY','SL','TP1','TP2','TP3']);
  assert.ok(['entry','sl','tp1','tp2','tp3'].every(key => Number.isFinite(data[key])));
  assert.ok(data.enableStructureReference, 'browser will recompute from same M15 rows');
  console.log('PASS: offline EA + fresh public candles => 5 source-independent indicative levels');
} finally {
  globalThis.fetch = originalFetch;
}
