import React from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { explanationsForReport } from '../../lib/reportTotalExplanations';
import { useReportText } from './useReportText';

/**
 * A-202: "what does this number mean?" — a disclosure under the report that explains, in plain
 * words, the totals a reader is most likely to misread. It prints nothing (`data-print-hide`) and
 * changes no figure: it is the same report, explained.
 *
 * The panel is only rendered for a report that has an explanation entry, so a report without one
 * shows no empty control.
 */
export default function ReportTotalExplainer({ reportId }: { reportId: string }) {
  const reportText = useReportText();
  const language = useUIStore((state) => (state.language === 'he' ? 'he' : 'en'));
  const explanations = explanationsForReport(reportId);
  if (!explanations.length) return null;

  const text = language === 'he'
    ? {
        summary: 'מה המשמעות של המספר הזה?',
        intro:
          'הסבר במילים פשוטות לכל סה\u0022כ בדוח הזה: מה הוא כולל, מה הוא משאיר בחוץ, ומה אסור להסיק ממנו. ההסבר מתאר את החישוב שהפיק את המספר.',
        what: 'מה זה',
        includes: 'מה נכלל',
        leavesOut: 'מה אינו נכלל',
        notProves: 'מה זה לא מוכיח',
      }
    : {
        summary: 'What does this number mean?',
        intro:
          'Plain words for each total on this report: what it counts, what it leaves out, and what it must not be read as proof of. The words describe the calculation that produced the figure.',
        what: reportText('r.what-it-is', 'What it is'),
        includes: 'What it counts',
        leavesOut: 'What it leaves out',
        notProves: 'What it does not prove',
      };

  return (
    <details
      data-print-hide
      data-testid="report-total-explainer"
      className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2"
      dir={language === 'he' ? 'rtl' : 'ltr'}
      lang={language}
    >
      <summary className="min-h-11 cursor-pointer text-sm font-semibold">
        {text.summary}
      </summary>
      <p className="text-sm text-[var(--muted)] pb-2">{text.intro}</p>
      <dl className="space-y-4 pb-2">
        {explanations.map((explanation) => (
          <div key={explanation.id} className="border-t border-[var(--line)] pt-3">
            <dt className="text-sm font-semibold">
              <bdi>{explanation.total[language]}</bdi>
            </dt>
            <dd className="mt-1 space-y-1 text-sm">
              <p>
                <span className="font-medium">{text.what}: </span>
                <bdi>{explanation.what[language]}</bdi>
              </p>
              <p>
                <span className="font-medium">{text.includes}: </span>
                <bdi>{explanation.includes[language]}</bdi>
              </p>
              <p>
                <span className="font-medium">{text.leavesOut}: </span>
                <bdi>{explanation.leavesOut[language]}</bdi>
              </p>
              <p>
                <span className="font-medium">{text.notProves}: </span>
                <bdi>{explanation.notProves[language]}</bdi>
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
