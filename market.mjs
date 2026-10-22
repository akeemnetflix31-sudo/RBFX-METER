// Market data is derived from fresh EA payloads held in per-instance RAM only.

const ASSETS = {
  XAUUSD: { name: 'GOLD / XAU/USD', symbol: 'XAUUSD', digits: 2 },
  EURUSD: { name: 'EUR/USD', symbol: 'EURUSD', digits: 5 },
  GBPUSD: { name: 'GBP/USD', symbol: 'GBPUSD', digits: 5 },
  USDJPY: { name: 'USD/JPY', symbol: 'USDJPY', digits: 3 },
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
  // Each chart and indicator uses its matching EA input timeframe.
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
    dataSource: 'EA_MASTER_DIRECT_ONLY', rawTimeframes: ['H1', 'M15', 'M5', 'M1']
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
  data.sourceLabel = 'EA Master · direct feed';
  data.dataSource = 'EA_MASTER_DIRECT_ONLY';
  data.cacheScope = 'THIS_WARM_VERCEL_INSTANCE_ONLY';
  data.sourceSymbol = String(instrument.symbol || asset);
  data.quoteSide = 'BID';
  data.quoteAgeSeconds = quoteAgeSeconds;
  data.receivedAt = receivedAt;
  data.feedHeartbeatAgeSeconds = heartbeatAgeSeconds;
  data.ageMinutes = Math.max(0, Math.floor((now - latestM1Close) / 60_000));
  data.stale = heartbeatAgeSeconds > 180 || quoteAgeSeconds > 180 || now - latestM1Close > 5 * 60_000 || now - latestM15Close > 25 * 60_000;
  return data;
}

export function createMarketHandler({ feedReader = null, clock = () => Date.now() } = {}) {
  return async function handler(request) {
    if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    const url = new URL(request.url), asset = String(url.searchParams.get('asset') || 'XAUUSD').toUpperCase();
    if (!ASSETS[asset]) return json({ ok: false, error: 'ASSET_UNAVAILABLE' }, 400);
    const now = clock();
    let feed = null;
    if (typeof feedReader === 'function') {
      try { feed = await feedReader(); } catch { /* fail closed below */ }
    }
    const receivedAt = Number(feed?.receivedAt);
    const eaPayloadFresh = feed?.source === 'RBFX_MT5' && Number.isFinite(receivedAt) &&
      receivedAt <= now + 30_000 && now - receivedAt <= 120_000;
    const mt5Market = eaPayloadFresh ? mt5InstrumentToMarket(asset, feed, now) : null;
    if (mt5Market) {
      mt5Market.feedMode = 'IN_MEMORY_EPHEMERAL';
      mt5Market.sourceLabel = 'EA Master · ephemeral RAM cache';
      mt5Market.dataSource = 'EA_MASTER_DIRECT_ONLY';
      mt5Market.cacheScope = 'THIS_WARM_VERCEL_INSTANCE_ONLY';
      return json(mt5Market);
    }
    return json({ ok: false, asset, source: null, dataSource: 'EA_MASTER_DIRECT_ONLY',
      status: 'WAITING_FOR_DIRECT_EA_MASTER_FEED', message: 'Waiting for direct EA Master Feed...',
      cacheMode: 'IN_MEMORY_EPHEMERAL', cacheScope: 'THIS_WARM_VERCEL_INSTANCE_ONLY' }, 503);
  };
}
const handler = createMarketHandler();
export default handler;
export { ASSETS, aggregate, atr, calculateLevels, ema, rsi, summarize, validateRows };
