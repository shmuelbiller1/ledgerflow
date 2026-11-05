import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, RotateCcw } from 'lucide-react';
import { calendarDateISO, getLocalDateISO, monthBoundsISO, parseLocalDate } from '../../lib/utils';

export interface MonthNavigatorProps {
  currentDate?: Date | string;
  onMonthChange: (range: { start: string; end: string; date: Date }) => void;
  className?: string;
}

export const MonthNavigator: React.FC<MonthNavigatorProps> = ({
  currentDate,
  onMonthChange,
  className = '',
}) => {
  const activeDate = useMemo(() => {
    if (!currentDate) return new Date();
    return typeof currentDate === 'string' ? parseLocalDate(currentDate) : currentDate;
  }, [currentDate]);

  const monthLabel = useMemo(() => {
    return activeDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [activeDate]);

  const stepMonth = (offset: number) => {
    const nextDate = new Date(activeDate.getFullYear(), activeDate.getMonth() + offset, 1);
    const { start, end } = monthBoundsISO(calendarDateISO(nextDate));
    onMonthChange({ start, end, date: nextDate });
  };

  const resetToCurrentMonth = () => {
    // this month in the workspace, not on the device (L-80)
    const today = getLocalDateISO();
    const { start, end } = monthBoundsISO(today);
    onMonthChange({ start, end, date: parseLocalDate(today) });
  };

  return (
    <div 
      id="month-navigator"
      className={`inline-flex items-center gap-1.5 bg-[var(--surface-sunken)] border border-[var(--border)] rounded-lg p-1 text-xs font-medium ${className}`}
    >
      <button
        onClick={() => stepMonth(-1)}
        id="btn-month-nav-prev"
        aria-label="Previous month"
        className="min-h-11 min-w-11 p-1 hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded transition"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-1.5 px-2 font-semibold text-[var(--text)] select-none">
        <Calendar className="w-3.5 h-3.5 text-[var(--accent)]" />
        <span>{monthLabel}</span>
      </div>

      <button
        onClick={() => stepMonth(1)}
        id="btn-month-nav-next"
        aria-label="Next month"
        className="min-h-11 min-w-11 p-1 hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded transition"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <button
        onClick={resetToCurrentMonth}
        id="btn-month-nav-reset"
        title="Reset to current month"
        aria-label="Current month"
        className="min-h-11 min-w-11 p-1 hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded transition ml-0.5"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default MonthNavigator;
