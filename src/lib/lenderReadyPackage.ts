import type { Bill, ChartAccount, Invoice, ReconciliationSession, Transaction } from '../types';
import type { EvidenceFile, EvidencePeriod, EvidenceWorkspace } from './auditEvidencePack';
import {
  computeLedgerCloseAnchor,
  sha256Hex,
  verifyAuditHashChain,
  type HashChainableAuditEntry,
} from './auditHashChain';
import { csvMoney, toCsv } from './csvExport';
import { calculateAmountDue } from './documentMath';
import { isPostable, lineAmount } from './txFilters';
import { trimChar } from './textShape';
import { BRAND_NAME } from '../config/brand';

/**
 * Strategy 5 — One-Click Lender-Ready Underwriting & Diligence Package.
 *
 * Bundles the six schedules commercial lenders, SBA underwriters, and investors ask for:
 *  - 00-INTEGRITY-CERTIFICATE.txt (SHA-256 per-file manifest + Ledger Close Anchor + Audit Hash-Chain proof)
 *  - 01-trial-balance.csv
 *  - 02-income-statement.csv
 *  - 03-balance-sheet.csv
 *  - 04-ar-ap-aging.csv
 *  - 05-reconciliations-and-controls.csv
 *  - 06-audit-hash-chain.csv
 */

export interface LenderReadyPackageInput {
  workspace: EvidenceWorkspace;
  period: EvidencePeriod;
  generatedAt: string;
  accounts: readonly ChartAccount[];
  transactions: readonly Transaction[];
  invoices: readonly Invoice[];
  bills: readonly Bill[];
  reconciliations?: ReadonlyArray<ReconciliationSession | {
    accountId?: string;
    bankAccountId?: string;
    statementDate?: string;
    statementBalanceCents?: number;
    ledgerBalanceCents?: number;
    reconciledTransactions?: string[];
    reconciledTransactionIds?: string[];
    differenceCents?: number;
  }>;
  auditLogs: readonly HashChainableAuditEntry[];
}

export interface LenderPackageSummary {
  balancedTrialBalance: boolean;
  balancedBalanceSheet: boolean;
  totalDebitsCents: number;
  totalCreditsCents: number;
  revenueCents: number;
  expenseCents: number;
  netIncomeCents: number;
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityWithRetainedCents: number;
  openReceivablesCents: number;
  openPayablesCents: number;
  ledgerAnchorSha256: string;
  auditChainValid: boolean;
  auditChainHeadHash: string;
}

function csvFile(name: string, headers: readonly string[], rows: readonly string[][]): EvidenceFile {
  return {
    name,
    headers: [...headers],
    rows: rows.map(r => [...r]),
    text: toCsv([...headers], rows.map(r => [...r])),
  };
}

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

function agingBucket(daysPastDue: number): 'Current' | '1-30 Days' | '31-60 Days' | '61-90 Days' | '90+ Days' {
  if (daysPastDue <= 0) return 'Current';
  if (daysPastDue <= 30) return '1-30 Days';
  if (daysPastDue <= 60) return '31-60 Days';
  if (daysPastDue <= 90) return '61-90 Days';
  return '90+ Days';
}

