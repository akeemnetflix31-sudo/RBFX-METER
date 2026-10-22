# RBFX Meter — ephemeral feed and fallback status

## Local source status

Source and tests are updated in this workspace. **No Vercel Production deployment was made.** The Vercel CLI is logged out and no production deployment has been created from this version.

## Prepared behavior

- `/api/market` and `/api/mt5-feed` rewrite to `/api/feed`, so GET market reads and POST EA ingest use the same handler module.
- Tier 1: validated EA payload stays in an in-memory RAM slot for a maximum of 60 seconds. No Blob or durable writes. This remains best-effort because Vercel memory is per warm instance and not shared across instances or cold starts.
- Tier 2: Biquote free public M1/M15 OHLC. All supported instruments are labelled as public reference, not broker-authenticated.
- Tier 3: one built-in baseline candle per symbol captured 2026-10-22. The response is marked stale/static and cannot create an active setup.
- Access-format checks no longer write analytics. The optional owner-statistics route remains read-only for historical aggregates.
- Existing A+ M15 rules, stale-data rejection, 2-hour expiry, invalidation and no-chase controls are unchanged.
- Separate ICTMACROVIP project and `https://ictmacrovip.com/api/feed` are untouched.

## Verification required before Production

Run `npm test`, `npm run check`, and `npm run build`; test POST then GET through the rewritten `/api/feed`; verify Tier 2 and Tier 3 responses; then confirm the resulting deployment and all route statuses. A static fallback only prevents a blank valid-symbol market response—it cannot guarantee every endpoint or invalid request is error-free.

## Deployment blocker

The last CLI attempt (`npx vercel --prod`) stopped before upload because the workspace has no Vercel credentials. No temporary deployment or production change was made. Vercel RAM mode is not live until an authorized deployment is possible.
