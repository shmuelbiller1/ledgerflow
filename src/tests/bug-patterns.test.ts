import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, scanFinancialIntegrity, counts, type Kind } from '../../scripts/bug-patterns';
import { runOnce, workspaceScope, attempt, allSettledWrites } from '../lib/serverAction';

const found = scan();

test('bug-pattern counts never rise (fix one → lower bug-patterns-baseline.json with --write-baseline)', () => {
  const baseline = JSON.parse(fs.readFileSync('bug-patterns-baseline.json', 'utf8')) as Record<Kind, number>;
  const now = counts(found);
  for (const kind of Object.keys(now) as Kind[]) {
    assert.ok(now[kind] <= (baseline[kind] ?? 0),
      `${kind}: ${now[kind]} > baseline ${baseline[kind] ?? 0}. New places:\n` +
      found.filter(f => f.kind === kind).map(f => `  ${f.file}:${f.line} ${f.name}`).join('\n'));
  }
});

// An aggregate ratchet alone is insufficient: a newly introduced risk can replace an old
// finding with no rise in the total. Track the number of findings at EACH function and file.
test('no new client risk at an existing or previously clean function', () => {
  const siteBaseline = JSON.parse(fs.readFileSync('bug-patterns-sites.json', 'utf8')) as Record<string, number>;
  const current: Record<string, number> = {};
  for (const f of found) {
    const key = [f.kind, f.file, f.name].join('|');
    current[key] = (current[key] || 0) + 1;
  }
  const additions = Object.entries(current)
    .filter(([key, n]) => n > (siteBaseline[key] ?? 0))
    .map(([key, n]) => `${key}: ${n} > ${siteBaseline[key] ?? 0}`);
  assert.deepEqual(additions, [], 'New locations need a fix, not an increased baseline');
});

