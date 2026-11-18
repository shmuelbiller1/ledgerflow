/**
 * SEC-SCAN-1 — narrow, fail-closed OWASP ZAP baseline report evaluator.
 *
 * Replaces broad plugin-wide rule ignores (e.g. muting all of 10055 CSP or all
 * of 10017 Cross-Domain JS in `.zap/rules.tsv`) with exact, instance-level
 * checks tied to documented LedgerFlow rollout stages:
 *
 *  - Fails immediately if `zap-report.json` is missing, empty, invalid JSON, or
 *    lacks a non-empty `site` array (an aborted container run can never pass).
 *  - `10035` (HSTS not set): accepted only on the plain-HTTP CI loopback target
 *    (`http://127.0.0.1:3000`).
 *  - `10055` (CSP): accepted ONLY on the loopback target for the exact S-23
 *    `report-only` rollout items:
 *      * `10055-5` (`CSP: script-src unsafe-inline`, while hash-only script-src
 *        is verified via `Content-Security-Policy-Report-Only`),
 *      * `10055-6` (`CSP: style-src unsafe-inline`),
 *      * `10055-4` (`CSP: Wildcard Directive`) ONLY when every instance names
 *        `img-src` exclusively (wildcards in `script-src`, `default-src`,
 *        `connect-src`, `frame-src`, `object-src`, `style-src`, `font-src`,
 *        `form-action`, or `frame-ancestors` FAIL the build).
 *    All other `10055-*` alerts (`10055-7` unsafe-hashes, `10055-9` malformed,
 *    `10055-10` script-src unsafe-eval, `10055-12` meta policy, etc.) FAIL.
 *  - `10017` (Cross-Domain JS include): accepted ONLY when every instance loads
 *    from `https://js.stripe.com/` or `https://cdn.plaid.com/`. Any other
 *    external script source FAILS.
 *  - Every other Medium (`riskcode === 2`) or High (`riskcode >= 3`) alert FAILS.
 *  - Low/Informational alerts (including `10063` Permissions-Policy, tracked in
 *    issue #827) remain visible in the summary and uploaded artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LOOPBACK_URI = /^http:\/\/127\.0\.0\.1:3000(?:[/?#]|$)/;
const ALLOWED_CROSS_DOMAIN_SCRIPT_PREFIXES = [
  'https://js.stripe.com/',
  'https://cdn.plaid.com/',
];
const FORBIDDEN_WILDCARD_DIRECTIVES = /\b(?:default-src|script-src(?:-elem|-attr)?|style-src(?:-elem|-attr)?|connect-src|object-src|frame-src|child-src|worker-src|font-src|media-src|manifest-src|base-uri|form-action|frame-ancestors|prefetch-src)\b/i;

/** Extract directive list from a ZAP 10055-4 "Wildcard Directive" instance or alert text. */
function isImgSrcOnlyWildcard(alert, instances) {
  const texts = [
    String(alert.otherinfo || ''),
    ...instances.map(inst => String(inst?.otherinfo || '')),
  ].filter(Boolean);
  if (texts.length === 0) return false;
  for (const text of texts) {
    // ZAP writes: "The following directives either allow wildcard sources (or ancestors), are not defined, or are overly broadly defined:\nimg-src"
    const afterColon = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
    if (!/\bimg-src\b/i.test(afterColon)) return false;
    const stripped = afterColon.replace(/\bimg-src\b/gi, '');
    if (FORBIDDEN_WILDCARD_DIRECTIVES.test(stripped)) return false;
  }
  return true;
}

function allInstancesLoopback(instances, siteName) {
  if (instances.length === 0) {
    return LOOPBACK_URI.test(String(siteName || ''));
  }
  return instances.every(inst => LOOPBACK_URI.test(String(inst?.uri || '')));
}

