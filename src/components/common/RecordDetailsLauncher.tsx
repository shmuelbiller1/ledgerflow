import { translateScreenString } from '../../lib/i18n/screenTranslations';
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useRecordDetailsStore } from '../../stores/useRecordDetailsStore';
import { recordDetailContext } from '../../lib/recordDetailContext';
import type { DetailTarget } from '../../lib/recordDetails';
import { RecordDetailsDrawer } from './RecordDetailsDrawer';
export function RelatedRecordEditButton({ target }: { target: DetailTarget }) {
  const language = useUIStore(state => state.language);
  return <button type="button" onClick={() => useRecordDetailsStore.getState().show(target)} className="min-h-11 px-3 underline">{translateScreenString('reports', 'r.edit-details', language, 'Edit details')}</button>;
}
export function RecordDetailsLauncher() {
  const context = useRef<DetailTarget | undefined>(undefined);
  const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
  const open = useRecordDetailsStore(state => state.open);
  const palette = useUIStore(state => state.isCommandPaletteOpen), shortcuts = useUIStore(state => state.isShortcutOverlayOpen);
  useEffect(() => {
    const read = (element: Element | null) => recordDetailContext(element, useLedgerStore.getState());
    const blocked = () => { const ui = useUIStore.getState(); return useRecordDetailsStore.getState().open || ui.isCommandPaletteOpen || ui.isShortcutOverlayOpen; };
    const focus = (event: Event) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) context.current = read(event.target); };
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'KeyE' && !blocked()) { const auth = useAuthStore.getState(); if (!auth.user || !auth.currentWorkspaceId) return; event.preventDefault(); event.stopPropagation(); const element = document.activeElement; useRecordDetailsStore.getState().show(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? read(element) : context.current); } };
    const reset = useAuthStore.subscribe((next, previous) => { if (next.user?.uid !== previous.user?.uid || next.currentWorkspaceId !== previous.currentWorkspaceId) context.current = undefined; });
    document.addEventListener('focusin', focus); document.addEventListener('change', focus); document.addEventListener('input', focus); document.addEventListener('keydown', key, true);
    return () => { reset(); document.removeEventListener('focusin', focus); document.removeEventListener('change', focus); document.removeEventListener('input', focus); document.removeEventListener('keydown', key, true); };
  }, []);
  return <>{uid && workspace && !open && !palette && !shortcuts && createPortal(<button type="button" onClick={() => useRecordDetailsStore.getState().show(context.current)} aria-label="Edit record details" title="Edit record details (Ctrl/⌘ + Alt + E)" className="fixed right-4 bottom-24 z-[650] min-h-11 px-3 flex items-center gap-2 text-[var(--text)] bg-[var(--surface)] border border-[var(--line)] shadow-lg rounded-lg"><Pencil aria-hidden="true" size={17} /><span className="text-xs">Edit details</span></button>, document.body)}<RecordDetailsDrawer /></>;
}