test('financial scanner detects each #112–#114 failure mechanism and SQL trust boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-scanner-'));
  try {
    const put = (file: string, text: string) => {
      const dest = path.join(root, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text);
    };
    put('src/server/routes/transactions/bulkRoutes.ts', `
      async function bulk(batch: any, ref: any, updates: any[]) {
        for (const updateData of updates) {
          batch.update(ref, { ...updateData, updatedAt: new Date() });
          await batch.commit();
        }
      }`);
    put('src/server/routes/paymentRoutes.ts', `
      async function payment(db: any, payload: any) { return createPaymentAtomic(db, payload); }`);
    put('supabase/migrations/2026_guard.sql', `
      create function public.lf_guard() returns trigger as $
      begin
        if not public.lf_is_client() then return coalesce(new,old); end if;
      end; $ language plpgsql;`);
    const risks = scanFinancialIntegrity(root);
    for (const kind of ['server-unrestricted-ledger-patch', 'server-partial-batch-commit',
      'server-unkeyed-payment-path', 'sql-trusted-server-exemption']) {
      assert.ok(risks.some(f => f.kind === kind), `Scanner missed ${kind}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('financial scanner reads the real server and migration tree (not just screen code)', () => {
  const risks = scanFinancialIntegrity();
  assert.ok(risks.some(f => f.file.startsWith('src/server/')), 'Server was not scanned');
  assert.ok(risks.some(f => f.file.startsWith('supabase/migrations/')), 'SQL migrations were not scanned');
  // The three known high-risk endpoints must remain explicitly in view until their code is
  // made safe; after fixing each, move its scenario into a database integration test.
  // #112 and #113 were repaired on 13 Oct (allowed fields only; one transaction): the scanner must
  // no longer find them. Their behaviour is tested against the database in transaction-batch-safety.
  assert.ok(!risks.some(f => f.issue === 112), '#112 came back: batch edits must use the allowed-field list');
  assert.ok(!risks.some(f => f.issue === 113), '#113 came back: batch edits must commit in one transaction');
  assert.ok(risks.some(f => f.issue === 114), '#114 backwards-compatible unkeyed payment path not detected');
});

// A file-level check was too weak: any unrelated finding in the file could masquerade as
// coverage. Track each of the 13 financial/data-safety issue mechanisms independently,
// including the two repaired call sites; these probes are recall checks, NOT functional proof.
const ISSUE_MECHANISMS: Array<{ issue: number; file: string; markers: string[] }> = [
  { issue: 97, file: 'src/components/collaboration/TimeView.tsx', markers: ['const makeInvoice', 'unlinked.current.get(hours)'] }, // repaired: retry links the saved invoice
  { issue: 98, file: 'src/server/services/timeService.ts', markers: ['export async function moveTime', 'await db.runTransaction(async tx'] }, // repaired: all-or-nothing
  { issue: 99, file: 'src/components/collaboration/TimeTimer.tsx', markers: ['read(workspaceId)', 'setRunning'] },
  { issue: 100, file: 'src/hooks/useLedgerData.ts', markers: ['const loadReferenceData', 'setAnalyticalPatternCache'] },
  { issue: 101, file: 'src/components/ledger/StatementImporter.tsx', markers: ['parseCsvChecked(text)', 'never $0'] }, // repaired: shared RFC 4180 reader (PREV-6: refuses an unclosed quote)
  { issue: 102, file: 'src/components/ledger/StatementImporter.tsx', markers: ['handleFileUpload', 'setCsvData'] },
  { issue: 105, file: 'src/components/banking/TransferModal.tsx', markers: ['retryRef.current.operationId', 'txActions.handleQuickAdd'] },
  { issue: 106, file: 'src/components/banking/TransferModal.tsx', markers: ['candidate.outflowTx, candidate.inflowTx', "'/api/v1/transactions/batch'"] }, // repaired: one all-or-nothing request
  { issue: 107, file: 'src/hooks/transactionActions/entryActions.ts', markers: ['if (!scope.isCurrent()) return false;'] }, // repaired: no write after a book switch
  { issue: 108, file: 'src/components/ledger/TransactionGrid.tsx', markers: ['const handleBulkSweep', 'were not saved (see the messages above)'] }, // repaired: only confirmed saves counted
  { issue: 109, file: 'src/components/purchases/PaymentRunDialog.tsx', markers: ['if (withFile && done.length) downloadBankFile(done)'] },
  { issue: 110, file: 'src/components/ledger/StatementImporter.tsx', markers: ['if (stored === false) return;'] }, // repaired: review stays open
  { issue: 111, file: 'src/hooks/transactionActions/importActions.ts', markers: ['const handleParseReceipt', "was read but the entry was not saved"] }, // repaired: not done unless saved
];
test('all 13 issue mechanisms have explicit call-site recall (not just any finding in eight files)', () => {
  assert.equal(ISSUE_MECHANISMS.length, 13);
  assert.equal(new Set(ISSUE_MECHANISMS.map(x => x.issue)).size, 13);
  const missing = ISSUE_MECHANISMS.flatMap(({ issue, file, markers }) => {
    const source = fs.readFileSync(file, 'utf8');
    return markers.filter(marker => !source.includes(marker)).map(marker => `#${issue} ${file}: missing ${marker}`);
  });
  assert.deepEqual(missing, [], 'Update issue-specific regression coverage whenever an implementation changes');
});

test('runOnce: a second click while saving reuses the first request', async () => {
  let calls = 0;
  const slow = () => new Promise<number>(r => setTimeout(() => r(++calls), 10));
  const [a, b] = await Promise.all([runOnce('k', slow), runOnce('k', slow)]);
  assert.equal(calls, 1); assert.equal(a, b);
  await runOnce('k', slow); assert.equal(calls, 2);
});

test('workspaceScope: results after a book switch are recognised as stale', () => {
  let ws = 'A';
  const scope = workspaceScope(() => ws);
  assert.equal(scope.isCurrent(), true);
  ws = 'B';
  assert.equal(scope.isCurrent(), false);
});

