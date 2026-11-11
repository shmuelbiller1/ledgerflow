/**
 * A-37 (tracker CG-01): owner-defined extra fields on customers, vendors and items. The
 * definitions (text, number, date or a choice) live on the workspace (`customFields`); each
 * record's value lives in its own `metadata.customFields`, so a value is durable with the record
 * and appears in the list and CSV below. Nothing here touches money, stock or posting. The
 * database checks the saved shape (migration 20261014020000_workspace_custom_fields.sql).
 */
import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useEntityOperations } from '../../../hooks/useEntityOperations';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { db } from '../../../firebase';
import { doc, updateDoc } from '../../../lib/db/firestore';
import InlineEdit from '../../ui/InlineEdit';
import { downloadCsv } from '../../../lib/csvExport';
import { secureId } from '../../../lib/secureId';
import ReportTableScroll from '../../reporting/ReportTableScroll';
import {
  coerceCustomField, customFieldColumns, customFieldCsvRow, customFieldProblem, customFieldValues,
  CUSTOM_FIELD_CSV_HEADERS, fieldValueProblem,
  type CustomFieldDef, type CustomFieldEntity, type CustomFieldType,
} from '../../../lib/customFields';

const ENTITY_LABELS: Record<CustomFieldEntity, string> = { customer: 'Customers', vendor: 'Vendors', item: 'Items' };
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text', number: 'Number', date: 'Date (YYYY-MM-DD)', choice: 'Choice',
};
const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

interface RecordLike {
  id: string; name?: string; metadata?: Record<string, unknown>; workspaceId?: string;
}

/**
 * Settings → Custom fields: the definitions, then each record's values. Owners and accountants
 * change the definitions and the values; everyone else reads them. Export always includes the
 * custom-field columns.
 */
