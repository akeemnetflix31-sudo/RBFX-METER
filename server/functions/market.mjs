// Per-instance RAM cache only; market data never uses persistent Blob storage.

const ASSETS = {
  XAUUSD: { name: 'GOLD / XAU/USD', symbol: 'XAUUSD', digits: 2 },
  EURUSD: { name: 'EUR/USD', symbol: 'EURUSD', digits: 5 },
  GBPUSD: { name: 'GBP/USD', symbol: 'GBPUSD', digits: 5 },
  USDJPY: { name: 'USD/JPY', symbol: 'USDJPY', digits: 2 },
  USDCHF: { name: 'USD/CHF', symbol: 'USDCHF', digits: 5 },
  USDCAD: { name: 'USD/CAD', symbol: 'USDCAD', digits: 5 },
  AUDUSD: { name: 'AUD/USD', symbol: 'AUDUSD', digits: 5 },
  NZDUSD: { name: 'NZD/USD', symbol: 'NZDUSD', digits: 5 },
  BTCUSD: { name: 'BTC/USD', symbol: 'BTCUSD', digits: 2 },
  ETHUSD: { name: 'ETH/USD', symbol: 'ETHUSD', digits: 2 }
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

function validateRows(rows, interval, limit, now) {
  const step = ({ '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 })[interval];
  if (!step) throw new Error('unsupported MT5 timeframe');
  if (!Array.isArray(rows)) throw new Error('missing MT5 bars');
  const clean = rows.map(bar => ({ t: Number(bar?.t), o: Number(bar?.o), h: Number(bar?.h), l: Number(bar?.l), c: Number(bar?.c) }))
    .filter(bar => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) && Number.isSafeInteger(bar.t) &&
      bar.c > 0 && bar.o > 0 && bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c) && bar.l > 0 &&
      bar.t + step <= now + 30_000 && bar.t >= now - 45 * 86400_000)
    .sort((a, b) => a.t - b.t);
  const unique = clean.filter((bar, i) => i === 0 || bar.t !== clean[i - 1].t).slice(-limit);
  if (unique.length < 30) throw new Error('insufficient MT5 candle history');
  return unique;
}

function ema(rows, period) {
  if (!rows.length) return [];
  const k = 2 / (period + 1), out = [Number(rows[0].c)];
  for (let i = 1; i < rows.length; i++) out[i] = Number(rows[i].c) * k + out[i - 1] * (1 - k);
  return out;
}
function rsi(rows, period = 14) {
  if (rows.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = rows[i].c - rows[i - 1].c;
    if (delta >= 0) gains += delta; else losses -= delta;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < rows.length; i++) {
    const delta = rows[i].c - rows[i - 1].c;
    avgGain = (avgGain * (period - 1) + Math.max(0, delta)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -delta)) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
function atr(rows, period = 14) {
  if (rows.length <= period) return null;
  const ranges = [];
  for (let i = 1; i < rows.length; i++) ranges.push(Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c)));
  let value = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < ranges.length; i++) value = (value * (period - 1) + ranges[i]) / period;
  return value;
}
function aggregate(rows) {
  if (rows.length < 30) return { direction: 'WARMING UP', label: '—', rules: null };
  const fast = ema(rows, 12), slow = ema(rows, 26), i = rows.length - 1;
  const rules = [rows[i].c > fast[i], fast[i] > slow[i], fast[i] > fast[Math.max(0, i - 8)]];
  const bullish = rules.filter(Boolean).length;
  return { direction: bullish >= 2 ? 'BULLISH' : 'BEARISH', label: `${bullish}/3`, rules };
}

