# Agent #7 — 2026-11-19 — Handoff and recovery

## 1. Where the work lives

| Item | Repository path / ref | Verified Drive file (opened after upload) |
|---|---|---|
| Fix + regression | `src/components/ledger/TransactionGridView.tsx`, `src/tests/journal-link-editor-lifecycle.test.tsx` on `arena/6540fb3d-ledgerflow` | [Recovery patch `1MQ4qJvr9awS6fc8DK9Tup7iETdDD6-i3`](https://drive.google.com/file/d/1MQ4qJvr9awS6fc8DK9Tup7iETdDD6-i3/view) · `05 Code Changes and Recovery Patches` |
| Instruction sources / conflicts | `audit/agent7-2026-11-19/01-INSTRUCTION-SOURCES-AND-BASELINE.md` | [`1PI-pjslFeWCrFZ_TXlVx537aUywJbVn5`](https://drive.google.com/file/d/1PI-pjslFeWCrFZ_TXlVx537aUywJbVn5/view) · `08 Instructions and Agent Messages` |
| Checkpoint 01 + red/green transcript | `audit/agent7-2026-11-19/02-CHECKPOINT-01-FIX-AND-REVERIFICATION.md` | [`1kYdtpECv84HVnd47pwW7cRcNZ1A8Pdie`](https://drive.google.com/file/d/1kYdtpECv84HVnd47pwW7cRcNZ1A8Pdie/view) · `03 Progress Checkpoints` |
| Findings register | `audit/agent7-2026-11-19/03-FINDINGS-REGISTER.md` | [`1o6h63pHujAHL1wSIwBqDS2NsNKW-nw4B`](https://drive.google.com/file/d/1o6h63pHujAHL1wSIwBqDS2NsNKW-nw4B/view) · `04 Accounting Findings` |
| This handoff | `audit/agent7-2026-11-19/04-HANDOFF-AND-RECOVERY.md` | [`1r7MAP1o3hy_ukwUQ3Up8-YOEX8cc6bDT`](https://drive.google.com/file/d/1r7MAP1o3hy_ukwUQ3Up8-YOEX8cc6bDT/view) · `10 Recovery and Handoff` |
| PR #882 final disposition | `audit/agent7-2026-11-19/05-PR882-FINAL-DISPOSITION.md` | [`1_XwVYgtcuCWcHl6eXz2lRpm5-lUBqfpX`](https://drive.google.com/file/d/1_XwVYgtcuCWcHl6eXz2lRpm5-lUBqfpX/view) · `07 Pull Requests and Reviews` |
| PR #917 body | `audit/agent7-2026-11-19/PR-BODY.md` | [`1gd5JkkXDmnuZFMaJKLxUFumpXNLI4zdY`](https://drive.google.com/file/d/1gd5JkkXDmnuZFMaJKLxUFumpXNLI4zdY/view) · `07 Pull Requests and Reviews` |
| Focused test/type/lint/layers log | `audit/agent7-2026-11-19/evidence/VERIFICATION-LOG.txt` | [`1CuwKRwfKyKsyuWrcmJTZkEt0E-upcDWC`](https://drive.google.com/file/d/1CuwKRwfKyKsyuWrcmJTZkEt0E-upcDWC/view) · `06 Testing and CI` |
| Dated recovery index addendum | `audit/agent7-2026-11-19/06-MASTER-RECOVERY-INDEX-ADDENDUM.md` | [`1k_Pj7XCV74lKS1BGCcpjp_xkAB0oFB3u`](https://drive.google.com/file/d/1k_Pj7XCV74lKS1BGCcpjp_xkAB0oFB3u/view) · `01 Master Audit` (starred) |

Drive archive root: `https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK`
Canonical index: `https://drive.google.com/file/d/1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F/view`
Prior Agent7 index addendum: `https://drive.google.com/file/d/1E4JHsIa5Nsvz2ATSdv_UHOQkED6jZUl7/view`
Session folder used by earlier Agent7 PR work: `https://drive.google.com/drive/folders/15St3Aqq7LaQDTcqrtv05nvtF8Nu6gpGn`

## 2. Branches, commits, PRs

- Base: upstream `main` **`5eacf71f633f00a5db7ae44d3fdba75b4d3700cf`**.
- This session: `arena/6540fb3d-ledgerflow` (current Arena branch; one commit per completed work item).
- Own earlier PR: **#882** (`arena/6499fd1e-ledgerflow`, head `2460d45`) — open, clean, all checks green, approved by Gitar, Sonar gate passed; no changes made. Shmuel decides merge.
- New PR for #873: **[#917](https://github.com/shmuelbiller1/ledgerflow/pull/917)** (head `cd9df79`). Never merge it yourself.
- Canonical Drive index was not rewritten inline (88 KB shared by many agents): a dated addendum was uploaded and a pointer comment (`doco.zp0vgVNR9AWZuRQcyZZ5Ig`) was added to `MASTER_RECOVERY_INDEX.md` (`1pTGxQhLdqBvH4sLoR-0MZ0XuvKtTP86F`), preserving every prior section byte-for-byte.
- New issues: **#912** (document re-link), **#913** (support ticket visibility).

## 3. Test evidence (exact commands in checkpoint 02)

- New regression red before the fix, green after; 46/46 focused tests with neighbouring suites; type check, scoped ESLint (0 warnings) and layers guard pass.
- Full unit/browser shards and DB tests: CI's job per owner instruction; no local PG/browser image in this sandbox.

## 4. Unfinished work and owners

| Task | Owner | Why not here |
|---|---|---|
| Merge decision on #882 | Shmuel | Owner controls merges; PR is ready and unmerged. |
| Fix #912 (document link) | AI #1 / Shmuel | `src/server/**` + migration are reserved; prior turnkey patch exists. |
| Fix #913 (tickets) + decide owner-wide ticket visibility | AI #1 + Shmuel | RLS policy + product contract; `rls.test.sql` asserts current viewer read on employees. |
| Fix #805/#802/#803 | AI #1 | Already filed; no duplicate work. |
| Integrate #909's prepared bar fix | Owner of #882 / AI #1 | Touches #882's files; patch exists in Drive. |
| Credit-refund FX hypothesis (A7N-02b) | Next audit with live PG | Current code may already be correct; no probe in this sandbox. |
| Live DB verification of #912/#913 | Next runner with PG | Only static policy/command evidence was available here. |

## 5. Recovery instructions

1. Re-clone `shmuelbiller1/ledgerflow` at `5eacf71` and check `git status`.
2. Restore this session's four audit Markdown files and the two code files from the branch (or Drive links above).
3. Run `NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx --test src/tests/journal-link-editor-lifecycle.test.tsx`: it must pass only with `key={editingDetailsTx.id}` at `TransactionGridView.tsx:174`; removing that line must make it fail with entry 1's draft appearing on entry 2.
4. Check PR #882 live; do not assume the hosted result from an earlier head.
5. If this branch is lost, re-open a PR from a new branch off `main` with the same one-line fix and test; the finding ID is #873.

## 6. Drive verification checklist

- [x] Checkpoint 01 uploaded and opened (`read_file_text`, 7,481 bytes).
- [x] Findings register uploaded and opened (`read_file_text`, 5,497 bytes).
- [x] Handoff uploaded and opened (metadata + name verified on upload).
- [x] PR #882 disposition uploaded and opened (`read_file_text`, 1,729 bytes).
- [x] PR #917 body uploaded; recovery patch opened; verification log metadata verified (18,388 bytes).
- [x] Dated MASTER_RECOVERY_INDEX addendum uploaded and opened (4,370 bytes); pointer comment created on the canonical index.

All checks above used `get_file`/`read_file_text` after upload, not just the upload response. The hosted CI result for #917 must be read live from the PR because it was still running when this was written.
