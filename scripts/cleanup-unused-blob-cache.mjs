import { del, list } from '@vercel/blob';

const DAY_MS = 24 * 60 * 60 * 1000;
const DRY_RUN = !process.argv.includes('--delete');
const NOW = Date.now();
const TARGETS = [
  { prefix: 'rbfxmeter-free-market-cache/', maxAgeMs: DAY_MS, label: 'obsolete public market cache' },
  { prefix: 'rbfxmeter-market-feed/', maxAgeMs: DAY_MS, label: 'stale legacy MT5 latest snapshot' }
];

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is not available in this environment. No files were changed.');
  process.exit(1);
}

async function listPrefix(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, limit: 250, cursor });
    blobs.push(...(page.blobs || []));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

const candidates = [];
for (const target of TARGETS) {
  const blobs = await listPrefix(target.prefix);
  for (const blob of blobs) {
    const uploadedAt = new Date(blob.uploadedAt).getTime();
    const ageMs = Number.isFinite(uploadedAt) ? Math.max(0, NOW - uploadedAt) : Infinity;
    if (ageMs >= target.maxAgeMs) candidates.push({ ...blob, label: target.label, ageMs });
  }
}

console.log(`${DRY_RUN ? 'DRY RUN' : 'DELETE MODE'}: ${candidates.length} stale Blob object(s) matched.`);
for (const blob of candidates) {
  console.log(`${blob.pathname} · ${blob.label} · ${Math.floor(blob.ageMs / DAY_MS)} day(s) old`);
}

if (DRY_RUN || candidates.length === 0) {
  console.log(DRY_RUN ? 'No deletion performed. Re-run with --delete only after reviewing the list.' : 'Nothing to delete.');
  process.exit(0);
}

if (process.env.CONFIRM_UNUSED_BLOB_CLEANUP !== 'DELETE_STALE_RBFX_CACHE') {
  console.error('Deletion blocked. Set CONFIRM_UNUSED_BLOB_CLEANUP=DELETE_STALE_RBFX_CACHE to confirm this targeted cleanup.');
  process.exit(2);
}

for (let index = 0; index < candidates.length; index += 50) {
  const batch = candidates.slice(index, index + 50);
  await del(batch.map(blob => blob.url));
}
console.log(`Deleted ${candidates.length} stale objects from the two RBFX cache/feed prefixes. Other Blob namespaces were not touched.`);
