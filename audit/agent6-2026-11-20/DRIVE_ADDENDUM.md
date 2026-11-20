# MASTER RECOVERY INDEX — addendum — Agent #6 — 2026-11-20 (PR #961)

**Paste-ready pointer line for the top of `MASTER_RECOVERY_INDEX.md` (whoever can do a safe full rewrite):**

> Updated 2026-11-20 by **Agent #6** (`arena/b1a560b0-ledgerflow`, from `main` `d1f2c8d`) — **[PR #961](https://github.com/shmuelbiller1/ledgerflow/pull/961)**: CSV formula injection behind whitespace (AF-010-F5), token pages noindex, inline crash reporter removed; **issue [#962](https://github.com/shmuelbiller1/ledgerflow/issues/962)** files the server-lane CSV export defect (`¥ ×100`, `KWD ×10`, unguarded formulas) with a verified patch. Session addendum: `2026-11-20_Agent6_PR961_MASTER_RECOVERY_INDEX_ADDENDUM.md` (this file).

---

## Session identity

| Field | Value |
|---|---|
| Agent | #6 — security lane (S-* queue, SEC-SCAN-1), independent verification |
| Date | 2026-11-20 (UTC) |
| Branch | `arena/b1a560b0-ledgerflow` (base `d1f2c8dda3d8378270117d9c30d8aae3ee0337a6` on `shmuelbiller1/ledgerflow` `main`) |
| Commits | `03254ba` (CSV guard) · `09db8be` (token pages) · `ffc60a9` (crash reporter) · `e2e2e54` (docs/audit) · `b07f48a` (COORDINATION message) |
| PR | **https://github.com/shmuelbiller1/ledgerflow/pull/961** — open, not merged (never merged by an agent) |
| Issue filed | **https://github.com/shmuelbiller1/ledgerflow/issues/962** (server lane, patch attached in the body) |
| Lanes respected | no `src/server/**` money/posting edits, no `supabase/migrations/**`, no tax maths, no RLS. The one server-lane defect is a patch + reproduction + issue |

## What was done

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| AF6-20261120-04 | Low→Medium | `sanitizeCsvCell` guarded only the first character, so a formula behind whitespace (` =1+1`, NBSP, ZWSP, BOM) was exported unguarded from every screen export (CWE-1236; carried as AF-010-F5 "OBSERVED GAP") | **Fixed** — `looksLikeFormula()` shared by writer and inverse; 4-case suite; 85/85 export neighbours |
| AF6-20261120-02 | Medium | `/i/`, `/c/`, `/e/`, `/invite/` token pages were served `index, follow` with `robots.txt Allow: /` — the token is the credential, so a forwarded customer link could be crawled/indexed/cached | **Fixed** — `X-Robots-Tag` in `vercel.json` (edge, first response), the same directive on the page meta before render, `robots.txt` blocking only `/api/`, 6-case guard. Express `serveApp.ts` still needs the header (API lane) |
| AF6-20261120-03 | Medium | `index.html`'s inline reporter POSTed message + raw stack to `/api/health`, which has no `POST` route: 404 per error, nothing recorded, stack left the browser with no consent/redaction/dedupe | **Fixed** — script removed, `APP_INLINE_SCRIPT_HASHES = []`, `vercel.json` CSP regenerated, preflight rule corrected, 3-case guard |
| AF6-20261120-01 | Medium | `GET /api/v1/workspaces/:id/export?format=csv` writes `=`-leading text verbatim (formula injection) and every amount `/100` + `toFixed(2)` regardless of currency (¥ ×100 high, KWD ×10 low) | **Reported → #962**, patch `01-workspace-csv-export-formula-and-currency.patch` (`git apply --check` clean), reproduction script |
| AF6-20261120-05/06 | Info | PWA cache boundary (no authenticated caching) and dependency surface (0 production advisories; 15 moderate dev-only) | **Verified, no defect** |

Prior findings re-checked at `d1f2c8d`: #824, #826, #827 **closed**; **#941–#945 still open** (server/DB lane, not re-run here — no PostgreSQL in the sandbox; CI runs those suites).

