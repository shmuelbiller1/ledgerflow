import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface CommandWriteCounts {
  writeRoutes: number;
  directBrowserWrites: number;
  routeSites: Record<string, number>;
  browserSites: Record<string, number>;
  /**
   * Writes by the sample company's own store (`src/lib/db/localStore.ts`). They are not direct writes
   * to a workspace — the demo has no workspace on the server — but they are counted, so "the browser
   * writes in exactly two places" is measurable rather than a claim.
   */
  localStoreWrites: number;
  localStoreSites: Record<string, number>;
}

const ROOT = process.cwd();
const ROUTE_ROOT = path.join(ROOT, 'src/server/routes');
const SOURCE_ROOT = path.join(ROOT, 'src');
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const BROWSER_WRITE_CALLS = new Set(['setDoc', 'updateDoc', 'deleteDoc', 'addDoc', 'writeBatch', 'runTransaction']);
const IGNORED_BROWSER_SEGMENTS = new Set(['server', 'tests']);
// the local store is where the sample company's writes live; it is counted, not ignored
const LOCAL_STORE_ROOT = 'lib/db';

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(file);
    return entry.isFile() && /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [file] : [];
  });
}

function propertyName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return undefined;
}

function callName(node: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  return propertyName(node.expression);
}

function stringValues(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(element => stringValues(ts.isExpression(element) ? element : undefined));
  return [];
}

function containsCommandRunnerCall(node: ts.Node): boolean {
  let found = false;
  // `runLegacyCommand` is the task/time/stage compatibility adapter; its implementation delegates to
  // executeCommand. `handleCreatePayment` is the same shape in paymentRoutes.ts: the handler is exported
  // for the two suites that call it directly, and its body is the runner invocation. Naming an
  // unconverted helper here would not help it: the ratchet can only shrink, and the file's count fell.
  // `openSandbox`, `reviewSandbox` and `undoSandboxStep` are the SBX-1 review service (commands/sandboxReview.ts):
  // drafting writes only the sandbox overlay, never a real row; accepting replays each step through the shared
  // runner's validation, prepare, handler and audit path (`replayReviewedStep`), and undo calls
  // `runRegisteredCommand` on the step's recorded inverse. They are the proposal door of CMD-1 part 3, not a
  // second way to write the books.
  const commandRunners = new Set(['executeCommand', 'previewCommand', 'runLegacyCommand', 'handleCreatePayment', 'openSandbox', 'reviewSandbox', 'undoSandboxStep']);
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && commandRunners.has(callName(child) || '')) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * POST routes that write nothing, and are therefore not command work.
 *
 * A command exists so that a write is authorized, idempotent and audited in one place. A route that
 * only reads and answers does not need that: wrapping it would add a transaction and an audit entry
 * for work that changes nothing. Each exception names one route and why it is read-only, and
 * `commands-baseline.test.ts` checks that it still matches a real route, so an exception cannot
 * outlive the code it describes.
 */
export interface PostRouteException {
  file: string;
  /** The route's own path string, as the router declares it. */
  route: string;
  why: string;
}

