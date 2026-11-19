import { useId } from 'react';
import { RowTable, type RowTableProps } from '../ui/RowTable';
import ReportTableScroll from './ReportTableScroll';

type Props<T, C> = RowTableProps<T, C> & {
  /** Embedded schedules only need keyboard scrolling. A report with column choices opts in. */
  columnControls?: boolean;
  /** An incomplete read must not gain a CSV or export template just by switching table renderers. */
  allowDisplayedExport?: boolean;
};

export default function ReportSchedule<T, C = never>({ columnControls, allowDisplayedExport = false, caption, ...props }: Props<T, C>) {
  const id = useId();
  const table = <RowTable<T, C> tableClassName="report-schedule comparison-report-table w-full text-start text-sm"
    captionClassName="py-2 text-start font-semibold" rowHeaderClassName="font-medium" {...props}
    caption={<span id={id}>{caption}</span>} />;
  if (columnControls) return <ReportTableScroll allowDisplayedExport={allowDisplayedExport}>{table}</ReportTableScroll>;
  return <div className="max-w-full overflow-x-auto" role="region" aria-labelledby={id} tabIndex={0}>{/* NOSONAR: keyboard scrolling for the named table */}
    {table}
  </div>;
}
