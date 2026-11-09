# Sonar report triage — 9 November 2026

Source: attached `issues.json` (103 findings against the report revision). Line numbers below are from the report, not necessarily current after changes. This is a code review, not a fresh Sonar scan; final issue status requires reanalysis.

## Findings behind the dispositions

- **Fixed in this batch:** invitation validation uses the existing tested linear email-shape helper; log redaction no longer retries the local-part expression from every character; project-command parsing consumes its separator once; unreachable receipt helper removed; source-graph walkers parse syntax trees instead of a backtracking regex and stop mistaking comments for imports. Support tickets, fallback messages, record notes, and custom fields now use cryptographically random identifiers, which reduces collision/overwrite risk; UI writes refuse safely if no secure source exists. Receipt fixture font discovery uses built-in globbing instead of a shell; the PDF test helper scans object headers without retrying a digit run at every character. The atlas SQL-policy and heading scans no longer backtrack across unrelated text, and do not attribute a later statement or line to a malformed one. Loop counter updates were rewritten without changing their skipping behavior. CI installs no longer execute dependency lifecycle scripts and Playwright is invoked from the lockfile installation; the ratchet action is pinned and its triggering repository is checked. Small convention/precedence findings were addressed too.

- **Preserve:** the 17 focusable regions are scroll regions except the keyboard grid, whose focus is intentional for its key handler. Removing `tabIndex` would break keyboard access. The 11 `| 0` findings implement 32-bit hash/PRNG wraparound, not merely truncation; `Math.trunc` is not equivalent. The migration already uses `IS NULL` and quoted camel-case PostgreSQL table names require quotes. The two test files register tests through `describeSaveFailures`; the test helper default object is newly created per call. The PostgreSQL passwords are credentials for ephemeral CI test services, not deployed secrets.

- **Further review / lead-owned:** `moneyFormat.ts` and the mailer have potentially expensive regexes; changing the former risks money-input semantics and the latter is in the server lane. The payment operation-key fallback and SDK key fallback deserve a compatibility and collision review because they identify non-repeatable writes; do not mechanically replace them without testing supported browsers and Node 18. The server MD5 is used for a cache key, not authentication, but cache-collision risk and migration belong with the server owner. The 10 MB, one-file limit is a bounded authenticated upload, but suitability under concurrency needs an operational assessment. Remaining PDF-test, PATH, archived-script and diagnostic-ID findings need context-specific review; no claim is made that they are all defects.

`IntentResolver.resolveEntry` already refuses lines longer than 500 characters, limiting individual regex inputs; this is mitigation, not a proof of linear runtime. Several other ID fallbacks use `crypto.randomUUID` when available; their legacy fallbacks remain to be assessed separately. The archived maintenance utilities are not CI paths (the llama probe has a CI regression test); the historical llama probe no longer installs packages or uses npx, and requires a preinstalled local package.

## Follow-up queue and review boundaries (9 November)

All 103 report keys are listed exactly once: 24 fixed, 16 hardened, 38 preserved/reviewed, 12 lead review and 13 further review. This is not a promise that all findings are resolved. Dispositions describe code review, not the current Sonar server state. Prioritize remaining work as follows; do not close a finding merely because it appears below.

1. **Financial/server owner — 12 lead-review entries:** investigate the money-input and mailer regexes with adversarial and behavior-preserving tests; review payment/SDK, petty cash, loans, journal, telemetry and database ID fallbacks in their runtime and write/idempotency contexts; assess the cache-key collision and upload concurrency risks. The owner boundary and earlier handoff in `docs/COORDINATION.md` remain in force.
2. **Parsing — 4 further-review entries:** four intent-entry regexes have a 500-character *per-line* limit, but that does not prove linear runtime or bound the number of lines; preserve the fallback and financial parsing semantics if changed. The PDF test helper now scans content operators without retrying long malformed arrays; tests compare the previous grammar on 5,000 mixed streams and exercise a 200,000-character malformed input.

   **Diagnostic IDs — hardened, not fully resolved:** client references now use Web Crypto. If unavailable, telemetry is still sent with no client ID and adopts the server response when present; local diagnostics remain available even when no ID is returned. The server's existing non-cryptographic fallback remains a separate lead-owned finding and can still collide, so end-to-end collision resistance is not claimed.
