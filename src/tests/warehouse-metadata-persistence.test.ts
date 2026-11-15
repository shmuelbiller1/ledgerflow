import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import pg from 'pg';
import { binLocationFieldPath, createShipmentRecord, shipmentFieldPath, shipmentSourcesForOrder } from '../lib/warehouseWorkflows';
import {
  createReturnAuthorization, createWarrantyRecord, returnAuthorizationsFromMetadata,
  rmaFieldPath, warrantyCandidates, warrantyFieldPath, warrantyRecordsFromMetadata,
} from '../lib/warehouseRecords';
import type { Customer, Estimate, InventoryItem, Invoice } from '../types';
import { createCommandRouter } from '../server/routes/commandRoutes';

/** Real migrated Postgres/RLS: metadata annotations use the field-path RPC; protected histories use server workflows. */
describe('Warehouse metadata persistence (A-64–A-67)', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const workspaceId = `warehouse_${randomBytes(6).toString('hex')}`;
  const uid = `${workspaceId}_owner`;
  const book = `${workspaceId}_book`;
  const viewer = `${workspaceId}_viewer`;
  const actor = { uid: book, name: 'Dana דנה', role: 'bookkeeper' };
  const at = '2026-10-16T10:00:00.000Z';
  const customer: Customer = { id: `${workspaceId}_customer`, uid, workspaceId, name: 'לקוח Customer', metadata: { existingNote: 'Keep this' } };
  const item: InventoryItem = {
    id: `${workspaceId}_item`, uid, workspaceId, name: 'ציוד Widget', sku: 'SKU-01', itemType: 'stock',
    unitPriceCents: 1000, unitCostCents: 400, quantityAtHand: 20, reorderPoint: 2, createdAt: '2026-01-01',
  };
  const order: Estimate = {
    id: `${workspaceId}_order`, uid, workspaceId, customerId: customer.id, customerName: customer.name,
    number: 'SO-01', amountCents: 5000, date: '2026-10-10', status: 'accepted', orderedAt: '2026-10-11',
    createdAt: '2026-10-10', metadata: { existingNote: 'Keep order note' },
    lines: [{ itemId: item.id, description: item.name, quantity: 5, unitPriceCents: 1000, amountCents: 5000 }],
  };
  const invoice: Invoice = {
    id: `${workspaceId}_invoice`, uid, workspaceId, customerId: customer.id, customerName: customer.name,
    number: 'INV-01', amountCents: 5000, date: '2026-10-12', dueDate: '2026-11-11', status: 'sent', currency: 'USD',
    metadata: { convertedFromEstimateId: order.id },
    items: [{ id: 'line-01', itemId: item.id, description: item.name, quantity: 5, rateCents: 1000, amountCents: 5000, accountId: 'income', serialNumbers: ['SN-אב-01'], metadata: { orderLine: 0 } }],
  };
  let client: pg.Client;
  let serverDb: import('../server/db/pgFirestore').Firestore | undefined;
  let commandApi: import('node:http').Server | undefined;
  let commandApiBase = '';
  async function asUser(userId: string, operation: () => Promise<void>) {
    await client.query('begin');
    try {
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal1' })]);
      await operation();
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
  }
  async function read<T>(table: 'inventory' | 'estimates' | 'customers' | 'invoices', id: string): Promise<T> {
    return (await client.query<{ data: T }>(`select data from public."${table}" where id = $1`, [id])).rows[0].data;
  }
  const patch = async (table: string, id: string, fields: Record<string, unknown>, userId = book) => {
    await asUser(userId, async () => { await client.query('select public.lf_update($1, $2, $3)', [table, id, fields]); });
  };
  const saveWarrantyDate = async (candidate: ReturnType<typeof warrantyCandidates>[number], endDate: string) => {
    const selected = {
      id: candidate.id, workspaceId: candidate.workspaceId, customerId: candidate.customerId,
      invoiceId: candidate.invoiceId, invoiceLineId: candidate.invoiceLineId, itemId: candidate.itemId,
      serial: candidate.serial,
    };
    const response = await fetch(`${commandApiBase}/api/v1/commands/warranty.update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId, input: { candidate: selected, endDate } }),
    });
    const body = await response.json() as { status?: string; message?: string; data?: { id?: string; changed?: boolean } };
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.status, 'success', body.message);
    assert.deepEqual(body.data, { id: candidate.id, changed: true });
  };
  before(async () => {
    client = new pg.Client({ connectionString: process.env.LF_TEST_DATABASE_URL });
    await client.connect();
    await client.query('insert into public.workspaces (id, data) values ($1, $2)', [workspaceId, {
      uid, name: 'Warehouse persistence tests', currency: 'USD', members: [uid, book, viewer], roles: { [book]: 'bookkeeper', [viewer]: 'viewer' },
    }]);
    for (const [table, record] of [['inventory', item], ['estimates', order], ['customers', customer], ['invoices', invoice]] as const) {
      await client.query(`insert into public."${table}" (id, data) values ($1, $2)`, [record.id, record]);
    }

    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const { getDb } = await import('../server/db/firestore');
    serverDb = getDb();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { user: { uid: book, email: `${book}@example.test`, displayName: actor.name } });
      next();
    });
    app.use('/api/v1/commands', createCommandRouter(undefined, { getDb: () => serverDb! }));
    commandApi = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => commandApi!.once('listening', resolve));
    commandApiBase = `http://127.0.0.1:${(commandApi.address() as AddressInfo).port}`;
  });
  after(async () => {
    if (commandApi) await new Promise<void>((resolve, reject) => commandApi!.close(error => error ? reject(error) : resolve()));
    await serverDb?.terminate();
    if (!client) return;
    for (const table of ['inventory', 'estimates', 'customers', 'invoices', 'auditLogs', 'idempotencyKeys']) {
      await client.query(`delete from public."${table}" where workspace_id = $1`, [workspaceId]);
    }
    await client.query('delete from public.workspaces where id = $1', [workspaceId]);
    await client.end();
  });

  test('bin and shipment annotations survive a fresh database read without changing order or stock amounts', async () => {
    const bin = { locationId: 'מקום.ראשי', bin: 'A-03', updatedAt: at, updatedByUid: book, updatedByName: actor.name };
    await patch('inventory', item.id, { [binLocationFieldPath(bin.locationId)]: bin });
    const savedItem = await read<InventoryItem>('inventory', item.id);
    assert.deepEqual(Object.values(savedItem.binLocations || {}), [bin]);
    for (const [key, value] of Object.entries(item)) assert.deepEqual(savedItem[key as keyof InventoryItem], value);

    const source = shipmentSourcesForOrder(order, [invoice], [], [item], 'invoice')[0];
    assert.ok(source);
    const shipment = createShipmentRecord({ id: 'ship_test', workspaceId, orderId: order.id, source, carrier: 'שליח Parcel', trackingNumber: 'TRACK-01', shippedDate: '2026-10-15', recordedAt: at, actor });
    const path = shipmentFieldPath(source.sourceType, source.sourceId);
    assert.ok(path);
    await patch('estimates', order.id, { [path!]: shipment });
    const savedOrder = await read<Estimate>('estimates', order.id);
    assert.equal(savedOrder.metadata?.existingNote, 'Keep order note');
    assert.deepEqual(Object.values(savedOrder.metadata?.warehouseShipmentsBySource || {}), [shipment]);
    assert.equal(savedOrder.amountCents, 5000);
    assert.deepEqual(savedOrder.lines, order.lines);
    assert.deepEqual(await read<Invoice>('invoices', invoice.id), invoice);
  });

  test('RMA request and transition persist through the server alongside existing customer metadata; a browser write is refused', async () => {
    // ISS-143: RMAs are written only by returnAuthorizationService.ts (20261022000000_rma_server_only.sql)
    const draft = createReturnAuthorization({
      id: 'rma_persistence', number: 'RMA-2026-TEST', workspaceId, customerId: customer.id, customerName: customer.name,
      invoiceId: invoice.id, invoiceNumber: invoice.number!, reason: 'מידה שגויה Wrong size', actor, at,
      lines: [{ invoiceLineId: 'line-01', itemId: item.id, description: item.name, quantity: 1, soldQuantity: 5 }],
    });
    await assert.rejects(patch('customers', customer.id, { [rmaFieldPath(draft.id)]: draft }), /through the server/);
    const { requestReturnAuthorization, moveReturnAuthorization } = await import('../server/services/returnAuthorizationService');
    const db = serverDb!;
    const requestKey = `persist-${randomBytes(6).toString('hex')}`;
    const { record } = await requestReturnAuthorization(db, {
      workspaceId, actor: { uid: book, name: actor.name }, customerId: customer.id, invoiceId: invoice.id,
      reason: 'מידה שגויה Wrong size', lines: [{ invoiceLineId: 'line-01', quantity: 1 }], requestKey,
    });
    let saved = await read<Customer>('customers', customer.id);
    assert.deepEqual(returnAuthorizationsFromMetadata(saved.metadata, customer.id, workspaceId), [record]);
    await moveReturnAuthorization(db, {
      workspaceId, actor: { uid, name: 'Owner' }, customerId: customer.id, rmaId: record.id, expectedStatus: 'requested',
      action: 'approve', requestKey: `${requestKey}-approve`,
    });
    saved = await read<Customer>('customers', customer.id);
    assert.equal(saved.metadata?.existingNote, 'Keep this');
    const [reopened] = returnAuthorizationsFromMetadata(saved.metadata, customer.id, workspaceId);
    assert.equal(reopened.status, 'approved');
    assert.deepEqual(reopened.events.map(event => [event.status, event.byUid]), [['requested', book], ['approved', uid]]);
    await client.query('delete from public."idempotencyKeys" where workspace_id = $1', [workspaceId]);
    await client.query('delete from public."auditLogs" where workspace_id = $1', [workspaceId]);
  });

  test('warranty history is server-managed and retained after reopening and editing a serial date again', async () => {
    const candidate = warrantyCandidates([invoice], [customer], [item], workspaceId)[0];
    assert.ok(candidate);
    const forged = createWarrantyRecord({ candidate, endDate: '2027-10-15', actor, at });
    await assert.rejects(patch('customers', customer.id, { [warrantyFieldPath(candidate)]: forged }), /through the server/);

    await saveWarrantyDate(candidate, '2027-10-15');
    const saved = await read<Customer>('customers', customer.id);
    const [reopened] = warrantyRecordsFromMetadata(saved.metadata, customer.id, workspaceId);
    assert.equal(reopened.serial, 'SN-אב-01');
    assert.equal(returnAuthorizationsFromMetadata(saved.metadata, customer.id, workspaceId).length, 1,
      'updating a warranty must not replace server-managed RMA history');
    await saveWarrantyDate(candidate, '2028-10-15');
    const [final] = warrantyRecordsFromMetadata((await read<Customer>('customers', customer.id)).metadata, customer.id, workspaceId);
    assert.deepEqual(final.changeLog.map(change => [change.previousEndDate, change.endDate]), [[null, '2027-10-15'], ['2027-10-15', '2028-10-15']]);
  });

  test('viewers and non-members are refused, workspace reassignment fails, and no financial or stock event was created', async () => {
    for (const [table, record] of [['inventory', item], ['estimates', order], ['customers', customer]] as const) {
      const before = await read<typeof record>(table, record.id);
      for (const forbiddenUser of [viewer, `${workspaceId}_outsider`]) {
        await assert.rejects(patch(table, record.id, { 'metadata.forbidden': 'Should not save' }, forbiddenUser));
        assert.deepEqual(await read(table, record.id), before);
      }
      await assert.rejects(patch(table, record.id, { workspaceId: `${workspaceId}_other` }));
      assert.deepEqual(await read(table, record.id), before);
    }
    for (const table of ['transactions', 'stockMoves', 'creditNotes']) {
      const result = await client.query<{ count: number }>(`select count(*)::int as count from public."${table}" where workspace_id = $1`, [workspaceId]);
      assert.equal(result.rows[0].count, 0, `no ${table} created by metadata updates`);
    }
    assert.deepEqual(await read<Invoice>('invoices', invoice.id), invoice);
    const savedItem = await read<InventoryItem>('inventory', item.id);
    assert.equal(savedItem.quantityAtHand, 20);
    assert.equal(savedItem.unitCostCents, 400);
  });
});
