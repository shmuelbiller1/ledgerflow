/**
 * Needs attention (DA-02): one queue, the daily starting point. Each row says how many, why it is
 * there, who can resolve it, and opens the exact place. A row is there only while its cause is: it
 * is worked out each time from the books (bank lines, approvals, Data Health findings, the close),
 * so it can't be dismissed away and comes back if the cause does. Nothing here changes anything.
 */
import type { PinnedPage } from './pinnedPages';
import type { RecordRef } from './recordLinks';
import type { CheckFinding } from './dataChecks';
import { approvalStatus } from './invoiceApproval';
import { monthCloseState, type PeriodLockSettings } from './periodLock';
import { closeStepItems, type CloseStep } from './closeSteps';
import { STALE_DAYS } from './bankFeedStatus';
import { addDaysYMD } from './fiscalCalendar';

export interface AttentionRow {
  id: string;
  count: number;
  /** "3 bank lines to review" */
  text: string;
  why: string;
  /** who can resolve it */
  who: string;
  page: PinnedPage;
  /** when there is exactly one, the record itself (it opens instead of the screen) */
  record?: RecordRef;
}

const BOOKKEEPING = 'owners, accountants and bookkeepers';
const APPROVERS = 'owners and accountants';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function needsAttention(input: {
  today: string;
  workspace: (PeriodLockSettings & { invoiceApproval?: unknown; closeSteps?: CloseStep[]; fiscalYearStartMonth?: number; currency?: string }) | null | undefined;
  /** last month's sign-offs on Month-End Close, when read (for its own steps left, BD-10) */
  lastMonthSignOffs?: Record<string, unknown>;
  bankLines?: Array<{ id?: string; status?: string }>;
  invoices?: Array<Parameters<typeof approvalStatus>[0] & { id?: string; status?: string }>;
  findings?: CheckFinding[];
  /** the day of the month from which last month should be closed (default the 10th) */
  closeByDay?: number;
  /** questions about entries (BD-07) */
  questions?: Array<{ status?: string }>;
  /** pay runs (U-10) and purchase orders (K-23), for the ones waiting for approval */
  payRuns?: Array<{ status?: string }>;
  purchaseOrders?: Array<{ status?: string }>;
  /** bank connections (Plaid), for the ones whose login expired */
  banks?: Array<{ status?: string; institutionName?: string; lastSyncedAt?: string | null }>;
  /** BG-03: the open tasks given to the person looking */
  myTasks?: Array<{ status?: string; due?: string }>;
}): AttentionRow[] {
  const rows: AttentionRow[] = [];
  const add = (row: AttentionRow) => { if (row.count > 0) rows.push(row); };
  // the one record behind a row, when there is exactly one and it has an id
  const only = (type: RecordRef['type'], ids: Array<string | undefined>): Partial<AttentionRow> => (ids.length === 1 && ids[0] ? { record: { type, id: ids[0] } } : {});
  const onlyFinding = (list: CheckFinding[]): Partial<AttentionRow> => (list.length === 1 && list[0].record ? { record: list[0].record } : {});
  const findings = input.findings || [];
  const of = (checkId: string) => findings.filter(f => f.checkId === checkId);

  const pendingLines = (input.bankLines || []).filter(l => l.status === 'pending');
  const pending = pendingLines.length;
  add({ id: 'bank-lines', count: pending, text: plural(pending, 'bank line to review', 'bank lines to review'), why: 'They came from the bank and are not matched to an entry yet.', who: BOOKKEEPING, page: { tab: 'reconciliation' }, ...only('bankLine', pendingLines.map(l => l.id)) });

  const settings = input.workspace?.invoiceApproval;
  const expired = (input.banks || []).filter(b => b.status === 'login_required');
  add({ id: 'bank-login', count: expired.length, text: expired.length === 1 ? `${expired[0].institutionName || 'A bank'} needs you to log in again` : `${expired.length} bank connections need you to log in again`, why: 'The bank stopped sending lines until someone logs in to it again; nothing new arrives meanwhile.', who: BOOKKEEPING, page: { tab: 'banking' } });

  // Z-28: a connection whose last sync failed, or that has not synced for more than STALE_DAYS days
  const since = addDaysYMD(input.today, -STALE_DAYS);
  const behind = (input.banks || []).filter(b => b.status === 'error' || (b.status !== 'login_required' && b.lastSyncedAt && b.lastSyncedAt.slice(0, 10) < since));
  add({ id: 'bank-sync', count: behind.length, text: behind.length === 1 ? `${behind[0].institutionName || 'A bank'} is not syncing` : `${behind.length} bank connections are not syncing`, why: `Its last sync failed, or it has not synced for more than ${STALE_DAYS} days; its history on Banking says why.`, who: BOOKKEEPING, page: { tab: 'banking' } });

  const awaitingInvoices = (input.invoices || []).filter(inv => approvalStatus(inv, settings, input.workspace?.currency || 'USD') === 'awaiting');
  const awaiting = awaitingInvoices.length;
  add({ id: 'approvals', count: awaiting, text: plural(awaiting, 'invoice waiting for approval', 'invoices waiting for approval'), why: 'They are over the approval limit and can’t be sent until someone signs them off.', who: APPROVERS, page: { tab: 'sales' }, ...only('invoice', awaitingInvoices.map(i => i.id)) });

  const runs = (input.payRuns || []).filter(r => r.status === 'awaiting_approval').length;
  add({ id: 'pay-runs', count: runs, text: plural(runs, 'pay run waiting for approval', 'pay runs waiting for approval'), why: 'Nobody is paid and nothing is posted until an owner approves it or sends it back.', who: 'owners', page: { tab: 'payroll' } });

  const orders = (input.purchaseOrders || []).filter(o => o.status === 'pending_approval').length;
  add({ id: 'purchase-orders', count: orders, text: plural(orders, 'purchase order waiting for approval', 'purchase orders waiting for approval'), why: 'A bookkeeper asked to order; nothing is received or billed against it until it is approved or declined.', who: APPROVERS, page: { tab: 'purchase-orders' } });

  // serious findings other than the ones with a row of their own
  const own = new Set(['missing-label', 'duplicate-bill']);
  const seriousFindings = findings.filter(f => f.severity === 'high' && !own.has(f.checkId));
  const serious = seriousFindings.length;
  add({ ...onlyFinding(seriousFindings), id: 'serious', count: serious, text: plural(serious, 'serious problem in the books', 'serious problems in the books'), why: 'Data Health found something that makes a report wrong (an entry that doesn’t balance, an account that is missing…).', who: BOOKKEEPING, page: { tab: 'data-health' } });

  const labels = of('missing-label').length;
  add({ ...onlyFinding(of('missing-label')), id: 'missing-label', count: labels, text: plural(labels, 'entry missing a required label', 'entries missing a required label'), why: 'The workspace requires a label on these accounts, and these entries have none.', who: BOOKKEEPING, page: { tab: 'data-health' } });

  const duplicates = of('duplicate-bill').length;
  add({ ...onlyFinding(of('duplicate-bill')), id: 'duplicate-bill', count: duplicates, text: plural(duplicates, 'possible duplicate bill', 'possible duplicate bills'), why: 'The same bill number from the same vendor is entered more than once; paying both would pay twice.', who: BOOKKEEPING, page: { tab: 'data-health' } });

  const asked = (input.questions || []).filter(q => q.status === 'open').length;
  add({ id: 'questions', count: asked, text: plural(asked, 'question about an entry waiting for an answer', 'questions about entries waiting for an answer'), why: 'Someone asked what an entry was; it stays unclear in the books until it is answered.', who: 'the owner', page: { tab: 'client-queries' } });
  const mine = (input.myTasks || []).filter(t => t.status === 'open');
  const late = mine.filter(t => t.due && t.due < input.today).length;
  add({ id: 'tasks', count: mine.length, text: plural(mine.length, 'task for you', 'tasks for you'), why: late ? `${late} of them ${late === 1 ? 'is' : 'are'} past the date asked.` : 'A teammate asked you to do something; tick it done on Tasks.', who: 'you', page: { tab: 'tasks' } });
  const answered = (input.questions || []).filter(q => q.status === 'answered').length;
  add({ id: 'answers', count: answered, text: plural(answered, 'answer to read', 'answers to read'), why: 'The owner answered a question; read it, fix the entry if needed, and close the question.', who: BOOKKEEPING, page: { tab: 'client-queries' } });

  // last month should be closed from the workspace's reminder day (Settings → Alerts), else the 10th, on
  const [y, m, d] = input.today.split('-').map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  if (d >= (input.closeByDay || 10) && monthCloseState(lastMonth, input.workspace) === 'open') {
    const name = `${MONTHS[Number(lastMonth.slice(5)) - 1]} ${lastMonth.slice(0, 4)}`;
    const steps = closeStepItems(input.workspace?.closeSteps, lastMonth, input.workspace?.fiscalYearStartMonth);
    const left = input.lastMonthSignOffs ? steps.filter(s => !input.lastMonthSignOffs![s.id]).length : 0;
    add({ id: 'close', count: 1, text: `${name} is not closed${left ? `: ${plural(left, 'step of its own is', 'steps of its own are')} not signed off` : ''}`, why: 'Until it is closed, entries can still be dated in it and its reports can change.', who: APPROVERS, page: { tab: 'month-end-close' } });
  }
  return rows;
}
