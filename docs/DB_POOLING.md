# Database connection pool: notes and limits (F-33)

**Where the pool is.** `src/server/db/pgFirestore.ts` creates one `pg` pool for the process
from `DATABASE_URL`. Routes do not create their own clients; the browser never opens a
connection.

**What the pool is sized for**

| Setting | Value | Why |
|---|---|---|
| `max` | `PG_POOL_MAX` or 10 (`src/server/db/pgFirestore.ts`) | One server process; each request holds a client only for the length of a query |
| `idleTimeoutMillis` | `pg` default (10 s) | A quiet workspace should not hold connections open |
| `connectionTimeoutMillis` | 15 s | A request that cannot get a client fails instead of hanging |
| statement timeout | not set globally | Long reports read in pages; a per-query timeout is a server-lane change |

**The hard limit.** Supabase's connection limit depends on the plan and is shared by every
server instance, the migration job and any `psql` session. With two server instances at
`max: 10` the database sees 20 connections before anything else connects. If the deploy
scales past two instances, use the pooler (`:6543`, transaction mode) and keep `max` small
(2–5) rather than raising it.

**What to watch**

- `pg_stat_activity` for `idle in transaction` — a leaked client blocks others;
- the server log lines around a request that waited for a client (`connectionTimeoutMillis`)
  — raise the plan's connection limit before raising `max`;
- a report that takes seconds while holding a client: it delays everyone else, which is why
  reports are read in pages.

**What is not done here.** Queue/worker connections (F-24), a second pool for migrations,
and per-tenant limits are not implemented. Migrations run in their own process and close
their client when they finish (`scripts/db-test.ts`).