export const READ_ONLY_ROUTE_EXCEPTIONS: readonly PostRouteException[] = [
  {
    file: 'src/server/routes/sandboxRoutes.ts',
    route: '/:sandboxId/tools/:tool',
    why: 'The assistant\'s read tools (SBX-1): list, get and search records, run a report, explain a number, '
      + 'read a question, calculate. They are posted because a filter list or an account list does not fit in '
      + 'a link. Every one reads through the sandbox handle and answers; nothing is written or audited.',
  },
  {
    file: 'src/server/routes/sandboxRoutes.ts',
    route: '/:sandboxId/token',
    why: 'Issues a fresh assistant token for a sandbox the signed-in person already owns, signed from the '
      + 'session alone (auth/assistantToken.ts). It reads the binding and the live role; it writes nothing.',
  },
  {
    file: 'src/server/routes/transactions/reconcileRoutes.ts',
    route: '/reconciliation/match',
    why: 'Suggests which uncleared entry an outside bank line matches, by amount, date and text. It '
      + 'reads the workspace and answers suggestions; nothing is marked, written or audited, so a '
      + 'command would add a transaction around a read.',
  },
  ...['/depreciation', '/inventory/wac', '/amortization', '/inventory/eoq', '/kpi', '/temporal', '/valuation'].map(route => ({
    file: 'src/server/routes/mathRoutes.ts',
    route,
    why: 'A calculator: it reads the numbers in the request body, hands them to TruthEngine and answers '
      + 'the result. The file opens no database at all — no workspace, no ledger and no audit entry — so '
      + 'a command would add a transaction, a workspace check and an idempotency record around arithmetic '
      + 'that changes nothing.',
  })),
  {
    file: 'src/server/routes/transactions/periodRoutes.ts',
    route: '/revaluation/preview',
    why: 'The same function /revaluation/run posts from, called with dryRun: true: it values the open foreign '
      + 'invoices and bills at a rate and answers the entries it would post. The service returns before any '
      + 'write on that flag (fxRevaluationService.ts), so the preview opens no transaction, records nothing '
      + 'and is audited for nothing. Its sibling /revaluation/run is the command period.fxrevaluation.',
  },
  {
    file: 'src/server/routes/labelingRoutes.ts',
    route: '/api/v1/label-transactions',
    why: 'A labelling engine: it reads the workspace\'s chart accounts and auto-rules, scores each entry in the '
      + 'request against them in memory, and answers the suggested account for each. It writes no entry, '
      + 'updates no rule, records no audit line and charges no usage, so a command would add a transaction, '
      + 'an idempotency record and a workspace write check around a calculation.',
  },
  {
    file: 'src/server/routes/labelingRoutes.ts',
    route: '/api/v1/forensics/anomaly-scan',
    why: 'A statistical scan: it reads up to 200 entries, computes the mean and standard deviation of their '
      + 'amounts and answers the ones more than 2.5 deviations out. Nothing is written, flagged, marked or '
      + 'audited, so a command would add a transaction around arithmetic.',
  },
  ...['/trust-reconciliation', '/rent-roll'].map(route => ({
    file: 'src/server/routes/leaseRoutes.ts',
    route,
    why: 'A calculator over the numbers in the request body: the security-deposit trust reconciliation and '
      + 'the property rent roll are pure functions in src/lib/verticalAccounting.ts, and the route answers '
      + 'their result. The rent roll reads the workspace\'s invoices to total what has been billed; nothing '
      + 'is written, marked or audited, so a command would add a transaction, an idempotency record and a '
      + 'workspace write check around arithmetic that changes nothing. The lease itself is still posted '
      + 'through the command (lease.capitalize), and revenue recognition through revenue.recognize.',
  })),
  {
    file: 'src/server/routes/brandingRoutes.ts', route: '/preview',
    why: 'Renders a synthetic sample invoice with the submitted branding. It saves no branding and cannot claim a stored document’s original.',
  },
  {
    file: 'src/server/routes/developerApiRoutes.ts', route: '/api/v1/bank/map',
    why: 'Reads chart accounts and suggests a mapping for the supplied rows. No bank lines, rules or ledger entries are written by the handler.',
  },
  {
    file: 'src/server/routes/ledgerMatchRoutes.ts', route: '/api/v1/ledger/match',
    why: 'Reads rules and recent entries to suggest a match in memory; the handler neither links a bank line nor posts an entry.',
  },
  {
    file: 'src/server/routes/reportRoutes.ts', route: '/explain',
    why: 'Explains report totals and counts existing evidence; accepts POST for large filters, not to change the books.',
  },
  {
    file: 'src/server/routes/logsUploadRoutes.ts', route: '/api/upload-bank-csv',
    why: 'Parses an uploaded bank CSV and deletes the temporary file. The response is a candidate list, not an import into the books.',
  },
  {
    file: 'src/server/routes/openItemImportRoutes.ts', route: '/preview',
    why: 'Validates the CSV against existing contacts, accounts and periods without saving documents. The separate /confirm still counts.',
  },
];

/** Provider operations, not read-only: session starts with no books write, and the payout
 * protocol whose local journal must follow the processor outcome, one vendor at a time. */
export const PROVIDER_ROUTE_EXCEPTIONS: readonly PostRouteException[] = [
  {
    file: 'src/server/routes/billingRoutes.ts', route: '/checkout',
    why: 'Opens a Stripe-hosted checkout session with a provider idempotency key. It does not upgrade a plan or grant credits; verification/webhook writes are separate.',
  },
  {
    file: 'src/server/routes/billingRoutes.ts', route: '/portal',
    why: 'Opens a short-lived Stripe billing portal session without updating any local subscription, workspace or book record.',
  },
  {
    file: 'src/server/routes/plaidRoutes.ts', route: '/create_link_token',
    why: 'Requests a short-lived Plaid Link token, optionally for update mode. It stores neither a bank connection nor statement lines.',
  },
  {
    file: 'src/server/routes/paymentRoutes.ts',
    route: '/payout-run',
    why: 'Sends real money: one processor transfer per vendor before any payment is recorded, and it '
      + 'answers 503 when the processor is not configured. The transfer is an external side effect '
      + 'that cannot be rolled back by a books transaction, so the route owns the per-item order '
      + '(replay, transfer, then the payment) and the per-vendor failures it reports. Each payment '
      + 'it records already goes through createPaymentIdempotent; wrapping the batch in a command '
      + 'would promise an atomicity the processor does not offer.',
  },
];

