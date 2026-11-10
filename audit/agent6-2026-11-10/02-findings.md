# Agent #6 (Arena) — security-lane + AF audit findings — 2026-11-10

**Pin:** upstream `main` = `dc40739708a013ad080ffb306fe461554a2391fc` (2026-11-10 03:07Z).
**Method:** every claim below is either (a) a test I ran at the pin in this sandbox, (b) a source
read at exact lines at the pin, or (c) explicitly marked as carried forward from another agent's
evidence. Nothing is inferred from a document that claims it.

Environment: Node v22.22.3, 2 vCPU / 3.9 GB, no Postgres server (so every DB-gated suite skips —
`LF_TEST_DATABASE_URL` unset). Full unit shard 1/4 running as this is written.

---

## A. Verified at the pin, with a run behind it

### F-01 (P1, tax reporting) — the US state return drops every sale whose place carries `region` instead of `state`, and the product's own seeded book writes `region`

Reproduction (executed, 4/4 assertions pass):
`audit/agent6-2026-11-10/probes/af004-taxplace-key-mismatch.test.ts`

| # | Test | Observed |
|---|---|---|
| 1 | control — customer `taxPlace {country:'US', state:'TX'}`, TX permit | 1 document, taxable 10,000c, tax 625c — **counted** |
| 2 | same sale, customer `taxPlace {country:'US', region:'TX'}` | **0 documents, 0 tax** — silently dropped |
| 3 | `usQuarterJourney('2026-Q3')` with the `region` shape | TX return row exists, `documentCount 0`, `taxCollectedCents 0` |
| 4 | the seeded workspace's own `taxProfiles` (`sampleBusinessYear.ts:142`) | permit key `sales_tax:US:32099887766` → return row `state: ''` |

Mechanism — `src/lib/tax/usSalesTaxReturn.ts:60-63`:

```ts
const place = (customer?.metadata as { taxPlace?: TaxPlace } | undefined)?.taxPlace;
// the buyer's state decides; without one, the seller's own place (an over-the-counter sale)
const buyerState = place?.country === 'US' ? place.state : place ? undefined : seller.place?.state;
if (buyerState !== state) continue;
```

* `TaxPlace` (`src/lib/tax/profile.ts:14-22`) declares `state`. `region` is not a field of the type.
* But three writers in the product use `region`:
  `src/lib/sampleBusinessYear.ts:142` (workspace books), `:144` (the TX registration),
  `:214` (every customer), `:233` (every vendor), and `:524` reads `custMeta.taxPlace?.region === 'TX'`
  to decide the 6.25 % rate. `src/tests/invoice-destination.test.tsx` likewise passes
  `{ country: 'US', region: 'TX' }` as `customerPlace`.
