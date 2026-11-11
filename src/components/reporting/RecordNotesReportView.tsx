/**
 * A-36: record notes on a screen. Search every note that is kept on a customer, vendor, item,
 * invoice, bill, estimate, entry or project — "why did we…" answered from one place — and open a
 * record to read its notes or add one there. Notes live on the record's own metadata and change
 * no amount. Only the records loaded for this workspace are listed; a capped collection is said
 * so in plain words.
 */
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { NOTE_COLLECTIONS, noteCountsByType, notePreview, recordNotesFromMetadata, searchRecordNotes, type NoteableType, type NoteCollection, type RecordNote } from '../../lib/recordNotes';
import RecordNotesPanel from '../common/RecordNotesPanel';
import ReportTableScroll from './ReportTableScroll';

interface CatalogRow {
  entityType: NoteableType;
  entityId: string;
  name: string;
  metadata?: Record<string, unknown> | null;
  collection: NoteCollection;
}

const TYPE_LABELS: Record<NoteableType, string> = {
  customer: 'Customers', vendor: 'Vendors', item: 'Items', invoice: 'Invoices',
  bill: 'Bills', estimate: 'Estimates', transaction: 'Entries', project: 'Projects',
};

type LoadedRecord = {
  id: string; name?: string; number?: string; description?: string;
  metadata?: Record<string, unknown>; workspaceId?: string;
};

const recordName = (r: LoadedRecord) => String(r.name || r.number || r.description || r.id);

