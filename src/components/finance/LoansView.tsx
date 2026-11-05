/**
 * Loans (A-2, K-30, AI #3): a loan the workspace owes, its schedule, and the two things it posts.
 *
 * The record and the schedule are pure (`src/lib/loans.ts`, `src/lib/loanSchedule.ts`). Creating a
 * loan is just a record — nothing is posted until money actually moves. Both movements go through
 * `POST /api/v1/transactions`, the same route every other posting screen uses, so the server
 * validates the entry and the period lock applies; the entry carries the loan's own reference
 * (`LOAN-…`) so the balance can be read straight back out of the ledger and compared with the
 * schedule. The screen never invents an account: the pickers list the workspace's own chart and a
 * loan is refused when the right account is missing.
 *
 * Viewer role: can read everything, posts nothing.
 */
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, BadgeCheck, Banknote, CalendarClock, CheckCircle2, Plus, X } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { db, getIdToken } from '../../firebase';
import { collection, doc, updateDoc } from '../../lib/db/firestore';
import { addToDateISO, cn, formatCurrency, getLocalDateISO, readAmountCents } from '../../lib/utils';
import { isPostable } from '../../lib/txFilters';
import { EmptyState } from '../ui/EmptyState';
import { LoadingState } from '../ui/LoadingState';
import { buildLoanSchedule, nextInstallment, scheduleBalanceCents, scheduleInterestPaidCents } from '../../lib/loanSchedule';
import type { LoanInstallment, LoanSchedule } from '../../lib/loanSchedule';
import {
  createLoanDisbursementEntry,
  createLoanPaymentEntry,
  formatLoanRate,
  loanBankChoices,
  loanInterestChoices,
  loanLedgerCents,
  loanLiabilityChoices,
  loanProblem,
  newLoanReference,
  recordedInstallments,
} from '../../lib/loans';
import type { Loan, LoanDraft } from '../../lib/loans';
import type { ChartAccount, Transaction } from '../../types';

const inputClass = 'w-full p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';

const accountLabel = (a: ChartAccount) => (a.code ? `${a.code} · ${a.name}` : a.name);

/** What a loan looks like before it is saved. */
interface LoanForm {
  lender: string;
  principal: string;
  ratePercent: string;
  termMonths: string;
  startDate: string;
  firstPaymentDate: string;
  liabilityAccountId: string;
  interestAccountId: string;
  bankAccountId: string;
  note: string;
}

function emptyForm(): LoanForm {
  const today = getLocalDateISO();
  return {
    lender: '', principal: '', ratePercent: '', termMonths: '12',
    startDate: today, firstPaymentDate: addToDateISO(today, { months: 1 }),
    liabilityAccountId: '', interestAccountId: '', bankAccountId: '', note: '',
  };
}

function asDraft(form: LoanForm): LoanDraft {
  return {
    lender: form.lender,
    principalCents: form.principal.trim() ? readAmountCents(form.principal) ?? Number.NaN : 0,
    annualRate: form.ratePercent.trim() ? Number(form.ratePercent) / 100 : Number.NaN,
    termMonths: Number(form.termMonths),
    startDate: form.startDate,
    firstPaymentDate: form.firstPaymentDate,
    liabilityAccountId: form.liabilityAccountId,
    interestAccountId: form.interestAccountId,
    bankAccountId: form.bankAccountId,
  };
}

/**
 * Post one entry through the ordinary server route and return its id. Nothing is written when the
 * server refuses (a locked period, a balance that is off, a missing account), so the caller only
 * records the payment after this resolves.
 */
