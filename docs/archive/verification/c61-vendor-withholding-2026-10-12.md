# C-61 vendor withholding by payment month — 12 October 2026

AI #2 Codex, `codex/c61-withholding-report`, initially based on main `363dec0e`.

The report reads posted vendor payments and uses their saved retained amounts and certificate references. Payment-time names remain visible; today's vendor certificate never substitutes for historical evidence. Exact vendor IDs, month and currency determine separate rows. Gross settlement less recorded retained cents gives the vendor amount in payment currency. Foreign-currency bank conversion and statutory filing remain outside this read-only report.

The public optional Payment types now describe withholding fields already persisted by the existing server service; no payment writes, rates, postings or schema changed. Pure helpers receive data only. Missing fields mean no amount recorded, not proof of exemption. Invalid dates/amounts/identity/currency, incompatible foreign withholding and unsafe totals require review and block complete CSV. Missing references on valid retained amounts remain visible.

Complete uncapped workspace payment reads gate CSV. Refused, pending, obsolete workspace responses and edits during/after the read cannot enable export. The dated complete snapshot stays visible; month changes filter its complete history. CSV declares integer minor units and never mixes currencies in a total. Existing vendor drawers edit shared metadata without losing the month or changing the saved payment references.

## Verification

- Fresh frozen-lockfile install: 1121 packages.
- Final targeted: **10/10 tests**, no skips/cancellations, including exact gross/net/retained hand-number and currency fixtures, malformed/overflow boundaries, refusal/retry/in-flight edit and workspace privacy, plus help and quality ratchet. The first quality run caught index-based amount-cell keys; stable semantic field keys corrected it without changing the baseline.
- Final local types, ESLint **212 warnings / zero errors**, client/server build pass.
- Chromium **2/2 pass**: actual downloaded Hebrew CSV contains separate USD/EUR rows and payment-time references; current certificate is absent, nested address editing retains the month, 44px targets, keyboard table scrolling, phone geometry, axe and the actual registered Reports entry pass.
- Full coverage/RLS/time-zone/broader browser gates are delegated to GitHub under the owner's request and remain pending. The new registered report changes P&L/balance-sheet menu screenshots; matching CI-browser reference capture and image review are required, with existing pixel thresholds retained.

This is a publication checkpoint, not an all-green/merged claim. Other AIs' changes and financial expectations are preserved.


## Reviewed visual references

Matching GitHub Chromium capture **38329108738** passed all **40 visual comparisons** after recapturing the eight intentionally changed P&L/balance-sheet menus. Candidate `dd69f6dc` changes those PNGs only. Inspected desktop/phone light/dark menus and compared report bodies to main: **$3,000** balanced assets/equity and P&L **$15,000** revenue, **$12,000** expenses, **$3,000** surplus remain unchanged. Imported only the reviewed images and removed the temporary capture workflow. Strict pixel allowances, financial expectations and full test selection remain intact. Existing PR #87 will run complete CI on this final reviewed head; no merge/all-green claim yet.
