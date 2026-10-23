const M15_MS = 15 * 60_000;
const SETUP_TTL_MS = 2 * 60 * 60_000;
const MAX_FEED_AGE_SECONDS = 180;
const MIN_TF_ALIGNMENT = 2;
const MIN_BODY_RATIO = 0.35;
const MAX_CLOSE_FROM_EDGE_RATIO = 0.40;
const MIN_BREAKOUT_ATR_MULTIPLE = 0.5;
const MAX_BREAKOUT_ATR_MULTIPLE = 3.0;
const LATE_ENTRY_R_THRESHOLD = 0.75;
const REQUIRED_TIMEFRAMES = ['H1', 'M15', 'M5', 'M1'];
const LEVEL_LABELS = ['ENTRY', 'SL', 'TP1', 'TP2', 'TP3'];
const TP_WARNING = 'TP HIT — SECURE PROFIT / TRAIL SL TO BREAKEVEN.';
const LATE_WARNING = 'LATE TO CATCH UP — PRICE MOVED AWAY FROM ENTRY (WAIT PULLBACK / DO NOT CHASE).';
const SCANNING = 'SCANNING NEXT HIGH-PROBABILITY SETUP....';

const noSetup = (state = 'NO_SETUP', labelKey = 'noSetup', tone = 'muted', extra = {}) => ({
  state, labelKey, tone, late: false, items: [], message: SCANNING, ...extra
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function epochMs(value) {
  const time = finite(value);
  return time !== null && time > 0 ? (time < 100_000_000_000 ? time * 1000 : time) : null;
}
function intervalRows(data, interval) {
  const source = data?.charts?.[interval];
  if (Array.isArray(source)) return source;
  return interval === 'M15' && Array.isArray(data?.bars) ? data.bars : [];
}

function isQualifiedFeed(data, now) {
  if (!data || data.stale !== false) return false;
  const quote = finite(data.referencePrice);
  if (quote === null || quote <= 0) return false;
  const m1 = intervalRows(data, 'M1'), m15 = intervalRows(data, 'M15');
  const lastM1 = m1[m1.length - 1], lastM15 = m15[m15.length - 1];
  const m1Time = epochMs(lastM1?.t), m15Time = epochMs(lastM15?.t);
  if (m1Time === null || m15Time === null) return false;
  const recentBars = now - (m1Time + 60_000) <= 5 * 60_000 && now - (m15Time + M15_MS) <= 25 * 60_000;
  if (!recentBars) return false;

  // Public Biquote candles may be used for explicitly-labelled research only.
  // They are not broker quotes and do not authenticate the feed sender.
  if (data.source === 'BIQUOTE' && data.dataSource === 'BIQUOTE_FREE_FALLBACK') {
    const receivedAt = epochMs(data.receivedAt);
    return receivedAt !== null && receivedAt <= now + 30_000 && now - receivedAt <= 5 * 60_000;
  }

  if (data.source !== 'RBFX_MT5' || data.dataSource !== 'RBFX_MT5_RAW_OHLC') return false;
  const quoteAge = finite(data.quoteAgeSeconds), heartbeatAge = finite(data.feedHeartbeatAgeSeconds);
  return quoteAge !== null && heartbeatAge !== null && quoteAge <= MAX_FEED_AGE_SECONDS && heartbeatAge <= MAX_FEED_AGE_SECONDS;
}

/** UTC M15 normalizer: round epoch to the bucket-open and merge repeated heartbeat rows. */
export function cleanClosedM15(rows, now = Date.now()) {
  const sorted = (Array.isArray(rows) ? rows : []).map(row => ({
    t: epochMs(row?.t), o: finite(row?.o), h: finite(row?.h), l: finite(row?.l), c: finite(row?.c)
  })).filter(row => row.t !== null && row.o !== null && row.h !== null && row.l !== null && row.c !== null &&
    row.o > 0 && row.c > 0 && row.h >= Math.max(row.o, row.c) && row.l <= Math.min(row.o, row.c) && row.l > 0)
    .sort((a, b) => a.t - b.t);
  const buckets = new Map();
  for (const row of sorted) {
    const t = Math.floor(row.t / M15_MS) * M15_MS;
    if (t + M15_MS > now) continue;
    const previous = buckets.get(t);
    if (!previous) buckets.set(t, { t, o: row.o, h: row.h, l: row.l, c: row.c });
    else {
      previous.h = Math.max(previous.h, row.h);
      previous.l = Math.min(previous.l, row.l);
      previous.c = row.c;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function atrAt(rows, index, period = 14) {
  const start = Math.max(1, index - period + 1), ranges = [];
  for (let i = start; i <= index; i++) {
    const row = rows[i], previous = rows[i - 1];
    ranges.push(Math.max(row.h - row.l, Math.abs(row.h - previous.c), Math.abs(row.l - previous.c)));
  }
  return ranges.length === period ? ranges.reduce((sum, value) => sum + value, 0) / period : null;
}

function findLatestBreakout(rows) {
  let found = null;
  for (let i = 20; i < rows.length; i++) {
    const window = rows.slice(i - 20, i);
    if (window.length !== 20 || window.some((row, index) => index > 0 && row.t - window[index - 1].t !== M15_MS)) continue;
    if (rows[i].t - rows[i - 1].t !== M15_MS) continue;
    const high = Math.max(...window.map(row => row.h));
    const low = Math.min(...window.map(row => row.l));
    if (rows[i].c > high) found = { index: i, side: 'BULLISH', structure: high };
    else if (rows[i].c < low) found = { index: i, side: 'BEARISH', structure: low };
  }
  return found;
}

function hasTrendQuality(timeframes, side, confidence) {
  if (timeframes?.M15?.direction !== side) return false;
  const matches = REQUIRED_TIMEFRAMES.filter(tf => timeframes?.[tf]?.direction === side).length;
  return matches >= MIN_TF_ALIGNMENT || confidence >= 80;
}
function buildStatus(state, labelKey, tone, extra = {}) {
  return { state, labelKey, tone, late: false, ...extra };
}
function marketLevels(entry, stop, risk, sign, round) {
  const prices = { entry, stop, tp1: round(entry + sign * risk), tp2: round(entry + sign * risk * 2), tp3: round(entry + sign * risk * 3) };
  const values = [prices.entry, prices.stop, prices.tp1, prices.tp2, prices.tp3];
  if (values.some(value => !Number.isFinite(value) || value <= 0) || new Set(values).size !== values.length) return null;
  if (sign > 0 ? !(prices.stop < prices.entry && prices.tp1 > prices.entry && prices.tp2 > prices.tp1 && prices.tp3 > prices.tp2)
               : !(prices.stop > prices.entry && prices.tp1 < prices.entry && prices.tp2 < prices.tp1 && prices.tp3 < prices.tp2)) return null;
  return prices;
}
function setupItems(prices) {
  return LEVEL_LABELS.map((label, index) => ({ label, price: [prices.entry, prices.stop, prices.tp1, prices.tp2, prices.tp3][index] }));
}

/** Rule-based M15 research setup from fresh eligible candles; not trade execution. */
function deriveM15SetupCore(data, now = Date.now()) {
  if (!isQualifiedFeed(data, now)) return { status: noSetup(), items: [] };
  const rows = cleanClosedM15(intervalRows(data, 'M15'), now);
  if (rows.length < 34) return { status: noSetup('INSUFFICIENT', 'insufficient'), items: [] };
  const breakout = findLatestBreakout(rows);
  if (!breakout) return { status: noSetup(), items: [] };

  const bar = rows[breakout.index], openedAt = bar.t, expiresAt = openedAt + M15_MS + SETUP_TTL_MS;
  const expiry = new Date(expiresAt).toISOString();
  if (now >= expiresAt) return { status: buildStatus('EXPIRED', 'setupExpired', 'expired', { expiresAt: expiry, message: SCANNING }), items: [] };

  const range = bar.h - bar.l, body = Math.abs(bar.c - bar.o), atr = atrAt(rows, breakout.index);
  const closeAtEdge = range > 0 ? (breakout.side === 'BULLISH' ? (bar.h - bar.c) / range : (bar.c - bar.l) / range) : Infinity;
  const confidence = finite(data.confidence ?? data.confidencePct ?? data.confidencePercentage) ?? 0;
  if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(atr) || atr <= 0 ||
      body / range < MIN_BODY_RATIO || closeAtEdge > MAX_CLOSE_FROM_EDGE_RATIO ||
      range < MIN_BREAKOUT_ATR_MULTIPLE * atr || range > MAX_BREAKOUT_ATR_MULTIPLE * atr ||
      !hasTrendQuality(data.timeframes, breakout.side, confidence)) return { status: noSetup(), items: [] };

  const digits = Number.isInteger(Number(data.digits)) ? Math.max(0, Math.min(8, Number(data.digits))) : 2;
  const round = value => Number(value.toFixed(digits));
  const sign = breakout.side === 'BULLISH' ? 1 : -1;
  const entry = round((bar.h + bar.l) / 2);
  const stop = round(sign > 0 ? bar.l - 0.1 * atr : bar.h + 0.1 * atr);
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return { status: noSetup(), items: [] };
  const prices = marketLevels(entry, stop, risk, sign, round);
  if (!prices) return { status: noSetup(), items: [] };

  let invalidated = false, targetHit = 0, reason = '';
  // Walk post-breakout closed M15 bars so a stop/structure breach is not forgotten after a bounce.
  for (let i = breakout.index + 1; i < rows.length; i++) {
    const row = rows[i];
    const stopOnBar = sign > 0 ? row.l <= prices.stop : row.h >= prices.stop;
    const structureFailed = sign > 0 ? row.c <= breakout.structure : row.c >= breakout.structure;
    let targetOnBar = 0;
    for (let n = 3; n >= 1; n--) {
      if (sign > 0 ? row.h >= prices[`tp${n}`] : row.l <= prices[`tp${n}`]) { targetOnBar = n; break; }
    }
    if (stopOnBar || structureFailed) {
      invalidated = true;
      reason = structureFailed ? 'structure invalidated' : 'SL violated';
      break;
    }
    targetHit = Math.max(targetHit, targetOnBar);
  }
  const price = finite(data.referencePrice);
  if (price === null || price <= 0) return { status: noSetup(), items: [] };
  const stoppedNow = sign > 0 ? price <= prices.stop : price >= prices.stop;
  const structureFailedNow = sign > 0 ? price <= breakout.structure : price >= breakout.structure;
  if (stoppedNow || structureFailedNow) {
    invalidated = true;
    reason = structureFailedNow ? 'structure invalidated' : 'SL violated';
  }
  if (invalidated) return { status: buildStatus('INVALIDATED', 'setupStopped', 'invalidated', { expiresAt: expiry, message: `${reason}. ${SCANNING}` }), items: [] };

  const liveTarget = sign > 0 ? price >= prices.tp3 ? 3 : price >= prices.tp2 ? 2 : price >= prices.tp1 ? 1 : 0
                               : price <= prices.tp3 ? 3 : price <= prices.tp2 ? 2 : price <= prices.tp1 ? 1 : 0;
  targetHit = Math.max(targetHit, liveTarget);
  if (targetHit >= 3) return { status: buildStatus('EXPIRED', 'setupHitTP3', 'expired', { expiresAt: expiry, message: `TP3 hit; old levels cleared. ${SCANNING}` }), items: [] };

  const progress = sign * (price - prices.entry) / Math.max(risk, Number.EPSILON);
  const late = progress >= LATE_ENTRY_R_THRESHOLD;
  const items = setupItems(prices);
  if (targetHit > 0) {
    return {
      status: buildStatus(`HIT_TP${targetHit}`, 'tpHitWarning', 'hit', {
        expiresAt: expiry, side: breakout.side, breakoutAt: new Date(openedAt + M15_MS).toISOString(),
        quality: 'A', tpHit: targetHit, late, warning: TP_WARNING, message: TP_WARNING
      }),
      items
    };
  }
  if (late) {
    return {
      status: buildStatus('LATE', 'lateWarning', 'expired', {
        late: true, expiresAt: expiry, side: breakout.side, quality: 'A', warning: LATE_WARNING, message: LATE_WARNING
      }),
      items: []
    };
  }
  const filled = progress >= 0, nearEntry = Math.abs(progress) < 0.5;
  return {
    status: buildStatus(filled ? 'ACTIVE' : 'PENDING', filled ? 'setupActive' : 'setupPending', filled ? 'active' : 'pending', {
      expiresAt: expiry, side: breakout.side, breakoutAt: new Date(openedAt + M15_MS).toISOString(), quality: 'A',
      message: nearEntry ? 'VALID A SETUP — ACTIVE ENTRY ZONE.' : 'VALID A SETUP — WAIT FOR ENTRY RETRACEMENT.'
    }),
    items
  };
}

export function deriveM15Setup(data, now = Date.now()) {
  const result = deriveM15SetupCore(data, now);
  if (data?.source !== 'BIQUOTE') return result;
  const note = 'PUBLIC REFERENCE STUDY — NOT BROKER-VERIFIED.';
  return {
    ...result,
    status: {
      ...result.status,
      sourceMode: 'PUBLIC_REFERENCE',
      message: `${result.status?.message || SCANNING} · ${note}`
    }
  };
}

if (typeof window !== 'undefined') window.RBFXSetupQuality = { deriveM15Setup, cleanClosedM15 };