3. **Executable lookup — 9 further-review entries:** receipt generation invokes ImageMagick `convert`; the atlas invokes `git` and `tar`; six archived fixers invoke `find`, `grep`, or `npx eslint` via a shell. These commands rely on a trusted PATH and, for the archived fixers, a trusted checkout; do not run them in an untrusted environment. The arguments are not evidence that an untrusted user can inject shell commands; removing PATH dependence requires a portable executable policy, not a hard-coded OS-specific path.

The archived llama probe's two original installation findings are fixed here: it does not install packages, use npx, or write a temporary source file. It only inspects an already installed `llamaindex`, and still relies on a trusted `node` in PATH. Its output depends on the installed package version.

## Inventory

| Report key | Rule | Report location | Disposition |
|---|---|---|---|
| `AaHBG7mDU4jfi3TLilIT` | `typescript:S8786` | `src/components/platform/settings/TeamSettings.tsx:204` | Fixed |
| `AaG_OcT787X69ZD27XB_` | `typescript:S2310` | `src/lib/merchantNames.ts:68` | Fixed |
| `AaG-2VxakSTLYGVB4mx1` | `typescript:S2310` | `src/lib/textShape.ts:302` | Fixed |
| `AaG-X1OfEfX_lmtaK3Jy` | `typescript:S8786` | `src/lib/logRedaction.ts:17` | Fixed |
| `AaGdHvWcy5pDYLc00DnG` | `typescript:S7773` | `e2e/support/keyboardRoundTrip.ts:9` | Fixed |
| `AaGQnPI5E-Km-bl-69bS` | `typescript:S8786` | `src/lib/moneyFormat.ts:165` | Lead review |
| `AaGQnPI5E-Km-bl-69bT` | `typescript:S8786` | `src/lib/moneyFormat.ts:167` | Lead review |
| `AaGKrBy-efMaWPlOl80A` | `typescript:S6845` | `src/components/ledger/TransactionGridKeyboardRegion.tsx:130` | Preserve / reviewed |
| `AaGKrByGefMaWPlOl8z0` | `typescript:S6845` | `src/components/reporting/ReportTableScroll.tsx:108` | Preserve / reviewed |
| `AaGKrB0mefMaWPlOl81E` | `typescript:S6845` | `src/components/finance/TaxManager.tsx:437` | Preserve / reviewed |
| `AaGKrB1befMaWPlOl81c` | `typescript:S6845` | `src/components/projects/ProjectPipeline.tsx:120` | Preserve / reviewed |
| `AaGKrB-YefMaWPlOl83a` | `typescript:S8786` | `scripts/receipt-fixture-eval.ts:37` | Fixed |
| `AaGKrB-YefMaWPlOl83b` | `typescript:S8786` | `scripts/receipt-fixture-eval.ts:38` | Fixed |
| `AaGKrB-AefMaWPlOl83Y` | `javascript:S4036` | `scripts/receipt-fixtures.mjs:91` | Fixed |
| `AaGKrB-AefMaWPlOl83Z` | `javascript:S4036` | `scripts/receipt-fixtures.mjs:472` | Further review |
| `AaGKrB9JefMaWPlOl83M` | `plsql:NullComparison` | `supabase/migrations/20261023010000_repost_queue.sql:49` | Preserve / reviewed |
| `AaGKrB9JefMaWPlOl83N` | `plsql:NullComparison` | `supabase/migrations/20261023010000_repost_queue.sql:49` | Preserve / reviewed |
| `AaGKrB9JefMaWPlOl83O` | `plsql:QuotedIdentifiersCheck` | `supabase/migrations/20261023010000_repost_queue.sql:51` | Preserve / reviewed |
| `AaGKrB-_efMaWPlOl83p` | `githubactions:S6505` | `.github/workflows/ci.yml:198` | Hardened |
| `AaGKrB-_efMaWPlOl83z` | `yaml:S2068` | `.github/workflows/ci.yml:228` | Preserve / reviewed |
| `AaGKrB-_efMaWPlOl83q` | `githubactions:S6505` | `.github/workflows/ci.yml:252` | Hardened |
| `AaGKrB24efMaWPlOl81x` | `typescript:S7737` | `src/tests/helpers/failureHarness.ts:54` | Preserve / reviewed |
| `AaGKrB58efMaWPlOl81_` | `typescript:S2187` | `src/tests/save-failures-books.test.tsx` | Preserve / reviewed |
| `AaGKrB5HefMaWPlOl81-` | `typescript:S2187` | `src/tests/save-failures-sales.test.tsx` | Preserve / reviewed |
| `AaGKrBrmefMaWPlOl8xE` | `typescript:S7767` | `src/lib/sampleBusinessYear.ts:96` | Preserve / reviewed |
| `AaGKrB-aefMaWPlOl83c` | `javascript:S8786` | `scripts/screen-reachability.mjs:38` | Fixed |
| `AaGKrB29efMaWPlOl817` | `typescript:S8786` | `src/tests/helpers/pdfText.ts:87` | Fixed |
| `AaGKrBymefMaWPlOl8z4` | `typescript:S6845` | `src/components/reporting/BudgetActualReportView.tsx:65` | Preserve / reviewed |
| `AaGKrB-_efMaWPlOl83u` | `githubactions:S6505` | `.github/workflows/ci.yml:358` | Hardened |
| `AaGKrB-_efMaWPlOl83v` | `githubactions:S6505` | `.github/workflows/ci.yml:368` | Hardened |
| `AaGKrB-_efMaWPlOl83w` | `githubactions:S8543` | `.github/workflows/ci.yml:368` | Hardened |
| `AaGKrB-2efMaWPlOl83d` | `javascript:S5850` | `scripts/code-atlas.mjs:20` | Fixed |
| `AaGKrB-2efMaWPlOl83e` | `javascript:S4036` | `scripts/code-atlas.mjs:22` | Further review |
| `AaGKrB-2efMaWPlOl83f` | `javascript:S8786` | `scripts/code-atlas.mjs:77` | Fixed |
| `AaGKrB-2efMaWPlOl83g` | `javascript:S8786` | `scripts/code-atlas.mjs:92` | Fixed |
| `AaGKrB-2efMaWPlOl83j` | `javascript:S4036` | `scripts/code-atlas.mjs:271` | Further review |
| `AaGKrBx1efMaWPlOl8zt` | `typescript:S6845` | `src/components/reporting/CustomerTaxCertificatesView.tsx:61` | Preserve / reviewed |
| `AaGKrB_BefMaWPlOl831` | `githubactions:S7631` | `.github/workflows/eslint-warning-ratchet.yml:29` | Hardened |
| `AaGKrB_BefMaWPlOl832` | `githubactions:S6505` | `.github/workflows/eslint-warning-ratchet.yml:38` | Hardened |
| `AaGKrB_BefMaWPlOl833` | `githubactions:S7637` | `.github/workflows/eslint-warning-ratchet.yml:48` | Hardened |
| `AaGKrB1GefMaWPlOl81P` | `typescript:S2245` | `src/components/common/RecordNotesPanel.tsx:58` | Fixed |
| `AaGKrBwYefMaWPlOl8zC` | `typescript:S2245` | `src/components/platform/settings/CustomFieldsSettings.tsx:39` | Fixed |
| `AaGKrBwDefMaWPlOl8yz` | `typescript:S2245` | `src/lib/serverAction.ts:82` | Lead review |
| `AaGKrB98efMaWPlOl83X` | `shell:S7688` | `scripts/line-count.sh:17` | Fixed |
| `AaGKrBykefMaWPlOl8z3` | `typescript:S6845` | `src/components/reporting/VendorWithholdingView.tsx:46` | Preserve / reviewed |
| `AaGKrByHefMaWPlOl8z1` | `typescript:S6845` | `src/components/reporting/VendorTaxRecordsView.tsx:39` | Preserve / reviewed |
| `AaGKrB_CefMaWPlOl835` | `githubactions:S6505` | `.github/workflows/visual-baselines.yml:23` | Hardened |
| `AaGKrB2WefMaWPlOl81s` | `typescript:S6845` | `src/components/charts/AccountIcicle.tsx:22` | Preserve / reviewed |
| `AaGKrB2WefMaWPlOl81t` | `typescript:S6845` | `src/components/charts/AccountIcicle.tsx:24` | Preserve / reviewed |
| `AaGKrBzzefMaWPlOl80i` | `typescript:S6845` | `src/components/inventory/ConsignmentStockPanel.tsx:34` | Preserve / reviewed |
| `AaGKrBy0efMaWPlOl8z8` | `typescript:S6845` | `src/components/ledger/StatementColumns.tsx:290` | Preserve / reviewed |
| `AaGKrBy4efMaWPlOl8z9` | `typescript:S6845` | `src/components/ledger/WorkpapersPanel.tsx:129` | Preserve / reviewed |
| `AaGKrB_HefMaWPlOl84A` | `typescript:S2245` | `sdk/ledgerflowClient.ts:48` | Lead review |
| `AaGKrB0MefMaWPlOl80y` | `typescript:S6845` | `src/components/sales/CustomerPortalPage.tsx:154` | Preserve / reviewed |
| `AaGKrB0UefMaWPlOl800` | `typescript:S2245` | `src/components/finance/PettyCashView.tsx:77` | Lead review |
| `AaGKrB0UefMaWPlOl802` | `typescript:S6845` | `src/components/finance/PettyCashView.tsx:407` | Preserve / reviewed |
| `AaGKrBw5efMaWPlOl8zN` | `typescript:S6845` | `src/components/platform/settings/RulesSettingsView.tsx:231` | Preserve / reviewed |
| `AaGKrBzNefMaWPlOl80K` | `typescript:S6845` | `src/components/ledger/CloseComparisonPanel.tsx:50` | Preserve / reviewed |
| `AaGKrB0iefMaWPlOl81A` | `typescript:S2245` | `src/components/finance/LoansView.tsx:92` | Lead review |
| `AaGKrB-_efMaWPlOl83y` | `yaml:S2068` | `.github/workflows/ci.yml:109` | Preserve / reviewed |
| `AaGKrB-_efMaWPlOl83o` | `githubactions:S6505` | `.github/workflows/ci.yml:133` | Hardened |
| `AaGKrBvCefMaWPlOl8ya` | `typescript:S8786` | `src/lib/intentResolver.ts:229` | Further review |
| `AaGKrBvCefMaWPlOl8yb` | `typescript:S8786` | `src/lib/intentResolver.ts:230` | Further review |
| `AaGKrB29efMaWPlOl810` | `typescript:S8786` | `src/tests/helpers/pdfText.ts:15` | Fixed |
| `AaGKrBvCefMaWPlOl8yY` | `typescript:S8786` | `src/lib/intentResolver.ts:188` | Further review |
| `AaGKrBvCefMaWPlOl8yZ` | `typescript:S8786` | `src/lib/intentResolver.ts:198` | Further review |
| `AaGKrB6LefMaWPlOl82E` | `typescript:S2245` | `src/server/routes/telemetryRoutes.ts:22` | Lead review |
| `AaGKrBqkefMaWPlOl8wu` | `typescript:S7767` | `src/lib/algorithmInternals/optimization.ts:130` | Preserve / reviewed |
| `AaGKrBqkefMaWPlOl8wv` | `typescript:S7767` | `src/lib/algorithmInternals/optimization.ts:135` | Preserve / reviewed |
| `AaGKrBqkefMaWPlOl8ww` | `typescript:S7767` | `src/lib/algorithmInternals/optimization.ts:139` | Preserve / reviewed |
| `AaGKrBqkefMaWPlOl8wx` | `typescript:S7767` | `src/lib/algorithmInternals/optimization.ts:144` | Preserve / reviewed |
| `AaGKrBqkefMaWPlOl8wy` | `typescript:S7767` | `src/lib/algorithmInternals/optimization.ts:148` | Preserve / reviewed |
| `AaGKrBqkefMaWPlOl8wz` | `typescript:S7767` | `src/lib/algorithmInternals/optimization.ts:152` | Preserve / reviewed |
| `AaGKrBqkefMaWPlOl8w0` | `typescript:S7767` | `src/lib/algorithmInternals/optimization.ts:260` | Preserve / reviewed |
| `AaGKrBqgefMaWPlOl8ws` | `typescript:S7767` | `src/lib/algorithmInternals/similarity.ts:306` | Preserve / reviewed |
| `AaGKrBqgefMaWPlOl8wt` | `typescript:S7767` | `src/lib/algorithmInternals/similarity.ts:362` | Preserve / reviewed |
| `AaGKrB73efMaWPlOl82t` | `typescript:S5693` | `src/server/http/serverKit.ts:58` | Lead review |
| `AaGKrB6nefMaWPlOl82R` | `typescript:S4790` | `src/server/routes/externalDataRoutes.ts:38` | Lead review |
| `AaGKrB7QefMaWPlOl82g` | `typescript:S8786` | `src/server/services/mailer.ts:54` | Lead review |
| `AaGKrB-_efMaWPlOl83x` | `yaml:S2068` | `.github/workflows/ci.yml:33` | Preserve / reviewed |
| `AaGKrB-_efMaWPlOl830` | `yaml:S2068` | `.github/workflows/ci.yml:280` | Preserve / reviewed |
| `AaGKrB7_efMaWPlOl82w` | `typescript:S2245` | `src/server/db/pgFirestore.ts:561` | Lead review |
| `AaGKrB-6efMaWPlOl83l` | `typescript:S8786` | `scripts/quality-metrics.ts:87` | Fixed |
| `AaGKrBy8efMaWPlOl8z-` | `typescript:S2245` | `src/components/ledger/JournalEntryModal.tsx:316` | Lead review |
| `AaGKrB2PefMaWPlOl81p` | `typescript:S2245` | `src/components/support/SupportView.tsx:166` | Fixed |
| `AaGKrB2PefMaWPlOl81q` | `typescript:S2245` | `src/components/support/SupportView.tsx:220` | Fixed |
| `AaGKrB-_efMaWPlOl83r` | `githubactions:S6505` | `.github/workflows/ci.yml:306` | Hardened |
| `AaGKrB-_efMaWPlOl83s` | `githubactions:S6505` | `.github/workflows/ci.yml:313` | Hardened |
| `AaGKrB-_efMaWPlOl83t` | `githubactions:S8543` | `.github/workflows/ci.yml:313` | Hardened |
| `AaGKrBpeefMaWPlOl8wA` | `typescript:S7767` | `src/lib/algorithms/isolation-forest-algo.ts:10` | Preserve / reviewed |
| `AaGKrB-_efMaWPlOl83m` | `githubactions:S6505` | `.github/workflows/ci.yml:57` | Hardened |
| `AaGKrBwRefMaWPlOl8y_` | `typescript:S2245` | `src/lib/errorTracker.ts:115` | Hardened |
| `AaGKrB2PefMaWPlOl81o` | `typescript:S2245` | `src/components/support/SupportView.tsx:118` | Fixed |
| `AaGKrB-_efMaWPlOl83n` | `githubactions:S6505` | `.github/workflows/ci.yml:64` | Hardened |
| `AaGKrB9uefMaWPlOl83R` | `javascript:S4036` | `archive/fix_eslint.cjs:4` | Further review |
| `AaGKrB9xefMaWPlOl83T` | `javascript:S4036` | `archive/fix_aria.cjs:4` | Further review |
| `AaGKrB9zefMaWPlOl83U` | `javascript:S4036` | `archive/fix_aria2.cjs:4` | Further review |
| `AaGKrB9zefMaWPlOl83V` | `javascript:S4036` | `archive/fix_div_onclick.cjs:4` | Further review |
| `AaGKrB9wefMaWPlOl83S` | `javascript:S4036` | `archive/fix_form_buttons.cjs:4` | Further review |
| `AaGKrB90efMaWPlOl83W` | `javascript:S4036` | `archive/fix_imports2.cjs:4` | Further review |
| `AaGKrB9qefMaWPlOl83P` | `shell:S6505` | `archive/test-llama-wait.sh:1` | Fixed |
| `AaGKrB9qefMaWPlOl83Q` | `shell:S6505` | `archive/test-llama-wait.sh:7` | Fixed |
| `AaGKrBqFefMaWPlOl8wN` | `typescript:S8786` | `src/lib/algorithms/nl-parser.ts:30` | Fixed |
