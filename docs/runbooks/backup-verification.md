# Backup & PITR verification (S-19)

How LedgerFlow verifies daily that Supabase database backups (or Point-in-Time Recovery) exist and are fresh, and what to do if the check fails.

## What runs automatically

- **Script:** `scripts/verify-backups.ts` (unit-tested in `src/tests/security-s19-backup-verification.test.ts`).
- **Schedule:** `.github/workflows/backup-verify.yml` runs daily at `04:23 UTC` and on manual dispatch.
- **Check:** Queries Supabase Management API `GET /v1/projects/{ref}/database/backups`, confirms at least one `COMPLETED` backup (or active PITR physical recovery anchor when `pitr_enabled: true`) is no older than `MAX_BACKUP_AGE_HOURS` (default `26` hours).
- **Failure behaviour:** Fails closed (`exit 1`) on HTTP errors, disabled backups/PITR (`REQUIRE_PITR=true`), or stale backup timestamps, and optionally POSTs a redacted JSON alert to `BACKUP_ALERT_WEBHOOK_URL` (HTTPS required).

## Owner setup (once)

1. In Supabase Dashboard → **Account → Access Tokens**, create a read-only / backups-scoped Personal Access Token (`sbp_...`).
2. In GitHub → **Repository Settings → Secrets and variables → Actions**:
   - Add secret `SUPABASE_ACCESS_TOKEN` = the PAT.
   - Optionally add secret `BACKUP_ALERT_WEBHOOK_URL` = your Slack/PagerDuty/ops HTTPS webhook.
   - Optionally add variable `REQUIRE_PITR` = `true` (recommended on Pro+ with PITR enabled) and `MAX_BACKUP_AGE_HOURS` = `26`.
3. Trigger **Actions → Backup verification (S-19) → Run workflow** once to verify a green run.

## Manual run from a terminal

```bash
SUPABASE_ACCESS_TOKEN="sbp_..." SUPABASE_PROJECT_REF="sbxxbbscuwmlkvcvkbxi" npx tsx scripts/verify-backups.ts
```

## If the check fails

1. Open Supabase Dashboard → **Project → Database → Backups** and inspect whether the scheduled backup or WAL archive failed or is still in progress.
2. Do **not** run destructive migrations or bulk cleanups until a fresh manual backup or PITR check succeeds.
3. For a non-destructive local restore check against a disposable test database, run:
   ```bash
   LF_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/lf_test" node scripts/restore-drill.mjs
   ```
4. If the outage persists, open a Supabase support ticket and follow [database-down.md](database-down.md) / [incident.md](incident.md).
