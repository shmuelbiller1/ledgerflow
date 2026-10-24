import React, { useMemo, useRef, useState } from 'react';
import { Receipt, Plus, Trash2, X } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { resolveAccountRole } from '../../lib/accountUtils';
import { formatCurrency, getLocalDateISO, parseAmountToCents } from '../../lib/utils';
import { claimOf, claimProblem, decimalNumber, decisionProblem, mileageLine, perDiemLine, rateInThousandths, workedLineProblem, type ClaimLine, type ClaimLineKind, type DistanceUnit } from '../../lib/expenseClaims';
import { parseCorporateCardCsv, type CorporateCardImportResult } from '../../lib/corporateCardImport';
import { mileageRateFor, perDiemRateFor, rateSuggestionText, COUNTRY_NAMES, type PerDiemRow, type RateCountry } from '../../lib/tax/expenseRateTables';
import { findGsaLocality, gsaLocalitiesToPerDiemRows, gsaLocalityLabel, readGsaPerDiemCsv, type GsaPerDiemImport } from '../../lib/tax/gsaPerDiemImport';
import type { Bill, ChartAccount, Vendor } from '../../types';

export interface NewClaim { payeeName: string; date: string; lines: ClaimLine[]; note: string }

/** One line of the claim form: an expense typed as an amount, or mileage / per diem worked out (BE-09, BE-10). */
interface DraftLine { key: string; kind: ClaimLineKind; description: string; accountId: string; amount: string; from: string; to: string; distance: string; unit: DistanceUnit; rate: string; days: string; /** A-75/A-76: the country whose dated rate table suggests the rate (none = type it) */ country: string; /** A-107: the GSA locality picked for a US per-diem line, as "Destination, ST" (none = the standard rate) */ locality: string }

// the last mileage and per-diem rates used, per workspace, in this browser (the person's own rates: no default is made up)
const RATES_KEY = 'lf_claim_rates';
type SavedRates = { mileageRate?: string; unit?: DistanceUnit; dailyRate?: string };
function savedRates(): SavedRates {
  try { return JSON.parse(localStorage.getItem(RATES_KEY) || '{}') as SavedRates; } catch { return {}; }
}
function saveRates(lines: DraftLine[]) {
  const mileage = lines.find(l => l.kind === 'mileage' && rateInThousandths(l.rate) > 0);
  const perDiem = lines.find(l => l.kind === 'perDiem' && parseAmountToCents(l.rate) > 0);
  if (!mileage && !perDiem) return;
  try {
    localStorage.setItem(RATES_KEY, JSON.stringify({ ...savedRates(), ...(mileage ? { mileageRate: mileage.rate, unit: mileage.unit } : {}), ...(perDiem ? { dailyRate: perDiem.rate } : {}) }));
  } catch { /* private window: nothing remembered */ }
}
const blankLine = (accountId = ''): DraftLine => ({ key: crypto.randomUUID(), kind: 'expense', description: '', accountId, amount: '', from: '', to: '', distance: '', unit: 'km', rate: '', days: '', country: '', locality: '' });

/** The claim line a draft line stands for (mileage and per diem worked out), and what it still needs. */
function toClaimLine(l: DraftLine, currency: string): { line: ClaimLine; problem: string | null } {
  if (l.kind === 'mileage') {
    const input = { distance: decimalNumber(l.distance), rateThousandths: rateInThousandths(l.rate) };
    return { line: mileageLine({ purpose: l.description, from: l.from, to: l.to, unit: l.unit, accountId: l.accountId, currency, ...input }), problem: workedLineProblem('mileage', input) };
  }
  if (l.kind === 'perDiem') {
    const input = { days: decimalNumber(l.days), dailyRateCents: parseAmountToCents(l.rate) };
    return { line: perDiemLine({ purpose: l.description, accountId: l.accountId, currency, ...input }), problem: workedLineProblem('perDiem', input) };
  }
  return { line: { description: l.description, accountId: l.accountId, amountCents: parseAmountToCents(l.amount) }, problem: null };
}

