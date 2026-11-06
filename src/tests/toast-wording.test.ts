/**
 * F-16 — every error toast says what happened and what to do.
 *
 * A message a person reads must be a sentence, not "Error" or "Failed". This guard reads
 * the literal first argument of every `toast.error(...)` / `toast.warning(...)` call in the
 * screens and hooks and fails on the bare words. Calls that pass a variable are checked by
 * their `describeFailure`/`errorText` helper instead (the helpers are covered by their own
 * tests), so the guard never pretends a dynamic message was inspected.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function filesIn(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

const BARE = /^(error|failed|failure|oops|something went wrong|invalid|problem)\.?$/i;

export function literalToastMessages(source: string): Array<{ message: string; line: number }> {
  const found: Array<{ message: string; line: number }> = [];
  source.split('\n').forEach((line, index) => {
    const call = line.match(/toast\.(?:error|warning)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/);
    if (call) found.push({ message: call[2], line: index + 1 });
  });
  return found;
}

describe('F-16 toast wording', () => {
  test('no error toast is a bare word', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const file of [...filesIn('src/components'), ...filesIn('src/hooks')]) {
      for (const { message, line } of literalToastMessages(fs.readFileSync(file, 'utf8'))) {
        checked += 1;
        if (BARE.test(message.trim()) || message.trim().split(/\s+/).length < 2) {
          bad.push(`${file}:${line} — "${message}"`);
        }
      }
    }
    assert.ok(checked > 20, `only ${checked} literal toast messages found; the scan is not looking at the screens`);
    assert.deepEqual(bad, [], `Toasts that do not say what happened:\n${bad.join('\n')}`);
  });

  test('the rule recognises the wordings it forbids', () => {
    const sample = [
      "toast.error('Error');",
      'toast.warning("Failed");',
      "toast.error('Please choose a bank account before posting');",
      'toast.error(errorText(err));',
    ].join('\n');
    const messages = literalToastMessages(sample).map(m => m.message);
    assert.deepEqual(messages, ['Error', 'Failed', 'Please choose a bank account before posting']);
    assert.equal(messages.filter(m => BARE.test(m)).length, 2);
  });
});
