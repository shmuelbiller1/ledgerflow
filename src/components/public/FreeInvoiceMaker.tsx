/**
 * EU-I3: a free invoice maker that needs no account (`/make-invoice`). Write an invoice, print it
 * or save it as a PDF, then "Save this and track who paid" opens the sample company with the same
 * invoice in the invoice form. Nothing is sent or saved to a server from this page.
 */
import React, { useId, useState } from 'react';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import {
  FREE_INVOICE_CURRENCIES, freeInvoiceProblem, freeInvoiceTotals, lineAmount, parseRate, stashFreeInvoice,
  type FreeInvoice,
} from '../../lib/freeInvoice';
import { BRAND_NAME } from '../../config/brand';

interface LineDraft { id: string; description: string; quantity: string; rate: string }

const emptyLine = (): LineDraft => ({ id: crypto.randomUUID(), description: '', quantity: '1', rate: '' });

export default function FreeInvoiceMaker() {
  const ids = { from: useId(), to: useId(), number: useId(), date: useId(), due: useId(), currency: useId(), tax: useId() };
  const today = getLocalDateISO();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [number, setNumber] = useState('1');
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [tax, setTax] = useState('0');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState('');

  const parsed = lines.map(l => ({ description: l.description, quantity: Number(l.quantity), rateCents: parseRate(l.rate, currency) }));
  const badRate = parsed.findIndex(l => l.rateCents === null);
  const invoice: FreeInvoice = {
    from, to, number, date, dueDate, currency, taxRate: Number(tax) || 0,
    lines: parsed.map(l => ({ ...l, rateCents: l.rateCents ?? 0 })),
  };
  const totals = freeInvoiceTotals(invoice);
  const problem = badRate >= 0 ? `Line ${badRate + 1}: type the price as a number, for example 120.50.` : freeInvoiceProblem(invoice);
  const money = (cents: number) => formatCurrency(cents, currency);
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const saveAndTrack = () => {
    if (problem) { setError(problem); return; }
    let carried: boolean;
    try {
      carried = stashFreeInvoice(window.localStorage, invoice);
      window.localStorage.setItem('isGuest', 'true');
      window.localStorage.setItem('has_seen_onboarding', 'true');
    } catch {
      carried = false;
    }
    if (!carried) { setError('This browser blocked saving the draft. Print it instead, or allow site storage and try again.'); return; }
    window.location.assign('/#sales');
  };

  return (
    <main className="min-h-screen bg-[var(--ink)] text-[var(--text)] px-4 py-6 sm:py-10">
      {/* #main-content: the print rules keep only this child of <main> on paper */}
      <div id="main-content" className="mx-auto max-w-3xl space-y-6">
        <header data-print-hide className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold">Make an invoice — free, no account</h1>
          <p className="text-sm text-[var(--muted)]">Fill it in, print it or save it as a PDF. Nothing is sent anywhere from this page.</p>
        </header>

        <section aria-label="Invoice" data-print-root className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <label htmlFor={ids.from} className="text-sm font-medium">From (your business)</label>
              <textarea id={ids.from} rows={3} value={from} onChange={e => setFrom(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2" />
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor={ids.to} className="text-sm font-medium">Bill to</label>
              <textarea id={ids.to} rows={3} value={to} onChange={e => setTo(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2" />
            </div>
          </div>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
            <div className="min-w-0 space-y-1">
              <label htmlFor={ids.number} className="text-sm font-medium">Invoice number</label>
              <input id={ids.number} value={number} onChange={e => setNumber(e.target.value)} className="w-full min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor={ids.date} className="text-sm font-medium">Date</label>
              <input id={ids.date} type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor={ids.due} className="text-sm font-medium">Due</label>
              <input id={ids.due} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor={ids.currency} className="text-sm font-medium">Currency</label>
              <select id={ids.currency} value={currency} onChange={e => setCurrency(e.target.value)} className="w-full min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2">
                {FREE_INVOICE_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* an editable form of lines, not a list: a CSS grid, one group per line */}
          <div className="space-y-2 text-sm" role="group" aria-label="Invoice lines">
            <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_3rem_4.5rem_4.5rem_2.75rem] sm:grid-cols-[1fr_5rem_8rem_8rem_2.75rem] gap-2 text-[var(--muted)]">
              <span>Description</span><span>Qty</span><span>Price</span><span className="text-right">Amount</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={l.id} role="group" aria-label={`Line ${i + 1}`} className="grid grid-cols-[minmax(0,1fr)_3rem_4.5rem_4.5rem_2.75rem] sm:grid-cols-[1fr_5rem_8rem_8rem_2.75rem] items-center gap-2 border-t border-[var(--line)] pt-2">
                <input aria-label={`Line ${i + 1} description`} value={l.description} onChange={e => setLine(i, { description: e.target.value })} className="min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
                <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} className="min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
                <input aria-label={`Line ${i + 1} price`} inputMode="decimal" placeholder="0.00" value={l.rate} onChange={e => setLine(i, { rate: e.target.value })} className="min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
                <span className="text-right font-mono tabular-nums break-all">{money(lineAmount(invoice.lines[i]))}</span>
                <button type="button" data-print-hide aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="min-h-11 min-w-11 flex items-center justify-center disabled:opacity-30">
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" data-print-hide onClick={() => setLines(ls => [...ls, emptyLine()])} className="inline-flex min-h-11 items-center gap-2 text-sm underline">
            <Plus aria-hidden="true" size={16} /> Add a line
          </button>

          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span className="font-mono tabular-nums">{money(totals.subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={ids.tax}>Tax %</label>
              <input id={ids.tax} inputMode="decimal" value={tax} onChange={e => setTax(e.target.value)} className="w-20 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-right" />
              <span className="font-mono tabular-nums">{money(totals.tax)}</span>
            </div>
            <div className="flex justify-between border-t border-[var(--line)] pt-1 font-semibold" data-testid="free-invoice-total"><span>Total</span><span className="font-mono tabular-nums">{money(totals.total)}</span></div>
          </div>
        </section>

        {(error || problem) && <p role={error ? 'alert' : undefined} data-print-hide className="text-sm text-[var(--muted)]">{error || problem}</p>}

        <div data-print-hide className="flex flex-col sm:flex-row gap-3">
          <button type="button" disabled={Boolean(problem)} onClick={() => window.print()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 font-semibold disabled:opacity-50">
            <Printer aria-hidden="true" size={18} /> Print or save as PDF
          </button>
          <button type="button" onClick={saveAndTrack} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--text)] px-4 font-semibold text-[var(--surface)]">
            Save this and track who paid
          </button>
        </div>
        <p data-print-hide className="text-xs text-[var(--muted)]">Saving opens {BRAND_NAME}&apos;s sample company with this invoice ready as a draft. Sign up from there to keep it in your own books.</p>
      </div>
    </main>
  );
}
