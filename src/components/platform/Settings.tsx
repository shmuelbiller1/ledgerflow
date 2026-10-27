import React, { Suspense, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { SETTINGS_TABS_REGISTRY, SETTINGS_COMPONENTS } from '../../config/registry';
import { useUIStore } from '../../stores/useUIStore';
import { ViewErrorBoundary } from '../common/ViewErrorBoundary';

const SETTINGS_GROUPS = [
  { name: 'Workspace', ids: ['appearance', 'team', 'security', 'billing', 'modules', 'groups', 'shortcuts'] },
  { name: 'Accounting', ids: ['defaults', 'tax-profiles', 'currencies', 'dimensions', 'tags', 'split-rules'] },
  { name: 'Documents & sales', ids: ['templates', 'branding', 'branding-profiles', 'numbering', 'price-lists', 'price-list-import', 'custom-fields', 'sales-reps', 'stages'] },
  { name: 'Automation', ids: ['rules', 'rule', 'emails', 'schedule', 'incoming-events', 'scheduled-reports', 'alerts'] },
  { name: 'Data & developer', ids: ['import', 'export', 'developer'] },
];

export default function Settings() {
  const [search, setSearch] = useState('');
  const language = useUIStore(state => state.language);
  const activeSubTab = useUIStore(state => state.activeSettingsTab || 'appearance');
  const setActiveSubTab = useUIStore(state => state.setActiveSettingsTab);

  const activeTabDef = SETTINGS_TABS_REGISTRY.find(t => t.id === activeSubTab);
  const ActiveComponent = activeTabDef ? SETTINGS_COMPONENTS[activeTabDef.componentName] : null;
  const activeTabLabel = activeTabDef ? (activeTabDef.label[language] || activeTabDef.label.en) : 'Settings';

  // A section chosen from the shortcut grid is scrolled to and focused, so the buttons are not a
  // no-op when the panel is below the fold (#274). Opening Settings, restoring a saved section or
  // switching workspace changes `activeSubTab` without a request, and then the page stays put.
  const panelRef = useRef<HTMLDivElement>(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const chooseSection = (tabId: string) => {
    setActiveSubTab(tabId);
    setRevealRequest(request => request + 1);
  };
  useEffect(() => {
    if (!revealRequest) return;
    const panel = panelRef.current;
    if (!panel) return;
    // Either the app's own setting (Appearance → Reduced motion) or the operating system's.
    const appReduceMotion = useUIStore.getState().reduceMotion;
    const systemReduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView?.({ block: 'start', behavior: appReduceMotion || systemReduceMotion ? 'auto' : 'smooth' });
    panel.focus({ preventScroll: true });
  }, [revealRequest]);

  const term = search.trim().toLocaleLowerCase();
  const groups = SETTINGS_GROUPS.map(group => ({ ...group, tabs: SETTINGS_TABS_REGISTRY.filter(tab => group.ids.includes(tab.id) && (!term || `${group.name} ${tab.label.en} ${tab.label[language]} ${tab.id}`.toLocaleLowerCase().includes(term))) }));
  const matchCount = groups.reduce((count, group) => count + group.tabs.length, 0);

  return (
    <div className="sentence-case-controls w-full max-w-6xl mx-auto space-y-6 p-4 md:p-6 text-[var(--text)]">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-[var(--muted)]">Manage your workspace, appearance, backups and integrations.</p>
        </div>
        <div className="w-full md:w-72 shrink-0">
          <label htmlFor="settings-search" className="block text-sm font-medium mb-1">Search settings</label>
          <input id="settings-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a setting" className="w-full min-h-11 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3" />
        </div>
      </header>
      <nav aria-label="Settings sections" className="space-y-3">
        {term && <p role="status" className="text-sm text-[var(--muted)]">{matchCount ? `${matchCount} settings found` : 'No settings match your search.'} Your current page stays open.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {groups.filter(group => group.tabs.length).map(group => <section key={group.name} aria-label={group.name} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
            <h2 className="text-sm font-semibold mb-2">{group.name}</h2>
            <div className="flex flex-wrap gap-1">
              {group.tabs.map(tab => <button type="button" key={tab.id} aria-current={activeSubTab === tab.id ? 'page' : undefined} onClick={() => chooseSection(tab.id)} className={cn('min-h-11 max-w-full inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-start', activeSubTab === tab.id ? 'bg-[var(--brass-soft)] text-[var(--text)] ring-1 ring-[var(--brass-line)] font-semibold' : 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]')}>
                <tab.icon size={16} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 break-words">{tab.label[language] || tab.label.en}</span>
              </button>)}
            </div>
          </section>)}
        </div>
        {term && <button type="button" onClick={() => setSearch('')} className="min-h-11 px-3 underline">Clear search</button>}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          ref={panelRef}
          id="settings-panel"
          role="region"
          aria-label={`${activeTabLabel} settings`}
          tabIndex={-1}
          className="lg:col-span-2 space-y-6 scroll-mt-24 outline-none"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSubTab}
              initial={{ x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-10"
            >
              {ActiveComponent && (
                <Suspense fallback={<div className="h-40 flex items-center justify-center font-bold text-[var(--muted)] uppercase tracking-widest text-xs">Loading module...</div>}>
                  <ViewErrorBoundary viewName={(activeTabDef as typeof activeTabDef & { name?: string })?.label?.en || activeSubTab}>
                    <ActiveComponent />
                  </ViewErrorBoundary>
                </Suspense>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Global Sidebar Documentation Context (Could also be modularized later) */}
        <div className="space-y-10">
          <div className="p-4 md:p-10 bg-[var(--surface)] rounded-[40px] border border-[var(--line)] shadow-sm group hover:border-indigo-600 transition-all duration-500">
            <h2 className="text-[11px] font-black text-[var(--text)] dark:text-[#699274] uppercase tracking-[0.3em] mb-6 opacity-40 dark:opacity-100">About settings</h2>
            <div className="space-y-4">
              <p className="text-[11px] text-[var(--muted)] leading-relaxed font-bold mb-8">
                Choose a tab to review or update the settings for your workspace.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
