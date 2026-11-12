import React from 'react';
import { useReportDates } from './useReportDates';

/**
 * A-220: the line under a report's title that says which period the figures cover, written the
 * way the reader's locale writes dates (`Oct 1, 2026 – Oct 31, 2026`, `1 Oct 2026 – 31 Oct 2026`,
 * `1 באוק׳ 2026 – 31 באוק׳ 2026`).
 *
 * The reader's own Date Display Format decides the layout (H-8), then the workspace's saved money
 * format decides the locale (so dates and amounts on the same report agree); with neither, a Hebrew
 * interface reads Hebrew dates. The stored dates and every CSV stay ISO — this is the printed and
 * on-screen label only.
 */
export function ReportPeriodHeading({
  title,
  startDate,
  endDate,
  compareStartDate,
  compareEndDate,
  className,
  as = 'p',
  /** A balance-sheet style header: one date, read as "As of Oct 31, 2026". */
  asOf = false,
}: {
  title?: string;
  startDate: string;
  endDate: string;
  compareStartDate?: string;
  compareEndDate?: string;
  className?: string;
  as?: 'p' | 'h2' | 'div' | 'span';
  asOf?: boolean;
}) {
  const reportDates = useReportDates();
  const { locale } = reportDates;
  const period = asOf
    ? `As of ${reportDates.dateText(endDate)}`
    : reportDates.periodText(startDate, endDate);
  const comparison =
    compareStartDate && compareEndDate
      ? asOf
        ? reportDates.dateText(compareEndDate)
        : reportDates.periodText(compareStartDate, compareEndDate)
      : '';

  const Element = as;
  return (
    <Element
      className={className}
      data-testid="report-period-heading"
      data-report-locale={locale}
      lang={locale}
    >
      {title ? `${title}: ` : ''}
      {period}
      {comparison ? ` · compared with ${comparison}` : ''}
    </Element>
  );
}

export default ReportPeriodHeading;
