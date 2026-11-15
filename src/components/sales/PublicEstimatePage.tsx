import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import React, { useEffect, useState } from 'react';
import { formatCurrency, formatDate } from '../../lib/utils';
import { MAX_SIGNER_NAME, signatureProblem, type SignState } from '../../lib/estimateSignature';

interface SignView {
  company: string; number: string; date: string; expiryDate: string; customerName: string; currency: string;
  /** `key`: the line's place on the estimate, given by the server */
  lines: Array<{ key: string; description: string; quantity: number; amountCents: number }>;
  taxCents: number; amountCents: number; notes: string; state: SignState; signedBy?: string; signedAt?: string;
}

/**
 * The customer's signing page for an estimate (Y-20), `/e/<token>`, no sign-in: the estimate as sent,
 * then their full name and "I accept"; once signed it says who signed and when. The server checks
 * everything again (src/server/services/estimateSignService.ts).
 */
export default function PublicEstimatePage() {
  const token = window.location.pathname.split('/e/')[1]?.split('/')[0] || '';
  const [view, setView] = useState<SignView | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let live = true;
    runCommand<{ estimate?: SignView }>({ path: `/api/v1/invoices/public/estimate/${encodeURIComponent(token)}` })
      .then(body => body.estimate as SignView)
      .then(v => { if (live) setView(v); })
      .catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)); });
    return () => { live = false; };
  }, [token]);

  const sign = async (e: React.FormEvent) => {
    e.preventDefault();
    const local = signatureProblem({ name, agree });
    if (local) { setProblem(local); return; }
    setBusy(true);
    setProblem('');
    try {
      const body = await runCommand<{ signedBy?: string; signedAt?: string }>({ path: `/api/v1/invoices/public/estimate/${encodeURIComponent(token)}/sign`, method: 'POST', body: { name: name.trim(), agree } });
      setView(v => v && { ...v, state: 'signed', signedBy: body.signedBy, signedAt: body.signedAt });
    } catch (err) {
      setProblem(commandErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <main className="min-h-screen bg-slate-50 p-6 text-slate-900"><p role="alert" className="mx-auto max-w-xl">{error}</p></main>;
  if (!view) return <main className="min-h-screen bg-slate-50 p-6 text-slate-900"><p role="status" className="mx-auto max-w-xl">Loading…</p></main>;
  const money = (cents: number) => formatCurrency(cents, view.currency);
  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8 text-slate-900">
      <article aria-labelledby="estimate-title" className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow-sm space-y-4">
        <header>
          <p className="text-sm text-slate-500"><bdi>{view.company}</bdi></p>
          <h1 id="estimate-title" className="text-2xl font-bold">Estimate {view.number}</h1>
          <p className="text-sm text-slate-600">For <bdi>{view.customerName}</bdi> · {formatDate(view.date)}{view.expiryDate ? ` · valid until ${formatDate(view.expiryDate)}` : ''}</p>
        </header>
        <table className="w-full text-sm">
          <caption className="sr-only">The estimate's lines</caption>
          <thead><tr className="border-b text-left text-xs text-slate-500"><th scope="col" className="py-1">Description</th><th scope="col" className="py-1 text-right">Qty</th><th scope="col" className="py-1 text-right">Amount</th></tr></thead>
          <tbody>
            {view.lines.map(l => (
              <tr key={l.key} className="border-b border-slate-100"><td className="py-1"><bdi>{l.description}</bdi></td><td className="py-1 text-right">{l.quantity}</td><td className="py-1 text-right font-mono">{money(l.amountCents)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            {view.taxCents > 0 && <tr><th scope="row" colSpan={2} className="py-1 text-right font-normal">Tax</th><td className="py-1 text-right font-mono">{money(view.taxCents)}</td></tr>}
            <tr><th scope="row" colSpan={2} className="py-1 text-right">Total</th><td className="py-1 text-right font-mono font-bold">{money(view.amountCents)}</td></tr>
          </tfoot>
        </table>
        {view.notes && <p className="whitespace-pre-line text-sm text-slate-600"><bdi>{view.notes}</bdi></p>}
        {view.state === 'signed' && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Accepted{view.signedBy ? <> and signed by <bdi>{view.signedBy}</bdi></> : ''}{view.signedAt ? ` on ${formatDate(view.signedAt.slice(0, 10))}` : ''}. Thank you.</p>}
        {view.state === 'expired' && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-800">This estimate has expired. Ask <bdi>{view.company}</bdi> for a new one.</p>}
        {view.state === 'closed' && <p role="alert" className="rounded-lg bg-slate-100 p-3">This estimate can no longer be accepted.</p>}
        {view.state === 'open' && (
          <form onSubmit={e => void sign(e)} className="space-y-3 border-t pt-4">
            <h2 className="font-semibold">Accept and sign</h2>
            <label className="flex flex-col gap-1 text-sm">Your full name
              <input value={name} maxLength={MAX_SIGNER_NAME} onChange={e => setName(e.target.value)} autoComplete="name" className="rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-1" />
              <span>I accept this estimate of {money(view.amountCents)} from <bdi>{view.company}</bdi>, and typing my name is my signature.</span>
            </label>
            {problem && <p role="alert" className="text-sm text-rose-700">{problem}</p>}
            <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Signing…' : 'Sign and accept'}</button>
          </form>
        )}
      </article>
    </main>
  );
}
