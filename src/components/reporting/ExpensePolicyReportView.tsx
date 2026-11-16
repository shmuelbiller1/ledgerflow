import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { claimOf } from '../../lib/expenseClaims';
import { checkExpenseClaim, parseExpensePolicy, EXPENSE_POLICY_METADATA_KEY, type ExpenseBreach, type ExpenseNotice } from '../../lib/expensePolicy';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Bill } from '../../types';
import { RowTable } from '../ui/RowTable';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const CSV_HEADERS = ['Claim date', 'Person', 'State', 'Account', 'Line', 'Amount', 'Finding', 'Rule', 'What it asks'];

/** The lines of a claim: the bill's own splits (every claim line is one split). */
const claimLines = (bill: Bill) => (bill.splits || []).map(split => ({ description: split.description || '', accountId: split.accountId, amountCents: split.amountCents }));

/**
 * A-74: expense policy checks. Every expense claim in the period is checked against the workspace's
 * own policy (a maximum per category, and from what amount a receipt is needed) before anyone
 * approves it. Read-only: it never changes a claim and never posts.
 *
 * The receipt count is not read on this screen (the file list is loaded by the record that holds it),
 * so a line that needs a receipt is reported as "not checked here" rather than as a missing receipt.
 * A claim whose receipts were counted by the approving screen shows the real answer there.
 */
export default function ExpensePolicyReportView({ endDate = '' }: { endDate?: string }) {
  const bills = useLedgerStore(state => state.bills);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const { loading } = useLedgerCollections('bills');
  const [chosenFrom, setChosenFrom] = useState<string | null>(null);

  const to = endDate || getLocalDateISO();
  const valid = validCustomReportPeriod({ startDate: to, endDate: to });
  const from = chosenFrom && validCustomReportPeriod({ startDate: chosenFrom, endDate: chosenFrom }) ? chosenFrom : `${to.slice(0, 4)}-01-01`;
  const currency = workspace?.currency || 'USD';

  const { policy, dropped } = useMemo(() => parseExpensePolicy({ [EXPENSE_POLICY_METADATA_KEY]: workspace?.expensePolicy }), [workspace?.expensePolicy]);
  const scoped = useMemo(() => bills.filter(bill => (!workspaceId || bill.workspaceId === workspaceId) && claimOf(bill as never) && (!valid || (bill.date || '') >= from && (bill.date || '') <= to)), [bills, workspaceId, from, to, valid]);

  interface PolicyRow {
    bill: Bill;
    claim: ReturnType<typeof claimOf>;
    /** the claim line the finding is about, 1-based; 0 when the whole claim is the subject */
    line: number;
    account: string;
    amountCents: number;
    finding: 'Within policy' | 'Over the maximum' | 'Receipt missing' | 'Receipt not checked here';
    rule: string;
    ask: string;
  }
  const rows = useMemo<PolicyRow[]>(() => scoped.flatMap((bill): PolicyRow[] => {
    const claim = claimOf(bill as never);
    const lines = claimLines(bill).map(line => ({ line }));
    const check = checkExpenseClaim(policy, { date: bill.date || to, lines });
    const findings: Array<ExpenseBreach | ExpenseNotice> = [...check.breaches, ...check.notices];
    if (!findings.length) return [{ bill, claim, line: 0, account: '', amountCents: bill.amountCents || 0, finding: 'Within policy' as const, rule: '', ask: '' }];
    return findings.map(finding => {
      const line = claimLines(bill)[finding.line - 1];
      const findingLabel: PolicyRow['finding'] = finding.kind === 'over-max' ? 'Over the maximum'
        : finding.kind === 'receipt-missing' ? 'Receipt missing' : 'Receipt not checked here';
      return {
        bill, claim, line: finding.line, account: line?.accountId || '',
        amountCents: 'amountCents' in finding ? finding.amountCents : line?.amountCents || 0,
        finding: findingLabel,
        rule: finding.ruleId, ask: finding.message,
      };
    });
  }), [scoped, policy, to]);

  const partial = truncated.bills || failed.bills;
  const money = (cents: number) => formatCurrency(cents, currency);

  return <section aria-label="Expense policy check" className="p-4 space-y-4 min-w-0">
    <h2>Expense policy check</h2>
    <p className="text-sm text-[var(--muted)]">Read-only. Each expense claim dated in the period is checked against the workspace's own policy, kept on the workspace as <code>{EXPENSE_POLICY_METADATA_KEY}</code>: a maximum per line, and from what amount a receipt is needed. A maximum is inclusive: a line at the limit is within policy. Nothing here changes a claim, approves it or posts it.</p>
    <p className="text-sm text-[var(--muted)]">The receipt count is not read on this screen, so a line that needs a receipt is listed as “receipt not checked here”, never as a missing receipt. Amounts are the claim's own stored lines in the workspace currency; a claim in another currency keeps its own currency and is not converted.</p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">From
        <input aria-label="Policy check from date" type="date" className={field} value={from} onChange={event => setChosenFrom(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">To
        <input aria-label="Policy check to date" type="date" className={field} value={to} readOnly />
      </label>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={!rows.length} onClick={() => downloadCsv(
        `expense-policy-${from}-${to}.csv`, CSV_HEADERS,
        rows.map(row => [row.bill.date || '', row.claim?.submittedByName || row.bill.vendorName || '', row.claim?.state || '', row.account, row.bill.number || row.bill.id, (row.amountCents / 100).toFixed(2), row.finding, row.rule, row.ask]),
      )}>Export CSV</button>
    </div>

    {loading && <p role="status">Loading claims…</p>}
    {!valid && <p role="alert">Choose a valid end date on the report.</p>}
    {partial && <p role="alert">Loaded claim history is incomplete or failed to load. Claims that are not loaded are not shown and are not treated as within policy.</p>}
    {dropped > 0 && <p role="alert">{dropped} stored policy row(s) could not be read and were ignored; fix them on the workspace record ({EXPENSE_POLICY_METADATA_KEY}).</p>}
    {!policy.rows.length && <p role="note">This workspace has no expense policy rows yet, so every claim is within policy by default. Add rows to <code>{EXPENSE_POLICY_METADATA_KEY}</code> (id, accountId or category, maxAmountCents and/or receiptFromCents, validFrom) to check claims.</p>}

    {rows.length > 0 && <ReportTableScroll>    <RowTable
      rowClassName="border-t border-[var(--line)] align-top"
      caption={(<>Expense claims from {from} to {to} checked against the policy in force on each claim's date</>)}
      rows={rows}
      rowKey={row => `${row.bill.id}-${row.line}-${row.finding}-${row.rule}`}
      tableClassName="w-full text-sm"
      columns={[
        { header: "Claim", cell: (row) => (<><bdi>{row.bill.date} · {row.bill.number || row.bill.id}</bdi><div className="text-xs text-[var(--muted)]"><bdi>{row.claim?.submittedByName || row.bill.vendorName}</bdi></div></>) },
        { header: "State", cell: (row) => row.claim?.state || '' },
        { header: "Account", cell: (row) => <code>{row.account || '—'}</code> },
        { header: "Amount", align: 'right', className: "tabular-nums", cell: (row) => money(row.amountCents) },
        { header: "Finding", cell: (row) => row.finding },
        { header: "What the policy asks", cell: (row) => row.ask || (policy.rows.length ? 'The policy rows in force match nothing on this claim' : '') },
      ]}
    /></ReportTableScroll>}

    {!loading && rows.length === 0 && <p>No expense claim in this period. Claims are bills whose record carries an expense-claim state; a bill that is not a claim is not checked here.</p>}
  </section>;
}
