import { useRef, useState } from 'react';
import { getIdToken } from '../../../firebase';
import { formatCurrency } from '../../../lib/utils';
import { compareTrialBalances, parseQuickBooksTrialBalance } from '../../../lib/migrationTrialBalanceProof';
import type { SourceTrialBalance, ServerTrialBalanceSnapshot } from '../../../lib/migrationTrialBalanceProof';

import { BRAND_NAME } from '../../../config/brand';
type Proof = ReturnType<typeof compareTrialBalances>;

export function MigrationTrialBalanceProof({ workspaceId }: { workspaceId: string }) {
  const [date, setDate] = useState('');
  const [source, setSource] = useState<SourceTrialBalance | null>(null);
  const [sourceFile, setSourceFile] = useState('');
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Each changed file/date or new comparison invalidates every prior async result.
  // The parent keys this component by workspaceId so switching books also unmounts it.
  const requestSeq = useRef(0);
  const readSource = async (file?: File) => {
    const seq = ++requestSeq.current;
    setSource(null);
    setProof(null);
    setError('');
    setSourceFile('');
    setBusy(false);
    if (!file) return;
    try {
      const data = parseQuickBooksTrialBalance(await file.text());
      if (seq !== requestSeq.current) return;
      setSource(data);
      setSourceFile(file.name);
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setError(cause instanceof Error ? cause.message : 'Cannot read the source trial balance.');
    }
  };
  const changeDate = (next: string) => {
    ++requestSeq.current;
    setDate(next);
    setProof(null);
    setError('');
    setBusy(false);
  };
  const compare = async () => {
    if (!source || !workspaceId || !date) return;
    const seq = ++requestSeq.current;
    setBusy(true);
    setProof(null);
    setError('');
    try {
      const token = await getIdToken();
      if (seq !== requestSeq.current) return;
      if (!token) throw new Error('Sign in again before reading the server trial balance.');
      const query = new URLSearchParams({ workspaceId, asOfDate: date });
      const response = await fetch(`/api/v1/reports/trial-balance?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (seq !== requestSeq.current) return;
      if (!response.ok) throw new Error(`The server trial balance could not be read (HTTP ${response.status}).`);
      const data = await response.json() as ServerTrialBalanceSnapshot;
      if (seq !== requestSeq.current) return;
      setProof(compareTrialBalances(source, data));
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setError(cause instanceof Error ? cause.message : 'Comparison failed.');
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  };
  const amount = (cents: number) => formatCurrency(cents);
  return (
    <section className="ledger-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4" aria-labelledby="migration-proof-title">
      <div>
        <h2 id="migration-proof-title" className="text-lg font-bold text-[var(--text)]">QuickBooks migration balance review</h2>
        <p className="text-sm text-[var(--muted)]">Upload a QuickBooks Trial Balance CSV with Account, Debit and Credit columns. Compare it with the saved {BRAND_NAME} trial balance on the same date. This does not import or post anything.</p>
      </div>
      <p className="text-xs text-[var(--muted)]">Use the same company, currency, accounting basis and cutoff date in both systems. Account names must be unique and match exactly after whitespace/case normalization. Renamed accounts require manual review. Importing contact/account lists does not migrate opening balances.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-[var(--text)]">QuickBooks Trial Balance CSV
          <input type="file" accept=".csv,text/csv" className="mt-1 block w-full text-sm" onChange={e => { void readSource(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <label className="text-sm font-medium text-[var(--text)]">Both books as of
          <input type="date" value={date} onChange={e => changeDate(e.target.value)} className="mt-1 block w-full min-h-11 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2 text-[var(--text)]" />
        </label>
      </div>
      {source && <p className="text-xs text-[var(--muted)]">{sourceFile}: {source.accounts.length} accounts; source debits {amount(source.totalDebitCents)}, credits {amount(source.totalCreditCents)}.</p>}
      <button type="button" disabled={!source || !date || busy || !workspaceId} onClick={() => { void compare(); }} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-semibold text-[var(--text)] disabled:opacity-50">
        {busy ? 'Reading server figures…' : 'Compare saved trial balances'}
      </button>
      {error && <p role="alert" className="text-sm text-[var(--neg)]">Comparison unavailable: {error}</p>}
      {proof && (
        <div className="space-y-3" aria-live="polite">
          <p role="status" className="font-semibold text-sm text-[var(--text)]">
            {proof.accountsMatch ? 'Trial balance figures match by account for this comparison.' : 'Trial balance differences require review.'}
          </p>
          <div className="overflow-x-auto"><table className="w-full text-sm tabular-nums">
            <caption className="sr-only">QuickBooks versus {BRAND_NAME} trial balance in cents</caption>
            <thead><tr><th scope="col" className="text-left py-2">Measure</th><th scope="col" className="text-right py-2">QuickBooks</th><th scope="col" className="text-right py-2">{BRAND_NAME}</th><th scope="col" className="text-right py-2">Difference</th></tr></thead>
            <tbody>
              <tr className="border-t border-[var(--line)]"><th scope="row" className="text-left py-2">Debits</th><td className="text-right">{amount(proof.sourceDebitCents)}</td><td className="text-right">{amount(proof.ledgerDebitCents)}</td><td className="text-right">{amount(proof.debitDifferenceCents)}</td></tr>
              <tr className="border-t border-[var(--line)]"><th scope="row" className="text-left py-2">Credits</th><td className="text-right">{amount(proof.sourceCreditCents)}</td><td className="text-right">{amount(proof.ledgerCreditCents)}</td><td className="text-right">{amount(proof.creditDifferenceCents)}</td></tr>
            </tbody>
          </table></div>
          {proof.differences.length > 0 && <div className="max-h-60 overflow-auto"><table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Accounts with discrepancies</caption>
            <thead><tr><th scope="col" className="text-left">Account</th><th scope="col" className="text-left">Reason</th><th scope="col" className="text-right">Difference</th></tr></thead>
            <tbody>{proof.differences.map(row => <tr key={row.accountId} className="border-t border-[var(--line)]"><td className="py-2">{row.account}</td><td>{row.problem.replaceAll('-', ' ')}</td><td className="text-right">{amount(row.differenceCents)}</td></tr>)}</tbody>
          </table></div>}
          <p className="text-xs font-semibold text-[var(--text)]">Financial migration NOT verified. A/R, A/P, cash and tax payable still need independently sourced totals and Agent #1's server-side AU-4 check. Even matching balances do not certify posting, documents, opening stock, currency, completeness or unchanged data between requests.</p>
        </div>
      )}
    </section>
  );
}
