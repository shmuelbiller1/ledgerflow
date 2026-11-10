# Ledgerflow — final accurate list of open items — 10 November 2026 (Agent #7)

**Owner main pin:** `dc40739708a013ad080ffb306fe461554a2391fc` (`docs: AI #12 active (N-1…N-10, start note); spare queue AI #13 (R-1…R-5)`, 2026-11-10T03:08Z). All executed evidence in this file was run at this pin, or at `5968faf3` (`docs: UX-8 and UX-9 done (#597, #598)`) whose **code tree is identical** — `git diff --stat 5968faf3..dc407397` touches only `docs/COORDINATION.md` (+21/−3). Every status below was re-checked against source and, where executable, re-executed at the pin on 2026-11-10 by Agent #7. No production data, database or browser was accessed. Limitations are in "What was actually executed" and "Limitations".

**Supersedes** [`FINAL_ACCURATE_LIST_2026-11-08.md`](FINAL_ACCURATE_LIST_2026-11-08.md) — which reached `main` with **unresolved merge-conflict markers** in commit `2245ff43` (see Section 1). Both sides of that file are preserved there, resolved by this audit. This is the current slice of umbrella issue #150.

**GitHub issue states re-checked 2026-11-10:** all 15 open issues verified open; last close was #444 (2026-10-30). No issue was closed between the 11-08 pin and today, so every "fixed but still open" row from the 11-08 list remains accurate only as a code observation, not as a tracker state.

---

## 1. NEW finding — `main` contains an unresolved merge conflict (repo integrity)

**Severity: P1 (beta prerequisite — documentation integrity on `main`; not a runtime defect).**

`audit/FINAL_ACCURATE_LIST_2026-11-08.md` at `dc4073970` contained raw git conflict markers:

