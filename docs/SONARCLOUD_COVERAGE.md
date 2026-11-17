# SonarCloud coverage — secretless GitHub Actions integration

LedgerFlow **already records unit-test coverage** in GitHub Actions. The existing pipeline generates four LCOV reports and checks the minimum thresholds; this configuration sends those same files to SonarCloud without running the tests a second time and **without storing a long-lived token**.

## Existing coverage pipeline

- `package.json` `test:shard:cov` writes `coverage/shard-N.lcov` across four unit-test jobs.
- `.github/workflows/ci.yml` uploads each report and the `unit_gate` job downloads all four. `npm run coverage:gate` still requires 75% lines, 72% branches, and 73% functions.
- After that gate, the job authenticates via `SonarSource/sonarqube-auth-action@v1` using GitHub Actions OIDC and calls `SonarSource/sonarqube-scan-action@v8`. The SonarCloud token is **short-lived and project-scoped** and is provided only to the scanner step.
- `sonar-project.properties` points to the four existing LCOV files. The auth action supplies the repository-bound organization and project keys to the scanner, overriding static settings if needed.

## One-time actions in SonarCloud (owner)

1. Open your LedgerFlow project at https://sonarcloud.io/project/overview?id=shmuelbiller1_ledgerflow. The GitHub repository must be bound to this SonarCloud project.
2. In SonarCloud, enable **Secretless analysis for GitHub Actions** in the organization analysis settings. An organization administrator is needed. The project setup page may surface this switch. No token needs to be generated or stored.
3. Switch **Automatic analysis OFF** and use **CI-based analysis**. This is necessary to ingest external LCOV coverage.
4. Under project type, choose **JS/TS & Web**. The workflow in this PR is the build integration; do not add a competing full analysis job.
5. Review and merge the PR, then inspect the next full GitHub Actions CI run on `main`. In `Accounting & Security Test Suites (coverage gate)`, verify the `Authenticate to SonarCloud` and `Send existing LCOV coverage to SonarCloud` steps succeed.
6. Check **both overall coverage and new-code coverage** in the SonarCloud dashboard. If values are missing, inspect scanner logs for file-path resolution. Do not suppress uncovered production code to raise the percentage.

## Security and behavior

- The `unit_gate` job has `contents: read` and `id-token: write` so GitHub can issue an OIDC identity.
- Authentication and scanning are skipped on PRs from forks, where GitHub does not issue the needed OIDC permission, and on documentation-only PRs.
- The coverage gate still applies to source PRs even if SonarCloud cannot be reached. Once secretless analysis is enabled, a scan failure will make the job fail so a real coverage reporting regression is visible.
- No existing thresholds were lowered, no `sonar.coverage.exclusions` were added, and no extra test run was introduced.
- SonarCloud's coverage percentage may differ from the Node coverage gate because its source scope and executable-line accounting differ. Do not assume they are identical.

Official docs: https://github.com/SonarSource/sonarqube-auth-action