function isAllowedCrossDomainScriptInstance(instance) {
  const candidates = [String(instance?.param || '').trim(), String(instance?.evidence || '').trim()].filter(Boolean);
  if (candidates.length === 0) return false;
  const urls = [];
  for (const candidate of candidates) {
    if (/^https?:\/\//i.test(candidate)) {
      urls.push(candidate);
      continue;
    }
    const srcMatch = candidate.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch?.[1]) {
      const normalized = srcMatch[1].startsWith('//') ? `https:${srcMatch[1]}` : srcMatch[1];
      urls.push(normalized);
    }
  }
  if (urls.length === 0) return false;
  return urls.every(url =>
    ALLOWED_CROSS_DOMAIN_SCRIPT_PREFIXES.some(prefix => url.startsWith(prefix)),
  );
}

/**
 * Narrow acceptance check for a single ZAP alert object.
 * Returns `{ accepted: true, reason }` only when every instance matches a
 * documented baseline rule; otherwise `{ accepted: false }`.
 */
export function classifyZapAlert(alert, siteName = '', cspRollout = 'report-only') {
  const pluginId = String(alert?.pluginid || '');
  const alertRef = String(alert?.alertRef || pluginId);
  const name = String(alert?.name || alert?.alert || '');
  const instances = Array.isArray(alert?.instances) ? alert.instances : [];
  const onLoopback = allInstancesLoopback(instances, siteName);

  if (pluginId === '10035' && onLoopback) {
    return {
      accepted: true,
      reason: 'Local CI scan runs over plain HTTP loopback (HSTS enforced on HTTPS edge)',
    };
  }

  if (pluginId === '10055' && onLoopback) {
    if (alertRef === '10055-6' || /^CSP:\s*style-src\s+unsafe-inline$/i.test(name)) {
      return {
        accepted: true,
        reason: 'S-23 staged CSP rollout: style-src unsafe-inline tracked separately; script directives unaffected',
      };
    }
    if (
      cspRollout !== 'enforce'
      && (alertRef === '10055-5' || /^CSP:\s*script-src\s+unsafe-inline$/i.test(name))
    ) {
      return {
        accepted: true,
        reason: 'S-23 report-only stage: hash-pinned script-src active in Content-Security-Policy-Report-Only',
      };
    }
    if (
      (alertRef === '10055-4' || /^CSP:\s*Wildcard Directive$/i.test(name))
      && isImgSrcOnlyWildcard(alert, instances)
    ) {
      return {
        accepted: true,
        reason: 'S-23 CSP baseline: scheme source https: restricted exclusively to img-src',
      };
    }
    return { accepted: false };
  }

  if (pluginId === '10017' && onLoopback && instances.length > 0) {
    if (instances.every(isAllowedCrossDomainScriptInstance)) {
      return {
        accepted: true,
        reason: 'Allowlisted payment/banking SDK origin (js.stripe.com / cdn.plaid.com)',
      };
    }
    return { accepted: false };
  }

  return { accepted: false };
}

/**
 * Parse and evaluate a ZAP JSON report string.
 * Throws on empty/invalid JSON or missing `site` data so failed runs never pass.
 */
