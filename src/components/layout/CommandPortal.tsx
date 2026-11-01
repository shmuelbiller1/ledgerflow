import React from 'react';
import { toast } from 'sonner';
import { RecordDetailsLauncher } from '../common/RecordDetailsLauncher';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { isIncomeAccount } from '../../lib/accountUtils';
import { createRetryableLazy } from '../../lib/lazyWithRetry';
import { LazyOverlayBoundary } from '../ui/LazyOverlayBoundary';

// Retryable lazy loading of on-demand global overlay dialogs so offline/chunk failures never unmount the workspace
const MagicEntry = createRetryableLazy(() => import('../ledger/MagicEntry'));
const QBOMigrationWizard = createRetryableLazy(() => import('../migration/QBOMigrationWizard'));
const StatementImporter = createRetryableLazy(() => import('../ledger/StatementImporter'));
const TemplateSelector = createRetryableLazy(() => import('./TemplateSelector'));
const AICustomBlueprint = createRetryableLazy(() => import('../intelligence/AICustomBlueprint'));
const AICommandCenter = createRetryableLazy(() => import('../intelligence/AICommandCenter'));
const CurrencyConverter = createRetryableLazy(() => import('../finance/CurrencyConverter'));
const DocumentEntanglement = createRetryableLazy(() => import('../forensics/DocumentEntanglement'));
const SystemArchitecture = createRetryableLazy(() => import('../platform/SystemArchitecture'));
const HealthCheckModal = createRetryableLazy(() => import('../system/HealthCheckModal'));

interface CommandPortalProps {
  modals: {
    commandPalette: boolean;
    quickEntry: boolean;
    importer: boolean;
    qboMigration: boolean;
    template: boolean;
    aiBlueprint: boolean;
    commandCenter: boolean;
    converter: boolean;
    integrity: boolean;
    healthCheck: boolean;
    entanglement: boolean;
    architecture: boolean;
  };
  handlers: {
    closeCommandPalette: () => void;
    closeQuickEntry: () => void;
    closeImporter: () => void;
    closeQBOMigration: () => void;
    closeTemplate: () => void;
    closeAIBlueprint: () => void;
    closeCommandCenter: () => void;
    closeConverter: () => void;
    closeIntegrity: () => void;
    closeHealthCheck: () => void;
    closeEntanglement: () => void;
    closeArchitecture: () => void;
    handleAIQuery: (q: string) => Promise<unknown>;
    handleFilter: (f: import("../../types").FilterCriteria) => void;
    handleQuickAdd: (d: Partial<import("../../types").Transaction>) => void;
    handleImportTransactions: (t: Parameters<React.ComponentProps<typeof StatementImporter>['onImport']>[0]) => void | boolean | Promise<void | boolean>;
    handleIntegrityAction: (a: string) => void;
    handleSelectTemplate: (id: string) => void;
    handleOpenAIBlueprint: () => void;
    handleSaveCurrentTemplate: () => void;
    handleApplyAITemplate: (t: import("../../services/aiService").GeneratedBlueprint) => void;
  };
}

