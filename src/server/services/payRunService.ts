import type { DocumentData, DocumentReference, Firestore, Transaction as Tx } from '../db/firestore';
import { ledgerCreate, ledgerMark } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { lockMessage, postingLock, workspaceRole } from '../../lib/periodLock';
import { mayApprove, TWO_PERSON_REFUSAL, twoPersonOn } from '../../lib/twoPersonRule';
import { hoursToPay, sharedTime, sharedTimeMessage, type PayableTime } from '../../lib/hourlyPay';
import { TIME_KIND } from '../../lib/timeEntries';
import { payRunLines, payRunTotals, totalsOfLines, type PayRunAccounts, type PayRunEmployeeLine, type PayRunTotals, type PaySchedule } from '../../lib/payRunPosting';
import { isCashAccount } from '../../lib/txFilters';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';
import { addDaysYMD } from '../../lib/fiscalCalendar';
import type { ChartAccount, Employee } from '../../types';
import { writeServerAuditLog } from './auditLogService';
import { notify } from './notificationService';

/**
 * Pay runs (U-02), for owners and accountants: the server works out every active employee's pay for
 * one period (src/lib/payRunPosting.ts), posts one balanced entry on the pay date and keeps the run
 * with its per-employee amounts, in one database transaction with an audit line. A second run on the
 * same date is refused unless asked for; undo voids the entry while the date is open. Before, the
 * Payroll screen only changed what was on the screen: nothing was saved.
 *
 * Approval (U-10): an owner can require it. Then a run an accountant prepares is kept, not posted,
 * with its per-employee amounts, and the owners are told; an owner approves it (exactly those
 * amounts are posted) or sends it back with a note, and whoever prepared it is told. The preparer
 * can withdraw it while it waits. Owners' own runs post straight away.
 */
export class PayRunError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const ROLES = ['owner', 'accountant'];
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

interface Actor { workspaceId: string; uid: string; email?: string }
export interface PostPayRunInput extends Actor {
  date: string;
  bankAccountId: string;
  wagesAccountId: string;
  taxExpenseAccountId: string;
  liabilitiesAccountId: string;
  /** a second run on the same date (for example a bonus run) */
  again?: boolean;
  /** U-07: whom this run pays: one pay schedule, or everyone */
  schedule?: PaySchedule;
}

const AWAITING = 'awaiting_approval';

interface AccountIds { bankAccountId: string; wagesAccountId: string; taxExpenseAccountId: string; liabilitiesAccountId: string }

async function chooseAccounts(t: Tx, db: Firestore, workspaceId: string, ids: AccountIds): Promise<PayRunAccounts> {
  const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
  const byId = new Map(accounts.filter(a => !a.isArchived).map(a => [a.id, a]));
  const pick = (id: string, what: string, ok: (a: ChartAccount) => boolean) => {
    const account = byId.get(id);
    if (!account || !ok(account)) throw new PayRunError(400, `Choose ${what}`);
    return { id: account.id, name: account.name };
  };
  const type = (a: ChartAccount) => String(a.type).toLowerCase();
  return {
    bank: pick(ids.bankAccountId, 'the bank account the pay goes out of', a => type(a) === 'asset' && isCashAccount(a)),
    wages: pick(ids.wagesAccountId, 'the wages expense account', a => ['expense', 'cost_of_goods'].includes(type(a))),
    taxExpense: pick(ids.taxExpenseAccountId, 'the payroll tax expense account', a => ['expense', 'cost_of_goods'].includes(type(a))),
    liabilities: pick(ids.liabilitiesAccountId, 'the payroll liabilities account', a => type(a) === 'liability'),
  };
}

