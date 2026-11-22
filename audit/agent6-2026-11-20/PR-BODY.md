# AI #6 — security lane, 20 Nov: exported formulas, crawlable token links, a crash reporter that reported nowhere

Security lane only. No money, posting, tax maths, RLS or migration changes; the one confirmed
server-lane defect is delivered as a verified patch + reproduction + issue instead of an edit.

Full register: `audit/agent6-2026-11-20/01-FINDINGS-REGISTER.md` · Gates: `02-GATES-AND-EVIDENCE.md` ·
Slice verdict: `03-LAUNCH-READINESS.md`

---

## Fixed on this branch (3 commits, one per finding)

### AF6-20261120-04 — CSV formula injection behind whitespace (`src/lib/csv.ts`)
`sanitizeCsvCell` decided on the very first character, so `=1+1` was neutralised but ` =1+1` — and the
same formula behind a non-breaking space, a zero-width space or a BOM — went out **unguarded** from every
screen export. Spreadsheets skip that whitespace before deciding a cell is a formula (CWE-1236). The repo
already recorded this as AF-010-F5 (`OBSERVED GAP`, P3). One `looksLikeFormula()` now answers the question
for the writer and for `unguardCsvCell`, so export → import round-trips unchanged (legacy files included)
and a plain number such as ` -1,000.00` stays a number.

### AF6-20261120-02 — a token in the path is a credential, and the site invited crawlers
`/i/<token>`, `/c/<token>`, `/e/<token>`, `/invite/<token>` open with no sign-in and are all served the
same `index.html`, which said `index, follow, max-image-preview:large`, with `robots.txt` at `Allow: /`.
A customer who forwards their invoice link into a public place hands a search engine the document's text,
amounts and payment token.

Three directives, one message, none hiding another:
- `vercel.json` sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` on
  `/i/(.*)`, `/c/(.*)`, `/e/(.*)`, `/invite/(.*)` — edge, first response, before any script runs.
- `src/lib/privacyRobots.ts` (+ `src/main.tsx`) sets the same directive on the page meta before the first
  render, which covers a client-side navigation into a token page.
- `public/robots.txt` blocks **only** `/api/`. The token prefixes are deliberately left fetchable: a
  crawler that may not fetch a page never reads its `noindex`, and a blocked URL can still be listed when
  something links to it — which is the leak this finding is about. (Corrected after Gitar's review of the
  first version, which did both.)

A guard fails if `App.tsx` routes a new prefix the rule does not cover, if `robots.txt` disallows a token
prefix again, or if the header stops granting `noindex`; 6 tests.
**Still open (API lane):** the same header in front of those paths when the SPA is served by Express
(`serveApp.ts`) rather than Vercel's edge.

### AF6-20261120-03 — the inline crash reporter reported to a route that does not exist
`index.html` POSTed the message and raw stack to `/api/health` on every error. That route has only ever
been a `GET`: every error produced a 404 and no record, while the stack — which routinely names a
customer, an invoice number or a document path — still left the browser, with no consent check, no
redaction and no de-duplication, unlike `errorTracker` (the S-35 decision). The inline script is removed,
`APP_INLINE_SCRIPT_HASHES` is `[]` with the reason in the code, `vercel.json`'s Report-Only CSP no longer
names a hash that matches nothing, and the production preflight rule now requires the Report-Only
`script-src` to drop `'unsafe-inline'` (a hash is required only when the page actually ships an inline
script — otherwise the preflight would fail a policy that is *stricter* than before).

## Reported for AI #1 (server/money lane, patch ready)

**AF6-20261120-01 (Medium)** — `GET /api/v1/workspaces/:id/export?format=csv` builds the CSV by hand:
a `=`-leading description/category/reference reaches Excel as a live formula, and every amount is written
`/100` + `toFixed(2)` whatever the currency, so ¥1,000,000 becomes `10000.00` (100× high) and KWD 12.345
becomes `123.45` (10× low).
- Patch: `audit/agent6-2026-11-20/patches/01-workspace-csv-export-formula-and-currency.patch` —
  `git apply --check` clean at `d1f2c8d`, `tsc --noEmit` clean with it applied (verified, then reverted).
- Reproduction: `npx tsx audit/agent6-2026-11-20/repro/workspace-csv-export.mjs` (bytes before/after).

## Checks run (the full suite and the browser shards are CI's, per the owner's 18 Nov rule)

| Check | Result |
|-------|--------|
| `tsc --noEmit` (`--max-old-space-size=3072`; plain tsc OOMs in a 3.8 GB sandbox) | exit 0 |
| ESLint on every changed file | 0 errors / 0 warnings |
| `npm run build` (incl. `vercel-csp --check`, Vite, PWA, `server.cjs`, `api.cjs`) | passes |
| `npx tsx scripts/vercel-csp.ts` | exit 0 |
| `npx tsx scripts/check-dependency-audit.ts` (S-25) | PASS — 0 production advisories |
| Suites for the changed code (11 suites) | **78/78** |
| Export/archive neighbours (14 suites) | **85/85** |
| Structural guards (reachability, layers, vercel boundary) | 9/9 |
| Boundary/contract/security sweep set | 18/18 |

Not run locally: the whole `npm test`, the six TZ shards, RLS and every database-backed security suite
(no PostgreSQL in this sandbox), Playwright shards, ZAP/Schemathesis — those are CI's, and CI is green on
this branch's head `b26076e`:

| GitHub check | Result |
|---|---|
| `CI` — full matrix (4 unit shards, 3 × Los Angeles, 3 × Auckland, 5 browser shards, Playwright smoke, coverage gate, production build, lint/types/DB rules) | **success** |
| `CodeQL security scanning` | **success, 0 alerts** (this PR's own alert, `js/incomplete-sanitization`, fixed) |
| `Dependency SBOM evidence` — gitleaks full history + S-25 audit + CycloneDX | **success** |
| `API schema fuzzing (Schemathesis)` (report-only) | **success** |
| `SonarCloud Code Analysis` | Quality Gate passed; the one new issue addressed |
| `Gitar` | pass; its finding fixed and the thread resolved |

Two notes for the reviewer, so a red or missing check is not misread: (1) pushes to this branch produced
no CI runs while the PR was `CONFLICTING` with `main` — a `pull_request` workflow runs on the merge
commit, and GitHub creates no run when the merge is impossible; the merge in `b26076e` fixed that and all
four workflows started on their own. (2) The only local test failures were two fixed-budget performance
assertions (`InboxView` 1,188 ms against a 1,000 ms budget) measured with 1,865 tests sharing a 3.8 GB
sandbox — the same class as open issues #833/#834; that shard is green on CI here and was red on `main`
at `e90de82`. The budgets were not touched.

## Test-contract changes, stated openly

- `audit-af010b-csv-dates.test.ts` recorded the AF-010-F5 gap as an `OBSERVED GAP`; it now asserts the
  fixed behaviour, naming the fix and its evidence. That is the defect the assertion was recording.
- `csp-report-only.test.ts` required `APP_INLINE_SCRIPT_HASHES[0]` to be allowed by the enforced policy;
  with no inline scripts that is `undefined`. It now asserts the property for every hash the page has
  (including none), preserving the intent.

## Still open in this lane

`#941`–`#945` (server/DB, filed 19 Nov) remain open; the rest of the AI #6 queue is blocked on those, on
owner actions (CSP `enforce` needs a clean report week; provider-side rate limits need provider access),
or on a human pen-test. Slice verdict: **CONDITIONALLY READY** for invited testers on synthetic data,
**NOT READY** for real customer money until the P0 list in `03-LAUNCH-READINESS.md` closes.