/**
 * A route registration is a call with a path and a handler: `.post(path, handler)`. A call with one
 * argument cannot be one — `FieldValue.delete()`, `ref.delete()` and `t.delete(ref)` in a transaction
 * are all document or field operations that happen to share the method names routes use. Counting them
 * made the ratchet measure every `delete` in the route folder, so apiKeys' four field deletions read as
 * four unconverted writes. Requiring the path and the handler keeps real routes (including the few
 * whose path is a constant or an array) and drops the false ones.
 */
function isRouteRegistration(node: ts.CallExpression): boolean {
  return WRITE_METHODS.has(callName(node) || '') && node.arguments.length >= 2;
}

function routeRegistrations(file: string): ts.CallExpression[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const registrations: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isRouteRegistration(node)) registrations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return registrations;
}

const postExceptions = [...READ_ONLY_ROUTE_EXCEPTIONS, ...PROVIDER_ROUTE_EXCEPTIONS];

function matchesPostException(node: ts.CallExpression, route: string) {
  const pathArg = node.arguments[0];
  return callName(node) === 'post' && ts.isStringLiteralLike(pathArg) && pathArg.text === route;
}

/** An exemption must correspond to a live, unconverted POST registration, not to a comment or a string elsewhere. */
export function matchingUnconvertedPosts({ file, route }: PostRouteException): number {
  return routeRegistrations(path.join(ROOT, file)).filter(node => matchesPostException(node, route) && !containsCommandRunnerCall(node)).length;
}

function countWriteRoutes(): { total: number; sites: Record<string, number> } {
  const sites: Record<string, number> = {};
  for (const file of walk(ROUTE_ROOT)) {
    const relativeFile = path.relative(ROOT, file).split(path.sep).join('/');
    const exceptions = postExceptions.filter(e => e.file === relativeFile);
    const count = routeRegistrations(file).filter(node => {
      const excluded = stringValues(node.arguments[0]).some(value => /(?:^|\/)\/?(?:admin|system)(?:\/|$)/.test(value.replace(/^\/+/, '')));
      const exceptedPost = exceptions.some(e => matchesPostException(node, e.route));
      return !excluded && !exceptedPost && !containsCommandRunnerCall(node);
    }).length;
    if (count) sites[relativeFile] = count;
  }
  return { total: Object.values(sites).reduce((sum, n) => sum + n, 0), sites: Object.fromEntries(Object.entries(sites).sort(([a], [b]) => a.localeCompare(b))) };
}

function isIgnoredBrowserFile(file: string): boolean {
  const relative = path.relative(SOURCE_ROOT, file).split(path.sep).join('/');
  if (/\.(?:test|spec)\.[jt]sx?$/.test(relative)) return true;
  return [...IGNORED_BROWSER_SEGMENTS].some(segment => relative === segment || relative.startsWith(`${segment}/`) || relative.includes(`/${segment}/`));
}

function countDirectBrowserWrites(): { total: number; sites: Record<string, number>; localTotal: number; localSites: Record<string, number> } {
  const sites: Record<string, number> = {};
  const localSites: Record<string, number> = {};
  for (const file of walk(SOURCE_ROOT)) {
    if (isIgnoredBrowserFile(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    let count = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && BROWSER_WRITE_CALLS.has(callName(node) || '')) count += 1;
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (!count) continue;
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    const inLocalStore = path.relative(SOURCE_ROOT, file).split(path.sep).join('/').startsWith(`${LOCAL_STORE_ROOT}/`);
    (inLocalStore ? localSites : sites)[relative] = count;
  }
  const sortSites = (entries: Record<string, number>) => Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
  return {
    total: Object.values(sites).reduce((sum, n) => sum + n, 0),
    sites: sortSites(sites),
    localTotal: Object.values(localSites).reduce((sum, n) => sum + n, 0),
    localSites: sortSites(localSites),
  };
}

export function scanCommandWrites(): CommandWriteCounts {
  const routes = countWriteRoutes();
  const browser = countDirectBrowserWrites();
  return {
    writeRoutes: routes.total,
    directBrowserWrites: browser.total,
    routeSites: routes.sites,
    browserSites: browser.sites,
    localStoreWrites: browser.localTotal,
    localStoreSites: browser.localSites,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(scanCommandWrites(), null, 2));
}
