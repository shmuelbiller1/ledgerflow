/**
 * S-25 — Pre-release HTTP security header smoke check.
 *
 * Fetches `/` (HTML document) and `/api/health` (JSON API) from a deployed,
 * preview, or local production-bundle server and verifies browser hardening
 * headers: Content-Security-Policy, Strict-Transport-Security, X-Frame-Options,
 * X-Content-Type-Options, Referrer-Policy, Cross-Origin-Opener-Policy,
 * Cross-Origin-Resource-Policy, absence of X-Powered-By, and Permissions-Policy
 * (now enforced via vercel.json + securityMiddleware; strict via `--require-permissions-policy`).
 *
 * Non-loopback targets MUST use `https://`. Loopback smoke checks (`127.0.0.1`
 * or `localhost`) require `--allow-http`.
 *
 * Usage:
 *   npx tsx scripts/check-security-headers.ts https://preview.example.com
 *   npx tsx scripts/check-security-headers.ts http://127.0.0.1:3000 --allow-http
 */
import { pathToFileURL } from 'node:url';

export interface HeaderFinding {
  endpoint: string;
  header: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export interface HeaderEvaluationOptions {
  isHttps: boolean;
  requireStrictScriptCsp?: boolean;
  requirePermissionsPolicy?: boolean;
}

export function parseCspDirectives(rawCsp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of rawCsp.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const name = tokens[0].toLowerCase();
    if (!directives.has(name)) {
      directives.set(name, tokens.slice(1));
    }
  }
  return directives;
}

