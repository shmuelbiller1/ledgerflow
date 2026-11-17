import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import type { InventoryItem } from '../../types';
import { categoryCounts, renameCategoryPlan } from '../../lib/itemCategories';
import { renameItemCategory } from '../../lib/recordWrites';
import { useAuthStore } from '../../stores/useAuthStore';
import { stockFieldClass } from './stockStyles';

interface CategoryManagerDialogProps {
  items: InventoryItem[];
  onClose: () => void;
}

/**
 * Rename, merge or remove an item category on every item at once (BA-05), in one database
 * transaction. Renaming to a category that already exists merges the two.
 */
export default function CategoryManagerDialog({ items, onClose }: CategoryManagerDialogProps) {
  const categories = useMemo(() => categoryCounts(items), [items]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { dialogProps, titleId } = useDialog(onClose, true);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);

  const apply = async (from: string, to: string) => {
    const plan = renameCategoryPlan(items, from, to);
    if (plan.ids.length === 0) return;
    setSaving(from);
    try {
      // `inventory.categoryrename` renames every item the server holds, not just the ones this page had loaded
      await renameItemCategory(workspaceId || '', from, plan.to, plan.ids);
      toast.success(plan.to
        ? `${plan.ids.length} item${plan.ids.length === 1 ? '' : 's'} moved from "${from}" to "${plan.to}"`
        : `"${from}" removed from ${plan.ids.length} item${plan.ids.length === 1 ? '' : 's'}`);
      setDrafts(d => { const next = { ...d }; delete next[from]; return next; });
    } catch (err) {
      toast.error(`Categories not changed: ${(err as Error).message}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Item categories</h2>
            <p className="text-xs text-[var(--muted)]">Rename a category on all its items. A name that already exists merges the two.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close item categories" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <ul className="p-5 space-y-3 overflow-y-auto">
          {categories.length === 0 && <li className="text-sm text-[var(--muted)]">No categories yet. Add one in an item&apos;s Category field.</li>}
          {categories.map(({ name, count }) => {
            const draft = drafts[name] ?? name;
            const plan = renameCategoryPlan(items, name, draft);
            return (
              <li key={name} className="flex flex-wrap items-center gap-2">
                <input aria-label={`New name for ${name}`} value={draft} onChange={e => setDrafts(d => ({ ...d, [name]: e.target.value }))} className={`${stockFieldClass} flex-1 min-w-[10rem]`} />
                <span className="text-xs text-[var(--muted)] tabular-nums w-16">{count} item{count === 1 ? '' : 's'}</span>
                <button type="button" disabled={saving !== null || plan.ids.length === 0} onClick={() => apply(name, draft)}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-700 text-white disabled:opacity-40">
                  {!plan.to ? 'Remove' : plan.merges ? `Merge into ${plan.to}` : 'Rename'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
