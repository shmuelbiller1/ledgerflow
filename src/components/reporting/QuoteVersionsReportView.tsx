import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import {
  QUOTE_VERSIONS_CSV_HEADERS, changesSinceLastVersion, compareQuoteVersions, quoteChangeList,
  quoteVersionsCsvRows, quoteVersionsFromMetadata, quoteVersionsToMetadata, recordQuoteVersion, snapshotQuote,
  type QuoteChange,
} from '../../lib/quoteVersions';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import type { Estimate } from '../../types';
import { fill, useReportText } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const CURRENT = 'current';

const metadataOf = (estimate: Estimate): Record<string, unknown> =>
  ((estimate as unknown as { metadata?: Record<string, unknown> }).metadata || {});

const changeText = (changes: QuoteChange[]) => changes.length
  ? changes.map(change => change.detail).join('; ')
  : 'nothing changed';

/**
 * A-61: quote versions. An estimate keeps its earlier versions — who recorded each one, when, and
 * what changed — so “what did we quote in June?” has an answer. A version is recorded from this
 * screen (before an edit, or after one to keep the new content); only real changes are kept, so
 * recording twice in a row writes nothing. The customer portal always shows the estimate as it is
 * now and says which version that is; content that was never recorded cannot be recovered, and
 * this screen says so. Read-only about money: nothing here posts, re-prices or sends a quote.
 */
