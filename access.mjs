function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

// Public portal syntax filter only: accepts any exactly 8-digit numeric string, with no prefix restriction.
// This is only a format filter; it does not verify identity, account type, ownership, session, or membership.
export default async function handler(request, context) {
  if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  let payload;
  try { payload = await request.json(); } catch { return json({ ok: false, error: 'INVALID_REQUEST' }, 400); }
  const accountNumber = String(payload?.accountNumber ?? '').trim();
  if (!/^\d{8}$/.test(accountNumber)) return json({ ok: false, error: 'ACCOUNT_FORMAT_INVALID', message: 'Masukkan tepat 8 digit angka.' }, 400);
  // Format validation does not persist account data.
  return json({ ok: true, access: 'PUBLIC_TERMINAL', formatValid: true, accessExpiry: null });
}