// Directional meter: bullish active timeframes are 100 points each, bearish are 0;
// warming/inactive frames are excluded from the denominator.
export function scoreFromTimeframes(timeframes) {
  const active = Object.values(timeframes || {}).filter(frame =>
    frame?.direction === 'BULLISH' || frame?.direction === 'BEARISH'
  );
  const bullish = active.filter(frame => frame.direction === 'BULLISH').length;
  const bearish = active.length - bullish;
  return {
    active: active.length,
    bullish,
    bearish,
    score: active.length ? Math.round((bullish / active.length) * 100) : null,
    bias: !active.length ? 'MIXED' : bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'MIXED',
    alignment: `${Math.max(bullish, bearish)}/${active.length}`
  };
}
function calculateLevels(bars, digits, now, interval = 900_000) {
  const closed = bars.filter(row => row.t + interval <= now);
  if (closed.length < 25) return { state: 'INSUFFICIENT', items: [] };
  let found = null;
  for (let i = closed.length - 1; i >= 20; i--) {
    const prior = closed.slice(i - 20, i);
    if (prior.length !== 20 || prior.some((row, j) => j && row.t - prior[j - 1].t !== interval)) continue;
    const high = Math.max(...prior.map(x => x.h)), low = Math.min(...prior.map(x => x.l));
    if (closed[i].c > high) { found = { i, side: 'BULLISH' }; break; }
    if (closed[i].c < low) { found = { i, side: 'BEARISH' }; break; }
  }
  if (!found) return { state: 'NO_SETUP', items: [] };
  const bar = closed[found.i], round = n => Number(n.toFixed(digits)), trueRanges = [];
  for (let i = Math.max(1, found.i - 13); i <= found.i; i++) trueRanges.push(Math.max(closed[i].h - closed[i].l, Math.abs(closed[i].h - closed[i - 1].c), Math.abs(closed[i].l - closed[i - 1].c)));
  const range = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length, direction = found.side === 'BULLISH' ? 1 : -1;
  const entry = round((bar.h + bar.l) / 2), stop = round(direction > 0 ? bar.l - range * 0.1 : bar.h + range * 0.1), risk = Math.abs(entry - stop);
  if (risk <= 0) return { state: 'INVALID', items: [] };
  return { state: 'STUDY', side: found.side, items: [{ label: 'ENTRY', price: entry }, { label: 'SL', price: stop }, ...[1, 2, 3].map(n => ({ label: `TP${n}`, price: round(entry + direction * risk * n) }))] };
}
function summarize(asset, series, now) {
  const cfg = ASSETS[asset];
  const frames = { H1: series.H1, M15: series.M15, M5: series.M5, M1: series.M1 };
  const intervals = { H1: 3_600_000, M15: 900_000, M5: 300_000, M1: 60_000 };
  const timeframes = Object.fromEntries(Object.entries(frames).map(([tf, rows]) => [tf, aggregate(rows)]));
  const directional = scoreFromTimeframes(timeframes);
  const last = series.M1.at(-1) || null;
  // Each chart and indicator uses its matching input timeframe. Public fallback M5/H1
  // series are aggregated from complete closed M1/M15 groups before this function runs.
  const charts = {
    H1: series.H1.slice(-120),
    M15: series.M15.slice(-96),
    M5: series.M5.slice(-160),
    M1: series.M1.slice(-400)
  };
  const indicators = Object.fromEntries(Object.entries(frames).map(([tf, rows]) => {
    const fast = ema(rows, 12), slow = ema(rows, 26), i = rows.length - 1;
    return [tf, { ema12: Number.isFinite(fast[i]) ? fast[i] : null, ema26: Number.isFinite(slow[i]) ? slow[i] : null, rsi14: rsi(rows, 14), atr14: atr(rows, 14) }];
  }));
  const levelsByTimeframe = Object.fromEntries(Object.entries(charts).map(([tf, rows]) => [tf, calculateLevels(rows, cfg.digits, now, intervals[tf])]));
  return {
    ok: true, access: 'PUBLIC_TERMINAL', asset, name: cfg.name, digits: cfg.digits,
    referencePrice: last?.c ?? null,
    ageMinutes: last ? Math.max(0, Math.floor((now - (last.t + 60_000)) / 60_000)) : null,
    stale: !last || now - (last.t + 60_000) > 15 * 60_000,
    bias: directional.bias,
    score: directional.score,
    alignment: directional.alignment, activeTimeframes: directional.active,
    bullishTimeframes: directional.bullish, bearishTimeframes: directional.bearish,
    timeframes, indicators,
    charts, levelsByTimeframe, bars: charts.M15, levels: levelsByTimeframe.M15,
    dataSource: 'RBFX_MT5_RAW_OHLC', rawTimeframes: ['H1', 'M15', 'M5', 'M1']
  };
}

