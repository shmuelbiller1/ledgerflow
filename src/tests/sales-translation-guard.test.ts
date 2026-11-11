import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const salesPath = fileURLToPath(new URL('../components/sales/Sales.tsx', import.meta.url));

test('Sales screen has no untranslated literal JSX text nodes', () => {
  const sourceText = fs.readFileSync(salesPath, 'utf8');
  const source = ts.createSourceFile(salesPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const untranslated: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const visibleText = node.getText(source).replace(/\s+/g, ' ').trim();
      if (/[\p{L}\p{N}]/u.test(visibleText)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        untranslated.push(`${line}: ${visibleText}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  assert.deepEqual(untranslated, [], 'Wrap new visible Sales text with salesText and add its EN/HE dictionary entry.');
});
