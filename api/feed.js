// CommonJS entry point; preserve the original validated MT5 feed/market pipeline.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const [{ default: feedRouter }, { vercelHandler }] = await Promise.all([
      import('../server/functions/feed-router.mjs'),
      import('./_shared.mjs')
    ]);
    return await vercelHandler(feedRouter)(req, res);
  } catch (err) {
    if (res.headersSent) return res.end();
    return res.status(200).json({ status: 'ERROR_RECOVERED', error: String(err?.message || err), markets: {} });
  }
};
// Prevent Vercel from pre-parsing malformed JSON into a runtime-level 500.
module.exports.config = { api: { bodyParser: false } };