export default function RecordNotesReportView() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const canEdit = useCurrentRole() !== 'viewer';
  const truncated = useLedgerStore(s => s.truncatedCollections);
  const failed = useDataNeedsStore(s => s.failed);
  const { loading } = useLedgerCollections('customers', 'vendors', 'inventory', 'invoices', 'bills', 'estimates', 'projects');
  const customers = useLedgerStore(s => s.customers) as LoadedRecord[];
  const vendors = useLedgerStore(s => s.vendors) as LoadedRecord[];
  const items = useLedgerStore(s => s.inventory) as LoadedRecord[];
  const invoices = useLedgerStore(s => s.invoices) as LoadedRecord[];
  const bills = useLedgerStore(s => s.bills) as LoadedRecord[];
  const estimates = useLedgerStore(s => s.estimates) as LoadedRecord[];
  const transactions = useLedgerStore(s => s.transactions) as LoadedRecord[];
  const projects = useLedgerStore(s => s.projects) as LoadedRecord[];
  const [query, setQuery] = useState('');
  const [type, setType] = useState<NoteableType>('customer');
  const [selectedId, setSelectedId] = useState('');

  const catalog = useMemo(() => {
    const rows: CatalogRow[] = [];
    const lists: Array<[NoteableType, LoadedRecord[]]> = [
      ['customer', customers], ['vendor', vendors], ['item', items], ['invoice', invoices],
      ['bill', bills], ['estimate', estimates], ['transaction', transactions], ['project', projects],
    ];
    for (const [entityType, records] of lists) {
      for (const record of records || []) {
        if (workspaceId && record.workspaceId && record.workspaceId !== workspaceId) continue;
        rows.push({
          entityType, entityId: record.id, name: recordName(record),
          metadata: record.metadata, collection: NOTE_COLLECTIONS[entityType],
        });
      }
    }
    return rows;
  }, [workspaceId, customers, vendors, items, invoices, bills, estimates, transactions, projects]);

  const allNotes = useMemo(() => {
    const notes: RecordNote[] = [];
    for (const row of catalog) {
      for (const note of recordNotesFromMetadata(row.metadata)) {
        if (note.workspaceId && workspaceId && note.workspaceId !== workspaceId) continue;
        notes.push(note);
      }
    }
    return notes;
  }, [catalog, workspaceId]);
  const nameOfNote = (note: RecordNote) =>
    catalog.find(r => r.entityType === note.entityType && r.entityId === note.entityId)?.name || note.entityId;

  const matches = query.trim() ? searchRecordNotes(allNotes, query) : [];
  const counts = noteCountsByType(allNotes);
  const ofType = catalog.filter(row => row.entityType === type).sort((a, b) => a.name.localeCompare(b.name));
  const selected = ofType.find(row => row.entityId === selectedId) || ofType[0];
  const partial = Object.keys(NOTE_COLLECTIONS).some((t) => {
    const key = NOTE_COLLECTIONS[t as NoteableType] === 'inventory' ? 'inventory' : NOTE_COLLECTIONS[t as NoteableType];
    return Boolean(isCollectionCapped(truncated, key) || failed[key]);
  });

  return (
    <section aria-label="Record notes" className="p-4 space-y-4 min-w-0">
      <h2>Record notes</h2>
      <p className="text-sm text-[var(--muted)]">
        Every note kept on a customer, vendor, item, invoice, bill, estimate, entry or project, with who wrote it and
        when. Search finds a note by any word in it, its author or its record. Notes are kept on each record and never
        change an amount; a change to a document in a locked period is refused by the period lock.
      </p>

      {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading records…</p>}
      {partial && <p role="alert" className="text-sm text-[var(--muted)]">
        Some lists are capped or failed at the database. Notes on records outside the loaded part are not shown here.
      </p>}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">Search every note
          <input type="search" aria-label="Search every note" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="A word, an author or a record" dir="auto"
            className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)] w-72" />
        </label>
        <p className="text-sm text-[var(--muted)]">
          {allNotes.length} note(s) recorded{query.trim() ? ` · ${matches.length} match this search` : ''}
        </p>
      </div>

      {query.trim() && (
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption>Notes matching the search</caption>
            <thead>
              <tr>{['Note', 'Author', 'Record', 'Kind', 'When'].map(head =>
                <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
            </thead>
            <tbody>
              {matches.map(note => {
                const row = catalog.find(r => r.entityId === note.entityId && r.entityType === note.entityType);
                return (
                  <tr key={`${note.entityType}:${note.entityId}:${note.id}`} className="border-b border-[var(--line)]/50">
                    <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{notePreview(note, 120)}</bdi></th>
                    <td className="py-1 px-2"><bdi>{note.authorName || '—'}</bdi></td>
                    <td className="py-1 px-2">
                      <button type="button" className="text-left hover:underline" dir="auto"
                        aria-label={`Open notes on ${nameOfNote(note)}`}
                        onClick={() => {
                          if (!row) return;
                          setType(row.entityType);
                          setSelectedId(row.entityId);
                        }}>
                        <bdi>{nameOfNote(note)}</bdi>
                      </button>
                    </td>
                    <td className="py-1 px-2">{TYPE_LABELS[note.entityType]}</td>
                    <td className="py-1 px-2">{new Date(note.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {matches.length === 0 && <p className="text-sm text-[var(--muted)]">No note matches this search.</p>}
        </ReportTableScroll>
      )}

      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">Record kind
          <select aria-label="Record kind" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
            value={type} onChange={e => { setType(e.target.value as NoteableType); setSelectedId(''); }}>
            {(Object.keys(TYPE_LABELS) as NoteableType[]).map(t =>
              <option key={t} value={t}>{TYPE_LABELS[t]} ({counts[t]})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Record
          <select aria-label="Record" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)] max-w-md"
            value={selected?.entityId || ''} onChange={e => setSelectedId(e.target.value)}>
            {ofType.map(row => <option key={row.entityId} value={row.entityId}>{row.name}</option>)}
          </select>
        </label>
      </div>

      {ofType.length === 0 && <p className="text-sm text-[var(--muted)]">No {TYPE_LABELS[type].toLocaleLowerCase()} are loaded for this workspace.</p>}
      {selected && (
        <div className="border border-[var(--line)] rounded p-3 max-w-3xl">
          <RecordNotesPanel key={`${selected.entityType}:${selected.entityId}`}
            entityType={selected.entityType} entityId={selected.entityId} entityName={selected.name}
            metadata={selected.metadata} canEdit={canEdit} />
        </div>
      )}
    </section>
  );
}