* So a book set up — or seeded — in that shape prints a Texas return of **0.00** while the
  invoices on the same screen show 6.25 % Texas tax collected. That is a silently wrong
  financial report in the W8 lane (RELEASE_GATE: stage C, "each automation verified against
  worked figures"), and the samples are what testers see first.
* Secondary: because `buyerState` is `undefined` (not missing), the sale does not even fall back
  to the seller's place — the over-the-counter branch is skipped too, so the omission is total.

Fix shape (money lane, AI #1): add one shared reader — `stateOf(place) = place.state ?? place.region`
(both keys normalised to upper case) — and use it in `usSalesTaxReturn`, `usNexusWatch`,
`saleDestinationSnapshot`, and `sampleBusinessYear`; then make `TaxPlace` say one of the two, or
declare both and migrate. Overlaps issue **#518** (unknown-state sales silently omitted); this is
the concrete, reproduced instance of it, and it also shows the empty-state path never surfaces a count.

### F-02 (P2, tenant/job plane) — two `/api/v1/system/*` routes carry no middleware, and one `/api/v1/admin/*` route is not admin-gated; the D-30 route-coverage test cannot see either

Reproduction (executed, 4/4 assertions pass):
`audit/agent6-2026-11-10/probes/s7-route-guards.test.ts`

Registrations in `src/server/routes/adminRoutes.ts` that do **not** carry `authenticate + requireAdmin`:

| Line | Route | Middleware today | Authorises how |
|---|---|---|---|
| 338 | `POST /api/v1/system/recurring/process` | **none** | in-handler `isSystemJobAuthorized(decodedToken, x-cron-secret, CRON_SECRET)` |
| 370 | `POST /api/v1/system/telemetry/errors/digest` | **none** | same |
| 471 | `POST /api/v1/admin/integrity/orphan-scan` | `authenticate` | **nothing else** — a platform-admin route reachable by any signed-in user for any workspace they belong to |

* The two `/system/*` routes are safe **today** only because each re-verifies the bearer token
  itself and compares `CRON_SECRET` with `timingSafeEqual` (`src/server/auth/systemJobAuth.ts`).
  That is a hand-kept invariant on an unauthenticated surface: any refactor that drops the
  in-handler check opens a public trigger for recurring drafts and error-digest email with an
  attacker-chosen `recipientEmail`/`hoursBack` body.
* `route-policy-coverage.test.ts` (D-30) declares a route file guarded when the file **text**
  contains any of `authenticate`, `requireAdmin`, `CRON_SECRET`, `requireSystemAdmin` anywhere.
  `adminRoutes.ts` contains all of them, so the D-30 test passes over both holes. This is the
  "indexing is not review" case the audit mission names, inside the security lane.
* Severity held at P2/P3: nothing lets a non-admin change money (orphan-scan is read-only), and
  no route is reachable without *some* check. But it contradicts `CURRENT_WORK.md`'s S-26 entry
  ("`POST /admin/integrity/orphan-scan` is `authenticate`-only (it authorizes the *workspace*, not
  admin)") being treated as a known-and-accepted item — it is still true at this pin, 3 weeks on.

Fix shape (my lane): put `authenticate, requireAdmin` on the integrity scan (the workspace check
inside `getReportContext` stays); mount the two `/system/*` routes behind a shared
`systemJobAuthorize` middleware so the check cannot be dropped from a handler; and strengthen
`route-policy-coverage.test.ts` to read registrations instead of words — the same parser this
probe uses is ~40 lines.

---

### F-03 (P2, data-layer guard) — 47 of the 68 `lf_rules` collections still have no JSONB field allowlist and no field cap

* `lf_rules` drives `lf_guard()` (`supabase/migrations/20260924190000_init.sql:185-240`). A row
  with `allowed_keys` NULL and no `max_keys` means: **any key at all** may be written into that
  collection's `data` by a browser session that passes RLS.
* I parsed every `insert into public.lf_rules` in every migration plus every later
  `update … allowed_keys` statement (re-runnable: the snippet is in
  `audit/agent6-2026-11-10/probes/lf-rules-coverage.py`):
  **68 collections, 21 with a field list, 47 without, and 0 gained one after 2026-09-24.**
* The 47 (`…`-free list): `admins, allocationOperations, apiKeys, assets, autoRules, bankLines,
  banks, billingLedgerTraces, bills, budgets, clientQueries, deepAuditJobs, dimensionNodes,
  documents, emailEvents, employees, estimates, external_api_cache, fixedAssets, idempotencyKeys,
  inventory, invites, invoices, jobRuns, journalEntries, loginAudits, members, numberingSeries,
  partners, payRuns, paymentAllocations, payments, periodBalances, periodClosings,
  reconciliations, recoveryCodes, recurring, repostQueue, stockClosings, stockMoves,
  stripeProcessedEvents, taxRates, taxReturns, transactions, vendors, workspaceGroups,
  workspaceShards`.
* Money-adjacent members of that list are the ones that matter: `idempotencyKeys` (S-5's replay
  guard), `billingLedgerTraces`, `periodClosings`/`periodBalances` (the close), `taxReturns` (what
  the US quarter screen shows as "recorded as filed"), `recoveryCodes` and `apiKeys`. Whether a
  forged row is *trusted* depends on the reader — e.g. `taxReturns` is read by the quarter screen
  (`UsQuarterJourneyReportView.tsx:71` fetches `/tax-returns` from the server, so that one is fine)
  — but a table with no allowlist has no structural defence at all.
* AI #6's 2026-11-05 report said "46 of 68"; at this pin the parsed count is **47 of 68**. I am
  reporting the number I parsed. I could **not** re-run the live-database proof (no Postgres in
  this sandbox), so the *mechanism* is source-verified and the *demonstration in a real database*
  stays carried forward.

### F-03b (P1-latent, tax engines) — #161/AF-012 reproduced against the **shipped** `evaluateRules`: a chain of overrides gives a different answer per array order, and a cycle is resolved silently

Reproduction (executed, 2/2 pass): `audit/agent6-2026-11-10/probes/af012-rule-chain-order.test.ts`
imports the real `src/lib/rules/rules.ts` — nothing is re-implemented.

```
order A,B,C -> applied A,C     (C should have been displaced by B, which A displaced)
order B,A,C -> applied A
order C,B,A -> applied A
cycle A>B, B>A: order A,B -> A ; order B,A -> B
```

Mechanism (`src/lib/rules/rules.ts:82-84`): the override pass is

```ts
for (const { rule } of candidates)
  if (rule.combine === 'override' && !off.has(rule.id))
    for (const t of rule.targets || []) if (!off.has(t)) off.set(t, rule.id);
```

A rule that has itself been displaced never displaces its own targets, so displacement does not
propagate transitively; whether `C` survives therefore depends on where `B` sits in the array. A
cycle is "resolved" by whoever comes first.

* Why it is **latent**, measured not assumed: AI #8's AF-012 probe and Agent #7's 8 Nov re-run both
  report **0 override chains in the 18 shipped rule packs** (584 rules, 67 overrides). Nothing a
  customer can reach today produces a chain.
* Why it still matters: the moment a pack gains a chain (a state + city + district pack is exactly
  that shape), a tax figure changes with the order the packs were concatenated in — non-reproducible
  between two installs at the same data. Any fix should either compute the transitive closure of
  displacement or **refuse** a chained/cyclic override graph with a named error, and the probe above
  is the acceptance test either way.

### F-08 (P1, screen/API inconsistency) — "Recorded as filed" on the US quarter screen and the server's tax-return ledger are **two different universes that cannot be reconciled**

This is the same class as AUD-01 (#141, "the statement PDF ignores the selected period") but on the
tax screens, and it is a *workflow* finding (Pass B), not a single-function one.

* The screen: `UsQuarterJourneyReportView.tsx:64-80` asks
  `GET /api/v1/workspaces/:id/tax-returns` for **all filed returns** and reduces each to
  `{ startDate, endDate }`, dropping `registration`. `usQuarterJourney` then marks a state return
  filed when *any* recorded return covers the same dates
  (`src/lib/usQuarterJourney.ts:281-283`: `filed.has(permit.registration) || filed.has(quarterKey)
  || filedPeriods.some(f => f.startDate === startDate && f.endDate === endDate)`).
  The table column is then rendered as **"Recorded as filed"** with a bare `Yes`
  (`UsQuarterJourneyReportView.tsx:186,199`) — no registration, no kind, no date.
* The record: filing goes through `POST /tax-returns` → `fileTaxReturn`
  (`src/server/services/taxReturnService.ts:56-101`), which
  (a) accepts a `registration` only if `vatRegistrationsIn(...)` contains it — and that helper
  filters `r.kind === 'vat'` **only** (`:43-48`), so a **US sales-tax permit can never be the
  scope of a filed return**; and
  (b) computes the boxes with `buildTaxReturn(invoices, bills, creditNotes, vendorCredits, …)`
  (`:36`) — an **invoice/credit-note/VAT-box** computation that the US quarter journey never
  reads. The journey's own figures come from `usSalesTaxReturn` (F-01's function).
* Consequences a tester can hit in the first quarter:
  1. File the quarter's return once → **every** state row on the quarter screen reads
     "Recorded as filed: Yes", including states with a permit and no sales. File one state's
     permit (if the server accepted it) → every other state's row also says Yes.
  2. The number the server stored with the filing (`boxes`) is not the number the screen shows
     (gross/taxable/collected by state, F-01's computation). Two "tax returns" exist for the same
     period with no stated relationship — exactly the AUD-01 failure mode, on the tax path.
  3. The filing is refused for a US permit with a message about **VAT** registrations
     (`'… is not one of this workspace's VAT registrations …'`), which is the wrong vocabulary for
     a US bookkeeper and hides that the operation is unsupported for them.
* Fix shape: one tax-return record type carrying `{ jurisdiction, registration, kind, period,
  source: 'vat'|'sales_tax', figuresFrom }`; the quarter screen must match on **registration +
  kind**, print which record it matched, and the server must either compute the sales-tax figures
  for a `sales_tax:` registration or refuse the filing explicitly ("state returns are not filed
  from LedgerFlow yet"). Both are AI #1 lane; the acceptance test is a two-state book with one
  filing, asserting the other state still reads "not recorded".

### F-09 (P1, audit trail / sign-in evidence) — the trail does not cover the writes that keep the books, and the two "who signed in" screens read a row the server never writes

Probe: `probes/f9-audit-trail-coverage.test.ts` — **3/3 pass**. Three separate defects, one theme: the
trail that `docs/SECURITY_CONTROLS.md` lists as the A.8.15 control does not say what it claims to.

**(a) The handlers that post the journals mostly write no audit entry.** Measured over the real
registrations in `src/server/routes/*.ts`: **33 handlers persist in their own body** (`.set/.update/.delete`,
`.add`, `batch.commit`, `runTransaction`, `FieldValue.*`, SQL) and **10 of them (30.3 %) call
`writeServerAuditLog`/`writeAuditLog` in that same handler**. The 23 that do not include the ones that
move money into the general ledger:

| handler | what it writes |
|---|---|
| `POST /capitalize` (`leaseRoutes.ts:18,112`) | ASC 842 ROU asset + lease liability (2-line journal) |
| `POST /recognize` (`revenueRoutes.ts:113`) | revenue-recognition journal |
| `POST /cogs` (`inventoryRoutes.ts:161`) | COGS journal |
| `POST /api/v1/ledger` (`developerApiRoutes.ts:171`) | a chart account, through the public API |
| `POST /api/v1/brain/classify-batch`, `POST /api/v1/projects` | via the public API |
| `POST /api/v1/keys/provision`, `DELETE /api/v1/keys/revoke/:keyId` (`apiKeysRoutes.ts`) | API-key issue and revoke — *"writes are server-side"* per the RLS comment, and none audited |
| `POST /webhook/stripe`, `/api/webhook/plaid` | processed-payment / sync state (arguably not trail material, listed for completeness) |

The main document/journal path *is* covered — `ledgerBulkCommit.ts:373` audits deletes, `:387` writes the
`beforeWrite` audit (credit-limit override, `creditLimitGuard.ts:65-70`), and
`session`/documents/period/branding/payment/support routes audit too. So this is not "nothing is audited";
it is **a ratchet that stops at the routes that were remembered**, with no guard to keep the next one honest.
The two unauthenticated-by-document write paths from F-02 sit in the same set.

**(b) The sign-in rows the security screens read are written by the browser, and the server never writes
that action at all.** `src/lib/accessReview.ts:148` (`lastSignIn`) and the access-review / audit-evidence
CSVs take `action === 'USER_LOGIN'` rows from `auditLogs`. The only `USER_LOGIN` writer in the whole tree
is `useLedgerData.ts:171` — a client `void addDoc(...)` that logs its own failure to the console and
nothing else, once per browser session (`sessionStorage`). The server's own auth audit
(`authAuditService.ts:24`) writes a **different** collection (`loginAudits`) under a **different** name
(`event: 'login'`), from `POST /api/v1/auth/audit` (`authRoutes.ts:45-58`), which is itself a client call.
So "last recorded sign-in" is a claim the browser makes about itself; a person who never opens a tab
that runs the hook, or whose insert is refused, has no sign-in row and the screen cannot tell the
difference between "did not sign in" and "did not manage to log it".

**(c) `loginAudits` — the one record with real server-side provenance — is write-only.** It is declared
in the migration's *server only* list (`init.sql:80`) and **no RLS policy was ever created for it**, so not
even a member can read their own sign-ins through the app; no route reads it (probe asserts zero) and the
only consumer is the personal-data export (`personalDataService.ts:33`). `accountDeletionService.ts:102`
does delete from it.

**What is right, and should not be "fixed" away:** `auditLogs` is genuinely insert-only — there is a
`member_read` and a `member_insert` policy and **no update or delete policy** (probe asserts this), so the
append-only property holds at the database. And a viewer may insert only `action = 'USER_LOGIN'`
(`init.sql:448`), so the client-side sign-in log cannot be abused by a read-only member to invent other
events. The failure is in *what is written*, not in *who may write it*.

**Fix shape (AI #1 lane / RLS lane, no money maths):**
1. Move the sign-in row to the server. `POST /api/v1/auth/audit` already exists; write `action:
   'USER_LOGIN'` into `auditLogs` there (server-side, real IP/UA, cannot be skipped by a closed tab), and
   keep `loginAudits` as the per-person security log.
2. Give `loginAudits` a `member_read` policy that shows a person only their own rows
   (`data->>'uid' = lf_uid()`), and read it for the "Last sign-in" column; leave the client `addDoc` for
   the workspace-session breadcrumb only, and say so on the screen.
3. Turn F-09a into a guard test: a route file that persists and has no audit call fails, with the
   wire-endpoints in an explicit allowlist (that is the ratchet pattern already used for `no-explicit-any`).

### F-10 (P2, retry safety) — three money routes keep their own idempotency record: no status, no request hash, and a hit is always answered as success

Probe: `probes/f10-handwritten-idempotency.test.ts` — **3/3 pass**.

The shared helpers are good: `executeIdempotent` / `createPaymentIdempotent`
(`src/server/utils/idempotency.ts:52-102`, `src/server/services/paymentService.ts:95-112`) key on
`workspace:OPERATION:id`, store `{status, payloadHash, actor, result}`, refuse the same key with a
different request `409`, and `INT-3` tests the race with two simultaneous requests. The payment route
(`paymentRoutes.ts:77-102`) and the bulk ledger route (`ledgerBulkCommit.ts:109-116,175-183`) use them.

Three routes do not. `POST /inventory/cogs` (`inventoryRoutes.ts:52-56,146,153-160,178-182`),
`POST /leases/capitalize` (`leaseRoutes.ts:45-50,104-112`) and `POST /revenue/recognize`
(`revenueRoutes.ts:46-51,105-113`) each read `idempotencyKeys/{ws}_{inv|lease|rev}_{key}` themselves and:

1. **store `{response: responsePayload, timestamp, workspaceId}` — no `status`, no `payloadHash`.**
   The response payload is built *before* the write (`inventoryRoutes.ts:113-119`,
   `leaseRoutes.ts:93-97`, `revenueRoutes.ts:93-97`). Anything that throws after it is built and before
   `t.set(idempRef, …)` — the stock check `'Insufficient inventory stock. Requested X, available Y.'`
   (`inventoryRoutes.ts:146`, inside the transaction), a period that closed between check and commit,
   a lost lease on a transaction retry — leaves **no** record, so the retry is not a replay.
2. **answer a hit with the first attempt's body and 200**, unconditionally
   (`return res.json(idempDoc.data()?.response)`), so a client cannot tell a stored answer from a fresh
   one. For these routes the stored body is only ever a success, so this is "success means success",
   but the shape gives no way to store a refusal and no way to expire it.
3. **do not bind the key to the request.** Send the same `Idempotency-Key` with `quantitySold: 100`
   instead of `10` and the route answers with the first request's `{transactionId, totalCogsCents}`
   and posts nothing — a silent no-op the caller believes succeeded. Everywhere else this is a `409`.
4. The record's `expiresAt`-style cleanup does not exist on this table (the payment helper writes
   `expiresAt` at +30 days but **nothing sweeps it** — see F-11).

This is P2, not P1: the failure mode needs a throw in a narrow window or a client that reuses a key for
a different request, and the stock check is the only one of the three with a *reachable* post-build
failure. It belongs with F-09 as "the ratchet stopped at the routes that were remembered".

**Fix shape:** replace the three handwritten blocks with `executeIdempotent` (they already have
`workspaceId`, `operationId` and a small body to hash), or at minimum store
`{status:'success', payloadHash: requestPayloadHash(validatedTx-or-payload), response}` and refuse a
mismatch with `409`. Add the three routes to `scripts/idempotency-route-inventory.ts`'s
`visible-helper-call` column, which today reports **209 of 214 mutating registrations as `not-visible`**
and only 5 as helper-backed — that script is a review lead, not a certification, and the queue's S-05
item should say so.

## B. Verified at the pin as source facts (no run needed)

### F-04 (P3, ops) — the production-settings check still is not wired anywhere

`scripts/check-prod-env.ts` exists and has tests (`S-02`), but `grep -n "check:prod-env"` finds it
in **no** `package.json` script and **no** workflow. Its own test file is the only caller. Closing
S-2 is a two-line change (`"check:prod-env": "tsx scripts/check-prod-env.ts"` plus a `ci.yml`
step or a deploy hook) that nobody has made since 5 Nov.

### F-05 (P3, security) — the per-user throttle that the queue calls S-22 is still dead code

`authRateLimiter` is exported from `src/server/middleware/rateLimiters.ts:8-11` and is imported by
**nothing** (`grep -rn authRateLimiter server.ts src/` → one hit, its own definition). Auth is
Supabase-hosted, so there is no sign-in or password-reset route in this codebase to attach it to;
the only reachable half of S-22 is the AI routes, which are covered by the shared limiter through
`brainRateLimiter` and by the per-call credit debit. So: S-22's AI half is done, its
sign-in/reset half is structurally not ours, and the dead export should either be deleted or
documented so the next agent does not "implement" it twice.

### F-06 (P3, security) — secrets scanning and the audit hash chain are still absent

* No `.gitleaks.toml`, no `gitleaks` step in any of the 8 workflows (`ci.yml`, `codeql.yml`,
  `security-sbom.yml`, `code-atlas.yml`, `eslint-warning-ratchet.yml`, `line-count.yml`,
  `nightly-stability.yml`, `visual-baselines.yml`). S-9/S-24 remain OPEN.
* No `prevHash`/`chainHash` anywhere in `src/server` or `src/lib` outside tests. S-12 remains OPEN.
  (Both re-verified at this pin; both were already reported on 2026-11-05.)

### F-07 (P2, money integrity) — the Plaid cursor/ingest lane is fixed; the *reporting* of it is still wrong

* AF-001-F1/F2/F3 are **genuinely fixed** at this pin and I re-ran the audit suites that pin
  them: `audit-af001-plaid-contract.test.ts` passes, and the source shows the cursor moving in
  the same transaction as the rows (`storePlaidChunk`, `src/server/services/plaidIngest.ts:106-190`,
  chunked at 500 with the lease and the expected-cursor check on every chunk).
* AF-001-F4 is **not** fixed and is now measurable in the UI: `POST /plaid/sync` answers
  `success: transactions.length > 0 && busy.length === 0` (`plaidRoutes.ts:396`), so a healthy
  sync that produced no new rows answers `success:false`; `Banking.tsx:64-67` then shows an
  **info** toast "Bank feed synced. No new transactions." The audit suite still asserts the
  `success:false` shape as "OBSERVED CONTRACT" (`audit-af001-plaid-contract.test.ts:49-53`), i.e.
  the test documents the wart instead of closing it.
* Severity P3 for the user (the message is not false), P2 for machine consumers: an integration
  that keys off `success` treats "nothing changed" as a failure and retries forever.

---

## C. Carried forward, not re-executed here

| Item | State at this pin | Why I did not re-run |
|---|---|---|
| #161 chained rule overrides | latent; 0 chains in shipped packs (AI #8 probe, re-run by Agent #7 on 8 Nov) | pure library, could be re-run — next session |
| #517/#518/#519 US state return family | still open; F-01 above is the reproduced member of the family | #517/#519 not reproduced here |
| W11 source-total acceptance, W13 stock journey | stage-B gates unchanged | needs browser + Postgres |
| S-32 `lf_rules` never asserted in `rls.test.sql` | unchanged (2 textual references only) | needs Postgres |
| S-28 session list, S-13 anomaly alerts, S-19 backup-verification job | unchanged OPEN | source-verified on 5 Nov, unchanged since |

---

## D. What I ran, exactly

```sh
# probes (all pass: 4/4, 4/4, 2/2, 4/4, 3/3, 3/3 assertions)
NODE_ENV=test SYSTEM_SALT=… npx tsx --test \
  audit/agent6-2026-11-10/probes/af004-taxplace-key-mismatch.test.ts \
  audit/agent6-2026-11-10/probes/s7-route-guards.test.ts \
  audit/agent6-2026-11-10/probes/af012-rule-chain-order.test.ts \
  audit/agent6-2026-11-10/probes/f8-tax-return-two-universes.test.ts \
  audit/agent6-2026-11-10/probes/f9-audit-trail-coverage.test.ts \
  audit/agent6-2026-11-10/probes/f10-handwritten-idempotency.test.ts

# the pin's own audit suites for the money primitives (20/20 pass)
NODE_ENV=test SYSTEM_SALT=… npx tsx --test \
  src/tests/audit-af001-plaid-contract.test.ts \
  src/tests/audit-af002-label-cents.test.ts \
  src/tests/audit-af010-money-primitives.test.ts
```

Unit shards at the pin: see `03-gates.md` — 1/4 = 4,583 tests / 4,576 pass, 2/4 = 1,189 tests /
1,187 pass, shards 3–4 as recorded there; DB-gated suites skip without `LF_TEST_DATABASE_URL`.
