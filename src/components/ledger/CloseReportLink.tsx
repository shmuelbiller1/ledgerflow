import type { MouseEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import { getFiscalYearBounds } from '../../lib/fiscalCalendar';
import { reportStateToParams } from '../../lib/reportPermalink';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';

/** The close review opens the existing report, not a second calculation of its numbers. */
export default function CloseReportLink({ report, label, endDate }: { report: string; label: string; endDate?: string }) {
  const fiscalStart = useAuthStore(s => s.getCurrentWorkspace()?.fiscalYearStartMonth) || 1;
  const params = endDate ? reportStateToParams({
    report, year: getFiscalYearBounds(endDate, fiscalStart).fiscalYear, timeframe: 'month',
    quarter: 0, month: Number(endDate.slice(5, 7)) - 1, compare: 'none', startDate: `${endDate.slice(0, 7)}-01`, endDate,
  }) : new URLSearchParams({ report });
  const href = `?${params.toString()}#reports`;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(window.history.state, '', href);
    useUIStore.getState().goToPage({ tab: 'reports', sub: report });
    window.dispatchEvent(new Event('ledgerflow:report-link'));
  };
  return <a href={href} onClick={open} className="min-h-11 inline-flex items-center gap-1 text-sm font-semibold text-[var(--brass)] underline">
    {label} <ArrowRight className="w-3 h-3" aria-hidden="true" />
  </a>;
}
