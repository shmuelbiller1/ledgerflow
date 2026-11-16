import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { RequestUser } from '../server/auth/requestUser';
import { numberingUpdateCommand } from '../server/commands/numbering';
import type { NumberingUpdateResult } from '../server/services/numberingService';
import { createNumberingRouter } from '../server/routes/numberingRoutes';
import { previewCommand } from '../server/utils/commandExecutor';
import {
  fakeRequest,
  MemoryDb,
  owner,
  runnerDependencies,
  seedWorkspace,
  type TestCounters,
  workspaceId,
} from './helpers/commandTestUtils';

async function createHarness() {
  const db = new MemoryDb();
  const counters: TestCounters = { runs: 0, previews: 0, afterCommit: 0, audits: 0 };
  const auditEntries: unknown[] = [];
  const dependencies = runnerDependencies(db, counters);
  dependencies.auditWriter = async input => {
    counters.audits++;
    auditEntries.push(input);
    return 'numbering-audit-test';
  };
  seedWorkspace(db, workspaceId, {
    members: [owner.uid, 'bookkeeper-1'],
    roles: { 'bookkeeper-1': 'bookkeeper' },
  });
  db.seed(`numberingSeries/${workspaceId}_invoice`, {
    workspaceId, type: 'invoice', prefix: 'INV-2026-', nextNumber: 10, padding: 4,
  });
  db.seed(`invoices/${workspaceId}_invoice-1`, { workspaceId, number: 'INV-2026-0009' });
  db.seed(`bills/${workspaceId}_bill-1`, { workspaceId, number: 'BIL-2026-0003' });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = String(req.header('x-test-uid') || owner.uid);
    (req as unknown as { user: RequestUser }).user = uid === owner.uid ? owner : { uid, aal: 'aal2' };
    next();
  });
  app.use('/api/v1/workspaces/:workspaceId/numbering', createNumberingRouter(dependencies));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  return {
    db,
    counters,
    auditEntries,
    base,
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

test('numbering.update publishes its schema, owner/accountant roles, preview, and safe inverse', async () => {
  const { db, counters, close } = await createHarness();
  try {
    assert.equal(numberingUpdateCommand.input.safeParse(numberingUpdateCommand.describe.example).success, true);
    assert.deepEqual(numberingUpdateCommand.roles, ['owner', 'accountant']);

    const input = { type: 'invoice' as const, prefix: 'INV-2026-', nextNumber: 10, padding: 4 };
    const preview = await previewCommand(fakeRequest(owner, input), { definition: numberingUpdateCommand, workspaceId, input }, runnerDependencies(db, counters));
    assert.equal(preview.ok, true);
    if (preview.ok) {
      assert.deepEqual(preview.preview.lines, [
        'Current next number: INV-2026-0010',
        'Proposed next number: INV-2026-0010',
        'Highest number already used with the proposed prefix: 9',
        'The proposed next number is unused',
      ]);
    }
    assert.equal(db.read(`numberingSeries/${workspaceId}_invoice`)?.nextNumber, 10, 'preview does not write');
    assert.equal(counters.audits, 0, 'preview does not audit');

    const result: NumberingUpdateResult = {
      before: { prefix: 'INV-2026-', nextNumber: 10, padding: 4 },
      previousHighestUsed: 9,
      series: { type: 'invoice', prefix: 'NEXT-', nextNumber: 1, padding: 3, next: 'NEXT-001', highestUsed: 0 },
    };
    assert.deepEqual(numberingUpdateCommand.inverse?.({ type: 'invoice', prefix: 'NEXT-', nextNumber: 1, padding: 3 }, result), {
      command: 'numbering.update',
      input: { type: 'invoice', prefix: 'INV-2026-', nextNumber: 10, padding: 4 },
    });
    assert.equal(numberingUpdateCommand.inverse?.({ type: 'invoice', prefix: 'NEXT-', nextNumber: 1, padding: 3 }, {
      ...result,
      previousHighestUsed: 10,
    }), null, 'do not offer an inverse that would reuse an existing document number');
  } finally {
    await close();
  }
});

test('legacy numbering PUT keeps its response shape, refusals, audit, and idempotent path-aware retries', async t => {
  const harness = await createHarness();
  t.after(harness.close);
  const { db, counters, auditEntries, base } = harness;
  const call = (uid: string, type: string, body: unknown, operationId?: string) => fetch(`${base}/api/v1/workspaces/${workspaceId}/numbering/${type}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-test-uid': uid,
      ...(operationId ? { 'idempotency-key': operationId } : {}),
    },
    body: JSON.stringify(body),
  });

  const body = { prefix: 'NEXT-', nextNumber: 1, padding: 3 };
  const saved = await call(owner.uid, 'invoice', body, 'numbering-invoice-update');
  assert.equal(saved.status, 200);
  const savedBody = await saved.json() as { status: string; series: Record<string, unknown> };
  assert.deepEqual(savedBody, {
    status: 'success',
    series: { type: 'invoice', ...body, next: 'NEXT-001', highestUsed: 0 },
  }, 'the old endpoint still returns { status, series }');
  assert.equal(counters.audits, 1);
  const firstAudit = auditEntries[0] as { action: string; entityType: string; entityId: string; details: Record<string, unknown> };
  assert.equal(firstAudit.action, 'NUMBERING_CHANGED');
  assert.equal(firstAudit.entityType, 'numberingSeries');
  assert.equal(firstAudit.entityId, 'invoice');
  assert.deepEqual(firstAudit.details, {
    description: 'invoice numbers: next INV-2026-0010 → NEXT-001',
    before: { prefix: 'INV-2026-', nextNumber: 10, padding: 4 },
    after: body,
  });

  const replay = await call(owner.uid, 'invoice', body, 'numbering-invoice-update');
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), savedBody, 'a retry keeps the legacy response');
  assert.equal(counters.audits, 1, 'a retry does not write a duplicate audit entry');

  const wrongPath = await call(owner.uid, 'bill', body, 'numbering-invoice-update');
  assert.equal(wrongPath.status, 409, 'the route parameter is part of the request fingerprint');
  assert.match((await wrongPath.json() as { message: string }).message, /different request/);
  assert.equal(db.read(`numberingSeries/${workspaceId}_bill`), undefined, 'a key reused for another type does not change that series');

  const used = await call(owner.uid, 'invoice', { prefix: 'INV-2026-', nextNumber: 9, padding: 4 });
  assert.equal(used.status, 400);
  assert.deepEqual(await used.json(), {
    status: 'error',
    message: 'INV-2026-0009 is already used: start at 10 or higher',
  });

  const invalid = await call(owner.uid, 'invoice', { prefix: 'bad<script>', nextNumber: 1, padding: 4 });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as { status: string }).status, 'error');

  const bookkeeper = await call('bookkeeper-1', 'invoice', { prefix: 'BOOK-', nextNumber: 1, padding: 3 });
  assert.equal(bookkeeper.status, 403);
  assert.deepEqual(await bookkeeper.json(), {
    status: 'error',
    message: 'Only owners and accountants change document numbers',
  });
  assert.equal(counters.audits, 1, 'refused changes do not audit');

  const stored = db.read('idempotencyKeys/ws-command-test:numbering.update:numbering-invoice-update')?.result as NumberingUpdateResult;
  const inverse = numberingUpdateCommand.inverse?.({ type: 'invoice', ...body }, stored);
  assert.ok(inverse);
  const undo = inverse!.input as { type: string; prefix: string; nextNumber: number; padding: number };
  const restored = await call(owner.uid, undo.type, { prefix: undo.prefix, nextNumber: undo.nextNumber, padding: undo.padding }, 'numbering-invoice-undo');
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json() as { series: Record<string, unknown> }).series, {
    type: 'invoice', prefix: 'INV-2026-', nextNumber: 10, padding: 4, next: 'INV-2026-0010', highestUsed: 9,
  });
  assert.equal(counters.audits, 2, 'undo is an ordinary audited command');
});
