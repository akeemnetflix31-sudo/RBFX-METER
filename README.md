# RBFX Client Portal

Bilingual English / Bahasa Melayu Malaysia research portal. Market prices, candles, and indicator studies are accepted only from a validated direct EA Master MT5 payload. They are software research output, not independently broker-verified, investment advice, or trade instructions.

## Market-feed routes

- `POST /api/mt5-feed` ingests a validated MT5 batch.
- `GET /api/mt5-feed` returns the EA heartbeat status.
- `GET /api/market?asset=XAUUSD` reads the latest batch from the same unified `/api/feed` route. `vercel.json` rewrites both endpoints into that single function route.
- When no valid EA batch is visible in RAM, the market endpoint returns HTTP 503 with `WAITING_FOR_DIRECT_EA_MASTER_FEED`; the portal shows “Waiting for direct EA Master Feed...” and does not substitute another price/candle provider or static prices.
- A valid batch expires from the RAM feed gate after 120 seconds. EA source status is `EA_MASTER_DIRECT_ONLY`; the raw ingestion contract remains `RBFX_MT5`.

## Important Vercel RAM limitation

The shared endpoint allows POST and GET requests to use one module-level RAM slot when they land on the same warm Vercel function instance. RAM is ephemeral and instance-local: cold starts clear it, and Vercel may route the EA POST and browser GET to different instances. Therefore this design is best-effort, not globally shared or guaranteed. If a GET cannot see fresh EA data, it intentionally waits instead of displaying a fallback. Guaranteed cross-instance delivery requires a shared data service; RAM alone cannot provide that guarantee.

## Other endpoints

The economic-calendar endpoint is separate from market prices and does not supply instrument quotes or candles. Access validation is a local format check only; it does not authenticate an account or broker.

## Build and tests

Use `npm test`, `npm run check`, and `npm run build`. Tests verify route unification, RAM heartbeat/freshness, direct EA source marking, and fail-closed behavior when data is missing or expired.