/** The same people paid twice on one date is the mistake to catch; another schedule on that date is not. */
async function refuseSameDay(t: Tx, db: Firestore, workspaceId: string, date: string, totals: PayRunTotals, again: boolean, except?: string) {
  const paidIds = new Set(totals.employees.map(e => e.employeeId));
  const sameDay = (await t.get(db.collection('payRuns').where('workspaceId', '==', workspaceId).where('date', '==', date))).docs
    .filter(d => d.id !== except && ['processed', AWAITING].includes(String(d.data().status))
      && (!Array.isArray(d.data().employees) || (d.data().employees as Array<{ employeeId: string }>).some(e => paidIds.has(e.employeeId))));
  if (!sameDay.length || again) return;
  const waiting = sameDay.every(d => d.data().status === AWAITING);
  throw new PayRunError(409, waiting
    ? `A pay run on ${date} is already waiting for approval; prepare another only if it is meant (for example a bonus run)`
    : `A pay run on ${date} is already posted; post another only if it is meant (for example a bonus run)`);
}

/** Posts the entry and keeps the run, inside the caller's database transaction. */
async function postRun(t: Tx, db: Firestore, workspace: DocumentData, input: {
  workspaceId: string; uid: string; email?: string; date: string; schedule: PaySchedule; chosen: PayRunAccounts; totals: PayRunTotals;
  runRef: DocumentReference; runFields?: DocumentData; action: string; describe?: string;
}) {
  const { totals, schedule } = input;
  const lines = payRunLines(totals, input.chosen);
  const currency = String(workspace.currency || 'USD');
  const description = `Payroll ${input.date}${schedule === 'all' ? '' : ` (${schedule.toLowerCase()})`}: ${totals.employees.length} ${totals.employees.length === 1 ? 'person' : 'people'}`;
  let ledgerTx;
  try {
    ledgerTx = await TransactionValidator.validateAndPrepare({
      id: db.collection('transactions').doc().id,
      workspaceId: input.workspaceId, uid: input.uid, date: input.date, description,
      totalAmountCents: totals.costCents, currency, exchangeRate: 1, status: 'completed', type: 'journal',
      metadata: { type: 'pay-run', payRunId: input.runRef.id },
      lines: lines.map(l => ({ accountId: l.accountId, accountName: l.accountName, amountCents: l.amountCents, description: l.description })),
    }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Period Locked/i.test(message)) throw new PayRunError(409, message);
    throw err;
  }
  ledgerCreate(t, db.collection('transactions').doc(ledgerTx.id), { ...ledgerTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  t.set(input.runRef, {
    workspaceId: input.workspaceId, uid: input.uid, date: input.date, createdAt: new Date().toISOString(), schedule,
    ...input.runFields,
    status: 'processed', transactionId: ledgerTx.id, ...runAmounts(totals),
  });
  await writeServerAuditLog({
    workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: input.action, entityType: 'payRuns', entityId: input.runRef.id,
    details: { description: `${description}; gross ${formatCurrency(totals.grossCents, currency)}, net ${formatCurrency(totals.netCents, currency)}, cost ${formatCurrency(totals.costCents, currency)}${input.describe || ''}`, transactionId: ledgerTx.id },
  }, { db, tx: t });
  return { payRunId: input.runRef.id, transactionId: ledgerTx.id };
}

const runAmounts = (totals: PayRunTotals) => ({
  totalAmountCents: totals.costCents, employeeCount: totals.employees.length,
  grossCents: totals.grossCents, netCents: totals.netCents, withheldCents: totals.withheldCents,
  employerTaxCents: totals.employerTaxCents, deductionsCents: totals.deductionsCents, employees: totals.employees,
});

/** U-11: the workspace's time entries that could be paid (read before anything is written). */
async function payableTime(t: Tx, db: Firestore, workspaceId: string): Promise<PayableTime[]> {
  const snap = await t.get(db.collection('documents').where('workspaceId', '==', workspaceId).where('kind', '==', TIME_KIND));
  return snap.docs.map(d => ({ ...(d.data() as Omit<PayableTime, 'id'>), id: d.id }));
}

/** U-11: the time a run pays is marked with it, so no later run pays it again; freed when the run does not stand. */
function markTime(t: Tx, db: Firestore, lines: PayRunEmployeeLine[], runId: string | null) {
  for (const line of lines) for (const id of line.timeEntryIds || []) t.update(db.collection('documents').doc(id), { paidRunId: runId });
}

export async function postPayRun(db: Firestore, input: PostPayRunInput) {
  if (!DAY.test(input.date)) throw new PayRunError(400, 'Choose the pay date');
  const result = await db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new PayRunError(404, 'Workspace not found');
    const role = workspaceRole(workspace, input.uid);
    if (!ROLES.includes(role)) throw new PayRunError(403, 'Only owners and accountants run payroll');
    const chosen = await chooseAccounts(t, db, input.workspaceId, input);
    const employees = (await t.get(db.collection('employees').where('workspaceId', '==', input.workspaceId))).docs.map(d => ({ ...d.data(), id: d.id }) as Employee);
    const schedule: PaySchedule = input.schedule || 'all';
    const time = await payableTime(t, db, input.workspaceId);
    // U-12: one person's time pays one employee
    const shared = sharedTime(employees, time, input.date, schedule);
    if (shared.length > 0) throw new PayRunError(409, sharedTimeMessage(shared));
    const hours = hoursToPay(employees, time, input.date);
    const totals = payRunTotals(employees, Number(input.date.slice(0, 4)), schedule, hours);
    if (totals.employees.length === 0) throw new PayRunError(400, schedule === 'all' ? 'There is nobody on the payroll' : `Nobody is paid ${schedule.toLowerCase()}`);
    await refuseSameDay(t, db, input.workspaceId, input.date, totals, Boolean(input.again));
    const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
    if (input.date > addDaysYMD(today, 31)) throw new PayRunError(400, 'The pay date is more than a month away');
    const runRef = db.collection('payRuns').doc();

    if ((workspace.payrollApproval === true && role !== 'owner') || twoPersonOn(workspace)) {
      // U-10: kept with its amounts until an owner approves it; nothing is posted yet (with the
      // two-person rule, P-05, every run waits for someone other than whoever prepared it)
      const now = new Date().toISOString();
      t.set(runRef, {
        workspaceId: input.workspaceId, uid: input.uid, submittedByEmail: input.email || '', date: input.date, createdAt: now, schedule,
        status: AWAITING, again: Boolean(input.again),
        accountIds: { bankAccountId: chosen.bank.id, wagesAccountId: chosen.wages.id, taxExpenseAccountId: chosen.taxExpense.id, liabilitiesAccountId: chosen.liabilities.id },
        ...runAmounts(totals),
      });
      markTime(t, db, totals.employees, runRef.id);
      const currency = String(workspace.currency || 'USD');
      await writeServerAuditLog({
        workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'PAY_RUN_SUBMITTED', entityType: 'payRuns', entityId: runRef.id,
        details: { description: `Sent the pay run of ${input.date} for approval: ${totals.employees.length} ${totals.employees.length === 1 ? 'person' : 'people'}, cost ${formatCurrency(totals.costCents, currency)}` },
      }, { db, tx: t });
      return { awaitingApproval: true as const, payRunId: runRef.id, currency, ...totals };
    }
    const posted = await postRun(t, db, workspace, { ...input, schedule, chosen, totals, runRef, action: 'PAY_RUN_POSTED' });
    markTime(t, db, totals.employees, runRef.id);
    return { ...posted, ...totals };
  });
  if ('awaitingApproval' in result) {
    await notifyPayRun(db, { workspaceId: input.workspaceId, payRunId: result.payRunId, event: 'requested', date: input.date, costCents: result.costCents, currency: result.currency, actorUid: input.uid });
  }
  return result;
}

