/**
 * Independent audit Pass A — AF-001 durable bank cursor.
 * The route's pagination helper (syncAllPages) has executable tests in plaid-sync-cursor.test.ts.
 * Fixed (#151, AI #1): /sync stores the downloaded rows as bank lines in the same database
 * transaction that moves syncCursor (src/server/services/plaidIngest.ts; behaviour proved against a
 * real database in plaid-sync-ingest.test.ts). This file pins that contract in the source so the
 * cursor can never again be saved on its own.
 * Evidence: audit/function-audit/AF-001-bank-cursor-durability.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

test('AF-001-F1 (fixed): /sync saves syncCursor only together with the rows, in one transaction', () => {
  const route = read('src/server/routes/plaidRoutes.ts');
  const ingest = read('src/server/services/plaidIngest.ts');
  // the cursor is part of the update handed to storePlaidSync, never a bank update of its own
  assert.match(route, /storePlaidSync\(db,[\s\S]*bankUpdate:[\s\S]*syncCursor:\s*nextCursor/, 'cursor travels with the rows');
  assert.equal(/doc\.ref\.update\(\{[^}]*syncCursor/.test(route), false, 'no bank update saves the cursor on its own');
  // the rows and the cursor are written inside one runTransaction
  assert.match(ingest, /runTransaction\(async \(t\) => \{[\s\S]*t\.create\(db\.collection\('bankLines'\)[\s\S]*t\.update\(db\.collection\('banks'\)/, 'lines and cursor in one transaction');
});

test('AF-001-F2: the Banking screen "Sync Feed" path needs no rows of its own (the server stores them)', () => {
  const banking = read('src/components/banking/Banking.tsx');
  assert.match(banking, /fetch\('\/api\/v1\/plaid\/sync'/, 'the sync call exists');
  // the payload fields exist in the response but only toasts are derived from them
  assert.equal(/data\.transactions|data\.modified|data\.removed/.test(banking), false,
    'the screen only reports the result; the rows are already bank lines on the server (F1)');
});

test('AF-001-F3: the legacy feed importer ignores modified/removed and only stages added rows for review', () => {
  const importer = read('src/components/ledger/BankFeedImport.tsx');
  assert.match(importer, /fetch\('\/api\/v1\/plaid\/sync'/, 'the importer calls sync');
  assert.match(importer, /data\.transactions\s*\|\|\s*\[\]/, 'only added rows are mapped into the review list');
  assert.equal(/data\.modified|data\.removed/.test(importer), false,
    'OBSERVED GAP: bank-side modifications and deletions are never applied');
  assert.match(importer, /accountId:\s*'offset-bank'/, 'legacy importer still emits the hardcoded offset-bank account id');
});

test('AF-001-F4: a healthy sync with zero changes still reports success:false in the JSON contract', () => {
  const route = read('src/server/routes/plaidRoutes.ts');
  assert.match(route, /success:\s*transactions\.length\s*>\s*0/,
    'OBSERVED CONTRACT: zero-change sync responds success:false even though the cursor advanced fine');
});
