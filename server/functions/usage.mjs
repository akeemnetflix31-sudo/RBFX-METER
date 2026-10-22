import { getStore } from './vercel-blob-store.mjs';

const STORE_PREFIX = 'rbfxmeter-usage';
const STORE_KEY_PREFIX = 'daily/';

export function dateKeyInKualaLumpur(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function storeNameForContext(contextName = 'production') {
  const safeContext = String(contextName || 'production').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24) || 'production';
  return `${STORE_PREFIX}-${safeContext}`;
}

// Best-effort daily aggregate only. The Vercel Blob adapter checks the observed
// ETag before writes, but Blob does not provide an atomic conditional PUT; brief
// concurrent updates may undercount. No account number, IP, or stable ID is stored.
export async function incrementDailyFormatChecks(store, dateKey, maxAttempts = 32) {
  const key = `${STORE_KEY_PREFIX}${dateKey}`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: 'json' });
    const prior = Number(current?.data?.count ?? 0);
    const count = Number.isSafeInteger(prior) && prior >= 0 ? prior : 0;
    const options = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await store.setJSON(key, { count: count + 1 }, options);
    if (result.modified) return count + 1;
    // Brief jitter lets concurrent requests re-read the winning write.
    await new Promise(resolve => setTimeout(resolve, Math.min(2 + attempt * 2, 20) + Math.random() * 5));
  }
  throw new Error('Usage counter update contention exceeded retry limit');
}

export async function recordAnonymousFormatCheck(now = new Date(), contextName = 'production') {
  const store = getStore(storeNameForContext(contextName));
  return incrementDailyFormatChecks(store, dateKeyInKualaLumpur(now));
}

export async function summarizeAnonymousFormatChecks(store, now = new Date()) {
  const today = dateKeyInKualaLumpur(now);
  const { blobs = [] } = await store.list({ prefix: STORE_KEY_PREFIX });
  let totalFormatChecks = 0;
  const countsByDate = new Map();
  // Daily aggregates are small; bounded batches avoid an unbounded burst of reads.
  for (let index = 0; index < blobs.length; index += 25) {
    const batch = blobs.slice(index, index + 25);
    const values = await Promise.all(batch.map(blob => store.get(blob.key, { type: 'json' })));
    values.forEach((value, offset) => {
      const count = Number(value?.count ?? 0);
      const key = batch[offset].key;
      const day = key.startsWith(STORE_KEY_PREFIX) ? key.slice(STORE_KEY_PREFIX.length) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isSafeInteger(count) && count >= 0) {
        totalFormatChecks += count;
        countsByDate.set(day, count);
      }
    });
  }
  const todayStart = new Date(`${today}T00:00:00+08:00`).getTime();
  const daily = Array.from({ length: 30 }, (_, index) => {
    const day = dateKeyInKualaLumpur(new Date(todayStart - (29 - index) * 86400000));
    return { date: day, count: countsByDate.get(day) || 0 };
  });
  return {
    date: today,
    todayFormatChecks: countsByDate.get(today) || 0,
    totalFormatChecks,
    daysWithChecks: blobs.length,
    daily
  };
}

export async function readAnonymousFormatSummary(now = new Date(), contextName = 'production') {
  const store = getStore(storeNameForContext(contextName));
  return summarizeAnonymousFormatChecks(store, now);
}
