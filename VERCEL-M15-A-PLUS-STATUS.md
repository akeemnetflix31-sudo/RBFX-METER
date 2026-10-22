# RBFX Meter — ephemeral feed and fallback status

## Local source status

Source and tests are updated in this workspace. **No Vercel Production deployment was made.** Vercel account/deployment metadata is reachable, but this workspace is not a Git checkout and the available Vercel connector cannot transfer the local working tree as a build source. The only linked Git source is `akeemnetflix31-sudo/RBFX-METER` on `main`, which does not contain these local changes; deploying that branch would publish the wrong version, so it was not done.

## Prepared behavior

- `/api/market` rewrites to `/api/feed?mode=market`; `/api/mt5-feed` rewrites to `/api/feed?mode=feed`. GET status and POST ingest use the same handler module; GET market reads use that module as well.
- Tier 1: validated EA payload stays in an in-memory RAM slot for a maximum of 120 seconds. A payload within that age window overrides Biquote for its available instruments, including when its quote/candles remain marked stale. No Blob or durable writes. This remains best-effort because Vercel memory is per warm instance and not shared across instances or cold starts.
- Tier 2: Biquote free public M1/M15 OHLC. All supported instruments are labelled as public reference, not broker-authenticated.
- Tier 3: one built-in baseline candle per symbol captured 2026-10-22. The response is marked stale/static and cannot create an active setup.
- Access-format checks no longer write analytics. The optional owner-statistics route remains read-only for historical aggregates.
- Existing A+ M15 rules, stale-data rejection, 2-hour expiry, invalidation and no-chase controls are unchanged.
- Separate ICTMACROVIP project and `https://ictmacrovip.com/api/feed` are untouched.

## Verification required before Production

Run `npm test`, `npm run check`, and `npm run build`; test POST then GET status/market through the rewritten `/api/feed`; verify Tier 2 and Tier 3 responses; then confirm the resulting deployment and all route statuses. A static fallback only prevents a blank valid-symbol market response—it cannot guarantee every endpoint or invalid request is error-free.

## Deployment blocker

The CLI is unauthenticated. A linked-Git redeploy would use the older remote `main` source, so it was deliberately not triggered. The local implementation is tested but remains unapplied to Production until these exact changes can be transferred to the linked repository or uploaded as a deployment.
