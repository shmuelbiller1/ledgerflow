import { Transaction, ChartAccount } from '../../types';
import { AlgorithmDefinition } from './types';
import { isPostable, lineAmount, isRevenueAccount, isExpenseAccount } from '../txFilters';
import { workspaceYearMonth } from '../utils';

// Takes a number (e.g. net profit) and the transactions that make it up, and generates a natural sentence.
export function explainNetProfit(transactions: readonly Transaction[], month: string, accounts?: readonly ChartAccount[]) {
    let revenue = 0;
    let expenses = 0;
    const expenseMap = new Map<string, number>();
    const revenueMap = new Map<string, number>();
    const accountMap = accounts ? new Map(accounts.map(a => [a.id, a])) : undefined;

    transactions.forEach(t => {
        if (!isPostable(t)) return;
        if (!t.date.startsWith(month)) return; // Filter by month (YYYY-MM)

        const payee = t.payee || t.description || 'General Ledger';
        let txRev = 0;
        let txExp = 0;

        if (Array.isArray(t.lines) && t.lines.length > 0) {
          t.lines.forEach(l => {
            const acc = accountMap?.get(l.accountId);
            const amt = lineAmount(l, t);
            if (acc) {
              if (isRevenueAccount(acc) && amt < 0) {
                txRev += Math.abs(amt);
              } else if (isExpenseAccount(acc) && amt > 0) {
                txExp += amt;
              }
            } else {
              if (t.type === 'income') {
                if (amt < 0) txRev += Math.abs(amt);
              } else if (t.type === 'expense') {
                if (amt > 0) txExp += amt;
              }
            }
          });
        } else {
          const amt = Math.abs(t.totalAmountCents || 0);
          if (t.type === 'income') {
            txRev += amt;
          } else if (t.type === 'expense') {
            txExp += amt;
          }
        }

        if (txRev > 0) {
          revenue += txRev;
          revenueMap.set(payee, (revenueMap.get(payee) || 0) + txRev);
        }
        if (txExp > 0) {
          expenses += txExp;
          expenseMap.set(payee, (expenseMap.get(payee) || 0) + txExp);
        }
    });

    const netProfit = revenue - expenses;

    // Find biggest drivers
    let biggestRev = { payee: '', amt: 0 };
    revenueMap.forEach((amt, payee) => { if (amt > biggestRev.amt) biggestRev = { payee, amt }; });

    let biggestExp = { payee: '', amt: 0 };
    expenseMap.forEach((amt, payee) => { if (amt > biggestExp.amt) biggestExp = { payee, amt }; });

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthIndex = Number.parseInt(month.split('-')[1], 10) - 1;
    const monthStr = monthNames[monthIndex] || month;

    let sentence = `You generated $${(netProfit/100).toFixed(0)} in net earnings for ${monthStr}: $${(revenue/100).toFixed(0)} in operating revenue`;
    if (biggestRev.amt > 0) sentence += ` (top driver: ${biggestRev.payee}, $${(biggestRev.amt/100).toFixed(0)})`;
    
    sentence += ` minus $${(expenses/100).toFixed(0)} in expenses`;
    if (biggestExp.amt > 0) sentence += ` (largest: ${biggestExp.payee}, $${(biggestExp.amt/100).toFixed(0)}).`;

    return { sentence, netProfit, revenue, expenses };
}

export const NUMBER_EXPLAINER_ALGO: AlgorithmDefinition = {
  id: 'number_explainer',
  domain: 'finance',
  name: 'Number Explainer (Data to Text)',
  description: 'Turns raw figures like Net Profit into a plain-English explanatory sentence by analyzing the top drivers.',
  inputs: [
      { key: 'targetMonth', label: 'Month Index (1-12)', min: 1, max: 12, step: 1, defaultValue: workspaceYearMonth().month + 1 }
  ],
  compute: (ctx, inputs: { "targetMonth": number; [key: string]: unknown }) => {
    const { transactions, accounts } = ctx;
    const start = performance.now();
    
    const year = workspaceYearMonth().year;
    const targetMonth = Number(inputs?.targetMonth) || (workspaceYearMonth().month + 1);
    const monthStr = `${year}-${targetMonth.toString().padStart(2, '0')}`;
    
    const result = explainNetProfit(transactions, monthStr, accounts);
    const ms = performance.now() - start;

    return {
      metrics: [
        { label: 'Net Profit', value: `$${(result.netProfit/100).toFixed(2)}` },
        { label: 'Revenue', value: `$${(result.revenue/100).toFixed(2)}` },
        { label: 'Expenses', value: `$${(result.expenses/100).toFixed(2)}` },
        { label: 'Execution Time', value: `${ms.toFixed(2)} ms` }
      ],
      charts: [],
      insights: [
        `Explanation generated: "${result.sentence}"`,
        'By layering a template generator over existing data, we convert the app from "for accountants" to "for anyone".',
        'Adds glossary layers implicitly (e.g. framing money in vs money out).'
      ]
    };
  }
};

