# Ledgerflow Agent #8 — recovered AF-004 checkpoint

**UTC:** 2026-11-05, approximately 20:39.  
**Branch:** `arena/6984648e-ledgerflow`.  
**Application pin:** upstream `7896cbdcbba520f71614a3445b963b1c88d497bb`; previous session's application pin was `28b90c2e4aa3abcbaeea58208c514820711b24f3`.  
**Latest pushed commit before this checkpoint:** `6ed4f298ea2c80555cb639f06c5a925c8149d38a`.  
**Drive:** [Ledgerflow Agent Backups](https://drive.google.com/drive/folders/1VG4z3otVCVhN2Vmr8jnssok8bIF2J-RK).

## Recovery and integrity

A previous Agent #8 session could not push its commit `5027e4e0415d464f43f09a7273c5cc88de475ffb`. Its [original patch](https://drive.google.com/file/d/1eIlM0hHbS25-s-1ZZhbHZJVvGNS9Bdta/view), [narrative](https://drive.google.com/file/d/1ZHveW0iAU2pOvrrMIvNi6zJige7jKskH/view), [probe](https://drive.google.com/file/d/17c0BOyFUNTo1kwMmKWqffGIPZ3DlVmv9/view), and [observed output](https://drive.google.com/file/d/1DLMTvcdVjCKHf2ltdJ8aM3RBkn4Jkz-5/view) were retrieved through the Drive connector. The exact three original files and original mail-format patch are being committed to this branch; the patch preserves the original commit metadata, but the original unpushed Git commit object is not claimed to be present on GitHub.

| File | MD5 verified against Drive / original patch |
|---|---|
| `audit/function-audit/AF-004-tax-authority.md` | `43531389c08a932f0670c084583c1c72` (Drive metadata) |
| `audit/function-audit/probes/af004-tax-authority-probe.ts` | `f159eddaef4c1cec3f4adca6f8022a54` (Drive metadata) |
| `audit/function-audit/probes/af004-tax-authority-probe.output.txt` | `849728455d7dbc402f489ec1b0452a3d` (Drive metadata) |
| `audit/agent8-2026-11-05-session-2033/AF-004-original-5027e4e0.patch` | `4220f2c592e9ebf2bd54acc38aa46471` (local downloaded bytes; verify against Drive metadata if needed) |

`git apply --reverse --check` on the downloaded original patch succeeds against the recovered files. The older narrative is historical and retains its original severity labels verbatim; it is **not** an independent endorsement of every assumption or of real-user reachability.

## Executed at the current code pin

- Installed the repository's supported Node 24 via `npm exec --yes --package=node@24` (`v24.22.2`, npm `10.9.8`) and ran `HUSKY=0 npm ci --no-audit --no-fund`: exit 0, 1,206 packages installed. Dependencies are local disposable tooling, not the recovery copy.
- `npm exec --yes --package=node@24 -- sh -c 'NODE_ENV=test node --import tsx audit/function-audit/probes/af004-tax-authority-probe.ts'` ran successfully, and its output matched the older saved output byte-for-byte (`diff -u` exit 0). The script prints seven `DEFECT` observations and one control, but deliberately exits 0; it is a synthetic diagnostic, **not** seven independent production failures or a passing acceptance suite.
- The five named source blobs `profile.ts`, `usSalesTaxReturn.ts`, `ilVatReturn.ts`, `usQuarterJourney.ts`, and `facts.ts` are identical between the two application pins. This is a blob comparison, not proof that all callers, deployments or saved data are unchanged.

## Remaining and resume

1. Trace tax-profile editing, real invoice line labels and buyer-place snapshot through the actual report view. Check seller-profile inheritance and omitted/attributed documents with independent hand-number assertions. Report uncertain legal/entity semantics as questions, not facts.
2. Run existing focused tests and, if resources permit, broader checks on Node 24. No DB, RLS, browser or live-deployment proof has yet been run here.
3. Preserve each new finding and diagnostic test on the branch and Drive, verify the remote and read-back, then prepare a review handoff. Financial and server fixes remain with their owners; do not merge.

**Backups so far:** initial [checkpoint 01](https://drive.google.com/file/d/1tXgU0rRfAeW2c5dJkYOrprWEzFikBIN2/view), [checkpoint 02](https://drive.google.com/file/d/1haRWs-2NIV986EJ91YoqC8zNo83RFg_u/view), and [fork daily-count archive](https://drive.google.com/file/d/1vDGx_XguRf0QsEQsrKIdAXEUbSyIVxs1/view) were successfully read back.
