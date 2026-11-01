import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import pg from 'pg';
import { LedgerEngine } from '../kernel/ledger/LedgerEngine';
import { useLedgerStore } from '../stores/useLedgerStore';
import {
  Firestore,
  poolConfigFromEnv,
  SERVERLESS_DEFAULT_POOL_MAX,
  STANDALONE_DEFAULT_POOL_MAX,
} from '../server/db/pgFirestore';
import type { Transaction } from '../types';

/** Builds a balanced sample ledger transaction with full dimensional and line metadata. */
function makeTransaction(overrides: Partial<Transaction> & { notes?: string } = {}): Transaction & { notes?: string } {
  return {
    id: 'tx-100',
    uid: 'user-1',
    workspaceId: 'ws-alpha',
    type: 'income',
    date: '2026-10-15',
    description: 'Acme Corp Advisory Retainer',
    totalAmountCents: 250000,
    currency: 'USD',
    exchangeRate: 1,
    status: 'completed',
    isCleared: true,
    tags: ['retainer', 'q4'],
    project: 'PRJ-01',
    classId: 'cls-consulting',
    locationId: 'loc-nyc',
    dimensions: { department: 'advisory', region: 'east' },
    metadata: { memo: 'October retainer' },
    lines: [
      {
        id: 'l-1',
        accountId: 'acc-cash',
        accountName: 'Operating Cash',
        amountCents: 250000,
        description: 'Wire receipt',
        tags: ['bank'],
        class: 'cls-consulting',
        location: 'loc-nyc',
        project: 'PRJ-01',
        dimensions: { costCenter: 'cc-10' },
      },
      {
        id: 'l-2',
        accountId: 'acc-rev',
        accountName: 'Advisory Revenue',
        amountCents: -250000,
        description: 'Monthly retainer earned',
        tags: ['revenue'],
      },
    ],
    ...overrides,
  };
}

/** Creates an in-memory pg.Client implementation for deterministic single-connection pool tests. */
function makeSingleSlotClientClass(options: { failRulesOnce?: boolean } = {}) {
  let failedOnce = false;
  return class SingleSlotPgClient extends EventEmitter {
    ref() {}
    unref() {}
    connect(cb?: (err?: Error | null) => void): Promise<void> | void {
      const p = Promise.resolve();
      if (cb) {
        void p.then(() => cb(null));
        return undefined;
      }
      return p;
    }
    query(sqlOrCfg: string | { text: string }, values?: unknown, cb?: (err: Error | null, res?: unknown) => void): Promise<unknown> | void {
      const sql = typeof sqlOrCfg === 'string' ? sqlOrCfg : sqlOrCfg.text;
      const callback = typeof values === 'function' ? (values as (err: Error | null, res?: unknown) => void) : cb;
      if (/lf_rules/i.test(sql) && options.failRulesOnce && !failedOnce) {
        failedOnce = true;
        const err = new Error('simulated lf_rules failure');
        if (callback) {
          void Promise.resolve().then(() => callback(err));
          return undefined;
        }
        return Promise.reject(err);
      }
      let res: { rows: unknown[]; rowCount: number } = { rows: [], rowCount: 1 };
      if (/lf_rules/i.test(sql)) {
        res = {
          rows: [{ table_name: 'workspaces' }, { table_name: 'transactions' }],
          rowCount: 2,
        };
      } else if (/select id, data::text as data/i.test(sql)) {
        res = {
          rows: [
            {
              id: 'ws-1',
              data: JSON.stringify({ name: 'Workspace One', uid: 'u-1' }),
              created_at: new Date('2026-10-01T00:00:00Z'),
              updated_at: new Date('2026-10-01T00:00:00Z'),
            },
          ],
          rowCount: 1,
        };
      }
      const p = Promise.resolve(res);
      if (callback) {
        void p.then((r) => callback(null, r));
        return undefined;
      }
      return p;
    }
    end(cb?: () => void): Promise<void> {
      cb?.();
      return Promise.resolve();
    }
  };
}

