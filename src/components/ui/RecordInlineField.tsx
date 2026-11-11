import React, { useState } from 'react';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { assertProjectRenameSafe } from '../../lib/projectRenameGuard';
import InlineEdit, { type InlineEditProps } from './InlineEdit';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { inlineRecordAdapter } from '../../lib/inlineRecordAdapter';
import { inlineFieldValue, saveInlineRecordField, type InlineRecordAdapter, type InlineRecordCollection } from '../../lib/inlineRecordFields';
import { suggestionsFrom } from '../../lib/inlineEdit';

const pending = new Set<string>();
/** Confirmed metadata/planning update. Retain a retry value when the shared editor closes on failure. */
function ScopedRecordInlineField({ collection, record, documentId, field, label, kind, options, display, placeholder, canEdit = true, adapter = inlineRecordAdapter }: {
  collection: InlineRecordCollection; record: object & { id: string }; documentId?: string; field: string; adapter?: InlineRecordAdapter;
} & Pick<InlineEditProps, 'label' | 'kind' | 'options' | 'display' | 'placeholder' | 'canEdit'>) {
  const role = useCurrentRole();
  useLedgerCollections(...(collection === 'dimensionNodes' ? [] : [collection]));
  const records = useLedgerStore(state => state[collection]);
  const [retry, setRetry] = useState<{ value: string | number; message: string }>();
  const [saving, setSaving] = useState(false);
  const [mountedScope] = useState(() => adapter.session());
  const before = inlineFieldValue(record as Record<string, unknown>, field);
  const save = async (value: string | number) => {
    const session = adapter.session(), key = `${session?.uid}:${session?.workspaceId}:${collection}:${documentId || record.id}:${field}`;
    if (pending.has(key)) throw new Error('This field is already saving.');
    pending.add(key); setSaving(true);
    try {
    if (collection === 'projects' && field === 'name') {
      const state = useLedgerStore.getState();
      assertProjectRenameSafe(String(before ?? ''), state.transactions, !!state.truncatedCollections.transactions || !useDataNeedsStore.getState().loaded.transactions || !!useDataNeedsStore.getState().failed.transactions);
    }
      const changes = await saveInlineRecordField(adapter, { collection, id: documentId || record.id }, field, before, value);
      const current = adapter.session();
      if (!current || current.uid !== session?.uid || current.workspaceId !== session?.workspaceId) throw new Error('Workspace changed. Reopen the saved record.');
      // Patch only the changed cache field; never replace a newer record with the rendered snapshot.
      useLedgerStore.setState(state => ({ [collection]: state[collection].map(item => {
        if (item.id !== record.id || collection === 'dimensionNodes' && 'dimensionId' in item && 'dimensionId' in record && item.dimensionId !== record.dimensionId) return item;
        if (field === 'metadata.client') return { ...item, metadata: { ...('metadata' in item ? item.metadata as object : {}), client: value } };
        return { ...item, ...changes };
      }) }));
      setRetry(undefined);
    } catch (error) { setRetry({ value, message: error instanceof Error ? error.message : String(error) }); throw error; }
    finally { pending.delete(key); setSaving(false); }
  };
  const scope = adapter.session();
  const sameScope = scope?.uid === mountedScope?.uid && scope?.workspaceId === mountedScope?.workspaceId;
  return <span className="inline-flex flex-col max-w-full" dir="auto">
    <InlineEdit value={before} label={label} kind={kind} options={options} display={display} placeholder={placeholder} canEdit={canEdit && role !== 'viewer' && sameScope && !saving} suggestions={suggestionsFrom<object>(records, item => inlineFieldValue(item as unknown as Record<string, unknown>, field))} onSave={save} reopenOnFailure={false} />
    {retry && <span role="alert" className="text-xs text-[var(--negative)]">{retry.message} <bdi>{String(retry.value)}</bdi> <button type="button" disabled={saving || role === 'viewer' || !sameScope} onClick={() => { void save(retry.value).catch((err) => { console.warn('[RecordInlineField] Retry failed:', err); }); }} className="underline">Retry {label}</button> <button type="button" onClick={() => setRetry(undefined)} className="underline">Discard retry</button></span>}
  </span>;
}

export function RecordInlineField(props: React.ComponentProps<typeof ScopedRecordInlineField>) {
  const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
  return <ScopedRecordInlineField key={`${uid}:${workspaceId}:${props.collection}:${props.documentId || props.record.id}:${props.field}`} {...props} />;
}
