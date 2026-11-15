# Security sweep

`src/tests/security-sweep.test.ts` checks the whole surface of the product the way an attacker would
try it. It is part of the unit suite, so it runs on every pull request, and takes a few seconds.

It keeps no hand-written list of routes or tables. It starts the real app, finds every registered
route (313 when this was written) and every table in the database (68), and tries each one.

## What it checks

**Every server route, as six kinds of caller**

| Caller | What must happen |
|---|---|
| No sign-in | Refused, unless the route is approved as public |
| A forged token (wrong signing key) | Never accepted |
| An expired token | Never accepted |
| An unsigned token (`alg: none`) | Never accepted |
| A signed-in stranger who belongs to no workspace | Refused, unless the route is about their own account |
| A viewer of the workspace | Every write refused |

No answer to any of them may contain a stack trace, a file path from the code, or database error text.

**Every table, as four kinds of browser session** (signed out, stranger, viewer, bookkeeper): can it
read another business's row, insert, update or delete? A signed-out browser must be able to do
nothing anywhere, and a stranger must never read, change or delete another business's row.

**Three general protections:** a flood of requests from one address is slowed with a 429; answers
carry `x-content-type-options: nosniff` and do not announce the server software; another website is
not allowed to read answers.

**Two controls on the test itself**, so it cannot pass by accident: a real member's token must be
accepted by at least one route, and that member must still have access when the sweep ends.

## The approved list

`security-baseline.json` records what is open today: the public routes, the routes a stranger may
call about their own account, the writes a viewer may make, the routes that answer a server error,
and for each table what each kind of session can do (`r` read, `i` insert, `u` update, `d` delete).

The test fails when anything is **more open** than this file. So a new public route, a route a
viewer can now write through, or a table a browser can now write, cannot arrive unnoticed.

If the change is intended:

```bash
npm run security:baseline
```

Commit the changed `security-baseline.json` in the same pull request. The diff of that file is what
a reviewer reads: every line added to it is something that became more open.

To run only the sweep:

```bash
LF_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lf_test npm run test:security
```

## What it found when first run (15 Nov 2026)

None of the "never allowed" checks failed. Recorded in the baseline, and worth fixing:

- **24 routes answer HTTP 500 when they refuse someone.** The refusal is correct ("not a member",
  "read-only"), but it is reported as a server crash, not as 403. Examples: `GET /api/reports/*`,
  `GET /api/v1/ledger`, `GET /api/v1/metrics`, `POST /api/v1/brain/classify`. This hides real crashes
  in monitoring and tells a caller nothing useful. Each fix removes a line from `serverErrors`.
- **A viewer can add rows to `documents` and change any support ticket of the workspace** directly
  in the database. Low risk, but a read-only role should not write.
- **Bookkeepers can still insert, update and delete in 22 tables directly** (customers, vendors,
  items, invoices, bills, rules…). That is today's design; the central-commands work closes it, and
  this file will show each table closing.

## What it cannot tell you

This is a regression guard, not a penetration test. It does not cover:

- the live site's settings: secrets, deployment protection, the database's TLS certificate, DNS;
- whether a route that correctly admits a member then returns more than it should;
- business-logic abuse by a legitimate writer (for example a wrong but balanced entry);
- the browser side: cross-site scripting in rendered content, the content security policy in effect;
- file uploads, email, payment and bank integrations in real use;
- denial of service beyond the basic rate limit.

CodeQL, the dependency audit, `supabase/tests/rls.test.sql` and the route-policy test cover other
parts. Before real customers' data, have a person run a penetration test against the deployed site.