export function mt5InstrumentToMarket(asset, feed, now = Date.now()) {
  const instrument = feed?.instruments?.[asset];
  const receivedAt = Number(feed?.receivedAt);
  if (!instrument || feed?.source !== 'RBFX_MT5' || !Number.isFinite(receivedAt) || receivedAt > now + 30_000 || now - receivedAt > 45 * 86400_000) return null;
  const cfg = ASSETS[asset];
  if (!cfg) return null;
  let m1, m5, m15, h1;
  try {
    m1 = validateRows(instrument.m1, '1m', 400, now);
    m5 = validateRows(instrument.m5, '5m', 400, now);
    m15 = validateRows(instrument.m15, '15m', 500, now);
    h1 = validateRows(instrument.h1, '1h', 500, now);
  } catch { return null; }
  const quote = instrument.quote || {}, bid = Number(quote.bid), ask = Number(quote.ask), quoteAt = Number(quote.t);
  if (!(bid > 0) || !(ask >= bid) || !Number.isFinite(quoteAt) || quoteAt > now + 120_000 || quoteAt < now - 45 * 86400_000) return null;
  const data = summarize(asset, { M1: m1, M5: m5, M15: m15, H1: h1 }, now);
  const quoteAgeSeconds = Math.max(0, Math.floor((now - quoteAt) / 1000));
  const heartbeatAgeSeconds = Math.max(0, Math.floor((now - receivedAt) / 1000));
  const latestM1Close = Number(m1.at(-1)?.t) + 60_000;
  const latestM15Close = Number(m15.at(-1)?.t) + 900_000;
  data.referencePrice = quoteAgeSeconds <= 180 ? bid : Number(m1.at(-1)?.c ?? null);
  data.source = 'RBFX_MT5';
  data.sourceLabel = 'RBFX MT5';
  data.sourceSymbol = String(instrument.symbol || asset);
  data.quoteSide = 'BID';
  data.quoteAgeSeconds = quoteAgeSeconds;
  data.receivedAt = receivedAt;
  data.feedHeartbeatAgeSeconds = heartbeatAgeSeconds;
  data.ageMinutes = Math.max(0, Math.floor((now - latestM1Close) / 60_000));
  data.stale = heartbeatAgeSeconds > 180 || quoteAgeSeconds > 180 || now - latestM1Close > 5 * 60_000 || now - latestM15Close > 25 * 60_000;
  return data;
}

const PUBLIC_DATA_CACHE_TTL_MS = 60_000;
const PUBLIC_DATA_CACHE_MAX_STALE_MS = 24 * 60 * 60_000;
const publicMemoryCache = new Map();
const publicInFlight = new Map();

export async function fetchBiquoteBars(symbol, interval, limit, now = Date.now()) {
  const step = ({ '1m': 60_000, '15m': 900_000 })[interval];
  if (!step) throw new Error('unsupported public OHLC interval');
  const endpoint = `https://biquote.io/api/${encodeURIComponent(symbol)}/ohlc?interval=${interval}&limit=${limit}`;
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4_500) });
  if (!response.ok) throw new Error('public reference feed unavailable');
  const payload = await response.json();
  if (payload?.symbol !== symbol || payload?.interval !== interval || !Array.isArray(payload?.bars)) throw new Error('invalid public OHLC response');
  const clean = payload.bars.map(bar => ({
    t: Date.parse(String(bar?.openTime || '')),
    o: Number(bar?.open), h: Number(bar?.high), l: Number(bar?.low), c: Number(bar?.close),
    isOpen: bar?.isOpen === true
  })).filter(bar => Number.isSafeInteger(bar.t) && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) &&
    bar.o > 0 && bar.c > 0 && bar.h >= Math.max(bar.o, bar.c) && bar.l <= Math.min(bar.o, bar.c) && bar.l > 0 &&
    !bar.isOpen && bar.t + step <= now && bar.t >= now - 45 * 86400_000)
    .map(({ isOpen, ...bar }) => bar)
    .sort((a, b) => a.t - b.t);
  const unique = clean.filter((bar, i) => i === 0 || bar.t !== clean[i - 1].t).slice(-limit);
  if (unique.length < 30) throw new Error('insufficient public candle history');
  return unique;
}

export function resampleClosedRows(rows, sourceInterval, targetInterval, now = Date.now()) {
  const sourceStep = ({ '1m': 60_000, '15m': 900_000 })[sourceInterval];
  const targetStep = ({ '5m': 300_000, '1h': 3_600_000 })[targetInterval];
  if (!sourceStep || !targetStep || targetStep % sourceStep) throw new Error('unsupported public resample interval');
  const ratio = targetStep / sourceStep, groups = new Map();
  for (const row of rows) {
    if (row.t + sourceStep > now) continue;
    const start = Math.floor(row.t / targetStep) * targetStep;
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push(row);
  }
  const result = [];
  for (const [start, group] of groups) {
    group.sort((a, b) => a.t - b.t);
    if (group.length !== ratio || start + targetStep > now || group.some((bar, index) => bar.t !== start + index * sourceStep)) continue;
    result.push({
      t: start,
      o: group[0].o,
      h: Math.max(...group.map(bar => bar.h)),
      l: Math.min(...group.map(bar => bar.l)),
      c: group.at(-1).c
    });
  }
  return result.sort((a, b) => a.t - b.t);
}

