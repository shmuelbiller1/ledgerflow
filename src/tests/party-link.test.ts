import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { linkableVendorIds, linkedPair, partyNetPosition } from '../lib/partyLink';
import type { Bill, Invoice } from '../types';
import { expectBrowserPatchDenied, pgWorkspaceCommands } from './helpers/pgWriteBoundary';

/** CA-29: a customer and a vendor that are the same business; net position shown on both pages. */
const customers = [
  { id: 'c1', linkedVendorId: 'v1' },
  { id: 'c2' },
  { id: 'c3', linkedVendorId: 'gone' },
];
const vendorIds = new Set(['v1', 'v2']);

describe('Party link (CA-29)', () => {
  test('the pair is found from either side; a link to a deleted vendor is ignored', () => {
    assert.deepEqual(linkedPair('customer', 'c1', customers, vendorIds), { customerId: 'c1', vendorId: 'v1' });
    assert.deepEqual(linkedPair('vendor', 'v1', customers, vendorIds), { customerId: 'c1', vendorId: 'v1' });
    assert.equal(linkedPair('customer', 'c2', customers, vendorIds), null);
    assert.equal(linkedPair('vendor', 'v2', customers, vendorIds), null);
    assert.equal(linkedPair('customer', 'c3', customers, vendorIds), null);
  });

  test('a vendor already linked to another customer is not offered', () => {
    assert.deepEqual(linkableVendorIds('c2', customers, ['v1', 'v2']), ['v2']);
    assert.deepEqual(linkableVendorIds('c1', customers, ['v1', 'v2']), ['v1', 'v2'], 'its own link stays offered');
  });

  test('net = open invoices to the customer − open bills from the vendor, in the books currency', () => {
    const invoices = [
      { id: 'i1', customerId: 'c1', status: 'sent', amountCents: 10_000, amountPaidCents: 2_500 },
      { id: 'i2', customerId: 'c1', status: 'draft', amountCents: 99_999 },
      { id: 'i3', customerId: 'c2', status: 'sent', amountCents: 5_000 },
      { id: 'i4', customerId: 'c1', status: 'sent', amountCents: 1_000, currency: 'EUR', exchangeRate: 1.1 },
    ] as unknown as Invoice[];
    const bills = [
      { id: 'b1', vendorId: 'v1', status: 'pending', amountCents: 3_000 },
      { id: 'b2', vendorId: 'v1', status: 'void', amountCents: 50_000 },
    ] as unknown as Bill[];
    // 7,500 still owed on i1 + 1,100 (EUR 10.00 at 1.1) on i4; 3,000 owed on b1
    assert.deepEqual(partyNetPosition({ customerId: 'c1', vendorId: 'v1' }, invoices, bills), { receivableCents: 8_600, payableCents: 3_000, netCents: 5_600 });
  });
});

test('only the server command can save linkedVendorId and the database enforces its uniqueness', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, async () => {
  assert.match(fs.readFileSync('supabase/migrations/20261102000000_customer_linked_vendor.sql', 'utf8'), /'linkedVendorId'/);
  const client = new pg.Client({ connectionString: process.env.LF_TEST_DATABASE_URL }); await client.connect();
  const commands = pgWorkspaceCommands();
  const ws = `party_link_${randomBytes(6).toString('hex')}`; const owner = `${ws}_owner`; const cust = `${ws}_c`;
  const vendor = `${ws}_v_acme`;
  try {
    await client.query('insert into public.workspaces (id, data) values ($1, $2)', [ws, { uid: owner, name: 'Party link', currency: 'USD', createdAt: '2026-11-02' }]);
    await client.query('insert into public.customers (id, data) values ($1, $2)', [cust, { workspaceId: ws, name: 'Acme', createdAt: '2026-11-02' }]);
    await client.query('insert into public.vendors (id, data) values ($1, $2)', [vendor, { workspaceId: ws, name: 'Acme vendor' }]);
    await expectBrowserPatchDenied(client, owner, 'customers', cust, { linkedVendorId: vendor });
    const saved = await commands.run(owner, ws, 'customer.update', { id: cust, data: { linkedVendorId: vendor } });
    assert.ok(saved.ok, JSON.stringify(saved));
    assert.equal((await client.query('select data from public.customers where id = $1', [cust])).rows[0].data.linkedVendorId, vendor);
    // one customer per vendor: a second customer linking the same vendor is refused by the database
    await client.query('insert into public.customers (id, data) values ($1, $2)', [`${cust}2`, { workspaceId: ws, name: 'Acme again', createdAt: '2026-11-02' }]);
    await assert.rejects(client.query('update public.customers set data = data || $2 where id = $1', [`${cust}2`, { linkedVendorId: vendor }]), /customers_linked_vendor_uniq|duplicate key/);
    // empty means not linked and never collides
    await client.query('update public.customers set data = data || $2 where id = any($1)', [[cust, `${cust}2`], { linkedVendorId: '' }]);
  } finally {
    await commands.close();
    await client.query('delete from public."auditLogs" where workspace_id = $1', [ws]);
    await client.query('delete from public.vendors where id = $1', [vendor]);
    await client.query('delete from public.customers where id = any($1)', [[cust, `${cust}2`]]);
    await client.query('delete from public.workspaces where id = $1', [ws]);
    await client.end();
  }
});
