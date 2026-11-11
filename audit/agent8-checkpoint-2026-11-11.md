# Agent #8 checkpoint — 2026-11-11

## Pin, branch and scope

- **Session branch:** `arena/a675941f-ledgerflow` (Arena-fixed; not renamed, not switched).
- **Pinned base:** `ec3ff49336c53eeed531a79ac32cc08d1574ec96` — upstream `main`, merge of PR #626, 2026-11-10T23:54Z.
- **Remote:** `origin = https://github.com/Chaim-Richard/ledgerflow.git` (the fork), exactly as `AGENTS.md` and
  COORDINATION's fork section expect. Work reaches the owner only as a PR into `shmuelbiller1/ledgerflow` `main`.
- **Checkout is depth 1** (`git rev-list --count HEAD` = 1), so no local history archaeology was possible; every
  history claim in this session comes from the GitHub API.
- **Authority:** review-only per `docs/INDEPENDENT_AUDIT_AGENT.md`. No money, posting, tax-maths, `src/server/`,
  migration or schema file was changed. Nothing merged. No production data, credential or live service used.

## Instruction sources actually examined

Root `AGENTS.md` (exact filename/location confirmed) · `CURRENT_WORK.md` · `docs/COORDINATION.md` (NOW rules,
"Rules for every helper AI", the AI #6/#7/#8 fork section, the AI #8 queue, and Messages) ·
`docs/INDEPENDENT_AUDIT_AGENT.md` (the audit mission) · `CLAUDE.md` · `audit/README.md` ·
`audit/function-audit/README.md` · `audit/function-audit/SCORECARD-2026-11-10.md` (Agent #7) · this agent's own
`audit/agent8-checkpoint-2026-11-10.md` and `audit/agent8-2026-11-08/03-accurate-findings-list-2026-11-08.md`.

There is **no separate agent inbox directory**; agent messages live in COORDINATION "Messages" and the per-agent
`audit/` folders, both read. **No message from Shmuel superseding the audit assignment was found.** The owner's
standing directions were followed: the 18 Oct plan, the 19 Oct "check your own open PRs first", and the 28 Oct
fork/Vercel note ("a red or missing Vercel preview does not block a merge … don't ask for it").

## Project state established before changing anything

- Working tree clean at session start; no uncommitted changes to preserve.
- **No Agent #8 PR was open** — #617 (10 Nov) had already merged, so nothing was redone. Full Agent #8 PR history
  reconciled: merged #617, #562, #559, #557, #538, #534, #530, #520, #434, #399, #252; closed/superseded #435,
  #425, #424, #525.
- Open upstream PRs at session start: **#623, #616** (Agent #11) and **#615** (Agent #7) — **not mine, not touched**.
- Open upstream issues: only **#131, #132, #150**. A large wave closed on 10 Nov: #517, #518, #519, #161, #160,
  #143, #141, #146, #342, #130, #274, #599.
- **CI at the pin: 23/23 green** (unit 1-4/4, Auckland + LA timezone legs, Postgres-17 rules, browser 1-5/5,
  Playwright smoke, coverage gate, production build, SonarCloud, CodeQL, SBOM, ESLint ratchet).
- Vercel: per the owner's 28 Oct note, fork-PR preview authorisation is expected and is **not** treated as a code
  verdict. No time spent on it.

## Work performed

1. **Chose the slice from the coordination record, not from scratch.** Agent #7's 10 Nov scorecard names the next
   batch verbatim: *"Re-verify the tax-attribution family at the fix."* That family was closed hours after their
   pin, so this session re-verified the closures rather than repeating completed investigation.
2. **Re-executed every existing AF-004 / AF-011 / AF-012 probe at the new pin** against the real libraries
   (`npx tsx`; the `.mjs` probes import TypeScript and cannot run under plain `node`).
3. **Adjudicated 12 issues** (9 closed, 3 open) against source, not against their reports.
4. **Found the probe itself was lying.** `af004-tax-authority-probe.ts` P3 still asserted `documentCount === 1`
   for a US sale with no state, which #614 correctly moved to the new `unplaced` figure. It printed **DEFECT
   against closed issue #518** — a false positive I reproduced before reading the source, and the next agent would
   have re-reported. Corrected to the new contract with exact worked figures (`unplaced` = 1 doc / 10000 net /
   825 tax) and kept as a regression guard; P8 relabelled a #517 guard.
5. **Wrote a new probe**, `audit/function-audit/probes/af004-614-residual.ts` — 11 cases against the real
   `usSalesTaxReturn`, `usQuarterJourney`, `resolveSellerProfile`, `registrationsOn`, `registrationKey`,
   `resolveLineTax` and `israelVatReturn`. Result **7 DEFECT / 4 OK**, where the 4 OK are deliberate: R1a and R2a
   confirm #519/#517 *did* fix the return, R2c is a **non-vacuity control**, R3e is an **honest scope control**.
6. **Caught myself shipping a vacuous assertion.** R2b first "passed" because the `digital-goods` item is exempt in
   California, so the product-exemption branch short-circuited the loop before the seller was ever consulted. Swapped
   to a `general` item (taxable in both CA and TX) and added control R2c. R2b then correctly reported DEFECT.
7. **Grounded F3 in the repository's own fixture** rather than a synthetic one: `tax-profile.test.ts:9-21` already
   holds an Israeli holding with a `world:us` child, but the suite only resolves `world:us/texas` and
   `location:eilat`. Resolving `world:us` gives `{country:'US', city:'Tel Aviv'}` holding `vat:IL:514000000`.
8. **Verified reachability, not just the pure function**: `TaxProfilesSettings.tsx` is a live Settings screen with a
   free-text Country field and optional registrations, and `taxProfilesProblem` never compares countries.
9. **Scoped the finding down honestly**: checked `resolveLineTax.ts:92-107` and confirmed the invoice screen does
   **not** suggest a wrong-country rate, because it branches on `country` and `country` is always the nearest
   level's own. Recorded as control R3e so the issue does not over-claim.
10. **Checked #131 rather than assuming it was stale**: grep-verified `computeInventoryValuation` has exactly one
    production caller, read that caller, and found the issue substantially mitigated — recommended narrowing it.
11. **Duplicate search before filing** (`is:issue resolveSellerProfile`, `cross-country`, `tax profile inherit`,
    `usQuarterJourney`, `documentEntityLabels`, `certificates quarter`) — 0 hits for the new findings; the only
    matches were the already-closed #517/#519.
12. **Filed #627 and #628** on the upstream repository with reproduction, worked figures, consequence, three
    costed correction options for F3, and an acceptance test that changes no existing expected figure.

## Findings (full detail in `audit/FINAL_ACCURATE_LIST_2026-11-11-agent8.md`)

| ID | Sev | Status | Tracked |
|---|---|---|---|
| A8-1111-F1 quarter journey ignores the saved destination | **P1** | verified-defect, **not fixed** (tax lane) | **#627** |
| A8-1111-F2 quarter journey ignores the first-line entity label | **P1** | verified-defect, **not fixed** (tax lane) | **#627** |
| A8-1111-F3 cross-country place/registration inheritance | **P1** (P0 if multi-country testers) | verified-defect, **not fixed** (tax lane) | **#628** |
| A8-1111-F4 probe asserted a superseded contract | P2 | **FIXED in this PR** (my lane) | this PR |
| A8-1111-F5 stale `itemReports.ts` docstring | P3 | reported (AI #1) | findings list |
| A8-1111-F6 `composeFacts` verified-flag false negative | P2 latent | carried, conservative | findings list |

**Closures verified FIXED at this pin:** #517, #518, #519 (in the return), #161, #141, #130, #160.
**Not re-executed:** #143 (Postgres-gated, no local DB — CI is the evidence).

## Tests and gates

`lint:types` 0 errors · `lint:eslint` **0 errors / 42 warnings** (cap unchanged, no baseline raised) ·
`iss161-rule-override-order` **7/7** · `us-sales-tax-return` + `us-quarter-journey` + `tax-profile` + `iss161`
**39/39** · `iss130-stock-revaluation` + `iss130-revalue-dialog` + `iss160-il-vat-equipment` +
`rma-cumulative-capacity` + `date-display` + `pcn874-draft` **19/19** · `aud01-statement-scope` **4/4** ·
probes as above. **Not run and not claimed:** full `npm test`, `npm run test:rules`, RLS, migrations, Playwright —
no Postgres and no Docker in this sandbox.

## Unfinished / next

1. **#627 and #628 are the money lane's.** Monitor both for AI #1's decision; if #628's option 1 is chosen, the
   existing `tax-profile.test.ts` assertions do not move (all are same-country or complete-own-place), so the
   acceptance test is cheap.
2. **Re-run `af004-614-residual.ts` after any fix** and expect all 11 OK with no existing expected figure changed.
3. **AF-006 (restore), AF-007 (report-cache revocation), AF-008 (DB trust/deployments), AF-009 (first hour)**
   remain from the mission's ten cases and are **not started** — the natural next slices. AF-005 (#131) is now
   narrowed to two residuals.
4. **F-49** (my COORDINATION queue item: Vite dependency pre-bundling needs a fresh-browser verification) is still
   open and needs a browser run this sandbox cannot do reliably.
5. The full unit suite has never completed in an Agent #8 sandbox session (stalled or timed out at 30-55 min in
   three separate sessions). That is an environment limit, **not** a claim about the code; CI's four unit shards
   are green at this pin.

## Preservation

- **Committed and pushed** on `arena/a675941f-ledgerflow`; PR opened into `shmuelbiller1/ledgerflow` `main` with
  "Allow edits by maintainers". Never merged by this agent.
- **Google Drive:** project archive folder verified and this checkpoint plus the findings list, scorecard and raw
  probe output uploaded and read back. Locations recorded in `MASTER_RECOVERY_INDEX.md` in the Drive archive.
- **Nothing exists only in this workspace or chat:** every figure in the findings list is reproducible from a
  committed probe at a committed SHA.
