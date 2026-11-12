/**
 * The daily recurring job (Vercel Cron, cronRoutes.ts). Only active schedules run (Pause on the
 * Recurring screen stops them; BE-03). Each occurrence runs once (its occurrence key):
 *  - a recurring **invoice** creates a draft invoice for the team to review and send, and tells
 *    them (invoices are posted when a person saves them, like any other invoice);
 *  - a recurring **bill** (BE-08) creates a draft bill the same way, for the team to check and save;
 *  - a recurring **estimate** (CC-04) creates a draft estimate with the next number, for the team to
 *    check and send (nothing is sent or posted);
 *  - a recurring **entry** is posted to the ledger only if its lines use real accounts of the
 *    workspace and balance; otherwise nothing is written and the schedule shows the problem.
 * Before this, invoice schedules wrote ledger entries with blank accounts and no workspace.
 */
import { getDb, FieldValue, isWorkspaceMemberData } from '../db/firestore';
import type { DocumentData, Firestore } from '../db/firestore';
import type { Bill, Estimate, Invoice, RecurringTransaction, Transaction } from '../../types';
import { nextEstimateDraft } from '../../lib/recurringEstimates';
import { findDueRecurring } from '../../lib/recurringEngine';
import { addDaysYMD } from '../../lib/fiscalCalendar';
import { assertPostingOpen } from '../../lib/periodLock';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { settleHomeCurrency } from '../../lib/txFilters';
import { ledgerWrite } from './ledgerDoor';
import { allocateNextNumber } from '../routes/workspaceRoutes';
import { allocateInTransaction } from './numberingService';
import { notify } from './notificationService';
import { logger } from '../utils/logger';

export interface ProcessRecurringResult {
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  totalDue: number;
  details: Array<{
    operationId: string;
    status: 'success' | 'skipped' | 'failed';
    error?: string;
    txId?: string;
    invoiceId?: string;
    billId?: string;
    estimateId?: string;
  }>;
}

class RecurringSkip extends Error {}

export function isInvoiceSchedule(rule: Partial<RecurringTransaction>): boolean {
  return rule.type === 'invoice' || Boolean(rule.invoiceTemplate) || Boolean(rule.template?.tags?.includes('invoice'));
}

export function isBillSchedule(rule: Partial<RecurringTransaction> & { billTemplate?: unknown }): boolean {
  return rule.type === 'bill' || Boolean(rule.billTemplate);
}

export function isEstimateSchedule(rule: Partial<RecurringTransaction> & { estimateTemplate?: unknown }): boolean {
  return rule.type === 'estimate' || Boolean(rule.estimateTemplate);
}

/** Why a recurring entry can't be posted, or null when it can. */
export function invalidEntryReason(lines: Transaction['lines'] | undefined, accountIds: Set<string>): string | null {
  if (!Array.isArray(lines) || lines.length < 2) return 'The entry needs at least two lines';
  if (lines.some(l => !l.accountId || !accountIds.has(l.accountId))) return 'A line has no account, or an account that is not in this workspace';
  if (lines.some(l => !Number.isInteger(l.amountCents))) return 'A line amount is not in whole cents';
  if (lines.reduce((sum, l) => sum + l.amountCents, 0) !== 0) return 'Debits and credits are not equal';
  return null;
}

async function markProblem(db: Firestore, ruleId: string, message: string) {
  await db.collection('recurring').doc(ruleId).update({ lastErrorCode: message.slice(0, 200), lastErrorAt: new Date().toISOString() });
}

