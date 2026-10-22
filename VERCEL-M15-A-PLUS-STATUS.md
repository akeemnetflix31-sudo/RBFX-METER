# RBFX Vercel — M15 A+ build status

## Source layout

The RBFX source tree is restored with the required Vercel layout: `api/`, `server/functions/`, `scripts/`, `public/`, `tests/`, and `mt5/` at repository root. `package.json`, `package-lock.json`, and `vercel.json` are at root.

## Changes

- Normalize/deduplicate OHLC timestamps to timeframe buckets; M15 uses 900,000 ms buckets.
- Gate M15 A+ setups on valid MT5 feed, M15 structure displacement/momentum, alignment of at least 3/4 or confidence at least 80%, and valid risk/reward ordering.
- Clear setup levels on invalidation, expiry, or TP3; retain TP1/TP2 study levels with warnings and show late-entry warning.
- Keep the RoboForex MT5 feed read-only and preserve RBFX API routes.

## Local verification

Passed on the restored source tree:

- `npm test`
- `npm run check`
- `npm run build`
- `node --check public/chart.bundle.js`
- `node --check public/setup-quality.bundle.js`

## Deployment

Deployment verification is pending. Do not treat a Vercel build as complete until `/api/access`, `/api/market`, and `/api/news` are confirmed live with HTTP 200 and the production UI is checked. ICT Macro is a separate Cloudflare project and is not part of this source tree.
