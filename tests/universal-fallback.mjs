import assert from 'node:assert/strict';
import router from '../server/functions/feed-router.mjs';
import { calculateInstitutionalLevels } from '../scripts/institutional-levels.mjs';

const now = Date.now(), originalFetch = globalThis.fetch;
const assets = { XAUUSD: 3994, EURUSD: 1.12, GBPUSD: 1.34, USDJPY: 157.18, USDCHF: .82, USDCAD: 1.4, AUDUSD: .7, NZDUSD: .57, BTCUSD: 81000, ETHUSD: 2400 };
const digits = symbol => ['XAUUSD','USDJPY','BTCUSD','ETHUSD'].includes(symbol) ? 2 : 5;
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
  const price = assets[symbol], spread = price > 100 ? price * .001 : .001;
  return Response.json({ symbol, interval,
    bars: candles(step, interval === '1m' ? 400 : 160, price).map(row => ({
      openTime: new Date(row.t).toISOString(), open: row.o, high: row.o + spread, low: row.o - spread, close: row.c,
      isOpen: false
    })) });
};
try {
  const feed = await router(new Request('https://example.test/api/feed?mode=feed'));
  assert.equal((await feed.json()).connected, false, 'offline EA');
  for (const symbol of Object.keys(assets)) {
    const response = await router(new Request(`https://example.test/api/market?asset=${symbol}`));
    const data = await response.json();
    assert.equal(response.status, 200, symbol);
    assert.equal(data.source, 'BIQUOTE', symbol);
    assert.equal(data.stale, false, symbol);
    assert.equal(data.levelType, 'STRUCTURE_REFERENCE', symbol);
    assert.deepEqual(data.levels.map(item => item.label), ['ENTRY','SL','TP1','TP2','TP3'], symbol);
    assert.ok(['entry','sl','tp1','tp2','tp3'].every(key => Number.isFinite(data[key]) && data[key] > 0 && data[key] === data.levelPrices[key]), symbol);
    assert.equal(data.digits, digits(symbol), symbol);
    assert.ok(data.enableStructureReference, `${symbol} browser will recompute from same M15 rows`);
  }
  // Recent one-bar candles can support a clearly indicative range estimate.
  const sparse = calculateInstitutionalLevels(candles(900000, 1, 157.18), 157.18, 'BULLISH', 'M15', { digits: 2, now });
  assert.equal(sparse?.items.length, 5);
  assert.equal(calculateInstitutionalLevels(candles(900000, 1, 157.18).map(row => ({ ...row, h: row.c, l: row.c })), 157.18, 'BULLISH', 'M15', { digits: 2, now }), null);
  console.log('PASS: offline EA + fresh public candles => 5 indicative levels for all 10 assets');
} finally {
  globalThis.fetch = originalFetch;
}