export function biquoteBarsToMarket(asset, m1, m15, now = Date.now()) {
  const cfg = ASSETS[asset];
  if (!cfg) return null;
  const m5 = resampleClosedRows(m1, '1m', '5m', now);
  const h1 = resampleClosedRows(m15, '15m', '1h', now);
  if ([m1, m5, m15, h1].some(rows => rows.length < 30)) throw new Error('insufficient public multi-timeframe history');
  const data = summarize(asset, { M1: m1, M5: m5, M15: m15, H1: h1 }, now);
  const lastM1 = m1.at(-1), lastM15 = m15.at(-1);
  data.referencePrice = lastM1.c;
  data.ageMinutes = Math.max(0, Math.floor((now - (lastM1.t + 60_000)) / 60_000));
  data.stale = now - (lastM1.t + 60_000) > 5 * 60_000 || now - (lastM15.t + 900_000) > 25 * 60_000;
  data.name = `BIQUOTE · FREE PUBLIC FALLBACK · ${cfg.name}`;
  data.source = 'BIQUOTE';
  data.sourceLabel = 'Biquote free public reference data';
  data.dataSource = 'BIQUOTE_FREE_FALLBACK';
  data.isFallback = true;
  data.quoteSide = 'CLOSE';
  data.receivedAt = lastM1.t + 60_000;
  data.latestM15CloseAt = lastM15.t + 900_000;
  data.fallbackDisclaimer = 'Free public reference data for research; not a broker quote and not broker-authenticated.';
  return data;
}

async function readPublicCache(asset) {
  return publicMemoryCache.get(asset) || null;
}

async function writePublicCache(asset, snapshot) {
  publicMemoryCache.set(asset, snapshot);
}

export async function loadBiquoteFallback(asset, now = Date.now()) {
  const cached = await readPublicCache(asset);
  if (cached && now - Number(cached.fetchedAt) >= 0 && now - Number(cached.fetchedAt) < PUBLIC_DATA_CACHE_TTL_MS) {
    const ageMinutes = Number.isFinite(Number(cached.data.receivedAt)) ? Math.max(0, Math.floor((now - Number(cached.data.receivedAt)) / 60_000)) : cached.data.ageMinutes;
    const stale = Boolean(cached.data.stale) || now - Number(cached.data.receivedAt) > 5 * 60_000 || now - Number(cached.data.latestM15CloseAt) > 25 * 60_000;
    return { ...cached.data, ageMinutes, stale, fallbackCacheState: 'WARM_CACHE' };
  }
  if (publicInFlight.has(asset)) return publicInFlight.get(asset);
  const task = (async () => {
    try {
      const cfg = ASSETS[asset];
      const [m1, m15] = await Promise.all([
        fetchBiquoteBars(cfg.symbol, '1m', 400, now),
        fetchBiquoteBars(cfg.symbol, '15m', 500, now)
      ]);
      const data = biquoteBarsToMarket(asset, m1, m15, now);
      const snapshot = { fetchedAt: now, data };
      await writePublicCache(asset, snapshot);
      return { ...data, fallbackCacheState: 'LIVE_PUBLIC' };
    } catch (error) {
      if (cached && now - Number(cached.fetchedAt) >= 0 && now - Number(cached.fetchedAt) <= PUBLIC_DATA_CACHE_MAX_STALE_MS) {
        return {
          ...cached.data,
          ageMinutes: Number.isFinite(Number(cached.data.receivedAt)) ? Math.max(0, Math.floor((now - Number(cached.data.receivedAt)) / 60_000)) : cached.data.ageMinutes,
          stale: true,
          sourceLabel: 'Biquote cached public reference data',
          dataSource: 'BIQUOTE_FREE_CACHE',
          fallbackCacheState: 'STALE_CACHE',
          fallbackTier: 2,
          fallbackUnavailable: true
        };
      }
      throw error;
    }
  })();
  publicInFlight.set(asset, task);
  try { return await task; }
  finally { publicInFlight.delete(asset); }
}

const STATIC_BASELINE_AT = Date.parse('2026-10-22T12:45:00Z');
const STATIC_BASELINES = Object.freeze({
  XAUUSD: 4081.15, EURUSD: 1.12032, GBPUSD: 1.337095, USDJPY: 157.1885,
  USDCHF: 0.823555, USDCAD: 1.40372, AUDUSD: 0.70124, NZDUSD: 0.56757,
  BTCUSD: 81662.83, ETHUSD: 2400.06
});

