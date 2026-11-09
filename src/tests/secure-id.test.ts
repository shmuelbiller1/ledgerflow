import test from 'node:test';
import assert from 'node:assert/strict';
import { secureId } from '../lib/secureId';

test('record ids use UUIDs when available', () => {
  const id = secureId('note_');
  assert.match(id || '', /^note_[0-9a-f]{8}-[0-9a-f-]{27}$/);
});

test('record ids use cryptographic bytes when randomUUID is unavailable', () => {
  const source = { getRandomValues: <T extends ArrayBufferView | null>(bytes: T): T => {
    (bytes as Uint8Array).fill(0xab);
    return bytes;
  } };
  assert.equal(secureId('cf_', source), `cf_${'ab'.repeat(16)}`);
  assert.equal(secureId('cf_', { ...source, randomUUID: () => { throw new Error('insecure context'); } }), `cf_${'ab'.repeat(16)}`);
});

test('record id creation refuses an unavailable or failing random source', () => {
  const broken = { getRandomValues: () => { throw new Error('unavailable'); } } as unknown as Pick<Crypto, 'getRandomValues'>;
  assert.equal(secureId('cf_', broken), null);
  assert.equal(secureId('cf_', null), null);
});
