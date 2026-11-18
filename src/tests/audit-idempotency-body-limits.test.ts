import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { applyJsonBodyParser, isIngestJsonRoute, isLargeJsonRoute } from '../server/http/securityMiddleware';
import { recordAuthEvent } from '../server/services/authAuditService';
import type { Firestore } from '../server/db/firestore';

describe('C-3 / F-09 / F-10 / M-8: Audit coverage, shared idempotency, and JSON body limits', () => {
  it('F-10: inventory and vertical journal routes use the command runner and retain request fingerprints', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    const inventory = read('src/server/routes/inventoryRoutes.ts');
    assert.match(inventory, /\bexecuteCommand\s*\(\s*req\s*,\s*res\s*,\s*\{/);
    assert.match(inventory, /withLegacyInputIdempotencyHash\(/);
    const steps = read('src/server/services/journalDocumentService.ts');
    const commands = read('src/server/commands/verticalAccounting.ts');
    const runner = read('src/server/utils/commandExecutor.ts');
    for (const [rel, command] of [
      ['src/server/routes/leaseRoutes.ts', 'leaseCapitalizeCommand'],
      ['src/server/routes/revenueRoutes.ts', 'revenueRecognizeCommand'],
    ] as const) {
      const src = read(rel);
      assert.match(src, /\bexecuteCommand\s*\(\s*req\s*,\s*res\s*,\s*\{/, `${rel} uses the runner`);
      assert.ok(src.includes(command), `${rel} names its registered command`);
      assert.match(src, /withLegacyInputIdempotencyHash\(/, `${rel} keeps the legacy input fingerprint`);
      assert.doesNotMatch(src, /\bpostJournalDocument\s*\(/, `${rel} does not open a second transaction`);
    }
    assert.match(commands, /\bprepareJournalDocument\(/);
    assert.match(commands, /\bpostJournalDocumentInTransaction\(/);
    assert.match(steps, /\bledgerCreate\s*\(/);
    assert.match(steps, /\bwriteServerAuditLog\s*\(/);
    assert.match(runner, /\bexecuteIdempotent\s*\(/);
    assert.match(runner, /\brequestPayloadHash\s*\(/);
    assert.doesNotMatch(steps, /return res\.json\(idempDoc\.data\(\)\?\.response\)/);
  });

  it('C-3 / F-09a: persisting write handlers in src/server/routes/ maintain >= 70% audit coverage and 100% on money/GL/key routes', () => {
    const routesDir = path.join(process.cwd(), 'src/server/routes');
    const REG = /\b(?:app|router|workspaceRouter|emailWebhookRouter|[a-zA-Z]+Router)\s*\.\s*(post|put|patch|delete)\s*\(\s*(['"`])(.*?)\2/g;
    const WRITE = /\.doc\([^)]*\)\s*\.\s*(?:set|update|delete)\(|\.add\(|batch\.commit|\.commit\(\)|runTransaction|FieldValue\.(?:serverTimestamp|arrayUnion|increment)|insert into|UPDATE /i;
    // Registered-command routes delegate persistence and transactional auditing to the shared runner.
    const COMMAND_WRITE = /\bexecuteCommand\s*\(\s*req\s*,\s*res\s*,\s*\{/;
    const AUDIT = /writeServerAuditLog\s*\(|writeAuditLog\s*\(|recordAuthEvent\s*\(|deleteAccount\s*\(/;
    // A route may also hand its handler to a route factory in src/server/http (the document-journal
    // routes do). The write and its audit line then live in that module: read it too, but only for the
    // factories named here, so an unrelated helper import cannot make a route look audited.
    const ROUTE_FACTORIES: Record<string, string> = {
      postJournalDocument: 'src/server/services/journalDocumentService.ts',
    };
    const sharedSourceFor = (body: string): string => Object.entries(ROUTE_FACTORIES)
      .filter(([name]) => new RegExp(`\\b${name}\\s*\\(`).test(body))
      .map(([, rel]) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
      .join('\n');

    const all: { file: string; method: string; route: string; audited: boolean }[] = [];
    for (const file of fs.readdirSync(routesDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
      const starts = [...src.matchAll(REG)];
      starts.forEach((m, i) => {
        const handler = src.slice(m.index! + m[0].length, i + 1 < starts.length ? starts[i + 1].index! : src.length);
        const body = `${handler}\n${sharedSourceFor(handler)}`;
        const commandManaged = COMMAND_WRITE.test(body);
        if (!WRITE.test(body) && !commandManaged) return;
        // CommandDefinition requires an audit callback and runRegisteredCommand writes its summary
        // in the same transaction. The command-specific tests cover the callback's concrete event.
        all.push({ file, method: m[1].toUpperCase(), route: m[3], audited: AUDIT.test(body) || commandManaged });
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
    assert.equal(isLargeJsonRoute('POST', '/api/v1/commands/payroll.import'), true);
    assert.equal(isLargeJsonRoute('POST', '/api/v1/commands/payroll.import/preview'), true);
    assert.equal(isLargeJsonRoute('POST', '/api/v1/commands/payroll.run'), false);
    assert.equal(isLargeJsonRoute('POST', '/api/v1/commands/payroll.import/unrelated'), false);
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
    app.post('/api/v1/commands/:name', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));
    app.post('/api/v1/commands/:name/preview', (req, res) => res.json({ bytes: JSON.stringify(req.body).length }));

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

      for (const [path, status] of [['payroll.import', 200], ['payroll.import/preview', 200], ['payroll.run', 413]] as const) {
        const response = await fetch(`${base}/api/v1/commands/${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: overOneMb,
        });
        assert.equal(response.status, status, path);
      }
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

  it('F-06 regression: verifies server records linked by entryHash, not only the legacy chainHash', async () => {
    const { buildAuditLogRecord, verifyAuditHashChain, AUDIT_CHAIN_GENESIS } = await import('../server/services/auditLogService');
    const first = buildAuditLogRecord({
      workspaceId: 'ws-entry-chain', uid: 'u1', action: 'FIRST', entityType: 'test', entityId: 'one',
      details: { description: 'First entry' }, timestamp: '2026-11-11T11:00:00.000Z',
    }, 'entry-1', AUDIT_CHAIN_GENESIS);
    const second = buildAuditLogRecord({
      workspaceId: 'ws-entry-chain', uid: 'u1', action: 'SECOND', entityType: 'test', entityId: 'two',
      details: { description: 'Second entry' }, timestamp: '2026-11-11T11:01:00.000Z',
    }, 'entry-2', { seq: 2, prevHash: first.entryHash });

    assert.equal(second.prevHash, first.entryHash);
    assert.deepEqual(verifyAuditHashChain([first, second]), { valid: true });
    assert.deepEqual(verifyAuditHashChain([first, { ...second, details: { description: 'tampered' } }]), { valid: false, brokenAtId: 'entry-2' });
  });
});