describe('LedgerEngine.normalizationCache isolation, invalidation, and memory bounds', () => {
  afterEach(() => {
    LedgerEngine.clearNormalizationCache();
  });

  test('preserves exact financial normalization fields, FX scaling, Hebrew/Unicode text, and balance checks', () => {
    const fxTx = makeTransaction({
      id: 'tx-fx-he',
      description: 'שירותי ייעוץ — Café Łódź Ltd.',
      totalAmountCents: 600000,
      currency: 'EUR',
      exchangeRate: 1.25,
      date: '2026-02-29',
    });
    const [norm] = LedgerEngine.normalize([fxTx]);
    assert.equal(norm._normalized.absAmount, 7500);
    assert.equal(norm._normalized.year, '2026');
    assert.equal(norm._normalized.month, '2026-02');
    assert.equal(norm._normalized.isLarge, true);
    assert.equal(norm._normalized.isTiny, false);
    assert.equal(norm._normalized.isBalanced, true);
    assert.match(norm._normalized.sanitizedDescription, /שירותי ייעוץ/);
    assert.doesNotMatch(norm._normalized.sanitizedDescription, /\bltd\b/i);
    assert.match(norm._normalized.searchStr, /cafe/);

    const tinyUnbalanced = makeTransaction({
      id: 'tx-tiny',
      totalAmountCents: 50,
      exchangeRate: 1,
      lines: [
        { accountId: 'acc-cash', amountCents: 50 },
        { accountId: 'acc-rev', amountCents: -49 },
      ],
    });
    const [normTiny] = LedgerEngine.normalize([tinyUnbalanced]);
    assert.equal(normTiny._normalized.absAmount, 0.5);
    assert.equal(normTiny._normalized.isTiny, true);
    assert.equal(normTiny._normalized.isLarge, false);
    assert.equal(normTiny._normalized.isBalanced, false);
  });

  test('isolates identically keyed transactions across workspaces without cross-tenant leakage', () => {
    const alpha = makeTransaction({
      id: 'seed-opening-1',
      workspaceId: 'ws-alpha',
      notes: 'Alpha private note',
      classId: 'cls-alpha',
      dimensions: { entity: 'alpha-hq' },
    });
    const beta = makeTransaction({
      id: 'seed-opening-1',
      workspaceId: 'ws-beta',
      notes: 'Beta private note',
      classId: 'cls-beta',
      dimensions: { entity: 'beta-uk' },
    });

    const [normAlpha] = LedgerEngine.normalize([alpha]);
    const [normBeta] = LedgerEngine.normalize([beta]);

    assert.equal(normAlpha.workspaceId, 'ws-alpha');
    assert.equal(normBeta.workspaceId, 'ws-beta');
    assert.equal(normBeta.notes, 'Beta private note');
    assert.equal(normBeta.classId, 'cls-beta');
    assert.match(normBeta._normalized.searchStr, /cls-beta/);
    assert.match(normBeta._normalized.searchStr, /beta-uk/);
    assert.doesNotMatch(normBeta._normalized.searchStr, /cls-alpha/);
    assert.doesNotMatch(normBeta._normalized.searchStr, /alpha-hq/);
  });

  test('invalidates cached metadata and preserves updated fields on any transaction or line edit', () => {
    const initial = makeTransaction({
      id: 'tx-edit-1',
      notes: 'Draft memo',
      reference: 'CHK-101',
      classId: 'cls-old',
      locationId: 'loc-old',
      dimensions: { fund: 'general' },
      metadata: { memo: 'first' },
    });
    LedgerEngine.normalize([initial]);

    const edited = makeTransaction({
      id: 'tx-edit-1',
      notes: 'Final audited memo',
      reference: 'CHK-202',
      classId: 'cls-new',
      locationId: 'loc-new',
      dimensions: { fund: 'restricted' },
      metadata: { memo: 'second' },
      lines: [
        {
          ...initial.lines[0],
          accountName: 'Checking Account Renamed',
          description: 'Updated wire description',
          tags: ['reconciled-tag'],
          class: 'line-cls-new',
          location: 'line-loc-new',
          project: 'PRJ-99',
          dimensions: { grant: 'G-2026' },
        },
        initial.lines[1],
      ],
    });

    const [normEdited] = LedgerEngine.normalize([edited]);
    assert.equal(normEdited.notes, 'Final audited memo');
    assert.equal(normEdited.reference, 'CHK-202');
    assert.equal(normEdited.classId, 'cls-new');
    assert.equal(normEdited.locationId, 'loc-new');
    assert.equal(normEdited.lines[0].description, 'Updated wire description');
    for (const token of [
      'cls-new',
      'loc-new',
      'restricted',
      'second',
      'checking account renamed',
      'updated wire description',
      'reconciled-tag',
      'line-cls-new',
      'line-loc-new',
      'prj-99',
      'g-2026',
    ]) {
      assert.match(normEdited._normalized.searchStr, new RegExp(token));
    }
    assert.doesNotMatch(normEdited._normalized.searchStr, /cls-old/);
  });

  test('bounds retained workspaces and entries via LRU and clears cleanly on workspace switch or store reset', () => {
    LedgerEngine.clearNormalizationCache();

    // Populate 3 workspaces -> oldest workspace is evicted automatically (maxWorkspaces = 2)
    LedgerEngine.normalize([makeTransaction({ id: 'tx-1', workspaceId: 'ws-1' })]);
    LedgerEngine.normalize([makeTransaction({ id: 'tx-2', workspaceId: 'ws-2' })]);
    LedgerEngine.normalize([makeTransaction({ id: 'tx-3', workspaceId: 'ws-3' })]);

    const afterThreeWorkspaces = LedgerEngine.getNormalizationCacheStats();
    assert.equal(afterThreeWorkspaces.workspaces, 2);
    assert.equal(afterThreeWorkspaces.entries, 2);

    // Populate 10,005 entries in one workspace -> caps smoothly at 10,000 via LRU without cliff clear()
    const batch = Array.from({ length: 10_005 }, (_, i) =>
      makeTransaction({ id: `tx-bulk-${i}`, workspaceId: 'ws-3', totalAmountCents: (i + 1) * 100 }),
    );
    LedgerEngine.normalize(batch);
    const afterBulk = LedgerEngine.getNormalizationCacheStats();
    assert.equal(afterBulk.entries, afterBulk.maxEntriesPerWorkspace + 1); // 10,000 in ws-3 + 1 in ws-2

    // Evicting departed workspace drops only that workspace's entries
    LedgerEngine.clearNormalizationCache('ws-3');
    assert.equal(LedgerEngine.getNormalizationCacheStats().entries, 1);

    // Store reset on sign-out clears all workspaces
    useLedgerStore.getState().resetStore();
    assert.deepEqual(LedgerEngine.getNormalizationCacheStats(), {
      workspaces: 0,
      entries: 0,
      maxWorkspaces: 2,
      maxEntriesPerWorkspace: 10_000,
    });
  });
});

