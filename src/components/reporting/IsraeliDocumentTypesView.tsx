import React, { useMemo, useState } from 'react';
import { classifyIsraeliDocument, israeliDocumentTitle, type IsraeliDocumentEvidence } from '../../lib/tax/israeliDocumentTypes';
import ReportTableScroll from './ReportTableScroll';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const EXAMPLES: Array<{ label: string; evidence: IsraeliDocumentEvidence; expect: string }> = [
  { label: 'Tax invoice (issued)', evidence: { source: 'invoice', lifecycle: 'issued', issuedAs: 'tax-invoice', vatStatus: 'registered' }, expect: 'חשבונית מס' },
  { label: 'Tax invoice + receipt', evidence: { source: 'invoice', lifecycle: 'issued', issuedAs: 'tax-invoice-receipt', vatStatus: 'registered', receiptOnSameDocument: true }, expect: 'חשבונית מס / קבלה' },
  { label: 'Receipt (received payment)', evidence: { source: 'payment', lifecycle: 'issued', direction: 'received', receiptIssued: true }, expect: 'קבלה' },
  { label: 'Credit note (tax invoice)', evidence: { source: 'credit-note', lifecycle: 'issued', credits: 'tax-invoice', vatStatus: 'registered', originalInvoiceReference: 'INV-1001' }, expect: 'חשבונית מס זיכוי' },
  { label: 'Draft — not issued', evidence: { source: 'invoice', lifecycle: 'draft', issuedAs: 'tax-invoice', vatStatus: 'registered' }, expect: 'needs-review' },
  { label: 'Outgoing payment — not a receipt', evidence: { source: 'payment', lifecycle: 'issued', direction: 'made', receiptIssued: false }, expect: 'needs-review' },
];

/**
 * C-117: Israeli document types — read-only classification for explicitly issued documents.
 * Never infers issuance, numbering, allocation or tax return acceptance.
 */
