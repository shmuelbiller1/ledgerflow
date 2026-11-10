# Agent #6 — gates actually executed at the pin, 2026-11-10

Pin: upstream `main` `dc40739708a013ad080ffb306fe461554a2391fc`.
Machine: Node v22.22.3, 2 vCPU, 3.9 GB RAM, no Postgres server installed, no
`LF_TEST_DATABASE_URL`. **Every DB-gated suite therefore skips** — that is a stated limitation of
this run, not a pass.

| Gate | Command (as run) | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | see table below |
| Unit suite, shard 1/4 | `TEST_SHARD=1/4 tsx --test --test-force-exit src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts` | see below |
| AF audit suites | `tsx --test src/tests/audit-af001… af002… af010…` | **20/20 pass** |
| Agent #6 probes | `tsx --test audit/agent6-2026-11-10/probes/*.test.ts` | **8/8 pass** |
| ESLint | `npx eslint . --max-warnings <cap>` | see below |
| DB rules / migrations | `npm run test:rules` | **not run** — no Postgres in sandbox |
| Browser (Playwright) | `npm run test:e2e` | **not run** — no browser binary / app server here |
| Production build | `npm run build` | see below |

Results are filled in as each long gate finishes; an empty cell means it had not finished when the
session's last checkpoint was written.
