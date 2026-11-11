import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { REPORT_TABS_REGISTRY } from '../../config/registry';
import {
  MAX_REPORT_VIEWS,
  parseReportViews,
  reportViewParams,
  reportViewState,
  reportViewsKey,
  type SavedReportView,
} from '../../lib/reportViews';
import type { ReportUrlState } from '../../lib/reportPermalink';

interface Props {
  state: ReportUrlState;
  onUse: (state: ReportUrlState) => void;
}

/** Named report filters, scoped to this user and workspace on this device. Presentation only. */
export default function ReportViewsControls({ state, onUse }: Props) {
  const user = useAuthStore(store => store.user?.uid || 'guest');
  const workspace = useAuthStore(store => store.currentWorkspaceId || 'none');
  const storageKey = reportViewsKey(user, workspace);
  return (
    <ScopedViews
      key={storageKey}
      state={state}
      onUse={onUse}
      storageKey={storageKey}
      user={user}
      workspace={workspace}
    />
  );
}

function ScopedViews({ state, onUse, storageKey, user, workspace }: Props & {
  storageKey: string;
  user: string;
  workspace: string;
}) {
  const [views, setViews] = useState<SavedReportView[]>(() => {
    try { return parseReportViews(localStorage.getItem(storageKey)); } catch { return []; }
  });
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const stillCurrent = () =>
    (useAuthStore.getState().user?.uid || 'guest') === user &&
    (useAuthStore.getState().currentWorkspaceId || 'none') === workspace;

  /** Returns whether the choice is durable; a refused write keeps the caller's draft intact. */
  function persist(next: SavedReportView[]): boolean {
    if (!stillCurrent()) return false;
    setViews(next);
    setError('');
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, views: next }));
      return true;
    } catch {
      setError('Browser storage is unavailable. New views last until this screen reloads.');
      return false;
    }
  }

  function saveView() {
    if (!stillCurrent()) return;
    const label = name.trim();
    if (!label || label.length > 80) { setError('Enter a view name of 1–80 characters.'); return; }
    if (views.some(view => view.name === label)) { setError('That name already exists. Remove the old view or choose another name.'); return; }
    if (views.length >= MAX_REPORT_VIEWS) { setError(`Up to ${MAX_REPORT_VIEWS} report views. Remove one first.`); return; }
    if (!persist([...views, { name: label, params: reportViewParams(state), createdAt: new Date().toISOString() }])) return;
    setNotice(`Saved ${label}`);
    setName('');
  }

  function applyView(view: SavedReportView) {
    if (!stillCurrent()) return;
    const next = reportViewState(view.params, state);
    if (!REPORT_TABS_REGISTRY.some(tab => tab.id === next.report)) {
      setError(`${view.name} names a report that is no longer registered.`);
      return;
    }
    onUse(next);
    setError('');
    setNotice(`Using ${view.name}`);
  }

  return (
    <details data-print-hide className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] open:pb-3 open:w-full">
      <summary className="min-h-11 flex items-center cursor-pointer font-medium">Saved report views</summary>
      <p className="text-xs">
        Save the report, period, comparison and date range under a name. It is kept for you in this
        workspace on this device; no report rows or amounts are stored.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="min-w-0 text-sm">View name
          <input value={name} onChange={event => setName(event.target.value)} maxLength={80}
            className="block min-h-11 max-w-full rounded border px-2" />
        </label>
        <button type="button" onClick={saveView} className="min-h-11 rounded border px-3">Save this report view</button>
      </div>
      {views.length === 0 && <p className="mt-2 text-xs">No saved report views yet.</p>}
      <ul>
        {views.map(view => (
          <li key={view.name} className="mt-2 flex flex-wrap items-center gap-2">
            <bdi dir="auto" className="break-words">{view.name}</bdi>
            <button type="button" onClick={() => applyView(view)} aria-label={`Use report view ${view.name}`}
              className="min-h-11 rounded border px-3">Use</button>
            <button type="button" onClick={() => persist(views.filter(item => item.name !== view.name))}
              aria-label={`Remove report view ${view.name}`} className="min-h-11 rounded border px-3">Remove</button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm">{error}</p>}
      <p role="status" className="sr-only">{notice}</p>
    </details>
  );
}
