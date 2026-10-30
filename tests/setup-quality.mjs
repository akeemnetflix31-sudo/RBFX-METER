import assert from 'node:assert/strict';
import { cleanClosedM15, deriveM15Setup } from '../scripts/setup-quality.mjs';

const step = 15 * 60_000;
const base = 1_800_000_000_000;
function fixture({ price = 102.5, aligned = true, expired = false, source = 'RBFX_MT5', breakout = true, weakCandle = false, confidence = null, stale = false } = {}) {
  const rows = Array.from({ length: 40 }, (_, index) => {
    const t = base + index * step;
    return { t, o: 100, h: 101, l: 99, c: 100 };
  });
  if (breakout) rows[39] = weakCandle
    ? { t: rows[39].t, o: 100.5, h: 103.5, l: 100.4, c: 101.1 }
    : { t: rows[39].t, o: 100.5, h: 103.5, l: 100.4, c: 103.3 };
  if (expired && breakout) {
    for (let n = 1; n <= 9; n++) {
      const t = rows.at(-1).t + step;
      rows.push({ t, o: 103, h: 103.4, l: 102.6, c: 103.1 });
    }
  }
  const last = rows.at(-1), now = last.t + step + 60_000;
  const timeframeDirection = aligned ? 'BULLISH' : 'BEARISH';
  const data = {
    source,
    dataSource: source === 'BIQUOTE' ? 'BIQUOTE_FREE_FALLBACK' : 'RBFX_MT5_RAW_OHLC',
    stale,
    quoteAgeSeconds: 30, feedHeartbeatAgeSeconds: 30, referencePrice: price,
    receivedAt: now - 15_000, ageMinutes: 0,
    digits: 2,
    charts: { M15: rows, M1: [{ t: now - 60_000, o: price, h: price, l: price, c: price }] },
    timeframes: Object.fromEntries(['H1', 'M15', 'M5', 'M1'].map(tf => [tf, { direction: timeframeDirection }]))
  };
  if (confidence !== null) data.confidence = confidence;
  return { now, data };
}

// 15-second heartbeat duplicates and slight timestamp offsets collapse to a single bucket.
const dupRows = [];
for (let i = 0; i < 40; i++) {
  const t = base + i * step;
  const row = i === 39 ? { t, o: 100.5, h: 103.5, l: 100.4, c: 103.3 } : { t, o: 100, h: 101, l: 99, c: 100 };
  for (const offset of [0, 15_000, 30_000]) dupRows.push({ ...row, t: t + offset });
}
const duplicateNow = dupRows.at(-1).t + step + 60_000;
const cleaned = cleanClosedM15(dupRows, duplicateNow);
assert.equal(cleaned.length, 40, 'duplicate heartbeat clones collapse into one M15 bar');
assert(cleaned.every(row => row.t % step === 0), 'all rows are aligned to UTC M15 opens');

const valid = fixture();
const active = deriveM15Setup(valid.data, valid.now);
assert.equal(active.status.state, 'ACTIVE');
assert.equal(active.status.quality, 'A');
assert.equal(active.status.message, 'VALID A SETUP — ACTIVE ENTRY ZONE.');
assert.deepEqual(active.items.map(item => item.label), ['ENTRY', 'SL', 'TP1', 'TP2', 'TP3']);
assert.ok(active.status.expiresAt);

const noBreakout = fixture({ breakout: false });
assert.equal(deriveM15Setup(noBreakout.data, noBreakout.now).status.state, 'NO_SETUP');
assert.equal(deriveM15Setup(noBreakout.data, noBreakout.now).status.message, 'SCANNING NEXT HIGH-PROBABILITY SETUP....');
assert.deepEqual(deriveM15Setup(noBreakout.data, noBreakout.now).items, []);

const poorAlignment = fixture({ aligned: false });
assert.equal(deriveM15Setup(poorAlignment.data, poorAlignment.now).status.state, 'NO_SETUP');
assert.deepEqual(deriveM15Setup(poorAlignment.data, poorAlignment.now).items, []);
const highConfidence = fixture({ aligned: false, confidence: 80 });
assert.equal(deriveM15Setup(highConfidence.data, highConfidence.now).status.state, 'NO_SETUP', 'M15 must still align with displacement direction');
const threeOfFour = fixture();
threeOfFour.data.timeframes.M1.direction = 'BEARISH';
assert.equal(deriveM15Setup(threeOfFour.data, threeOfFour.now).status.state, 'ACTIVE', '3 of 4 aligned timeframes pass the gate');