async function generateInvoice(db: Firestore, rule: RecurringTransaction, date: string, nextOccurrence: string) {
  const key = `${rule.id}:${date}`;
  const existing = await db.collection('invoices').where('workspaceId', '==', rule.workspaceId).where('recurrenceOccurrenceKey', '==', key).limit(1).get();
  if (!existing.empty) throw new RecurringSkip(`Occurrence ${key} already generated`);
  const workspace = (await db.collection('workspaces').doc(rule.workspaceId).get()).data() || {};

  const t = rule.invoiceTemplate || {};
  const legacy = (rule.template || {}) as DocumentData;
  // the schedule's amount (saved with the schedule since it was created)
  const amountCents = typeof t.amountCents === 'number' ? t.amountCents : Number(rule.amountCents) || 0;
  const dueDays = Number.isInteger(t.dueDays) ? Number(t.dueDays) : 30;
  const items = Array.isArray(t.items) && t.items.length
    ? t.items
    : [{ id: `${rule.id}-line`, description: String(legacy.description || rule.description || ''), quantity: 1, rateCents: amountCents, amountCents, accountId: '' }];
  const number = await allocateNextNumber(db, rule.workspaceId, 'invoice');
  const invoiceRef = db.collection('invoices').doc();
  const invoice: Partial<Invoice> & DocumentData = {
    ...t,
    id: invoiceRef.id,
    workspaceId: rule.workspaceId,
    uid: rule.uid,
    number,
    status: 'draft',
    date,
    dueDate: addDaysYMD(date, dueDays),
    customerId: t.customerId || legacy.customerId || '',
    customerName: t.customerName || rule.payee || '',
    currency: t.currency || workspace.currency || 'USD',
    items,
    amountCents,
    recurrenceOccurrenceKey: key,
    metadata: { recurringTemplateId: rule.id, generatedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };
  delete invoice.dueDays;

  await db.runTransaction(async (tx) => {
    const ruleSnap = await tx.get(db.collection('recurring').doc(rule.id));
    const again = await tx.get(db.collection('invoices').where('workspaceId', '==', rule.workspaceId).where('recurrenceOccurrenceKey', '==', key).limit(1));
    if (!ruleSnap.exists || !ruleSnap.data()?.isActive) throw new RecurringSkip(`Schedule ${rule.id} is paused`);
    if (!again.empty) throw new RecurringSkip(`Occurrence ${key} already generated`);
    tx.set(invoiceRef, invoice);
    tx.update(db.collection('recurring').doc(rule.id), {
      nextOccurrence, lastOccurrence: date, generatedCount: (Number(ruleSnap.data()?.generatedCount) || 0) + 1,
      lastErrorCode: FieldValue.delete(), lastErrorAt: FieldValue.delete(), updatedAt: new Date().toISOString(),
    });
  });
  await notify(db, {
    workspaceId: rule.workspaceId, workspace, kind: 'invoice.draft_ready',
    title: `Recurring invoice ${number} is ready`,
    message: `A draft for ${String(invoice.customerName || 'the customer')} dated ${date}. Check it, save it as final and send it.`,
    eventKey: `invoice.draft_ready:${key}`, recordId: invoiceRef.id,
  });
  return { invoiceId: invoiceRef.id };
}

/** BE-08: a draft bill copied from the schedule (posted only when someone saves it as final). */
async function generateBill(db: Firestore, rule: RecurringTransaction & { billTemplate?: DocumentData }, date: string, nextOccurrence: string) {
  const key = `${rule.id}:${date}`;
  const existing = await db.collection('bills').where('workspaceId', '==', rule.workspaceId).where('recurrenceOccurrenceKey', '==', key).limit(1).get();
  if (!existing.empty) throw new RecurringSkip(`Occurrence ${key} already generated`);
  const workspace = (await db.collection('workspaces').doc(rule.workspaceId).get()).data() || {};
  const t = rule.billTemplate || {};
  const amountCents = typeof t.amountCents === 'number' ? t.amountCents : Number(rule.amountCents) || 0;
  const dueDays = Number.isInteger(t.dueDays) ? Number(t.dueDays) : 30;
  const billRef = db.collection('bills').doc();
  const bill: Partial<Bill> & DocumentData = {
    ...t,
    id: billRef.id,
    workspaceId: rule.workspaceId,
    uid: rule.uid,
    number: '',
    status: 'draft',
    date,
    dueDate: addDaysYMD(date, dueDays),
    vendorId: t.vendorId || '',
    vendorName: t.vendorName || rule.payee || '',
    currency: t.currency || workspace.currency || 'USD',
    splits: Array.isArray(t.splits) ? t.splits : [],
    amountCents,
    recurrenceOccurrenceKey: key,
    metadata: { recurringTemplateId: rule.id, generatedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };
  delete bill.dueDays;
  await db.runTransaction(async (tx) => {
    const ruleSnap = await tx.get(db.collection('recurring').doc(rule.id));
    const again = await tx.get(db.collection('bills').where('workspaceId', '==', rule.workspaceId).where('recurrenceOccurrenceKey', '==', key).limit(1));
    if (!ruleSnap.exists || !ruleSnap.data()?.isActive) throw new RecurringSkip(`Schedule ${rule.id} is paused`);
    if (!again.empty) throw new RecurringSkip(`Occurrence ${key} already generated`);
    tx.set(billRef, bill);
    tx.update(db.collection('recurring').doc(rule.id), {
      nextOccurrence, lastOccurrence: date, generatedCount: (Number(ruleSnap.data()?.generatedCount) || 0) + 1,
      lastErrorCode: FieldValue.delete(), lastErrorAt: FieldValue.delete(), updatedAt: new Date().toISOString(),
    });
  });
  await notify(db, {
    workspaceId: rule.workspaceId, workspace, kind: 'bill.draft_ready',
    title: `Recurring bill from ${String(bill.vendorName || 'a vendor')} is ready`,
    message: `A draft dated ${date}. Check it (add the vendor's bill number) and save it as final.`,
    eventKey: `bill.draft_ready:${key}`, recordId: billRef.id,
  });
  return { billId: billRef.id };
}

/** CC-04: a draft estimate copied from the schedule, with the next estimate number. */
async function generateEstimate(db: Firestore, rule: RecurringTransaction & { estimateTemplate?: DocumentData }, date: string, nextOccurrence: string) {
  // one draft per estimate and date, whichever schedule makes it: two schedules for the same estimate
  // share this key, so the second is skipped whatever their timestamps say
  const source = (rule as { sourceEstimateId?: string }).sourceEstimateId;
  const key = source ? `estimate:${source}:${date}` : `${rule.id}:${date}`;
  const existing = await db.collection('estimates').where('workspaceId', '==', rule.workspaceId).where('recurrenceOccurrenceKey', '==', key).limit(1).get();
  if (!existing.empty) throw new RecurringSkip(`Occurrence ${key} already generated`);
  const t = (rule.estimateTemplate || {}) as Partial<Estimate> & DocumentData;
  if (!t.customerId) throw new Error('The schedule has no customer');
  if (!Array.isArray(t.lines) || t.lines.length === 0) {
    await markProblem(db, rule.id, 'The estimate has no lines');
    throw new Error('The estimate has no lines');
  }
  const workspace = (await db.collection('workspaces').doc(rule.workspaceId).get()).data() || {};
  const estimateRef = db.collection('estimates').doc();
  let number = '';
  let customerName = t.customerName;
  await db.runTransaction(async (tx) => {
    const ruleSnap = await tx.get(db.collection('recurring').doc(rule.id));
    // the template as stored now (a contact merge may have changed it since the job read the schedule)
    const current = (ruleSnap.data()?.estimateTemplate || {}) as Partial<Estimate> & DocumentData;
    const again = await tx.get(db.collection('estimates').where('workspaceId', '==', rule.workspaceId).where('recurrenceOccurrenceKey', '==', key).limit(1));
    if (!ruleSnap.exists || !ruleSnap.data()?.isActive) throw new RecurringSkip(`Schedule ${rule.id} is paused`);
    if (!current.customerId) throw new Error('The schedule has no customer');
    if (!Array.isArray(current.lines) || current.lines.length === 0) throw new Error('The estimate has no lines');
    if (!again.empty) throw new RecurringSkip(`Occurrence ${key} already generated`);
    // one schedule per estimate: if the same estimate was set to repeat twice, only the first one runs
    // (read inside this serializable transaction, so a schedule saved meanwhile is seen or the write retries)
    if (source) {
      const siblings = await tx.get(db.collection('recurring').where('workspaceId', '==', rule.workspaceId).where('sourceEstimateId', '==', source));
      const first = siblings.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; isActive?: boolean; createdAt?: string }))
        .filter(r => r.isActive !== false)
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id))[0];
      if (first && first.id !== rule.id) throw new RecurringSkip(`Estimate ${source} already repeats on schedule ${first.id}`);
    }
    // the number is taken in the same transaction, so a skipped draft leaves no gap
    number = await allocateInTransaction(db, tx, rule.workspaceId, 'estimate');
    const draft = nextEstimateDraft(current, { id: estimateRef.id, number, date });
    const { validityDays: _validity, ...fields } = draft as Estimate & { validityDays?: number };
    // the copy's own fields; empty ones (no signing link, no conversion) are left out
    const estimate: DocumentData = Object.fromEntries(Object.entries({
      ...fields,
      workspaceId: rule.workspaceId,
      uid: rule.uid,
      currency: (current.currency as string | undefined) || workspace.currency || 'USD',
      recurrenceOccurrenceKey: key,
      metadata: { recurringTemplateId: rule.id, generatedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    }).filter(([, v]) => v !== undefined));
    tx.set(estimateRef, estimate);
    customerName = estimate.customerName;
    tx.update(db.collection('recurring').doc(rule.id), {
      nextOccurrence, lastOccurrence: date, generatedCount: (Number(ruleSnap.data()?.generatedCount) || 0) + 1,
      lastErrorCode: FieldValue.delete(), lastErrorAt: FieldValue.delete(), updatedAt: new Date().toISOString(),
    });
  });
  await notify(db, {
    workspaceId: rule.workspaceId, workspace, kind: 'estimate.draft_ready',
    title: `Recurring estimate ${number} is ready`,
    message: `A draft for ${String(customerName || 'the customer')} dated ${date}. Check it and send it.`,
    eventKey: `estimate.draft_ready:${key}`, recordId: estimateRef.id,
  });
  return { estimateId: estimateRef.id };
}

