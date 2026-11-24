/**
 * J-12 (Agent #11): the workspace settings backup/restore carries `invoiceApproval.billThresholdCents`
 * (added by #978; default $5,000 when absent, src/lib/billApproval.ts).
 *
 * The backup writes the workspace record whole (`workspace.json`; every field except
 * PROTECTED_WORKSPACE_FIELDS) and the restore merges those fields back, so the limit must survive
 * "export, import into an empty workspace". The settings command's own keep-on-save behaviour is
 * covered in `workspace-settings-command.test.ts`; this suite pins the backup leg end to end.
 *
 * DB-gated like `backup-restore.test.ts`: runs when LF_TEST_DATABASE_URL is set, skipped otherwise.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { Firestore } from '../server/db/pgFirestore';
import { exportWorkspaceBackup, restoreWorkspaceBackup } from '../server/services/workspaceRestoreService';
import { DEFAULT_BILL_LIMIT_CENTS, billLimitCents } from '../lib/billApproval';

const url = process.env.LF_TEST_DATABASE_URL;
const suffix = crypto.randomBytes(4).toString('hex');
const wsSource = `ws_j12a_${suffix}`;
const wsEmpty = `ws_j12b_${suffix}`;
const wsBare = `ws_j12c_${suffix}`;

describe('J-12 bill limit in the settings backup round trip', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore;

  before(async () => {
    db = new Firestore({ connectionString: url, max: 4 });
    await db.collection('workspaces').doc(wsSource).set({
      uid: 'owner-j12', name: 'J-12 books', plan: 'starter', currency: 'USD', roles: { 'owner-j12': 'owner' },
      invoiceApproval: { enabled: true, thresholdCents: 900_000, billThresholdCents: 75_000 },
    });
    await db.collection('workspaces').doc(wsEmpty).set({
      uid: 'owner-j12', name: 'J-12 empty target', plan: 'starter', currency: 'USD', roles: { 'owner-j12': 'owner' },
    });
    await db.collection('workspaces').doc(wsBare).set({
      uid: 'owner-j12', name: 'J-12 bare target', plan: 'starter', currency: 'USD', roles: { 'owner-j12': 'owner' },
    });
  });

  after(async () => {
    for (const id of [wsSource, wsEmpty, wsBare]) {
      await db.pool.query('delete from public.workspaces where id = $1', [id]);
    }
    await db.terminate();
  });

  test('the settings export carries the approval block', async () => {
    const backup = await exportWorkspaceBackup(db, wsSource, 'owner-j12');
    assert.ok(JSON.stringify(backup.workspace).includes('invoiceApproval'), 'workspace.json carries invoiceApproval');
    assert.equal((backup.workspace as { invoiceApproval?: { billThresholdCents?: number } }).invoiceApproval?.billThresholdCents, 75_000);
  });

  test('export, import into an empty workspace: the same limit is in force', async () => {
    const backup = await exportWorkspaceBackup(db, wsSource, 'owner-j12');
    // the empty target's own id; no metadata, so the crafted copy is accepted like any older backup
    const forTarget = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
    forTarget.workspace = { ...(backup.workspace as Record<string, unknown>), id: wsEmpty };
    delete forTarget.metadata;

    await restoreWorkspaceBackup(db, wsEmpty, forTarget);
    const restored = (await db.collection('workspaces').doc(wsEmpty).get()).data() as { invoiceApproval?: { billThresholdCents?: number } };
    assert.equal(restored.invoiceApproval?.billThresholdCents, 75_000, 'the limit survives export → import');
    assert.equal(billLimitCents(restored.invoiceApproval), 75_000);
  });

  test('a backup without the approval block leaves the $5,000 default in force', async () => {
    const backup = await exportWorkspaceBackup(db, wsSource, 'owner-j12');
    const forTarget = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
    const workspace: Record<string, unknown> = { ...(backup.workspace as Record<string, unknown>), id: wsBare };
    delete workspace.invoiceApproval;
    forTarget.workspace = workspace;
    delete forTarget.metadata;

    await restoreWorkspaceBackup(db, wsBare, forTarget);
    const restored = (await db.collection('workspaces').doc(wsBare).get()).data() as { invoiceApproval?: { billThresholdCents?: number } };
    assert.equal(restored.invoiceApproval?.billThresholdCents, undefined);
    assert.equal(billLimitCents(restored.invoiceApproval), DEFAULT_BILL_LIMIT_CENTS, 'default $5,000 when absent');
  });
});