interface Props {
  bills: Bill[];
  vendors: Vendor[];
  accounts: ChartAccount[];
  userRole: string;
  uid: string;
  currency: string;
  onSubmit: (claim: NewClaim) => Promise<unknown> | unknown;
  onDecide: (bill: Bill, approve: boolean, reason?: string) => Promise<unknown> | unknown;
}

const field = 'w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]';

/**
 * Expense claims (K-22) on the Purchases page: claims waiting for a decision, with Approve / Reject for
 * owners and accountants (not one's own, unless owner), and "New expense claim" for everyone who can
 * write. An approved claim is a bill owed to the person, paid like any bill.
 */
export default function ExpenseClaims({ bills, vendors, accounts, userRole: role, uid, currency, onSubmit, onDecide }: Props) {
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const waiting = useMemo(() => bills.filter(b => claimOf(b)?.state === 'submitted' && b.status === 'draft'), [bills]);
  const canSubmit = role !== 'viewer';
  if (!canSubmit && waiting.length === 0) return null;

  return (
    <section aria-labelledby="claims-title" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="claims-title" className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
          <Receipt className="w-4 h-4 text-indigo-500" aria-hidden="true" />
          Expense claims {waiting.length > 0 && <span className="text-[var(--muted)] font-normal">· {waiting.length} waiting</span>}
        </h2>
        {canSubmit && (
          <button type="button" onClick={() => setCreating(true)} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New expense claim
          </button>
        )}
      </div>
      {waiting.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">Paid for the business out of your own pocket? Claim it here; once approved it is paid back like a bill.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {waiting.map(b => {
            const claim = claimOf(b)!;
            const problem = decisionProblem(claim, role, uid);
            return (
              <li key={b.id} className="py-2 text-sm flex flex-wrap items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-[var(--text)]">{b.vendorName}</span>
                  <span className="text-[var(--muted)]"> · {String(b.date || '').slice(0, 10)} · {(b.splits || []).map(s => s.description).filter(Boolean).join(', ')}</span>
                  {claim.submittedByName && <span className="block text-[11px] text-[var(--muted)]">Submitted by {claim.submittedByName}</span>}
                </span>
                <span className="font-mono font-bold">{formatCurrency(b.amountCents || 0, b.currency || currency)}</span>
                {problem ? (
                  <span className="text-[11px] text-[var(--muted)]">{problem === 'Only owners and accountants approve expense claims' ? 'Waiting for approval' : problem}</span>
                ) : rejecting === b.id ? (
                  <span className="flex items-center gap-2">
                    <label htmlFor={`reject-${b.id}`} className="sr-only">Why is it rejected?</label>
                    <input id={`reject-${b.id}`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why? (optional)" className="px-2 py-1 text-xs border border-[var(--line)] rounded bg-[var(--panel)]" />
                    <button type="button" onClick={() => { void onDecide(b, false, reason.trim() || undefined); setRejecting(null); setReason(''); }} className="text-xs font-semibold text-rose-600">Reject</button>
                    <button type="button" onClick={() => setRejecting(null)} className="text-xs text-[var(--muted)]">Cancel</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => void onDecide(b, true)} aria-label={`Approve the claim of ${b.vendorName}`}
                      className="px-2 py-1 text-xs font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
                    <button type="button" onClick={() => setRejecting(b.id)} aria-label={`Reject the claim of ${b.vendorName}`}
                      className="px-2 py-1 text-xs font-semibold rounded border border-[var(--line)] text-rose-600">Reject</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {creating && (
        <NewClaimDialog bills={bills} vendors={vendors} accounts={accounts} currency={currency} onClose={() => setCreating(false)}
          onSubmit={async claim => { await onSubmit(claim); setCreating(false); }} />
      )}
    </section>
  );
}

function NewClaimDialog({ bills, vendors, accounts, currency, onClose, onSubmit }: {
  bills: Bill[]; vendors: Vendor[]; accounts: ChartAccount[]; currency: string; onClose: () => void; onSubmit: (claim: NewClaim) => Promise<void>;
}) {
  const { dialogProps, titleId } = useDialog(onClose, true);
  const expenseAccounts = useMemo(() => accounts.filter(a => !a.isArchived && resolveAccountRole(a) === 'expense'), [accounts]);
  const people = useMemo(() => vendors.filter(v => v.type === 'employee').map(v => v.name), [vendors]);
  const [payeeName, setPayeeName] = useState('');
  const [date, setDate] = useState(getLocalDateISO());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [saving, setSaving] = useState(false);
  // A-107: the GSA locality table read from the person's own GSA file for this claim only.
  // It is held in the dialog and never saved: a rate it suggests fills an empty field exactly
  // like the built-in table's, and the claim still records the rate left in the field.
  const [gsa, setGsa] = useState<{ read: GsaPerDiemImport; rows: PerDiemRow[]; fileName: string } | null>(null);
  const [gsaProblem, setGsaProblem] = useState('');
  const gsaReadSeqRef = useRef(0);
  // A-134: corporate card CSV statement import into editable expense claim lines.
  const [cardImport, setCardImport] = useState<{ result: CorporateCardImportResult; fileName: string } | null>(null);
  const [cardProblem, setCardProblem] = useState('');
  const cardReadSeqRef = useRef(0);
  const worked = lines.map(l => toClaimLine(l, currency));
  const claimLines: ClaimLine[] = worked.map(w => w.line);
  const total = claimLines.reduce((sum, l) => sum + (l.amountCents > 0 ? l.amountCents : 0), 0);
  const problem = worked.find(w => w.problem)?.problem || claimProblem({ payeeName, date, lines: claimLines });
  const setLine = (key: string, change: Partial<DraftLine>) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...change } : l)));
  // A-75/A-76: the dated rate table suggests the rate for the claim's date and the line's country.
  // It fills the field only while the field is empty (and only in the claim's own currency and the
  // line's own distance unit) — what the person types is what the claim records.
  // A-107: the imported row for the locality this line picked (exact "Destination, ST"), if any.
  const gsaRowsFor = (l: DraftLine): PerDiemRow[] => {
    if (!gsa || l.kind !== 'perDiem' || l.country !== 'US') return [];
    const locality = findGsaLocality(gsa.read.localities, l.locality);
    if (!locality) return [];
    const label = gsaLocalityLabel(locality);
    return gsa.rows.filter(r => r.area.startsWith(`${label} locality`));
  };
  const suggestionFor = (l: DraftLine, onDate = date) => {
    if (!l.country) return null;
    const country = l.country as RateCountry;
    return l.kind === 'mileage'
      ? mileageRateFor({ country, date: onDate, unit: l.unit, currency })
      : l.kind === 'perDiem'
        ? perDiemRateFor({ country, date: onDate, currency, extraRows: gsaRowsFor(l) })
        : null;
  };
  const suggestionRate = (s: ReturnType<typeof suggestionFor>): string => {
    if (!s || !s.matchesCurrency) return '';
    if ('matchesUnit' in s && !s.matchesUnit) return '';
    return 'rateText' in s ? s.rateText : s.dailyText;
  };
  const withTableRate = (l: DraftLine, change: Partial<DraftLine>): Partial<DraftLine> => {
    const next = { ...l, ...change };
    if (next.kind === 'expense' || (change.rate !== undefined ? change.rate : next.rate)) return change;
    const fill = suggestionRate(suggestionFor(next));
    return fill ? { ...change, rate: fill } : change;
  };
  const setDateAndPrefill = (value: string) => {
    setDate(value);
    setLines(prev => prev.map(l => {
      if (l.kind === 'expense' || l.rate) return l;
      const fill = suggestionRate(suggestionFor(l, value));
      return fill ? { ...l, rate: fill } : l;
    }));
  };
  // switching a line to mileage or per diem fills in the rate used last time
  const setKind = (key: string, kind: ClaimLineKind) => {
    const remembered = savedRates();
    setLines(prev => prev.map(l => {
      if (l.key !== key) return l;
      const change: Partial<DraftLine> = kind === 'mileage'
        ? { kind, rate: remembered.mileageRate || '', unit: remembered.unit || 'km' }
        : kind === 'perDiem'
          ? { kind, rate: remembered.dailyRate || '' }
          : { kind, rate: '' };
      return { ...l, ...withTableRate(l, change) };
    }));
  };

  // A-107: read the GSA fiscal-year file (saved as CSV) for this claim's locality rates.
  // A file that does not read cleanly imports nothing and says why; a rate already typed is
  // never overwritten — only empty US per-diem lines with their locality picked are filled.
  const onGsaFile = async (file: File | undefined) => {
    if (!file) return;
    const seq = ++gsaReadSeqRef.current;
    setGsaProblem('');
    try {
      const text = await file.text();
      if (gsaReadSeqRef.current !== seq) return;
      const read = readGsaPerDiemCsv(text);
      const rows = gsaLocalitiesToPerDiemRows(read.localities, getLocalDateISO());
      setGsa({ read, rows, fileName: file.name });
      setLines(prev => prev.map(l => {
        if (l.kind !== 'perDiem' || l.country !== 'US' || l.rate) return l;
        const locality = findGsaLocality(read.localities, l.locality);
        if (!locality) return l;
        const label = gsaLocalityLabel(locality);
        const suggestion = perDiemRateFor({ country: 'US', date, currency, extraRows: rows.filter(r => r.area.startsWith(`${label} locality`)) });
        return suggestion && suggestion.matchesCurrency ? { ...l, rate: suggestion.dailyText } : l;
      }));
    } catch (err) {
      if (gsaReadSeqRef.current !== seq) return;
      setGsa(null);
      setGsaProblem(err instanceof Error ? err.message : String(err));
    }
  };

  // A-134: read a corporate card CSV statement into ordinary editable expense lines on this claim.
  const onCardStatementFile = async (file: File | undefined) => {
    if (!file) return;
    const seq = ++cardReadSeqRef.current;
    setCardProblem('');
    try {
      const text = await file.text();
      if (cardReadSeqRef.current !== seq) return;
      const result = parseCorporateCardCsv(text, { claimCurrency: currency, existingBills: bills });
      setCardImport({ result, fileName: file.name });
      setDate(result.statementDate);
      const holder = result.charges.find(c => c.cardholder)?.cardholder;
      if (holder && !payeeName.trim()) setPayeeName(holder);
      setLines(prev => {
        const defaultAccount = prev[prev.length - 1]?.accountId || expenseAccounts[0]?.id || '';
        const imported: DraftLine[] = result.charges.map(c => ({
          ...blankLine(defaultAccount),
          description: c.description,
          amount: c.amountText,
        }));
        const keep = prev.filter(l => l.description.trim() || l.amount.trim() || l.kind !== 'expense');
        return keep.length > 0 ? [...keep, ...imported] : imported;
      });
    } catch (err) {
      if (cardReadSeqRef.current !== seq) return;
      setCardImport(null);
      setCardProblem(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async () => {
    if (problem || saving) return;
    setSaving(true);
    try {
      await onSubmit({ payeeName: payeeName.trim(), date, lines: claimLines.filter(l => l.description.trim() || l.amountCents), note });
      saveRates(lines);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">New expense claim</h2>
          <button type="button" onClick={onClose} aria-label="Close expense claim" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]"><X aria-hidden="true" className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Who paid</span>
              <input list="claim-people" value={payeeName} onChange={e => setPayeeName(e.target.value)} placeholder="Name" className={field} />
              <datalist id="claim-people">{people.map(p => <option key={p} value={p} />)}</datalist>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Paid on</span>
              <input type="date" value={date} onChange={e => setDateAndPrefill(e.target.value)} className={field} />
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-[var(--muted)]">What was paid for</legend>
            {lines.map((l, i) => (
              <div key={l.key} className="space-y-1.5 border-b border-[var(--line)] pb-2 last:border-0">
                <div className="grid grid-cols-[6.5rem_1fr_1fr_7rem_auto] gap-2 items-center">
                  <select aria-label={`Kind, line ${i + 1}`} value={l.kind} onChange={e => setKind(l.key, e.target.value as ClaimLineKind)} className={field}>
                    <option value="expense">Expense</option>
                    <option value="mileage">Mileage</option>
                    <option value="perDiem">Per diem</option>
                  </select>
                  <input aria-label={`What, line ${i + 1}`} value={l.description} onChange={e => setLine(l.key, { description: e.target.value })}
                    placeholder={l.kind === 'expense' ? 'Taxi to client' : 'Client visit'} className={field} />
                  <select aria-label={`Category, line ${i + 1}`} value={l.accountId} onChange={e => setLine(l.key, { accountId: e.target.value })} className={field}>
                    <option value="">Category…</option>
                    {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  {l.kind === 'expense' ? (
                    <input aria-label={`Amount, line ${i + 1}`} inputMode="decimal" value={l.amount} onChange={e => setLine(l.key, { amount: e.target.value })} placeholder="0.00" className={`${field} text-right font-mono`} />
                  ) : (
                    <output aria-label={`Amount, line ${i + 1}`} className="text-right font-mono px-1">{formatCurrency(worked[i].line.amountCents, currency)}</output>
                  )}
                  <button type="button" onClick={() => setLines(prev => (prev.length > 1 ? prev.filter(x => x.key !== l.key) : prev))} aria-label={`Remove line ${i + 1}`} className="p-1 text-[var(--muted)] hover:text-rose-600">
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                {l.kind === 'mileage' && (
                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_5rem_4.5rem_6rem] gap-2 items-center pl-[7rem]">
                    <input aria-label={`From, line ${i + 1}`} value={l.from} onChange={e => setLine(l.key, { from: e.target.value })} placeholder="From" className={field} />
                    <input aria-label={`To, line ${i + 1}`} value={l.to} onChange={e => setLine(l.key, { to: e.target.value })} placeholder="To" className={field} />
                    <input aria-label={`Distance, line ${i + 1}`} inputMode="decimal" value={l.distance} onChange={e => setLine(l.key, { distance: e.target.value })} placeholder="0" className={`${field} text-right font-mono`} />
                    <select aria-label={`Unit, line ${i + 1}`} value={l.unit} onChange={e => setLine(l.key, withTableRate(l, { unit: e.target.value as DistanceUnit }))} className={field}>
                      <option value="km">km</option>
                      <option value="mi">miles</option>
                    </select>
                    <input aria-label={`Rate per ${l.unit === 'mi' ? 'mile' : 'km'}, line ${i + 1}`} inputMode="decimal" value={l.rate} onChange={e => setLine(l.key, { rate: e.target.value })} placeholder={`${currency}/${l.unit}`} className={`${field} text-right font-mono`} />
                  </div>
                )}
                {l.kind === 'perDiem' && (
                  <div className="grid grid-cols-2 sm:grid-cols-[5rem_7rem] gap-2 items-center pl-[7rem]">
                    <input aria-label={`Days, line ${i + 1}`} inputMode="decimal" value={l.days} onChange={e => setLine(l.key, { days: e.target.value })} placeholder="Days" className={`${field} text-right font-mono`} />
                    <input aria-label={`Daily rate, line ${i + 1}`} inputMode="decimal" value={l.rate} onChange={e => setLine(l.key, { rate: e.target.value })} placeholder={`${currency}/day`} className={`${field} text-right font-mono`} />
                  </div>
                )}
                {(l.kind === 'mileage' || l.kind === 'perDiem') && (
                  <div className="flex flex-wrap items-center gap-2 pl-[7rem]">
                    <select aria-label={`Country, line ${i + 1}`} value={l.country} onChange={e => setLine(l.key, withTableRate(l, { country: e.target.value }))} className={`${field} w-auto`}>
                      <option value="">Country…</option>
                      {(Object.keys(COUNTRY_NAMES) as RateCountry[]).map(c => <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>)}
                    </select>
                    {l.kind === 'perDiem' && l.country === 'US' && gsa && (
                      <>
                        <input aria-label={`GSA locality, line ${i + 1}`} list="claim-gsa-localities" value={l.locality}
                          onChange={e => setLine(l.key, withTableRate(l, { locality: e.target.value }))}
                          placeholder="Locality (GSA)…" className={`${field} w-auto`} />
                        <datalist id="claim-gsa-localities">{gsa.read.localities.map(loc => <option key={`${loc.state}-${loc.destination}-${loc.county}`} value={gsaLocalityLabel(loc)} />)}</datalist>
                      </>
                    )}
                    <p className="text-[11px] text-[var(--muted)] flex-1 min-w-[12rem]" role="note">
                      {l.kind === 'perDiem' && l.country === 'US' && gsa && l.locality.trim() && !findGsaLocality(gsa.read.localities, l.locality)
                        ? `"${l.locality.trim()}" is not a locality in the imported FY${gsa.read.fiscalYear} file — pick one from the list; until then the standard rate is suggested.`
                        : suggestionFor(l)
                          ? rateSuggestionText(suggestionFor(l)!, date)
                        : l.country
                          ? `No table row for ${COUNTRY_NAMES[l.country as RateCountry] || l.country} on ${date} — type the rate (the claim records the rate you type).`
                          : 'Choose a country to suggest the dated rate from the rate table (the claim records the rate you type).'}
                    </p>
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setLines(prev => [...prev, blankLine(prev[prev.length - 1]?.accountId || '')])}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">+ Add a line</button>
          </fieldset>
          <div className="space-y-1">
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Import corporate card statement (CSV, optional)</span>
              <input aria-label="Corporate card statement CSV" type="file" accept=".csv,text/csv" className={field}
                onChange={e => void onCardStatementFile(e.target.files?.[0])} />
            </label>
            {cardImport ? (
              <p className="text-[11px] text-[var(--muted)]" role="status">
                Imported {cardImport.result.charges.length} charge{cardImport.result.charges.length === 1 ? '' : 's'} from {cardImport.fileName}
                {cardImport.result.skippedCreditsCount > 0 ? ` (${cardImport.result.skippedCreditsCount} card payment/refund row(s) skipped)` : ''}
                {cardImport.result.duplicateCount > 0 ? ` · ${cardImport.result.duplicateCount} possible duplicate(s) already on a claim: ${cardImport.result.charges.filter(c => c.duplicateOf).map(c => `${c.description} [${c.duplicateOf}]`).join('; ')}` : ''}. Review categories before submitting.
              </p>
            ) : (
              <p className="text-[11px] text-[var(--muted)]">Load card statement rows (Date, Merchant/Description, Amount in {currency}) into editable lines above; nothing posts until approved.</p>
            )}
            {cardProblem && <p role="alert" className="text-xs text-rose-600">{cardProblem}</p>}
          </div>
          {lines.some(l => l.kind === 'perDiem') && (
            <div className="space-y-1">
              <label className="block">
                <span className="block text-xs font-semibold text-[var(--muted)] mb-1">US locality rates — GSA per diem file (optional)</span>
                <input aria-label="GSA per diem rates CSV" type="file" accept=".csv,text/csv" className={field}
                  onChange={e => void onGsaFile(e.target.files?.[0])} />
              </label>
              {gsa
                ? <p className="text-[11px] text-[var(--muted)]" role="status">
                  {gsa.read.localities.length} FY{gsa.read.fiscalYear} localities read from {gsa.fileName}. Pick the locality on a US per-diem line to suggest its rate; the file is used for this claim only and is not saved.
                </p>
                : <p className="text-[11px] text-[var(--muted)]">For a listed US locality (not the standard rate): save the GSA fiscal-year per diem workbook&apos;s rates sheet as CSV and read it here, or browse it under Reports → US Per Diem Rates (GSA).</p>}
              {gsaProblem && <p role="alert" className="text-xs text-rose-600">{gsaProblem}</p>}
            </div>
          )}
          <label className="block">
            <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Note (optional)</span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Client visit, receipts in the shared folder" className={field} />
          </label>
          {problem && <p role="alert" className="text-xs text-rose-600">{problem}</p>}
          <div className="flex items-center justify-between">
            <span className="font-semibold">Total {formatCurrency(total, currency)}</span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-3 py-2 text-[var(--muted)] hover:underline">Cancel</button>
              <button type="button" onClick={() => void submit()} disabled={Boolean(problem) || saving}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50">{saving ? 'Submitting…' : 'Submit for approval'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