async function generateEntry(db: Firestore, rule: RecurringTransaction, generated: Partial<Transaction>, nextOccurrence: string) {
  const date = String(generated.date);
  const key = `${rule.id}:${date}`;
  const workspace = (await db.collection('workspaces').doc(rule.workspaceId).get()).data() || {};
  const accounts = await db.collection('chartAccounts').where('workspaceId', '==', rule.workspaceId).get();
  const problem = invalidEntryReason(rule.template?.lines, new Set(accounts.docs.map(d => d.id)));
  if (problem) {
    await markProblem(db, rule.id, problem);
    throw new Error(problem);
  }
  try {
    assertPostingOpen(date, workspace, rule.uid);
  } catch {
    await markProblem(db, rule.id, `The period of ${date} is closed`);
    throw new Error(`The period of ${date} is closed`);
  }
  const txRef = db.collection('transactions').doc();
  await db.runTransaction(async (tx) => {
    const wsNow = (await tx.get(db.collection('workspaces').doc(rule.workspaceId))).data() || {};
    if (!isWorkspaceMemberData(wsNow, { uid: rule.uid }, rule.workspaceId) || !LEDGER_WRITER_ROLES.includes(roleInWorkspace(wsNow, rule.uid))) {
      throw new Error(`Schedule owner ${rule.uid} no longer holds writer permissions in workspace ${rule.workspaceId}`);
    }
    assertPostingOpen(date, wsNow, rule.uid);
    const ruleSnap = await tx.get(db.collection('recurring').doc(rule.id));
    const existing = await tx.get(db.collection('transactions').where('workspaceId', '==', rule.workspaceId).where('recurrenceOccurrenceKey', '==', key).limit(1));
    if (!ruleSnap.exists || !ruleSnap.data()?.isActive) throw new RecurringSkip(`Schedule ${rule.id} is paused`);
    if (!existing.empty) throw new RecurringSkip(`Occurrence ${key} already generated`);
    const entryToPost = {
      ...generated,
      id: txRef.id,
      workspaceId: rule.workspaceId,
      uid: rule.uid,
      currency: rule.template?.currency || wsNow.currency || 'USD',
      exchangeRate: rule.template?.exchangeRate ?? 1,
      lines: rule.template?.lines?.map(l => ({ ...l })),
      totalAmountCents: rule.template!.lines!.reduce((sum, l) => sum + Math.max(0, l.amountCents), 0),
      createdAt: new Date().toISOString(),
    } as Transaction;
    settleHomeCurrency(entryToPost);
    await ledgerWrite(tx, txRef, entryToPost as unknown as Record<string, unknown>);
    tx.update(db.collection('recurring').doc(rule.id), {
      nextOccurrence, lastOccurrence: date, generatedCount: (Number(ruleSnap.data()?.generatedCount) || 0) + 1,
      lastErrorCode: FieldValue.delete(), lastErrorAt: FieldValue.delete(), updatedAt: new Date().toISOString(),
    });
  });
  return { txId: txRef.id };
}

