import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEDGER_COLLECTIONS } from '../lib/ledgerCollections';

describe('Truncation Guard Suite (AA-05)', () => {
  test('every live collection is capped and records when the cap is reached', () => {
    const content = readFileSync(join(process.cwd(), 'src/hooks/useLedgerData.ts'), 'utf-8');
    // one subscriber serves every collection in src/lib/ledgerCollections.ts
    const subscriber = content.slice(content.indexOf('function subscribeLedgerCollection'));
    assert.ok(subscriber.includes('limit(spec.cap)'), 'the live subscriber must apply the cap');
    // L-123 step 4: partial at the cap, or when the closed years are left to the server (entryListPartial)
    assert.ok(subscriber.includes('setCollectionTruncated(spec.collection, entryListPartial(snap.docs.length, spec.cap, closedThrough))'),
      'the live subscriber must record truncation');
    for (const [key, spec] of Object.entries(LEDGER_COLLECTIONS)) assert.ok(spec.cap > 0, `${key} needs a cap`);
    assert.equal((content.match(/onSnapshot\(query\(collection\(db, spec\.collection\)/g) || []).length, 1,
      'collections load through the one subscriber, not hand-written listeners');
  });

  test('static capped getDocs queries in useLedgerData also record truncation', () => {
    const content = readFileSync(join(process.cwd(), 'src/hooks/useLedgerData.ts'), 'utf-8');
    for (const coll of ['customTemplates', 'partners', 'rulePatterns', 'dimensionNodes']) {
      assert.ok(content.includes(`setCollectionTruncated('${coll}'`),
        `Static query for ${coll} must record truncation via setCollectionTruncated`);
    }
  });

  test('a failed reference-data load marks the dimension labels incomplete, not complete-and-empty', () => {
    const content = readFileSync(join(process.cwd(), 'src/hooks/useLedgerData.ts'), 'utf-8');
    const loader = content.slice(content.indexOf('const loadReferenceData'), content.indexOf('void loadReferenceData()'));
    const failure = loader.slice(loader.lastIndexOf('} catch (err) {'));
    assert.ok(failure.includes("setCollectionTruncated('dimensionNodes', true)"), 'the catch must mark the dimension nodes incomplete');
    assert.ok(failure.includes('!nodesSettled'), 'only when the nodes were not already set');
  });
});
