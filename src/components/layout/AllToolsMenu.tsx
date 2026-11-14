import { useState } from 'react';
import { APP_TABS, isTabVisible } from '../../config/registry';
import { normalizeSearchText } from '../../lib/textNormalization';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { useButtonOrder } from '../../hooks/useButtonOrder';
import { useDragReorder } from '../../hooks/useDragReorder';
import ButtonOrderNote from '../ui/ButtonOrderNote';

/** The product's own order of every tool; each person may drag the list into their own. */
const ALL_TOOL_IDS = APP_TABS.map(tab => tab.id);

/** A discovery path, independent of business recommendations and Pro mode. Permission/module gates remain. */
export default function AllToolsMenu({ onSelect, activeTab }: { onSelect: (id: string) => void; /** the page that is open, so its button shows it */ activeTab?: string }) {
  const [query, setQuery] = useState('');
  const isOwner = useAuthStore(s => s.isAdmin);
  const modules = useAuthStore(s => s.getCurrentWorkspace()?.modules);
  const developerMode = useUIStore(s => s.developerMode);
  const language = useUIStore(s => s.language);
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  // The person's own order (dragging, or Alt+↑/↓) only sorts the list: what is listed is still
  // decided by the permission and module checks and the search below.
  const order = useButtonOrder('sidebar.all', ALL_TOOL_IDS);
  const labelOf = (id: string) => { const tab = APP_TABS.find(t => t.id === id); return tab?.label[language] || tab?.label.en || id; };
  const tools = order.orderedIds.flatMap(id => {
    const tab = APP_TABS.find(t => t.id === id);
    return tab && isTabVisible(tab, { isOwner, modules, developerMode, isProMode: false, showAll: true }) && words.every(word => normalizeSearchText(`${tab.label[language] || tab.label.en} ${tab.label.en} ${tab.id}`).includes(word)) ? [tab] : [];
  });
  const toolIds = tools.map(tab => tab.id);
  const reorder = useDragReorder({ ids: toolIds, labelFor: labelOf, onMove: order.move, onStep: (id, delta) => order.step(id, delta, toolIds) });
  return <details className="border-t border-[var(--line)] pt-2">
    <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--brass)]">Show all tools</summary>
    <div className="space-y-2 py-2">
      <label className="block text-xs px-1">Find a tool
        <input type="search" className="mt-1 w-full min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-sm" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <p className="text-xs text-[var(--muted)] px-1">Business type and Pro mode do not hide tools here. Disabled modules stay in Settings → Modules. Drag a tool to put the list in your own order.</p>
      <div role="navigation" aria-label="All tools" className="space-y-1">
        {tools.map(tab => {
          const isActive = activeTab === tab.id;
          return <button key={tab.id} type="button" {...reorder.itemProps(tab.id)} aria-current={isActive ? 'page' : undefined}
            className={cn("w-full min-h-11 rounded-lg border px-3 py-2 text-start text-sm focus-visible:outline-2 focus-visible:outline-[var(--brass)]", isActive ? "border-[var(--brass-line)] bg-[var(--brass-soft)] font-semibold text-[var(--text)]" : "border-transparent hover:bg-[var(--elevated)]")}
            onClick={() => onSelect(tab.id)}>{tab.label[language] || tab.label.en}</button>;
        })}
      </div>
      <ButtonOrderNote listName="all tools" isCustom={order.isCustom} onReset={order.reset} status={reorder.status} storageError={order.storageError} />
      {!tools.length && <p role="status" className="text-xs px-1">No tools matched. Try another name.</p>}
    </div>
  </details>;
}