describe('pg.Pool concurrency-safe sizing and cold-start transaction safety', () => {
  const REMOTE_DB = 'postgresql://app:secret@db.project-ref.supabase.co:6543/postgres';

  test('sizes serverless pools to 5 with fast idle release while preserving standalone default 10 and explicit overrides', () => {
    const serverlessCfg = poolConfigFromEnv(
      { connectionString: REMOTE_DB },
      { VERCEL: '1', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' },
      () => {},
    );
    assert.equal(serverlessCfg.max, SERVERLESS_DEFAULT_POOL_MAX);
    assert.equal(serverlessCfg.max, 5);
    assert.equal(serverlessCfg.idleTimeoutMillis, 5_000);
    assert.equal(serverlessCfg.allowExitOnIdle, true);

    const standaloneCfg = poolConfigFromEnv(
      { connectionString: REMOTE_DB },
      { DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' },
      () => {},
    );
    assert.equal(standaloneCfg.max, STANDALONE_DEFAULT_POOL_MAX);
    assert.equal(standaloneCfg.max, 10);
    assert.equal(standaloneCfg.idleTimeoutMillis, 10_000);
    assert.equal(standaloneCfg.allowExitOnIdle, undefined);

    const envOverrideCfg = poolConfigFromEnv(
      { connectionString: REMOTE_DB },
      { VERCEL: '1', PG_POOL_MAX: '7', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' },
      () => {},
    );
    assert.equal(envOverrideCfg.max, 7);

    const invalidEnvCfg = poolConfigFromEnv(
      { connectionString: REMOTE_DB },
      { VERCEL: '1', PG_POOL_MAX: '0', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' },
      () => {},
    );
    assert.equal(invalidEnvCfg.max, 5);

    const settingsOverrideCfg = poolConfigFromEnv(
      { connectionString: REMOTE_DB, max: 3 },
      { VERCEL: '1', PG_POOL_MAX: '8', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' },
      () => {},
    );
    assert.equal(settingsOverrideCfg.max, 3);
  });

  test('cold-start runTransaction and multi-op WriteBatch reuse the checked-out client without self-deadlocking at max=1', async () => {
    const pool = new pg.Pool({
      max: 1,
      connectionTimeoutMillis: 200,
      Client: makeSingleSlotClientClass() as unknown as typeof pg.Client,
    });
    const db = new Firestore({ pool });

    try {
      const txValue = await db.runTransaction(async (t) => {
        const snap = await t.get(db.collection('workspaces').doc('ws-1'));
        assert.equal(snap.exists, true);
        t.set(db.collection('transactions').doc('tx-1'), { workspaceId: 'ws-1', amountCents: 100 });
        return snap.data()?.name;
      });
      assert.equal(txValue, 'Workspace One');

      // Reset internal table cache and verify multi-op WriteBatch also avoids cold-start pool deadlock at max=1
      const pool2 = new pg.Pool({
        max: 1,
        connectionTimeoutMillis: 200,
        Client: makeSingleSlotClientClass() as unknown as typeof pg.Client,
      });
      const dbColdBatch = new Firestore({ pool: pool2 });
      try {
        const batch = dbColdBatch.batch();
        batch.set(dbColdBatch.collection('transactions').doc('tx-a'), { workspaceId: 'ws-1' });
        batch.set(dbColdBatch.collection('transactions').doc('tx-b'), { workspaceId: 'ws-1' });
        const results = await batch.commit();
        assert.equal(results.length, 2);
      } finally {
        await pool2.end();
      }
    } finally {
      await pool.end();
    }
  });

  test('transaction-owned lf_rules lookup failure marks tx state failed even if callback catches the error', async () => {
    const pool = new pg.Pool({
      max: 1,
      connectionTimeoutMillis: 200,
      Client: makeSingleSlotClientClass({ failRulesOnce: true }) as unknown as typeof pg.Client,
    });
    const db = new Firestore({ pool });

    try {
      await assert.rejects(
        db.runTransaction(async (t) => {
          try {
            await t.get(db.collection('workspaces').doc('ws-1'));
          } catch {
            // Swallow inside callback; runTransaction must still surface the aborted SQL transaction
          }
          return 'swallowed';
        }),
        /simulated lf_rules failure/,
      );
    } finally {
      await pool.end();
    }
  });
});
