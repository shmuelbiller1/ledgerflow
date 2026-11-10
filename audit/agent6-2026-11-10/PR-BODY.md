## Agent #6 — independent audit, 10 Nov 2026 (review-only)

Audited at **upstream `main` = `dc40739708a013ad080ffb306fe461554a2391fc`** (10 Nov 03:07Z). No money,
posting, tax-maths or `src/server/**` file is changed in this branch: it adds an audit folder plus
**six** runnable probes (20 assertions) that *document* defects for the owning lane.

### Two things the owner needs to know first

1. **This repo's `audit/FINAL_ACCURATE_LIST_2026-11-08.md` is committed with conflict markers**
   (`<<<<<<< HEAD` at line 1, `>>>>>>> …` at line 194) — two agents' lists were merged and the file
   was committed unresolved. It is the document other agents are told to trust.
2. **The Arena checkout this session started from is a stale reconstruction**, not any commit in
   upstream history: a scripted "keep local file, else take the earlier upstream version" rule
   reproduces it exactly at upstream `4376cab4` (9 Nov 05:43Z), ~214 commits behind `main`, with
   no merge base. Everything below was therefore verified against a clean `git archive` of
   `dc40739`, never against that checkout.

### Findings (full detail in `audit/agent6-2026-11-10/02-findings.md`)

| ID | Severity | Finding | Lane |
|---|---|---|---|
| **F-01** | **P1** | `usSalesTaxReturn` reads `TaxPlace.state`; the seeded sample book and `invoice-destination.test.tsx` write `TaxPlace.region`. A Texas taxable sale is **silently dropped** from the TX return (probe: 0 documents, 0.00 due, while the invoices show 6.25 %). | AI #1 |
| **F-08** | **P1** | "Recorded as filed" on the US quarter screen marks **every** state filed when *any* return covers those dates (registration dropped at `UsQuarterJourneyReportView.tsx:64-80`), and the server can only ever file `kind: 'vat'` (`taxReturnService.ts:43-48`), computing VAT boxes the quarter screen never reads. Two tax-return universes. | AI #1 |
| **F-09** | **P1** | The audit trail does not cover the books: **23 of the 33** route handlers that persist in their own body write no audit entry (incl. `POST /capitalize`, `/recognize`, `/cogs`, `/api/v1/ledger`, API-key issue/revoke). "Last sign-in" on Access review comes from a **browser** `void addDoc` of `USER_LOGIN` the server never writes; the server's own `loginAudits` record has **no reader and no RLS policy**. `auditLogs` is correctly insert-only. | AI #1 + RLS lane |
| **F-03b** | **P1 latent** | #161/AF-012 reproduced against the shipped `evaluateRules`: a chain A>B>C applies `A,C` in one order and `A` in another; a cycle is resolved by array order. 0 chains in the 18 shipped packs today. | AI #1 |
| F-02 | P2 | Two `/api/v1/system/*` routes have **no middleware** (in-handler `isSystemJobAuthorized` only) and `/api/v1/admin/integrity/orphan-scan` is `authenticate`-only; `route-policy-coverage.test.ts` passes because it greps file text. | AI #1 + Agent #6 for the test |
| F-03 | P2 | **47 of 68** `lf_rules` collections still have no JSONB field allowlist and no cap, including `idempotencyKeys`, `billingLedgerTraces`, `periodClosings`, `taxReturns`, `recoveryCodes`. | AI #1 (schema) |
| F-01b | P2 | The sample book (`sampleBusinessYear.ts:142,214`) writes `place.region`, the return reads `place.state`, and **no test joins the two** — which is why F-01 is invisible to 8,026 green tests. Acceptance test for the fix: sample book → `usSalesTaxReturn` → non-zero taxable. | Agent #6 (test) |
| F-10 | P2 | Three money routes (`/inventory/cogs`, `/leases/capitalize`, `/revenue/recognize`) keep handwritten idempotency records: no `status`, no request hash, a hit always replays as success; a failure after the body is built leaves no record. | AI #1 |
| F-07 | P2/P3 | AF-001-F1..F3 verified fixed (AF suites re-run 20/20); AF-001-F4 (`success:false` on a zero-change sync) still open and now pinned as the "observed contract" by a test. | AI #1 |
| F-04/F-05/F-06 | P3 | `check-prod-env` wired to nothing; `authRateLimiter` is dead code (S-22's AI half is already covered); no gitleaks, no audit hash chain. | Agent #6 |

### Probes (all pass = all defects confirmed)

```sh
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test \
  audit/agent6-2026-11-10/probes/af004-taxplace-key-mismatch.test.ts \
  audit/agent6-2026-11-10/probes/af012-rule-chain-order.test.ts \
  audit/agent6-2026-11-10/probes/f8-tax-return-two-universes.test.ts \
  audit/agent6-2026-11-10/probes/s7-route-guards.test.ts
python3 audit/agent6-2026-11-10/probes/lf-rules-coverage.py
```

### Gates actually run at the pin (Node 22, 2 vCPU, no Postgres)

* `tsc --noEmit` — **exit 0**, no output, 2,513 files.
* **All four unit shards: 8,026 tests · 8,007 pass · 10 failing subtests · all environmental**
  (5 millisecond performance budgets on 2 vCPU, 4 a missing `SYSTEM_SALT` in a bare-`tsx` command
  that `npm run test:shard` sets, 1 `vercel-ignore-boundary` shelling out to `git ls-files` in a
  `git archive` copy with no `.git`). **Zero product failures.** Details in `03-gates.md`.
* Repo ESLint: **0 errors**, 42 `no-explicit-any` warnings (the standing ratchet cap).
* Targeted suites: AF **20/20**, IL/EU/CA/US tax **45/45**, US return/quarter/golden **31**, close +
  reconcile **24/24**; the **six probes 20/20**.
* **Not run:** DB/RLS suites (203 skipped, `LF_TEST_DATABASE_URL` unset), Playwright, `npm run build`.
  Nothing is claimed for them.

### What I did not do

No merges, no issue closures, no financial edits. Corrections to any earlier audit document are
stated as dated addenda rather than silent rewrites.
