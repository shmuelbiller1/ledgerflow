// Real bill document posting route on isolated Postgres + assetCandidates register-vs-GL tie-out.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { assetCandidates } from '../../src/lib/assetFromBill';
import { lineAmount } from '../../src/lib/txFilters';
import type { Bill, ChartAccount, Transaction } from '../../src/types';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('assetCandidates copies raw bill split amountCents instead of net home-currency Equipment GL cost', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../../src/server/db/firestore');
  const { documentPostRouter } = await import('../../src/server/routes/documentPostRoutes');
  const db = getDb();
  const ws = `ws_audit_astbill_${crypto.randomBytes(5).toString('hex')}`;
  const id = (s: string) => `${ws}_${s}`;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as never as { user: { uid: string; email: string } }).user = { uid: 'audit-owner', email: 'audit@example.test' };
    next();
  });
  app.use('/api/v1/documents', documentPostRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await db.collection('workspaces').doc(ws).set({ uid: 'audit-owner', members: ['audit-owner'], name: 'Synthetic Asset Bill Tie-Out', currency: 'USD', timezone: 'UTC' });
    await db.collection('vendors').doc(id('vendor')).set({ workspaceId: ws, name: 'Machine Supplier' });
    for (const [key, name, type, category] of [
      ['cash', 'Cash', 'asset', 'Cash'],
      ['equip', 'Equipment', 'asset', 'Fixed Assets'],
      ['ap', 'Accounts Payable', 'liability', 'Payables'],
      ['tax', 'Input Tax Recoverable', 'asset', 'Current Assets'],
      ['exp', 'Operating Expense', 'expense', 'Operating Expenses'],
    ]) {
      await db.collection('chartAccounts').doc(id(key)).set({ workspaceId: ws, name, type, category });
    }
    await db.collection('workspaces').doc(ws).update({ defaultAccountMappings: { ap: id('ap'), taxAsset: id('tax') } });

    async function postBill(billId: string, data: Record<string, unknown>) {
      const res = await fetch(`${base}/api/v1/documents/bills/${billId}/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: ws, action: 'create', data }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
    }

    // Bill 1: Foreign EUR 10,000.00 at 1.15 USD/EUR -> Equipment GL debited $11,500.00 (1,150,000 USD cents)
    await postBill(id('bill_fx'), {
      id: id('bill_fx'), workspaceId: ws, vendorId: id('vendor'), vendorName: 'Machine Supplier', number: 'B-FX-1',
      date: '2026-03-01', issueDate: '2026-03-01', dueDate: '2026-03-31', status: 'unpaid',
      currency: 'EUR', exchangeRate: 1.15, amountCents: 1_000_000, taxAmountCents: 0,
      splits: [{ accountId: id('equip'), accountName: 'Equipment', description: 'CNC Lathe', amountCents: 1_000_000 }],
    });

    // Bill 2: Tax-inclusive USD $1,100.00 gross including $100.00 recoverable input tax -> Equipment GL debited $1,000.00 (100,000 USD cents)
    await postBill(id('bill_vat'), {
      id: id('bill_vat'), workspaceId: ws, vendorId: id('vendor'), vendorName: 'Machine Supplier', number: 'B-VAT-1',
      date: '2026-03-02', issueDate: '2026-03-02', dueDate: '2026-03-31', status: 'unpaid',
      currency: 'USD', exchangeRate: 1, amountCents: 110_000, taxAmountCents: 10_000, taxInclusive: true, taxVersion: 2,
      splits: [{ accountId: id('equip'), accountName: 'Equipment', description: 'Drill Press', amountCents: 110_000 }],
    });

    const accounts = (await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
    const bills = (await db.collection('bills').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Bill);
    const txs = (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Transaction);

    const candidates = assetCandidates(bills, accounts, []);
    const fxCand = candidates.find(c => c.billId === id('bill_fx'))!;
    const vatCand = candidates.find(c => c.billId === id('bill_vat'))!;

    const glEquipFor = (billId: string) => {
      const tx = txs.find(t => t.metadata?.billId === billId || String(t.description || '').includes(billId === id('bill_fx') ? 'B-FX-1' : 'B-VAT-1'))!;
      return (tx.lines || []).filter(l => l.accountId === id('equip')).reduce((s, l) => s + lineAmount(l, tx), 0);
    };

    assert.equal(glEquipFor(id('bill_fx')), 1_150_000); // $11,500.00 in Equipment GL
    assert.equal(fxCand.costCents, 1_000_000);          // $10,000.00 populated in Fixed Asset Register ($1,500.00 understated!)

    assert.equal(glEquipFor(id('bill_vat')), 100_000);  // $1,000.00 in Equipment GL ($100.00 went to Input Tax Recoverable)
    assert.equal(vatCand.costCents, 110_000);           // $1,100.00 populated in Fixed Asset Register ($100.00 recoverable VAT capitalized!)

    console.log(JSON.stringify({
      fxBillGlEquipmentCents: glEquipFor(id('bill_fx')),
      fxAssetCandidateCostCents: fxCand.costCents,
      taxInclusiveBillGlEquipmentCents: glEquipFor(id('bill_vat')),
      taxInclusiveAssetCandidateCostCents: vatCand.costCents,
    }));
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    for (const table of ['transactions', 'bills', 'vendors', 'chartAccounts', 'auditLogs', 'idempotencyKeys', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`, [ws]);
    }
    await db.terminate();
  }
});
