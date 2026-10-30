// Candle-only indicative levels. Source selection and freshness validation belong to callers.
// Never infer a quote from missing OHLC data or present this as a verified trade setup.
const STEPS = { M15: 900_000, H1: 3_600_000 };
const finite = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const epoch = value => { const t = finite(value); return t && t > 0 ? t < 1e11 ? t * 1000 : t : null; };

function closedRows(input, step, now) {
  const rows = (Array.isArray(input) ? input : []).map(row => ({
    t: epoch(row?.t), o: finite(row?.o), h: finite(row?.h), l: finite(row?.l), c: finite(row?.c)
  })).filter(row => row.t !== null && row.t + step <= now && row.o > 0 && row.l > 0 && row.c > 0 &&
    row.h >= Math.max(row.o, row.c) && row.l <= Math.min(row.o, row.c))
    .sort((a, b) => a.t - b.t);
  const unique = new Map(rows.map(row => [row.t, row]));
  return [...unique.values()].sort((a, b) => a.t - b.t);
}

/** Returns null when quotes/history are unsuitable; never fabricates missing prices. */
export function calculateInstitutionalLevels(candles, currentPrice, bias, timeframe = 'M15', {
  h1Candles = [], digits = 2, now = Date.now()
} = {}) {
  const step = STEPS[timeframe], price = finite(currentPrice);
  if (!step || !(price > 0) || !['BULLISH', 'BEARISH'].includes(bias) ||
      !Number.isInteger(digits) || digits < 0 || digits > 8) return null;
  const rows = closedRows(candles, step, now);
  if (!rows.length || rows.at(-1).t + step < now - (timeframe === 'M15' ? 25 * 60_000 : 90 * 60_000)) return null;
  const ranges = [];
  for (let i = Math.max(1, rows.length - 14); i < rows.length; i++) {
    const row = rows[i], previous = rows[i - 1];
    if (!previous) return null;
    ranges.push(Math.max(row.h - row.l, Math.abs(row.h - previous.c), Math.abs(row.l - previous.c)));
  }
  // With fewer than 15 closed bars, use their observed range; never synthesize a quote.
  const recentRange = rows.slice(-20).reduce((max, row) => Math.max(max, row.h - row.l), 0);
  const atr = ranges.length && ranges.some(value => value > 0)
    ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : recentRange;
  if (!(atr > 0)) return null;
  const round = value => Number(value.toFixed(digits));
  const sign = bias === 'BULLISH' ? 1 : -1;
  // SELL uses the actual bid/reference quote, never an ATR offset above the market.
  // BUY keeps its bounded M15/H1 pullback study.
  const entry = round(sign < 0 ? price : price - 0.382 * atr);
  const recent = rows.slice(-20);
  // Swing and ATR must come from the selected timeframe, not an unrelated older H1 high.
  const swingBars = recent;
  const swing = sign > 0 ? Math.min(...swingBars.map(row => row.l)) : Math.max(...swingBars.map(row => row.h));
  const minRisk = Math.max(1.5 * atr, 3 * 10 ** -digits);
  const structural = swing - sign * 0.2 * atr;
  const sl = round(sign > 0 ? Math.min(structural, entry - minRisk) : Math.max(structural, entry + minRisk));
  const risk = Math.abs(entry - sl);
  const tp1 = round(entry + sign * 1.5 * risk);
  const tp2 = round(entry + sign * 2.5 * risk);
  const tp3 = round(entry + sign * 4 * risk);
  const values = [entry, sl, tp1, tp2, tp3];
  if (values.some(value => !Number.isFinite(value) || value <= 0) ||
      new Set(values).size !== 5 || sign * (entry - sl) <= 0 ||
      !(sign * (tp1 - entry) > 0 && sign * (tp2 - tp1) > 0 && sign * (tp3 - tp2) > 0)) return null;
  return { entry, sl, tp1, tp2, tp3, atr, timeframe,
    items: ['ENTRY', 'SL', 'TP1', 'TP2', 'TP3'].map((label, index) => ({ label, price: values[index] })) };
}