test('attempt and allSettledWrites report failures instead of hiding them', async () => {
  assert.deepEqual(await attempt(async () => { throw new Error('refused'); }), { ok: false, error: 'refused' });
  const r = await allSettledWrites([1, 2, 3], async n => { if (n === 2) throw new Error('no'); return n; });
  assert.equal(r.allOk, false);
  assert.deepEqual(r.done.map(d => d.item), [1, 3]);
  assert.deepEqual(r.failures, [{ item: 2, error: 'no' }]);
});

test('#114 operationIdFor: the same payment keeps its id across retries; a changed payment gets a new one', async () => {
  const { operationIdFor } = await import('../lib/serverAction');
  const ids = new Map<string, string>();
  const a = operationIdFor(ids, '{"amountCents":100}');
  assert.equal(operationIdFor(ids, '{"amountCents":100}'), a);
  assert.notEqual(operationIdFor(ids, '{"amountCents":200}'), a);
});

test('AU-6: ledger entries written outside the door (src/server/services/ledgerDoor.ts) never increase', () => {
  const baseline = JSON.parse(fs.readFileSync('ledger-door-baseline.json', 'utf8')) as {
    'server-direct-ledger-write': number;
    sites?: Record<string, number>;
  };
  const max = baseline['server-direct-ledger-write'];
  const direct = scanFinancialIntegrity().filter(f => f.kind === 'server-direct-ledger-write');
  assert.ok(direct.length <= max, `${direct.length} direct ledger writes > ${max}. Use ledgerWrite() from src/server/services/ledgerDoor.ts:\n` + direct.map(f => `  ${f.file}:${f.line}`).join('\n'));
  if (baseline.sites) {
    const byFile: Record<string, number> = {};
    for (const f of direct) byFile[f.file] = (byFile[f.file] || 0) + 1;
    const siteAdditions = Object.entries(byFile)
      .filter(([file, n]) => n > (baseline.sites?.[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} > ${baseline.sites?.[file] ?? 0}`);
    assert.deepEqual(siteAdditions, [], 'New direct ledger write outside ledgerDoor.ts; route through ledgerWrite()/ledgerCreate()/ledgerMark()');
  }
});

test('#657: financial scanner catches variable-held collection("transactions") doc references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-door-var-'));
  try {
    const dest = path.join(root, 'src/server/routes/sampleRoute.ts');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `
      export async function bypass(db: any, t: any, id: string) {
        const txCol = db.collection('transactions');
        const txRef = txCol.doc(id);
        const directRef = db.collection('transactions').doc(id);
        t.update(txRef, { amountCents: 100 });
        t.create(directRef, { amountCents: 200 });
      }
    `);
    const direct = scanFinancialIntegrity(root).filter(f => f.kind === 'server-direct-ledger-write');
    assert.equal(direct.length, 2);
    assert.deepEqual(direct.map(f => f.name), ['update', 'create']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AU-6: the door refuses entries that could not be valid', async () => {
  const { checkLedgerEntry } = await import('../server/services/ledgerDoor');
  const ok = { workspaceId: 'w', totalAmountCents: 500, lines: [{ accountId: 'a', amountCents: 500 }, { accountId: 'b', amountCents: -500 }] };
  assert.doesNotThrow(() => checkLedgerEntry(ok));
  assert.throws(() => checkLedgerEntry({ ...ok, workspaceId: '' }), /workspace/);
  assert.throws(() => checkLedgerEntry({ ...ok, lines: [{ accountId: 'a', amountCents: 500 }, { accountId: 'b', amountCents: -400 }] }));
  assert.throws(() => checkLedgerEntry({ ...ok, lines: [{ accountId: 'a', amountCents: 5.5 }, { accountId: 'b', amountCents: -5.5 }] }), /whole cents/);
  assert.throws(() => checkLedgerEntry({ ...ok, totalAmountCents: 900 }), /does not match/);
});
