/**
 * Sonar S9383: a copy is confirmed only when the browser accepted it. copyText answers true after writeText
 * resolves, false when it rejects (permission refused) or the clipboard API is missing (insecure page).
 * copyWithFeedback confirms only a real copy; a refused one shows the text in the error toast so it can be
 * selected by hand (CodeRabbit on #453: an invite link is not on screen).
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toast } from 'sonner';
import { copyText, copyWithFeedback } from '../lib/clipboard';

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

test('a refused copy puts the text itself in the error toast; a real one confirms', async (t) => {
  const success = t.mock.method(toast, 'success', () => '');
  const error = t.mock.method(toast, 'error', () => '');
  withClipboard({ writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  assert.equal(await copyWithFeedback('https://app/invite/abc', 'Invite link copied'), false);
  assert.equal(success.mock.callCount(), 0);
  assert.equal((error.mock.calls[0].arguments[1] as { description: string }).description, 'https://app/invite/abc');
  withClipboard({ writeText: async () => {} });
  assert.equal(await copyWithFeedback('x', 'Invite link copied'), true);
  assert.deepEqual(success.mock.calls[0].arguments, ['Invite link copied']);
});
