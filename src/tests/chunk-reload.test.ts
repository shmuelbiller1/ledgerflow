import test from 'node:test';
import assert from 'node:assert/strict';
import { isChunkLoadFailure, reloadOnceForNewVersion } from '../lib/chunkReload';

test('a missing screen file after a new deploy is recognised', () => {
  assert.equal(isChunkLoadFailure(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Sales-DGif2lGR.js')), true);
  assert.equal(isChunkLoadFailure(new Error('Importing a module script failed.')), true);
  assert.equal(isChunkLoadFailure(new Error('Cannot read properties of undefined')), false);
});

test('reloads once, then not again within a minute (no reload loop)', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  let reloads = 0;
  assert.equal(reloadOnceForNewVersion(1_000_000, storage, () => reloads++), true);
  assert.equal(reloadOnceForNewVersion(1_030_000, storage, () => reloads++), false);
  assert.equal(reloadOnceForNewVersion(1_070_000, storage, () => reloads++), true);
  assert.equal(reloads, 2);
});

test('no automatic reload while there is unsaved work on screen', async () => {
  const { reloadForNewVersionUnlessUnsaved } = await import('../lib/chunkReload');
  let reloads = 0;
  const reload = () => { reloads += 1; return true; };
  assert.equal(reloadForNewVersionUnlessUnsaved(() => true, reload), false);
  assert.equal(reloads, 0);
  assert.equal(reloadForNewVersionUnlessUnsaved(() => false, reload), true);
  assert.equal(reloads, 1);
  // a check that fails is treated as "there may be unsaved work"
  assert.equal(reloadForNewVersionUnlessUnsaved(() => { throw new Error('x'); }, reload), false);
  assert.equal(reloads, 1);
});
