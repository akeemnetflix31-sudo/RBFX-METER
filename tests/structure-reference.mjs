import assert from 'node:assert/strict';
import { deriveM15Setup } from '../scripts/setup-quality.mjs';
import { normalizeMarketPayload } from '../server/functions/market-payload.mjs';

const step = 900_000;
const now = Date.now();
const last = Math.floor(now / step) * step - step;
const assets = {
  XAUUSD: [3991, 2], EURUSD: [1.1189, 5], GBPUSD: [1.34, 5],
  USDJPY: [153.1, 2], USDCHF: [0.8, 5], USDCAD: [1.39, 5],
  AUDUSD: [0.68, 5], NZDUSD: [0.57, 5], BTCUSD: [83000, 2], ETHUSD: [2500, 2]
};
for (const [asset, [price, digits]] of Object.entries(assets)) {
  for (const side of ['BULLISH', 'BEARISH']) {
    const delta = price * 0.0004;
    const m15 = Array.from({ length: 40 }, (_, i) => ({
      t: last - (39 - i) * step, o: price, h: price + delta, l: price - delta, c: price
    }));
    const data = {
      ok: true, asset, digits, enableStructureReference: true, source: 'RBFX_MT5', dataSource: 'RBFX_MT5_RAW_OHLC',
      stale: false, quoteAgeSeconds: 10, feedHeartbeatAgeSeconds: 10,
      referencePrice: price, bias: side,
      timeframes: { M15: { direction: side } },
      charts: { M15: m15, M1: [{ t: Math.floor(now / 60_000) * 60_000 - 60_000,
        o: price, h: price, l: price, c: price }] }
    };
    const result = deriveM15Setup(data, now);
    assert.equal(result.status.state, 'STRUCTURE_REFERENCE', `${asset} ${side}`);
    assert.deepEqual(result.items.map(item => item.label), ['ENTRY', 'SL', 'TP1', 'TP2', 'TP3']);
    const [entry, sl, tp1, tp2, tp3] = result.items.map(item => item.price);
    const sign = side === 'BULLISH' ? 1 : -1;
    assert.ok(side === 'BEARISH' ? entry === Number(price.toFixed(digits)) : price > entry, `${asset}: SELL entry uses bid; BUY entry uses pullback`);
    assert.ok(Math.abs(entry - sl) + 10 ** -digits >= 1.5 * (2 * delta), `${asset}: minimum ATR risk`);
    assert.equal(Number(entry.toFixed(digits)),entry);
    assert.ok(sign * (entry - sl) > 0 && sign * (tp1 - entry) > 0);
    const tick = 10 ** -digits;
    assert.ok(Math.abs(tp1 - (entry + sign * 1.5 * Math.abs(entry - sl))) <= tick * 1.1);
    assert.ok(Math.abs(tp2 - (entry + sign * 2.5 * Math.abs(entry - sl))) <= tick * 1.1);
    assert.ok(Math.abs(tp3 - (entry + sign * 4 * Math.abs(entry - sl))) <= tick * 1.1);
    const normalized = normalizeMarketPayload(structuredClone(data), now);
    assert.equal(normalized.levelType, 'STRUCTURE_REFERENCE');
    assert.equal(normalized.levels.length, 5);
    assert.equal(normalized.levelPrices.entry, entry);
    assert.equal(normalized.levelPrices.tp3, tp3);
    const h1Step = 3_600_000, lastH1 = Math.floor(now / h1Step) * h1Step - h1Step;
    const h1 = Array.from({ length: 30 }, (_, i) => ({ t: lastH1 - (29 - i) * h1Step, o: price, h: price + delta * 3, l: price - delta * 3, c: price }));
    const hourly = deriveM15Setup({ ...data, charts: { ...data.charts, H1: h1 } }, now, 'H1');
    assert.equal(hourly.status.state, 'STRUCTURE_REFERENCE');
    assert.ok(hourly.items[1].price !== sl, 'H1 ATR/stop must differ from M15');
    assert.equal(hourly.items[0].price, side === 'BEARISH' ? entry : Number((price - .382 * 6 * delta).toFixed(digits)));
    assert.deepEqual(deriveM15Setup({ ...data, bias: 'MIXED' }, now).items, [], 'mixed trend must not invent a SELL/BUY direction');
    const publicData = { ...data, source: 'BIQUOTE', dataSource: 'BIQUOTE_FREE_FALLBACK',
      receivedAt: now - 10_000 };
    const publicResult = deriveM15Setup(publicData, now);
    assert.equal(publicResult.status.sourceMode, 'PUBLIC_REFERENCE');
    assert.equal(publicResult.items.length, 5);
    assert.match(publicResult.status.message, /NOT BROKER-VERIFIED/);
    data.stale = true;
    assert.deepEqual(deriveM15Setup(data, now).items, [], 'stale feed cannot create levels');
  }
}
console.log('PASS: 10 instruments × bullish/bearish; dynamic indicative levels, RR, null/stale safety');
