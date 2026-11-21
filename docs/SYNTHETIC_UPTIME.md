# Synthetic Uptime Check (D-23 / BN-05)

`scripts/synthetic-uptime.mjs` verifies that the deployed Ledgerflow instance is healthy, accepts a test-user sign-in, and serves the dashboard/workspace API.

## Configuration

Set the following in GitHub Actions (or locally):
- `UPTIME_BASE_URL` (repository variable): e.g. `https://app.ledgerflow.example.com`
- `UPTIME_TEST_EMAIL` (secret): dedicated low-privilege test user email
- `UPTIME_TEST_PASSWORD` (secret): password for the synthetic test user

## Local run

```bash
UPTIME_BASE_URL=http://localhost:3000 UPTIME_TEST_EMAIL=test@example.com UPTIME_TEST_PASSWORD=secret node scripts/synthetic-uptime.mjs
```