async function postEntry(transaction: Partial<Transaction>): Promise<string> {
  const id = `tx_loan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const token = await getIdToken();
  const res = await fetch('/api/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-operation-id': id },
    body: JSON.stringify({
      transaction: {
        ...transaction,
        id,
        status: 'completed',
        type: 'actual',
        isCleared: false,
        schemaVersion: '1.1',
        createdAt: new Date().toISOString(),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.message || body.error || `The entry was refused (HTTP ${res.status}).`);
  }
  return id;
}

/** The one sentence a loan reads as: size, rate, term, what is left. */
function loanSummary(loan: Loan, outstandingCents: number, money: (cents: number) => string): string {
  const term = `${loan.termMonths} monthly payment${loan.termMonths === 1 ? '' : 's'}`;
  return `${money(loan.principalCents)} from ${loan.lender} at ${formatLoanRate(loan.annualRate)}, ${term}. ${money(outstandingCents)} still owed.`;
}

export default function LoansView() {
  const { loading } = useLedgerCollections('loans');
  // selectors return the stored reference itself (a fresh `|| []` here would rebuild the memos)
  const loans = useLedgerStore(s => s.loans);
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const role = useCurrentRole();
  const { addEntity } = useEntityOperations();
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const workspace = getCurrentWorkspace();
  const currency = workspace?.currency || 'USD';
  const money = (cents: number) => formatCurrency(cents, currency);
  const canWrite = role !== 'viewer';

  const [form, setForm] = useState<LoanForm>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openLoanId, setOpenLoanId] = useState('');
  const [paymentDates, setPaymentDates] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});

  const liabilityAccounts = useMemo(() => loanLiabilityChoices(accounts || []), [accounts]);
  const interestAccounts = useMemo(() => loanInterestChoices(accounts || []), [accounts]);
  const bankAccounts = useMemo(() => loanBankChoices(accounts || []), [accounts]);
  const chartReady = liabilityAccounts.length > 0 && interestAccounts.length > 0 && bankAccounts.length > 0;

  const schedules = useMemo(() => {
    const map = new Map<string, { schedule: LoanSchedule | null; problem: string | null }>();
    for (const loan of loans || []) {
      const result = buildLoanSchedule({
        principalCents: loan.principalCents,
        annualRate: loan.annualRate,
        termMonths: loan.termMonths,
        startDate: loan.startDate,
        firstPaymentDate: loan.firstPaymentDate,
      });
      map.set(loan.id, result.ok
        ? { schedule: result.schedule, problem: null }
        : { schedule: null, problem: result.problem });
    }
    return map;
  }, [loans]);

  const rows = loans || [];
  const chart = accounts || [];
  const ledger = transactions || [];
  const account = (id: string) => chart.find(a => a.id === id);
  const openLoan = rows.find(l => l.id === openLoanId) || rows[0];

  const set = (patch: Partial<LoanForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setRefused(null);
  };

  const saveLoan = async () => {
    const draft = asDraft(form);
    const problem = loanProblem(draft, chart);
    if (problem) { setRefused(problem); return; }
    setBusy(true);
    try {
      const id = doc(collection(db, 'loans')).id;
      const record: Loan = {
        id,
        uid: workspace?.uid,
        workspaceId: workspace?.id || '',
        lender: draft.lender.trim(),
        principalCents: draft.principalCents,
        annualRate: draft.annualRate,
        termMonths: draft.termMonths,
        startDate: draft.startDate,
        firstPaymentDate: draft.firstPaymentDate,
        liabilityAccountId: draft.liabilityAccountId,
        interestAccountId: draft.interestAccountId,
        bankAccountId: draft.bankAccountId,
        currency,
        reference: newLoanReference(id),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        payments: [],
      };
      // addEntity stamps id/uid/workspaceId/createdAt and reports a refusal the usual way
      const saved = await addEntity('loans', record, `${money(record.principalCents)} from ${record.lender} saved`);
      if (!saved) throw new Error('Nothing was saved. If this workspace has not been updated for loans yet, the loans database change still has to be applied.');
      setOpenLoanId(id);
      setForm(emptyForm());
      setFormOpen(false);
      setRefused(null);
    } catch (error) {
      setRefused(error instanceof Error ? error.message : 'The loan could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const recordMoneyArriving = async (loan: Loan) => {
    const bank = account(loan.bankAccountId);
    const liability = account(loan.liabilityAccountId);
    if (!bank || !liability) { toast.error('This loan points at an account that no longer exists.'); return; }
    setBusy(true);
    try {
      await postEntry(createLoanDisbursementEntry({ loan, bank, liability }));
      const notice = `${money(loan.principalCents)} recorded: ${bank.name} is debited and ${liability.name} is credited.`;
      setNotices(current => ({ ...current, [loan.id]: notice }));
      toast.success(notice);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The entry was refused.');
    } finally {
      setBusy(false);
    }
  };

  const recordPayment = async (loan: Loan, installment: LoanInstallment) => {
    const bank = account(loan.bankAccountId);
    const liability = account(loan.liabilityAccountId);
    const interest = account(loan.interestAccountId);
    if (!bank || !liability || !interest) { toast.error('This loan points at an account that no longer exists.'); return; }
    const date = paymentDates[loan.id] || installment.dueDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error('Give the date the payment was made.'); return; }
    setBusy(true);
    try {
      const transactionId = await postEntry(createLoanPaymentEntry({ loan, installment, date, bank, liability, interest }));
      const payments = [...(loan.payments || []), { installment: installment.number, date, transactionId }];
      await updateDoc(doc(db, 'loans', loan.id), { payments, updatedAt: new Date().toISOString() });
      setPaymentDates(current => ({ ...current, [loan.id]: addToDateISO(date, { months: 1 }) }));
      const notice = `Payment ${installment.number} of ${loan.termMonths} recorded: ${money(installment.principalCents)} off the loan, ${money(installment.interestCents)} interest.`;
      setNotices(current => ({ ...current, [loan.id]: notice }));
      toast.success(notice);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The entry was refused.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-8"><LoadingState what="loans" /></div>;

  const addButton = canWrite && (
    <button
      type="button"
      onClick={() => { setFormOpen(open => !open); setRefused(null); }}
      className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--surface)] text-sm font-bold inline-flex items-center gap-2"
    >
      {formOpen ? <X className="w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
      {formOpen ? 'Close the form' : 'Add a loan'}
    </button>
  );

  if (!rows.length && !formOpen) {
    return (
      <div className="h-full overflow-auto p-6 md:p-8 space-y-4" id="loans-view">
        {/* every screen has its page heading, the empty one too */}
        <h1 className="max-w-5xl mx-auto text-xl font-bold text-[var(--text)] flex items-center gap-2">
          <Banknote className="w-5 h-5 text-[var(--brass)]" aria-hidden="true" /> Loans
        </h1>
        <EmptyState
          title="No loans yet"
          description={canWrite
            ? 'Add a loan and the schedule is worked out to the cent: every payment split into interest and principal, the last one taking the remainder, with the balance left checked against the liability account.'
            : 'A loan holds the lender, the principal, the rate, the term and the schedule to the cent.'}
          actionLabel={canWrite ? 'Add a loan' : undefined}
          onAction={canWrite ? () => setFormOpen(true) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6 md:p-8" id="loans-view">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
              <Banknote className="w-5 h-5 text-[var(--brass)]" aria-hidden="true" /> Loans
            </h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              Every payment is split into interest and principal to the cent; the last payment takes the remainder, so the loan closes at exactly zero.
            </p>
          </div>
          {addButton}
        </div>

        {formOpen && canWrite && (
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4" aria-labelledby="new-loan">
            <h2 id="new-loan" className="text-lg font-medium text-[var(--text)]">A new loan</h2>
            {!chartReady && (
              <p role="alert" className="text-sm text-amber-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5" aria-hidden="true" />
                <span>
                  {!liabilityAccounts.length && 'This workspace has no liability account. '}
                  {!interestAccounts.length && 'It has no expense account for the interest. '}
                  {!bankAccounts.length && 'It has no bank or cash account. '}
                  Add one in the chart of accounts — LedgerFlow does not invent accounts.
                </span>
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="loan-lender" className="block text-xs font-semibold text-[var(--muted)] mb-1">Lender</label>
                <input id="loan-lender" value={form.lender} onChange={e => set({ lender: e.target.value })} placeholder="e.g. Northwind Bank" className={inputClass} />
              </div>
              <div>
                <label htmlFor="loan-principal" className="block text-xs font-semibold text-[var(--muted)] mb-1">Principal</label>
                <input id="loan-principal" inputMode="decimal" value={form.principal} onChange={e => set({ principal: e.target.value })} placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label htmlFor="loan-rate" className="block text-xs font-semibold text-[var(--muted)] mb-1">Rate (% a year)</label>
                <input id="loan-rate" inputMode="decimal" value={form.ratePercent} onChange={e => set({ ratePercent: e.target.value })} placeholder="6.5" className={inputClass} />
              </div>
              <div>
                <label htmlFor="loan-term" className="block text-xs font-semibold text-[var(--muted)] mb-1">Term (monthly payments)</label>
                <input id="loan-term" inputMode="numeric" value={form.termMonths} onChange={e => set({ termMonths: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="loan-start" className="block text-xs font-semibold text-[var(--muted)] mb-1">Money arrived</label>
                <input id="loan-start" type="date" value={form.startDate} onChange={e => set({ startDate: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="loan-first-payment" className="block text-xs font-semibold text-[var(--muted)] mb-1">First payment</label>
                <input id="loan-first-payment" type="date" value={form.firstPaymentDate} onChange={e => set({ firstPaymentDate: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="loan-liability" className="block text-xs font-semibold text-[var(--muted)] mb-1">Loan (liability) account</label>
                <select id="loan-liability" value={form.liabilityAccountId} onChange={e => set({ liabilityAccountId: e.target.value })} className={inputClass}>
                  <option value="">Choose an account…</option>
                  {liabilityAccounts.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="loan-interest" className="block text-xs font-semibold text-[var(--muted)] mb-1">Interest expense account</label>
                <select id="loan-interest" value={form.interestAccountId} onChange={e => set({ interestAccountId: e.target.value })} className={inputClass}>
                  <option value="">Choose an account…</option>
                  {interestAccounts.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="loan-bank" className="block text-xs font-semibold text-[var(--muted)] mb-1">Bank the money comes to</label>
                <select id="loan-bank" value={form.bankAccountId} onChange={e => set({ bankAccountId: e.target.value })} className={inputClass}>
                  <option value="">Choose an account…</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label htmlFor="loan-note" className="block text-xs font-semibold text-[var(--muted)] mb-1">Note (optional)</label>
                <input id="loan-note" value={form.note} onChange={e => set({ note: e.target.value })} placeholder="e.g. equipment loan" className={inputClass} />
              </div>
            </div>
            {refused && <p role="alert" className="text-sm text-[var(--neg)]">{refused}</p>}
            <button type="button" disabled={busy} onClick={saveLoan} className="px-4 py-2 rounded-lg bg-[var(--text)] text-[var(--surface)] text-sm font-bold disabled:opacity-50">
              Save the loan
            </button>
          </section>
        )}

        <section className="space-y-4" aria-label="Loans">
          {rows.map(loan => {
            const info = schedules.get(loan.id);
            const posted = ledger.some(t => t.reference === loan.reference && isPostable(t));
            const ledgerOwed = loanLedgerCents(loan, ledger);
            // noted on the loan or found in the ledger: a payment is never offered twice
            const recorded = recordedInstallments(loan, ledger);
            const scheduleOwed = info?.schedule ? scheduleBalanceCents(info.schedule, recorded) : 0;
            const interestPaid = info?.schedule ? scheduleInterestPaidCents(info.schedule, recorded) : 0;
            const next = info?.schedule ? nextInstallment(info.schedule, recorded) : null;
            const paidCount = recorded.length;
            const isOpen = openLoan?.id === loan.id;
            const liability = account(loan.liabilityAccountId);
            return (
              <article key={loan.id} className={cn('rounded-2xl border bg-[var(--surface)] p-5 space-y-3', isOpen ? 'border-[var(--brass)]' : 'border-[var(--line)]')}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-medium text-[var(--text)]">{loan.lender}</h2>
                    <p className="text-sm text-[var(--muted)]">{loanSummary(loan, scheduleOwed, money)}</p>
                    <p className="text-xs text-[var(--muted)] mt-1">
                      {loan.startDate} → first payment {loan.firstPaymentDate}
                      {loan.reference ? ` · ${loan.reference}` : ''}
                      {loan.note ? ` · ${loan.note}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {posted
                      ? <span className="text-xs font-semibold text-[var(--pos)] inline-flex items-center gap-1"><BadgeCheck className="w-4 h-4" aria-hidden="true" /> In the books</span>
                      : <span className="text-xs font-semibold text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="w-4 h-4" aria-hidden="true" /> Not in the books yet</span>}
                    {!isOpen && (
                      <button type="button" onClick={() => setOpenLoanId(loan.id)} className="text-xs font-semibold text-[var(--brass)] hover:underline">
                        Open the schedule
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && info?.problem && <p role="alert" className="text-sm text-[var(--neg)]">{info.problem}</p>}

                {isOpen && info?.schedule && (
                  <>
                    {!posted && canWrite && (
                      <button type="button" disabled={busy} onClick={() => recordMoneyArriving(loan)}
                        className="px-3 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold text-[var(--text)] disabled:opacity-50 inline-flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Record the {money(loan.principalCents)} arriving
                      </button>
                    )}

                    <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
                      <table className="w-full border-collapse text-sm tabular-nums">
                        <caption className="sr-only">
                          Repayment schedule for the loan from {loan.lender}: {info.schedule.installments.length} monthly payments of about {money(info.schedule.paymentCents)}
                        </caption>
                        <thead className="bg-[var(--ink)]">
                          <tr>
                            <th scope="col" className="p-3 text-left">#</th>
                            <th scope="col" className="p-3 text-left whitespace-nowrap"><CalendarClock className="w-4 h-4 inline" aria-hidden="true" /> Due</th>
                            <th scope="col" className="p-3 text-right">Payment</th>
                            <th scope="col" className="p-3 text-right">Interest</th>
                            <th scope="col" className="p-3 text-right">Principal</th>
                            <th scope="col" className="p-3 text-right">Balance after</th>
                            <th scope="col" className="p-3 text-right">Recorded</th>
                          </tr>
                        </thead>
                        <tbody>
                          {info.schedule.installments.map(installment => {
                            const record = (loan.payments || []).find(p => p.installment === installment.number);
                            return (
                              <tr key={installment.number} className={cn('border-t border-[var(--line)]', record && 'text-[var(--muted)]')}>
                                <th scope="row" className="p-3 text-left">{installment.number}</th>
                                <td className="p-3 whitespace-nowrap">{installment.dueDate}</td>
                                <td className="p-3 text-right whitespace-nowrap">{money(installment.paymentCents)}</td>
                                <td className="p-3 text-right whitespace-nowrap">{money(installment.interestCents)}</td>
                                <td className="p-3 text-right whitespace-nowrap">{money(installment.principalCents)}</td>
                                <td className="p-3 text-right whitespace-nowrap">{money(installment.balanceCents)}</td>
                                <td className="p-3 text-right whitespace-nowrap">
                                  {record ? (
                                    <span className="inline-flex items-center gap-1 text-[var(--pos)]">
                                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {record.date}
                                    </span>
                                  ) : canWrite && next?.number === installment.number ? (
                                    <button type="button" disabled={busy} onClick={() => recordPayment(loan, installment)}
                                      className="text-xs font-semibold text-[var(--brass)] hover:underline disabled:opacity-50">
                                      Record payment
                                    </button>
                                  ) : (
                                    <span className="text-xs text-[var(--muted)]">{next ? 'Not yet' : 'Not recorded'}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[var(--line)] font-semibold">
                            <td className="p-3" />
                            <td className="p-3">Total</td>
                            <td className="p-3 text-right whitespace-nowrap">{money(info.schedule.totalPaymentsCents)}</td>
                            <td className="p-3 text-right whitespace-nowrap">{money(info.schedule.totalInterestCents)}</td>
                            <td className="p-3 text-right whitespace-nowrap">{money(info.schedule.principalCents)}</td>
                            <td className="p-3 text-right">—</td>
                            <td className="p-3" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div className="flex items-end justify-between gap-4 flex-wrap text-sm">
                      <p className="text-[var(--muted)]">
                        {paidCount ? `${paidCount} of ${loan.termMonths} recorded · ${money(interestPaid)} interest so far` : 'Nothing recorded yet'}
                        {' · '}
                        {next ? `next payment #${next.number} due ${next.dueDate}` : 'the loan is repaid'}
                      </p>
                      {canWrite && next && (
                        <div className="flex items-end gap-2">
                          <div>
                            <label htmlFor={`loan-payment-date-${loan.id}`} className="block text-xs font-semibold text-[var(--muted)] mb-1">Payment date</label>
                            <input
                              id={`loan-payment-date-${loan.id}`}
                              type="date"
                              value={paymentDates[loan.id] ?? next.dueDate}
                              onChange={e => setPaymentDates(current => ({ ...current, [loan.id]: e.target.value }))}
                              className={inputClass}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {notices[loan.id] && <p role="status" className="text-sm text-[var(--text)]">{notices[loan.id]}</p>}

                    {posted ? (
                      <p className={cn('text-sm font-medium', Math.abs(ledgerOwed - scheduleOwed) > 0.5 ? 'text-amber-700' : 'text-[var(--pos)]')}>
                        {Math.abs(ledgerOwed - scheduleOwed) > 0.5
                          ? `The ledger says ${money(ledgerOwed)} is owed; the schedule says ${money(scheduleOwed)}. The difference is entries made without this loan's reference.`
                          : `The ledger agrees: ${money(ledgerOwed)} owed on ${liability ? liability.name : 'the loan account'}.`}
                      </p>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">Nothing from this loan is in the ledger yet; the schedule above is what will be posted.</p>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
