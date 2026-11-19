Fixes #873.

**One-line call-site fix.** `TransactionEditModal` keeps its form draft in state initialised on mount. `TransactionGridView` rendered it without a React key, so following a journal record link to a different entry while the editor was open showed the previous entry's description and draft. Adding `key={editingDetailsTx.id}` remounts the editor only when the *record* changes.

**No money, posting, server, schema or route change.** No file owned by the open PR #882 is touched; that PR remains independent and ready for Shmuel's decision.

**Red → green.** New `src/tests/journal-link-editor-lifecycle.test.tsx` renders the real grid view + real edit modal with a stubbed view model:

1. open entry 1 and type an unsaved note in its description;
2. re-render the same entry — the unsaved note survives (no needless remount);
3. switch to entry 2 — before the fix the field still read the unsaved note from entry 1, after the fix it shows entry 2's saved description;
4. switch back to entry 1 — its saved description returns.

Before: `+ actual 'Unsaved note on entry 1' - expected 'AWS September Hosting Fee'`. After: 1/1 pass; with seven neighbouring suites, **46/46 pass**.

**Checks run locally:** `tsc --noEmit` clean; ESLint on the two changed files 0 errors / 0 warnings at the existing cap; `check:layers` 4/4. Full unit/browser shards are CI's job per the owner's 18 Nov rule.

**Audit work on this branch:** `audit/agent7-2026-11-19/**` records the instruction sources, the #882 final verification, a re-verification of the older Agent #7 patch queue against `5eacf71` (five high-severity findings are now fixed upstream), and the remaining findings register. Two still-live access defects were filed as [#912](https://github.com/shmuelbiller1/ledgerflow/issues/912) and [#913](https://github.com/shmuelbiller1/ledgerflow/issues/913) instead of adding reserved-lane patches; #805/#802/#803/#909 were already filed and remain with their owners. Nothing here is a release sign-off.