export function evaluateZapReportJson(rawJson, options = {}) {
  if (typeof rawJson !== 'string' || rawJson.trim().length === 0) {
    throw new Error('ZAP report JSON is empty or missing.');
  }
  let report;
  try {
    report = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`ZAP report JSON could not be parsed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!report || typeof report !== 'object' || !Array.isArray(report.site) || report.site.length === 0) {
    throw new Error('ZAP report JSON contains no scanned site entries; scan did not complete cleanly.');
  }

  const cspRollout = options.cspRollout || process.env.CSP_ROLLOUT || 'report-only';
  const actionable = [];
  const acceptedBaseline = [];
  const lowAndInfo = [];

  for (const site of report.site) {
    const siteName = String(site?.['@name'] || '');
    const alerts = Array.isArray(site?.alerts) ? site.alerts : [];
    for (const alert of alerts) {
      const pluginId = String(alert?.pluginid || '');
      const alertRef = String(alert?.alertRef || pluginId);
      const riskCode = Number(alert?.riskcode ?? Number.NaN);
      const riskDesc = String(alert?.riskdesc || `risk=${riskCode}`);
      const name = String(alert?.name || alert?.alert || 'Unnamed ZAP alert');
      const instances = Array.isArray(alert?.instances) ? alert.instances : [];
      const count = Number(alert?.count || instances.length || 1);

      if (!Number.isFinite(riskCode)) {
        actionable.push({ pluginId, alertRef, riskCode: 3, riskDesc: 'Unknown risk (fail-closed)', name, count });
        continue;
      }

      if (riskCode < 2) {
        lowAndInfo.push({ pluginId, alertRef, riskCode, riskDesc, name, count });
        continue;
      }

      const decision = classifyZapAlert(alert, siteName, cspRollout);
      if (decision.accepted) {
        acceptedBaseline.push({ pluginId, alertRef, riskCode, riskDesc, name, count, reason: decision.reason });
      } else {
        actionable.push({ pluginId, alertRef, riskCode, riskDesc, name, count });
      }
    }
  }

  return {
    passed: actionable.length === 0,
    siteCount: report.site.length,
    zapVersion: String(report['@version'] || 'unknown'),
    generatedAt: String(report['@generated'] || 'unknown'),
    actionable,
    acceptedBaseline,
    lowAndInfo,
  };
}

export function formatZapSummaryMarkdown(result) {
  const lines = [
    `### OWASP ZAP Baseline Summary (${result.passed ? 'PASS' : 'FAIL'})`,
    '',
    `- **ZAP version:** \`${result.zapVersion}\` | **Sites scanned:** ${result.siteCount} | **Generated:** ${result.generatedAt}`,
    `- **Unaccepted Medium/High alerts:** ${result.actionable.length}`,
    `- **Narrowly accepted baseline alerts (S-23 / loopback):** ${result.acceptedBaseline.length}`,
    `- **Low / Informational alerts (reported, non-blocking):** ${result.lowAndInfo.length}`,
  ];
  if (result.actionable.length > 0) {
    lines.push('', '#### Actionable Medium/High Alerts (blocking)');
    for (const a of result.actionable) {
      lines.push(`- **[${a.riskDesc}]** \`${a.alertRef}\` ${a.name} (${a.count} instance(s))`);
    }
  }
  if (result.acceptedBaseline.length > 0) {
    lines.push('', '#### Narrowly Accepted Baseline Alerts');
    for (const a of result.acceptedBaseline) {
      lines.push(`- \`${a.alertRef}\` ${a.name} (${a.count}) — ${a.reason}`);
    }
  }
  if (result.lowAndInfo.length > 0) {
    lines.push('', '#### Low / Informational Alerts');
    for (const a of result.lowAndInfo) {
      lines.push(`- [${a.riskDesc}] \`${a.alertRef}\` ${a.name} (${a.count})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const DEFAULT_ZAP_REPORT_REL = path.join('zap-out', 'zap-report.json');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportPath = path.resolve(process.cwd(), DEFAULT_ZAP_REPORT_REL);
  if (!fs.existsSync(reportPath) || fs.lstatSync(reportPath).isSymbolicLink()) {
    console.error(`ZAP report file not found at ${DEFAULT_ZAP_REPORT_REL}; failing closed.`);
    process.exit(1);
  }
  const result = evaluateZapReportJson(fs.readFileSync(reportPath, 'utf8'));
  const markdown = formatZapSummaryMarkdown(result);
  process.stdout.write(markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }

  if (!result.passed) {
    const alertSummaryPath = path.resolve(process.cwd(), 'zap-out', 'actionable-alerts.md');
    const summaryBody = [
      'Nightly OWASP ZAP baseline detected unaccepted Medium/High alert(s) against the local production build:',
      '',
      ...result.actionable.map(a => `- [${a.riskDesc}] (${a.alertRef}) ${a.name} — ${a.count} instance(s)`),
      '',
      `Workflow run: ${process.env.RUN_URL || '(local)'}`,
    ].join('\n');
    fs.writeFileSync(alertSummaryPath, summaryBody, 'utf8');
    process.exit(1);
  }
}
