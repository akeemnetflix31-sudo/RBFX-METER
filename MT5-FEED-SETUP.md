# RoboForex MT5 read-only feed for RBFX Meter on Vercel

The portal uses closed candles and the latest Bid quote sent by the configured RoboForex MT5 terminal. It has no public market-data fallback. The EA is read-only and contains no order-send, trade, modify, or close functions.

## Public endpoint warning

`POST /api/mt5-feed` requires no token or Authorization header. Any internet client can submit a valid-shaped payload and overwrite the latest stored feed. Schema, OHLC, and timestamp validation cannot prove that the data came from RoboForex. Do not treat the payload as authenticated broker data. Vercel Blob or function outages can result in HTTP 503 responses.

## Data flow

1. `mt5/RBFXMeter_ReadOnlyFeed.mq5` synchronizes M1/M5/M15/H1 history. M1 and M15 source bars must be available; incomplete M5/H1 can be recovered by the backend.
2. The EA converts broker-server times to UTC milliseconds using `TimeTradeServer() - TimeGMT()` and posts every 60 seconds to `/api/mt5-feed`.
3. `server/functions/mt5-feed.mjs` validates the v1 payload, instrument IDs, timestamps, and OHLC bars; complete lower-timeframe groups can be used to resample missing M5/H1 data.
4. `/api/market?asset=...` calculates indicators from each timeframe and returns 503 if there is no valid stored MT5 batch. It never switches to a public price source.
5. Reference levels are calculated from closed M15 bars using the application's study rules. These are software reference levels, not orders or realized trade outcomes.

## Vercel setup

1. Connect a **private Vercel Blob store** to this project in Vercel Storage. The Vercel Blob SDK will use Vercel OIDC credentials automatically in production. Do not paste access tokens into source files or chat.
2. Deploy the full project, including its `/api` functions. Publishing only `public/` will not publish the API.
3. After the project is deployed, replace `YOUR-VERCEL-PROJECT.vercel.app` in the EA's `InpEndpoint` with the assigned Vercel host, compile the EA in MetaEditor, and attach it to the MT5 terminal.
4. In MT5, open Tools → Options → Expert Advisors and allow WebRequest for the Vercel site's origin, for example `https://YOUR-VERCEL-PROJECT.vercel.app`.
5. Confirm the EA logs a successful upload, then check `/api/market?asset=XAUUSD` and the portal's LIVE/STALE status. The private Blob store is empty after initial setup until the EA posts a valid batch.

## EA configuration

`InpPortalAssets` and `InpBrokerSymbols` are comma-separated lists with matching counts and ordering. Auto-detection checks the configured name, aliases such as `GOLD` → `XAUUSD`, common suffixes, then scans broker symbols. M1/M15 require at least 30 closed bars. Keep MT5/VPS connected; the sender omits forming bars and does not require the account password.

## Data integrity

The ingestion route is public and unauthenticated. A `LIVE` badge means recent validated data is available; it is not cryptographic proof of broker origin. Independently compare the portal against the same symbol, closed candle, account, and server in MT5. If `/api/market` returns `MT5_FEED_UNAVAILABLE`, no alternate market price is supplied.
