/**
 * E-54: the Israeli Uniform Structure (מבנה אחיד) research fixture, on screen.
 *
 * The Tax Authority's "open format" (spec v1.31) is two fixed-width files — INI.TXT and
 * BKMVDATA.TXT — that registered accounting software must produce for a computerized audit.
 * This screen shows the transcribed record layouts and the sample fixture the E-33 writer
 * will consume, so the research is visible and checkable. Read-only: nothing is written,
 * filed, posted or paid (src/lib/tax/uniformStructure.ts holds the layouts).
 */
import React from 'react';
import { FileText } from 'lucide-react';
import { RowTable } from '../ui/RowTable';
import { EmptyState } from '../ui/EmptyState';
import { useReportText } from './useReportText';
import {
  UNIFORM_RECORD_LAYOUTS,
  UNIFORM_FIXTURE,
  UNIFORM_SYSTEM_CONSTANT,
  type UniformRecordLayout,
} from '../../lib/tax/uniformStructure';

const th = 'font-semibold py-1 px-2';

export default function UniformStructureReportView({
  layouts = UNIFORM_RECORD_LAYOUTS,
}: { layouts?: readonly UniformRecordLayout[] } = {}) {
  const reportText = useReportText();
  const fixture = UNIFORM_FIXTURE;
  const journalDebits = fixture.journalEntries
    .filter((e) => e.debitCredit === '1')
    .reduce((s, e) => s + e.amountCents, 0);
  const journalCredits = fixture.journalEntries
    .filter((e) => e.debitCredit === '2')
    .reduce((s, e) => s + e.amountCents, 0);

  return (
    <section aria-labelledby="uniform-structure-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="uniform-structure-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[var(--muted)]" aria-hidden="true" />
            {reportText('r.uniform-structure-research', 'Uniform Structure (research)')}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {reportText('r.the-israeli-tax-authoritys-open-format-v131-in-two-fixed-width-files-ini', 'The Israeli Tax Authority open format (v1.31): two fixed-width files, INI.TXT and BKMVDATA.TXT. This screen shows the transcribed record layouts and the sample fixture the writer will use. Read-only: nothing is written or filed here.')}
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm" aria-label={reportText('r.research-fixture-not-a-filing', 'Research fixture, not a filing')}>
        <p className="font-semibold">{reportText('r.research-fixture-not-a-filing', 'Research fixture, not a filing')}</p>
        <p className="text-[var(--muted)]">
          {reportText('r.the-writer-is-not-built-yet-e-33-will-turn-the-books-into-ini-txt-and-bkm', 'The writer is not built yet: E-33 will turn the books into INI.TXT and BKMVDATA.TXT from this fixture. Until the file passes the Tax Authority simulator, no acceptance is claimed.')}
        </p>
        <p className="text-[var(--muted)]">
          {reportText('r.system-constant', 'System constant')}: <span className="font-mono">{UNIFORM_SYSTEM_CONSTANT}</span>
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">{reportText('r.record-layouts', 'Record layouts')}</h3>
        <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
          <RowTable
            rowClassName="border-b border-[var(--line)]/50"
            caption={reportText('r.record-layouts', 'Record layouts')}
            rows={layouts}
            empty={(
              <EmptyState
                title={reportText('r.uniform-no-layouts', 'Research layouts are unavailable')}
                description={reportText('r.uniform-refresh-layouts', 'Refresh this page. If the layouts are still missing, report the problem. This research screen cannot produce an export.')}
              />
            )}
            rowKey={(row) => row.code}
            captionClassName="text-left font-semibold text-[var(--text)] pb-1"
            tableClassName="w-full text-sm"
            headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
            bodyClassName=""
            columns={[
              { header: reportText('r.record', 'Record'), className: 'py-1 px-2 font-mono', headClassName: `text-left ${th}`, cell: (row) => row.code },
              { header: reportText('r.uniform-width', 'Width'), align: 'right', className: 'py-1 px-2 font-mono', headClassName: `text-right ${th}`, cell: (row) => row.width },
              { header: reportText('r.uniform-fields', 'Fields'), align: 'right', className: 'py-1 px-2 font-mono', headClassName: `text-right ${th}`, cell: (row) => row.fields.length },
            ]}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm" aria-label={reportText('r.sample-fixture', 'Sample fixture')}>
        <p className="font-semibold">{reportText('r.sample-fixture', 'Sample fixture')}</p>
        <p className="text-[var(--muted)]">
          {reportText('r.one-business-three-accounts-three-journal-lines-one-tax-invoice-and-one-inventory-item', 'One business, three accounts, three journal lines, one tax invoice and one inventory item. The journal balances: debits equal credits.')}
        </p>
        <p className="font-mono text-xs">
          <bdi>{fixture.business.name}</bdi> · {fixture.accounts.length} {reportText('r.uniform-accounts', 'accounts')} · {fixture.journalEntries.length} {reportText('r.uniform-journal-lines', 'journal lines')}
        </p>
        <p className="text-[var(--muted)]">
          {reportText('r.uniform-journal-totals', 'Journal totals (agorot, ILS minor units)')}: <bdi className="font-mono">{journalDebits} = {journalCredits}</bdi>
        </p>
      </div>
    </section>
  );
}
