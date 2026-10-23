# RBFX Client Portal

Bilingual English / Bahasa Melayu Malaysia research portal for ten RBFX instruments. Prices, candles and indicator studies are research output, not independently broker-verified, investment advice or trade instructions. The API prioritizes a recent validated RBFX MT5 payload; if unavailable it can use an explicitly labelled Biquote public reference, then a clearly labelled static baseline that does not produce indicators or setup levels.

## Market-feed routes

- `POST /api/mt5-feed` ingests a validated MT5 batch.
- `GET /api/mt5-feed` returns the EA heartbeat status.
- `GET /api/market?asset=XAUUSD` reads a recent EA batch when visible in the same unified `/api/feed` route; `vercel.json` rewrites both ingestion and market paths to that function.
- If a recent EA batch is unavailable, the market endpoint may return Biquote public reference candles, labelled `BIQUOTE_FREE_FALLBACK`; this is not a RoboForex quote and is not broker-authenticated. If public data is unavailable, it can return a static baseline, explicitly marked not live and without inferred indicators or setup levels.
- A valid EA batch expires from the per-instance RAM priority window after 120 seconds. The raw ingestion contract remains `RBFX_MT5`. The UI displays the actual returned source and freshness instead of assuming an EA feed.

## Important Vercel RAM limitation

The shared endpoint allows POST and GET requests to use one module-level RAM slot when they land on the same warm Vercel function instance. RAM is ephemeral and instance-local: cold starts clear it, and Vercel may route the EA POST and browser GET to different instances. Therefore this design is best-effort, not globally shared or guaranteed. If a GET cannot see fresh EA data, it intentionally waits instead of displaying a fallback. Guaranteed cross-instance delivery requires a shared data service; RAM alone cannot provide that guarantee.

## Other endpoints

The economic-calendar endpoint is separate from market prices and does not supply instrument quotes or candles. Access validation is a local format check only; it does not authenticate an account or broker.

## Build and tests

Use `npm test`, `npm run check`, and `npm run build`. Tests verify route unification, RAM heartbeat/freshness, actual source labels, and fail-closed setup behavior for stale or ineligible data. The M15 rules require a closed 20-bar breakout, ≥35% candle body, close in the outer 40%, 0.5×–3.0× ATR range, M15 alignment and 2/4 timeframe alignment (or ≥80% confidence). These thresholds are rule definitions, not backtested performance claims.
