/**
 * Sonar S9383: work a screen starts without waiting (inBackground) no longer fails silently. A rejection is logged
 * and shown as one error toast; a success shows nothing; undefined (an optional handler) is ignored.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { toast } from 'sonner';
import { inBackground } from '../lib/inBackground';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('a failure is shown once and logged; a success shows nothing', async (t) => {
  const error = t.mock.method(toast, 'error', () => '');
  t.mock.method(console, 'error', () => {});
  inBackground(Promise.resolve('fine'));
  inBackground(undefined);
  await settle();
  assert.equal(error.mock.callCount(), 0);
  inBackground(Promise.reject(new Error('network down')), 'Could not delete the bill.');
  await settle();
  assert.deepEqual(error.mock.calls.map(c => c.arguments), [['Could not delete the bill.']]);
});