export async function processRecurring(db: Firestore, asOf?: string): Promise<ProcessRecurringResult> {
  const result: ProcessRecurringResult = { processedCount: 0, skippedCount: 0, failedCount: 0, totalDue: 0, details: [] };
  const snap = await db.collection('recurring').where('isActive', '==', true).get();
  const rules = new Map(snap.docs.map(d => [d.id, { ...d.data(), id: d.id } as RecurringTransaction]));
  const { generatedTransactions } = findDueRecurring([...rules.values()], asOf);
  result.totalDue = generatedTransactions.length;
  const failedRules = new Set<string>();

  for (const item of generatedTransactions) {
    const rule = rules.get(item.templateId);
    const operationId = `${item.templateId}:${item.transaction.date}`;
    if (!rule?.workspaceId || failedRules.has(item.templateId)) continue; // later occurrences wait for the first
    try {
      const out = isInvoiceSchedule(rule)
        ? await generateInvoice(db, rule, String(item.transaction.date), item.updatedNextOccurrence)
        : isBillSchedule(rule)
          ? await generateBill(db, rule, String(item.transaction.date), item.updatedNextOccurrence)
          : isEstimateSchedule(rule)
            ? await generateEstimate(db, rule, String(item.transaction.date), item.updatedNextOccurrence)
            : await generateEntry(db, rule, item.transaction, item.updatedNextOccurrence);
      result.processedCount++;
      result.details.push({ operationId, status: 'success', ...out });
    } catch (err) {
      if (err instanceof RecurringSkip) {
        result.skippedCount++;
        result.details.push({ operationId, status: 'skipped', error: err.message });
      } else {
        failedRules.add(item.templateId);
        result.failedCount++;
        const why = err instanceof Error ? err.message : String(err);
        result.details.push({ operationId, status: 'failed', error: why });
        logger.warn('recurring occurrence failed', { operationId, error: why });
        // S-12: the people who keep the books hear about it (once per occurrence), not only the job log
        const what = isInvoiceSchedule(rule) ? 'invoice' : isBillSchedule(rule) ? 'bill' : isEstimateSchedule(rule) ? 'estimate' : 'entry';
        await notify(db, {
          workspaceId: rule.workspaceId, kind: 'recurring.failed',
          title: `A recurring ${what} could not be created`,
          message: `${rule.description || `Recurring ${what}`} for ${item.transaction.date}: ${why}`,
          eventKey: `recurring.failed:${operationId}`, recordId: rule.id,
        });
      }
    }
  }
  return result;
}

export async function processAllRecurring(): Promise<ProcessRecurringResult> {
  return processRecurring(getDb());
}