export default function IsraeliDocumentTypesView() {
  const [source, setSource] = useState<IsraeliDocumentEvidence['source']>('invoice');
  const [lifecycle, setLifecycle] = useState<'draft' | 'issued' | 'void'>('issued');
  const [issuedAs, setIssuedAs] = useState<'tax-invoice' | 'tax-invoice-receipt' | 'transaction-invoice' | 'unknown'>('tax-invoice');
  const [vatStatus, setVatStatus] = useState<'registered' | 'exempt' | 'unknown'>('registered');
  const [receiptSame, setReceiptSame] = useState<'true' | 'false' | ''>('false');
  const [direction, setDirection] = useState<'received' | 'made'>('received');
  const [receiptIssued, setReceiptIssued] = useState<'true' | 'false'>('true');
  const [credits, setCredits] = useState<'tax-invoice' | 'other' | 'unknown'>('tax-invoice');
  const [originalRef, setOriginalRef] = useState('INV-1001');

  const evidence: IsraeliDocumentEvidence | null = useMemo(() => {
    try {
      if (source === 'invoice') {
        const ev: IsraeliDocumentEvidence = { source: 'invoice', lifecycle, issuedAs, vatStatus };
        if (receiptSame) (ev as Extract<IsraeliDocumentEvidence, { source: 'invoice' }>).receiptOnSameDocument = receiptSame === 'true';
        return ev;
      }
      if (source === 'payment') return { source: 'payment', lifecycle, direction, receiptIssued: receiptIssued === 'true' } as IsraeliDocumentEvidence;
      return { source: 'credit-note', lifecycle, credits, vatStatus, originalInvoiceReference: originalRef } as IsraeliDocumentEvidence;
    } catch { return null; }
  }, [source, lifecycle, issuedAs, vatStatus, receiptSame, direction, receiptIssued, credits, originalRef]);

  const result = useMemo(() => evidence ? classifyIsraeliDocument(evidence) : null, [evidence]);

  return <section aria-label="Israeli document types" className="p-4 space-y-4 min-w-0">
    <div className="space-y-1">
      <h2>Israeli document types (מסמכי מס בישראל)</h2>
      <p className="text-sm text-[var(--muted)]">
        Pure classification for <b>explicitly issued</b> Israeli sales documents only: tax invoice (<span dir="rtl">חשבונית מס</span>), receipt (<span dir="rtl">קבלה</span>), tax invoice / receipt, and credit note (<span dir="rtl">חשבונית זיכוי</span>). It distinguishes the kind <i>actually issued</i> from accounting state — being paid does not turn a tax invoice into a combined document. No type here proves a number was legally issued, allocated by the Tax Authority, or accepted for a filing. Drafts and voids are never a classified document; they are shown as needs-review.
      </p>
      <p className="text-xs text-[var(--muted)]">Source: Israel Tax Authority uniform file / software-house document types (gov.il BlobFolder). This screen is <b>calculation status only</b>; issuance, numbering, VAT posting and PCN874 acceptance are separate. Titles: {['tax-invoice', 'receipt', 'tax-invoice-receipt', 'credit'].map(k => `${k}: ${israeliDocumentTitle(k as never, 'en')} / ${israeliDocumentTitle(k as never, 'he')}`).join(' · ')}.</p>
    </div>

    <div className="rounded border border-[var(--line)] p-3 space-y-3 bg-[var(--surface)]">
      <h3 className="font-semibold">Try classification</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="block text-sm">Source
          <select className={field + ' w-full mt-1'} value={source} onChange={e => setSource(e.target.value as typeof source)}>
            <option value="invoice">invoice</option>
            <option value="payment">payment</option>
            <option value="credit-note">credit-note</option>
          </select>
        </label>
        <label className="block text-sm">Lifecycle
          <select className={field + ' w-full mt-1'} value={lifecycle} onChange={e => setLifecycle(e.target.value as typeof lifecycle)}>
            <option value="draft">draft</option>
            <option value="issued">issued</option>
            <option value="void">void</option>
          </select>
        </label>
        {source === 'invoice' && <>
          <label className="block text-sm">Issued as
            <select className={field + ' w-full mt-1'} value={issuedAs} onChange={e => setIssuedAs(e.target.value as typeof issuedAs)}>
              <option value="tax-invoice">tax-invoice</option>
              <option value="tax-invoice-receipt">tax-invoice-receipt</option>
              <option value="transaction-invoice">transaction-invoice</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label className="block text-sm">VAT status
            <select className={field + ' w-full mt-1'} value={vatStatus} onChange={e => setVatStatus(e.target.value as typeof vatStatus)}>
              <option value="registered">registered</option>
              <option value="exempt">exempt</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label className="block text-sm">Receipt on same document?
            <select className={field + ' w-full mt-1'} value={receiptSame} onChange={e => setReceiptSame(e.target.value as never)}>
              <option value="">not set</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        </>}
        {source === 'payment' && <>
          <label className="block text-sm">Direction
            <select className={field + ' w-full mt-1'} value={direction} onChange={e => setDirection(e.target.value as typeof direction)}>
              <option value="received">received</option>
              <option value="made">made</option>
            </select>
          </label>
          <label className="block text-sm">Receipt issued?
            <select className={field + ' w-full mt-1'} value={receiptIssued} onChange={e => setReceiptIssued(e.target.value as never)}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        </>}
        {source === 'credit-note' && <>
          <label className="block text-sm">Credits
            <select className={field + ' w-full mt-1'} value={credits} onChange={e => setCredits(e.target.value as typeof credits)}>
              <option value="tax-invoice">tax-invoice</option>
              <option value="other">other</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label className="block text-sm">VAT status
            <select className={field + ' w-full mt-1'} value={vatStatus} onChange={e => setVatStatus(e.target.value as typeof vatStatus)}>
              <option value="registered">registered</option>
              <option value="exempt">exempt</option>
              <option value="unknown">unknown</option>
            </select>
          </label>
          <label className="block text-sm">Original invoice ref
            <input className={field + ' w-full mt-1'} value={originalRef} onChange={e => setOriginalRef(e.target.value)} />
          </label>
        </>}
      </div>
      {result && <div className="text-sm p-2 rounded border border-[var(--line)] bg-[var(--panel)]">
        {result.status === 'classified'
          ? <><b>Classified:</b> <span dir={result.titleHe ? 'rtl' : 'ltr'}><bdi>{result.titleHe}</bdi> / <bdi>{result.titleEn}</bdi></span> (<code>{result.kind}</code>)</>
          : <><b>{result.status === 'not-issued' ? 'Not issued:' : 'Needs review:'}</b> {result.reason}</>}
      </div>}
    </div>

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-[var(--text)] pb-1">Examples — the four supported types and two refusal cases</caption>
        <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">{['Example', 'Evidence summary', 'Result'].map(h => <th key={h} scope="col" className="text-left py-1 px-2">{h}</th>)}</tr></thead>
        <tbody>
          {EXAMPLES.map(row => {
            const r = classifyIsraeliDocument(row.evidence);
            return <tr key={row.label} className="border-b border-[var(--line)]/50"><th scope="row" className="text-left font-normal py-1 px-2">{row.label}</th><td className="py-1 px-2 text-xs"><code className="break-all">{JSON.stringify(row.evidence)}</code></td><td className="py-1 px-2">{r.status === 'classified' ? <span><bdi>{r.titleHe}</bdi> / <bdi>{r.titleEn}</bdi></span> : r.reason}</td></tr>;
          })}
        </tbody>
      </table>
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">Capability: <b>Internal, test or demo only</b> — titles only; no authority-approved numbering, allocation or filing code. Four kinds supported; transaction-invoices and unknown issuance states are refused with a reason.</p>
  </section>;
}