function parseHstsMaxAge(raw: string): number | null {
  const match = raw.match(/\bmax-age\s*=\s*(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

export function evaluateResponseHeaders(
  endpoint: string,
  headers: Headers | Record<string, string | undefined>,
  options: HeaderEvaluationOptions,
): HeaderFinding[] {
  const get = (name: string): string => {
    if (headers instanceof Headers) return (headers.get(name) || '').trim();
    const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? String(headers[key] || '').trim() : '';
  };

  const findings: HeaderFinding[] = [];
  const push = (header: string, status: HeaderFinding['status'], message: string) => {
    findings.push({ endpoint, header, status, message });
  };

  // 1. Content-Security-Policy
  const csp = get('content-security-policy');
  const cspReportOnly = get('content-security-policy-report-only');
  if (!csp) {
    push('Content-Security-Policy', 'fail', 'Missing Content-Security-Policy header.');
  } else {
    const map = parseCspDirectives(csp);
    const defaultSrc = map.get('default-src') || [];
    const scriptSrc = map.get('script-src') || defaultSrc;
    const objectSrc = map.get('object-src') || [];
    const baseUri = map.get('base-uri') || [];
    const frameAncestors = map.get('frame-ancestors') || [];
    const formAction = map.get('form-action') || [];

    const problems: string[] = [];
    if (!defaultSrc.includes("'self'") && !defaultSrc.includes("'none'")) {
      problems.push("default-src must restrict to 'self' or 'none'");
    }
    if (scriptSrc.includes('*') || scriptSrc.includes('http:') || scriptSrc.includes('https:') || scriptSrc.includes('data:')) {
      problems.push('script-src allows an overly broad wildcard/scheme source');
    }
    if (scriptSrc.includes("'unsafe-eval'")) {
      problems.push("script-src must not allow 'unsafe-eval'");
    }
    if (!objectSrc.includes("'none'")) {
      problems.push("object-src must be 'none'");
    }
    if (!baseUri.includes("'self'") && !baseUri.includes("'none'")) {
      problems.push("base-uri must be 'self' or 'none'");
    }
    if (!frameAncestors.includes("'self'") && !frameAncestors.includes("'none'")) {
      problems.push("frame-ancestors must be 'self' or 'none'");
    }
    if (!formAction.includes("'self'") && !formAction.includes("'none'")) {
      problems.push("form-action must be 'self' or 'none'");
    }

    const hasInlineScript = scriptSrc.includes("'unsafe-inline'");
    if (hasInlineScript && options.requireStrictScriptCsp) {
      problems.push("script-src still includes 'unsafe-inline' (--strict-csp)");
    }

    if (problems.length > 0) {
      push('Content-Security-Policy', 'fail', problems.join('; '));
    } else if (hasInlineScript) {
      const roHasHash = /'sha256-[A-Za-z0-9+/=]+'/.test(cspReportOnly) && !parseCspDirectives(cspReportOnly).get('script-src')?.includes("'unsafe-inline'");
      push(
        'Content-Security-Policy',
        roHasHash ? 'warn' : 'fail',
        roHasHash
          ? "Core CSP directives present; S-23 at report-only stage (Report-Only header enforces hash-pinned script-src)."
          : "script-src contains 'unsafe-inline' without a hash-pinned Content-Security-Policy-Report-Only header.",
      );
    } else {
      push('Content-Security-Policy', 'pass', 'Enforced CSP passes strict directive checks.');
    }
  }

  // 2. Strict-Transport-Security
  const hsts = get('strict-transport-security');
  const maxAge = hsts ? parseHstsMaxAge(hsts) : null;
  if (!hsts) {
    push(
      'Strict-Transport-Security',
      options.isHttps ? 'fail' : 'warn',
      options.isHttps
        ? 'Missing Strict-Transport-Security on HTTPS endpoint.'
        : 'Not set on plain-HTTP loopback target (verify on HTTPS deployment).',
    );
  } else if (maxAge === null || maxAge < 31_536_000) {
    push('Strict-Transport-Security', 'fail', `HSTS max-age must be >= 31536000 (1 year); got "${hsts}".`);
  } else {
    push('Strict-Transport-Security', 'pass', `HSTS present (${hsts}).`);
  }

  // 3. X-Content-Type-Options
  const xcto = get('x-content-type-options').toLowerCase();
  push(
    'X-Content-Type-Options',
    xcto === 'nosniff' ? 'pass' : 'fail',
    xcto === 'nosniff' ? 'Set to nosniff.' : `Expected "nosniff", got "${xcto || '(missing)'}".`,
  );

  // 4. X-Frame-Options
  const xfo = get('x-frame-options').toUpperCase();
  push(
    'X-Frame-Options',
    xfo === 'DENY' || xfo === 'SAMEORIGIN' ? 'pass' : 'fail',
    xfo === 'DENY' || xfo === 'SAMEORIGIN' ? `Set to ${xfo}.` : `Expected DENY or SAMEORIGIN, got "${xfo || '(missing)'}".`,
  );

  // 5. Referrer-Policy
  const referrer = get('referrer-policy').toLowerCase();
  const safeReferrer = new Set([
    'no-referrer',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
  ]);
  push(
    'Referrer-Policy',
    safeReferrer.has(referrer) ? 'pass' : 'fail',
    safeReferrer.has(referrer) ? `Set to ${referrer}.` : `Expected strict Referrer-Policy, got "${referrer || '(missing)'}".`,
  );

  // 6. Cross-Origin-Opener-Policy & Cross-Origin-Resource-Policy
  const coop = get('cross-origin-opener-policy').toLowerCase();
  push(
    'Cross-Origin-Opener-Policy',
    coop === 'same-origin' || coop === 'same-origin-allow-popups' ? 'pass' : 'warn',
    coop ? `Set to ${coop}.` : 'Missing Cross-Origin-Opener-Policy.',
  );

  const corp = get('cross-origin-resource-policy').toLowerCase();
  push(
    'Cross-Origin-Resource-Policy',
    corp === 'same-origin' || corp === 'same-site' ? 'pass' : 'warn',
    corp ? `Set to ${corp}.` : 'Missing Cross-Origin-Resource-Policy.',
  );

  // 7. Permissions-Policy (fixed in #827 / 2026-11-19)
  const permissionsPolicy = get('permissions-policy');
  if (!permissionsPolicy) {
    push(
      'Permissions-Policy',
      options.requirePermissionsPolicy ? 'fail' : 'warn',
      'Missing Permissions-Policy header.',
    );
  } else {
    push('Permissions-Policy', 'pass', `Set (${permissionsPolicy}).`);
  }

  // 8. X-Powered-By must never leak framework fingerprint
  const poweredBy = get('x-powered-by');
  push(
    'X-Powered-By',
    poweredBy ? 'fail' : 'pass',
    poweredBy ? `Server discloses X-Powered-By: ${poweredBy}.` : 'Absent (no framework disclosure).',
  );

  return findings;
}

export function validateTargetBaseUrl(rawUrl: string, allowHttpLoopback: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`Invalid target URL "${rawUrl}".`, { cause: err });
  }
  if (parsed.username || parsed.password) {
    throw new Error('Target URL must not embed credentials.');
  }
  if (parsed.protocol === 'https:') return parsed;
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  if (parsed.protocol === 'http:' && isLoopback && allowHttpLoopback) {
    return parsed;
  }
  throw new Error(
    parsed.protocol === 'http:' && isLoopback
      ? 'Loopback HTTP target requires explicit --allow-http flag.'
      : 'Non-loopback targets must use https://.',
  );
}

async function runCli(argv: string[]): Promise<void> {
  const targetArg = argv.find(a => !a.startsWith('--')) || process.env.SECURITY_HEADERS_URL;
  if (!targetArg) {
    console.error('Usage: npx tsx scripts/check-security-headers.ts <url> [--allow-http] [--strict-csp] [--require-permissions-policy]');
    process.exitCode = 1;
    return;
  }
  const allowHttp = argv.includes('--allow-http');
  const requireStrictScriptCsp = argv.includes('--strict-csp');
  const requirePermissionsPolicy = argv.includes('--require-permissions-policy');
  const base = validateTargetBaseUrl(targetArg, allowHttp);
  const origin = base.origin;
  const endpoints = ['/', '/api/health'];
  const allFindings: HeaderFinding[] = [];

  for (const ep of endpoints) {
    const url = `${origin}${ep}`;
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status < 200 || res.status >= 300) {
      allFindings.push({
        endpoint: ep,
        header: 'HTTP-Status',
        status: 'fail',
        message: `Expected 2xx response from ${ep}, received HTTP ${res.status}.`,
      });
      continue;
    }
    allFindings.push(
      ...evaluateResponseHeaders(ep, res.headers, {
        isHttps: base.protocol === 'https:',
        requireStrictScriptCsp,
        requirePermissionsPolicy,
      }),
    );
  }

  for (const f of allFindings) {
    console.log(`${f.status.toUpperCase().padEnd(4)} [${f.endpoint}] ${f.header}: ${f.message}`);
  }
  const failCount = allFindings.filter(f => f.status === 'fail').length;
  const warnCount = allFindings.filter(f => f.status === 'warn').length;
  console.log(`Header smoke check (${origin}): ${failCount} failed, ${warnCount} advisory warning(s).`);
  if (failCount > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch(err => {
    console.error(`FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
