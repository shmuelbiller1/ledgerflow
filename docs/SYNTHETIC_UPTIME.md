# Synthetic Uptime Check (D-23 / BN-05)

`scripts/synthetic-uptime.mjs` verifies that the deployed Ledgerflow instance is healthy, accepts a test-user sign-in, and serves the dashboard/workspace API.

## Configuration

Set the following in GitHub Actions (or locally):
- `UPTIME_BASE_URL` (repository variable): e.g. `https://app.ledgerflow.example.com`
- `UPTIME_TEST_EMAIL` (secret): dedicated low-privilege test user email
- `UPTIME_TEST_PASSWORD` (secret): password for the synthetic test user
- `UPTIME_SUPABASE_URL` (variable): the project's Supabase URL, used to sign in (password grant)
- `UPTIME_SUPABASE_ANON_KEY` (variable): the project's public anon key, sent as `apikey` on the sign-in call

Without the test user the run checks `GET /api/health` only. With it, the run also calls `GET /api/v1/workspaces`
with the Supabase access token as a Bearer header.

## Local run

```bash
UPTIME_BASE_URL=http://localhost:3000 UPTIME_TEST_EMAIL=test@example.com UPTIME_TEST_PASSWORD=secret UPTIME_SUPABASE_URL=https://<project>.supabase.co UPTIME_SUPABASE_ANON_KEY=<anon key> node scripts/synthetic-uptime.mjs
```
