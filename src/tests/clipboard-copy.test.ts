/**
 * Sonar S9383: a copy is confirmed only when the browser accepted it. copyText answers true after writeText
 * resolves, false when it rejects (permission refused) or the clipboard API is missing (insecure page).
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../lib/clipboard';

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const withClipboard = (clipboard: unknown) => Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
afterEach(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); });

test('true once the browser takes the text', async () => {
  const written: string[] = [];
  withClipboard({ writeText: async (t: string) => { written.push(t); } });
  assert.equal(await copyText('sk_live_123'), true);
  assert.deepEqual(written, ['sk_live_123']);
});

test('false when the browser refuses, or has no clipboard', async () => {
  withClipboard({ writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  assert.equal(await copyText('x'), false);
  withClipboard(undefined);
  assert.equal(await copyText('x'), false);
});
