import type { AlgoResultRow } from './types';
import { AlgorithmDefinition, AlgoResult } from './types';
import { formatCurrency } from '../../lib/utils';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { convertMinorUnits } from '../../lib/currencyMinorUnits';

export const COMPLIANCE_1099_ALGO: AlgorithmDefinition = {
  id: '1099-totals',
  name: '1099-NEC Contractor Totals',
  domain: 'planning', // This maps to "Tax time"
  tags: ['Compliance', 'Tax', 'Reporting'],
  description: 'Calculates total payments to 1099-eligible vendors within a calendar year, filtering by IRS reporting thresholds.',
  requires: ['transactions', 'bills'],
  inputs: [
    {
      kind: 'select',
      key: 'year',
      label: 'Tax Year',
      options: [
        { value: '2027', label: '2027' },
        { value: '2026', label: '2026' },
        { value: '2025', label: '2025' },
        { value: '2024', label: '2024' }
      ],
      defaultValue: '2026'
    },
    {
      kind: 'number',
      key: 'threshold',
      label: 'Reporting Threshold ($)',
      min: 0,
      max: 5000,
      step: 100,
      defaultValue: 600
    }
  ],
  compute: (ctx, inputs: { "year": string; "threshold": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounting } = ctx;
    const vendors = ctx.entities?.vendors || [];
    const bills = ctx.entities?.bills || [];
    
    const year = inputs['year'] || '2026';
    const thresholdCents = (inputs['threshold'] ?? 600) * 100;
    const baseCurrency = ctx.reportingCurrency || 'USD';

    // Filter to 1099 vendors
    const eligibleVendors = vendors.filter((v) => v.is1099);

    if (eligibleVendors.length === 0) {
      return {
        metrics: [],
        charts: [],
        insights: ["No vendors are marked as 'is1099' in this workspace."],
        rows: []
      };
    }

    const rows: AlgoResultRow[] = [];
    const sourceTransactionIds = new Set<string>();
    let totalEligiblePayments = 0;
    let qualifyingVendorCount = 0;

    eligibleVendors.forEach((vendor) => {
      let paidCents = 0;

      // 1. Find all paid bills for this vendor paid in the target year (cash basis)
      bills.forEach((bill) => {
        if (bill.vendorId === vendor.id && (bill.status === 'paid' || bill.status === 'partially_paid')) {
          // Check actual payment date (cash basis)
          const paymentDateStr = bill.paidAt || bill.paymentDate || bill.paidDate || bill.date || '';
          if (paymentDateStr.startsWith(year)) {
            // what was actually paid (a part-paid bill counts its payments, not its total)
            paidCents += convertMinorUnits(bill.amountPaidCents ?? (bill.status === 'paid' ? bill.amountCents : 0) ?? 0, bill.exchangeRate && bill.exchangeRate > 0 ? bill.exchangeRate : 1, bill.currency, baseCurrency);
          }
        }
      });
      
      // 2. Also find direct cash expense transactions paid to vendor (not mapped to a bill)
      transactions.forEach(tx => {
        if (!isPostable(tx) || !tx.date.startsWith(year)) return;
        
        const isVendorMatch = (tx as typeof tx & { vendorId?: string }).vendorId === vendor.id ||
          (tx.payee && tx.payee.toLowerCase().includes(vendor.name.toLowerCase())) ||
          (tx.description && tx.description.toLowerCase().includes(vendor.name.toLowerCase()));

        if (isVendorMatch) {
          // Check if tx is cash-out to expense without a bill
          const isCashOut = tx.lines?.some(e => lineAmount(e, tx) < 0);
          const hasExpense = tx.lines?.some(e => accounting.isExpense(e.accountId) || accounting.isCOGS(e.accountId));

          if (isCashOut && hasExpense) {
            // Avoid double counting if transaction was generated from a bill
            const isBillTx = (tx as typeof tx & { billId?: string }).billId || (tx as typeof tx & { source?: string }).source === 'bill';
            if (!isBillTx) {
              const expCents = tx.lines
                .filter(l => (l.amountCents || 0) > 0)
                .reduce((s, l) => s + lineAmount(l, tx), 0);
              paidCents += expCents;
              sourceTransactionIds.add(tx.id);
            }
          }
        }
      });

      if (paidCents >= thresholdCents) {
        qualifyingVendorCount++;
        totalEligiblePayments += paidCents;
        rows.push({
          id: vendor.id,
          vendor: vendor.name,
          email: vendor.email || '-',
          amount: formatCurrency(paidCents, baseCurrency)
        });
      }
    });

    return {
      metrics: [
        { label: 'Qualifying Vendors', value: qualifyingVendorCount, color: 'text-indigo-400' },
        { label: 'Total 1099-NEC Payments', value: formatCurrency(totalEligiblePayments, baseCurrency), color: 'text-emerald-400' }
      ],
      charts: [],
      insights: [
        `Found ${qualifyingVendorCount} vendors exceeding the ${formatCurrency(thresholdCents, baseCurrency)} threshold for tax year ${year}.`,
        'Ensure you have valid W-9s on file for these vendors prior to filing 1099-NEC forms.'
      ],
      rows,
      sourceTransactionIds: Array.from(sourceTransactionIds)
    };
  }
};
