/**
 * The Profit & Loss screen's spreadsheet export (moved out of ProfitAndLossView.tsx): each income and
 * expense account, its total, and net income; with the prior period and the change when comparing.
 */
import { minorToMajor } from './currencyMinorUnits';
import { currentReportExportContext, exportToExcel as exportToExcelHelper } from './excelExport';

interface PLAccount { name: string; code?: string; balance: number; parentId?: string }
interface PLSection { total: number; accounts: Record<string, PLAccount> }
interface PLFigures { income: PLSection; expense: PLSection; netIncome: number }

export async function exportPlToExcel(input: {
  data: PLFigures | null; prevData: PLFigures | null; isComparative: boolean;
  /** R-2: the comparison column's name ('Budget'); 'Prior Amount' when not given */
  compareLabel?: string;
  labels: { title: string; revenueStreams: string; expenseClusters: string; netLabel: string; exportName: string };
  start: string; end: string; cash: boolean;
}) {
  const { data, prevData, labels, start, end, cash } = input;
  if (!data) return;
  const isComp = input.isComparative;

  const columns = [
    { header: 'Account', key: 'account', width: 30 },
    { header: 'Amount', key: 'amount', width: 20 },
    { header: isComp ? (input.compareLabel || 'Prior Amount') : '', key: 'priorAmount', width: 20 },
    { header: isComp ? 'Variance %' : '', key: 'variance', width: 20 },
  ];

  const reportContext = currentReportExportContext(
    labels.title,
    `${start} to ${end}${cash ? ' (cash basis)' : ''}`,
    cash ? 'Cash' : 'Accrual',
  );
  const toMajor = (cents: number | undefined | null) => minorToMajor(cents || 0, reportContext.currency);

  const rows: (Record<string, string | number | null> | string[])[] = [];

  rows.push([labels.revenueStreams.toUpperCase()]);
  Object.entries(data.income?.accounts || {}).forEach(([id, acc]: [string, PLAccount]) => {
    const pBal = prevData?.income?.accounts?.[id]?.balance || 0;
    const varPct = pBal !== 0 ? (((acc.balance || 0) - pBal) / Math.abs(pBal)) * 100 : 0;
    rows.push({
      account: acc.name,
      amount: toMajor(acc.balance),
      priorAmount: isComp ? toMajor(pBal) : null,
      variance: isComp && pBal !== 0 ? varPct.toFixed(2) + '%' : null
    });
  });
  rows.push({
    account: `Total ${labels.revenueStreams}`,
    amount: toMajor(data.income?.total),
    priorAmount: isComp ? toMajor(prevData?.income?.total) : null
  });

  rows.push([]);
  rows.push([labels.expenseClusters.toUpperCase()]);
  Object.entries(data.expense?.accounts || {}).forEach(([id, acc]: [string, PLAccount]) => {
    const pBal = prevData?.expense?.accounts?.[id]?.balance || 0;
    const varPct = pBal !== 0 ? (((acc.balance || 0) - pBal) / Math.abs(pBal)) * 100 : 0;
    rows.push({
      account: acc.name,
      amount: toMajor(acc.balance),
      priorAmount: isComp ? toMajor(pBal) : null,
      variance: isComp && pBal !== 0 ? varPct.toFixed(2) + '%' : null
    });
  });
  rows.push({
    account: `Total ${labels.expenseClusters}`,
    amount: toMajor(data.expense?.total),
    priorAmount: isComp ? toMajor(prevData?.expense?.total) : null
  });

  rows.push([]);
  rows.push({
    account: labels.netLabel.toUpperCase(),
    amount: toMajor(data.netIncome),
    priorAmount: isComp ? toMajor(prevData?.netIncome) : null
  });

  await exportToExcelHelper(columns, rows, {
    sheetName: 'Statement',
    fileName: `${labels.exportName}_${start}_${end}.xlsx`,
    reportContext: reportContext
  });
}
