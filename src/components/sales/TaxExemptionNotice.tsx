import React from 'react';
import { exemptionOn } from '../../lib/taxExemption';
import TaxPlaceSuggestion from './TaxPlaceSuggestion';
import AllocationNumberField from './AllocationNumberField';

/**
 * On an invoice (T-05): the customer is tax-exempt, with the certificate's number, and a button to
 * charge no tax while tax is charged; or their certificate ran out, so tax is charged again.
 */
export default function TaxExemptionNotice({ customer, date, charging, onNoTax, lineLabels, currentRate = 0, currentTreatment, salesTreatments, onUseRate, allocation }: {
  customer?: { name?: string; metadata?: unknown } | null;
  date: string;
  /** whether the invoice charges tax now */
  charging: boolean;
  onNoTax: () => void;
  /** PLAN §6: the first line's labels (its entity), what the invoice charges now and how to change it */
  lineLabels?: Record<string, string>;
  currentRate?: number;
  /** CON-3: the current code's treatment and the treatments the workspace has sales codes for */
  currentTreatment?: string;
  salesTreatments?: string[];
  onUseRate?: (rate: number, treatment?: 'zero_rated' | 'exempt') => void;
  /** IL-6: the invoice's figures and its allocation number */
  allocation?: { netCents: number; taxCents: number; currency: string; exchangeRate?: number; value: string; onChange: (value: string) => void };
}) {
  const found = exemptionOn(customer, date);
  const suggestion = <>
    {onUseRate && <TaxPlaceSuggestion customer={customer} date={date} lineLabels={lineLabels} currentRate={currentRate} currentTreatment={currentTreatment} salesTreatments={salesTreatments} exempt={found?.state === 'exempt'} onUseRate={onUseRate} />}
    {allocation && <AllocationNumberField customer={customer} date={date} {...allocation} />}
  </>;
  if (!found) return suggestion;
  const { state, certificate } = found;
  if (state === 'expired') {
    return <><p role="status" className="text-xs text-amber-600">Their tax exemption certificate {certificate.number} ran out on {certificate.expires}: tax is charged until a new one comes in.</p>{suggestion}</>;
  }
  return (
    <><p role="status" className="text-xs text-[var(--muted)]">
      Tax-exempt: certificate {certificate.number}{certificate.expires ? `, good until ${certificate.expires}` : ''}.
      {charging && <> <button type="button" onClick={onNoTax} className="underline font-semibold text-[var(--text)]">Charge no tax</button></>}
    </p>{suggestion}</>
  );
}
