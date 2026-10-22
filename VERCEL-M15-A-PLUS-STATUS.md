# RBFX Meter — direct EA-only status

- Both `/api/mt5-feed` and `/api/market` rewrite to the unified `/api/feed` handler.
- Validated EA MT5 payloads are stored in a module-level volatile RAM slot, with a strict market-source gate of 120 seconds.
- Successful market responses identify `dataSource: EA_MASTER_DIRECT_ONLY`; no public market provider or static baseline is invoked when EA data is absent, malformed, or expired. The portal fails closed to the waiting state.
- M15 study levels are produced only from qualified fresh direct EA OHLC. Non-EA, stale, or malformed input cannot create active study levels.
- Vercel RAM remains ephemeral and local to one warm instance. Routing both endpoints through one function reduces cross-route divergence but does not provide instance affinity or guaranteed cross-instance sharing. A GET can legitimately wait if it lands on a RAM instance that has not received the latest POST.
- The economic calendar is a separate information endpoint; it does not feed quote or candle data.

Verification: `npm test`, `npm run check`, and `npm run build`; inspect that the Vercel rewrites target `/api/feed`, and confirm an accepted live feed returns `EA_MASTER_DIRECT_ONLY` on the same warm instance.
