# RBFX Meter — RoboForex Client Portal (Vercel)

English / Bahasa Melayu Malaysia portal served as a Vercel static build with Vercel Node.js Functions. The market endpoint accepts only the read-only MT5 feed; the MT5 ingestion endpoint remains public and tokenless. Latest feed snapshots and anonymous daily format-check aggregates are stored in a **private Vercel Blob store**.

## API routes

- `POST /api/access` — checks for exactly eight numeric digits only. This is a syntax filter, not RoboForex account verification, authentication, membership validation, or proof of ownership.
- `GET /api/market?asset=XAUUSD` — reads only the stored MT5 feed for the requested supported asset. Returns HTTP 503 when validated MT5 data is unavailable; there is no public market-price fallback. Returns H1/M15/M5/M1 indicators, OHLC, meter score, and reference levels.
- `POST /api/mt5-feed` — public tokenless MT5 ingestion route. Validates payload size, symbol IDs, timestamps, and OHLC shape before writing the newest snapshot to private Vercel Blob storage. Anyone can still submit valid-shaped data and overwrite the feed; the payload is not cryptographically authenticated.
- `GET /api/news` — high/medium-impact calendar events with visible FinanceCalendar attribution; tries a secondary public calendar source if the primary source is unavailable.
- `GET /api/owner-stats` — optional owner dashboard API; requires `Authorization: Bearer <OWNER_STATS_PASSWORD>`, where the production secret must be at least 32 characters.

## Vercel deployment requirements

1. Import this project into Vercel and set the project root to this folder. `vercel.json` runs `npm run build`, publishes `public/`, applies security headers, and routes the owner page.
2. Attach a **private Vercel Blob store** to the project for Production (and Preview/Development if needed). Vercel's Blob SDK uses the connected store's OIDC environment automatically. Without the store connection, MT5 writes and market reads return unavailable errors.
3. Set `OWNER_STATS_PASSWORD` to a unique secret of at least 32 characters only if the owner-stats feature is used. Do not place it in browser files, source control, or the deployment package.
4. Build and test with `npm install`, `npm run build`, `npm test`, and `npm run check`.
5. After obtaining the final Vercel domain, update the MT5 EA endpoint and allow that origin in MT5 WebRequest settings. The project includes a `YOUR-VERCEL-PROJECT.vercel.app` placeholder until the final domain is known.
6. The new private Blob store starts empty. The MT5 EA must post a new payload to `/api/mt5-feed` before the market API can return current data. Existing provider-stored feed snapshots and owner secrets are not included in this source package.

## MT5 feed

The included `mt5/RBFXMeter_ReadOnlyFeed.mq5` is read-only: it sends closed M1/M5/M15/H1 bars and quotes, without trade execution functions. It synchronizes history and posts every 60 seconds. Incomplete M5/H1 series can be resampled from complete lower-timeframe groups. The feed is still public and unauthenticated; validation protects shape and timestamp integrity, not source authenticity. Treat the displayed prices as MT5-originated only after independently checking the running EA and matching terminal.

See [`MT5-FEED-SETUP.md`](MT5-FEED-SETUP.md) for the installation and verification steps. The site does not log in to a broker, look up account ownership, or place trades.

## Data and analytics

A submitted eight-digit value is not retained. If the format check passes, the application attempts to increment an anonymous daily aggregate; it stores date-level counts only, not account numbers, IP addresses, or stable visitor IDs. Vercel Blob does not provide atomic conditional object writes, so concurrent analytics increments are best-effort and may undercount during simultaneous updates. This does not affect access-format responses, MT5 feed validation, or market calculations. Owner statistics are at `/owner-stats` and are not linked from the portal.

## Build and test

```sh
npm install
npm run build
npm test
npm run check
```

The app bundles Lightweight Charts locally; browser assets and API calls are same-origin. The chart displays timeframe-matched MT5 OHLC and indicators, with no runtime chart CDN. News remains the only API route that fetches external calendar providers. Review [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and the included Lightweight Charts license notice.

## Limitations

The meter is for research and education only, not investment advice or a result guarantee. MT5 connection and feed freshness are not guaranteed. `/api/mt5-feed` is publicly writable and cannot prove that a valid-shaped payload came from RoboForex. The format check does not confirm that an account exists or belongs to a visitor. No order is sent or managed by this portal.
