import { timingSafeEqual } from 'node:crypto';
import { readAnonymousFormatSummary } from './usage.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Authorization'
    }
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(request, context) {
  if (request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  const secret = process.env.OWNER_STATS_PASSWORD || '';
  if (secret.length < 32) return json({ ok: false, error: 'OWNER_STATS_NOT_CONFIGURED' }, 503);
  const authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!safeEqual(supplied, secret)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  try {
    const stats = await readAnonymousFormatSummary(new Date(), context?.deploy?.context || 'production');
    return json({ ok: true, ...stats });
  } catch {
    return json({ ok: false, error: 'STATS_UNAVAILABLE' }, 503);
  }
}
