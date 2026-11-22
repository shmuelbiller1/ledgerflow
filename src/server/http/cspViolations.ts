/**
 * S-23: what the tightened Content-Security-Policy would have blocked.
 *
 * While the tightened policy runs report-only (contentSecurityPolicy.ts, `cspRollout`), browsers
 * post a report for every resource it would have refused. They are kept here — in memory, grouped
 * and capped — and never written to the database:
 *
 * - the endpoint is unauthenticated by nature (a browser cannot sign a violation report), so a
 *   row per report would be a free write amplifier for anyone with curl;
 * - a report is operational evidence for one deployment, not a workspace record, so it has no
 *   workspace to belong to and no row-level security rule that would fit it;
 * - what the decision to enforce actually needs is "which directive, which origin, how often",
 *   which is a counter, not a log.
 *
 * `GET /api/csp-report/summary` (platform admin) reads the groups back.
 */

/** One violation, reduced to the three things that decide whether the policy can be enforced. */
export interface CspViolation {
  /** The directive that would have refused it, e.g. `script-src-elem`. */
  directive: string;
  /** The origin that was refused, or a CSP keyword (`inline`, `eval`, `data`). */
  blockedSource: string;
  /** Path of the page that reported, without query or fragment. */
  documentPath: string;
}

export interface CspViolationGroup extends CspViolation {
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CspViolationSummary {
  /** Reports accepted since the process started, including ones past the group cap. */
  total: number;
  /** Reports that arrived after the cap and were counted but not grouped. */
  dropped: number;
  groups: CspViolationGroup[];
}

/** Enough to see every distinct problem; small enough that nobody can grow it into a leak. */
export const MAX_VIOLATION_GROUPS = 200;
const MAX_FIELD_LENGTH = 120;

/** The keywords a browser reports instead of a URL. Anything else must parse as one. */
const BLOCKED_KEYWORDS = new Set(['inline', 'eval', 'self', 'data', 'blob', 'about', 'wasm-eval', 'unsafe-eval']);

const groups = new Map<string, CspViolationGroup>();
let total = 0;
let dropped = 0;

/** Trims a reported field to a short, printable, single-line token. */
function token(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[^\x20-\x7e]+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, MAX_FIELD_LENGTH) : fallback;
}

/**
 * The blocked URI as `scheme://host` (never the full URL, which carries paths and tokens, and
 * never a substring test: `new URL` is what decides the host, so `https://cdn.plaid.com.evil.test`
 * cannot pass as the CDN).
 */
export function blockedSource(raw: unknown): string {
  const value = token(raw, '');
  if (!value) return 'unknown';
  const keyword = value.toLowerCase().replace(/:$/, '');
  if (BLOCKED_KEYWORDS.has(keyword)) return keyword;
  try {
    const url = new URL(value);
    return url.port ? `${url.protocol}//${url.hostname}:${url.port}` : `${url.protocol}//${url.hostname}`;
  } catch {
    return 'unknown';
  }
}

/** The reporting page's path only: a query string can carry an invite token or an email. */
export function documentPath(raw: unknown): string {
  const value = token(raw, '');
  if (!value) return '/';
  try {
    return new URL(value).pathname.slice(0, MAX_FIELD_LENGTH);
  } catch {
    return value.split(/[?#]/)[0].slice(0, MAX_FIELD_LENGTH) || '/';
  }
}

type ReportBody = Record<string, unknown>;

/** The body a browser posts: `{"csp-report": {…}}` (application/csp-report) or a Reporting API entry. */
function reportFields(body: unknown): ReportBody | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as ReportBody;
  const legacy = record['csp-report'];
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) return legacy as ReportBody;
  // Reporting API: { type: "csp-violation", body: { effectiveDirective, blockedURL, … } }
  const modern = record.body;
  if (record.type === 'csp-violation' && modern && typeof modern === 'object' && !Array.isArray(modern)) {
    return modern as ReportBody;
  }
  return null;
}

/** A violation from one posted report, or null when the body is not a CSP report at all. */
export function parseCspReport(body: unknown): CspViolation | null {
  const fields = reportFields(body);
  if (!fields) return null;
  const directiveRaw = fields['effective-directive'] ?? fields.effectiveDirective
    ?? fields['violated-directive'] ?? fields.violatedDirective;
  const directive = token(directiveRaw, '').split(/\s+/)[0];
  if (!directive || !/^[a-z-]{3,40}$/.test(directive)) return null;
  return {
    directive,
    blockedSource: blockedSource(fields['blocked-uri'] ?? fields.blockedURL ?? fields.blockedUri),
    documentPath: documentPath(fields['document-uri'] ?? fields.documentURL ?? fields.documentUri),
  };
}

/** Counts one violation. Past MAX_VIOLATION_GROUPS new combinations are counted, not kept. */
export function recordCspViolation(violation: CspViolation, now: Date = new Date()): void {
  total++;
  const key = `${violation.directive}|${violation.blockedSource}|${violation.documentPath}`;
  const seen = groups.get(key);
  if (seen) {
    seen.count++;
    seen.lastSeen = now.toISOString();
    return;
  }
  if (groups.size >= MAX_VIOLATION_GROUPS) {
    dropped++;
    return;
  }
  groups.set(key, { ...violation, count: 1, firstSeen: now.toISOString(), lastSeen: now.toISOString() });
}

/** Every group, busiest first. An empty list is the signal that the policy can be enforced. */
export function cspViolationSummary(): CspViolationSummary {
  return {
    total,
    dropped,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
  };
}

/** Forgets everything collected (the tests, and the admin "start again" after a fix). */
export function resetCspViolations(): void {
  groups.clear();
  total = 0;
  dropped = 0;
}

/**
 * #943: removes the current batch in one synchronous step and returns it, so a clear records exactly
 * what it removes; reports that arrive while that record is being written start a new batch.
 */
export function takeCspViolations(): CspViolationSummary {
  const taken = cspViolationSummary();
  resetCspViolations();
  return taken;
}

/** Puts a taken batch back (its record could not be written), merged with anything received since. */
export function restoreCspViolations(taken: CspViolationSummary): void {
  total += taken.total;
  dropped += taken.dropped;
  for (const group of taken.groups) {
    const key = `${group.directive}|${group.blockedSource}|${group.documentPath}`;
    const seen = groups.get(key);
    if (seen) {
      seen.count += group.count;
      if (group.firstSeen < seen.firstSeen) seen.firstSeen = group.firstSeen;
      if (group.lastSeen > seen.lastSeen) seen.lastSeen = group.lastSeen;
    } else if (groups.size < MAX_VIOLATION_GROUPS) {
      groups.set(key, { ...group });
    } else {
      dropped += group.count;
    }
  }
}
