import { useState } from 'react';
import { APP_TABS, isTabVisible } from '../../config/registry';
import { normalizeSearchText } from '../../lib/textNormalization';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';

/** A discovery path, independent of business recommendations and Pro mode. Permission/module gates remain. */
export default function AllToolsMenu({ onSelect }: { onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const isOwner = useAuthStore(s => s.isAdmin);
  const modules = useAuthStore(s => s.getCurrentWorkspace()?.modules);
  const developerMode = useUIStore(s => s.developerMode);
  const language = useUIStore(s => s.language);
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const tools = APP_TABS.filter(tab => isTabVisible(tab, { isOwner, modules, developerMode, isProMode: false, showAll: true }) && words.every(word => normalizeSearchText(`${tab.label[language] || tab.label.en} ${tab.label.en} ${tab.id}`).includes(word)));
  return <details className="border-t border-[var(--line)] pt-2">
    <summary className="min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--brass)]">Show all tools</summary>
    <div className="space-y-2 py-2">
      <label className="block text-xs px-1">Find a tool
        <input type="search" className="mt-1 w-full min-w-0 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 text-sm" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <p className="text-xs text-[var(--muted)] px-1">Business type and Pro mode do not hide tools here. Disabled modules stay in Settings → Modules.</p>
      <div role="navigation" aria-label="All tools" className="space-y-1">
        {tools.map(tab => <button key={tab.id} type="button" className="w-full min-h-11 rounded-lg px-3 py-2 text-start text-sm hover:bg-[var(--elevated)] focus-visible:outline-2 focus-visible:outline-[var(--brass)]" onClick={() => onSelect(tab.id)}>{tab.label[language] || tab.label.en}</button>)}
      </div>
      {!tools.length && <p role="status" className="text-xs px-1">No tools matched. Try another name.</p>}
    </div>
  </details>;
}
