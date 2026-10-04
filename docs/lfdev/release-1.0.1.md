# Release 1.0.1

Prepared 2026-10-03. **Not published.** Publishing uploads installers to the production R2 bucket and is left to the owner.

## What is in it
See `CHANGELOG.md`. One security change (navigation guard), CI, a packaging guard test, and documentation. No change to note data, the store format or any connector.

## Data and migrations
None. The store file format is unchanged; 1.0.0 profiles open as-is.

## To publish (owner)
1. On the Mac with Cloudflare `wrangler` logged in to the Left Field Investments account: `git pull` on `main`, `npm ci`.
2. `npm run release` (runs the generic tests, builds both installers, uploads to `stickies-releases/v1.0.1/`, rewrites `latest.json`).
3. Before step 2 finishes uploading, or right after the build, confirm nothing private shipped: `npx @electron/asar list dist/mac-arm64/Stickies.app/Contents/Resources/app.asar | grep -c private` prints 0.
4. Open https://stickies.lfiq.app and confirm it lists 1.0.1.

No Worker deploy is needed; `site/src` did not change.

## Rollback
Re-point `latest.json` at the 1.0.0 keys, which stay in R2 under `v1.0.0/`: rerun `SKIP_BUILD=1 npm run release` from a `v1.0.0` checkout with the 1.0.0 installers in `dist/`, or upload the previous manifest with `wrangler r2 object put stickies-releases/latest.json`.

## Monitoring
Worker observability is on (`site/wrangler.jsonc`). The app itself reports ingest errors in the tray menu; there is no remote telemetry.
