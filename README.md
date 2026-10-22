# RBFX Meter — RBFX Client Portal

Bilingual English / Bahasa Melayu Malaysia portal on Vercel. Market values and setups are software research output only. Public reference prices are not broker-authenticated and may differ from a broker quote. Static baselines are explicitly stale and never produce active setups.

## Unified feed API

`/api/feed` accepts both methods. Vercel rewrites `/api/market` and `/api/mt5-feed` to this same function so GET and POST can share a warm instance's RAM cache.

- `POST /api/mt5-feed` (also `/api/feed`) — validates the v1 EA payload and holds the latest complete batch in volatile RAM for at most 60 seconds. No Vercel Blob or durable database write occurs. A successful response reports `storage: IN_MEMORY_EPHEMERAL`.
- `GET /api/market?asset=XAUUSD` (also `/api/feed?asset=XAUUSD`) — Tier 1 reads the fresh in-memory EA batch, Tier 2 fetches public no-key Biquote closed M1/M15 OHLC, Tier 3 returns one built-in baseline candle when both live tiers fail.

### Vercel RAM limitation

RAM belongs to one warm serverless instance only. Cold starts erase it; scaled instances do not share it; therefore an EA POST and a buyer GET may reach different instances. Tier 1 is best-effort, not a globally reliable stream. The public Biquote fallback compensates when a GET cannot see a live EA batch. A shared, reliable EA stream would require shared persistence or a network cache, which is deliberately not used in this RAM-only mode.

### Fallback safety

- Biquote is used for free public OHLC across the supported FX, metal and crypto symbols; it is not a broker quote. Frankfurter is not used for metals or intraday candle reconstruction, and CoinGecko is not used for broker-equivalent M15 OHLC.
- Tier 3 uses built-in reference values captured on 2026-10-22. It is labelled `STATIC BASELINE · NOT LIVE`, marked stale, shows only a single flat baseline candle, and has no indicators or active setup levels.
- The A+ M15 thresholds, freshness checks, two-hour expiry, invalidation and no-chase logic are unchanged. Static/stale data cannot create an active setup.
- Valid supported market requests fall back rather than return 503 when live tiers fail. Invalid asset values remain client errors; no system can promise that every API error or external provider failure disappears.

## Other API routes

- `POST /api/access` checks exactly eight numeric digits. It does not authenticate/verify an account and does not persist account numbers, IPs or new analytics.
- `GET /api/news` provides economic calendar data with attribution.
- `GET /api/owner-stats` is an optional read-only view of historical anonymous aggregates that may still exist in Blob.

## Vercel Blob

Market/feed and access-check paths do not call Blob. `scripts/cleanup-unused-blob-cache.mjs` lists by default and only deletes stale cache/feed objects after an explicit confirmation; it preserves usage-history and unrelated namespaces. The Blob store may remain paused until its reset window; deleting objects does not reverse the already-counted monthly Advanced Operations.

## Build and test

```sh
npm ci --no-audit --no-fund
npm run build
npm test
npm run check
```

`vercel.json` builds the UI and routes `/api/market` and `/api/mt5-feed` through `/api/feed`. The separate ICTMACROVIP project and `https://ictmacrovip.com/api/feed` endpoint are outside this repository and are not modified.
