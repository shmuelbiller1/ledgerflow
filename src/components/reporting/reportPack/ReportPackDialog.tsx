import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../../hooks/useDialog';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../../lib/utils';
import { PACK_REPORTS, packReportUrl, packSection } from '../../../lib/reportPack';
import type { PackReport, PackSection } from '../../../lib/reportPack';

export default function ReportPackDialog({ startDate, endDate, onClose }: { startDate: string; endDate: string; onClose: () => void }) {
  const user = useAuthStore(s => s.user);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const workspace = useAuthStore(s => s.workspaces.find(w => w.id === s.currentWorkspaceId));
  const accounts = useLedgerStore(s => s.accounts);
  const { titleId, dialogProps } = useDialog(onClose);
  const [selected, setSelected] = useState<PackReport[]>(['pl', 'bs', 'ar']);
  const [snapshot, setSnapshot] = useState<{ sections: PackSection[]; made: string; agingDate: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const lifecycle = generation;
    const requests = controller;
    return () => { lifecycle.current++; requests.current?.abort(); };
  }, []);
  const [originalContext] = useState(() => ({ uid: user?.uid, workspaceId }));
  useEffect(() => {
    if (user?.uid !== originalContext.uid || workspaceId !== originalContext.workspaceId) onClose();
  }, [user?.uid, workspaceId, onClose, originalContext]);

  async function prepare() {
    if (pending.current || !user || !workspaceId || !selected.length) return;
    pending.current = true; setBusy(true); setError(''); setSnapshot(undefined);
    const run = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    const current = () => run === generation.current && useAuthStore.getState().user?.uid === user.uid && useAuthStore.getState().currentWorkspaceId === workspaceId;
    try {
      const token = await user.getIdToken();
      if (!current()) return;
      if (!token) throw new Error('Sign in again to read the reports.');
      const names = Object.fromEntries(accounts.map(a => [a.id, a.name]));
      const sections = await Promise.all(selected.map(async kind => {
        const response = await fetch(packReportUrl(kind, workspaceId, startDate, endDate), { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
        if (!response.ok) throw new Error(`${PACK_REPORTS[kind]} could not load (${response.status}). Retry to prepare the whole pack.`);
        const result = await response.json();
        try { return packSection(kind, result.data ?? result, names); }
        catch { throw new Error(`${PACK_REPORTS[kind]} returned incomplete report data. Retry before printing.`); }
      }));
      if (current()) setSnapshot({ sections, made: new Date().toISOString(), agingDate: getLocalDateISO() });
    } catch (cause) {
      abort.abort();
      if (current()) setError(cause instanceof Error ? cause.message : 'Could not prepare the report pack.');
    } finally {
      if (current()) { pending.current = false; setBusy(false); }
    }
  }
  if (user?.uid !== originalContext.uid || workspaceId !== originalContext.workspaceId) return null;
  const control = 'min-h-11 px-3 py-2 border border-[var(--line)] rounded-lg';
  return createPortal(<div {...dialogProps} className="report-pack-overlay fixed inset-0 z-[100] bg-[var(--surface)] overflow-auto p-4 text-[var(--text)]">
    <div data-print-hide className="max-w-4xl mx-auto space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={titleId} className="text-xl font-bold">Report pack</h2><button className={control} onClick={onClose}>Close</button></div>
      <p>Accrual statements: {startDate} – {endDate}. Aging uses current balances and the server’s current-day overdue buckets, separately dated when retrieved.</p>
      <p>Choose sections, prepare the preview, then select Save as PDF in your browser’s print dialog. Other specialized reports keep their individual Print / PDF action.</p>
      <fieldset disabled={busy} className="flex flex-wrap gap-3"><legend className="font-bold">Sections</legend>
        {(Object.keys(PACK_REPORTS) as PackReport[]).map(kind => <label key={kind} className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={selected.includes(kind)} onChange={e => {
          setSelected(previous => e.target.checked ? [...previous, kind] : previous.filter(k => k !== kind)); setSnapshot(undefined); setError('');
        }} />{PACK_REPORTS[kind]}</label>)}
      </fieldset>
      <div className="flex flex-wrap gap-3"><button className={control} disabled={busy || !selected.length || !user || !workspaceId} onClick={() => void prepare()}>{busy ? 'Preparing…' : snapshot ? 'Refresh pack' : 'Prepare pack'}</button>
        <button className={control} disabled={!snapshot || busy} onClick={() => window.print()}>Print pack / PDF</button></div>
      {busy && <p role="status">Reading all selected reports…</p>}{error && <p role="alert">{error}</p>}
    </div>
    {snapshot && <article data-report-pack-print className="report-pack-paper max-w-4xl mx-auto mt-6 bg-white text-black p-4">
      <section className="report-pack-cover"><h1 className="text-3xl font-bold">Report pack</h1><h2 className="text-xl"><bdi dir="auto">{workspace?.name || workspaceId}</bdi></h2>
        <p>Reporting period: {startDate} – {endDate}</p><p>P&L / balance sheet basis: accrual · Currency: {workspace?.currency || 'USD'}</p>
        <p>Made: {snapshot.made}</p><ol>{snapshot.sections.map(section => <li key={section.kind}>{PACK_REPORTS[section.kind]}</li>)}</ol>
        {snapshot.sections.some(s => s.kind === 'ar' || s.kind === 'ap') && <p>Aging shows current outstanding balances retrieved at {snapshot.made}. It is not a historical balance at {endDate}.</p>}
        <p>Sections are read from the existing workspace report services. Each section is read separately; refresh if the books change while preparing.</p>
      </section>
      {snapshot.sections.map(section => <section className="report-pack-section" key={section.kind} aria-label={PACK_REPORTS[section.kind]}>
        <h2 className="text-xl font-bold">{PACK_REPORTS[section.kind]}{section.kind === 'ar' || section.kind === 'ap' ? ` as of ${snapshot.agingDate}` : ''}</h2>
        <p>{section.kind === 'ar' || section.kind === 'ap' ? `Current aging · retrieved ${snapshot.made}` : section.kind === 'bs' || section.kind === 'tb' ? `As of ${endDate} · accrual` : `${startDate} – ${endDate}${section.kind === 'pl' ? ' · accrual' : ''}`}</p>
        {(section.kind === 'ar' || section.kind === 'ap') && <p>Today’s position, not the reporting period end. Buckets follow the server’s current day; the heading date is the workspace retrieval date.</p>}
        {section.warnings.map(warning => <p key={warning}>{warning}</p>)}
        <table className="w-full"><caption className="sr-only">{PACK_REPORTS[section.kind]}</caption><thead><tr><th scope="col" className="text-left">Account / measure</th><th scope="col" className="text-right">Amount ({workspace?.currency || 'USD'})</th></tr></thead>
          <tbody>{section.rows.map(row => <tr key={row.id} className={row.total ? 'font-bold border-t' : ''}><th scope="row" className="text-left py-1 font-[inherit]"><bdi dir="auto">{row.label}</bdi></th><td className="text-right whitespace-nowrap"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(row.cents, workspace?.currency || 'USD')}</bdi></td></tr>)}</tbody>
        </table>
      </section>)}
    </article>}
  </div>, document.body);
}
