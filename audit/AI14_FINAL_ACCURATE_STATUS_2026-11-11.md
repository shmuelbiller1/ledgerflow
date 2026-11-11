# AI #14 — accurate status and remaining work

**Status checked:** 11 November 2026 (UTC)\
**Pinned repository revision:** `75ea3fa62e28c746b7c5d54f161a931409f11854` (`main`, merge commit for PR #649)\
**Scope:** the AI #14 ease-of-use queue in `docs/COORDINATION.md`, not an audit of every LedgerFlow workflow or every form in the product.

## What is complete and merged

| Queue item | Evidence | Status |
|---|---|---|
| EU-D1 phone bottom bar; EU-B1 New menu and shortcuts; EU-B2 shorter invoice/bill forms | PR #626, merged | Complete per queue. |
| EU-E1 Labels wording; EU-B4 party/item defaults; EU-A2 business-first setup | PR #632, merged | Complete per queue; lead review fixes retained. |
| EU-F1 business-aware navigation, Pro recommendations, searchable Show all tools | PR #638, merged | Complete per assigned queue scope. The separate proposal to show disabled modules as global-search “turn on” results is explicitly not included; see `docs/verification/ai14-eu-f1-2026-11-11.md`. |
| EU-A1 guest sample company | PR #649, merged | **Implementation merged; acceptance criterion remains incomplete. Do not tick EU-A1.** The queue requires every relevant form to save locally. Blocking a server-only request, disabling an action, or observing a network guard is not a local save. |

## EU-A1: exactly what is and is not established

Evidence: [`docs/verification/ai14-eu-a1-2026-11-10.md`](../docs/verification/ai14-eu-a1-2026-11-10.md). At the reviewed merge, the guest demo has a browser-only sample-year copy, refresh/exit isolation, a sample banner, and verified invoice/bill create-and-refresh flows at 390/1280px. Several other local forms/settings and metadata paths also persist locally. These verified journeys do **not** establish “every form saves locally.”

Still open: payments and allocations; journal-entry and bank/reconciliation actions; transaction and other imports; remaining API/server-only forms; attachments (explicitly unavailable); and a complete audit of non-fetch/XHR transports and deferred work across exit/sign-in. Safe refusals are accurate safety behavior, not saves. Reusing payment allocation behavior needs AI #1's financial-lane review; do not duplicate posting logic or import server code into a browser adapter. The sample network fence is defense in depth, not proof that all transports or effects have been audited.

### PR #649 final GitHub verification

- PR #649 is **merged** at `75ea3fa62e28c746b7c5d54f161a931409f11854` (11 Nov, 21:55 UTC).
- All 19 CI jobs passed: lint/typecheck/database rules; production build; four unit shards; six timezone shards; five browser shards; coverage gate; and Playwright smoke. CodeQL, SBOM and SonarCloud also passed.
- Vercel alone reports failure with a `build-rate-limit` URL. This matches the owner’s stated preview-usage restriction; report it separately, not as a code CI failure or a passing preview.
- GitHub reports 10 review threads and all 10 are resolved. CodeRabbit's final status is skipped after merge; that is not a new post-merge review. The thread resolutions and passing final-head checks are verified independently here.
- The CI results establish checks on the merged revision; they do **not** expand the product acceptance scope above.

## Remaining items from the supplied AI #14 list

Every item below remains open unless explicitly noted otherwise. No implementation or test completion is claimed by this status report.

| Area | Open items |
|---|---|
| Hebrew and phone receipts | **EU-G1** Hebrew screen translations (one screen per PR, Sales first); **EU-C4** phone receipt capture and draft attachment. |
| Labels | **EU-E2** bulk label assignment and undo; **EU-E4** truthful report label filters; **EU-E5** label-aware budgets; **EU-E3** parent/child labels and reviewed migration; **EU-E6** label-value detail page; **EU-E8** promoted pivot; **EU-E9** label-aware import/API/export. |
| Everyday speed | **EU-B6** confirmed natural-language entry with workspace currency and safe account selection; **EU-B3** recoverable form drafts; **EU-B5** undo for reversible actions; **EU-F2** plain-language names. |
| Bank review/reconciliation | **EU-C1** explainable match reasons; **EU-C2** keyboard review; **EU-C3** rule creation during review; **EU-C5** reconciliation summary. |
| Onboarding, phone, reports, safety | **EU-A3** self-ticking checklist (coordinate with AI #12 N-1); **EU-A4** importers on setup; **EU-D2** three phone jobs (receipt journey depends on EU-C4); **EU-F3** findable/starred/scheduled reports; **EU-H2** read-only safety card. |
| Later queue | **EU-A4b** additional market importers; **EU-I1** accountant invite/books view (not pricing); **EU-I3** public invoice maker; **EU-I2** customer-portal branding setting (not pricing). |

This is the supplied backlog, not a statement that these are the only product defects or launch gates. For full launch readiness, use `docs/RELEASE_GATE.md` and its per-workflow evidence rather than this task list.

## Next action and limitations

Per the AI #14 queue order, EU-G1 is next after EU-A1's incomplete handoff; it must be done screen-by-screen, starting with Sales, with browser reproduction and an untranslated-string regression guard. This session made **no application-code, financial, server, database, or workflow change** and ran no local test suite. The repository checkout has no `node_modules`; only the merged PR's GitHub checks are reported above. No new PR is associated with the current branch.
