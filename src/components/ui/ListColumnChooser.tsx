import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import {
  listColumnCss,
  listColumnKey,
  readListHidden,
  saveListHidden,
  toggleListColumn,
} from '../../lib/listColumns';

interface Props {
  /** Stable DOM scope, matching `data-list-columns` on the list's scroll wrapper. */
  scope: string;
  label: string;
  /** One name per rendered column, including Selection and Actions. */
  columns: string[];
}

/**
 * The C-29 column chooser on the main document lists. The component adds only controls and CSS;
 * it never clones, reorders or changes a row, and printing always shows every column.
 */
export default function ListColumnChooser(props: Props) {
  const user = useAuthStore(store => store.user?.uid || 'guest');
  const workspace = useAuthStore(store => store.currentWorkspaceId || 'none');
  const key = listColumnKey(user, workspace, props.label);
  return <ScopedChooser key={`${key}:${props.columns.length}`} {...props} storageKey={key} />;
}

function ScopedChooser({ scope, label, columns, storageKey }: Props & { storageKey: string }) {
  const [hidden, setHidden] = useState(() => readListHidden(storageKey, columns.length));
  const [storageWarning, setStorageWarning] = useState(false);

  function change(index: number) {
    const next = toggleListColumn(hidden, index, columns.length);
    setHidden(next);
    setStorageWarning(!saveListHidden(storageKey, next));
  }

  function showAll() {
    setHidden([]);
    setStorageWarning(!saveListHidden(storageKey, []));
  }

  return (
    <>
      <style>{listColumnCss(scope, hidden)}</style>
      <details data-print-hide className="px-3 py-1 text-sm open:m-2 open:rounded open:border open:bg-[var(--surface)] open:p-2">
        <summary className="min-h-11 md:min-h-7 inline-flex items-center cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--text)]">
          Columns{hidden.length ? ` (${hidden.length} hidden)` : ''}
        </summary>
        <p className="mb-2 text-xs text-[var(--muted)]">
          Hide columns to fit {label.toLowerCase()} on this screen. Your choice is saved for this
          workspace on this device. Selection and actions stay visible; print includes every column.
        </p>
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">Columns to show in {label}</legend>
          {columns.map((name, index) => {
            const locked = index === 0 || index === columns.length - 1;
            const descriptionId = `${scope}-column-${index}`;
            return (
              <div key={name} className="flex min-h-11 items-center gap-1">
                <input type="checkbox" checked={!hidden.includes(index)} disabled={locked}
                  onChange={() => change(index)} aria-label={`Column ${index + 1} visibility`}
                  aria-describedby={descriptionId} />
                <span id={descriptionId}><bdi dir="auto">{name} column</bdi></span>
              </div>
            );
          })}
        </fieldset>
        <button type="button" onClick={showAll}
          className="mt-2 min-h-11 rounded border px-3" disabled={hidden.length === 0}>Show all columns</button>
        {storageWarning && <p role="status" className="mt-2 text-xs">Browser storage is unavailable. This choice lasts until the screen reloads.</p>}
      </details>
    </>
  );
}
