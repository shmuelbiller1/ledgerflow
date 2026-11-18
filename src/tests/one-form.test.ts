/**
 * One form, generated from the command it submits.
 *
 * There were two: this one, which reads a command's input schema, and a `SchemaForm` that took a zod object and
 * worked out its fields itself. The second had no callers — `ChartOfAccountsView` imported it as
 * `SchemaForm as _SchemaForm` and never rendered it — so it read as a live alternative while being dead code that
 * every form-related change had to be checked against. These tests keep the count at one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.join('src');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

test('the second form system is gone, and no file still points at it', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'components', 'common', 'SchemaForm.tsx')), false);
  // a *reference* is an import or a render, not the word in a comment: the history of this file is worth keeping
  // in prose, and a docstring that says "there used to be a SchemaForm" must not fail the guard
  const references = sources(ROOT).filter(file => file !== path.join(ROOT, 'tests', 'one-form.test.ts')).filter(file => /import[^\n]*SchemaForm|from\s+['"][^'"]*SchemaForm['"]|<SchemaForm\b/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(references, [], 'a form is only the one the app has');
});

test('the one form builds its fields from the command schema, and a screen renders it', () => {
  const source = fs.readFileSync(path.join(ROOT, 'components', 'common', 'CommandForm.tsx'), 'utf8');
  assert.match(source, /formForCommand\(/, 'the fields come from the command, not from a list kept by hand');
  assert.match(source, /buildCommandInput\(/, 'and what it submits is that command’s input');
  const callers = sources(ROOT)
    .filter(file => !file.includes(`${path.sep}tests${path.sep}`))
    .filter(file => file !== path.join(ROOT, 'components', 'common', 'CommandForm.tsx'))
    .filter(file => /<CommandForm\b/.test(fs.readFileSync(file, 'utf8')));
  assert.ok(callers.length > 0, 'a form nobody renders is the state this test exists to prevent');
  for (const caller of callers) {
    assert.match(fs.readFileSync(caller, 'utf8'), /import\s+CommandForm|CommandForm\s*}/, `${caller} renders the form it imports`);
  }
});
