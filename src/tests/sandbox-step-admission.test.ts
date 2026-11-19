import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test, type TestContext } from 'node:test';
import type { RequestUser, UserRequest } from '../server/auth/requestUser';
import { commandRegistry } from '../server/commands/defaultRegistry';
import { openSandbox, reviewSandbox, type SandboxReviewIntent } from '../server/commands/sandboxReview';
import { stepCommand, stepCommandNames } from '../server/commands/sandboxStepCommands';
import { Firestore } from '../server/db/firestore';
import { quoteIdent } from '../server/db/pg/sql';

const url = process.env.LF_TEST_DATABASE_URL;
const request = (user: RequestUser): UserRequest => ({ user } as UserRequest);
const tables = ['chartAccounts', 'customers', 'transactions', 'journalEntries', 'rulePatterns', 'learnedDeltas', 'auditLogs', 'invoices', 'inventory', 'stockMoves', 'repostQueue'];

/** SBX-1: the whole command registry drafts in the sandbox, within the admission boundary. */
describe('SBX-1 step admission: the registry, high-risk acceptance and plan limits', () => {
  test('admission follows the command definition, not a hand-kept list', () => {
    const admitted = new Set(stepCommandNames());
    assert.ok(admitted.size >= 100, `the books' commands are admitted (${admitted.size})`);
    for (const name of ['customer.create', 'invoice.create', 'payment.receive', 'tasks.create', 'bill.create', 'journal.create',
      'inventory.adjust', 'chartaccount.delete', 'contact.merge', 'vendor.update', 'project.create']) {
      assert.ok(admitted.has(name), `${name} is a step`);
    }
    for (const name of ['workspace.create', 'workspace.addmember', 'workspace.scheduledeletion', 'apikey.provision', 'account.merge',
      'security.twostep', 'period.close', 'payroll.run', 'bank.reconnect', 'support.ticket', 'user.preferences', 'lease.capitalize',
      'estimate.signlink', 'record.delete', 'no.such']) {
      assert.ok(!admitted.has(name), `${name} is not a step`);
      assert.throws(() => stepCommand(name), { code: 'SANDBOX_COMMAND_UNAVAILABLE' });
    }
    for (const command of commandRegistry.list()) {
      if (command.scope === 'person' || command.defaultOperationId) assert.ok(!admitted.has(String(command.name)), `${command.name} stays out`);
    }
  });

  describe('against PostgreSQL', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
    let live: Firestore;
    before(() => { live = new Firestore({ connectionString: url, max: 4 }); });
    after(() => live.terminate());

    async function setup(t: TestContext, workspace: Record<string, unknown> = {}) {
      const workspaceId = `sbx-admit-${randomUUID()}`;
      const id = (name: string) => `${workspaceId}-${name}`;
      const owner: RequestUser = { uid: id('owner'), email: 'owner@example.test' };
      const confirmed: RequestUser = { ...owner, aal: 'aal2' };
      t.after(async () => {
        await live.pool.query('delete from sandbox.sandboxes where workspace_id = $1', [workspaceId]);
        for (const table of tables) await live.pool.query(`delete from public.${quoteIdent(table)} where workspace_id = $1`, [workspaceId]);
        await live.doc(`workspaces/${workspaceId}`).delete();
      });
      await live.doc(`workspaces/${workspaceId}`).create({ uid: owner.uid, name: 'Admission test', members: [owner.uid], currency: 'USD', timezone: 'UTC', ...workspace });
      for (const [key, name, type, category] of [['bank', 'Bank', 'asset', 'Cash'], ['fees', 'Bank fees', 'expense', 'Operating'], ['spare', 'Spare', 'expense', 'Operating'],
        ['ar', 'Receivables', 'asset', 'Receivables'], ['sales', 'Sales', 'revenue', 'Revenue'], ['inventory', 'Inventory', 'asset', 'Inventory'], ['cogs', 'Cost of Goods Sold', 'expense', 'COGS']]) {
        await live.doc(`chartAccounts/${id(key)}`).create({ id: id(key), workspaceId, name, type, category, code: key });
      }
      const sandbox = await openSandbox(request(owner), workspaceId, live);
      const scope = { workspaceId, sandboxId: sandbox.id };
      const draft = live.forSandbox(sandbox.id);
      const change = (intent: SandboxReviewIntent, user = owner) => reviewSandbox(request(user), scope, intent, live);
      const add = (command: string, input: unknown) => change({ kind: 'add', command, input });
      const journal = { transaction: { workspaceId, date: '2026-10-01', description: 'Bank fee', lines: [
        { accountId: id('fees'), amountCents: 1500 }, { accountId: id('bank'), amountCents: -1500 }] } };
      const count = async (table: string, db = live) => (await db.collection(table).where('workspaceId', '==', workspaceId).count().get()).data().count;
      return { workspaceId, id, owner, confirmed, draft, change, add, journal, count };
    }

    test('a journal and an account deletion draft; the deletion is accepted alone, after confirmation, by a two-step sign-in only', { timeout: 15_000 }, async t => {
      const f = await setup(t);
      const first = await f.add('journal.create', f.journal);
      assert.equal(first.steps[0].command, 'journal.create');
      assert.equal(await f.count('transactions', f.draft), 1);
      assert.equal(await f.count('transactions'), 0);
      const second = await f.add('chartaccount.delete', { id: f.id('spare') });
      const [journal, deletion] = second.steps;
      assert.equal((await f.draft.doc(`chartAccounts/${f.id('spare')}`).get()).exists, false);
      assert.equal((await live.doc(`chartAccounts/${f.id('spare')}`).get()).exists, true);
      // "Accept all" applies the journal and leaves the high-risk deletion; the deletion read the ledger
      // the journal changed, so it is rechecked rather than pending
      const all = await f.change({ kind: 'accept', revision: second.revision });
      assert.equal(all.outcome, 'accepted');
      assert.deepEqual(all.steps.map(step => [step.command, step.state]), [['journal.create', 'accepted'], ['chartaccount.delete', 'needs-recheck']]);
      assert.equal(await f.count('transactions'), 1);
      const choose = { kind: 'accept', revision: all.revision, stepIds: [deletion.id], confirmRechecked: [deletion.id] } as const;
      await assert.rejects(f.change(choose), { code: 'SANDBOX_HIGH_RISK_CONFIRM' });
      // confirmed, but the person has not signed in with two-step verification: refused, nothing changes
      await assert.rejects(f.change({ ...choose, confirmHighRisk: deletion.id }), { code: 'TWO_STEP_REQUIRED', status: 403 });
      assert.equal((await live.doc(`chartAccounts/${f.id('spare')}`).get()).exists, true);
      const done = await f.change({ ...choose, confirmHighRisk: deletion.id }, f.confirmed);
      assert.equal(done.outcome, 'accepted');
      assert.equal(done.steps.find(step => step.id === deletion.id)?.state, 'accepted');
      assert.equal(done.steps.find(step => step.id === journal.id)?.state, 'accepted');
      assert.equal((await live.doc(`chartAccounts/${f.id('spare')}`).get()).exists, false);
    });

    test('a plan-metered step drafts without using the plan up; accept checks capacity against the live books', { timeout: 15_000 }, async t => {
      const f = await setup(t, { apiQuotaMonthlyLimitCents: 100 }); // one ledger entry in total
      await live.collection('transactions').doc(f.id('existing')).create({ workspaceId: f.workspaceId, uid: f.owner.uid, date: '2026-09-01',
        description: 'Already there', type: 'journal', totalAmountCents: 100, lines: [{ accountId: f.id('fees'), amountCents: 100 }, { accountId: f.id('bank'), amountCents: -100 }] });
      const drafted = await f.add('journal.create', f.journal);
      assert.equal(drafted.steps[0].state, 'pending');
      assert.equal(await f.count('transactions', f.draft), 2);
      await assert.rejects(f.change({ kind: 'accept', revision: drafted.revision }), { code: 'PLAN_CAPACITY_EXCEEDED', status: 402 });
      assert.equal(await f.count('transactions'), 1);
      assert.equal(await f.count('auditLogs'), 0);
    });

    // Gitar on #932: a drafted step runs the command's own input check, as the router does
    test('a step whose input the command itself refuses is refused as a draft too', { timeout: 15_000 }, async t => {
      const f = await setup(t);
      const elsewhere = { ...f.journal.transaction, workspaceId: `${f.workspaceId}-other` };
      await assert.rejects(f.add('journal.bulk', { transactions: [elsewhere] }), { code: 'WORKSPACE_MISMATCH' });
      assert.equal(await f.count('transactions', f.draft), 0);
      assert.equal(await f.count('transactions'), 0);
    });

    test('stock-moving steps draft in provisional order without a live sequence; accept replays the same cost', { timeout: 20_000 }, async t => {
      const f = await setup(t);
      const party = f.id('buyer');
      const item = f.id('widget');
      await live.doc(`customers/${party}`).create({ id: party, workspaceId: f.workspaceId, name: 'Acme Design' });
      await live.doc(`inventory/${item}`).create({ workspaceId: f.workspaceId, unitCostCents: 400, quantityAtHand: 10, name: 'Widget' });
      // a live move already numbered by the real sequence, so the draft must sort after it
      await live.doc(`stockMoves/${f.id('receipt')}`).create({ workspaceId: f.workspaceId, itemId: item, date: '2026-10-01', kind: 'purchase',
        quantity: 10, quantityBefore: 0, quantityAfter: 10, unitCostCents: 400, seq: '2026-10-01T00:00:00.000Z#00000', createdAt: '2026-10-01T00:00:00.000Z' });
      const liveSeq = Number((await live.doc(`stockMoves/${f.id('receipt')}`).get()).data()?.dbSeq);
      assert.ok(Number.isSafeInteger(liveSeq) && liveSeq > 0);
      const { rows: [seqBefore] } = await live.pool.query('select last_value, is_called from public."stockMoves_db_seq"');
      const sale = (quantity: number, number: string) => ({ invoice: { customerId: party, customerName: 'Acme Design', date: '2026-10-01', dueDate: '2026-11-01',
        status: 'sent', currency: 'USD', exchangeRate: 1, number, amountCents: quantity * 1250,
        items: [{ id: f.id(`line-${number}`), itemId: item, description: 'Widget', quantity, rateCents: 1250, amountCents: quantity * 1250, accountId: f.id('sales') }] } });
      await f.add('invoice.create', sale(2, 'S-1'));
      const drafted = await f.add('invoice.create', sale(3, 'S-2'));
      assert.equal((await f.draft.doc(`inventory/${item}`).get()).data()?.quantityAtHand, 5);
      const draftMoves = (await f.draft.collection('stockMoves').where('workspaceId', '==', f.workspaceId).get()).docs
        .map(d => d.data()).filter(m => m.kind !== 'purchase').sort((a, b) => Number(a.dbSeq) - Number(b.dbSeq));
      assert.deepEqual(draftMoves.map(m => [m.quantity, Number(m.dbSeq) > liveSeq]), [[-2, true], [-3, true]]);
      assert.ok(Number(draftMoves[0].dbSeq) < Number(draftMoves[1].dbSeq), 'draft moves keep their order');
      assert.deepEqual((await live.pool.query('select last_value, is_called from public."stockMoves_db_seq"')).rows[0], seqBefore, 'no live sequence advanced');
      assert.equal(await f.count('stockMoves'), 1);
      assert.equal(await f.count('repostQueue'), 0);
      const cogsOf = async (db: Firestore) => (await db.collection('transactions').where('workspaceId', '==', f.workspaceId).get()).docs
        .flatMap(d => (d.data().lines as Array<{ accountId: string; amountCents: number }>)).filter(l => l.accountId === f.id('cogs')).map(l => l.amountCents).sort((a, b) => a - b);
      const draftCogs = await cogsOf(f.draft);
      assert.deepEqual(draftCogs, [800, 1200]);
      const accepted = await f.change({ kind: 'accept', revision: drafted.revision });
      assert.equal(accepted.outcome, 'accepted');
      assert.deepEqual(await cogsOf(live), draftCogs, 'the live replay posts the cost the draft showed');
      assert.equal((await live.doc(`inventory/${item}`).get()).data()?.quantityAtHand, 5);
      const liveMoves = (await live.collection('stockMoves').where('workspaceId', '==', f.workspaceId).get()).docs.map(d => d.data())
        .filter(m => m.kind !== 'purchase').sort((a, b) => Number(a.dbSeq) - Number(b.dbSeq));
      assert.deepEqual(liveMoves.map(m => m.quantity), [-2, -3], 'the real sequence keeps the draft order');
      assert.ok(liveMoves.every(m => Number(m.dbSeq) > liveSeq));
    });

    test('a step that writes outside the books is refused at the door and keeps nothing', { timeout: 15_000 }, async t => {
      const f = await setup(t);
      await assert.rejects(f.add('autorule.learn', { description: 'Monthly hosting', accountId: f.id('fees'), accountName: 'Bank fees' }),
        { code: 'SANDBOX_WRITE_NOT_REVIEWED' });
      assert.equal(await f.count('rulePatterns', f.draft), 0);
      assert.equal(await f.count('learnedDeltas'), 0);
      const review = await f.change({ kind: 'review' });
      assert.deepEqual(review.steps, []);
    });
  });
});