- line 1: `<<<<<<< HEAD` (Agent #7's list, pin `fd50b2f2`)
- line 59: `=======`
- line 194: `>>>>>>> e9d5ae64 (feat(ai4): D-15/D-18 … Nov 8 final audit list)`

Introduced by commit `2245ff43` (author `shmuelbiller1`, committed 2026-11-09, single parent `9c88c1ad`, direct commit to `main`), which merged the fork's `ai7/audit-final-list-2026-11-08` (Agent #7 Side A, previously merged as `942bca41`) with Agent #4's parallel list (commit `e9d5ae64`, Side B) and was committed with both sides still in conflict. Commit `aaa19650` (2026-11-09) then **edited the already-conflicted file** (reworded Side B's one-line status and the D-15/D-18 and route-policy proof rows) without resolving the markers.

**Scope check:** `git grep -n -E '^(<<<<<<<|>>>>>>>)' dc4073970` matches only this one file — no other tracked file contains conflict markers. So the blast radius is the one audit document, but it is the document an owner or a first tester would read to know whether the system is ready.

**Fixed in this audit PR** (`audit/FINAL_ACCURATE_LIST_2026-11-08.md`): markers removed, both sides preserved verbatim under "Side A / Side B" headings with a dated correction note. No status text was reworded. **Recommended:** add a cheap CI guard (e.g. `git grep -E '^(<<<<<<<|>>>>>>>)'` failing the build) so a conflicted file can never land on `main` again — this class of error currently has no gate at all (ESLint/tsc/tests don't read Markdown).

**Side-effect of the conflict:** `main` briefly contained **two different documents both claiming to be "FINAL"/"final accurate list"** with contradictory statuses for the same issues (e.g. Side B marks #517/#518/#519 "Under review in tax lane", `#161` "Latent; guarded", `#131`/`#130` "Addressed in #543"; Side A marks the same issues live and re-executed). Section 4–6 of this file adjudicates every contradiction with executed evidence.

---

## 2. What changed between the 11-08 pin and today (for context)

225 commits (49 merges) between `fd50b2f2` (2026-11-08) and `dc407397` (2026-11-10), dominated by docs (28), audit artifacts (14), Sonar linearization fixes (11), visual baselines (9), UI/UX (4+), and tests. Material to this list:

- `#524`, `#535`, `#536`, `#537`, `#538`, `#539` (the eleven conflicted PRs, incl. Agent #7's and Agent #8's) were **merged 2026-11-09** via the repair PR `#539` ("Repair the eleven broken open PRs"). The 11-08 list's "open PRs conflict with main; do not redo" section is now **resolved by merge**.
- `#527` (Agent #4, D-85/D-90/D-92 — Dashboard first numbers, Settings sections, sidebar) **merged 2026-11-09**. Issue #274's remaining UI legs are no longer unreviewed work; the GitHub issue itself is still open.
- `#513` was already merged at the 11-08 pin. `#525` (G-9 guest sample books) was **closed unmerged** 2026-11-09.
- US federal payroll tables (Pub 15-T 2026/2025, #564/`2245ff43`), route-policy coverage (#564), D-34/D-35/D-64 property tests (`rules-engine-properties`, `money-properties`, `resolve-line-tax-properties`), D-91 icon-button guard (#564/`aaa19650`).
- `docs/COORDINATION.md` (dc407397): AI #12 is now an active lane (N-1…N-10) and spare queue AI #13 (R-1…R-5) was added — not audit-relevant.
- AI #1's 2026-11-07 message still stands: every open PR into `main` was blocked; PRs that say "Shmuel owns review and merge decisions" stay with the owner.

**ESLint ratchet on `5968faf3`:** `ESLint warning ratchet` workflow **completed successfully** (2026-11-10 run). On `dc407397`: `CI` (**success** — every job incl. unit shards, coverage gate, browser shards, Postgres-17 rules job, production build; run 03:08Z), `ESLint warning ratchet` (**success**, 03:16Z), `Dependency SBOM evidence` (**success**), `CodeQL security scanning` (**success**). Vercel previews remain "Authorization required to deploy" per the owner's deliberate usage freeze — not a code signal.

---

## 3. Verified LIVE defects at the pin (mechanisms re-executed, not inferred)

All executed at `dc4073970` unless marked `5968faf3` (identical code tree).

### 3.1 `#161` — chained rule overrides depend on array order (engine defect; still latent for shipped packs)

`src/lib/rules/rules.ts` `evaluateRules` (unchanged at the pin):

```ts
for (const { rule } of candidates) if (rule.combine === 'override' && !off.has(rule.id)) for (const t of rule.targets || []) if (!off.has(t)) off.set(t, rule.id);
```

Executed probe `audit/function-audit/probes/af012-rule-chain-order.mjs` (imports the real engine):

```
order A,B,C -> applied A,C | displaced B by A
order B,A,C -> applied A | displaced B by A, C by B
order C,B,A -> applied A | displaced C by B, B by A
```

A→B→A cycle also resolves order-dependently (11-08 re-execution; engine line unchanged). **Root cause:** an override that is itself displaced (`!off.has(rule.id)` fails) is skipped entirely — it cannot displace its own targets — and a target already claimed by an earlier override is not re-claimed (`!off.has(t)`). The documented semantics never define a chain, so the answer is whatever order the pack happens to list rules in.

**Shipped packs today:** probe `af012-shipped-pack-chains.mjs` re-executed — `packs: 18, rules: 584, overrides: 67, override targets that are themselves overrides: 0, dangling targets: 0`. So no shipped rule pack currently composes a nested chain: the defect is **latent, not active**, and Agent #4's "latent only" side of the conflicted file is confirmed for the *current* packs. It is still an engine correctness defect with zero guard tests: D-34's `rules-engine-properties.test.ts` (6/6 passing at this pin) covers exclusion dominance, single override displacement, date boundaries, verification gating, conflict safety and idempotence — **not** chained overrides, and no property pins an order-independence contract.

**Adjudication of the two halves of the conflicted file:** both were half-right. AI #7's "live, re-executed" = the engine mis-evaluates; Agent #4's "latent" = nothing shipped triggers it today and the engine needs a defined chain semantics or a rejection of ambiguous graphs. **Single severity: P2 (usable with care) today; P1 the moment any nested override chain is authored.** Fix belongs to the money lane (AI #1/#9): either reject ambiguous override graphs at pack-load with a test, or merge `off` in chain order with a permutation-independence property test. Do not silently rewrite the expected numbers in existing rule tests.

### 3.2 `#519` — US state sales-tax return ignores the invoice's saved destination (customer moved ⇒ past sales move states)

`src/lib/tax/usSalesTaxReturn.ts:60-63` at the pin (unchanged):

```ts
const place = (customer?.metadata as { taxPlace?: TaxPlace } | undefined)?.taxPlace;
// the buyer's state decides; without one, the seller's own place (an over-the-counter sale)
const buyerState = place?.country === 'US' ? place.state : place ? undefined : seller.place?.state;
if (buyerState !== state) continue;
```

The return reads the customer's **current, mutable** `metadata.taxPlace`; it never reads the invoice's own `doc.metadata.taxPlace`. The `#255` snapshot contract exists precisely for this (`saleDestinationSnapshot`, `src/lib/tax/usInvoiceTax.ts:135-149`, writes the destination on issue; `usNexusWatch.ts` reads `d.metadata?.taxPlace` first — line 130 at the pin).

Executed probe `audit/function-audit/probes/af004-519-customer-moves.ts` (new in this audit; imports the real `usSalesTaxReturn` and `saleDestinationSnapshot`):

```
snapshot written on issue: {"taxPlace":{"country":"US","state":"TX"}}
customer still in TX: documentCount=1 grossSalesCents=10000 taxCollectedCents=825
customer moved to CA: documentCount=0 grossSalesCents=0 taxCollectedCents=0
EXPECTED per the #255 contract (usNexusWatch reads the invoice snapshot): the July sale stays in the TX return either way.
```

**Live at the pin.** Moving a customer retroactively removes their past sales from the original state's quarter/CSV. Fix belongs to the money lane (AI #1/#9): the buyer-place block must prefer the invoice's `doc.metadata.taxPlace` and fall back to the customer's current place (then the seller fallback), matching `usNexusWatch`.

### 3.3 `#518` — US state sales-tax report silently omits sales with an unknown state

Same block, `usSalesTaxReturn.ts:62-63`: a defined but non-US place yields `buyerState === undefined`, and `continue` drops the document — no surfaced counter, no log, nothing. Only a fully **missing** place falls back to the seller's state. Re-executed in `af004-tax-authority-probe.ts` (P3): `TX sale with US place but no state is silently omitted … expected the sale to be reported or flagged; observed documentCount=0, taxCollectedCents=0`.

**Live at the pin.** Fix: count omitted documents in the returned structure (e.g. `skipped`/`unallocated` counters or an explicit `unresolved` list) — money lane.

### 3.4 `#517` — US state sales-tax return resolves the seller from `doc.dimensions`, not the line entity labels

`usSalesTaxReturn.ts:57`: `resolveSellerProfile(input.profiles, doc.dimensions, input.order)` — the document-level dimensions. The invoice/bill screens persist entity labels **per line** (`InvoiceModal` items carry `dimensions`; `items[0].dimensions` for invoices, `splits[0]` for bills), and `ilVatReturn.ts:42-48` has exactly the right shared primitive — `documentEntityLabels()` (line-first, then document-level fallback) — which the IL return uses (`ilVatReturn.ts:54`) and the US return does not.

Re-executed in `af004-tax-authority-probe.ts` (P8): `Israeli-branch invoice (label on items[0]) counted in the Texas return: documentCount=1`.

**Live at the pin.** One shared primitive (`documentEntityLabels`) applied to both returns fixes #517 and is the same shape of fix as #519/#518: *answer from the sale's own saved facts, not from mutable/derived context*.

### 3.5 The rest of the AF-004 tax-authority family, re-executed (context for #517–#519)

`af004-tax-authority-probe.ts` at the pin:

```
DEFECT AF-004-P1 place merge across countries: IL entity keeps books' US state {country:"IL",state:"TX"} (from ["world:il","books"])
DEFECT AF-004-P2 Israeli sale leaks into Texas return: documentCount=1, grossSalesCents=10000
DEFECT AF-004-P3 TX sale with US place but no state is silently omitted: documentCount=0
DEFECT AF-004-P4 non-US buyer: state return vs quarter journey disagree (return drops; usQuarterJourney counts 1)
DEFECT AF-004-P7 US branch sale lands in the Israeli VAT return: documentCount=1, taxableSalesCents=10000
OK     AF-004-P5 control: conflicting legalForm reported as conflict (deterministic first-in-order)
DEFECT AF-004-P6 verified/declared duplicate set value stays unverified (conservative false negative)
DEFECT AF-004-P8 US return ignores first-line entity label: documentCount=1
```

Reading: P1/P4/P7 are **cross-country attribution defects** of the same family — the books' registrations/places leak into labelled entities that do not list their own, in both the US state return and the IL VAT return (a US-labelled branch sale lands in the Israeli VAT return, P7), and two product paths answer the same buyer rule differently (P4). P6 is conservative (safe direction). P5 is the control that holds. **All six are in AI #1/#9's money lane; none is fixed at the pin.** The common root: `resolveSellerProfile` inherits the books' registrations/place into any label-level entity that lists none of its own (`src/lib/tax/profile.ts:96-101`) while the module doc says "Registrations are not merged across levels: the nearest level that lists any is the one that counts" — the engine's behaviour (books win when the label level lists nothing) is at minimum undocumented and at worst wrong for tax attribution. Severity of the family: **P1 for P7/P2/P8/P4 (wrong-return attribution with no signal), P2 for P1/P6.**

### 3.6 `#131` — as-of inventory valuation: implementation merged; residual remains; issue open

At the pin: `src/lib/inventoryAsOf.ts` and `src/tests/iss131-inventory-as-of.test.tsx` exist; `RELEASE_GATE.md` W13 reads **Yes / Yes / Yes** with [valuation on a past date](docs/verification/ai9-iss131-inventory-as-of.md) linked; figures are stock-moves-ledger-derived (backdated moves summed by date, not "last-written move"; history proven from zero; unknowns reported with reasons, never 0).

**Residual, per AI #9's own verification doc (unchanged at this pin):** "`computeInventoryValuation` reads the ledger side from the browser's *loaded* entries. When those are capped, the screen now withholds the comparison, but a full-history server figure for the books (issue point 4) is server work" — **not done**; and the mixed-source books comparison still depends on browser-cache completeness outside the capped case. The GitHub issue remains **OPEN** and its point 4 is genuinely outstanding.

**Accurate status: substantially delivered (stock side truthful, comparison withheld-with-reason when incomplete, W13 gate green); not closable until the server-side full-history books figure lands (money/server lane) or the owner accepts the documented limit.** Not a regression — and the 11-08 list's "waits on EG-7" framing was already stale at fd50b2f2 (the iss131 verification doc predates it). The EG-7 stock-snapshot task in CURRENT_WORK is likely the intended server-side vehicle.

---

## 4. Fixed in code at the pin; issue still open on GitHub (lead: verify, then close)

Code unchanged between 11-08 and today for these subsystems (except #96's hook, which only gained the bounded retry). All focused suites re-run and **pass (38/38)** in this audit where they are not DB-gated — see Section 7.

| Issue | Fixed at the pin — evidence |
|---|---|
| **#96** live collection may not recover | `useLedgerData.ts` bounded automatic retry (`retryTransientFailures`, `retryAfterReconnect` on `online`/`visibilitychange`) + `collection-retry.test.ts` (passes). Permission refusals wait for "Try again" by design. |
| **#141** statement PDF ignores the screen period | `src/server/services/statementService.ts` — `loadStatement(db, workspaceId, contactId, period, …)` resolves via `resolveStatementScope` in the **workspace** time zone and **throws `StatementScopeError`** on invalid/reversed periods (never widens to all history). `aud01-statement-scope.test.tsx` and `audit-ai3-calendar-scope.test.ts` pass. |
| **#146** drawer Escape under focus drift | Drift-Escape mechanism merged in #446 (topmost dialog answers) at the 11-08 pin; unchanged since. |
| **#342** stored Jan 1 shifts year in another zone | `src/lib/calendarDate.ts` civil-date contract (`civilDateParts`/`civilMonthDay`/`civilMonthYear`/`civilYear`) reads the stored YYYY-MM-DD with no zone applied. `calendar-dates.test.ts` + `civil-date-properties.test.ts` pass. |
| **#160** IL VAT equipment split has no caller | `israelMonthJourney.ts:337-338, 503-504` calls `withEquipment(...)` from saved bills when the chart is given (ISS-160/W7-GOLD); `iss160-il-vat-equipment.test.tsx` passes. |
| **#143** RMA approvals / cumulative quantities not enforced server-side | `returnAuthorizationRoutes.ts` issues move through `returnAuthorizationService` with **conditional atomic writes keyed on `expectedStatus` and a `requestKey`** (approve/decline/receive/link, role re-verified from workspace membership per action; double-approval 409). `iss143-rma-server.test.ts` is **DB-gated** (`LF_TEST_DATABASE_URL`) and therefore was **not executed here** — it runs in CI's Postgres 17 job. Do not close without a green CI/rules run on record. |

**Lead action: verify each against a green CI run on `main`, then close #96, #141, #146, #342, #160, and — after a rules-run — #143.**

## 5. Fixed in code; now unblocked or replaced — owner/deployment items

- **#130** stock revaluation without a ledger posting. Code fixed (#259: `POST /api/v1/inventory/revalue`, balanced posting, `stockRevaluationService` in one DB transaction; screen locks the cost; `Revalue` dialog; migration `20261020120000_inventory_cost_server_only.sql`). That specific migration was superseded by `20261021010000_inventory_cost_editable_at_zero.sql`, which **`docs/FOR_YOU.md` records as run by the owner on 21 Oct 2026 ("Success. No rows returned")** — and which replaces the ISS-130 one ("you do not need to run that one separately"). The policy is therefore in force at the database for the successor description (cost change refused while stock on hand; zero/negative editable). **Remaining:** none that this audit can verify — the protection lives in the live DB, which this audit did not access. Lead to verify against the live database and close.
- **Stage B exports/screens** (#274): see Section 6.
- **Remaining owner actions** (unchanged at this pin; `docs/FOR_YOU.md` §5/§8 and secrets sections): set `DATABASE_CA_CERT` in Vercel (item 8, AUD-20 — until then the connection is encrypted but the certificate is not checked); rotate the four agent-generated secrets; live sign-up test; deployment protection stays on; SMTP sender/provider + Stripe final steps; require CI before merging to `main` (L-67).

## 6. Open items that are not defects (do not re-triage as bugs)

- **`#274` (Settings shortcuts / Saved Views layering / loading flashes)** — the legs landed in stages: Settings section reveal, Saved Views dialog surface/stacking and ledger keyboard work (0e89cd27 batch / #446, Oct 29); loading skeletons + 0.0615 max layout shift (A-266, `arena/0c91798f-ledgerflow`, Nov 2); and the remainder — **D-85 Dashboard first-numbers, D-90 Settings five sections + search, D-92 sidebar names** — merged as **#527 on 2026-11-09**. Remaining user-facing leg per the issue text: none known to this audit; the GitHub issue is still **OPEN** with no owner/lead close note. **Action: lead to verify and close #274** (or state exactly which sub-item remains).
- **`#132`** — Stage-B feature request (trace product acquisition → full cost → final use across stock dimensions, P2-36). Parked by owner triage on 18 Oct. Not a defect.
- **`#150`** — umbrella issue for this audit mission (Pass A function audit + Pass B capability map). This file and `audit/function-audit/` are its current slices. Stays open until the mission's completion criteria are met.
- **`#161`** — see Section 3.1: a defect, but latent for shipped packs; tracked as its own issue, P2 today.
- **`#131`** — see Section 3.6: delivered in substance; residual server work + closure decision is the lead's.
- **Vercel preview red** — the owner's deliberate deployment-protection pause ("Authorization required to deploy"), not a code failure. CI (`CI`, `ESLint warning ratchet`, `Dependency SBOM evidence`) on `5968faf3` is green/completed; see Section 2.

## 7. What was actually executed in this pass (and what was not)

**Executed at the pin (`dc4073970`; probes import the real, unmodified source):**
- `audit/function-audit/probes/af012-rule-chain-order.mjs` → order A,B,C applies A,C; B,A,C and C,B,A apply A. (§3.1)
- `audit/function-audit/probes/af012-shipped-pack-chains.mjs` → 18 packs, 584 rules, 67 overrides, **0 nested chains, 0 dangling targets**. (§3.1)
- `audit/function-audit/probes/af004-tax-authority-probe.ts` → P1…P4, P6, P7, P8 reproduce; P5 control holds. (§3.2–3.5)
- `audit/function-audit/probes/af004-519-customer-moves.ts` *(new in this audit)* → #519 reproduced end-to-end through `saleDestinationSnapshot` + `usSalesTaxReturn`. (§3.2)
- Focused unit suites (`NODE_ENV=test SYSTEM_SALT=… npx tsx --test --test-force-exit …`): `rules-engine-properties`, `iss143-rma-server` (0 tests — DB-gated, skipped), `iss160-il-vat-equipment`, `collection-retry`, `calendar-dates`, `civil-date-properties`, `aud01-statement-scope` → **38 pass / 0 fail**; `rules-engine-properties` alone: 6/6.
- `git grep` conflict-marker scan over all tracked files → exactly one hit, `audit/FINAL_ACCURATE_LIST_2026-11-08.md` (fixed in this PR).
- `node scripts/code-atlas.mjs stats` → inventory 2141, code files 1967, reviewer-annotated 126, manually inspected 54, stale annotations 0, unresolved module/glob links 82. (Inventory, not an audit.)
- `gh` checks: all 15 open issues re-read at 2026-11-10; PRs #524…#539, #527 confirmed merged 2026-11-09; #525 closed unmerged; CI on `5968faf3` (ESLint ratchet success) and on `dc4073970` — full `CI` **success** (all unit shards incl. timezone legs, coverage gate, browser shards, Postgres-17 rules job, production build, Playwright smoke), plus ESLint ratchet, SBOM and CodeQL **success**.
- File counts at the pin: 3,502 tracked files; 2,667 `.ts/.tsx`.

**Verified — upstream `main` at the pin, full CI (`CI` workflow, run on 2026-11-10T03:08Z, conclusion `success`):**
- `Lint, Typecheck, and Database rules` — **success** (includes `npm run test:rules` / RLS against a Postgres 17 service).
- `Unit tests 1/4…4/4` — **success**, plus the timezone legs (`Unit tests in Pacific/Auckland (1-3/3)` and `Unit tests in America/Los_Angeles (1-3/3)` — **success**).
- `Accounting & Security Test Suites (coverage gate)` — **success**.
- `Production build` — **success**; `Browser shard 1/5…5/5` — **success**; `Playwright E2E Smoke Suite` — **success**.
- `ESLint warning ratchet` (5968faf3 and 03:16Z re-run) and `Dependency SBOM evidence` and `CodeQL security scanning` — **success**.

This PR changes no `src/` (docs + one review-only probe), so the pin's CI results cover the full suite, DB/rules, build and browser journeys at this exact base.

**Local full `npm test` (honest record):** launched at the pin in this sandbox; after ~55 minutes it produced no output and its processes showed ~0 CPU time (no Postgres/database here; the sandbox cannot reach one). It was **stopped without a result** and is **not** claimed anywhere as passing. Focused suites are green (Section 7); the authoritative full-suite signal is the CI run quoted above.

**Not executed (hard limits of this sandbox, recorded, not waved through):**
- `npm run test:rules` and the DB-gated suites (`LF_TEST_DATABASE_URL` unset — no Postgres binary in this sandbox). CI's Postgres 17 job runs them; until a green run is on record, **#143 and the RLS rows are unverified by this audit**.
- Browser/E2E (`playwright`) — no browser run here.
- `npm run build`, `npm run lint:eslint`, `npm run lint:types` — left to CI on this PR (docs/probe-only change; no `src/` modification, so type and lint outcomes are identical to `main`'s).
- The live Supabase/Vercel deployment, production data, secrets, live sign-up — out of scope by mission rule.
- The 512-row `bug-patterns`/code-atlas scans were not re-run as correctness evidence; they are inventory.

## 8. Issue-by-issue status (all 15 open issues, states re-checked 2026-11-10)

| # | Status at the pin | Bucket |
|---|---|---|
| **#161** | Engine defect live (probe); latent for shipped packs (probe); no guard tests | Defect (P2; P1 if nested chains ship) — money lane |
| **#519** | Live (probe; source lines cited) | Defect (P1, tax attribution) — money lane |
| **#518** | Live (probe) | Defect (P1, silent omission) — money lane |
| **#517** | Live (probe; `documentEntityLabels` is the unused shared fix) | Defect (P1) — money lane |
| **#131** | Implemented & gate-green (stock side); residual = server full-history books figure; issue open | Delivered-in-substance / money+server lane |
| **#130** | Code fixed (#259); successor migration run by owner 2026-10-21; live DB not audited here | Owner/live-DB verify, then close |
| **#96** | Fixed at pin; tests green | Lead verify + close |
| **#141** | Fixed at pin; tests green | Lead verify + close |
| **#146** | Fixed at pin (#446) | Lead verify + close |
| **#342** | Fixed at pin; tests green | Lead verify + close |
| **#160** | Fixed at pin; tests green | Lead verify + close |
| **#143** | Server enforcement present (atomic conditional writes, request keys); DB tests not run here | Lead verify on CI/rules, then close |
| **#274** | Legs landed (#446, A-266, #527); GitHub issue open, no disposition note | Lead verify + close or state remainder |
| **#132** | Stage-B feature request | Parked (P2-36) |
| **#150** | Umbrella audit issue; this file is its current slice | Open by design |

**Counts:** 15 open → 3 live P1 tax-attribution defects (#517, #518, #519) plus the wider AF-004 cross-country observations (§3.5), 1 latent P2 (#161), 6 fixed-awaiting-lead-closure (#96, #141, #146, #342, #160, #143), 1 delivered-in-substance with residual server work (#131), 1 owner/live-DB verification (#130), 1 UI legs delivered (#274), 2 not-defects/umbrella (#132, #150). Plus **1 new P1 documentation-integrity finding on `main`** (Section 1, fixed in this PR, tracked as #599).

## 9. Suggested next actions (for the lead / owner — this audit changes nothing on its own)

1. **Land the conflict-marker fix** (this PR) and add the `git grep` marker guard to CI.
2. **Money lane (AI #1/#9), one change:** make `usSalesTaxReturn` answer from the sale's own saved facts — prefer `doc.metadata.taxPlace` (#255 snapshot) for the buyer place (fallback: current customer place, then seller place), use `documentEntityLabels(doc)` for the seller (line-first), and stop `continue`-dropping unknown-state documents silently (count them). This closes **#519, #518, #517** and the P3/P8 legs of the AF-004 family in one reviewable PR with permutation/property tests (including the P7 books-registration inheritance question, which needs an explicit decision for a label-level entity with **no** registrations of its own).
3. **Money lane:** give `evaluateRules` a defined override-chain semantics or reject ambiguous graphs at pack load, with a permutation-independence property test (closes **#161**).
4. **Lead:** close the Section 4 issues after a green `main` CI/rules run (#96, #141, #146, #342, #160, #143), and disposition **#274** (merged in #527) and **#131** (residual server-side books figure or recorded limit).
5. **Lead/owner:** verify ISS-130's successor migration is indeed in force on the live database (screen lock exists; DB refused required for a direct browser write), then close **#130**.
6. **This audit is not a launch approval.** Stage A remains "READY" per `RELEASE_GATE.md`; Stage B (W11/W12/W13 + production-like gates) is the owner's gate; W7/W8 stay "check before filing". Nothing in this file waives the `FIRST_TESTERS_GATE.md` P0 items.

## 10. Beta readiness matrix (`docs/FIRST_TESTERS_GATE.md`) at the pin — audit assessment, not certification

The gate doc says **NOT CERTIFIED** and that every row needs evidence on an exact commit/deployment. This section is the honest current state of each row at `dc4073970`. It is a **status audit, not an approval**; the gate requires the deployed site checks, which this sandbox cannot perform.

| Gate | Audit reading at the pin |
|---|---|
| G-01 | First-hour/return journey evidence exists in-repo (G-24 #282, D-97, A-234 wizard walk; CI browser green on `main`). **Deployed-site check still pending (owner).** |
| G-02 | Same journey + plain-language pass (D-97) in repo; no dead-end evidence on the deployed site. **Unverified on deployment.** |
| G-03 | Robustness fixes merged (#521 F1/F2/F8, #545 F3, #546 F4/F5) and #96 bounded retry — green in CI on `main`. Browser re-run by this audit: **not done**. |
| G-04 | RLS/server rules suite green on CI's Postgres 17 job at the pin (`Lint, Typecheck, and Database rules` = success); W14 roles journey merged (#324). Live two-workspace check: **pending (owner deployment)**. |
| G-05 | Test-environment banner ships in the production bundle (`testEnvironment.ts`); not checked on the live site. **Code evidence only.** |
| G-06 | Feedback form + support reference merged; Settings → Support lists tickets. Not checked live. **Code evidence only.** |
| G-07 | CI browser shards 1–5/5 green at the pin; phone/390 px and Hebrew coverage exist in specs (not re-run here). **CI evidence; independent browser audit pending.** |
| G-08 | Written pilot permission / license clarity — **owner/legal action; not auditable from code.** |
| G-09 | Ledger door + batch validation + idempotency fixes merged; CI unit shards green. Production-like concurrent-write proof: **pending (B).** |
| G-10 | AF-001 closed (#151): Plaid cursor advances only after durable ingestion. Banking-screen AU-1 changed/removed lines remain open per RELEASE_GATE W4. **A-stage fix; B-stage evidence pending.** |
| G-11 | Deposit/order invoicing journey green (W6, #446-era); duplicate-click paths covered by server idempotency. **Evidence in CI; production-like concurrency pending.** |
| G-12 | W5 by-label worked figures + browser journey merged; **DIM-3 balancing roles remain open** (RELEASE_GATE W5). Label/entity ownership not confused by design there, but the open role issue blocks a clean B sign-off. |
| G-13 | W1/W2/W3 worked figures + W13 stock as-of iss131 evidence in repo. **Signed off only when #131's residual server figure lands or owner accepts the limit.** |
| G-14 | AUD-01/#141 fixed at the pin (§4); screen/PDF period parity enforced by `resolveStatementScope` + tests. GitHub issue still open (§4). **Code evidence; PDF/CSV live parity spot check pending.** |
| G-15 | D-98 backup/restore journey merged (#324); AUD-02 restore races fixed (#520-era). Concurrent-writes + dry-run on production-like deployment: **pending (B).** |
| G-16 | **Blocked for US state automation scope** by the live #517/#518/#519/AF-004 attribution defects (§3.2–3.5): returns answer from mutable customer data, silently drop unknown states, ignore line entity labels and leak books registrations into labelled entities. IL VAT path shares the same root (P7). Stage A/B remain *user-chosen rates* per RELEASE_GATE; nothing here should be offered as filing-ready. |
| G-17 | **Unverified (owner):** `DATABASE_CA_CERT` unset (AUD-20), 4 agent-generated secrets to rotate, live sign-up untested, deployment protection on, SMTP/Stripe pending. `docs/FOR_YOU.md` items 2–8, 17. |
| G-18 | Export evidence in repo (Auditor/Accountant export packs, Workspace archive ZIP). Rehearsed exit on a real deployment: **pending (B).** |
| G-19 | Perf budgets + scorecard exist; no 10k+ production-like load run evidence. **Unverified (B).** |

**Bottom line:** Stage A (synthetic invited preview) gates G-01..G-08 have in-repo/CI evidence for most rows, but the gate demands the deployed-site checks — until the owner performs them, first testers remain **uninvited** and this list certifies nothing. Stage B is held back by G-16 (open tax-attribution defects in the money lane), G-17 (owner config), G-12 (DIM-3), and the #131 residual. **This audit does not change the NOT CERTIFIED status.**

## 11. Provenance, backups and handoff

- **Branch** `arena/016300c9-ledgerflow` on the fork `Chaim-Richard/ledgerflow` (pinned base upstream `main` `dc4073970`; head `b30cd850` at the time of writing). **Fork PR:** https://github.com/Chaim-Richard/ledgerflow/pull/17 (final report comment: https://github.com/Chaim-Richard/ledgerflow/pull/17#issuecomment-6758228251). **Upstream PR:** this integration cannot create PRs in `shmuelbiller1/ledgerflow` from a fork (403 "Resource not accessible by integration"); Shmuel opens it from https://github.com/shmuelbiller1/ledgerflow/compare/main...Chaim-Richard:ledgerflow:arena/016300c9-ledgerflow?expand=1 (clean 4+-file diff). **New upstream issue:** https://github.com/shmuelbiller1/ledgerflow/issues/599 (conflict markers on `main`). Commenting on upstream issues is also blocked for this integration; the issue-#150 report is preserved on PR #17 and in Drive.
- **Google Drive**: folder `2026-11-10 final accurate list session` in `LedgerFlow AI7 audit 2026-11-06` (id `1rWocRGHuq834BzET46Bq3PsmFxhvNFMd`) — FINAL_ACCURATE_LIST_2026-11-10.md, agent7-checkpoint-2026-11-10.md, the resolved FINAL_ACCURATE_LIST_2026-11-08.md, evidence bundle (probe outputs), `SCORECARD-2026-11-10.md`, the issue-#150 comment text, and `agent7-2026-11-10-dc407397.patch` (`git diff dc407397..HEAD`; regenerated at each docs commit — the folder holds the latest).
- **Previous slice**: `audit/FINAL_ACCURATE_LIST_2026-11-08.md` (Side A/B, conflict resolved here) and its Drive folder `2026-11-08 final accurate list session`.
- **Handoff**: the next agent (or the owner) reads `AGENTS.md` → `CURRENT_WORK.md` → this file. Umbrella: issue #150; this document is its 2026-11-10 slice.
