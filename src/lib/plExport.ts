/**
 * The Profit & Loss screen's spreadsheet export (moved out of ProfitAndLossView.tsx): each income and
 * expense account, its total, and net income; with the prior period and the change when comparing.
 */
import { currentReportExportContext, exportToExcel as exportToExcelHelper, reportTitleRows } from './excelExport';

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

  const titleRows = reportTitleRows(currentReportExportContext(
    labels.title,
    `${start} to ${end}${cash ? ' (cash basis)' : ''}`,
    cash ? 'Cash' : 'Accrual',
  ));

  const rows: (Record<string, string | number | null> | string[])[] = [];

  rows.push([labels.revenueStreams.toUpperCase()]);
  Object.entries(data.income?.accounts || {}).forEach(([id, acc]: [string, PLAccount]) => {
    const pBal = (prevData?.income?.accounts as Record<string, PLAccount>)[id]?.balance || 0;
    const varPct = pBal !== 0 ? (((acc.balance || 0) - pBal) / Math.abs(pBal)) * 100 : 0;
    rows.push({
      account: acc.name,
      amount: (acc.balance || 0) / 100,
      priorAmount: isComp ? pBal / 100 : null,
      variance: isComp && pBal !== 0 ? varPct.toFixed(2) + '%' : null
    });
  });
  rows.push({
    account: `Total ${labels.revenueStreams}`,
    amount: (data.income?.total || 0) / 100,
    priorAmount: isComp ? (prevData?.income?.total || 0) / 100 : null
  });

  rows.push([]);
  rows.push([labels.expenseClusters.toUpperCase()]);
  Object.entries(data.expense?.accounts || {}).forEach(([id, acc]: [string, PLAccount]) => {
    const pBal = (prevData?.expense?.accounts as Record<string, PLAccount>)[id]?.balance || 0;
    const varPct = pBal !== 0 ? (((acc.balance || 0) - pBal) / Math.abs(pBal)) * 100 : 0;
    rows.push({
      account: acc.name,
      amount: (acc.balance || 0) / 100,
      priorAmount: isComp ? pBal / 100 : null,
      variance: isComp && pBal !== 0 ? varPct.toFixed(2) + '%' : null
    });
  });
  rows.push({
    account: `Total ${labels.expenseClusters}`,
    amount: (data.expense?.total || 0) / 100,
    priorAmount: isComp ? (prevData?.expense?.total || 0) / 100 : null
  });

  rows.push([]);
  rows.push({
    account: labels.netLabel.toUpperCase(),
    amount: (data.netIncome || 0) / 100,
    priorAmount: isComp ? (prevData?.netIncome || 0) / 100 : null
  });

  await exportToExcelHelper(columns, rows, {
    sheetName: 'Statement',
    fileName: `${labels.exportName}_${start}_${end}.xlsx`,
    titleRows
  });
}
