import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Compass, Plus } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { recentWorkspaceIds, rememberWorkspace, switcherRows } from '../../lib/workspaceSwitcher';
import { cn } from '../../lib/utils';

import { BRAND_NAME } from '../../config/brand';
/**
 * The workspace switcher (K-34) in the sidebar: a button with the open workspace's name; it opens a
 * list to type in (filters by name, Hebrew too), the most recently opened first, each with your
 * role; arrows move, Enter opens, Escape closes. Opening one remembers it as recent.
 */
export default function WorkspaceSwitcher({ onSelect, onNewWorkspace }: { onSelect: (id: string) => void; onNewWorkspace?: () => void }) {
  const workspaces = useAuthStore(s => s.workspaces);
  const currentId = useAuthStore(s => s.currentWorkspaceId);
  const uid = useAuthStore(s => s.user?.uid || '');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => (open ? switcherRows(workspaces, { uid, query, recent: recentWorkspaceIds(), currentId }) : []), [open, workspaces, uid, query, currentId]);
  const current = workspaces.find(w => w.id === currentId);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (id: string) => {
    rememberWorkspace(id);
    setOpen(false);
    setQuery('');
    onSelect(id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); choose(rows[active].id); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  return (
    <div ref={rootRef} className="w-full relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(o => !o); setActive(0); }}
        className="w-full flex items-center gap-3 text-left">
        <span className="w-8 h-8 rounded-lg bg-[var(--brass-soft)] border border-[var(--brass-line)] flex items-center justify-center text-[var(--brass)] shrink-0 shadow-sm">
          <Compass aria-hidden="true" size={18} />
        </span>
        <span className="flex-1 overflow-hidden">
          <span className="flex items-center justify-between">
            <span className="text-[14px] font-bold text-[var(--text)] tracking-tight leading-none truncate"><bdi>{current?.name || `${BRAND_NAME}`}</bdi></span>
            <ChevronDown aria-hidden="true" size={14} className="text-[var(--faint)]" />
          </span>
          <span className="block text-[10px] font-mono text-[var(--faint)] mt-1 truncate uppercase tracking-wider">Workspace<span className="sr-only">: switch</span></span>
        </span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 max-w-[90vw] bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-xl z-50 p-2 space-y-1">
          <input ref={el => el?.focus()} aria-label="Find a workspace" value={query} placeholder="Type a name…"
            onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
            aria-controls="workspace-switcher-list" aria-activedescendant={rows[active] ? `ws-opt-${rows[active].id}` : undefined}
            className="w-full px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
          <ul id="workspace-switcher-list" role="listbox" aria-label="Workspaces" className="max-h-72 overflow-y-auto">
            {rows.map((w, i) => (
              <li key={w.id} id={`ws-opt-${w.id}`} role="option" aria-selected={i === active}
                onMouseDown={e => { e.preventDefault(); choose(w.id); }} onMouseEnter={() => setActive(i)}
                className={cn('flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[13px] cursor-pointer', i === active && 'bg-[var(--elevated)]', w.current ? 'text-[var(--brass)] font-semibold' : 'text-[var(--text)]')}>
                <bdi className="truncate">{w.name}</bdi>
                <span className="shrink-0 text-[10px] text-[var(--muted)]">{w.role}{w.currency ? ` · ${w.currency}` : ''}</span>
              </li>
            ))}
            {rows.length === 0 && <li className="px-2 py-1.5 text-xs text-[var(--muted)]">No workspace has that name.</li>}
          </ul>
          {onNewWorkspace && (
            <button type="button" onClick={() => { setOpen(false); onNewWorkspace(); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] rounded">
              <Plus aria-hidden="true" size={14} /> New Workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}
