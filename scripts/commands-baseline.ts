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
  // `runLegacyCommand` is the task/time/stage compatibility adapter; its implementation delegates to executeCommand.
  const commandRunners = new Set(['executeCommand', 'previewCommand', 'runLegacyCommand']);
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
export interface ReadOnlyRouteException {
  file: string;
  /** The route's own path string, as the router declares it. */
  route: string;
  why: string;
}

export const READ_ONLY_ROUTE_EXCEPTIONS: readonly ReadOnlyRouteException[] = [
  {
    file: 'src/server/routes/transactions/reconcileRoutes.ts',
    route: '/reconciliation/match',
    why: 'Suggests which uncleared entry an outside bank line matches, by amount, date and text. It '
      + 'reads the workspace and answers suggestions; nothing is marked, written or audited, so a '
      + 'command would add a transaction around a read.',
  },
];

function countWriteRoutes(): { total: number; sites: Record<string, number> } {
  const sites: Record<string, number> = {};
  for (const file of walk(ROUTE_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let count = 0;
    const relativeFile = path.relative(ROOT, file).split(path.sep).join('/');
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && WRITE_METHODS.has(callName(node) || '')) {
        const pathNames = stringValues(node.arguments[0]);
        const excluded = pathNames.some(value => /(?:^|\/)\/?(?:admin|system)(?:\/|$)/.test(value.replace(/^\/+/, '')));
        // a POST that only reads is not a write: see READ_ONLY_ROUTE_EXCEPTIONS
        const readOnly = READ_ONLY_ROUTE_EXCEPTIONS.some(exception => exception.file === relativeFile && pathNames.includes(exception.route));
        if (!excluded && !readOnly && !containsCommandRunnerCall(node)) count += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (count) sites[path.relative(ROOT, file).split(path.sep).join('/')] = count;
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
