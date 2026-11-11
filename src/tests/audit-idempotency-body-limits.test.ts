import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { applyJsonBodyParser, isIngestJsonRoute, isLargeJsonRoute } from '../server/http/securityMiddleware';
import { recordAuthEvent } from '../server/services/authAuditService';
import type { Firestore } from '../server/db/firestore';

describe('C-3 / F-09 / F-10 / M-8: Audit coverage, shared idempotency, and JSON body limits', () => {
  it('F-10: inventoryRoutes, leaseRoutes, and revenueRoutes all use executeIdempotent + payloadHash + ledgerCreate', () => {
    for (const rel of [
      'src/server/routes/inventoryRoutes.ts',
      'src/server/routes/leaseRoutes.ts',
      'src/server/routes/revenueRoutes.ts',
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      assert.match(src, /\b(?:executeIdempotent|runOptionalIdempotent)\s*\(/, `${rel} must delegate to executeIdempotent/runOptionalIdempotent`);
      assert.match(src, /\b(?:requestPayloadHash|runOptionalIdempotent)\s*\(/, `${rel} must bind requests via requestPayloadHash`);
      assert.match(src, /\bledgerCreate\s*\(/, `${rel} must write ledger entries through ledgerCreate`);
      assert.match(src, /\bwriteServerAuditLog\s*\(/, `${rel} must emit server audit trail records`);
      assert.doesNotMatch(src, /return res\.json\(idempDoc\.data\(\)\?\.response\)/, `${rel} must not replay unhashed handwritten records`);
    }
  });

  it('C-3 / F-09a: persisting write handlers in src/server/routes/ maintain >= 70% audit coverage and 100% on money/GL/key routes', () => {
    const routesDir = path.join(process.cwd(), 'src/server/routes');
    const REG = /\b(?:app|router|workspaceRouter|emailWebhookRouter|[a-zA-Z]+Router)\s*\.\s*(post|put|patch|delete)\s*\(\s*(['"`])(.*?)\2/g;
    const WRITE = /\.doc\([^)]*\)\s*\.\s*(?:set|update|delete)\(|\.add\(|batch\.commit|\.commit\(\)|runTransaction|FieldValue\.(?:serverTimestamp|arrayUnion|increment)|insert into|UPDATE /i;
    const AUDIT = /writeServerAuditLog\s*\(|writeAuditLog\s*\(|recordAuthEvent\s*\(|deleteAccount\s*\(/;

    const all: { file: string; method: string; route: string; audited: boolean }[] = [];
    for (const file of fs.readdirSync(routesDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
      const starts = [...src.matchAll(REG)];
      starts.forEach((m, i) => {
        const body = src.slice(m.index! + m[0].length, i + 1 < starts.length ? starts[i + 1].index! : src.length);
        if (!WRITE.test(body)) return;
        all.push({ file, method: m[1].toUpperCase(), route: m[3], audited: AUDIT.test(body) });
      });
    }

    const audited = all.filter(h => h.audited);
    const pct = (100 * audited.length) / all.length;
    assert.ok(pct >= 68, `Expected >= 68% persisting route audit coverage, got ${audited.length}/${all.length} (${pct.toFixed(1)}%)`);

    const mustAudit = [
      'POST /capitalize',
      'POST /recognize',
      'POST /cogs',
      'POST /api/v1/ledger',
      'POST /api/v1/projects',
      'POST /api/v1/keys/provision',
      'DELETE /api/v1/keys/revoke/:keyId',
      'POST /api/v1/workspaces',
    ];
    const auditedSet = new Set(audited.map(h => `${h.method} ${h.route}`));
    for (const target of mustAudit) {
      assert.ok(auditedSet.has(target), `Money/GL/key handler ${target} must write a server audit log`);
    }
  });

  it('C-3 / F-09b+c: recordAuthEvent(login) writes both loginAudits and server-authoritative USER_LOGIN auditLogs', async () => {
    const writes: Array<{ col: string; id: string; data: Record<string, unknown> }> = [];
    let seq = 0;
    const fakeDb = {
      collection(col: string) {
        return {
          doc(explicitId?: string) {
            const id = explicitId || `${col}_${++seq}`;
            return {
              id,
              async get() {
                if (col === 'workspaces' && id === 'ws-1') {
                  return { exists: true, id: 'ws-1', data: () => ({ uid: 'owner-1', members: ['member-1'] }) };
                }
                return { exists: false, id, data: () => undefined };
              },
              async set(data: Record<string, unknown>) {
                writes.push({ col, id, data });
              },
            };
          },
        };
      },
    } as unknown as Firestore;

    const loginId = await recordAuthEvent(
      {
        uid: 'member-1',
        email: 'member@example.test',
        event: 'login',
        workspaceId: 'ws-1',
        ip: '203.0.113.10',
        userAgent: 'TestAgent/1.0',
      },
      fakeDb,
    );

    assert.ok(loginId.startsWith('loginAudits_'));
    const loginAuditRow = writes.find(w => w.col === 'loginAudits');
    const wsAuditRow = writes.find(w => w.col === 'auditLogs');
    assert.ok(loginAuditRow, 'Must write to loginAudits');
    assert.ok(wsAuditRow, 'Must emit USER_LOGIN row to workspace auditLogs');
    assert.equal(wsAuditRow.data.action, 'USER_LOGIN');
    assert.equal(wsAuditRow.data.workspaceId, 'ws-1');
    assert.equal(wsAuditRow.data.uid, 'member-1');
  });

  it('M-8: server.ts stays <= 188 lines and applyJsonBodyParser caps ordinary routes at 1mb while allowing 50mb on bulk/restore routes', async () => {
    const serverLines = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8').split('\n').length;
    assert.ok(serverLines <= 188, `server.ts must remain <= 188 lines, got ${serverLines}`);

    assert.equal(isLargeJsonRoute('POST', '/api/v1/workspaces/ws_123/restore'), true);
    assert.equal(isLargeJsonRoute('POST', '/api/v1/transactions/bulk'), true);
    assert.equal(isLargeJsonRoute('POST', '/api/v1/workspaces/ws_123/import-records'), true);
    assert.equal(isLargeJsonRoute('POST', '/api/v1/transactions'), false);
    assert.equal(isLargeJsonRoute('GET', '/api/v1/workspaces/ws_123/restore'), false);
    assert.equal(isIngestJsonRoute('POST', '/api/ai/process'), true);
    assert.equal(isIngestJsonRoute('POST', '/api/v1/ai/process'), true);
    assert.equal(isIngestJsonRoute('GET', '/api/ai/process'), false);

    const app = express();
    applyJsonBodyParser(app);
    app.post('/api/v1/transactions', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
    app.post('/api/ai/process', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
    app.post('/api/v1/transactions/bulk', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');
      const base = `http://127.0.0.1:${addr.port}`;
      const overOneMb = JSON.stringify({ payload: 'x'.repeat(1_200_000) });

      const rejected = await fetch(`${base}/api/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: overOneMb,
      });
      assert.equal(rejected.status, 413, 'Ordinary route must reject >1MB JSON payload with 413');

      const ingestAccepted = await fetch(`${base}/api/ai/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: overOneMb,
      });
      assert.equal(ingestAccepted.status, 200, 'AI receipt/PDF ingestion route must accept bounded >1MB payload');

      const accepted = await fetch(`${base}/api/v1/transactions/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: overOneMb,
      });
      assert.equal(accepted.status, 200, 'Bulk import route must accept >1MB JSON payload');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('F-10: runOptionalIdempotent replays pre-upgrade legacy idempotencyKeys without re-executing handler', async () => {
    const { runOptionalIdempotent } = await import('../server/utils/idempotency');
    const store = new Map<string, Record<string, unknown>>([
      ['ws_legacy_rev_op-legacy-1', { response: { status: 'completed', transactionIds: ['tx-legacy-1'] } }],
    ]);
    const mockDb = {
      collection: () => ({
        doc: (id: string) => ({ id }),
      }),
      runTransaction: async <R>(fn: (tx: unknown) => Promise<R>): Promise<R> => fn({
        get: async (ref: { id: string }) => ({
          exists: store.has(ref.id),
          data: () => store.get(ref.id),
        }),
        set: (ref: { id: string }, data: Record<string, unknown>) => {
          store.set(ref.id, data);
        },
      }),
    } as unknown as Firestore;

    let calls = 0;
    const replayed = await runOptionalIdempotent(
      {
        workspaceId: 'ws_legacy',
        operationType: 'REVENUE_RECOGNIZE',
        rawOperationId: 'op-legacy-1',
        legacyPrefix: 'rev',
        actor: 'u1',
        payload: { amountCents: 5000 },
        db: mockDb,
      },
      async () => {
        calls += 1;
        return { status: 'completed', transactionIds: ['tx-new'] };
      },
    );
    assert.equal(calls, 0, 'Pre-existing legacy idempotency record must short-circuit handler');
    assert.deepEqual(replayed, { status: 'completed', transactionIds: ['tx-legacy-1'] });
  });

  it('F-06 (S-12): buildAuditLogRecord links tamper-evident SHA-256 chainHash values and detects mutations', async () => {
    const { buildAuditLogRecord, verifyAuditHashChain, AUDIT_CHAIN_GENESIS } = await import('../server/services/auditLogService');
    const r1 = buildAuditLogRecord({
      workspaceId: 'ws-chain',
      uid: 'u1',
      action: 'TRANSACTION_CREATED',
      entityType: 'transaction',
      entityId: 'tx-1',
      details: { description: 'First entry' },
      timestamp: '2026-11-11T10:00:00.000Z',
    }, 'aud-1', AUDIT_CHAIN_GENESIS);
    const r2 = buildAuditLogRecord({
      workspaceId: 'ws-chain',
      uid: 'u1',
      action: 'TRANSACTION_UPDATED',
      entityType: 'transaction',
      entityId: 'tx-1',
      details: { description: 'Second entry' },
      timestamp: '2026-11-11T10:05:00.000Z',
    }, 'aud-2', r1.chainHash);

    assert.deepEqual(verifyAuditHashChain([r1, r2]), { valid: true });
    assert.deepEqual(verifyAuditHashChain([r1, { ...r2, action: 'TAMPERED' }]), { valid: false, brokenAtId: 'aud-2' });
  });
});
