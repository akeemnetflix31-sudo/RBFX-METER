# RBFX Meter EA feed — ephemeral RAM mode

The current design accepts a read-only EA feed without persisting it to Vercel Blob. The EA should post its existing v1 payload to `/api/mt5-feed`; Vercel rewrites that route to the same `/api/feed` function used by market GET requests.

## Important Vercel limitation

The feed is held in process memory for up to 120 seconds only. Vercel may send the EA POST and a buyer GET to different serverless instances, and a cold start clears the cache. The EA feed is therefore best-effort, not a globally shared live stream. When the request cannot see a fresh EA batch, the portal falls back to Biquote public OHLC; if that provider is unavailable, it shows a static stale baseline with no active setup.

## API behavior

- `POST /api/mt5-feed` or `POST /api/feed` validates asset IDs, JSON size, timestamps and OHLC shape. A successful response identifies `storage: IN_MEMORY_EPHEMERAL`; no Blob write occurs.
- `GET /api/mt5-feed` (also `GET /api/feed?mode=feed`) returns heartbeat status, age, instrument count and warm-instance scope. `GET /api/market?asset=...` or `GET /api/feed?asset=...` prioritizes an accepted EA batch from the last 120 seconds if visible on the current instance; stale quote/candle markers are preserved. After that window, market data falls back to Biquote.
- The A+ M15 filter, 2-hour expiry, invalidation, stale-data rejection and no-chase rules are unchanged. Static baseline data cannot generate an active setup.

This endpoint is part of RBFX Meter only. The separate ICTMACROVIP endpoint `https://ictmacrovip.com/api/feed` is not changed.
