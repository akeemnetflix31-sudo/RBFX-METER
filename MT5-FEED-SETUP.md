# MT5 feed setup — direct EA only

The EA POST route and portal market GET route are both rewritten to `/api/feed`, which keeps their in-process handlers and module-level RAM store together on a warm Vercel function instance.

## Endpoints

- `POST /api/mt5-feed` — validated v1 payload; successful response identifies `dataSource: EA_MASTER_DIRECT_ONLY`.
- `GET /api/mt5-feed` — heartbeat status including freshness, accepted instrument count, and the cache scope.
- `GET /api/market?asset=XAUUSD` — reads the same RAM payload and returns `dataSource: EA_MASTER_DIRECT_ONLY` when it can see a valid fresh EA batch.

Payloads must include canonical asset names, a recent timestamp/quote, and 30–600 valid closed OHLC bars for each supported M1, M5, M15, and H1 interval. Only accepted EA payloads younger than 120 seconds are served.

When no fresh valid EA payload exists, `/api/market` returns HTTP 503 with status `WAITING_FOR_DIRECT_EA_MASTER_FEED` and the portal displays “Waiting for direct EA Master Feed...”. The API fails closed and serves only valid, fresh EA prices and candles. The portal retries the market endpoint every 3 seconds while waiting.

No Vercel Storage is used for market data, feed delivery, or format-check statistics.

## Vercel RAM constraint

RAM is instance-local and ephemeral. A cold start clears it, and Vercel may route the EA POST and portal GET to different warm instances even though both URLs share the same function route. As a result, a request may show the waiting state until that instance receives an EA POST. This does not provide guaranteed cross-instance synchronization.

The displayed study is not independently broker-verified and is for software research only; it is not a trading instruction or performance promise.
