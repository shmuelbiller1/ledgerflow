# C-48 vendor tax-record review — 12 October 2026

AI #2 Codex; `codex/c48-vendor-tax-records`, based on main `48127a36`.

The vendor detail button opens a named review without unmounting the original page; Reports mounts the same screen. It reads existing vendor tax/VAT identifiers, recorded country and withholding rate/reference/expiry. Zero-percent certificates count as recorded. Real-day validation and a 30-calendar-day inclusive window flag expiry. Missing Israeli certificates prompt a check of whether one is required; no new legal obligation is inferred.

Identifier fields are masked on screen and in CSV; short identifiers are fully masked. Original vendor names remain intact. Malformed certificate fields require review without echoing arbitrary raw data into warnings. The canonical model has no signed W-9 receipt or verified EIN/SSN/registration evidence, so this remains a partial C-48 implementation with that handoff recorded in coordination. No guessed fields, payment changes or tax-rate decisions are added.

Complete uncapped workspace reads gate the sole masked CSV action. Refused/pending reads, edits and obsolete user/workspace responses cannot enable export. A dated full snapshot stays visible after edits, and the cache reference is captured at request start to detect changes while the read is in flight. Shared metadata edits use the existing related-record drawer.

## Verification

Final targeted run: 11/11 pass, zero skipped/cancelled, including five vendor cases, quality ratchet and screen-help checks. Masking, zero rates/calendar days/scope, read refusal/retry/stale cache, old-user/sign-out privacy and edits during an in-flight read are covered. Final Chromium: 2/2 pass, including the registered Reports entry. Final local types, ESLint (212 warnings / zero errors) and production build pass. Full coverage, RLS, time-zone suites and broader browsers are delegated to GitHub under the owner's instruction; results are pending, so this is not a ready-to-merge claim. The actual phone fixture parses a downloaded CSV, checks absence of full identifier fields, performs a nested refused/successful address edit, and checks keyboard focus, geometry and axe.

The shared attachment input's visually hidden positioning correction is also included independently, preserving native upload semantics. No financial/server/schema/dependency/quality-baseline changes.


## Reviewed visual references

Matching GitHub Chromium capture **38329077389** passed all **40 visual comparisons** after recapturing the eight P&L/balance-sheet menu references affected by the new vendor report. Candidate `38bf5b2f` changes only those PNGs. Inspected light/dark phone and desktop menus and compared financial bodies with main: original report controls and the **$15,000 / $12,000 / $3,000** P&L figures and **$3,000** balanced assets/equity remain intact. Committed only those inspected references and removed the temporary capture workflow. The strict pixel limits and existing money assertions stay unchanged. Final full GitHub verification is pending in PR #89; signed W-9 evidence remains the documented model prerequisite.
