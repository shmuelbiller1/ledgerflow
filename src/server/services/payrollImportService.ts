import crypto from 'crypto';
import { validateWorkspaceAccounts, type DocumentReference, type Firestore, type Transaction } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { lockMessage, postingLock, type PeriodLockSettings } from '../../lib/periodLock';
import { isCashAccount } from '../../lib/txFilters';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import {
  PAYROLL_ACCOUNT_ROLES, PAYROLL_COLUMN_SETS, payrollEntries, readPayrollCsv,
  type PayrollAccounts, type PayrollLabelChoice, type PayrollPayDate, type PayrollProvider, type PayrollTotals,
} from '../../lib/payrollProviderImport';
import type { ChartAccount } from '../../types';

/**
 * PAY-1: posts a payroll provider's CSV (src/lib/payrollProviderImport.ts) as one balanced entry per pay date, in one
 * database transaction: every pay date's period must be open, every account must be this workspace's and of the
 * right kind, and each label value must be one of the workspace's. The server reads the file itself; the browser's
 * preview is never trusted for the figures.
 *
 * The same file is refused twice: each pay date's entry id comes from the provider, the pay date and its totals, so a
 * second import of the same figures finds the entry already there and nothing is posted. A file is corrected with
 * Reverse & Correct on its entry (POST /transactions/:id/reverse): once an entry is reversed (or void), the same
 * figures can be imported again, and a corrected file (other totals) has another id anyway.
 */
export class PayrollImportError extends Error {
  constructor(readonly status: number, message: string, readonly details: string[] = [], readonly code = 'PAYROLL_FILE_INVALID') {
    super(message);
    this.name = 'PayrollImportError';
  }
}

export interface PayrollImportInput {
  workspaceId: string;
  uid: string;
  provider: PayrollProvider;
  csv: string;
  fileName?: string;
  accounts: PayrollAccounts;
  /** split the expense lines by this label (a dimension id), matching the file's department/location column */
  labelDimensionId?: string;
}

export interface PayrollImportResult {
  currency: string;
  entries: Array<{ transactionId: string; payDate: string; totals: PayrollTotals }>;
}