export function staticBaselineMarket(asset, now = Date.now()) {
  const cfg = ASSETS[asset], price = STATIC_BASELINES[asset];
  if (!cfg || !Number.isFinite(price)) return null;
  const barAt = step => Math.floor((STATIC_BASELINE_AT - 1) / step) * step;
  const one = step => [{ t: barAt(step), o: price, h: price, l: price, c: price }];
  const charts = { H1: one(3_600_000), M15: one(900_000), M5: one(300_000), M1: one(60_000) };
  const timeframes = Object.fromEntries(['H1', 'M15', 'M5', 'M1'].map(tf => [tf, {
    direction: 'WARMING UP', label: 'Static baseline only · no live trend', rules: [false, false, false], score: null
  }]));
  const indicators = Object.fromEntries(['H1', 'M15', 'M5', 'M1'].map(tf => [tf, { ema12: null, ema26: null, rsi14: null, atr14: null }]));
  const levelsByTimeframe = Object.fromEntries(['H1', 'M15', 'M5', 'M1'].map(tf => [tf, {
    state: 'NO_SETUP', side: null, message: 'STATIC BASELINE · NO ACTIVE SETUP', items: []
  }]));
  return {
    ok: true, access: 'PUBLIC_TERMINAL', asset, name: `ARAS ASAS STATIK / STATIC BASELINE · BUKAN LIVE / NOT LIVE · ${cfg.name}`, digits: cfg.digits,
    referencePrice: price, ageMinutes: Math.max(0, Math.floor((now - STATIC_BASELINE_AT) / 60_000)), stale: true,
    bias: 'MIXED', score: null, alignment: '0/0', activeTimeframes: 0, bullishTimeframes: 0, bearishTimeframes: 0,
    timeframes, indicators, charts, levelsByTimeframe, bars: charts.M15, levels: [],
    source: 'STATIC_BASELINE', sourceLabel: 'Built-in static baseline · not live', dataSource: 'STATIC_BASELINE',
    receivedAt: STATIC_BASELINE_AT, fallbackTier: 3, isFallback: true, staticBaseline: true,
    fallbackDisclaimer: 'Aras asas statik / static baseline only. Bukan data pasaran semasa; no indicators or active setup are inferred.'
  };
}

export async function loadTieredFallback(asset, now = Date.now()) {
  try { return await loadBiquoteFallback(asset, now); }
  catch { return staticBaselineMarket(asset, now); }
}

export function createMarketHandler({ feedReader = null, clock = () => Date.now(), fallbackLoader = loadTieredFallback } = {}) {
  return async function handler(request) {
    if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(request.url), asset = String(url.searchParams.get('asset') || 'XAUUSD').toUpperCase();
    if (!ASSETS[asset]) return json({ ok: false, error: 'ASSET_UNAVAILABLE' }, 400);
    const now = clock();
    let feed = null, mt5Market = null;
    if (typeof feedReader === 'function') {
      try { feed = await feedReader(); } catch { /* public reference fallback may still be available */ }
    }
    mt5Market = mt5InstrumentToMarket(asset, feed, now);
    const receivedAt = Number(feed?.receivedAt);
    const eaPayloadFresh = feed?.source === 'RBFX_MT5' && Number.isFinite(receivedAt) &&
      receivedAt <= now + 30_000 && now - receivedAt < 60_000;
    // A valid, recent EA batch for this instrument has absolute priority, even if
    // individual quotes/candles are stale. Keep its stale state visible; never mask it
    // with public data during the 2-minute heartbeat window.
    if (mt5Market && eaPayloadFresh) {
      mt5Market.fallbackTier = 1;
      mt5Market.feedMode = 'IN_MEMORY_EPHEMERAL';
      mt5Market.sourceLabel = 'EA Master · ephemeral RAM cache';
      return json(mt5Market);
    }
    try {
      const fallback = await fallbackLoader(asset, now);
      if (fallback?.ok) return json(fallback);
    } catch { /* use any available stale MT5 snapshot before failing closed */ }
    if (mt5Market) return json(mt5Market);
    const baseline = staticBaselineMarket(asset, now);
    return baseline ? json(baseline) : json({ ok: false, error: 'ASSET_UNAVAILABLE' }, 400);
  };
}
const handler = createMarketHandler();
export default handler;
export { ASSETS, aggregate, atr, calculateLevels, ema, rsi, summarize, validateRows };
