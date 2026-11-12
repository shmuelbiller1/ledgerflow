/** EU-B5: a reversible change is made at once with "Done · Undo"; Undo saves the exact previous value; a failed save offers nothing. */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toast } from 'sonner';
import { changeWithUndo, UNDO_MS } from '../lib/undoableChange';

const real = toast.success;
afterEach(() => { (toast as { success: unknown }).success = real; });

test('EU-B5: archived at once; Undo puts back the status it had (not a default)', async () => {
  const shown: Array<{ text: string; duration?: number; undo?: () => void }> = [];
  (toast as { success: unknown }).success = (text: string, opts?: { duration?: number; action?: { onClick: () => void } }) => { shown.push({ text, duration: opts?.duration, undo: opts?.action?.onClick }); return 1; };
  const saved: string[] = [];
  const ok = await changeWithUndo({ done: '"Acme" archived', undone: '"Acme" is back as it was', before: 'on-hold', after: 'inactive', save: async v => { saved.push(v); return true; } });
  assert.equal(ok, true);
  assert.deepEqual(saved, ['inactive'], 'no question first');
  assert.deepEqual([shown[0].text, shown[0].duration], ['"Acme" archived', UNDO_MS]);
  assert.equal(UNDO_MS, 10_000);
  shown[0].undo!();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(saved, ['inactive', 'on-hold'], 'the exact previous value');
  assert.equal(shown[1].text, '"Acme" is back as it was');
});

test('EU-B5: a save that failed shows no Done and no Undo', async () => {
  let shown = 0;
  (toast as { success: unknown }).success = () => { shown++; return 1; };
  assert.equal(await changeWithUndo({ done: 'x', undone: 'y', before: 1, after: 2, save: async () => false }), false);
  assert.equal(shown, 0);
});