interface StoredRun { workspaceId: string; uid: string; date: string; status: string; schedule?: PaySchedule; again?: boolean; accountIds?: AccountIds; employees?: PayRunEmployeeLine[]; submittedByEmail?: string; createdAt?: string }

async function waitingRun(t: Tx, db: Firestore, input: Actor & { payRunId: string }, approving = false) {
  const wsRef = db.collection('workspaces').doc(input.workspaceId);
  const workspace = (await t.get(wsRef)).data();
  if (!workspace) throw new PayRunError(404, 'Workspace not found');
  // P-05: with the two-person rule an accountant may decide too, but never on a run they prepared
  const twoPerson = twoPersonOn(workspace);
  const role = workspaceRole(workspace, input.uid);
  if (role !== 'owner' && !(twoPerson && role === 'accountant')) throw new PayRunError(403, 'Only an owner approves or sends back a pay run');
  const runRef = db.collection('payRuns').doc(input.payRunId);
  const run = (await t.get(runRef)).data() as StoredRun | undefined;
  if (!run || run.workspaceId !== input.workspaceId) throw new PayRunError(404, 'That pay run is not in this workspace');
  if (run.status !== AWAITING) throw new PayRunError(409, 'This pay run is not waiting for approval');
  if (approving && !mayApprove(twoPerson, input.uid, run.uid)) throw new PayRunError(403, TWO_PERSON_REFUSAL);
  return { workspace, runRef, run };
}