export default function QuoteVersionsReportView() {
  const reportText = useReportText();
  const estimates = useLedgerStore(state => state.estimates);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const failed = useDataNeedsStore(state => state.failed);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const user = useAuthStore(state => state.user);
  const isGuest = useAuthStore(state => state.isGuest);
  const { loading } = useLedgerCollections('estimates');
  const { updateEntity } = useEntityOperations();
  const role = useCurrentRole();

  const [chosenId, setChosenId] = useState<string | null>(null);
  const [fromIndex, setFromIndex] = useState<string>('');
  const [toIndex, setToIndex] = useState<string>(CURRENT);
  const [busy, setBusy] = useState(false);
  const [savedVersions, setSavedVersions] = useState<Record<string, ReturnType<typeof quoteVersionsFromMetadata>>>({});
  const homeCurrency = (workspace?.currency || 'USD').toUpperCase();

  const withVersions = useMemo(() => (estimates as Estimate[]).map(estimate => {
    const versions = savedVersions[estimate.id] || quoteVersionsFromMetadata(metadataOf(estimate));
    return {
      estimate,
      versions,
      changes: changesSinceLastVersion(versions, snapshotQuote(estimate)),
    };
  }), [estimates, savedVersions]);

  const chosen = withVersions.find(entry => entry.estimate.id === chosenId) || withVersions[0] || null;
  const canEdit = role !== 'viewer' && !isGuest && !!user;
  const partial = truncated.estimates || failed.estimates;

  const compareChanges = useMemo(() => {
    if (!chosen || fromIndex === '') return [];
    const from = Number(fromIndex);
    if (Number.isNaN(from) || !chosen.versions[from]) return [];
    const to = toIndex === CURRENT ? null : Number(toIndex);
    if (to === null) return quoteChangeList(chosen.versions[from].snapshot, snapshotQuote(chosen.estimate));
    return compareQuoteVersions(chosen.versions, from, to);
  }, [chosen, fromIndex, toIndex]);

  const record = async () => {
    if (!chosen || !canEdit || busy) return;
    setBusy(true);
    try {
      const result = recordQuoteVersion(chosen.versions, {
        snapshot: snapshotQuote(chosen.estimate),
        by: user?.uid || '',
        byName: user?.email || user?.uid || 'someone',
        at: new Date().toISOString(),
      });
      if (!result.recorded) return;
      await updateEntity('estimates', chosen.estimate.id, {
        metadata: quoteVersionsToMetadata(metadataOf(chosen.estimate), result.versions),
        updatedAt: new Date().toISOString(),
      }, `Version ${result.versions.length} of ${chosen.estimate.number || chosen.estimate.id} recorded`);
      setSavedVersions(previous => ({ ...previous, [chosen.estimate.id]: result.versions }));
    } finally {
      setBusy(false);
    }
  };

  return <section aria-label={reportText('r.quote-versions', 'Quote versions')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.quote-versions', 'Quote versions')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.every-recorded-version-of-an-estimate-who-record', 'Every recorded version of an estimate — who recorded it, when, and what changed — with any two versions side by side. Record the current version before an edit to keep the old content, or after one to keep the new; recording the same content twice writes nothing. The customer portal always shows the estimate as it is now and says which version that is. Content that was never recorded cannot be recovered. Nothing here posts, re-prices or sends a quote.')}
    </p>

    {loading && <p role="status">{reportText('r.loading-estimates', 'Loading estimates…')}</p>}
    {partial && <p role="alert">{reportText('r.loaded-estimate-history-is-incomplete-or-failed', 'Loaded estimate history is incomplete or failed to load. Estimates that are not loaded are not shown.')}</p>}
    {!loading && withVersions.length === 0 && <p>{reportText('r.no-estimates-are-loaded-for-this-workspace', 'No estimates are loaded for this workspace.')}</p>}

    {withVersions.length > 0 && <div className="flex flex-wrap gap-6 items-start">
      <nav aria-label={reportText('r.estimates', 'Estimates')} className="space-y-2 min-w-56">
        {withVersions.map(entry => (
          <button key={entry.estimate.id} type="button"
            className={`block w-full text-start rounded border px-3 py-2 min-h-11 ${chosen?.estimate.id === entry.estimate.id ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}
            aria-current={chosen?.estimate.id === entry.estimate.id ? 'true' : undefined}
            onClick={() => { setChosenId(entry.estimate.id); setFromIndex(''); setToIndex(CURRENT); }}>
            <bdi>{entry.estimate.number || entry.estimate.id}</bdi>
            {' · '}<bdi>{entry.estimate.customerName || entry.estimate.customerId}</bdi>
            <div className="text-xs text-[var(--muted)]">
              {entry.versions.length === 0 ? reportText('r.no-version-recorded', 'no version recorded') : fill(reportText('r.0-version-s-recorded', '{0} version(s) recorded'), { 0: entry.versions.length })}
              {entry.versions.length > 0 && entry.changes.length > 0 && <b> {reportText('r.changed-since-the-last-version', '· changed since the last version')}</b>}
            </div>
          </button>
        ))}
      </nav>

      {chosen && <div className="flex-1 min-w-72 space-y-4">
        <h3 className="text-base font-semibold"><bdi>{chosen.estimate.number || chosen.estimate.id}</bdi> — {formatCurrency(chosen.estimate.amountCents || 0, (chosen.estimate as Estimate & { currency?: string }).currency || homeCurrency)} {reportText('r.now-2', 'now')}</h3>

        <div className="flex flex-wrap items-end gap-3" data-print-hide>
          <button type="button" className="btn-secondary min-h-11 px-3" disabled={!canEdit || busy} onClick={record}>
            {reportText('r.record-the-current-version', 'Record the current version')}
          </button>
          {!canEdit && <p className="text-xs text-[var(--muted)]">{reportText('r.a-viewer-or-a-guest-workspace-reads-the-history', 'A viewer or a guest workspace reads the history but cannot record a version.')}</p>}
          <button type="button" className="btn-secondary min-h-11 px-3" disabled={!chosen.versions.length} onClick={() => downloadCsv(
            `quote-versions-${chosen.estimate.number || chosen.estimate.id}.csv`, QUOTE_VERSIONS_CSV_HEADERS, quoteVersionsCsvRows(chosen.versions),
          )}>{reportText('r.export-csv', 'Export CSV')}</button>
        </div>

        {chosen.versions.length > 0 && chosen.changes.length > 0 && (
          <p role="status" className="text-sm" data-testid="pending-changes">
            <b>{reportText('r.changed-since-version', 'Changed since version')} {chosen.versions.length}{reportText('r.not-yet-recorded', ', not yet recorded:')}</b> {changeText(chosen.changes)}
          </p>
        )}

        <h4>{reportText('r.version-history', 'Version history')}</h4>
        {chosen.versions.length === 0 && <p>{reportText('r.no-version-has-been-recorded-for-this-estimate-y', 'No version has been recorded for this estimate yet. Its history starts when the first one is recorded.')}</p>}
        {chosen.versions.length > 0 && <ReportTableScroll><table className="w-full text-sm">
          <caption>{reportText('r.recorded-versions-of', 'Recorded versions of')} {chosen.estimate.number || chosen.estimate.id}</caption>
          <thead><tr>
            <th scope="col">{reportText('r.version', 'Version')}</th><th scope="col">{reportText('r.recorded-2', 'Recorded')}</th><th scope="col">{reportText('r.by', 'By')}</th>
            <th scope="col" className="text-right">{reportText('r.amount', 'Amount')}</th><th scope="col">{reportText('r.valid-until', 'Valid until')}</th><th scope="col">{reportText('r.what-changed', 'What changed')}</th>
          </tr></thead>
          <tbody>{chosen.versions.map(version => {
            const versionNumber = chosen.versions.indexOf(version) + 1;
            const prevSnapshot = versionNumber > 1 ? chosen.versions[versionNumber - 2].snapshot : null;
            return <tr key={`v-${versionNumber}-${version.at}`} className="border-t border-[var(--line)] align-top">
              <th scope="row" className="text-left">{versionNumber}</th>
              <td className="tabular-nums whitespace-nowrap">{version.at.replace('T', ' ').slice(0, 16)}</td>
              <td><bdi>{version.byName || version.by}</bdi>{version.note ? <div className="text-xs text-[var(--muted)]"><bdi>{version.note}</bdi></div> : null}</td>
              <td className="text-right tabular-nums">{formatCurrency(version.snapshot.amountCents, (chosen.estimate as Estimate & { currency?: string }).currency || homeCurrency)}</td>
              <td className="tabular-nums">{version.snapshot.expiryDate || '—'}</td>
              <td className="text-xs">{changeText(quoteChangeList(prevSnapshot, version.snapshot))}</td>
            </tr>;
          })}</tbody>
        </table></ReportTableScroll>}

        {chosen.versions.length > 0 && <>
          <h4>{reportText('r.compare', 'Compare')}</h4>
          <div className="flex flex-wrap items-end gap-3" data-print-hide>
            <label className="flex flex-col gap-1">{reportText('r.from-version', 'From version')}
              <select aria-label={reportText('r.compare-from-version', 'Compare from version')} className={field} value={fromIndex} onChange={event => setFromIndex(event.target.value)}>
                <option value="">{reportText('r.choose-a-version', 'Choose a version')}</option>
                {chosen.versions.map(version => {
                  const idx = chosen.versions.indexOf(version);
                  return <option key={`from-${idx}-${version.at}`} value={String(idx)}>{reportText('r.version', 'Version')} {idx + 1} ({version.at.slice(0, 10)})</option>;
                })}
              </select>
            </label>
            <label className="flex flex-col gap-1">{reportText('r.to-version', 'To version')}
              <select aria-label={reportText('r.compare-to-version', 'Compare to version')} className={field} value={toIndex} onChange={event => setToIndex(event.target.value)}>
                <option value={CURRENT}>{reportText('r.current-content', 'Current content')}</option>
                {chosen.versions.map(version => {
                  const idx = chosen.versions.indexOf(version);
                  return <option key={`to-${idx}-${version.at}`} value={String(idx)}>{reportText('r.version', 'Version')} {idx + 1} ({version.at.slice(0, 10)})</option>;
                })}
              </select>
            </label>
          </div>
          {fromIndex === '' && <p className="text-sm text-[var(--muted)]">{reportText('r.choose-a-first-version-to-compare', 'Choose a first version to compare.')}</p>}
          {fromIndex !== '' && <p role="status" className="text-sm" data-testid="quote-compare">
            {compareChanges.length === 0 ? reportText('r.nothing-changed-between-these-two', 'Nothing changed between these two.') : <ul className="list-disc ps-5">{compareChanges.map(change => <li key={`${change.kind}-${change.detail}`}>{change.detail}</li>)}</ul>}
          </p>}
        </>}
      </div>}
    </div>}
  </section>;
}