export function buildLenderReadyPackage(
  input: LenderReadyPackageInput,
): { files: EvidenceFile[]; summary: LenderPackageSummary } {
  const currency = input.workspace.currency || 'USD';
  const accountById = new Map<string, ChartAccount>();
  for (const acc of input.accounts) {
    accountById.set(acc.id, acc);
  }

  // Cumulative balances up to period.to (for Trial Balance & Balance Sheet)
  // and period movement within [period.from, period.to] (for Income Statement)
  const cumulativeByAccount = new Map<string, { debits: number; credits: number; net: number }>();
  const periodByAccount = new Map<string, { debits: number; credits: number; net: number }>();
  const priorIncomeAndExpenseNetCents = { value: 0 };

  for (const tx of input.transactions) {
    if (!isPostable(tx)) continue;
    const txDay = String(tx.date || '').slice(0, 10);
    if (!txDay || txDay > input.period.to) continue;
    const inPeriod = txDay >= input.period.from && txDay <= input.period.to;

    for (const line of tx.lines || []) {
      const accId = String(line.accountId || 'unassigned');
      const amt = Math.trunc(lineAmount(line, tx));
      if (amt === 0) continue;

      const cum = cumulativeByAccount.get(accId) || { debits: 0, credits: 0, net: 0 };
      if (amt > 0) cum.debits += amt;
      else cum.credits += Math.abs(amt);
      cum.net += amt;
      cumulativeByAccount.set(accId, cum);

      const acc = accountById.get(accId);
      const accType = acc?.type || (amt > 0 ? 'expense' : 'revenue');
      const isPnl = accType === 'revenue' || accType === 'expense';

      if (inPeriod) {
        const per = periodByAccount.get(accId) || { debits: 0, credits: 0, net: 0 };
        if (amt > 0) per.debits += amt;
        else per.credits += Math.abs(amt);
        per.net += amt;
        periodByAccount.set(accId, per);
      } else if (isPnl) {
        // Prior-period P&L rolls into Retained Earnings on the Balance Sheet
        // Signed convention: debit > 0, credit < 0 => credit net (-amt) increases retained earnings
        priorIncomeAndExpenseNetCents.value += -amt;
      }
    }
  }

  // 01 — Trial Balance as of period.to
  const sortedAccountIds = [...cumulativeByAccount.keys()].sort((a, b) => {
    const accA = accountById.get(a);
    const accB = accountById.get(b);
    return String(accA?.code || a).localeCompare(String(accB?.code || b));
  });

  let totalDebitsCents = 0;
  let totalCreditsCents = 0;
  const tbRows: string[][] = [];

  for (const accId of sortedAccountIds) {
    const bal = cumulativeByAccount.get(accId)!;
    const acc = accountById.get(accId);
    totalDebitsCents += bal.debits;
    totalCreditsCents += bal.credits;
    tbRows.push([
      acc?.code || '',
      acc?.name || accId,
      acc?.type || 'unclassified',
      csvMoney(bal.debits),
      csvMoney(bal.credits),
      csvMoney(bal.net),
      currency,
    ]);
  }
  tbRows.push([
    '',
    'TOTAL TRIAL BALANCE',
    '',
    csvMoney(totalDebitsCents),
    csvMoney(totalCreditsCents),
    csvMoney(totalDebitsCents - totalCreditsCents),
    currency,
  ]);

  // 02 — Income Statement for [period.from, period.to]
  let revenueCents = 0;
  let expenseCents = 0;
  const isRows: string[][] = [];

  const periodAccountIds = [...periodByAccount.keys()].sort((a, b) => {
    const accA = accountById.get(a);
    const accB = accountById.get(b);
    return String(accA?.code || a).localeCompare(String(accB?.code || b));
  });

  for (const accId of periodAccountIds) {
    const acc = accountById.get(accId);
    const accType = acc?.type || 'expense';
    if (accType !== 'revenue' && accType !== 'expense') continue;
    const per = periodByAccount.get(accId)!;
    if (accType === 'revenue') {
      // Revenue is credit-normal (-net)
      const rev = -per.net;
      revenueCents += rev;
      isRows.push(['Revenue', acc?.code || '', acc?.name || accId, csvMoney(rev), currency]);
    } else {
      // Expense is debit-normal (+net)
      const exp = per.net;
      expenseCents += exp;
      isRows.push(['Expense', acc?.code || '', acc?.name || accId, csvMoney(exp), currency]);
    }
  }
  const netIncomeCents = revenueCents - expenseCents;
  isRows.push(['Summary', '', 'Total Revenue', csvMoney(revenueCents), currency]);
  isRows.push(['Summary', '', 'Total Expenses', csvMoney(expenseCents), currency]);
  isRows.push(['Summary', '', 'Net Income', csvMoney(netIncomeCents), currency]);

  // 03 — Balance Sheet as of period.to
  let totalAssetsCents = 0;
  let totalLiabilitiesCents = 0;
  let statedEquityCents = 0;
  const bsRows: string[][] = [];

  for (const accId of sortedAccountIds) {
    const acc = accountById.get(accId);
    const accType = acc?.type;
    if (accType === 'revenue' || accType === 'expense') continue;
    const bal = cumulativeByAccount.get(accId)!;
    if (accType === 'liability') {
      const liab = -bal.net;
      totalLiabilitiesCents += liab;
      bsRows.push(['Liability', acc?.code || '', acc?.name || accId, csvMoney(liab), currency]);
    } else if (accType === 'equity') {
      const eq = -bal.net;
      statedEquityCents += eq;
      bsRows.push(['Equity', acc?.code || '', acc?.name || accId, csvMoney(eq), currency]);
    } else {
      // Asset (or unclassified balance-sheet account): debit-normal (+net)
      totalAssetsCents += bal.net;
      bsRows.push(['Asset', acc?.code || '', acc?.name || accId, csvMoney(bal.net), currency]);
    }
  }

  const retainedEarningsTotalCents = priorIncomeAndExpenseNetCents.value + netIncomeCents;
  if (retainedEarningsTotalCents !== 0 || bsRows.length > 0) {
    bsRows.push(['Equity', 'RE-CURR', 'Retained Earnings & Current Period Net Income', csvMoney(retainedEarningsTotalCents), currency]);
  }
  const totalEquityWithRetainedCents = statedEquityCents + retainedEarningsTotalCents;
  const bsDifferenceCents = totalAssetsCents - (totalLiabilitiesCents + totalEquityWithRetainedCents);
  bsRows.push(['Summary', '', 'Total Assets', csvMoney(totalAssetsCents), currency]);
  bsRows.push(['Summary', '', 'Total Liabilities', csvMoney(totalLiabilitiesCents), currency]);
  bsRows.push(['Summary', '', 'Total Equity (incl. Retained Earnings)', csvMoney(totalEquityWithRetainedCents), currency]);
  bsRows.push(['Summary', '', 'Balance Check (Assets - Liabilities - Equity)', csvMoney(bsDifferenceCents), currency]);

  // 04 — AR & AP Aging as of period.to
  const agingRows: string[][] = [];
  let openReceivablesCents = 0;
  let openPayablesCents = 0;

  for (const inv of input.invoices) {
    if (inv.status === 'draft' || inv.status === 'void' || inv.status === 'paid') continue;
    const invDate = String(inv.date || '').slice(0, 10);
    if (invDate && invDate > input.period.to) continue;
    const dueCents = calculateAmountDue(inv);
    if (dueCents <= 0) continue;
    openReceivablesCents += dueCents;
    const dueDay = String(inv.dueDate || inv.date || input.period.to).slice(0, 10);
    const pastDue = dayDiff(dueDay, input.period.to);
    agingRows.push([
      'Accounts Receivable',
      inv.number || inv.id,
      inv.customerName || inv.customerId || '',
      invDate,
      dueDay,
      String(Math.max(0, pastDue)),
      agingBucket(pastDue),
      csvMoney(dueCents),
      inv.currency || currency,
    ]);
  }

  for (const bill of input.bills) {
    if (bill.status === 'draft' || bill.status === 'void' || bill.status === 'paid') continue;
    const billDate = String(bill.date || '').slice(0, 10);
    if (billDate && billDate > input.period.to) continue;
    const dueCents = calculateAmountDue(bill);
    if (dueCents <= 0) continue;
    openPayablesCents += dueCents;
    const dueDay = String(bill.dueDate || bill.date || input.period.to).slice(0, 10);
    const pastDue = dayDiff(dueDay, input.period.to);
    agingRows.push([
      'Accounts Payable',
      bill.number || bill.id,
      bill.vendorName || bill.vendorId || '',
      billDate,
      dueDay,
      String(Math.max(0, pastDue)),
      agingBucket(pastDue),
      csvMoney(dueCents),
      bill.currency || currency,
    ]);
  }

  // 05 — Bank Reconciliations & Internal Controls
  const controlRows: string[][] = [
    ['Control', 'Hard Period Lock Date', input.workspace.lockDate || 'None', 'Entries on or before this date cannot be altered without lock override'],
    ['Control', 'Soft Period Lock Date', input.workspace.softLockDate || 'None', 'Bookkeepers cannot post on or before this date'],
    ['Control', 'Two-Person Approval Rule', input.workspace.twoPersonRule ? 'Enabled' : 'Disabled', 'Prevents self-approval of documents'],
    ['Control', 'Pay Run Approval', input.workspace.payrollApproval ? 'Enabled' : 'Disabled', 'Requires owner/accountant approval on payroll'],
  ];
  for (const rec of input.reconciliations || []) {
    const r = rec as {
      accountId?: string;
      bankAccountId?: string;
      statementDate?: string;
      statementBalanceCents?: number;
      ledgerBalanceCents?: number;
      reconciledTransactions?: string[];
      reconciledTransactionIds?: string[];
      differenceCents?: number;
    };
    const accId = r.bankAccountId || r.accountId || '';
    const acc = accountById.get(accId);
    const clearedIds = r.reconciledTransactions || r.reconciledTransactionIds || [];
    const stmtBal = Math.trunc(r.statementBalanceCents || 0);
    const diff = r.differenceCents !== undefined
      ? Math.trunc(r.differenceCents)
      : stmtBal - Math.trunc(r.ledgerBalanceCents ?? stmtBal);
    controlRows.push([
      'Bank Reconciliation',
      acc?.name || accId,
      String(r.statementDate || '').slice(0, 10),
      `Statement balance ${csvMoney(stmtBal)} ${currency} · ${clearedIds.length} cleared · diff ${csvMoney(diff)}`,
    ]);
  }

  // 06 — Cryptographic Audit Hash Chain
  const chainVerification = verifyAuditHashChain(input.auditLogs);
  const ledgerAnchor = computeLedgerCloseAnchor(input.transactions, input.period.to);

  const sortedAudit = [...input.auditLogs].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const chainRows = sortedAudit.map(entry => [
    entry.seq !== undefined ? String(entry.seq) : '',
    typeof entry.timestamp === 'string' ? entry.timestamp : '',
    String(entry.uid || ''),
    String(entry.action || ''),
    String(entry.entityType || ''),
    String(entry.entityId || ''),
    String(entry.prevHash || ''),
    String(entry.entryHash || ''),
  ]);

  const scheduleFiles: EvidenceFile[] = [
    csvFile('01-trial-balance.csv', ['Code', 'Account', 'Type', 'Debits', 'Credits', 'Net', 'Currency'], tbRows),
    csvFile('02-income-statement.csv', ['Section', 'Code', 'Account', 'Amount', 'Currency'], isRows),
    csvFile('03-balance-sheet.csv', ['Section', 'Code', 'Account', 'Amount', 'Currency'], bsRows),
    csvFile('04-ar-ap-aging.csv', ['Ledger', 'Document', 'Counterparty', 'Date', 'Due Date', 'Days Past Due', 'Bucket', 'Open Balance', 'Currency'], agingRows),
    csvFile('05-reconciliations-and-controls.csv', ['Category', 'Subject', 'Date or Status', 'Detail'], controlRows),
    csvFile('06-audit-hash-chain.csv', ['Seq', 'Timestamp', 'Actor', 'Action', 'Entity Type', 'Entity Id', 'Prev Hash', 'Entry Hash'], chainRows),
  ];

  const manifestLines = scheduleFiles.map(f => `  ${sha256Hex(f.text)}  ${f.name}`);
  const certificateText = [
    `LENDER-READY FINANCIAL & INTEGRITY PACKAGE — ${input.workspace.name || input.workspace.id}`,
    '================================================================================',
    `Workspace:           ${input.workspace.name || '(unnamed)'} (${input.workspace.id})`,
    `Reporting Period:    ${input.period.from} to ${input.period.to}`,
    `Reporting Currency:  ${currency}`,
    `Generated At:        ${input.generatedAt}`,
    `Prepared By System:  ${BRAND_NAME} Double-Entry Ledger Engine`,
    '',
    'CRYPTOGRAPHIC INTEGRITY ANCHORS (FIPS 180-4 SHA-256)',
    `  Ledger Close Anchor (as of ${input.period.to}): ${ledgerAnchor.sha256}`,
    `  Posted Entries Anchored:                       ${ledgerAnchor.postedEntryCount}`,
    `  Trial Balance Equality:                        ${totalDebitsCents === totalCreditsCents ? 'VERIFIED (Debits == Credits)' : 'OUT OF BALANCE'}`,
    `  Balance Sheet Equality:                        ${bsDifferenceCents === 0 ? 'VERIFIED (Assets == Liabilities + Equity)' : 'OUT OF BALANCE'}`,
    `  Audit Trail Hash-Chain Status:                 ${chainVerification.valid ? 'VERIFIED INTACT' : `BROKEN (${chainVerification.reason})`}`,
    `  Audit Trail Head Hash:                         ${chainVerification.headHash}`,
    `  Chained Audit Entries Verified:                ${chainVerification.chainedCount} (legacy pre-chain: ${chainVerification.legacyUnchainedCount})`,
    '',
    'KEY FINANCIAL FIGURES',
    `  Period Revenue:                                ${csvMoney(revenueCents)} ${currency}`,
    `  Period Operating Expenses:                     ${csvMoney(expenseCents)} ${currency}`,
    `  Period Net Income:                             ${csvMoney(netIncomeCents)} ${currency}`,
    `  Ending Total Assets:                           ${csvMoney(totalAssetsCents)} ${currency}`,
    `  Ending Total Liabilities:                      ${csvMoney(totalLiabilitiesCents)} ${currency}`,
    `  Ending Total Equity (incl. Retained):          ${csvMoney(totalEquityWithRetainedCents)} ${currency}`,
    `  Open Accounts Receivable:                      ${csvMoney(openReceivablesCents)} ${currency}`,
    `  Open Accounts Payable:                         ${csvMoney(openPayablesCents)} ${currency}`,
    '',
    'SCHEDULE SHA-256 CHECKSUM MANIFEST (verify with `shasum -a 256 -c`)',
    ...manifestLines,
    '',
  ].join('\n');

  const certFile: EvidenceFile = {
    name: '00-INTEGRITY-CERTIFICATE.txt',
    headers: [],
    rows: [],
    text: certificateText,
  };

  return {
    files: [certFile, ...scheduleFiles],
    summary: {
      balancedTrialBalance: totalDebitsCents === totalCreditsCents,
      balancedBalanceSheet: bsDifferenceCents === 0,
      totalDebitsCents,
      totalCreditsCents,
      revenueCents,
      expenseCents,
      netIncomeCents,
      totalAssetsCents,
      totalLiabilitiesCents,
      totalEquityWithRetainedCents,
      openReceivablesCents,
      openPayablesCents,
      ledgerAnchorSha256: ledgerAnchor.sha256,
      auditChainValid: chainVerification.valid,
      auditChainHeadHash: chainVerification.headHash,
    },
  };
}

export function lenderPackageFileName(workspace: Pick<EvidenceWorkspace, 'name' | 'id'>, period: EvidencePeriod): string {
  const clean = (value: string | undefined) => trimChar((value || '')
    .normalize('NFKD').replace(/[^\p{L}\p{N}_-]+/gu, '-'), '-').slice(0, 60);
  const base = clean(workspace.name) || clean(workspace.id) || 'workspace';
  return `${base}-lender-ready-package-${period.from}-to-${period.to}.zip`;
}
