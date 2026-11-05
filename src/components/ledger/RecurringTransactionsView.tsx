import React, { useMemo, useState } from 'react';
import { 
  RefreshCw, 
  Plus, 
  Search, 
  Calendar, 
  Clock, 
  Play, 
  Pause, 
  Trash2,
  AlertCircle,
  FileText,
  DollarSign,
  Receipt
} from 'lucide-react';
import InlineEdit from '../ui/InlineEdit';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { RecurringTransaction } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { format, parseISO, addDays } from 'date-fns';
import { cn } from '../../lib/utils';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useRecordFocus, recordElementId } from '../../hooks/useRecordFocus';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LoadingState } from '../ui/LoadingState';
import { inBackground } from '../../lib/inBackground';

/**
 * Recurring invoices and entries. The daily job (src/server/services/recurringService.ts) runs
 * the active ones: an invoice becomes a draft to review and send; an entry is posted. Pause
 * stops a schedule until it is resumed (BE-03).
 */
const FREQUENCIES: RecurringTransaction['frequency'][] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

export default function RecurringTransactionsView() {
  const recurring = useLedgerStore(s => s.recurring);
  const [searchTerm, setSearchTerm] = useState('');
  const focusedId = useRecordFocus('recurring', { ready: recurring.length > 0, onFocus: () => setSearchTerm('') });
  const { loading } = useLedgerCollections('recurring');
  const { updateEntity, deleteEntity } = useEntityOperations();
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant' || role === 'bookkeeper';

  const togglePause = (rule: RecurringTransaction) => updateEntity('recurring', rule.id,
    { isActive: !rule.isActive, status: rule.isActive ? 'paused' : 'active' },
    rule.isActive ? `Paused: ${rule.description}` : `Resumed: ${rule.description}`);

  const remove = (rule: RecurringTransaction) => {
    if (!window.confirm(`Delete the schedule "${rule.description}"? Invoices and entries it already created stay.`)) return;
    inBackground(deleteEntity('recurring', rule.id, 'Schedule deleted'));
  };

  const filteredRecurring = useMemo(() => {
    return recurring.filter(r => 
      r.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.payee?.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => (a.nextOccurrence || '').localeCompare(b.nextOccurrence || ''));
  }, [recurring, searchTerm]);

  const getFrequencyLabel = (freq: string) => {
    switch (freq) {
      case 'daily': return 'Daily';
      case 'weekly': return 'Weekly';
      case 'monthly': return 'Monthly';
      case 'quarterly': return 'Quarterly';
      case 'yearly': return 'Yearly';
      default: return freq;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'paused': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'completed': return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';
      default: return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between p-6 border-b border-[var(--line)] bg-[var(--surface)] gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 bg-indigo-500/10 text-indigo-500 rounded-xl flex items-center justify-center">
            <RefreshCw aria-hidden="true" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Recurring Transactions</h1>
            <p className="text-zinc-500 text-sm">Automate your regular invoices, bills, and journal entries</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search aria-hidden="true" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-indigo-500 transition-colors" />
            <input aria-label="Search recurring templates"
              type="text"
              placeholder="Search templates..."
              className="pl-10 pr-4 py-2 bg-[var(--bg)] border border-[var(--line)] rounded-lg text-sm w-full md:w-64 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <p className="text-xs text-zinc-500 max-w-[220px]">
            <Plus size={12} className="inline" aria-hidden="true" /> New recurring invoice: create an invoice in Sales and choose "Recurring".
          </p>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6 bg-[var(--bg)]">
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Active Rules</p>
          <p className="text-2xl font-bold text-[var(--text)]">{recurring.filter(r => r.isActive).length}</p>
        </div>
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Monthly Volume</p>
          <p className="text-2xl font-bold text-emerald-500">
            {formatCurrency(recurring.filter(r => r.isActive && r.frequency === 'monthly').reduce((acc, curr) => acc + (curr.amountCents || 0), 0))}
          </p>
        </div>
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Next 7 Days</p>
          <p className="text-2xl font-bold text-indigo-500">
            {recurring.filter(r => r.isActive && r.nextOccurrence && new Date(r.nextOccurrence) <= addDays(new Date(), 7)).length}
          </p>
        </div>
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--line)]">
          <p className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Total Automated</p>
          <p className="text-2xl font-bold text-zinc-500">{recurring.length}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 pt-0">
        <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">Recurring Transactions</caption>
            <thead>
              <tr className="bg-[var(--bg)]/50 text-[10px] uppercase font-bold text-zinc-500 tracking-widest border-b border-[var(--line)]">
                <th scope="col" className="px-6 py-4">Template Description</th>
                <th scope="col" className="px-6 py-4">Frequency</th>
                <th scope="col" className="px-6 py-4">Last Run</th>
                <th scope="col" className="px-6 py-4">Next Occurrence</th>
                <th scope="col" className="px-6 py-4 text-right">Amount</th>
                <th scope="col" className="px-6 py-4">Status</th>
                <th scope="col" className="px-6 py-4 w-20"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredRecurring.map((rule) => (
                <tr key={rule.id} id={recordElementId('recurring', rule.id)} aria-current={focusedId === rule.id ? 'true' : undefined}
                  className={cn("hover:bg-zinc-500/5 transition-colors group", focusedId === rule.id && "ring-2 ring-inset ring-[var(--brass)]")}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-zinc-500/10 text-zinc-500 flex items-center justify-center shrink-0">
                        {(rule.type === 'invoice' || rule.invoiceTemplate || rule.template?.tags?.includes('invoice')) ? <FileText aria-hidden="true" size={16} aria-label="Invoice" />
                          : rule.type === 'bill' ? <Receipt aria-hidden="true" size={16} aria-label="Bill" /> : <DollarSign aria-hidden="true" size={16} aria-label="Entry" />}
                      </div>
                      <div>
                        <InlineEdit value={rule.description} label={`Name of schedule ${rule.description}`} canEdit={canEdit}
                          validate={v => (String(v).trim() ? null : 'A schedule needs a name')}
                          onSave={v => updateEntity('recurring', rule.id, { description: String(v) }, 'Name saved')}
                          className="text-sm font-semibold text-[var(--text)]" />
                        <p className="text-xs text-zinc-500">{rule.payee || 'Internal Transfer'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-[var(--text)]">
                      <Clock aria-hidden="true" size={14} className="text-zinc-400" />
                      <InlineEdit kind="select" value={rule.frequency} label={`How often ${rule.description} runs`} canEdit={canEdit}
                        options={FREQUENCIES.map(f => ({ value: f, label: getFrequencyLabel(f) }))} display={getFrequencyLabel(rule.frequency)}
                        onSave={v => updateEntity('recurring', rule.id, { frequency: String(v) as RecurringTransaction['frequency'] }, 'Saved')} />
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-[var(--text)]">
                      {rule.lastOccurrence ? format(parseISO(rule.lastOccurrence), 'MMM dd, yyyy') : 'Never'}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-indigo-500">
                      <Calendar aria-hidden="true" size={14} />
                      {/* the next date also sets the day of the month it keeps to */}
                      <InlineEdit kind="date" value={rule.nextOccurrence} label={`Next date of ${rule.description}`} canEdit={canEdit}
                        display={rule.nextOccurrence ? format(parseISO(rule.nextOccurrence), 'MMM dd, yyyy') : 'Not scheduled'}
                        validate={v => (!v ? 'Enter a date' : rule.lastOccurrence && String(v) <= rule.lastOccurrence ? `After the last run (${rule.lastOccurrence})` : null)}
                        onSave={v => updateEntity('recurring', rule.id, { nextOccurrence: String(v), anchorDay: Number(String(v).slice(8, 10)) }, 'Next date saved')} />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className="text-sm font-bold text-[var(--text)]">
                      {formatCurrency(rule.amountCents || 0)}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                      getStatusColor(rule.isActive ? 'active' : 'paused')
                    )}>
                      {rule.isActive ? 'active' : 'paused'}
                    </span>
                    {rule.lastErrorCode && (
                      <p className="mt-1 max-w-[220px] text-[11px] text-[var(--neg)]" title={rule.lastErrorAt || ''}>
                        <AlertCircle size={11} className="inline mr-1" aria-hidden="true" />{rule.lastErrorCode}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => togglePause(rule)}
                          className="p-1.5 text-zinc-400 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-lg transition-all"
                          aria-label={rule.isActive ? `Pause ${rule.description}` : `Resume ${rule.description}`} title={rule.isActive ? 'Pause' : 'Resume'}>
                          {rule.isActive ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                        </button>
                        <button type="button" onClick={() => remove(rule)}
                          className="p-1.5 text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"
                          aria-label={`Delete ${rule.description}`} title="Delete">
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filteredRecurring.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                    {loading ? <LoadingState what="recurring schedules" /> : (<>
                    <RefreshCw aria-hidden="true" size={48} className="mx-auto mb-4 opacity-10" />
                    <p className="text-sm font-medium">No recurring invoices or entries yet</p>
                    <p className="mt-2 text-xs">Create an invoice in Sales and choose "Recurring" to send the same invoice on a schedule.</p>
                    </>)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
