import PinnedPagesBar from '../../components/layout/PinnedPagesBar';
import type { FilterCriteria } from '../../types';
import React, { Suspense } from 'react';
import { cn, getLocalDateISO } from '../../lib/utils';
import { createRetryableLazy } from '../../lib/lazyWithRetry';
import { LazyOverlayBoundary } from '../../components/ui/LazyOverlayBoundary';

import Sidebar from '../../components/layout/Sidebar';
import Header from '../../components/layout/Header';
import ModuleSubNav from '../../components/layout/ModuleSubNav';
import BottomNav from '../../components/layout/BottomNav';
import MainViewSwitcher from '../../components/layout/MainViewSwitcher';
import CommandPortal from '../../components/layout/CommandPortal';
import StatusBar from '../../components/layout/StatusBar';
import LedgerInterruptOverlay from '../../components/forensics/LedgerInterruptOverlay';
import ProductTour from '../../components/onboarding/tour/ProductTour';

import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';

import ConnectionBanner from '../../components/platform/ConnectionBanner';
import DataStatusBar from '../../components/layout/DataStatusBar';
import PendingDeletionBanner from '../../components/layout/PendingDeletionBanner';
import LedgerBackupReminder from '../../components/platform/LedgerBackupReminder';

import { useCommandDispatcher } from '../../hooks/useSystemContext';
import { useServerOpeningSync } from '../../hooks/useServerOpening';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useAIActions } from '../../hooks/useAIActions';

import { useSystemActions } from '../../hooks/useSystemActions';

const CommandPalette = createRetryableLazy(() => import('../../components/layout/CommandPalette'));
const ShortcutOverlay = createRetryableLazy(() => import('../../components/layout/ShortcutOverlay'));
const DiagnosticConsole = createRetryableLazy(() => import('../../components/intelligence/DiagnosticConsole'));