## Gates (local, exact)

`tsc --noEmit` exit 0 (needs `--max-old-space-size=3072` here) · ESLint 0 errors / 0 warnings on every changed file · `npm run build` passes (incl. `vercel-csp --check`, PWA, `server.cjs`, `api.cjs`) · `check-dependency-audit` PASS · **78/78** eleven suites for changed code · **108** CSV/export/archive tests · 9/9 structural guards · 18/18 boundary/contract/security set.

**Real CI on PR #961, head `11f2bb4` (all green):** `CI` full matrix (4 unit shards, 3 × Los Angeles, 3 × Auckland, 5 browser shards, Playwright smoke, coverage gate, production build, lint/types/DB rules) · `CodeQL` 0 alerts · `Dependency SBOM evidence` (gitleaks full history + S-25 audit + CycloneDX) · `API schema fuzzing (Schemathesis)` · `SonarCloud` Quality Gate passed · `Gitar` pass.

**Both bot findings fixed and resolved:** Gitar — `robots.txt Disallow` hid the `noindex`, so the four token prefixes now stay fetchable and the header (`vercel.json`) is the primary control (`404cb10`); CodeQL `js/incomplete-sanitization` in the new guard — the `RegExp` built from a prefix is gone, the test matches literal sources (`6c44d26`). SonarCloud's one new issue (`src/lib/csv.ts:90`) — the combined amount regex split in two with a 350,653-input differential test proving the language unchanged (`8bceee4`).

**One thing to know before reading a red X:** three consecutive pushes produced *no* CI at all, because the PR had become `CONFLICTING` with `main` and a `pull_request` workflow runs on the merge commit — no merge, no run, no check suite. Merging `main` (`b26076e`) restored it.

## Files in this Drive session (uploaded with the addendum)

Repo paths that carry the same content (all on the PR branch):

- `audit/agent6-2026-11-20/00-INDEX.md` — how to resume
- `audit/agent6-2026-11-20/01-FINDINGS-REGISTER.md` — the register above, with reproduction and evidence
- `audit/agent6-2026-11-20/02-GATES-AND-EVIDENCE.md` — every command run, and what was not
- `audit/agent6-2026-11-20/03-LAUNCH-READINESS.md` — slice verdict + P0 list
- `audit/agent6-2026-11-20/patches/01-workspace-csv-export-formula-and-currency.patch`
- `audit/agent6-2026-11-20/repro/workspace-csv-export.mjs`
- `docs/verification/ai6-2026-11-20.md`
- `docs/security/OWASP_ASVS_L1_CHECKLIST.md` (§ 2026-11-20 addendum)

## How a replacement agent resumes

1. `git fetch origin && git checkout arena/b1a560b0-ledgerflow` (or read the merged commits on `main` once Shmuel merges #961).
2. Read `02-GATES-AND-EVIDENCE.md` — it lists exactly which gates were run locally and which are CI's.
3. Server-lane work is **not** in this branch by design: `git apply --check audit/agent6-2026-11-20/patches/01-*.patch` for the CSV export fix, and #941–#945 for the rest.
4. The AI #6 queue (`docs/COORDINATION.md` §"AI #6") is otherwise drained: remaining `[~]` items are blocked on server/DB changes (#941–#945), on owner actions (CSP `enforce` needs a clean report week; provider-side rate limits need provider access) or on a human pen-test.

## Honest gaps

- `MASTER_RECOVERY_INDEX.md` itself (117,037 B) was **not** rewritten by this session: a full re-upload requires reproducing every prior agent's history byte-for-byte and the file cannot be read back in one piece here, so a rewrite risked truncating other agents' preserved work. This addendum plus the paste-ready pointer line above stand in its place; no prior content was modified or deleted.
- No database-backed suite, browser shard or external scanner ran in this sandbox (no PostgreSQL, no browser install budget, artifact hosts unreachable). Nothing in this file claims CI is green.
