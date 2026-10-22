// Persistent feed storage is intentionally disabled; the unified feed router injects RAM only.
// Contract mirrored by RBFXMeter_ReadOnlyFeed.mq5: v1 envelope, canonical assets,
// epoch-millisecond UTC timestamps, and 30..600 raw closed bars per timeframe.
const FEED_SCHEMA_VERSION = 1;
const ALLOWED_ASSETS = new Set(['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'AUDUSD', 'NZDUSD', 'BTCUSD', 'ETHUSD']);
const MAX_BODY_BYTES = 2_000_000;
const MAX_BARS = 600;
const MIN_BARS = 30;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

function cleanBars(value, interval, now) {
  const step = ({ M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000 })[interval];
  if (!step) return null;
  if (!Array.isArray(value) || value.length < MIN_BARS || value.length > MAX_BARS) return null;
  const rows = [];
  for (const item of value) {
    const bar = { t: Number(item?.t), o: Number(item?.o), h: Number(item?.h), l: Number(item?.l), c: Number(item?.c) };
    if (![bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) || !Number.isSafeInteger(bar.t)) return null;
    if (bar.t < now - 45 * 86400_000 || bar.t > now + 120_000 || bar.o <= 0 || bar.l <= 0 || bar.h < Math.max(bar.o, bar.c) || bar.l > Math.min(bar.o, bar.c)) return null;
    if (bar.t + step > now + 30_000) return null;
    rows.push(bar);
  }
  rows.sort((a, b) => a.t - b.t);
  if (rows.some((row, index) => index > 0 && row.t <= rows[index - 1].t)) return null;
  return rows;
}

function cleanInstrument(value, now) {
  const asset = String(value?.asset || '').toUpperCase();
  const symbol = String(value?.symbol || '').trim();
  if (!ALLOWED_ASSETS.has(asset) || !symbol || symbol.length > 48) return null;
  const bid = Number(value?.quote?.bid), ask = Number(value?.quote?.ask), quoteAt = Number(value?.quote?.t);
  if (![bid, ask, quoteAt].every(Number.isFinite) || !Number.isSafeInteger(quoteAt) || bid <= 0 || ask < bid || quoteAt < now - 45 * 86400_000 || quoteAt > now + 120_000) return null;
  const m1 = cleanBars(value?.m1, 'M1', now);
  const m5 = cleanBars(value?.m5, 'M5', now);
  const m15 = cleanBars(value?.m15, 'M15', now);
  const h1 = cleanBars(value?.h1, 'H1', now);
  if (!m1 || !m5 || !m15 || !h1) return null;
  return { asset, symbol, quote: { bid, ask, t: quoteAt }, m1, m5, m15, h1 };
}

export function createMt5FeedHandler({ storeFactory = null, storageMode = 'DISABLED', clock = () => Date.now() } = {}) {
  return async function handler(request) {
    if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    // The unified /api/feed route injects a volatile RAM adapter; no persistent store is used.
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
    let raw;
    try { raw = await request.text(); } catch { return json({ ok: false, error: 'INVALID_REQUEST' }, 400); }
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
    let payload;
    try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }
    if (payload?.version !== FEED_SCHEMA_VERSION || !Array.isArray(payload?.instruments) || payload.instruments.length < 1 || payload.instruments.length > ALLOWED_ASSETS.size) {
      return json({ ok: false, error: 'INVALID_PAYLOAD' }, 400);
    }
    const now = clock(), instruments = {};
    for (const item of payload.instruments) {
      const clean = cleanInstrument(item, now);
      if (!clean || instruments[clean.asset]) return json({ ok: false, error: 'INVALID_INSTRUMENT_DATA' }, 400);
      instruments[clean.asset] = clean;
    }
    if (!Object.keys(instruments).length) return json({ ok: false, error: 'NO_VALID_INSTRUMENTS' }, 400);
    if (typeof storeFactory !== 'function') return json({ ok: false, error: 'FEED_STORAGE_DISABLED_PUBLIC_MODE' }, 410);
    const feed = { version: 1, source: 'RBFX_MT5', receivedAt: now, instruments };
    try { await storeFactory().setJSON('latest', feed); }
    catch { return json({ ok: false, error: 'FEED_STORE_UNAVAILABLE' }, 503); }
    return json({ ok: true, source: feed.source, storage: storageMode, receivedAt: now, accepted: Object.keys(instruments) });
  };
}

export default createMt5FeedHandler();