/** Authenticated and guest workspace shell hosting navigation, views, and global overlays. */
export function RootLayout() {
  const { handleAction } = useCommandDispatcher();
  useServerOpeningSync(); // L-123 step 3b: the server's balances behind computedAccounts
  const txActions = useTransactionActions();
  const ai = useAIActions();
  const { handleLoginPrompt, handleLogout, handleApplyAITemplate, handleSelectTemplate, handleSaveCurrentTemplate, handleCreateWorkspace } = useSystemActions();
  const activeTab = useUIStore(state => state.activeTab);
  const setActiveTab = useUIStore(state => state.setActiveTab);
  
  // #102: every dialog (statement importer, migration, entry tools) starts fresh on a book switch, so
  // rows parsed or read for one workspace can never be imported into another
  const dialogScope = useAuthStore(state => `${state.user?.uid ?? ''}:${state.currentWorkspaceId ?? ''}`);
  const workspaces = useAuthStore(state => state.workspaces);
  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const projects = useLedgerStore(state => state.projects);

  const isSidebarOpen = useUIStore(state => state.isSidebarOpen);
  const toggleSidebar = useUIStore(state => state.toggleSidebar);
  const isFocusMode = useUIStore(state => state.isFocusMode);

  // Modal States
  const isCommandPaletteOpen = useUIStore(state => state.isCommandPaletteOpen);
  const setCommandPaletteOpen = useUIStore(state => state.setCommandPaletteOpen);
  
  const isShortcutOverlayOpen = useUIStore(state => state.isShortcutOverlayOpen);
  const setShortcutOverlayOpen = useUIStore(state => state.setShortcutOverlayOpen);
  

  const isDiagnosticConsoleOpen = useUIStore(state => state.isDiagnosticConsoleOpen);
  const setDiagnosticConsoleOpen = useUIStore(state => state.setDiagnosticConsoleOpen);


  const modals = {
    commandPalette: useUIStore(state => state.isCommandPaletteOpen),
    quickEntry: useUIStore(state => state.isQuickEntryOpen),
    importer: useUIStore(state => state.isImporterOpen),
    qboMigration: useUIStore(state => state.isQBOMigrationOpen),
    template: useUIStore(state => state.isTemplateSelectorOpen),
    aiBlueprint: useUIStore(state => state.isAIBlueprintOpen),
    commandCenter: useUIStore(state => state.isCommandCenterOpen),
    converter: useUIStore(state => state.isConverterOpen),
    integrity: useUIStore(state => state.isIntegrityOpen),
    healthCheck: useUIStore(state => state.isHealthCheckOpen),
    entanglement: useUIStore(state => state.isEntanglementOpen),
    architecture: useUIStore(state => state.isArchitectureOpen)
  };

  const handlers = {
    closeCommandPalette: () => useUIStore.getState().setCommandPaletteOpen(false),
    closeQuickEntry: () => useUIStore.getState().setQuickEntryOpen(false),
    closeImporter: () => useUIStore.getState().setImporterOpen(false),
    closeQBOMigration: () => (useUIStore.getState() as ReturnType<typeof useUIStore.getState> & { setQBOMigrationOpen(value: boolean): void }).setQBOMigrationOpen(false),
    closeTemplate: () => useUIStore.getState().setTemplateSelectorOpen(false),
    closeAIBlueprint: () => useUIStore.getState().setAIBlueprintOpen(false),
    closeCommandCenter: () => useUIStore.getState().setCommandCenterOpen(false),
    closeConverter: () => useUIStore.getState().setConverterOpen(false),
    closeIntegrity: () => useUIStore.getState().setIntegrityOpen(false),
    closeHealthCheck: () => useUIStore.getState().setHealthCheckOpen(false),
    closeEntanglement: () => useUIStore.getState().setEntanglementOpen(false),
    closeArchitecture: () => useUIStore.getState().setArchitectureOpen(false),
    handleAction,
    txActions,
    handleQuickAdd: txActions?.handleQuickAdd,
    handleImportTransactions: txActions?.handleImportTransactions,
    handleOpenAIBlueprint: () => {
      useUIStore.getState().setTemplateSelectorOpen(false);
      useUIStore.getState().setAIBlueprintOpen(true);
    },
    handleAIQuery: async (q: string) => {
      if (ai?.handleAIQuery) return await ai.handleAIQuery(q);
      return { response: `Analyzed query: ${q}` };
    },
    handleFilter: (filter: FilterCriteria) => {
      useUIStore.getState().setFilterCriteria(filter);
      useUIStore.getState().setActiveTab('transactions' as unknown as string);
      useUIStore.getState().setCommandCenterOpen(false);
    },
    handleSelectTemplate,
    handleSaveCurrentTemplate,
    handleApplyAITemplate
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* E-29: keyboard users skip the navigation */}
      {/* the address hash picks the screen, so this moves focus instead of changing the hash */}
      <a href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1000] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-[var(--surface)] focus:text-[var(--text)] focus:shadow-lg">
        Skip to content
      </a>
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile/Tablet Backdrop Dimmer */}
        {isSidebarOpen && !isFocusMode && (
          <div role="presentation" aria-hidden="true" 
            className="lg:hidden fixed inset-0 bg-black/30 backdrop-blur-sm z-[95] transition-opacity duration-300 animate-fade-in"
            onClick={toggleSidebar}
          />
        )}

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={handleLogout}
        onLoginPrompt={handleLoginPrompt}
        workspaces={workspaces}
        currentWorkspaceId={currentWorkspaceId}
        onSelectWorkspace={(id) => useAuthStore.getState().setCurrentWorkspaceId(id)}
        onNewWorkspace={handleCreateWorkspace}
        projects={projects}
        onNewProject={() => setActiveTab('projects' as unknown as string)}
        onAction={handleAction}
      />

      <main className={cn(
        "flex-1 flex flex-col overflow-hidden relative transition-all duration-300 bg-[var(--ink)] text-[var(--text)] pb-[env(safe-area-inset-bottom)] lg:pb-0",
        "pb-[64px] lg:pb-0" // Add 64px padding on mobile specifically for the BottomNav
      )}>
        <ConnectionBanner />
        <LedgerBackupReminder />
        <PendingDeletionBanner />
        <DataStatusBar />
        {!isFocusMode && <Header onLogout={handleLogout} onLoginPrompt={handleLoginPrompt} />}
        {!isFocusMode && <PinnedPagesBar />}
        {!isFocusMode && <ModuleSubNav activeTab={activeTab as unknown as string} onTabChange={setActiveTab as unknown as (tabId: string) => void} />}
        
        {/* Main Content Area */}
        <div id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto overflow-x-hidden relative custom-scrollbar focus:outline-none">
          {/* A-17: printed at the top of every page of a printout (hidden on screen) */}
          <div className="print-only-title px-2 pb-2 text-sm font-semibold border-b border-[var(--line)] mb-3" aria-hidden="true">
            {workspaces.find(w => w.id === currentWorkspaceId)?.name || 'LedgerFlow'} · {getLocalDateISO()}
          </div>
          <MainViewSwitcher activeTab={activeTab as unknown as string} />
        </div>

      </main>

      </div>
      
      {/* Overlays & Global Components */}
      <BottomNav activeTab={activeTab as unknown as string} onTabChange={setActiveTab as unknown as (tabId: string) => void} />
      {isCommandPaletteOpen && (
        <LazyOverlayBoundary
          label="Command palette"
          onDismiss={() => setCommandPaletteOpen(false)}
          onRetry={() => setCommandPaletteOpen(true)}
        >
          <CommandPalette isOpen={isCommandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onAction={handleAction} />
        </LazyOverlayBoundary>
      )}
      <Suspense fallback={null}>
        <CommandPortal key={dialogScope} modals={modals} handlers={handlers as unknown as React.ComponentProps<typeof CommandPortal>['handlers']} />
      </Suspense>
      {isShortcutOverlayOpen && (
        <LazyOverlayBoundary
          label="Keyboard shortcuts"
          onDismiss={() => setShortcutOverlayOpen(false)}
          onRetry={() => setShortcutOverlayOpen(true)}
        >
          <ShortcutOverlay isOpen={isShortcutOverlayOpen} onClose={() => setShortcutOverlayOpen(false)} />
        </LazyOverlayBoundary>
      )}
      {isDiagnosticConsoleOpen && (
        <LazyOverlayBoundary
          label="Diagnostic console"
          onDismiss={() => setDiagnosticConsoleOpen(false)}
          onRetry={() => setDiagnosticConsoleOpen(true)}
        >
          <DiagnosticConsole isOpen={isDiagnosticConsoleOpen} onClose={() => setDiagnosticConsoleOpen(false)} />
        </LazyOverlayBoundary>
      )}

      <Suspense fallback={null}><LedgerInterruptOverlay /></Suspense>
      <ProductTour />
      <StatusBar />
    </div>
  );
}
