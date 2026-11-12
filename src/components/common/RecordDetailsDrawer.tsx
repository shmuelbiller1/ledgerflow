import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeSearchText } from '../../lib/textNormalization';
import { X } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useRecordDetailsStore, detailScope } from '../../stores/useRecordDetailsStore';
import { RECORD_DETAIL_FIELDS } from '../../lib/recordDetails';
import type { DetailKind, DetailTarget, DetailAdapter } from '../../lib/recordDetails';
import { recordDetailsAdapter } from '../../lib/recordDetailsAdapter';
import { RecordDetailsForm } from './RecordDetailsForm';
const TITLES: Record<DetailKind, string> = { customers: 'Customers', vendors: 'Vendors', projects: 'Projects', inventory: 'Items' };

export function RecordDetailsPanel({ initialTarget, onClose, adapter = recordDetailsAdapter }: { initialTarget?: DetailTarget; onClose: () => void; adapter?: DetailAdapter }) {
  const { dialogProps, titleId } = useDialog(onClose);
  useEffect(() => {
    const node = dialogProps.ref.current;
    if (!node) return;
    const save = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); node.querySelector('form')?.requestSubmit(); } };
    node.addEventListener('keydown', save);
    return () => node.removeEventListener('keydown', save);
  }, [dialogProps.ref]);
  const [target, setTarget] = useState(initialTarget);
  const [kind, setKind] = useState<DetailKind>(initialTarget?.kind || 'vendors');
  const [search, setSearch] = useState('');
  const [recordId, setRecordId] = useState('');
  useLedgerCollections('customers', 'vendors', 'projects', 'inventory');
  const records = useLedgerStore(state => state[kind]);
  const truncated = useLedgerStore(state => state.truncatedCollections);
  const list = useMemo(() => records.filter(record => normalizeSearchText(String(record.name ?? '')).includes(normalizeSearchText(search))), [records, search]);
  return createPortal(<>
    <button type="button" tabIndex={-1} aria-label="Close record details backdrop" onClick={onClose} className="fixed inset-0 z-[699] w-full bg-black/30" />
    <aside {...dialogProps} className="fixed top-0 right-0 bottom-0 z-[700] h-full w-full max-w-lg bg-[var(--surface)] text-[var(--text)] shadow-2xl flex flex-col border-l border-[var(--line)]">
      <div className="flex items-center justify-between p-5 border-b border-[var(--line)]"><h2 id={titleId} className="text-lg font-semibold">Edit record details</h2><button aria-label="Close record details" onClick={onClose} className="min-h-11 min-w-11 flex items-center justify-center"><X aria-hidden="true" size={20} /></button></div>
      <div className="p-5 overflow-y-auto space-y-4">
        <p className="text-sm text-[var(--muted)]">Keep working on the current screen while updating details for future use.</p>
        {target ? <><button type="button" onClick={() => setTarget(undefined)} className="min-h-11 underline">Choose another record</button><p className="text-sm">{TITLES[target.kind]}</p><RecordDetailsForm key={`${target.kind}:${target.id}`} target={target} adapter={adapter} /></> : <>
          <label className="block text-sm">Record type<select aria-label="Record type" value={kind} onChange={event => setKind(event.target.value as DetailKind)} className="mt-1 w-full p-3 border rounded-lg bg-[var(--panel)]">{Object.keys(RECORD_DETAIL_FIELDS).map(key => <option key={key} value={key}>{TITLES[key as DetailKind]}</option>)}</select></label>
          <input aria-label="Find record details" value={search} onChange={event => setSearch(event.target.value)} dir="auto" placeholder="Find a name or Hebrew label…" className="w-full p-3 border rounded-lg bg-[var(--panel)]" />
          {isCollectionCapped(truncated, kind) && <p role="status" className="text-sm">This is a partial loaded list. A selected related record or a record ID can still load its current details.</p>}
          <details><summary className="text-sm cursor-pointer">Open by record ID</summary><label className="block text-sm">Record ID<input aria-label="Record ID" value={recordId} onChange={event => setRecordId(event.target.value)} className="w-full p-3 border rounded-lg bg-[var(--panel)]" /></label><button type="button" disabled={!recordId.trim() || recordId.length > 500} onClick={() => setTarget({ kind, id: recordId.trim() })} className="min-h-11 px-3 underline">Load record details</button></details>
          <ul>{list.slice(0, 50).map(record => <li key={record.id}><button type="button" onClick={() => setTarget({ kind, id: record.id })} className="w-full min-h-11 p-3 text-start rounded-lg hover:bg-[var(--panel)]"><bdi>{record.name}</bdi></button></li>)}</ul>
          {list.length === 0 && <p role="status">No matching loaded records.</p>}
        </>}
      </div>
    </aside>
  </>, document.body);
}
export function RecordDetailsDrawer() {
  const open = useRecordDetailsStore(state => state.open), scope = useRecordDetailsStore(state => state.scope), target = useRecordDetailsStore(state => state.target), close = useRecordDetailsStore(state => state.close);
  const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
  useEffect(() => useAuthStore.subscribe(() => { if (detailScope() !== useRecordDetailsStore.getState().scope) close(); }), [close]);
  return open && scope === `${uid || 'guest'}:${workspace || 'none'}` ? <RecordDetailsPanel key={`${scope}:${target?.kind || "picker"}:${target?.id || ""}`} initialTarget={target} onClose={close} /> : null;
}
