import React, { useEffect, useState } from 'react';
import {
  PRINT_PAPER_SIZES,
  choosePrintOrientation,
  isPrintPaper,
  printLayoutSummary,
  printPageRule,
  readPrintPaper,
  savePrintPaper,
  type PrintPaper,
} from '../../lib/printLayout';
import { useReportText } from './useReportText';

/**
 * A-218: the paper control beside Print / PDF on the Reports page.
 *
 * It only says which sheet the printed P&L, balance sheet or trial balance should use. The `@page`
 * rule lives in a style element while the screen is open, so the browser's print dialog (and
 * "Save as PDF") starts on the chosen sheet; the screen stays otherwise unchanged and nothing is
 * saved to the books.
 */
export function PrintLayoutControl({
  /** Columns in the visible report table; more than a portrait sheet holds turns the sheet. */
  columnCount = 0,
  onPaperChange,
}: {
  columnCount?: number;
  onPaperChange?: (paper: PrintPaper) => void;
}) {
  const reportText = useReportText();
  const [paper, setPaper] = useState<PrintPaper>(() => readPrintPaper());
  // A stacked table (name + this period + last period + change + %) still prints upright.
  const orientation = choosePrintOrientation(columnCount);
  const rule = printPageRule(paper, orientation);

  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-print-page-rule', '');
    style.textContent = rule;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [rule]);

  return (
    <div
      data-print-hide
      className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]"
      data-testid="print-layout-control"
    >
      <label htmlFor="print-paper-size" className="font-medium">
        {reportText('r.print-on', 'Print on')}
      </label>
      <select
        id="print-paper-size"
        value={paper}
        aria-describedby="print-paper-hint"
        aria-label={reportText('r.paper-size-for-printing', 'Paper size for printing')}
        onChange={e => {
          const next = isPrintPaper(e.target.value) ? e.target.value : 'a4';
          setPaper(savePrintPaper(next));
          onPaperChange?.(next);
        }}
        className="min-h-11 px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--brass-line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer"
      >
        {PRINT_PAPER_SIZES.map(size => (
          <option key={size.value} value={size.value}>
            {size.label}
          </option>
        ))}
      </select>
      <span id="print-paper-hint" data-testid="print-layout-summary" className="tabular-nums">
        {printLayoutSummary(paper, orientation)}
        {orientation === 'landscape' ? ` ${reportText('r.wide-table-turned-so-no-column-is-cut', '— wide table turned so no column is cut')}` : ''}
      </span>
    </div>
  );
}

export default PrintLayoutControl;