/** U-10: an owner approves a waiting run; the amounts that were sent for approval are posted. */
export async function approvePayRun(db: Firestore, input: Actor & { payRunId: string; again?: boolean }) {
  const result = await db.runTransaction(async t => {
    const { workspace, runRef, run } = await waitingRun(t, db, input, true);
    if (!run.accountIds || !Array.isArray(run.employees) || run.employees.length === 0) throw new PayRunError(409, 'This pay run is incomplete; send it back and prepare it again');
    const chosen = await chooseAccounts(t, db, input.workspaceId, run.accountIds);
    const totals = totalsOfLines(run.employees);
    await refuseSameDay(t, db, input.workspaceId, run.date, totals, Boolean(run.again || input.again), runRef.id);
    const now = new Date().toISOString();
    const posted = await postRun(t, db, workspace, {
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, date: run.date, schedule: run.schedule || 'all', chosen, totals, runRef,
      runFields: { uid: run.uid, createdAt: run.createdAt || now, submittedByEmail: run.submittedByEmail || '', accountIds: run.accountIds, approvedBy: input.uid, approvedByEmail: input.email || '', approvedAt: now },
      action: 'PAY_RUN_APPROVED', describe: `; prepared by ${run.submittedByEmail || 'a teammate'}`,
    });
    return { ...posted, submitter: run.uid, date: run.date, costCents: totals.costCents, currency: String(workspace.currency || 'USD') };
  });
  await notifyPayRun(db, { workspaceId: input.workspaceId, payRunId: result.payRunId, event: 'approved', date: result.date, costCents: result.costCents, currency: result.currency, actorUid: input.uid, submitter: result.submitter });
  return { payRunId: result.payRunId, transactionId: result.transactionId };
}

/** U-10: an owner sends a waiting run back, with a note for whoever prepared it. Nothing was posted. */
export async function rejectPayRun(db: Firestore, input: Actor & { payRunId: string; note?: string }) {
  const note = String(input.note || '').trim().slice(0, 500);
  const result = await db.runTransaction(async t => {
    const { workspace, runRef, run } = await waitingRun(t, db, input);
    const now = new Date().toISOString();
    t.update(runRef, { status: 'rejected', rejectedBy: input.uid, rejectedByEmail: input.email || '', rejectedAt: now, rejectionNote: note });
    markTime(t, db, run.employees || [], null);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'PAY_RUN_REJECTED', entityType: 'payRuns', entityId: input.payRunId,
      details: { description: `Sent back the pay run of ${run.date} prepared by ${run.submittedByEmail || 'a teammate'}${note ? `: ${note}` : ''}` },
    }, { db, tx: t });
    const totals = totalsOfLines(run.employees || []);
    return { submitter: run.uid, date: run.date, costCents: totals.costCents, currency: String(workspace.currency || 'USD') };
  });
  await notifyPayRun(db, { workspaceId: input.workspaceId, payRunId: input.payRunId, event: 'rejected', note, actorUid: input.uid, ...result });
  return { payRunId: input.payRunId };
}

/** U-10: owners decide whether pay runs prepared by others need their approval. */
export async function setPayrollApproval(db: Firestore, input: Actor & { required: boolean }) {
  return db.runTransaction(async t => {
    const ref = db.collection('workspaces').doc(input.workspaceId);
    const workspace = (await t.get(ref)).data();
    if (!workspace) throw new PayRunError(404, 'Workspace not found');
    if (workspaceRole(workspace, input.uid) !== 'owner') throw new PayRunError(403, 'Only owners decide whether payroll needs approval');
    t.update(ref, { payrollApproval: input.required, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'PAYROLL_APPROVAL_SET', entityType: 'workspaces', entityId: input.workspaceId,
      details: { description: input.required ? 'Pay runs prepared by others now need an owner\'s approval' : 'Pay runs no longer need approval' },
    }, { db, tx: t });
    return { required: input.required };
  });
}

