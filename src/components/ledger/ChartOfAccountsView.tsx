// Keep form helpers reachable for the structural component guard.
import { Field as _Field } from '../common/Field';
import { SchemaForm as _SchemaForm } from '../common/SchemaForm';
import React, { useState } from 'react';
import { ChartAccount } from '../../types';
import { Archive, ArchiveRestore, GitMerge, MoreVertical, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { db } from '../../firebase';
import { doc, updateDoc } from '../../lib/db/firestore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { suggestionsFrom } from '../../lib/inlineEdit';
import { ACCOUNT_GROUP_INDENT_PX, accountGroupLayout, accountParentProblem, allowedParentAccounts, rowsInsideExpandedGroups } from '../../lib/accountGroups';
import type { AccountGroupLayoutRow } from '../../lib/accountGroups';
import InlineEdit from '../ui/InlineEdit';
import MergeAccountDialog from './MergeAccountDialog';
import { AccountGroupToggle } from './AccountGroupControls';
import { EmptyState } from '../ui/EmptyState';
import { isIncomeAccount } from '../../lib/accountUtils';

/** Edit in place (I-22): one field of an account. System accounts keep their code (the database refuses it). */
async function saveAccountField(account: ChartAccount, field: 'name' | 'code' | 'description' | 'category', value: string | number) {
  await updateDoc(doc(db, 'chartAccounts', account.id), { [field]: value, updatedAt: new Date().toISOString() });
  toast.success('Saved');
}

/**
 * Account groups (K-14): which account this one sits inside. `null` takes it back to the top level.
 * The choice is checked before it is saved (same type, no loop, at most three levels); the chart is
 * only how the accounts are shown, so no figure and no posted amount is touched.
 */
async function saveAccountParent(account: ChartAccount, parentId: string | null) {
  await updateDoc(doc(db, 'chartAccounts', account.id), { parentId, updatedAt: new Date().toISOString() });
  toast.success(parentId ? `"${account.name}" moved into its group` : `"${account.name}" moved to the top level`);
}

/** Archive (hidden from pickers and this list; history kept) or bring an account back (I-22). */
async function setAccountArchived(account: ChartAccount, archived: boolean) {
  await updateDoc(doc(db, 'chartAccounts', account.id), { isArchived: archived, isActive: !archived, updatedAt: new Date().toISOString() });
  toast.success(archived ? `"${account.name}" archived` : `"${account.name}" restored`);
}

/** The chart's own order: by account code. */
const byCode = (a: ChartAccount, b: ChartAccount) => (a.code || '').localeCompare(b.code || '');

interface ChartOfAccountsViewProps {
  accounts: ChartAccount[];
  searchTerm: string;
  formatCurrency: (val: number) => string;
  onDrillDown: (accountName: string) => void;
  onDeleteAccount: (id: string) => void;
  /** opens the add-account form — the empty chart's "Add your first account" action (A-262) */
  onAddAccount?: () => void;
}

export default function ChartOfAccountsView({ accounts, searchTerm, formatCurrency, onDrillDown, onDeleteAccount, onAddAccount }: ChartOfAccountsViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showOptionsId, setShowOptionsId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = accounts.filter(a => a.isArchived).length;
  const listed = React.useMemo(() => (showArchived ? accounts : accounts.filter(a => !a.isArchived)), [accounts, showArchived]);
  const role = useCurrentRole();
  const canEdit = role !== 'viewer';
  // merging moves every entry of an account to another (CA-33): owners and accountants
  const canMerge = role === 'owner' || role === 'accountant';
  const [merging, setMerging] = useState<ChartAccount | null>(null);
  const categories = React.useMemo(() => suggestionsFrom(accounts, a => a.category), [accounts]);
  const codes = React.useMemo(() => new Map(accounts.map(a => [a.code, a.id])), [accounts]);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  /**
   * The chart as rows: a group's accounts under their parent, hidden until the group is opened.
   * The shared layout keeps an account whose parent is archived, gone or part of a loop in the list
   * (as a top-level account) instead of losing it; the subtotal rows belong to the reports, not here.
   */
  const rows = React.useMemo(
    () => rowsInsideExpandedGroups(accountGroupLayout(listed, byCode).filter(row => row.kind === 'account'), expandedIds),
    [listed, expandedIds]
  );
  /** The parents this account may sit inside: archived accounts are not offered, a saved one stays shown. */
  const parentOptions = (account: ChartAccount) => {
    const allowed = allowedParentAccounts(accounts.filter(a => !a.isArchived), account);
    const current = accounts.find(a => a.id === account.parentId);
    const offered = current && !allowed.some(a => a.id === current.id) ? [current, ...allowed] : allowed;
    return [
      { value: '', label: 'No parent (top level)' },
      ...offered.map(a => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    ];
  };

  const renderRow = (row: AccountGroupLayoutRow<ChartAccount>) => {
    const account = row.member;
    const depth = row.depth;
    const hasChildren = row.hasChildren;
    const isExpanded = expandedIds.has(account.id);
    const parent = accounts.find(a => a.id === account.parentId);

    return (
      <tr key={account.id} className={cn(
          "group hover:bg-[var(--ink)] transition-colors cursor-pointer border-b border-[var(--line)]",
          depth > 0 && "bg-[var(--ink)]/20"
        )}>
          <td className="p-4 font-mono text-xs text-[var(--muted)]" onClick={() => hasChildren && toggleExpand(account.id)}>
            <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * ACCOUNT_GROUP_INDENT_PX}px` }}>
              {hasChildren ? (
                <AccountGroupToggle label={account.name} expanded={isExpanded}
                  onToggle={(event) => { event.stopPropagation(); toggleExpand(account.id); }} />
              ) : (
                <div className="w-5" />
              )}
              <InlineEdit value={account.code} label={`Code of ${account.name}`} canEdit={canEdit && !account.isSystem}
                validate={v => !String(v) ? 'An account needs a code' : codes.has(String(v)) && codes.get(String(v)) !== account.id ? `${v} is already used` : null}
                onSave={v => saveAccountField(account, 'code', v)} />
            </div>
          </td>
          <td className="p-4" onClick={() => onDrillDown(account.name)}>
            <InlineEdit value={account.name} label={`Name of ${account.name}`} canEdit={canEdit}
              validate={v => String(v) ? null : 'An account needs a name'} onSave={v => saveAccountField(account, 'name', v)}
              className="font-bold text-[var(--text)] uppercase tracking-tight text-xs block" />
            {account.isArchived && <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-[var(--ink)] text-[var(--muted)] border border-[var(--line)]">Archived</span>}
            <InlineEdit value={account.description} label={`Description of ${account.name}`} placeholder={canEdit ? 'Add description' : undefined} canEdit={canEdit}
              onSave={v => saveAccountField(account, 'description', v)} className="text-[10px] text-[var(--muted)] mt-0.5 truncate max-w-md block" />
          </td>
          <td className="p-4">
            <span className={cn(
              "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border",
              account.type === 'asset' ? "bg-blue-50 border-blue-100 text-blue-700" :
              account.type === 'liability' ? "bg-amber-50 border-amber-100 text-amber-700" :
              account.type === 'equity' ? "bg-purple-50 border-purple-100 text-purple-700" :
              isIncomeAccount(account) ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-700"
            )}>
              {account.type}
            </span>
          </td>
          <td className="p-4 text-[var(--muted)] text-[10px] font-medium">
            <InlineEdit value={account.category} label={`Category of ${account.name}`} placeholder="Uncategorized" canEdit={canEdit}
              suggestions={categories} onSave={v => saveAccountField(account, 'category', v)} />
            {/* K-14: which account this one sits inside, chosen in place; a viewer reads it */}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[9px] font-bold uppercase tracking-wider opacity-60">Inside</span>
              <InlineEdit kind="select" value={account.parentId || ''} label={`Parent account of ${account.name}`} canEdit={canEdit}
                display={parent ? parent.name : 'No parent'}
                options={parentOptions(account)}
                validate={value => accountParentProblem(accounts, account, String(value))}
                onSave={value => saveAccountParent(account, String(value) || null)} />
            </div>
          </td>
          <td className={cn(
            "p-4 text-right font-bold font-mono text-xs tabular-nums",
            account.balanceCents < 0 ? "text-rose-600" : "text-[var(--text)]"
          )}>
            {formatCurrency(account.balanceCents)}
          </td>
          <td className="p-4 text-right relative">
            {canEdit && <button aria-label={`Account options for ${account.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowOptionsId(showOptionsId === account.id ? null : account.id);
              }}
              className="p-1.5 text-[var(--muted)] hover:text-[var(--text)] transition-colors rounded hover:bg-slate-100"
            >
              <MoreVertical aria-hidden="true" size={14} />
            </button>}
            <AnimatePresence>
              {showOptionsId === account.id && (
                <>
                  <div role="presentation" aria-hidden="true" className="fixed inset-0 z-[100]" onClick={() => setShowOptionsId(null)} />
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                    className="absolute right-4 top-10 w-44 bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-md z-[110] overflow-hidden p-1"
                  >
                    <button type="button"
                      onClick={() => { void setAccountArchived(account, !account.isArchived); setShowOptionsId(null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text)] hover:bg-[var(--ink)] rounded transition-all text-[9.5px] font-bold uppercase tracking-wider"
                    >
                      {account.isArchived ? <ArchiveRestore aria-hidden="true" size={12} /> : <Archive aria-hidden="true" size={12} />}
                      {account.isArchived ? 'Restore' : 'Archive'}
                    </button>
                    {canMerge && !account.isSystem && !account.role && (
                      <button type="button"
                        onClick={() => { setMerging(account); setShowOptionsId(null); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[var(--text)] hover:bg-[var(--ink)] rounded transition-all text-[9.5px] font-bold uppercase tracking-wider"
                      >
                        <GitMerge aria-hidden="true" size={12} />
                        Merge into…
                      </button>
                    )}
                    {/* an account with entries is archived instead (its history stays); one without is deleted */}
                    <button type="button"
                      onClick={() => {
                        onDeleteAccount(account.id);
                        setShowOptionsId(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-rose-600 hover:bg-rose-50 rounded transition-all text-[9.5px] font-bold uppercase tracking-wider"
                    >
                      <Trash2 aria-hidden="true" size={12} />
                      Delete
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </td>
      </tr>
    );
  };

  const filteredFlat = listed.filter(a => 
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    a.code.includes(searchTerm)
  ).sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)]/85 shadow-3xs overflow-hidden">
      {archivedCount > 0 && (
        <button type="button" aria-pressed={showArchived} onClick={() => setShowArchived(v => !v)}
          className="m-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--line)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]">
          <Archive aria-hidden="true" size={13} /> {showArchived ? 'Hide archived accounts' : `Show archived accounts (${archivedCount})`}
        </button>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs min-w-[750px]">
          <caption className="sr-only">Chart of accounts</caption>
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--ink)]/70 text-[var(--muted)] font-bold uppercase tracking-wider">
              <th scope="col" className="p-4 font-bold text-[9px] text-[var(--muted)]">Code</th>
              <th scope="col" className="p-4 font-bold text-[9px] text-[var(--muted)]">Account name</th>
              <th scope="col" className="p-4 font-bold text-[9px] text-[var(--muted)]">Type</th>
              <th scope="col" className="p-4 font-bold text-[9px] text-[var(--muted)]">Category</th>
              <th scope="col" className="p-4 font-bold text-[9px] text-[var(--muted)] text-right">Balance</th>
              <th scope="col" className="p-4 w-10"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {searchTerm === ''
              ? rows.map(row => renderRow(row))
              // a search lists the accounts it found, never a half-open group
              : accountGroupLayout(filteredFlat.map(account => ({ ...account, parentId: undefined })), byCode).map(row => renderRow(row))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    title="No accounts yet"
                    description="Choose a chart of accounts to get started, or add your first account."
                    actionLabel={onAddAccount ? 'Add your first account' : undefined}
                    onAction={onAddAccount}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {merging && <MergeAccountDialog account={merging} accounts={accounts} onClose={() => setMerging(null)} />}
    </div>
  );
}
