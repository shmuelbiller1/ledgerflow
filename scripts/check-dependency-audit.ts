/**
 * S-24 — Production dependency vulnerability audit gate.
 *
 * Runs `npm audit --omit=dev --json` (read-only) and fails with exit code 1 if
 * any High or Critical vulnerability exists in production dependencies. Lower
 * severities (Moderate/Low) are printed for review without blocking unless
 * `--fail-on=moderate` or `--fail-on=low` is passed. Pass `--include-dev` to
 * inspect development/tooling advisories alongside the runtime gate.
 *
 * Usage:
 *   npx tsx scripts/check-dependency-audit.ts
 *   npx tsx scripts/check-dependency-audit.ts --allowlist=security-audit-allowlist.json
 *   npx tsx scripts/check-dependency-audit.ts --fail-on=moderate
 *   npx tsx scripts/check-dependency-audit.ts --include-dev
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export type AuditSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

export interface AuditAllowlistEntry {
  package: string;
  ghsa: string;
  reason: string;
  expiresOn: string;
}

export interface VulnerabilitySummary {
  name: string;
  severity: AuditSeverity;
  isDirect: boolean;
  fixAvailable: boolean;
  advisories: string[];
  ghsaIds: string[];
}

export interface AuditGateResult {
  passed: boolean;
  threshold: Exclude<AuditSeverity, 'info'>;
  scope: 'production' | 'all';
  counts: Record<AuditSeverity, number>;
  blocking: VulnerabilitySummary[];
  allowlisted: VulnerabilitySummary[];
  nonBlocking: VulnerabilitySummary[];
}

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function normalizeSeverity(raw: unknown): AuditSeverity {
  const s = String(raw || '').toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'moderate' || s === 'low' || s === 'info') {
    return s;
  }
  return 'high'; // Unknown severity fails closed.
}

function extractAdvisoryInfo(via: unknown): { labels: string[]; ghsaIds: string[] } {
  if (!Array.isArray(via)) return { labels: [], ghsaIds: [] };
  const labels: string[] = [];
  const ghsaIds: string[] = [];
  for (const item of via) {
    if (typeof item === 'string') {
      labels.push(`via:${item}`);
    } else if (item && typeof item === 'object') {
      const rec = item as { title?: unknown; url?: unknown };
      const url = typeof rec.url === 'string' ? rec.url : '';
      const ghsa = url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0];
      if (ghsa) ghsaIds.push(ghsa);
      const title = typeof rec.title === 'string' ? rec.title : 'advisory';
      labels.push(ghsa ? `${ghsa} (${title})` : title);
    }
  }
  return { labels, ghsaIds };
}

export function parseAuditAllowlist(rawJson: string, todayIso = new Date().toISOString().slice(0, 10)): AuditAllowlistEntry[] {
  const parsed = JSON.parse(rawJson) as { allow?: unknown };
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.allow)) {
    throw new Error('Allowlist JSON must contain an `allow` array.');
  }
  const active: AuditAllowlistEntry[] = [];
  for (const raw of parsed.allow) {
    if (!raw || typeof raw !== 'object') throw new Error('Allowlist entry must be an object.');
    const entry = raw as Record<string, unknown>;
    const pkg = String(entry.package || '').trim();
    const ghsa = String(entry.ghsa || '').trim();
    const reason = String(entry.reason || '').trim();
    const expiresOn = String(entry.expiresOn || '').trim();
    if (!pkg || !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(ghsa) || reason.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      throw new Error(`Invalid allowlist entry for "${pkg || '(missing)'}": require package, GHSA id, reason (>=10 chars), and YYYY-MM-DD expiresOn.`);
    }
    if (expiresOn >= todayIso) {
      active.push({ package: pkg, ghsa, reason, expiresOn });
    }
  }
  return active;
}

export function evaluateNpmAudit(
  rawJson: string,
  options: {
    failOn?: Exclude<AuditSeverity, 'info'>;
    scope?: 'production' | 'all';
    allowlist?: AuditAllowlistEntry[];
  } = {},
): AuditGateResult {
  const threshold = options.failOn || 'high';
  const scope = options.scope || 'production';
  const allowlist = options.allowlist || [];
  if (!rawJson || !rawJson.trim()) {
    throw new Error('npm audit returned empty output.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`Could not parse npm audit JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('npm audit JSON is not an object.');
  }
  const doc = parsed as {
    error?: { code?: unknown; summary?: unknown };
    vulnerabilities?: Record<string, { severity?: unknown; isDirect?: unknown; fixAvailable?: unknown; via?: unknown }>;
    metadata?: { vulnerabilities?: Partial<Record<AuditSeverity, number>> };
  };
  if (doc.error) {
    throw new Error(`npm audit reported an error (${String(doc.error.code || 'UNKNOWN')}): ${String(doc.error.summary || 'no summary')}`);
  }
  if (!doc.vulnerabilities || typeof doc.vulnerabilities !== 'object') {
    throw new Error('npm audit JSON missing `vulnerabilities` map.');
  }

  const counts: Record<AuditSeverity, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const blocking: VulnerabilitySummary[] = [];
  const allowlisted: VulnerabilitySummary[] = [];
  const nonBlocking: VulnerabilitySummary[] = [];
  const minRank = SEVERITY_RANK[threshold];

  for (const [pkgName, entry] of Object.entries(doc.vulnerabilities)) {
    if (!entry || typeof entry !== 'object') continue;
    const severity = normalizeSeverity(entry.severity);
    counts[severity] += 1;
    const { labels, ghsaIds } = extractAdvisoryInfo(entry.via);
    const summary: VulnerabilitySummary = {
      name: pkgName,
      severity,
      isDirect: Boolean(entry.isDirect),
      fixAvailable: Boolean(entry.fixAvailable),
      advisories: labels,
      ghsaIds,
    };
    const isCoveredByAllowlist =
      ghsaIds.length > 0
      && ghsaIds.every(id => allowlist.some(a => a.package === pkgName && a.ghsa.toLowerCase() === id.toLowerCase()));
    if (SEVERITY_RANK[severity] >= minRank) {
      if (isCoveredByAllowlist) {
        allowlisted.push(summary);
      } else {
        blocking.push(summary);
      }
    } else if (severity !== 'info') {
      nonBlocking.push(summary);
    }
  }

  // Respect metadata counts if higher (e.g. npm metadata rollup with empty entries).
  const metaVulns = doc.metadata?.vulnerabilities;
  if (metaVulns && typeof metaVulns === 'object') {
    for (const sev of Object.keys(counts) as AuditSeverity[]) {
      const n = Number(metaVulns[sev] ?? 0);
      if (Number.isFinite(n) && n > counts[sev]) {
        counts[sev] = n;
        if (SEVERITY_RANK[sev] >= minRank && blocking.length === 0 && allowlisted.length === 0) {
          blocking.push({
            name: `(metadata:${sev})`,
            severity: sev,
            isDirect: false,
            fixAvailable: false,
            advisories: [`${n} ${sev} vulnerability count reported in metadata`],
            ghsaIds: [],
          });
        }
      }
    }
  }

  blocking.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name));
  allowlisted.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name));
  nonBlocking.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.name.localeCompare(b.name));

  return {
    passed: blocking.length === 0,
    threshold,
    scope,
    counts,
    blocking,
    allowlisted,
    nonBlocking,
  };
}

function parseFailOnArg(argv: string[]): Exclude<AuditSeverity, 'info'> {
  const flag = argv.find(arg => arg.startsWith('--fail-on='));
  if (!flag) return 'high';
  const value = flag.slice('--fail-on='.length).toLowerCase();
  if (value === 'low' || value === 'moderate' || value === 'high' || value === 'critical') {
    return value;
  }
  throw new Error(`Invalid --fail-on value "${value}" (expected low, moderate, high, or critical).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const includeDev = argv.includes('--include-dev');
  const failOn = parseFailOnArg(argv);
  const allowlistArg = argv.find(a => a.startsWith('--allowlist='))?.slice('--allowlist='.length)
    || (fs.existsSync('security-audit-allowlist.json') ? 'security-audit-allowlist.json' : undefined);
  const allowlist = allowlistArg ? parseAuditAllowlist(fs.readFileSync(allowlistArg, 'utf8')) : [];
  const args = includeDev ? ['audit', '--json'] : ['audit', '--omit=dev', '--json'];
  const proc = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (proc.error) {
    console.error(`FAIL — Could not invoke npm audit: ${proc.error.message}`);
    process.exit(1);
  }
  const result = evaluateNpmAudit(proc.stdout, {
    failOn,
    scope: includeDev ? 'all' : 'production',
    allowlist,
  });
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} — Dependency audit (${result.scope}, fail-on >= ${result.threshold}): `
    + `critical=${result.counts.critical}, high=${result.counts.high}, `
    + `moderate=${result.counts.moderate}, low=${result.counts.low}, info=${result.counts.info}`
    + (result.allowlisted.length ? ` (allowlisted=${result.allowlisted.length})` : ''),
  );
  for (const item of result.blocking) {
    console.error(
      `  BLOCK [${item.severity.toUpperCase()}] ${item.name}`
      + `${item.isDirect ? ' (direct)' : ' (transitive)'}`
      + `${item.fixAvailable ? ' [fix available]' : ''}`
      + (item.advisories.length ? ` — ${item.advisories.join('; ')}` : ''),
    );
  }
  for (const item of result.nonBlocking) {
    console.log(
      `  WARN  [${item.severity.toUpperCase()}] ${item.name}`
      + (item.advisories.length ? ` — ${item.advisories.join('; ')}` : ''),
    );
  }
  if (!result.passed) {
    process.exitCode = 1;
  }
}