const weakCandle = fixture({ weakCandle: true });
assert.equal(deriveM15Setup(weakCandle.data, weakCandle.now).status.state, 'NO_SETUP');
const moderateBreakout = fixture();
moderateBreakout.data.charts.M15[39] = { ...moderateBreakout.data.charts.M15[39], o: 101, h: 103.5, l: 100.4, c: 102.3 };
assert.equal(deriveM15Setup(moderateBreakout.data, moderateBreakout.now).status.state, 'ACTIVE', 'moderate but structured breakout passes relaxed candle/ATR criteria');
const publicReference = fixture({ source: 'BIQUOTE' });
const publicSetup = deriveM15Setup(publicReference.data, publicReference.now);
assert.equal(publicSetup.status.state, 'ACTIVE', 'fresh public reference candles can generate study-only setups');
assert.equal(publicSetup.status.quality, 'A');
assert.equal(publicSetup.status.sourceMode, 'PUBLIC_REFERENCE');
assert.match(publicSetup.status.message, /NOT BROKER-VERIFIED/);
assert.equal(publicSetup.items.length, 5);
const stalePublic = fixture({ source: 'BIQUOTE', stale: true });
assert.equal(deriveM15Setup(stalePublic.data, stalePublic.now).status.state, 'NO_SETUP', 'stale public references fail closed');
const wrongPublicCache = fixture({ source: 'BIQUOTE' });
wrongPublicCache.data.dataSource = 'BIQUOTE_FREE_CACHE';
wrongPublicCache.data.stale = true;
assert.equal(deriveM15Setup(wrongPublicCache.data, wrongPublicCache.now).status.state, 'NO_SETUP', 'stale public cache cannot produce levels');

const expired = fixture({ expired: true, price: 103.1 });
const expiredSetup = deriveM15Setup(expired.data, expired.now);
assert.equal(expiredSetup.status.state, 'EXPIRED');
assert.match(expiredSetup.status.message, /SCANNING NEXT HIGH-PROBABILITY SETUP/);
assert.deepEqual(expiredSetup.items, []);

const stopped = fixture({ price: 100 });
assert.equal(deriveM15Setup(stopped.data, stopped.now).status.state, 'INVALIDATED');
assert.deepEqual(deriveM15Setup(stopped.data, stopped.now).items, []);

const reachedTarget = fixture({ price: 108 });
const tp1 = deriveM15Setup(reachedTarget.data, reachedTarget.now);
assert.equal(tp1.status.state, 'HIT_TP1');
assert.equal(tp1.status.message, 'TP HIT — SECURE PROFIT / TRAIL SL TO BREAKEVEN.');
assert.equal(tp1.items.length, 5, 'TP1/TP2 events retain lines until TP3 or invalidation');
const tp3 = fixture({ price: 120 });
const completed = deriveM15Setup(tp3.data, tp3.now);
assert.equal(completed.status.state, 'EXPIRED');
assert.equal(completed.items.length, 0, 'TP3 clears all lines');

const late = fixture({ price: 105.4 });
const lateSetup = deriveM15Setup(late.data, late.now);
assert.equal(lateSetup.status.state, 'LATE');
assert.equal(lateSetup.status.message, 'LATE TO CATCH UP — PRICE MOVED AWAY FROM ENTRY (WAIT PULLBACK / DO NOT CHASE).');
assert.equal(lateSetup.items.length, 0, 'late setup does not invite a chase with displayed levels');

// The ten supported RBFX symbols share this price-agnostic setup lifecycle.
for (const asset of ['XAUUSD','EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','BTCUSD','ETHUSD']) {
  const sample = fixture();
  sample.data.asset = asset;
  assert.equal(deriveM15Setup(sample.data, sample.now).items.length, 5, `${asset} gets the same validated setup lifecycle`);
}
console.log('PASS: RBFX A-grade gate, M15 bucket dedup, TP/SL/structure/expiry lifecycle, late-chase control, and ten-symbol fixture coverage.');
