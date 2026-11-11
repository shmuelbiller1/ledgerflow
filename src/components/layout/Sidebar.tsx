import React from 'react';
import { LogOut, Command, LayoutGrid, ShieldCheck, Compass, ArrowUpRight } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { AppTab } from '../../types';
import { useUIStore } from '../../stores/useUIStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download } from 'lucide-react';
import { APP_TABS, isTabVisible } from '../../config/registry';
import { DAILY_TOOL_IDS, DAILY_TOOL_LABELS } from '../../config/businessNavigation';
import AllToolsMenu from './AllToolsMenu';
import BookmarksGroup from './BookmarksGroup';
import WorkspaceSwitcher from './WorkspaceSwitcher';

import { BRAND_NAME } from '../../config/brand';
interface SidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  onLogout: () => void;
  onLoginPrompt?: () => void;
  projects: import("../../types").Project[];
  onNewProject: () => void;
  workspaces: import("../../types").Workspace[];
  currentWorkspaceId: string | null;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onAction: (action: string) => void;
}

const SERIES_COLORS = [
  'var(--w-personal)',
  'var(--w-charity)',
  'var(--w-book)',
  'var(--w-estate)'
];

/** "cost_of_goods" reads as "Cost of goods" in the sidebar (D-92: names people recognise). */
function accountTypeName(type: string): string {
  const plain = type.replace(/_/g, ' ').toLowerCase();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

const Sidebar = React.memo(({ 
  activeTab, 
  setActiveTab, 
  onLogout, 
  onLoginPrompt,
  workspaces,
  currentWorkspaceId,
  onSelectWorkspace,
  onNewWorkspace,
  onAction 
}: SidebarProps) => {
  const uiStore = useUIStore();
  const { isInstallable, promptInstall } = usePWAInstall();
  const user = useAuthStore(s => s.user);
  useAuthStore(s => s.userProfile);
  const isAdmin = useAuthStore(s => s.isAdmin);
  const realProjects = useLedgerStore(s => s.projects);
  const rawAccounts = useLedgerStore(s => s.accounts);
  const computedAccounts = useLedgerStore(s => s.computedAccounts);
  const accounts = computedAccounts && computedAccounts.length > 0 ? computedAccounts : rawAccounts;

  const businessType = useAuthStore(s => s.getCurrentWorkspace()?.businessType);
  const modules = useAuthStore(s => s.getCurrentWorkspace()?.modules);
  const uid = useAuthStore(s => s.user?.uid || 'guest');
  const visibility = { isOwner: isAdmin, isProMode: uiStore.isProMode, developerMode: uiStore.developerMode, modules, businessType };
  const dailyTabs = DAILY_TOOL_IDS.flatMap(id => { const tab = APP_TABS.find(t => t.id === id); return tab && isTabVisible(tab, visibility) ? [tab] : []; });
  const recommendations = uiStore.isProMode ? APP_TABS.filter(t => t.isAdvanced && isTabVisible(t, visibility)) : [];

  // D-92: the old "Worlds" box mixed two different things. It now says what it shows —
  // your projects when there are any, otherwise the balance of each account type — and it
  // explains the figure instead of leaving the reader to guess.
  const summary = React.useMemo(() => {
    if (realProjects && realProjects.length > 0) {
      return {
        kind: 'projects' as const,
        title: 'Projects',
        hint: 'The budget you set for each project.',
        items: realProjects.slice(0, 4).map((project, index) => ({
          id: project.id,
          name: project.name,
          color: (project as typeof project & { color?: string }).color || SERIES_COLORS[index % SERIES_COLORS.length],
          amount: formatCurrency(project.budgetCents || (project as typeof project & { spentCents?: number }).spentCents || 0),
        })),
      };
    }

    const typeTotals: Record<string, number> = {};
    accounts.forEach(account => {
      const type = account.type.toUpperCase();
      typeTotals[type] = (typeTotals[type] || 0) + Math.abs(account.balanceCents || 0);
    });

    if (Object.keys(typeTotals).length > 0) {
      return {
        kind: 'accountTypes' as const,
        title: 'Balances by account type',
        hint: 'The total of every account in each type, as recorded in your books. The balance sheet shows the detail.',
        items: Object.entries(typeTotals).slice(0, 4).map(([type, total], index) => ({
          id: type,
          name: accountTypeName(type),
          color: SERIES_COLORS[index % SERIES_COLORS.length],
          amount: formatCurrency(total),
        })),
      };
    }

    return {
      kind: 'accountTypes' as const,
      title: 'Balances by account type',
      hint: 'The total of every account in each type, as recorded in your books. The balance sheet shows the detail.',
      items: [{ id: 'main', name: 'Main ledger', color: SERIES_COLORS[0], amount: formatCurrency(0) }],
    };
  }, [realProjects, accounts]);

  return (
    <div 
      role="navigation"
      aria-label="Main navigation"
      className={cn(
        "h-[100dvh] lg:h-full bg-[var(--surface)] text-[var(--text)] flex flex-col z-[100] border-r border-[var(--line)] shrink-0 transition-all duration-300",
        "fixed lg:sticky top-0 left-0",
        uiStore.isSidebarOpen ? "w-[240px] translate-x-0 opacity-100" : "w-0 -translate-x-full opacity-0 pointer-events-none border-r-0 lg:w-[70px] lg:translate-x-0 lg:opacity-100"
      )}
    >
      {/* Brand & Workspace Switcher */}
      <div className="h-16 flex items-center px-4 shrink-0 border-b border-[var(--line)]">
        {uiStore.isSidebarOpen ? (
          // K-34: type to find a workspace, arrows and Enter, the most recent first
          <WorkspaceSwitcher onSelect={onSelectWorkspace} onNewWorkspace={onNewWorkspace} />
        ) : (
          <div className="flex items-center justify-center w-full">
            <div className="w-8 h-8 rounded-lg bg-[var(--brass-soft)] border border-[var(--brass-line)] flex items-center justify-center text-[var(--brass)] shrink-0 shadow-sm" title={workspaces.find(w => w.id === currentWorkspaceId)?.name || `${BRAND_NAME}`}>
              <Compass aria-hidden="true" size={18} className="animate-spin-slow" />
            </div>
          </div>
        )}
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4 mt-1">
         <BookmarksGroup expanded={uiStore.isSidebarOpen} />
         <nav aria-label="Daily tools" className="space-y-1">
           {dailyTabs.map(tab => {
             const Icon = tab.icon;
             const label = DAILY_TOOL_LABELS[tab.id][uiStore.language] || DAILY_TOOL_LABELS[tab.id].en;
             const isActive = activeTab === tab.id;
             return <button type="button" key={tab.id} aria-label={label} title={label} data-testid={`nav-${tab.id}`} aria-current={isActive ? 'page' : undefined}
               onClick={() => setActiveTab(tab.id)}
               className={cn("w-full min-h-11 flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium border", isActive ? "text-[var(--text)] bg-[var(--brass-soft)] border-[var(--brass-line)]" : "text-[var(--muted)] border-transparent hover:bg-[var(--elevated)]")}>
               <Icon aria-hidden="true" size={16} className="shrink-0" />
               {uiStore.isSidebarOpen && <span>{label}</span>}
             </button>;
           })}
         </nav>
         {uiStore.isSidebarOpen && <>
           <label className="flex items-center gap-2 min-h-11 px-2 text-xs"><input type="checkbox" checked={uiStore.isProMode} onChange={event => uiStore.setProMode(event.target.checked)} />Pro mode</label>
           {recommendations.length > 0 && <nav aria-label="Recommended tools" className="space-y-1">
             <p className="text-xs text-[var(--muted)] px-2">More tools for this business</p>
             {recommendations.map(tab => <button key={tab.id} type="button" className="w-full min-h-11 rounded-lg px-3 text-start text-sm hover:bg-[var(--elevated)]" onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined}>{tab.label[uiStore.language] || tab.label.en}</button>)}
           </nav>}
           <AllToolsMenu key={`${uid}:${currentWorkspaceId}`} onSelect={setActiveTab} />
         </>}
         {!uiStore.isSidebarOpen && <button type="button" aria-label="Show all tools" title="Show all tools" className="min-h-11 w-full rounded-lg" onClick={() => uiStore.setSidebarOpen(true)}><LayoutGrid aria-hidden="true" size={16} /></button>}

         {/* D-92: projects or account-type balances, named and explained (the old "Worlds" box) */}
         {uiStore.isSidebarOpen && (
           <div className="pt-2 border-t border-[var(--line)]" data-testid="sidebar-balances">
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-[var(--faint)] px-2 mb-0.5 font-semibold" title={summary.hint}>
                {summary.title}
              </h2>
              <p className="px-2 mb-2 text-[10.5px] leading-snug text-[var(--faint)]">{summary.hint}</p>
              <ul className="space-y-1">
                 {summary.items.map(item => (
                   <li
                     key={item.id || item.name}
                     className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-[12.5px]"
                   >
                     <span className="flex min-w-0 items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full shrink-0" aria-hidden="true" style={{ backgroundColor: item.color }} />
                        <span className="truncate text-[var(--text)]" title={item.name}>{item.name}</span>
                     </span>
                     <span className="font-mono text-[11px] text-[var(--muted)] tabular-nums shrink-0">{item.amount}</span>
                   </li>
                 ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  if (summary.kind === 'projects') {
                    setActiveTab('projects' as unknown as string);
                  } else {
                    useUIStore.getState().setActiveReportTab('balance-sheet');
                    setActiveTab('reports' as unknown as string);
                  }
                }}
                className="mt-1.5 w-full min-h-11 flex items-center justify-between gap-2 px-3 rounded-md text-[12px] font-medium text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)] transition-colors"
              >
                <span>{summary.kind === 'projects' ? 'Open projects' : 'Open balance sheet'}</span>
                <ArrowUpRight size={13} aria-hidden="true" className="shrink-0 text-[var(--faint)]" />
              </button>
           </div>
         )}
      </div>

      {/* Bottom Actions */}
      <div className="p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:pb-3 border-t border-[var(--line)] shrink-0 space-y-1 bg-[var(--surface)]">
         <button
            onClick={() => onAction('open-command-palette')}
           className={cn(
             "w-full min-h-11 min-w-11 flex items-center px-3 py-2 rounded-lg text-[12.5px] font-medium text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)] transition-all group",
             uiStore.isSidebarOpen ? "justify-between" : "justify-center"
           )}
           title="Search pages (Ctrl/⌘+K)"
           aria-label={uiStore.isSidebarOpen ? undefined : "Search pages"}
           aria-keyshortcuts="Control+K Meta+K"
         >
           <span className="flex items-center gap-2.5">
             <Command aria-hidden="true" size={16} className="shrink-0 text-[var(--faint)] group-hover:text-[var(--text)] transition-colors" />
             {uiStore.isSidebarOpen && <span>Search pages</span>}
           </span>
           {uiStore.isSidebarOpen && <kbd aria-hidden="true" className="text-[10px] font-mono text-[var(--faint)] border border-[var(--line)] rounded px-1">⌘K</kbd>}
         </button>
         
         {isAdmin && uiStore.developerMode && (
           <button
             onClick={() => setActiveTab('system-command-center' as unknown as string)}
             className={cn(
               "flex items-center gap-2.5 px-3 py-2 text-[12.5px] font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-all w-full group mb-1 shadow-sm cursor-pointer",
               uiStore.isSidebarOpen ? "justify-between" : "justify-center",
               activeTab === 'system-command-center' && "bg-amber-500/25 border-amber-400 text-amber-200"
             )}
             title={uiStore.isSidebarOpen ? undefined : "Admin Control Panel"}
           >
             <div className="flex items-center gap-2.5">
               <ShieldCheck aria-hidden="true" size={16} className="shrink-0 text-amber-400 group-hover:scale-110 transition-transform" />
               {uiStore.isSidebarOpen && <span>Admin Panel</span>}
             </div>
             {uiStore.isSidebarOpen && (
               <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase tracking-wider">
                 Admin
               </span>
             )}
           </button>
         )}

         {isInstallable && (
           <button
             onClick={promptInstall}
             className={cn(
               "flex items-center gap-2.5 px-3 py-2 text-[12.5px] font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 rounded-lg transition-all w-full group mb-1 shadow-sm",
               uiStore.isSidebarOpen ? "justify-between" : "justify-center"
             )}
             title={uiStore.isSidebarOpen ? undefined : "Install App"}
            aria-label="Install App">
             <div className="flex items-center gap-2.5">
               <Download aria-hidden="true" size={16} className="shrink-0 text-emerald-400 group-hover:scale-110 transition-transform" />
               {uiStore.isSidebarOpen && <span>Install App</span>}
             </div>
             {uiStore.isSidebarOpen && (
               <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                 App
               </span>
             )}
           </button>
         )}
         <button
           onClick={user ? onLogout : (onLoginPrompt || onLogout)}
           className={cn(
             "flex items-center gap-2.5 px-3 py-2 text-[12.5px] font-medium text-[var(--muted)] hover:text-red-400 rounded-lg hover:bg-rose-500/10 transition-all w-full group",
             !uiStore.isSidebarOpen && "justify-center"
           )}
           title={uiStore.isSidebarOpen ? undefined : (user ? "Log Out" : "Exit Guest / Sign In")}
          aria-label={user ? "Log Out" : "Exit Guest / Sign In"}>
           <LogOut aria-hidden="true" size={16} className="shrink-0 text-[var(--faint)] group-hover:text-red-400 transition-colors" />
           {uiStore.isSidebarOpen && <span>{user ? "Log Out" : "Exit Guest / Sign In"}</span>}
         </button>
      </div>
    </div>
  );
});

Sidebar.displayName = 'Sidebar';
export default Sidebar;

