import { calculateAmountDue } from '../documentMath';
import { calculateLateFee } from '../paymentTerms';
import { toBaseCents } from '../../server/reports/partyReports';
import { currencyChartValue, formatCurrency, getLocalDateISO, parseLocalDate } from '../../lib/utils';
import { AlgorithmDefinition, AlgoResult } from './types';
import { resolveAccountRole } from '../accountUtils';
import { isPostable, lineAmount, isOpenInvoice, isOpenBill } from '../../lib/txFilters';

export const WORKING_CAPITAL_AGING_ALGO: AlgorithmDefinition = {
  id: 'ops_2',
  name: 'Working Capital & Invoice Aging',
  domain: 'operations',
  tags: ['Working Capital', 'Receivables', 'Payables', 'Aging', 'Cash Flow'],
  description: 'Analyzes unpaid invoices and bills to identify late payments and assess short-term liquidity bottlenecks based on due dates.',
  inputs: [
    { key: 'lateThresholdDays', label: 'Overdue Warning (Days)', min: 1, max: 120, step: 5, defaultValue: 30 }
  ],
  compute: (ctx, inputs: { "lateThresholdDays": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts } = ctx;
    const baseCurrency = ctx.reportingCurrency || 'USD';
    const money = (cents: number) => formatCurrency(cents, baseCurrency);
    let arPending = 0;
    let apPending = 0;
    let arOverdue = 0;
    let estimatedLateFeesCents = 0;
    const thresholdDays = inputs.lateThresholdDays ?? 30;
    const now = new Date().getTime();
    const todayIso = ctx.asOfDate || getLocalDateISO();
    const chartData = [
       { Bucket: 'Current', AR: 0, AP: 0 },
       { Bucket: '1-30 Days Late', AR: 0, AP: 0 },
       { Bucket: '31-60 Days Late', AR: 0, AP: 0 },
       { Bucket: '60+ Days Late', AR: 0, AP: 0 }
    ];

    let hasProcessedData = false;

    // 1. Process explicit Invoices from context
    if (ctx.entities?.invoices && ctx.entities.invoices.length > 0) {
      ctx.entities.invoices.forEach(inv => {
        if (!isOpenInvoice(inv)) return;
        hasProcessedData = true;
        const dueDateStr = inv.dueDate || inv.date;
        const dueDate = dueDateStr ? parseLocalDate(dueDateStr).getTime() : now;
        const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
        const amount = toBaseCents(calculateAmountDue(inv), inv.exchangeRate, inv.currency, baseCurrency); // still owed, base currency

        arPending += amount;
        if (daysOverdue > thresholdDays) arOverdue += amount;
        if (dueDateStr && amount > 0) {
          estimatedLateFeesCents += calculateLateFee(amount, dueDateStr, todayIso).lateFeeCents;
        }

        if (daysOverdue <= 0) chartData[0].AR += currencyChartValue(amount, baseCurrency);
        else if (daysOverdue <= 30) chartData[1].AR += currencyChartValue(amount, baseCurrency);
        else if (daysOverdue <= 60) chartData[2].AR += currencyChartValue(amount, baseCurrency);
        else chartData[3].AR += currencyChartValue(amount, baseCurrency);
      });
    }

    // 2. Process explicit Bills from context
    if (ctx.entities?.bills && ctx.entities.bills.length > 0) {
      ctx.entities.bills.forEach(bill => {
        if (!isOpenBill(bill)) return;
        hasProcessedData = true;
        const dueDateStr = bill.dueDate || bill.date;
        const dueDate = dueDateStr ? parseLocalDate(dueDateStr).getTime() : now;
        const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
        const amount = toBaseCents(calculateAmountDue(bill), bill.exchangeRate, bill.currency, baseCurrency);

        apPending += amount;

        if (daysOverdue <= 0) chartData[0].AP += currencyChartValue(amount, baseCurrency);
        else if (daysOverdue <= 30) chartData[1].AP += currencyChartValue(amount, baseCurrency);
        else if (daysOverdue <= 60) chartData[2].AP += currencyChartValue(amount, baseCurrency);
        else chartData[3].AP += currencyChartValue(amount, baseCurrency);
      });
    }

    // 3. Fallback: If no explicit invoices or bills in context, analyze transactions array
    if (!hasProcessedData && transactions && transactions.length > 0) {
      const arIncreases: { amount: number, dueDate: number }[] = [];
      const apIncreases: { amount: number, dueDate: number }[] = [];
      let arDecreases = 0;
      let apDecreases = 0;

      transactions.forEach(tx => {
        if (!isPostable(tx)) return;

        const dueDateStr = tx.metadata?.dueDate || tx.date;
        const dueDate = dueDateStr ? parseLocalDate(dueDateStr).getTime() : now;

        tx.lines?.forEach(l => {
          const acc = accounts.find(a => a.id === l.accountId);
          if (acc) {
            const role = resolveAccountRole(acc);
            const amt = lineAmount(l, tx);
            if (role === 'ar') {
              if (amt > 0) {
                arIncreases.push({ amount: amt, dueDate });
              } else {
                arDecreases += Math.abs(amt);
              }
            } else if (role === 'ap') {
              if (amt < 0) {
                apIncreases.push({ amount: Math.abs(amt), dueDate });
              } else {
                apDecreases += Math.abs(amt);
              }
            }
          }
        });
      });

      // Sort oldest first
      arIncreases.sort((a, b) => a.dueDate - b.dueDate);
      apIncreases.sort((a, b) => a.dueDate - b.dueDate);

      // FIFO AR
      arIncreases.forEach(inv => {
        let remaining = inv.amount;
        if (arDecreases >= remaining) {
          arDecreases -= remaining;
          remaining = 0;
        } else if (arDecreases > 0) {
          remaining -= arDecreases;
          arDecreases = 0;
        }

        if (remaining > 0) {
          const daysOverdue = Math.floor((now - inv.dueDate) / (1000 * 60 * 60 * 24));
          arPending += remaining;
          if (daysOverdue > thresholdDays) arOverdue += remaining;

          if (daysOverdue <= 0) chartData[0].AR += currencyChartValue(remaining, baseCurrency);
          else if (daysOverdue <= 30) chartData[1].AR += currencyChartValue(remaining, baseCurrency);
          else if (daysOverdue <= 60) chartData[2].AR += currencyChartValue(remaining, baseCurrency);
          else chartData[3].AR += currencyChartValue(remaining, baseCurrency);
        }
      });

      // FIFO AP
      apIncreases.forEach(bill => {
        let remaining = bill.amount;
        if (apDecreases >= remaining) {
          apDecreases -= remaining;
          remaining = 0;
        } else if (apDecreases > 0) {
          remaining -= apDecreases;
          apDecreases = 0;
        }

        if (remaining > 0) {
          const daysOverdue = Math.floor((now - bill.dueDate) / (1000 * 60 * 60 * 24));
          apPending += remaining;

          if (daysOverdue <= 0) chartData[0].AP += currencyChartValue(remaining, baseCurrency);
          else if (daysOverdue <= 30) chartData[1].AP += currencyChartValue(remaining, baseCurrency);
          else if (daysOverdue <= 60) chartData[2].AP += currencyChartValue(remaining, baseCurrency);
          else chartData[3].AP += currencyChartValue(remaining, baseCurrency);
        }
      });
    }

    if (arPending === 0 && apPending === 0) {
      return {
        metrics: [{ label: 'Status', value: 'No Pending Invoices' }],
        charts: [],
        insights: ['No open customer invoices or supplier bills were found in the system.']
      };
    }

    const netPending = arPending - apPending;

    let arHealth = 'green';
    if (arOverdue > (arPending * 0.3)) arHealth = 'red';
    else if (arOverdue > 0) arHealth = 'orange';

    return {
      metrics: [
        { label: 'Total Pending AR', value: money(arPending) },
        { label: 'Total Pending AP', value: money(apPending) },
        { label: 'Severely Overdue AR', value: money(arOverdue), color: arHealth },
        { label: 'Net Working Capital (Pending)', value: money(netPending), color: netPending >= 0 ? 'green' : 'orange' }
      ],
      charts: [
        {
          config: {
            xKey: 'Bucket',
            yKeys: [
               { key: 'AR', name: `Accounts Receivable (${baseCurrency})`, color: '#3b82f6', type: 'bar' },
               { key: 'AP', name: `Accounts Payable (${baseCurrency})`, color: '#f43f5e', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights: [
        `There is ${money(arPending)} tied up in unpaid customer invoices (AR) and ${money(apPending)} outstanding in supplier bills (AP).`,
        arOverdue > 0 ? `WARNING: ${money(arOverdue)} of Accounts Receivable is significantly overdue (> ${inputs.lateThresholdDays} days past due date). Immediate collection efforts recommended.` : 'Receivables collection is healthy with no severely overdue invoices.',
        ...(estimatedLateFeesCents > 0 ? [`Contractual late-fee benchmark (18% APR + ${money(2500)} flat per overdue invoice): ${money(estimatedLateFeesCents)}.`] : []),
        netPending < 0 ? 'Short-term liquidity crunch: Pending payables exceed pending receivables.' : 'Working capital structure is positive.'
      ]
    };
  }
};
