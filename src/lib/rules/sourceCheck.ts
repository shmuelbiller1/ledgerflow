/**
 * A-59: the rule pack source checker. Every pack rule claims an official source; this module turns
 * the packs into a list of **unique URLs** with the rules that rely on them, and turns the answers of
 * a checker into a readable report.
 *
 * What this can say: a URL answered (HTTP 200), answered with a redirect/error status, or was
 * unreachable at the moment of the run. What it can never say: that the page still contains the rule.
 * A source that answers 200 may have changed its rate, and a source that fails may be temporarily
 * down. The report says so in its own words, and the HTML status of a page is never treated as
 * approval of a tax position.
 *
 * Pure: no fetching happens here, so the unit tests never touch the network. `checkRuleSources()`
 * takes the fetcher from its caller, and `scripts/check-rule-sources.ts` is the (by-hand) runner.
 */
import type { Rule } from './rules';
import type { TaxEffect } from './packs/shared';
import { BRAND } from '../../config/brand';

/** One unique source URL, and every rule that proves itself by it. */
export interface RuleSourceEntry {
  url: string;
  authorities: string[];
  ruleIds: string[];
  /** a rule may be reachable without being in a pack list, so this is a count, not a total */
  ruleCount: number;
  /** the earliest and latest `retrieved` dates the rules themselves record */
  retrievedFrom?: string;
  retrievedTo?: string;
}

export type SourceCheckStatus = 'answered' | 'http-error' | 'unreachable' | 'skipped';

export interface SourceCheckResult {
  url: string;
  status: SourceCheckStatus;
  /** the HTTP status, when there was one */
  httpStatus?: number;
  /** final URL after redirects, when it differs */
  finalUrl?: string;
  /** a short, plain-language reason; never a tax statement */
  detail: string;
}

export interface SourceReport {
  checkedAt: string;
  entries: Array<RuleSourceEntry & { result: SourceCheckResult }>;
  totals: Record<SourceCheckStatus, number>;
  /** unique URLs looked at */
  urlCount: number;
}

/** Every unique source URL of the rules, in first-seen order, with the rules that cite it. */
export function ruleSourceIndex(rules: Array<Rule<TaxEffect>>): RuleSourceEntry[] {
  const byUrl = new Map<string, RuleSourceEntry>();
  for (const rule of rules) {
    const url = rule.source?.url;
    if (!url) continue;
    const entry = byUrl.get(url) || { url, authorities: [], ruleIds: [], ruleCount: 0 };
    if (!entry.authorities.includes(rule.source.authority)) entry.authorities.push(rule.source.authority);
    entry.ruleIds.push(rule.id);
    entry.ruleCount += 1;
    const retrieved = rule.source.retrieved;
    if (retrieved) {
      if (!entry.retrievedFrom || retrieved < entry.retrievedFrom) entry.retrievedFrom = retrieved;
      if (!entry.retrievedTo || retrieved > entry.retrievedTo) entry.retrievedTo = retrieved;
    }
    byUrl.set(url, entry);
  }
  return [...byUrl.values()];
}

/** The rows of a report, newest information first: failures, then redirects, then the rest. */
export function sourceReportLines(report: SourceReport): string[] {
  const rank = (status: SourceCheckStatus) => (status === 'unreachable' ? 0 : status === 'http-error' ? 1 : status === 'skipped' ? 2 : 3);
  return [...report.entries]
    .sort((a, b) => rank(a.result.status) - rank(b.result.status) || a.url.localeCompare(b.url))
    .map(entry => {
      const codes = entry.result.httpStatus ? ` (${entry.result.httpStatus})` : '';
      const rules = entry.ruleCount === 1 ? '1 rule' : `${entry.ruleCount} rules`;
      return `${entry.result.status}${codes}\t${entry.url}\t${rules}\t${entry.result.detail}`;
    });
}

