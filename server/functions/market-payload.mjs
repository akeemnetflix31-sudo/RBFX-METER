import { deriveM15Setup } from '../../scripts/setup-quality.mjs';

const STEP_MS = { H1: 3_600_000, M15: 900_000, M5: 300_000, M1: 60_000 };
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function normalizeBars(rows, step) {
  const input = (Array.isArray(rows) ? rows : []).map(row => {
    let t = finite(row?.t); if (t !== null && t > 0 && t < 100_000_000_000) t *= 1000;
    return { t, o: finite(row?.o), h: finite(row?.h), l: finite(row?.l), c: finite(row?.c) };
  }).filter(row => row.t !== null && row.t > 0 && row.o !== null && row.h !== null && row.l !== null && row.c !== null &&
    row.o > 0 && row.l > 0 && row.h >= Math.max(row.o, row.c) && row.l <= Math.min(row.o, row.c))
    .sort((a, b) => a.t - b.t);
  const buckets = new Map();
  for (const row of input) {
    const t = Math.floor(row.t / step) * step, existing = buckets.get(t);
    if (!existing) buckets.set(t, { t, o: row.o, h: row.h, l: row.l, c: row.c });
    else { existing.h = Math.max(existing.h, row.h); existing.l = Math.min(existing.l, row.l); existing.c = row.c; }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}
export function normalizeMarketPayload(data, now = Date.now()) {
  const charts = { ...data.charts };
  for (const [timeframe, step] of Object.entries(STEP_MS)) {
    if (Array.isArray(charts[timeframe])) charts[timeframe] = normalizeBars(charts[timeframe], step);
  }
  data.charts = charts;
  data.bars = charts.M15 || normalizeBars(data.bars, STEP_MS.M15);
  const setup = deriveM15Setup(data, now);
  const status = setup.status || { state: 'NO_SETUP', message: 'SCANNING NEXT HIGH-PROBABILITY SETUP....' };
  data.levels = setup.items;
  data.levelsByTimeframe = { ...data.levelsByTimeframe, M15: {
    state: status.state, side: status.side || null, message: status.message || '', items: setup.items
  } };
  return data;
}
