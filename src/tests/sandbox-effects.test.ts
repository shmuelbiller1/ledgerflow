import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { Firestore } from '../server/db/firestore';
import { syncOneBank } from '../server/routes/plaidRoutes';
import { verifyPlaidWebhook } from '../server/routes/plaidWebhookRoutes';
import { deleteFilesWithPrefix } from '../server/storage/supabaseStorage';
import { sendMail, setMailTransportForTests } from '../server/services/mailer';
import { notify } from '../server/services/notificationService';
import { FxService } from '../server/services/FxService';
import { captureEffects, deferEffects } from '../server/services/sandboxEffects';
import { thankForPayment, emailRemittance } from '../server/services/documentEmailService';
import { runScheduledReports } from '../server/services/scheduledReportService';
import { purgePendingWorkspaces } from '../server/services/workspacePurgeService';
import { runNotificationDigest } from '../server/services/notificationEmailService';
import { runAssetReminders } from '../server/services/assetReminderService';
import { runBookAlerts } from '../server/services/bookAlertService';
import { runLedgerHealthMonitor } from '../server/services/ledgerHealthService';
import { practiceRows } from '../server/services/practiceService';
import { workspaceUsage } from '../server/middleware/planCapacity';

const draftDb = () => new Firestore().forSandbox('ca524f77-bd5b-4d91-8e78-1fc50742a8b6');
const refusal = { code: 'SANDBOX_OUTSIDE_EFFECT' };

test('sandbox effect capture refuses delivery/provider results even if a handler catches the refusal', async t => {
  const db = draftDb();
  const mail = t.mock.fn(async () => ({ delivered: true as const, provider: 'test' as const }));
  setMailTransportForTests(mail);
  t.after(() => setMailTransportForTests(null));
  const rate = t.mock.method(FxService, 'transport', async () => ({ rates: { JPY: 155 } }));
  const files = t.mock.fn<typeof fetch>(async () => { throw new Error('Unexpected storage transport'); });
  const bank = t.mock.fn(() => { throw new Error('Unexpected bank read/lease'); });
  const forbidden = [
    () => sendMail({ to: 'person@example.test', subject: 'Draft', html: 'Not approved' }),
    () => FxService.getRate('CAD', 'JPY'),
    () => FxService.getRatesForBase('CAD'),
    () => deleteFilesWithPrefix('workspace/', files),
    () => syncOneBank(db, { id: 'bank', ref: { id: 'bank', update: bank }, data: bank }, { workspaceId: 'wk', uid: 'user', workspaceCurrency: 'USD' }),
    () => verifyPlaidWebhook(Buffer.alloc(0), undefined),
  ];
  for (const call of forbidden) {
    await assert.rejects(captureEffects(db, async () => { await assert.rejects(async () => call(), refusal); }), refusal);
  }
  assert.equal(mail.mock.callCount(), 0);
  assert.equal(rate.mock.callCount(), 0);
  assert.equal(files.mock.callCount(), 0);
  assert.equal(bank.mock.callCount(), 0);
  assert.equal(await FxService.getRate('CAD', 'JPY'), 155, 'draft attempt did not warm the shared FX cache');
  assert.equal(rate.mock.callCount(), 1);
  await assert.rejects(captureEffects(db, () => FxService.getRate('CAD', 'JPY')), refusal);
  assert.equal(rate.mock.callCount(), 1, 'a warm live FX cache cannot supply a draft');
});

test('draft notifications retain only an intent, not content, a callback or a provider response', async () => {
  const db = draftDb();
  const queued = () => { assert.fail('No callback can be queued for a draft'); };
  const captured = await captureEffects(db, async () => {
    deferEffects(db, [{ kind: 'email', action: 'payment-receipt', target: 'inv' }], queued, queued);
    return notify(db, { kind: 'task.assigned', workspaceId: 'wk', recordId: 'tsk', title: 'private text', message: 'private note', eventKey: 'private-key' });
  });
  assert.equal(captured.value, 0);
  assert.deepEqual(captured.intents, [{ kind: 'email', action: 'payment-receipt', target: 'inv' }, { kind: 'notification', action: 'task.assigned', target: 'tsk' }]);
  await assert.rejects(captureEffects(db, () => notify(draftDb(), { kind: 'task.assigned', workspaceId: 'wk', title: '', message: '', eventKey: 'e' })), refusal);
});

test('cross-workspace jobs and mail senders refuse a scoped handle before touching data', async t => {
  const db = draftDb();
  const collection = t.mock.method(db, 'collection');
  const read = t.mock.method(db, 'readRows');
  const tables = t.mock.method(db, 'tables');
  for (const job of [
    () => workspaceUsage(db, 'wk'), () => practiceRows(db, 'person', '2026-10-01'),
    () => runAssetReminders(db), () => runBookAlerts(db), () => runLedgerHealthMonitor(db),
    () => runNotificationDigest(db), () => runScheduledReports(db), () => purgePendingWorkspaces(db),
  ]) {
    await assert.rejects(async () => job(), /requires the live database/);
  }
  await assert.rejects(thankForPayment(db, { workspaceId: 'wk', allocations: [] }), refusal);
  await assert.rejects(emailRemittance(db, { workspaceId: 'wk', id: 'p' }), refusal);
  assert.equal(collection.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(tables.mock.callCount(), 0);
});

// Like the document SQL ratchet, this source inventory is a review alarm, not a sandbox for arbitrary code.
const providers = new Set(['plaid', 'stripe', 'axios', '@supabase/storage-js', 'node:http', 'node:https', 'http', 'https']);
const transports = new Set(['fetch', 'safeFetch', 'getPlaidClient', 'StorageClient', 'PlaidApi']);
function countDirectTransports(file: string, source: string): number {
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && !node.importClause?.isTypeOnly && providers.has(node.moduleSpecifier.text)) count++;
    if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (transports.has(name)) count++;
    }
    ts.forEachChild(node, visit);
  }
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
  return count;
}

test('command definitions have a zero budget for direct provider transports', () => {
  assert.equal(countDirectTransports('example.ts', `import { PlaidApi as Client } from 'plaid';
    import type { Stripe } from 'stripe';
    globalThis.fetch('url'); safeFetch('url'); getPlaidClient(); deferEffects(db, [], after, send);`), 4);
  const dir = 'src/server/commands';
  const violations = readdirSync(dir).filter(file => file.endsWith('.ts')).flatMap(file => {
    const count = countDirectTransports(file, readFileSync(`${dir}/${file}`, 'utf8'));
    return count ? [`${file}: ${count}`] : [];
  });
  assert.deepEqual(violations, [], 'route outside effects through reviewed provider boundaries and deferEffects');
});
