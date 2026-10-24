# Production Cloudflare app

The live expense tracker is https://expense.yingchao.dev/ (with a legacy `/expense` route on `app.yingchao.dev`).

- Backend: `worker/src/index.js`, recovered from the deployed JavaScript bundle on 2026-10-19. This is the canonical production backend until its original TypeScript source can be recovered; module comments identify the original source boundaries.
- Frontend: `server/web/src/`, built to `server/web/dist/`.
- Database: the existing D1 database bound as `DB`. Deployment never imports data or runs migrations.
- `server/internal/` remains the legacy Go server/CLI. Editing it does **not** change the live backend.

## Feedback to release

1. The authenticated feedback API uploads screenshots under `.feedback/images/`, then creates a `feedback`-labeled issue in this repo using the Worker's `GITHUB_TOKEN` secret. Requests include GitHub's required User-Agent.
2. `resolve-issue.yml` automatically handles issues opened/reopened by `baggiiiie`; manual dispatch is also supported. A separate preflight job checks for the deploy credential before allowing any fix/issue closure.
3. The resolver triages, implements, independently verifies, and pushes a single fix commit to `master`. Failed verification leaves the issue open. A closed issue means the code landed, **not** that deployment succeeded.
4. Only when a fix was applied, a separate job calls `deploy-worker.yml`. This explicit call is necessary because commits pushed using Actions' `GITHUB_TOKEN` do not trigger push workflows. The old Docker image workflow is now manual-only and is no longer the resolver's release path.
5. Deployment builds the latest `master` web assets, tests and dry-runs the Worker, then publishes both with Wrangler. It verifies the live build SHA, a JavaScript asset, and authentication. Check the Actions deployment job to confirm a fix is live.

Direct pushes affecting the Worker/web/build configuration also trigger deployment. Releases are serialized. Existing Worker secrets are retained; routes and D1 identity are pinned in `wrangler.jsonc`.

The deployment credential is available only to the separate deployment job, never the coding agent. `checkoutEnv` also explicitly excludes all non-allowlisted environment variables.

## Required GitHub secret (one-time)

Add repository secret **`CLOUDFLARE_API_TOKEN`** through GitHub Settings → Secrets and variables → Actions. Create a Cloudflare API token scoped to the account/zone in `wrangler.jsonc` with:

- Account → Workers Scripts → Edit (may be displayed as Workers → Edit)
- Account → Account Settings → Read
- Zone → Workers Routes → Edit
- Zone → Zone → Read

Restrict account resources to the account containing this Worker, and zone resources to `yingchao.dev`. No DNS-write, D1-data-write, or token-administration permission is needed for this deployment. Do not store a broad OAuth refresh token or account-wide administrator token in GitHub.

The Worker already has runtime secrets `EXPENSE_SYNC_SECRET`, `GITHUB_TOKEN`, `LOGIN_USERNAME`, and `LOGIN_PASSWORD`; these stay in Cloudflare and must not be copied into GitHub or committed.

After adding the deploy secret, run **Deploy Worker** manually in Actions. Confirm its smoke check passes. The local Cloudflare OAuth session cannot create this API token.

## Local checks / deployment

```sh
npm ci
npm run verify  # requires pnpm 9 and Go as well as Node 24+
# Full production deployment, only when authorized:
npm run deploy:worker -- --var BUILD_SHA:$(git rev-parse HEAD)
node scripts/smoke-worker.mjs --sha "$(git rev-parse HEAD)"
```

Build the frontend (`npm run verify:web`) before deploying. Wrangler uses its existing local login or `CLOUDFLARE_API_TOKEN`. The app can also be tested locally with `npx wrangler dev --config worker/wrangler.jsonc`; never use production D1 for local tests. Changes to the D1 schema require an explicit reviewed migration plan, not legacy Go goose migrations.

## Wallet suggestion expiry

Settings → Preferences → **Wallet suggestion expiry (days)** controls how long pending
suggestions remain available. The default is 7; only positive whole numbers are accepted.
Age is measured from `captured_at` in elapsed 24-hour days. At the cutoff, pending
suggestions become `dismissed`, not deleted. Accepted suggestions and their expenses
are untouched. Dismissals advance the existing sync cursor so iOS receives them on its
next sync. Expiry runs hourly and before wallet/sync requests; shortening the setting
also expires eligible suggestions immediately. Increasing it does not restore dismissed
suggestions. The setting is managed in the web app, not the native iOS Settings screen.

### First release migration (requires production-write approval)

Apply `worker/migrations/0001_wallet_suggestion_expiry.sql` **before** deploying this
Worker version or pushing it to `master` (which triggers deployment). The existing
deploy workflow intentionally does not apply database migrations.

1. Inspect `PRAGMA table_info(app_preferences)` and confirm the expiry column is absent.
   Export a D1 backup to private storage before changing the schema.
2. With an authorized D1-write credential, run:

   ```sh
   npx wrangler d1 migrations apply expense-tracking --config worker/wrangler.jsonc --remote
   ```

3. Confirm the column exists and existing preferences have `wallet_suggestion_expiry_days = 7`.
   The migration adds only a defaulted column; it does not change suggestion statuses.
4. Deploy the Worker and assets through the existing release path. Check the live
   `/api/health`, Settings default/save, and the hourly Cron Trigger.

The migration is covered by the Worker tests and can be exercised against a local D1
copy with the same command using `--local` instead of `--remote`. Do not apply legacy
Go migrations to production D1. Rolling back the Worker can leave the additive column
in place; automatic dismissals already performed are retained and must not be blindly
reversed, since they share the existing manual-dismissal status.
