import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const DYNAMIC = '__dynamic_table__';
const SCOPED = '__scoped_table__';
const IDENT = String.raw`(?:"[\w$]+"|[a-z_][\w$]*)`;
const SQL_START = /^\s*(?:select|(?:insert|merge)\s+into|delete\s+from|update|truncate|with\s+(?:recursive\s+)?[\w"]+\s+as\s*\(|to_regclass)\b/i;
const QUALIFIED = new RegExp(String.raw`\b(?:public|sandbox_read|sandbox)"?\s*\.\s*(${IDENT})`, 'gi');
const RELATION = new RegExp(String.raw`\b(?:from\s+|join\s+|into\s+|update\s+|truncate\s+(?:table\s+)?|to_regclass\s*\(\s*')` +
  String.raw`(?:only\s+)?(?:(${IDENT})\s*\.\s*)?(${IDENT})`, 'gi');

function filesIn(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return file === path.join('src', 'server', 'db') ? [] : filesIn(file);
    return /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}

function collectionsFromMigrations(): Set<string> {
  const dir = 'supabase/migrations';
  const names = new Set<string>();
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // The initial migration creates its document tables in a loop; later migrations name them directly.
    const initial = sql.match(/\ball_tables\s+text\[\]\s*:=\s*array\[([^\]]+)\]/i)?.[1] || '';
    for (const [, name] of initial.matchAll(/'([\w]+)'/g)) names.add(name.toLowerCase());
    for (const [, name] of sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\."?(\w+)"?\s*\(/gi)) {
      if (name !== 'lf_rules') names.add(name.toLowerCase());
    }
  }
  return names;
}

function sqlText(node: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return sqlText(node.expression);
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map(({ expression, literal }) => {
      const scoped = ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === 'tableSource';
      return (scoped ? SCOPED : sqlText(expression) ?? DYNAMIC) + literal.text;
    }).join('');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = sqlText(node.left);
    const right = sqlText(node.right);
    if (left !== undefined || right !== undefined) return (left ?? DYNAMIC) + (right ?? DYNAMIC);
  }
  return undefined;
}

/** Source ratchet, not a SQL parser or security boundary. Counts relation references, even in SQL assembled separately from a pool call. */
export function countRawRelations(file: string, source: string, collections: ReadonlySet<string>): number {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let count = 0;
  const isDocument = (identifier: string) => {
    const name = identifier.replaceAll('"', '').toLowerCase();
    return name === DYNAMIC || collections.has(name);
  };
  function visitInterpolations(node: ts.Node) {
    // Inspect expressions not flattened into the SQL, such as the two sides of a conditional join.
    if (ts.isParenthesizedExpression(node)) visitInterpolations(node.expression);
    else if (ts.isTemplateExpression(node)) node.templateSpans.forEach(span => visitInterpolations(span.expression));
    else if (ts.isBinaryExpression(node) && sqlText(node) !== undefined) {
      visitInterpolations(node.left);
      visitInterpolations(node.right);
    } else if (!ts.isStringLiteralLike(node)) visit(node);
  }
  function visit(node: ts.Node) {
    const text = sqlText(node);
    if (text !== undefined) {
      // Qualified names count even when supplied as a SQL fragment or used in a regclass probe.
      for (const [, relation] of text.matchAll(QUALIFIED)) if (isDocument(relation)) count += 1;
      if (SQL_START.test(text)) {
        for (const [, schema, relation] of text.matchAll(RELATION)) {
          if ((!schema || schema.replaceAll('"', '') === DYNAMIC) && isDocument(relation)) count += 1;
        }
      }
      visitInterpolations(node);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return count;
}

export function scanSandboxSql(): Record<string, number> {
  const collections = collectionsFromMigrations();
  const files = [...filesIn('src/server'), ...filesIn('api'), 'server.ts'].sort((a, b) => a.localeCompare(b, 'en'));
  return Object.fromEntries(files.flatMap(file => {
    const count = countRawRelations(file, fs.readFileSync(file, 'utf8'), collections);
    return count ? [[file, count]] : [];
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(scanSandboxSql(), null, 2));
}
