/**
 * H-8 (AI #10): the reader's date format and locale, as one hook, for any header line that writes a
 * report's dates.
 *
 * Same rules as `ReportPeriodHeading`: the reader's Date Display Format first (Preferences),
 * then the workspace's saved locale, then the interface language. Kept in its own file so the
 * component file exports only a component (the fast-refresh rule); every report header uses this one
 * resolution, so a report and the rows beneath it can never disagree about how a day is written.
 */
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { reportDateTextFor, reportLocaleFor, reportPeriodTextIn } from '../../lib/reportLocale';

export interface ReportDates {
  /** The locale the dates and the header's `lang` follow. */
  locale: string;
  /** The reader's chosen layout, or null when the locale decides. */
  dateFormat: string | null;
  /** One calendar day: `2026-10-01`, `10/01/2026`, `Oct 1, 2026`… */
  dateText: (isoDate: string | undefined | null) => string;
  /** The period a report covers, in the same layout. */
  periodText: (startDate: string | undefined | null, endDate: string | undefined | null) => string;
}

export function useReportDates(): ReportDates {
  const language = useUIStore(state => state.language);
  const dateFormatPref = useUIStore(state => state.dateFormatPref);
  const savedLocale = useAuthStore(state => state.getCurrentWorkspace()?.moneyDisplay?.locale);
  const { locale, dateFormat } = reportLocaleFor({
    moneyDisplayLocale: savedLocale,
    language,
    dateFormat: dateFormatPref,
  });
  return {
    locale,
    dateFormat,
    dateText: isoDate => reportDateTextFor(isoDate, locale, dateFormat),
    periodText: (startDate, endDate) => reportPeriodTextIn(startDate, endDate, locale, dateFormat),
  };
}
