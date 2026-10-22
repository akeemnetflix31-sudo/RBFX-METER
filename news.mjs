let cache = null;
const CACHE_MS = 5 * 60_000;
const MAX_STALE_MS = 24 * 60 * 60_000;
const EVENT_WINDOW_PAST_MS = 2 * 3_600_000;
const EVENT_WINDOW_FUTURE_MS = 36 * 3_600_000;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=240', 'X-Content-Type-Options': 'nosniff' }
});
function safeLink(value, fallback = 'https://www.financecalendar.com/') {
  if (typeof value !== 'string') return fallback;
  try {
    const link = new URL(value);
    if (link.protocol === 'https:') return link.href;
    if (link.protocol === 'http:') { link.protocol = 'https:'; return link.href; }
  } catch { /* use safe fallback */ }
  return fallback;
}
function normalizeEvents(rows, kind, now) {
  if (!Array.isArray(rows)) throw new Error('invalid calendar response');
  return rows.map(event => {
    const timeUtc = String(kind === 'primary' ? (event?.time_utc || '') : (event?.time || ''));
    const impact = String(kind === 'primary' ? (event?.impact || '') : (event?.importance || '')).toLowerCase();
    const consensus = kind === 'primary' ? event?.consensus : event?.forecast;
    const prior = kind === 'primary' ? event?.prior : event?.previous;
    const actual = event?.actual;
    const url = kind === 'primary'
      ? safeLink(event?.url, 'https://www.financecalendar.com/')
      : safeLink(event?.sourceUrl, 'https://www.financecalendar.com/');
    return {
      name: String(event?.name || event?.title || 'Scheduled event').slice(0, 140),
      impact,
      timeUtc,
      consensus: consensus == null ? '—' : String(consensus).slice(0, 80),
      prior: prior == null ? '—' : String(prior).slice(0, 80),
      actual: actual == null ? '—' : String(actual).slice(0, 80),
      url
    };
  }).filter(event => ['high', 'medium'].includes(event.impact) && Number.isFinite(Date.parse(event.timeUtc)) && Date.parse(event.timeUtc) >= now - EVENT_WINDOW_PAST_MS && Date.parse(event.timeUtc) <= now + EVENT_WINDOW_FUTURE_MS)
    .sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc)).slice(0, 40);
}
async function requestJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error('calendar unavailable');
  return response.json();
}
async function fetchPrimary(now) {
  const from = new Date(now - EVENT_WINDOW_PAST_MS).toISOString().slice(0, 10);
  const to = new Date(now + 2 * 86_400_000).toISOString().slice(0, 10);
  const url = `https://www.financecalendar.com/wp-json/fc/v1/calendar?from=${from}&to=${to}&limit=100`;
  const payload = await requestJson(url);
  return normalizeEvents(payload?.events, 'primary', now);
}
function eventsFromCache(now) {
  if (!cache) return null;
  const events = cache.data.events.filter(event => {
    const time = Date.parse(event.timeUtc);
    return Number.isFinite(time) && time >= now - EVENT_WINDOW_PAST_MS && time <= now + EVENT_WINDOW_FUTURE_MS;
  });
  return { ok: true, events, stale: true };
}
async function loadNews(now) {
  if (cache && now - cache.at < CACHE_MS) return { ...cache.data, stale: false };
  try {
    const events = await fetchPrimary(now);
    const data = { ok: true, events };
    cache = { at: now, data };
    return { ...data, stale: false };
  } catch {
    if (cache && now - cache.at <= MAX_STALE_MS) return eventsFromCache(now);
    throw new Error('calendar unavailable');
  }
}
export default async function handler(request) {
  if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  try { return json(await loadNews(Date.now())); }
  catch { return json({ ok: false, error: 'NEWS_CALENDAR_UNAVAILABLE' }, 503); }
}
export { fetchPrimary, normalizeEvents };