/** Global modal portal mounting quick-entry, import, migration, template, and diagnostic overlays with isolated error boundaries. */
export default function CommandPortal({ modals, handlers }: CommandPortalProps) {
  const transactions = useLedgerStore(state => state.transactions);
  const accounts = useLedgerStore(state => state.accounts);
  const projects = useLedgerStore(state => state.projects);
  const autoRules = useLedgerStore(state => state.autoRules || []);
  const patternCache = useLedgerStore(state => state.analyticalPatternCache || {});
  const customTemplates = useLedgerStore(state => state.customTemplates || []);

  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspaces = useAuthStore(state => state.workspaces);
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);

  const businessContext = currentWorkspace?.description || '';
  const baseCurrency = currentWorkspace?.currency || 'USD';
  const currentTemplateId = currentWorkspace?.businessType || 'generic';

  const categories = Array.from(new Set(accounts.filter((a) => isIncomeAccount(a) || a.type === 'expense').map((a) => a.name)));

  return (
    <>
      <RecordDetailsLauncher />
      {modals.quickEntry && (
        <LazyOverlayBoundary
          label="Quick entry"
          onDismiss={handlers.closeQuickEntry}
          onRetry={() => useUIStore.getState().setQuickEntryOpen(true)}
        >
          <MagicEntry
            isOpen={modals.quickEntry}
            onClose={handlers.closeQuickEntry}
            onAdd={handlers.handleQuickAdd}
            categories={categories}
            accounts={accounts}
            projects={projects.map((p) => p.name)}
            autoRules={autoRules}
            patternCache={patternCache}
          />
        </LazyOverlayBoundary>
      )}
      {modals.qboMigration && (
        <LazyOverlayBoundary
          label="QBO migration wizard"
          onDismiss={handlers.closeQBOMigration}
          onRetry={() =>
            (useUIStore.getState() as ReturnType<typeof useUIStore.getState> & { setQBOMigrationOpen(value: boolean): void }).setQBOMigrationOpen(true)
          }
        >
          <QBOMigrationWizard
            isOpen={modals.qboMigration}
            onClose={handlers.closeQBOMigration}
          />
        </LazyOverlayBoundary>
      )}
      {modals.importer && (
        <LazyOverlayBoundary
          label="Statement importer"
          onDismiss={handlers.closeImporter}
          onRetry={() => useUIStore.getState().setImporterOpen(true)}
        >
          <StatementImporter
            isOpen={modals.importer}
            onClose={handlers.closeImporter}
            onImport={handlers.handleImportTransactions}
            existingTransactions={transactions}
            businessContext={businessContext}
            accounts={accounts}
            autoRules={autoRules}
            patternCache={patternCache}
          />
        </LazyOverlayBoundary>
      )}
      {modals.aiBlueprint && (
        <LazyOverlayBoundary
          label="AI blueprint"
          onDismiss={handlers.closeAIBlueprint}
          onRetry={() => useUIStore.getState().setAIBlueprintOpen(true)}
        >
          <AICustomBlueprint
            isOpen={modals.aiBlueprint}
            onClose={handlers.closeAIBlueprint}
            onGenerated={handlers.handleApplyAITemplate}
          />
        </LazyOverlayBoundary>
      )}
      {modals.template && (
        <LazyOverlayBoundary
          label="Template selector"
          onDismiss={handlers.closeTemplate}
          onRetry={() => useUIStore.getState().setTemplateSelectorOpen(true)}
        >
          <TemplateSelector
            isOpen={modals.template}
            onClose={handlers.closeTemplate}
            onSelect={handlers.handleSelectTemplate}
            onOpenAI={handlers.handleOpenAIBlueprint}
            currentType={currentTemplateId}
            customTemplates={customTemplates}
            onSaveCurrent={handlers.handleSaveCurrentTemplate}
          />
        </LazyOverlayBoundary>
      )}
      {modals.commandCenter && (
        <LazyOverlayBoundary
          label="AI command center"
          onDismiss={handlers.closeCommandCenter}
          onRetry={() => useUIStore.getState().setCommandCenterOpen(true)}
        >
          <AICommandCenter
            isOpen={modals.commandCenter}
            onClose={handlers.closeCommandCenter}
            onFilter={handlers.handleFilter}
            businessContext={businessContext}
          />
        </LazyOverlayBoundary>
      )}
      {modals.converter && (
        <LazyOverlayBoundary
          label="Currency converter"
          onDismiss={handlers.closeConverter}
          onRetry={() => useUIStore.getState().setConverterOpen(true)}
        >
          <CurrencyConverter
            isOpen={modals.converter}
            onClose={handlers.closeConverter}
            baseCurrency={baseCurrency}
          />
        </LazyOverlayBoundary>
      )}
      {modals.healthCheck && (
        <LazyOverlayBoundary
          label="System health check"
          onDismiss={handlers.closeHealthCheck}
          onRetry={() => useUIStore.getState().setHealthCheckOpen(true)}
        >
          <HealthCheckModal
            isOpen={modals.healthCheck}
            onClose={handlers.closeHealthCheck}
          />
        </LazyOverlayBoundary>
      )}
      {modals.entanglement && (
        <LazyOverlayBoundary
          label="Document entanglement"
          onDismiss={handlers.closeEntanglement}
          onRetry={() => useUIStore.getState().setEntanglementOpen(true)}
        >
          <DocumentEntanglement
            isOpen={modals.entanglement}
            onClose={handlers.closeEntanglement}
            onVerify={() => {
              toast.success("Document structure verified and entangled with ledger.");
              handlers.closeEntanglement();
            }}
          />
        </LazyOverlayBoundary>
      )}
      {modals.architecture && (
        <LazyOverlayBoundary
          label="System architecture"
          onDismiss={handlers.closeArchitecture}
          onRetry={() => useUIStore.getState().setArchitectureOpen(true)}
        >
          <SystemArchitecture
            isOpen={modals.architecture}
            onClose={handlers.closeArchitecture}
            accounts={accounts}
          />
        </LazyOverlayBoundary>
      )}
    </>
  );
}
