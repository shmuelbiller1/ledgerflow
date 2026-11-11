import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LEDGER_COLLECTIONS, isCollectionCapped, anyCollectionCapped, type LedgerKey } from '../lib/ledgerCollections';

/**
 * A completeness flag that can never be true is worse than no flag: the screen shows a figure worked
 * out from a list cut at its cap and says nothing.
 *
 * `useLedgerStore.truncatedCollections` is keyed by **database collection name** — the live
 * subscriber records `setCollectionTruncated(spec.collection, …)` (src/hooks/useLedgerData.ts) —
 * while the store keys the same data by field name. For every collection but one the two are the
 * same string, so `truncated.accounts` reads as correct code and is never true: accounts load from
 * `chartAccounts` (src/lib/ledgerCollections.ts:29). Twelve screens had that bug (Israel VAT,
 * financial ratios, cash flow, transfers, party trial balance, the accountant pack, dashboards…).
 *
 * Screens now ask `isCollectionCapped(truncated, key)` / `anyCollectionCapped(truncated, keys)`,
 * and this test fails if a file indexes the map with a store key again.
 */
describe('Truncation key space: store keys vs database collection names', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });

  test('the helper reads the database collection name, so chartAccounts is not missed', () => {
    assert.equal(isCollectionCapped({ chartAccounts: true }, 'accounts'), true);
    assert.equal(isCollectionCapped({ accounts: true }, 'accounts'), false, 'nobody writes the store key');
    assert.equal(anyCollectionCapped({ chartAccounts: true }, ['customers', 'accounts']), true);
    assert.equal(anyCollectionCapped({}, ['customers', 'accounts']), false);
    // the two key spaces really do differ, and only here
    const differing = (Object.keys(LEDGER_COLLECTIONS) as LedgerKey[]).filter(k => LEDGER_COLLECTIONS[k].collection !== k);
    assert.deepEqual(differing, ['accounts']);
  });

  test('no screen indexes the truncation map with a collection key', () => {
    // `truncatedX[key]`, `truncatedX?.key`, `truncatedX.key` where key is a store key that is not the collection name
    const differing = (Object.keys(LEDGER_COLLECTIONS) as LedgerKey[]).filter(k => LEDGER_COLLECTIONS[k].collection !== k);
    const offenders: string[] = [];
    for (const file of [...files('src/components'), ...files('src/hooks')]) {
      const source = readFileSync(file, 'utf-8');
      for (const key of differing) {
        // a literal index, e.g. truncated.accounts / truncated['accounts'] / truncated?.['accounts']
        const literal = new RegExp(`(?:truncated\\w*|truncatedCollections)\\??\\.\\[?['"]${key}['"]?\\]?`);
        if (literal.test(source)) offenders.push(`${file}: ${key}`);
      }
      // a variable index over a list of store keys: the call must go through the helper
      for (const line of source.split('\n')) {
        if (!/(truncated\w*|truncatedCollections)\s*(\?\.)?\[(key|k|collection|c)\b/.test(line)) continue;
        if (/isCollectionCapped|anyCollectionCapped|DataStatusBar|browserProvenance|useServer\w+/.test(line)) continue;
        offenders.push(`${file}: ${line.trim().slice(0, 120)}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test('the live subscriber still records truncation under the database collection name', () => {
    const content = readFileSync(join(process.cwd(), 'src/hooks/useLedgerData.ts'), 'utf-8');
    assert.ok(content.includes('setCollectionTruncated(spec.collection, entryListPartial('),
      'the subscriber records truncation by spec.collection; screens must map store keys to it');
  });
});
