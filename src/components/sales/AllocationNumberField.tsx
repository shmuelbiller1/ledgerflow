import React, { useId } from 'react';
import { allocationNumberProblem, allocationThresholdCents, needsAllocationNumber } from '../../lib/tax/ilAllocation';
import { formatCurrency } from '../../lib/utils';

/**
 * On an Israeli invoice (PLAN IL-6): when it needs an allocation number (a business buyer, above the
 * threshold before VAT), the field for it, typed from the Tax Authority's service until LedgerFlow
 * fetches it itself. Saved in the invoice's metadata and printed on the PDF.
 */
export default function AllocationNumberField({ customer, date, netCents, taxCents, currency, exchangeRate, value, onChange }: {
  customer?: { metadata?: unknown } | null;
  date: string;
  netCents: number;
  taxCents: number;
  currency: string;
  exchangeRate?: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const buyerVatNumber = (customer?.metadata as { vatNumber?: string } | undefined)?.vatNumber;
  if (!needsAllocationNumber({ date, netCents, taxCents, currency, exchangeRate, buyerVatNumber }) && !value) return null;
  const problem = value ? allocationNumberProblem(value) : null;
  return (
    <div className="space-y-1 text-xs">
      <label htmlFor={id} className="font-semibold text-[var(--text)]">Allocation number (מספר הקצאה)</label>
      <input id={id} type="text" inputMode="numeric" maxLength={9} value={value} onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        className="w-40 ms-2 px-2 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-md font-mono" />
      <p role="status" className={problem ? 'text-amber-600' : 'text-[var(--muted)]'}>
        {problem || `Needed: a business buyer and more than ${formatCurrency(allocationThresholdCents(date) || 0, 'ILS')} before VAT. Without it the buyer cannot deduct the VAT.`}
      </p>
    </div>
  );
}