/** The import key of one pay date in one workspace: the workspace, the provider, the date and every total. */
export function payrollImportKey(workspaceId: string, provider: PayrollProvider, payDate: PayrollPayDate): string {
  const t = payDate.totals;
  const basis = [workspaceId, provider, payDate.payDate, t.people, t.grossCents, t.employeeTaxCents, t.deductionCents, t.employerTaxCents, t.employerBenefitCents, t.netCents].join('|');
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

const EXPENSE_TYPES = new Set(['expense', 'cost_of_goods']);

function checkAccountKinds(accounts: PayrollAccounts, byId: Map<string, { id: string; name: string; type: string; category?: string }>) {
  const problems: string[] = [];
  for (const r of PAYROLL_ACCOUNT_ROLES) {
    const id = accounts[r.role];
    if (!id) continue;
    const account = byId.get(id);
    if (!account) { problems.push(`"${r.label}": that account is not in this workspace.`); continue; }
    const type = String(account.type || '').toLowerCase();
    if (r.side === 'expense' && !EXPENSE_TYPES.has(type)) problems.push(`"${r.label}" must be an expense account; ${account.name} is not.`);
    if (r.role === 'clearing') {
      if (isCashAccount(account as ChartAccount) || !['liability', 'asset'].includes(type)) problems.push(`"${r.label}" must be a clearing account (a liability or asset that is not a bank account); ${account.name} is not.`);
    } else if (r.side === 'liability' && type !== 'liability') problems.push(`"${r.label}" must be a liability account; ${account.name} is not.`);
  }
  return problems;
}

export async function preparePayrollImport(db: Firestore, input: PayrollImportInput) {
  if (!PAYROLL_COLUMN_SETS[input.provider]) throw new PayrollImportError(400, 'Choose the payroll provider');
  const read = readPayrollCsv(input.csv, input.provider);
  if (read.problems.length) throw new PayrollImportError(400, 'The file cannot be imported', read.problems);

  let labels: PayrollLabelChoice | undefined;
  if (input.labelDimensionId) {
    const nodes = (await db.collection('dimensionNodes').where('workspaceId', '==', input.workspaceId).get()).docs
      .map(d => d.data() as { id?: string; dimensionId?: string; description?: string; aliases?: string[]; status?: string })
      .filter(n => n.dimensionId === input.labelDimensionId && n.id)
      .map(n => ({ id: String(n.id), description: n.description, aliases: n.aliases, status: n.status }));
    if (!nodes.length) throw new PayrollImportError(400, `This workspace has no ${input.labelDimensionId} labels to split the costs by`);
    labels = { dimensionId: input.labelDimensionId, nodes };
  }
  const built = payrollEntries(read.rows, input.accounts, labels);
  if (built.problems.length) throw new PayrollImportError(400, 'The file cannot be imported', built.problems);

  const ids = Object.values(input.accounts).filter((id): id is string => Boolean(id));
  let byId: Map<string, { id: string; name: string; type: string; category?: string }>;
  try {
    byId = await validateWorkspaceAccounts(db, input.workspaceId, ids);
  } catch {
    throw new PayrollImportError(400, 'Choose accounts from this workspace');
  }
  const kinds = checkAccountKinds(input.accounts, byId);
  if (kinds.length) throw new PayrollImportError(400, 'Choose accounts of the right kind', kinds);

  return { payDates: built.payDates, byId, labels };
}

export type PreparedPayrollImport = Awaited<ReturnType<typeof preparePayrollImport>>;

/**
 * Validate the same journals for a read-only preview and for posting. On commit, the period and
 * duplicate checks see the runner's transaction snapshot, including any concurrent role change
 * the runner has already checked. No writes occur until every journal has passed.
 */
export async function preparePayrollJournals(
  db: Firestore, input: PayrollImportInput, plan: PreparedPayrollImport,
  workspace: PeriodLockSettings & { currency?: unknown }, t?: Transaction,
) {
  const { payDates, byId, labels } = plan;
  const set = PAYROLL_COLUMN_SETS[input.provider];
  const currency = String(workspace.currency || 'USD');
  // every pay date's period open, every pay date new, before anything is written
  const planned: Array<{ payDate: PayrollPayDate; key: string; ref: DocumentReference }> = [];
  for (const payDate of payDates) {
    const lock = postingLock(payDate.payDate, workspace, input.uid);
    if (lock) throw new PayrollImportError(409, `${lockMessage(payDate.payDate, lock)} Nothing from this file was posted.`, [], 'PERIOD_LOCKED');
    const key = payrollImportKey(input.workspaceId, input.provider, payDate);
    let ref = db.collection('transactions').doc(`payroll-import-${key}`);
    for (let n = 2; ; n++) {
      const earlier = await (t ? t.get(ref) : ref.get());
      if (!earlier.exists) break;
      const e = earlier.data() || {};
      if (e.workspaceId !== input.workspaceId) throw new PayrollImportError(409, 'The payroll could not be imported; nothing was posted', [], 'CONFLICT');
      const undone = Boolean(e.reversalEventId) || e.status === 'void';
      if (!undone) throw new PayrollImportError(409, `The payroll of ${payDate.payDate} from this file (${formatCurrency(payDate.totals.grossCents, currency)} gross, ${payDate.totals.people} ${payDate.totals.people === 1 ? 'person' : 'people'}) is already in the books. Nothing from this file was posted. To correct it, reverse that entry first.`, [], 'CONFLICT');
      ref = db.collection('transactions').doc(`payroll-import-${key}-${n}`);
    }
    planned.push({ payDate, key, ref });
  }

  // every entry prepared (the validator reads) before anything is written
  const prepared = [];
  for (const { payDate, key, ref } of planned) {
    const lines = payDate.lines.map((l, i) => ({
      id: `line-${i + 1}`, accountId: l.accountId, accountName: byId.get(l.accountId)?.name || '', amountCents: l.amountCents, description: l.description,
      ...(l.label && labels ? { dimensions: { [labels.dimensionId]: l.label } } : {}),
    }));
    const tx = await TransactionValidator.validateAndPrepare({
      id: ref.id,
      workspaceId: input.workspaceId,
      uid: input.uid,
      date: payDate.payDate,
      description: `Payroll ${payDate.payDate} (${set.name})`,
      totalAmountCents: lines.filter(l => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0),
      currency,
      type: 'journal',
      status: 'approved',
      createdAt: new Date().toISOString(),
      metadata: {
        type: 'payroll-import', provider: input.provider, payDate: payDate.payDate, payrollImportKey: key, fileName: input.fileName || '',
        people: payDate.totals.people, grossCents: payDate.totals.grossCents, netCents: payDate.totals.netCents, costCents: payDate.totals.costCents,
        ...(labels ? { labelDimensionId: labels.dimensionId } : {}),
      },
      lines,
    }, { db, workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
    prepared.push({ payDate, ref, tx });
  }
  return { currency, journals: prepared };
}