export default function CustomFieldsSettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const customers = useLedgerStore(s => s.customers) as RecordLike[];
  const vendors = useLedgerStore(s => s.vendors) as RecordLike[];
  const items = useLedgerStore(s => s.inventory) as RecordLike[];
  const { updateEntity } = useEntityOperations();
  useLedgerCollections('customers', 'vendors', 'inventory');

  const [draft, setDraft] = useState<CustomFieldDef[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [valuesType, setValuesType] = useState<CustomFieldEntity>('customer');

  const saved = (workspace?.customFields || []) as CustomFieldDef[];
  const defs = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  const records = useMemo(() => {
    const lists: Record<CustomFieldEntity, RecordLike[]> = { customer: customers || [], vendor: vendors || [], item: items || [] };
    return lists[valuesType].filter(r => !workspaceId || !r.workspaceId || r.workspaceId === workspaceId)
      .map(r => ({ ...r, name: String(r.name || r.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, vendors, items, valuesType, workspaceId]);
  const columns = customFieldColumns(defs, valuesType);

  const change = (next: CustomFieldDef[]) => setDraft(next);

  const save = async () => {
    const problem = customFieldProblem(defs);
    if (problem) { toast.error(problem); return; }
    if (!workspace?.id) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { customFields: defs, updatedAt: new Date().toISOString() });
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, customFields: defs } : w)));
      setDraft(null);
      toast.success('Custom fields saved');
    } catch {
      toast.error('Could not save the custom fields (owners and accountants can change settings).');
    } finally {
      setBusy(false);
    }
  };

  const saveValue = async (record: RecordLike, key: string, raw: string | number) => {
    const def = defs.find(d => d.entityType === valuesType && d.key === key);
    if (!def) return;
    const coerced = coerceCustomField(def, raw);
    if (!coerced.ok) { toast.error(coerced.reason); return; }
    const current = (record.metadata?.customFields || {}) as Record<string, unknown>;
    const nextValues: Record<string, unknown> = { ...current };
    if (coerced.value === undefined) delete nextValues[key];
    else nextValues[key] = coerced.value;
    await updateEntity(
      valuesType === 'customer' ? 'customers' : valuesType === 'vendor' ? 'vendors' : 'inventory',
      record.id,
      { metadata: { ...(record.metadata || {}), customFields: nextValues } },
      `${def.label} saved on ${record.name}`,
    );
  };

  return (
    <section aria-label="Custom fields" className="p-4 space-y-4 min-w-0">
      <h2>Custom fields</h2>
      <p className="text-sm text-[var(--muted)]">
        Extra fields your business needs on customers, vendors and items — text, number, date or a choice. The
        definitions are kept on this workspace and each record&apos;s value on the record itself, so values survive
        exports and lists. Nothing here changes an amount, a quantity or a posting.
      </p>

      <h3 className="text-sm font-semibold text-[var(--text)]">Definitions</h3>
      <ReportTableScroll>
        <table className="w-full text-sm">
          <caption>Custom field definitions</caption>
          <thead>
            <tr>{['Name', 'Key', 'Kind', 'Options (a choice field)', 'Required', ''].map(head =>
              <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
          </thead>
          <tbody>
            {defs.map((def, index) => (
              <tr key={def.id} className="border-b border-[var(--line)]/50">
                <td className="py-1 px-2">
                  <input aria-label={`Name of field ${index + 1}`} className={`${field} w-40`} dir="auto" disabled={!canChange}
                    value={def.label} onChange={e => change(defs.map(d => (d.id === def.id ? { ...d, label: e.target.value } : d)))} />
                </td>
                <td className="py-1 px-2">
                  <input aria-label={`Key of field ${index + 1}`} className={`${field} w-32`} disabled={!canChange}
                    value={def.key} onChange={e => change(defs.map(d => (d.id === def.id ? { ...d, key: e.target.value } : d)))} />
                </td>
                <td className="py-1 px-2">
                  <select aria-label={`Kind of field ${index + 1}`} className={field} disabled={!canChange} value={def.type}
                    onChange={e => change(defs.map(d => (d.id === def.id ? { ...d, type: e.target.value as CustomFieldType } : d)))}>
                    {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </select>
                </td>
                <td className="py-1 px-2">
                  <input aria-label={`Options of field ${index + 1}`} className={`${field} w-48`} dir="auto" disabled={!canChange || def.type !== 'choice'}
                    placeholder={def.type === 'choice' ? 'A, B, C' : 'Only for a choice field'}
                    value={(def.choices || []).join(', ')}
                    onChange={e => change(defs.map(d => (d.id === def.id
                      ? { ...d, choices: e.target.value.split(',').map(c => c.trim()).filter(Boolean) } : d)))} />
                </td>
                <td className="py-1 px-2">
                  <input type="checkbox" aria-label={`Required field ${index + 1}`} disabled={!canChange}
                    checked={Boolean(def.required)}
                    onChange={e => change(defs.map(d => (d.id === def.id ? { ...d, required: e.target.checked } : d)))} />
                </td>
                <td className="py-1 px-2">
                  <button type="button" aria-label={`Remove field ${index + 1}`} disabled={!canChange}
                    onClick={() => change(defs.filter(d => d.id !== def.id))} className="text-rose-600 hover:underline">
                    <Trash2 size={16} aria-hidden="true" /> Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {defs.length === 0 && <p className="text-sm text-[var(--muted)]">No custom fields yet.</p>}
      </ReportTableScroll>

      {canChange && (
        <div className="flex flex-wrap gap-2" data-print-hide>
          {(Object.keys(ENTITY_LABELS) as CustomFieldEntity[]).map(entityType => (
            <button key={entityType} type="button" disabled={busy}
              onClick={() => {
                const id = secureId('cf_');
                if (!id) { toast.error('Could not create a secure identifier. Try a different browser.'); return; }
                change([...defs, {
                  id, entityType, key: `field${defs.length + 1}`,
                  label: `Field ${defs.length + 1}`, type: 'text',
                }]);
              }}
              className="min-h-11 px-4 rounded border border-[var(--line)] inline-flex items-center gap-1">
              <Plus size={16} aria-hidden="true" /> Add on {ENTITY_LABELS[entityType].toLocaleLowerCase()}
            </button>
          ))}
          <button type="button" disabled={!dirty || busy} onClick={save}
            className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50">
            {busy ? 'Saving…' : 'Save definitions'}
          </button>
          {dirty && <button type="button" disabled={busy} onClick={() => setDraft(null)}
            className="min-h-11 px-4 rounded border border-[var(--line)]">Discard changes</button>}
        </div>
      )}
      {!canChange && <p className="text-sm text-[var(--muted)]">Owners and accountants can change these definitions.</p>}

      <h3 className="text-sm font-semibold text-[var(--text)]">Values</h3>
      <div className="flex flex-wrap items-end gap-3" data-print-hide>
        <label className="flex flex-col gap-1 text-sm">Records
          <select aria-label="Which records" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
            value={valuesType} onChange={e => setValuesType(e.target.value as CustomFieldEntity)}>
            {(Object.keys(ENTITY_LABELS) as CustomFieldEntity[]).map(t =>
              <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
          </select>
        </label>
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!records.length}
          onClick={() => downloadCsv(`custom-fields-${valuesType}`,
            ['Name', ...CUSTOM_FIELD_CSV_HEADERS(defs, valuesType)],
            records.map(r => [r.name, ...customFieldCsvRow(defs, valuesType, (r.metadata?.customFields || {}) as Record<string, unknown>)]))}>
          Export CSV
        </button>
      </div>

      {columns.length === 0 && <p className="text-sm text-[var(--muted)]">
        No custom fields are defined for {ENTITY_LABELS[valuesType].toLocaleLowerCase()} yet. Add one above.
      </p>}
      {columns.length > 0 && (
        <ReportTableScroll>
          <table className="w-full text-sm">
            <caption>Custom field values on {ENTITY_LABELS[valuesType].toLocaleLowerCase()}</caption>
            <thead>
              <tr>{['Name', ...columns.map(c => c.label)].map(head =>
                <th key={head} scope="col" className="text-left py-1 px-2">{head}</th>)}</tr>
            </thead>
            <tbody>
              {records.map(record => (
                <tr key={record.id} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{record.name}</bdi></th>
                  {columns.map(column => {
                    const def = defs.find(d => d.entityType === valuesType && d.key === column.key);
                    const values = (record.metadata?.customFields || {}) as Record<string, unknown>;
                    const entry = def ? customFieldValues([def], valuesType, values)[0] : undefined;
                    return (
                      <td key={column.key} className="py-1 px-2">
                        {def ? (
                          <InlineEdit
                            kind={def.type === 'choice' ? 'select' : def.type}
                            options={def.type === 'choice' ? (def.choices || []).map(c => ({ value: c, label: c })) : undefined}
                            value={entry?.value}
                            label={`${def.label} of ${record.name}`}
                            canEdit={canChange}
                            placeholder="—"
                            validate={next => fieldValueProblem(def, next)}
                            onSave={next => saveValue(record, column.key, next)}
                          />
                        ) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {records.length === 0 && <p className="text-sm text-[var(--muted)]">No records are loaded for this workspace.</p>}
        </ReportTableScroll>
      )}

      <p className="text-xs text-[var(--muted)]">
        A required field must carry a value before its record can be saved elsewhere; here an empty value is shown as
        missing rather than invented. A choice field keeps only its listed options. Values live in each record&apos;s
        own metadata; exports and lists read them from there.
      </p>
    </section>
  );
}
