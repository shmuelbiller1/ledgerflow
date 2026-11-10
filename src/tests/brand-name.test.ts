/**
 * The product name lives in src/config/brand.ts only (so it can be renamed in one place).
 * This fails when a screen, message, file name, page title or email source spells the name out
 * instead of reading it from BRAND. Comments and code identifiers do not count.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { BRAND } from '../config/brand';

const ROOT = process.cwd();
const NAME = new RegExp(BRAND.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const SLUG_FILE = new RegExp(`['"\`]${BRAND.fileSlug}[-_][^'"\`]*\\.(csv|json|txt|zip|ofx|iif|pdf)`);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

test('no screen text or string in the app spells out the product name', () => {
  const found: string[] = [];
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    if (file.endsWith(path.join('config', 'brand.ts'))) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!NAME.test(text) && !SLUG_FILE.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      const literal = ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
      if (literal) {
        const value = node.getText(sf);
        if (NAME.test(value) || SLUG_FILE.test(value)) {
          found.push(`${path.relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${value.slice(0, 80)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  assert.deepEqual(found, [], `use BRAND from src/config/brand.ts instead of writing the name:\n${found.join('\n')}`);
});

test('the page shell, installed-app settings and email sources take the name from BRAND', () => {
  const check = (rel: string) => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter(line => !/^\s*(\/\/|\*|<!--)/.test(line)).join('\n');
    assert.ok(!NAME.test(text), `${rel} writes the product name; use the BRAND placeholders`);
  };
  check('index.html');
  check('vite.config.ts');
  for (const file of fs.readdirSync(path.join(ROOT, 'supabase/templates/src'))) check(`supabase/templates/src/${file}`);
});
