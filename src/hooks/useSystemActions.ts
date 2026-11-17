import { useCallback } from 'react';
import { toast } from 'sonner';
import { db, auth } from '../firebase';
import { collection, addDoc } from '../lib/db/firestore';
import { signOut } from '../lib/db/auth';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useUIStore } from '../stores/useUIStore';
import { runCommand, type CommandBody } from '../lib/runCommand';
import { runNamedCommand } from '../lib/commandByName';
import { localAdd } from '../lib/db/localStore';
import { guestSession } from '../lib/db/guestDatabase';

/** Provides workspace-level system actions including sign-out, template application, and workspace creation. */
export function useSystemActions() {
  const user = useAuthStore(s => s.user);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currentWorkspace = useAuthStore(s => s.workspaces.find(w => w.id === s.currentWorkspaceId));

  const handleLoginPrompt = useCallback(() => {
    useAuthStore.getState().setIsGuest(false);
  }, []);

  const handleLogout = useCallback(() => {
    const wasGuest = useAuthStore.getState().isGuest;
    useAuthStore.getState().setIsGuest(false);
    localStorage.removeItem('ledgerflow_use_sandbox_mode');
    localStorage.removeItem('ledgerflow_identity_email');
    localStorage.removeItem('ledgerflow_identity_name');
    
    useAuthStore.getState().setUser(null);
    if (typeof useLedgerStore.getState().resetStore === 'function') {
      useLedgerStore.getState().resetStore();
    } else {
      useLedgerStore.setState({ 
        transactions: [], 
        accounts: [], 
        journalEntries: []
      });
    }
    
    if (!wasGuest) signOut(auth).catch((err) => { console.warn('[useSystemActions] Sign-out warning:', err); });
    toast.success('Returned to login screen');
  }, []);

  // Templates are applied by the server (POST /api/v1/workspaces/:id/apply-template): it writes the
  // accounts and, for built-in templates, the dashboard layout, which users may not write directly.
  const applyTemplate = useCallback(async (body: { templateId?: string; accounts?: unknown[] }) => {
    const data = await runCommand<CommandBody>({ path: `/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId || '')}/apply-template`, method: 'POST', body }) ?? {};
    return data as { created: number; removed: number };
  }, [currentWorkspaceId]);

  const handleApplyAITemplate = useCallback(async (customBlueprint: { chartOfAccounts?: unknown[]; accounts?: unknown[] } | null) => {
    if (!user || !currentWorkspaceId || !customBlueprint) return;
    const loader = toast.loading(`Applying the generated chart of accounts...`);
    try {
      const result = await applyTemplate({ accounts: customBlueprint.chartOfAccounts || customBlueprint.accounts || [] });
      toast.success(`Chart of accounts applied (${result.created} accounts added).`, { id: loader });
      useUIStore.getState().setAIBlueprintOpen(false);
      useUIStore.getState().setTemplateSelectorOpen(false);
      useUIStore.getState().setActiveTab('intelligence');
    } catch (error) {
      toast.error(`Could not apply the chart of accounts: ${error instanceof Error ? error.message : String(error)}`, { id: loader });
    }
  }, [user, currentWorkspaceId, applyTemplate]);

  const handleSelectTemplate = useCallback(async (templateId: string) => {
    if (!user || !currentWorkspaceId) return;
    let template: { name?: string } | undefined;
    try {
      const { BUSINESS_TEMPLATES } = await import('../lib/businessTemplates');
      template = BUSINESS_TEMPLATES[templateId];
    } catch (e) {
      console.error("Template catalog failed to load:", e);
      toast.error('Templates could not load. Check your connection and try again.');
      return;
    }
    if (!template) return;
    const loader = toast.loading(`Setting up the ${template.name} chart of accounts...`);
    try {
      await applyTemplate({ templateId });
      useUIStore.getState().setTemplateSelectorOpen(false);
      useUIStore.getState().setActiveTab('ledger');
      toast.success(`Chart of accounts set to ${template.name || 'the template'}`, { id: loader });
    } catch (e) {
      console.error("Template setup failed:", e);
      toast.error(`Setup failed: ${e instanceof Error ? e.message : String(e)}`, { id: loader });
    }
  }, [user, currentWorkspaceId, applyTemplate]);

  const handleSaveCurrentTemplate = useCallback(async () => {
    if (!user || !currentWorkspaceId || !currentWorkspace) return;
    const name = window.prompt("Enter template name:", `${currentWorkspace.name} Clone`);
    if (!name) return;
    try {
      await addDoc(collection(db, 'customTemplates'), {
        name,
        industry: currentWorkspace.businessType || 'generic',
        accounts: useLedgerStore.getState().accounts.map(a => ({ code: a.code, name: a.name, type: a.type, category: a.category })),
        analyticalTopology: currentWorkspace.analyticalTopology || {},
        uid: user.uid,
        createdAt: new Date().toISOString()
      });
      toast.success('TEMPLATE SAVED');
    } catch {
      toast.error('SNAPSHOT FAILED');
    }
  }, [user, currentWorkspaceId, currentWorkspace]);

  const handleCreateWorkspace = useCallback(async () => {
    if (!user) return;
    const name = window.prompt("Enter new workspace name:", "New Workspace");
    if (!name) return;
    try {
      // `workspace.create` mints the row and owns what it may contain; the tab used to build the row itself
      // (and type both timestamps). The sample company has no workspace on the server, so its own copy is written
      // in the tab, exactly as it was before.
      const created = guestSession()
        ? { id: await localAdd('workspaces', {
          uid: user.uid,
          name,
          type: 'business',
          currency: 'USD',
          businessType: 'generic',
          createdAt: new Date().toISOString(),
        }) }
        : (await runNamedCommand<{ workspace: { id: string } }>('workspace.create', { name, businessType: 'generic', currency: 'USD' })).workspace;
      useAuthStore.getState().setCurrentWorkspaceId(created.id);
      useUIStore.getState().setTemplateSelectorOpen(true);
      toast.success(`Workspace '${name}' created! Please choose an architectural template.`);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? `Failed to create workspace: ${e.message}` : 'Failed to create workspace');
    }
  }, [user]);

  return {
    handleLoginPrompt,
    handleLogout,
    handleApplyAITemplate,
    handleSelectTemplate,
    handleSaveCurrentTemplate,
    handleCreateWorkspace
  };
}