/** Tells the owners a run waits, or whoever prepared it what was decided. Never breaks the save. */
async function notifyPayRun(db: Firestore, input: {
  workspaceId: string; payRunId: string; event: 'requested' | 'approved' | 'rejected'; date: string; costCents: number; currency: string;
  actorUid: string; submitter?: string; note?: string;
}) {
  const amount = formatCurrency(input.costCents, input.currency);
  await notify(db, {
    workspaceId: input.workspaceId,
    kind: input.event === 'requested' ? 'payroll.approval_requested' : 'payroll.decided',
    title: input.event === 'requested' ? `The pay run of ${input.date} waits for your approval`
      : input.event === 'approved' ? `The pay run of ${input.date} was approved and posted` : `The pay run of ${input.date} was sent back`,
    message: input.event === 'requested' ? `It costs ${amount} and is not posted until an owner approves it.`
      : input.event === 'approved' ? `${amount} is in the books.` : `Nothing was posted${input.note ? `: "${input.note.slice(0, 200)}"` : '.'}`,
    eventKey: `payrun:${input.payRunId}:${input.event}`,
    recordId: input.payRunId,
    actorUid: input.actorUid,
    ...(input.submitter ? { onlyUids: [input.submitter] } : {}),
  });
}

/** Undo a pay run: its entry is voided and the run marked undone, while the date is open. */
export async function undoPayRun(db: Firestore, input: Actor & { payRunId: string }) {
  return db.runTransaction(async t => {
    const workspace = (await t.get(db.collection('workspaces').doc(input.workspaceId))).data();
    if (!workspace) throw new PayRunError(404, 'Workspace not found');
    if (!ROLES.includes(workspaceRole(workspace, input.uid))) throw new PayRunError(403, 'Only owners and accountants run payroll');
    const runRef = db.collection('payRuns').doc(input.payRunId);
    const run = (await t.get(runRef)).data();
    if (!run || run.workspaceId !== input.workspaceId) throw new PayRunError(404, 'That pay run is not in this workspace');
    if (run.status === AWAITING) {
      // U-10: whoever prepared it, or an owner, withdraws it while it waits; nothing was posted
      if (run.uid !== input.uid && workspaceRole(workspace, input.uid) !== 'owner') throw new PayRunError(403, 'Only whoever prepared this pay run, or an owner, can withdraw it');
      t.update(runRef, { status: 'withdrawn', withdrawnAt: new Date().toISOString() });
      markTime(t, db, (run.employees || []) as PayRunEmployeeLine[], null);
      await writeServerAuditLog({
        workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'PAY_RUN_WITHDRAWN', entityType: 'payRuns', entityId: input.payRunId,
        details: { description: `Withdrew the pay run of ${String(run.date)} before it was approved` },
      }, { db, tx: t });
      return { payRunId: input.payRunId };
    }
    if (run.status !== 'processed' || !run.transactionId) throw new PayRunError(409, 'This pay run is not posted');
    const lock = postingLock(String(run.date), workspace as never, input.uid);
    if (lock) throw new PayRunError(409, lockMessage(String(run.date), lock));
    const now = new Date().toISOString();
    ledgerMark(t, db.collection('transactions').doc(String(run.transactionId)), { status: 'void', voidedReason: 'Pay run undone', voidedAt: now, updatedAt: now });
    t.update(runRef, { status: 'undone', undoneAt: now });
    markTime(t, db, (run.employees || []) as PayRunEmployeeLine[], null);
    await writeServerAuditLog({
      workspaceId: input.workspaceId, uid: input.uid, email: input.email, action: 'PAY_RUN_UNDONE', entityType: 'payRuns', entityId: input.payRunId,
      details: { description: `Undid the pay run of ${String(run.date)}; its entry is void`, transactionId: run.transactionId },
    }, { db, tx: t });
    return { payRunId: input.payRunId };
  });
}
