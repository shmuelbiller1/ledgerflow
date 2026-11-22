import { createHash } from 'node:crypto';
import { SUPABASE_PROJECT as supabaseConfig } from '../../config/supabaseProject';

/**
 * One source for the Content-Security-Policy (AUD-12). connect-src follows the configured Supabase
 * project instead of a hard-coded host:
 * - the browser bundle talks to VITE_SUPABASE_URL (falling back to supabase-config.json), so the
 *   static-hosting header in vercel.json is generated from that (scripts/vercel-csp.ts, checked on
 *   every build and by src/tests/csp-supabase-project.test.ts);
 * - the Express header (helmet, securityMiddleware.ts) also allows the server's SUPABASE_URL when it
 *   names a different project.
 * Only the exact project origins are added (https for data/auth, wss for realtime); never a wildcard.
 */

type Env = Record<string, string | undefined>;

/** Sources other than the Supabase project; unchanged from the policy that was hard-coded before. */
const PLAID_AND_GOOGLE_CONNECT = ['https://*.plaid.com', 'https://*.googleapis.com'];

/** `https://ref.supabase.co` → [`https://ref.supabase.co`, `wss://ref.supabase.co`]. Throws on a non-URL. */
export function supabaseConnectSources(projectUrl: string): string[] {
  const url = new URL(projectUrl.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Supabase URL must be http(s): ${projectUrl}`);
  }
  const socket = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return [url.origin, `${socket}//${url.host}`];
}

/** The project the browser bundle connects to (same rule as src/lib/db/client.ts). */
export function clientSupabaseUrl(env: Env = process.env): string {
  return env.VITE_SUPABASE_URL || supabaseConfig.url;
}

/** Every configured project origin pair: the browser's project, then the server's when different. */
export function configuredSupabaseConnectSources(env: Env = process.env, serverUrl?: string): string[] {
  const urls = [clientSupabaseUrl(env), serverUrl || env.SUPABASE_URL || supabaseConfig.url];
  return [...new Set(urls.flatMap(supabaseConnectSources))];
}

/** connect-src for the given Supabase origins. */
export function connectSources(supabaseSources: string[]): string[] {
  return ["'self'", ...supabaseSources, ...PLAID_AND_GOOGLE_CONNECT];
}

/** The static-hosting (vercel.json) policy for a browser bundle built against `projectUrl`. */
export function staticCspHeaderValue(projectUrl: string): string {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'unsafe-inline'", 'https://cdn.plaid.com']],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com']],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['connect-src', connectSources(supabaseConnectSources(projectUrl))],
    ['frame-src', ["'self'", 'https://*.stripe.com', 'https://cdn.plaid.com']],
    ['worker-src', ["'self'", 'blob:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['frame-ancestors', ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** A named header's value inside a parsed vercel.json, or undefined. */
export function vercelCspValue(vercelConfig: unknown, headerName = 'content-security-policy'): string | undefined {
  const blocks = (vercelConfig as { headers?: Array<{ headers?: Array<{ key: string; value: string }> }> }).headers || [];
  for (const block of blocks) {
    const header = block.headers?.find(h => h.key.toLowerCase() === headerName);
    if (header) return header.value;
  }
  return undefined;
}

/**
 * Returns vercel.json with its CSP headers set for `projectUrl` (adds nothing else). Vercel serves
 * the built pages itself, so this file — not helmet — is what sends the browser its policy for
 * every document; the Express headers only reach /api responses. The S-23 stage therefore has to be
 * written in here too, or the tightened policy would never be measured on the deployed site.
 */
export function withVercelCsp<T>(vercelConfig: T, projectUrl: string, rollout: CspRollout = staticCspRollout()): T {
  const copy = JSON.parse(JSON.stringify(vercelConfig)) as T;
  const blocks = (copy as { headers?: Array<{ headers?: Array<{ key: string; value: string }> }> }).headers || [];
  const headers = blocks.find(b => b.headers?.some(h => h.key.toLowerCase() === 'content-security-policy'))?.headers;
  const header = headers?.find(h => h.key.toLowerCase() === 'content-security-policy');
  if (!headers || !header) throw new Error('vercel.json has no Content-Security-Policy header to update.');
  header.value = rollout === 'enforce' ? staticTightenedCspHeaderValue(projectUrl) : staticCspHeaderValue(projectUrl);

  const reportOnlyAt = headers.findIndex(h => h.key.toLowerCase() === REPORT_ONLY_HEADER.toLowerCase());
  if (reportOnlyAt >= 0) headers.splice(reportOnlyAt, 1);
  if (rollout === 'report-only') {
    headers.splice(headers.indexOf(header) + 1, 0,
      { key: REPORT_ONLY_HEADER, value: staticTightenedCspHeaderValue(projectUrl) });
  }
  return copy;
}

/* ---------------------------------------------------------------------------------------------
 * S-23: the tightened policy, report-only first.
 *
 * The policy above is the one the browser *enforces* today; it still allows `'unsafe-inline'`
 * scripts, which is what makes an injected <script> work at all. Turning that off in one step is
 * how a CSP takes a working page down, so the tightened policy ships first as
 * `Content-Security-Policy-Report-Only`: the browser keeps obeying the enforced policy and posts
 * what the tightened one *would* have blocked to CSP_REPORT_PATH (cspViolations.ts collects them).
 * When the summary is empty, CSP_TIGHTEN=enforce promotes it to the enforced header.
 * ------------------------------------------------------------------------------------------- */

/** Where the browser posts violation reports (cspReportRoutes.ts serves it). */
export const CSP_REPORT_PATH = '/api/csp-report';

/** The header a browser obeys nothing from and only reports against. */
export const REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';

/** off: only the policy above. report-only: it plus the tightened one, reported. enforce: the tightened one. */
export type CspRollout = 'off' | 'report-only' | 'enforce';

/** CSP_TIGHTEN, when it names a stage. */
function chosenRollout(env: Env): CspRollout | undefined {
  const choice = (env.CSP_TIGHTEN || '').trim().toLowerCase();
  return choice === 'off' || choice === 'report-only' || choice === 'enforce' ? choice : undefined;
}

/**
 * The stage this server is at. Unset CSP_TIGHTEN means report-only wherever a CSP is enforced at
 * all (production), and off in development, where Vite's own inline scripts and `eval` would report
 * a page full of violations that say nothing about the built app.
 */
export function cspRollout(env: Env = process.env): CspRollout {
  return chosenRollout(env) ?? (env.NODE_ENV === 'production' ? 'report-only' : 'off');
}

/**
 * The stage written into vercel.json. The static host only ever serves the deployed site, so this
 * does not read NODE_ENV: it must give the same answer during the build (where NODE_ENV is not
 * production) as the committed file, or `npm run build` would fail its own check.
 */
export function staticCspRollout(env: Env = process.env): CspRollout {
  return chosenRollout(env) ?? 'report-only';
}

/**
 * `'sha256-…'` for every inline `<script>` in an HTML page, so the tightened script-src can allow
 * exactly the page's own inline code and nothing else. A `<script src=…>` has no body to hash.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  // The closing tag may carry anything after the name — `</script >`, `</script\n foo>` all end the
  // element, and a regexp that only knows `</script>` would hash past the real end of the script.
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi)) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

/**
 * The hashes of the inline scripts index.html ships with.
 *
 * AF6-20261120-03 (Agent #6, 20 Nov): this is empty because index.html no longer ships an inline
 * script. The one it had was a second crash reporter: on every `error`/`unhandledrejection` it POSTed
 * the raw message and stack to `/api/health`, which has never had a POST route — so nothing was
 * recorded, the browser got a 404 per error, and the stack (which can name a customer, an invoice or
 * a path) left the browser without the consent, redaction and de-duplication the app's own tracker
 * (`src/lib/errorTracker.ts`, `initGlobalErrorTracking`) applies. If an inline script is ever needed
 * again, add its hash here; `csp-report-only.test.ts` recomputes this list from index.html, so the
 * two cannot drift.
 */
export const APP_INLINE_SCRIPT_HASHES: string[] = [];

/** Everything the tightened policy needs that is not fixed. */
export interface TightenedCspOptions {
  /** connect-src project origins, as configuredSupabaseConnectSources() returns them. */
  supabaseSources: string[];
  /** Hashes of the page's own inline scripts; without them script-src 'self' blocks them. */
  inlineScriptHashes?: string[];
  /** The embedding rule the enforced policy uses (the AI Studio proxy needs "*"). */
  frameAncestors?: string[];
  /** Added as report-uri so the browser says what the policy would have blocked. */
  reportUri?: string;
}

/**
 * The tightened policy, directive by directive. Against the enforced one:
 * - script-src drops `'unsafe-inline'` (the XSS hole) and names the page's inline scripts by hash;
 * - form-action and manifest-src are added, so a posted form cannot be aimed off-site;
 * - style-src keeps `'unsafe-inline'`: React writes `style={{…}}` attributes on render, and no
 *   hash or nonce can cover a style attribute (style-src-attr would need 'unsafe-hashes').
 */
export function tightenedCspDirectives(options: TightenedCspOptions): Array<[string, string[]]> {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...(options.inlineScriptHashes ?? []), 'https://cdn.plaid.com']],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['connect-src', connectSources(options.supabaseSources)],
    ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com']],
    ['frame-src', ["'self'", 'https://*.stripe.com', 'https://cdn.plaid.com']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', options.frameAncestors ?? ["'self'"]],
  ];
  if (options.reportUri) directives.push(['report-uri', [options.reportUri]]);
  return directives;
}

/** The tightened policy as one header value. */
export function tightenedCspHeaderValue(options: TightenedCspOptions): string {
  return tightenedCspDirectives(options).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** The tightened policy for the statically hosted pages built against `projectUrl`. */
export function staticTightenedCspHeaderValue(projectUrl: string): string {
  return tightenedCspHeaderValue({
    supabaseSources: supabaseConnectSources(projectUrl),
    inlineScriptHashes: APP_INLINE_SCRIPT_HASHES,
    reportUri: CSP_REPORT_PATH,
  });
}

/** helmet takes camelCase directive names and arrays; report-uri is not one of its known keys. */
export function helmetDirectives(directives: Array<[string, string[]]>): Record<string, string[]> {
  return Object.fromEntries(directives.map(([name, values]) => [
    name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
    values,
  ]));
}
