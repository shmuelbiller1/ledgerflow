import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface CommandWriteCounts {
  writeRoutes: number;
  directBrowserWrites: number;
  routeSites: Record<string, number>;
  browserSites: Record<string, number>;
}

const ROOT = process.cwd();
const ROUTE_ROOT = path.join(ROOT, 'src/server/routes');
const SOURCE_ROOT = path.join(ROOT, 'src');
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const BROWSER_WRITE_CALLS = new Set(['setDoc', 'updateDoc', 'deleteDoc', 'addDoc', 'writeBatch', 'runTransaction']);
const IGNORED_BROWSER_SEGMENTS = new Set(['server', 'tests', 'lib/db']);

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
  const commandRunners = new Set(['executeCommand', 'previewCommand']);
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child) && commandRunners.has(callName(child) || '')) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function countWriteRoutes(): { total: number; sites: Record<string, number> } {
  const sites: Record<string, number> = {};
  for (const file of walk(ROUTE_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let count = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && WRITE_METHODS.has(callName(node) || '')) {
        const pathNames = stringValues(node.arguments[0]);
        const excluded = pathNames.some(value => /(?:^|\/)\/?(?:admin|system)(?:\/|$)/.test(value.replace(/^\/+/, '')));
        if (!excluded && !containsCommandRunnerCall(node)) count += 1;
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

function countDirectBrowserWrites(): { total: number; sites: Record<string, number> } {
  const sites: Record<string, number> = {};
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
    if (count) sites[path.relative(ROOT, file).split(path.sep).join('/')] = count;
  }
  return { total: Object.values(sites).reduce((sum, n) => sum + n, 0), sites: Object.fromEntries(Object.entries(sites).sort(([a], [b]) => a.localeCompare(b))) };
}

export function scanCommandWrites(): CommandWriteCounts {
  const routes = countWriteRoutes();
  const browser = countDirectBrowserWrites();
  return {
    writeRoutes: routes.total,
    directBrowserWrites: browser.total,
    routeSites: routes.sites,
    browserSites: browser.sites,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(scanCommandWrites(), null, 2));
}
