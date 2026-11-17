# SonarCloud coverage — GitHub Actions setup

LedgerFlow **already records unit-test coverage** in CI. No additional test runner, duplication of the test suite, or changes to the existing coverage thresholds are needed.

## What the code does

- `package.json` runs four unit shards using `test:shard:cov`. Each creates `coverage/shard-N.lcov`.
- `.github/workflows/ci.yml` uploads each report and the `unit_gate` job downloads all four, requiring four files and running `npm run coverage:gate` (75% lines, 72% branches, 73% functions).
- After this existing gate passes, the same `unit_gate` job calls SonarQube Cloud with the **four original LCOV reports**. This avoids running tests twice. SonarCloud's scanner can accept comma-separated LCOV paths via `sonar.javascript.lcov.reportPaths`.
- The analysis runs on pushes to `main` and same-repository PRs, **only if** the GitHub Actions repository secret `SONAR_TOKEN` exists. Fork PRs, docs-only PRs, and absent tokens skip the scan. Missing setup produces an Actions notice rather than a misleading failed accounting test.
- The SonarCloud percentages may differ from the Node coverage gate: SonarCloud's coverage denominator and which source files it counts can differ. Never copy a Node coverage-gate number into SonarCloud as if measured there.

## Required one-time setup by the project owner

1. In [SonarCloud](https://sonarcloud.io/project/overview?id=shmuelbiller1_ledgerflow), confirm the organization key is `shmuelbiller1` (adjust `sonar.organization` in `sonar-project.properties` if your organization has another key).
2. SonarCloud **Project Administration → Analysis Method**: turn **Automatic Analysis OFF** and use the CI-based GitHub Actions method. SonarCloud cannot import external LCOV reports through Automatic Analysis. Do this in coordination with merging the CI configuration so there is no coverage-reporting gap.
3. Generate a SonarCloud token authorized to analyze the LedgerFlow project. Do not put it in a committed file or paste it into issue/PR comments.
4. GitHub repository **Settings → Secrets and variables → Actions → New repository secret**: name `SONAR_TOKEN`, and paste the token there. (GitHub repository access is required.)
5. Merge the reviewed PR. On the next full CI run on `main`, open the `Accounting & Security Test Suites (coverage gate)` job. Check `Collect the coverage of the four parts`, `Coverage gate (all parts merged)`, and `Send existing LCOV coverage to SonarCloud` in order.
6. In SonarCloud, verify **both overall and new-code coverage** show measured values. Check scanner logs if a source path is not matched; do not suppress uncovered production code merely to improve the percentage.

If the SonarCloud secret is not set, the existing unit coverage gate still works, but SonarCloud will remain without uploaded coverage. The PR's own CI cannot establish a successful SonarCloud upload until the secret and analysis method are configured.

## Notes

- No `sonar.coverage.exclusions` are added, and the existing production source scope is not intentionally reduced to inflate coverage.
- If a fork PR needs SonarCloud PR decoration, it requires a separately designed secure workflow; do not expose the token to untrusted fork code.
- The existing CI remains the gate for money, data, security and release readiness; a high coverage percentage does not prove correct accounting outcomes.
