# RBFX Vercel — M15 bucket & A+ lifecycle update

## Status

Local Vercel project source updated and build/test verified. **Not deployed to Vercel Production.** The Vercel `main` project has no Git repository connected, and this source workspace was missing its `server/functions/` directory. The existing server modules were recovered from the archived 2.7.7 deployment package and the current market module was recovered from the local deployment file manifest. Because this project is the live RBFX Meter, production was not replaced without a verified complete deployment package.

Production site remains `rbfxmeter-vercel-migration.vercel.app`; no ICT Macro API/feed was connected or changed.

## Changes prepared

- Normalize and deduplicate timestamps in all chart timeframes, with M15 buckets at `floor(t / 900000) * 900000`; merge repeated same-bucket OHLC snapshots before API output and chart rendering.
- Enforce an A+ M15 setup gate: genuine fresh RoboForex MT5 feed only, closed 20-bar structure break, candle displacement/momentum, and either at least 3/4 directional timeframe alignment or confidence at least 80%; M15 must agree with breakout direction.
- Validate SL/ENTRY/TP ordering and positive risk before exposing levels.
- Clear all five level values on SL/structure invalidation, setup expiry, and TP3; show placeholders as `-` and the requested next-scan message.
- Retain levels after TP1/TP2 with the requested secure-profit / breakeven warning. Show the exact late-to-catch-up warning once price has travelled at least half the Entry-to-TP1 risk; do not chase.
- All other RBFX assets and the existing `/api/market` feed route remain distinct from ICT Macro.

## Verification

Passed locally:

- `npm test`
- `npm run check`
- `npm run build`
- `node --check public/chart.bundle.js`
- `node --check public/setup-quality.bundle.js`

Production read-only baseline (before this source update): `/api/market?asset=` returned HTTP 200 and fresh MT5 data for all ten RBFX assets; each response had unique, M15-aligned timestamps. This is a baseline check, not a post-deploy check.

## To publish

Reconnect the source repository to Vercel project `main` or run a verified deployment from this complete package. Then deploy to Production and recheck all ten `/api/market?asset=` payloads plus chart/UI lifecycle states. Until then, production still has the previous code.