/** The plain-language sentence the report opens with; it never claims a rule is verified. */
export function sourceReportSummary(report: SourceReport): string {
  const { answered, 'http-error': httpError, unreachable, skipped } = report.totals;
  const parts = [`${answered} of ${report.urlCount} source URLs answered`];
  if (httpError) parts.push(`${httpError} answered with an error status`);
  if (unreachable) parts.push(`${unreachable} could not be reached`);
  if (skipped) parts.push(`${skipped} were not checked`);
  return `${parts.join(', ')}. A URL answering 200 shows the page exists today, not that the row still matches it.`;
}

export interface CheckRuleSourcesOptions {
  /** how long one request may take, in milliseconds */
  timeoutMs?: number;
  /** only check these URLs (used by the dry run and by focused checks) */
  urls?: string[];
  /** when set, no request is made and every entry is reported as skipped */
  dryRun?: boolean;
  /** the fetcher, so the runner (not this module) owns the network */
  fetchImpl?: typeof fetch;
}

/**
 * Check the given rules' sources. The fetcher is passed in; a request that throws is `unreachable`
 * with the error's message, and a non-200 answer is `http-error` with its status. Never throws for a
 * network failure — the report is the result.
 */
export async function checkRuleSources(
  rules: Array<Rule<TaxEffect>>,
  checkedAt: string,
  options: CheckRuleSourcesOptions = {},
): Promise<SourceReport> {
  const index = ruleSourceIndex(rules).filter(entry => !options.urls || options.urls.includes(entry.url));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const entries: SourceReport['entries'] = [];
  for (const entry of index) {
    if (options.dryRun) {
      entries.push({ ...entry, result: { url: entry.url, status: 'skipped', detail: 'dry run: no request made' } });
      continue;
    }
    const fetchImpl = options.fetchImpl;
    if (!fetchImpl) throw new Error('checkRuleSources needs a fetch implementation or dryRun');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(entry.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': `${BRAND.fileSlug}-rule-source-check/1.0 (+by hand; not a crawler)` },
      });
      const finalUrl = typeof response.url === 'string' && response.url && response.url !== entry.url ? response.url : undefined;
      entries.push({
        ...entry,
        result: response.status === 200
          ? { url: entry.url, status: 'answered', httpStatus: 200, ...(finalUrl ? { finalUrl } : {}), detail: finalUrl ? `redirects to ${finalUrl}` : 'answered' }
          : { url: entry.url, status: 'http-error', httpStatus: response.status, ...(finalUrl ? { finalUrl } : {}), detail: `the authority answered ${response.status}` },
      });
    } catch (error) {
      const detail = controller.signal.aborted
        ? `no answer within ${timeoutMs} ms`
        : error instanceof Error ? error.message : String(error);
      entries.push({ ...entry, result: { url: entry.url, status: 'unreachable', detail } });
    } finally {
      clearTimeout(timer);
    }
  }
  const totals: SourceReport['totals'] = { answered: 0, 'http-error': 0, unreachable: 0, skipped: 0 };
  for (const entry of entries) totals[entry.result.status] += 1;
  return { checkedAt, entries, totals, urlCount: entries.length };
}

/** The markdown report written to docs/eval/. One table row per unique URL. */
export function sourceReportMarkdown(report: SourceReport): string {
  const lines = [
    `# Rule pack source check — ${report.checkedAt}`,
    '',
    sourceReportSummary(report),
    '',
    'Every rule of every pack carries an official source. This run read each **unique** source URL once',
    '(many rules share one page). It checks that the page answers; it does not read the page, so it is not',
    'a review of the rule. A person still confirms each row against the source before a filing position.',
    '',
    '| status | URL | rules | detail |',
    '| --- | --- | --- | --- |',
  ];
  const rank = (status: SourceCheckStatus) => (status === 'unreachable' ? 0 : status === 'http-error' ? 1 : status === 'skipped' ? 2 : 3);
  for (const entry of [...report.entries].sort((a, b) => rank(a.result.status) - rank(b.result.status) || a.url.localeCompare(b.url))) {
    const status = entry.result.httpStatus ? `${entry.result.status} (${entry.result.httpStatus})` : entry.result.status;
    const authorities = entry.authorities.join('; ');
    lines.push(`| ${status} | ${entry.url} | ${entry.ruleCount} | ${authorities} — ${entry.result.detail} |`);
  }
  return `${lines.join('\n')}\n`;
}
