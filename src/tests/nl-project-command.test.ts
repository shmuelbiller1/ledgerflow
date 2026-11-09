import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNaturalLanguageEntry } from '../lib/algorithms/nl-parser';

test('project command parsing preserves the original grammar for separators and line breaks', () => {
  const old = /^(?:new\s+)?(?:book\s+|realestate\s+|property\s+)?project\s*[:\s]\s*(.+)$/i;
  const prefixes = ['project', 'new project', 'book project', 'new property project'];
  const separators = ['', ' ', ':', ' : ', '\n', '\t:\n'];
  const names = ['', ':', 'Alpha', 'שלום', 'A\nB'];
  for (const prefix of prefixes) for (const separator of separators) for (const name of names) {
    const input = `${prefix}${separator}${name}`.trim();
    const match = old.exec(input);
    const actual = parseNaturalLanguageEntry(input);
    if (match) {
      assert.equal(actual.type, 'project', JSON.stringify(input));
      assert.equal(actual.projectName, match[1].trim(), JSON.stringify(input));
    } else assert.notEqual(actual.type, 'project', JSON.stringify(input));
  }
});

test('project command rejects long malformed input without backtracking on whitespace', () => {
  const input = `project${' '.repeat(100_000)}:Name\nextra`;
  assert.notEqual(parseNaturalLanguageEntry(input).type, 'project');
});
