# SonarCloud automatic code analysis + LedgerFlow coverage

**Chosen integration: SonarCloud Automatic Analysis.** SonarCloud reads this GitHub repository directly and publishes code-quality/security findings and a Quality Gate for new pull requests and commits to the default branch. There is deliberately **no SonarScanner step in GitHub Actions**.

## Why there is no GitHub Sonar scanner

SonarCloud rejects CI-based analysis when Automatic Analysis is enabled on the same project. The former separate `sonarcloud` job therefore failed even after downloading coverage artifacts and authenticating with GitHub OIDC. It was removed in favor of the owner's preferred automatic scan.

The SonarCloud project `shmuelbiller1_ledgerflow` should retain **Automatic Analysis ON** under its Analysis Method setting. Do not add SonarSource's sample GitHub Actions scanner or a second analysis method unless the owner explicitly decides to switch.

## Coverage stays required inside GitHub CI

SonarCloud Automatic Analysis **does not import LCOV test coverage**. This is a limitation of SonarCloud's automatic mode, **not a loss of tests** in LedgerFlow:

- Four unit-test shards still generate `coverage/shard-1.lcov` through `coverage/shard-4.lcov` in `.github/workflows/ci.yml`.
- The required `Accounting & Security Test Suites (coverage gate)` job still downloads and merges the reports.
- `npm run coverage:gate` still requires **75% lines, 72% branches, and 73% functions**. No thresholds, tests, or security checks were disabled.
- Coverage is measured and enforced by GitHub, but will **not** appear as measured coverage within SonarCloud automatic-analysis results. Do not mistake a missing/0.0% SonarCloud metric for 0% actual test coverage.

## Other CI failures are independent

The `npm audit --audit-level=high` dependency security audit is still part of the `Lint, Typecheck, and Database rules` job. A vulnerable dependency can continue to make the overall GitHub CI workflow red. Do not disable the audit to conceal advisories. The SonarCloud analysis-method conflict and dependency advisories require different fixes.

## If switching back to CI-based Sonar coverage later

First disable SonarCloud Automatic Analysis in the project, then add a SonarScanner job that downloads the four existing LCOV files, with `sonar.javascript.lcov.reportPaths` configured. Keep it independent of the required accounting coverage gate. Do not run both analysis methods concurrently.

References:
- https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/overview-of-integrated-cis
- https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/overview
