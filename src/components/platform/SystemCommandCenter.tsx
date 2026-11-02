import { useDialog } from '../../hooks/useDialog';
import { SystemCommandCenterView } from './SystemCommandCenterView';
import React, { useState, useEffect, useId } from 'react';

import { toast } from 'sonner';

import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';

import { db } from '../../firebase';
import { collection, getDocs } from '../../lib/db/firestore';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

import type { Transaction, Workspace } from '../../types';
import { AdminUser, TenantTelemetry, TelemetryLog, CommandCenterTelemetry, errorMessage, fetchWithAuth } from './SystemCommandCenterShared';
/** Provides tenant telemetry, global billing controls, and tab-scoped polling for SystemCommandCenter. */
function useSystemCommandCenterModel() {
  const formId = useId();
  const [telemetry, setTelemetry] = useState<CommandCenterTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  useAuthStore(s => s.user);
  useAuthStore(s => s.userProfile);
  const lexiconOverrides = useUIStore(state => state.lexiconOverrides);
  const setLexiconOverride = useUIStore(state => state.setLexiconOverride);

  const [editingWorkspace, setEditingWorkspace] = useState<TenantTelemetry | null>(null);
  const { dialogProps: overlay1DialogProps, titleId: overlay1TitleId } = useDialog(() => setEditingWorkspace(null), !!editingWorkspace);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [activeFormTab, setActiveFormTab] = useState<'tier' | 'access' | 'credits' | 'rates' | 'roadmap'>('tier');

  // Advanced Simulation & Modeler variables
  const [simulatedQueries, setSimulatedQueries] = useState(250000);
  const [customKeyRatio, setCustomKeyRatio] = useState(30);
  const [simulatedLogs, setSimulatedLogs] = useState<TelemetryLog[]>([]);

  // Bulk deployment / Synchronization Engine
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkSyncProgress, setBulkSyncProgress] = useState(0);
  const [bulkSyncTotal, setBulkSyncTotal] = useState(0);
  const [bulkSyncStatusText, setBulkSyncStatusText] = useState('');
  const [showBulkSuccess, setShowBulkSuccess] = useState(false);
  const { dialogProps: overlay2DialogProps, titleId: overlay2TitleId } = useDialog(() => setShowBulkSuccess(false), showBulkSuccess);

  // User Management Engine
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [, setLoadingUsers] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<'workspaces' | 'users' | 'global' | 'lexicon' | 'audit'>('workspaces');
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [userFormState, setUserFormState] = useState({
    role: 'client',
    customLimit: 0,
    computeCreditLimit: 0
  });

  const [formState, setFormState] = useState({
    plan: 'sandbox',
    concurrentUserLimit: 50,
    maxSeats: 3,
    computeCreditBalance: 100000,
    apiQuotaMonthlyLimitCents: 0,
    creditCostMultiplier: 1.0,
    quotaCentsMultiplier: 1.0,
    bypassBilling: false,
    customKeyCreditCharge: 10,
    customKeyCentsCharge: 0
  });

  const startEditing = (tenant: TenantTelemetry) => {
    setEditingWorkspace(tenant);
    setActiveFormTab('tier'); // Reset to first tab on launch
    setFormState({
      plan: tenant.plan || 'sandbox',
      concurrentUserLimit: Number(tenant.concurrentUserLimit) || 50,
      maxSeats: Number(tenant.maxSeats) || 3,
      computeCreditBalance: tenant.computeCreditBalance !== undefined ? Number(tenant.computeCreditBalance) : 100000,
      apiQuotaMonthlyLimitCents: Number(tenant.apiQuotaMonthlyLimitCents) || 0,
      creditCostMultiplier: tenant.creditCostMultiplier !== undefined ? Number(tenant.creditCostMultiplier) : 1.0,
      quotaCentsMultiplier: tenant.quotaCentsMultiplier !== undefined ? Number(tenant.quotaCentsMultiplier) : 1.0,
      bypassBilling: tenant.bypassBilling === true,
      customKeyCreditCharge: tenant.customKeyCreditCharge !== undefined ? Number(tenant.customKeyCreditCharge) : 10,
      customKeyCentsCharge: tenant.customKeyCentsCharge !== undefined ? Number(tenant.customKeyCentsCharge) : 0
    });
  };

  const handleSaveWorkspaceLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWorkspace) return;
    setSavingWorkspace(true);
    try {
      const res = await fetchWithAuth(`/api/v1/admin/workspaces/${editingWorkspace.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formState)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          // Re-fetch telemetry immediately to reflect updates cleanly
          await fetchTelemetry();
          setEditingWorkspace(null);
        } else {
          throw new Error(data.message || 'Failed to update workspace policies');
        }
      } else {
         throw new Error('Administrative database returned non-success code.');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingWorkspace(false);
    }
  };

  // Bulk Apply baseline configuration to ALL workspaces sequentially
  const handleBulkApplyBaseline = async () => {
    const list = telemetry?.tenants || [];
    if (list.length === 0) return;
    setBulkSyncing(true);
    setBulkSyncProgress(0);
    setBulkSyncTotal(list.length);
    setBulkSyncStatusText('Commencing ledger re-alignment...');

    try {
      for (let i = 0; i < list.length; i++) {
        const tenant = list[i];
        setBulkSyncStatusText(`Re-deploying system multipliers to tenant: ${tenant.id}...`);

        const payload = {
          plan: tenant.plan || 'sandbox',
          concurrentUserLimit: Number(tenant.concurrentUserLimit) || 50,
          maxSeats: Number(tenant.maxSeats) || 3,
          computeCreditBalance: tenant.computeCreditBalance !== undefined ? Number(tenant.computeCreditBalance) : 100000,
          apiQuotaMonthlyLimitCents: Number(tenant.apiQuotaMonthlyLimitCents) || 0,
          creditCostMultiplier: Number(globalConfig.creditCostMultiplier),
          quotaCentsMultiplier: Number(globalConfig.quotaCentsMultiplier),
          bypassBilling: globalConfig.bypassBilling,
          customKeyCreditCharge: Number(globalConfig.customKeyCreditCharge),
          customKeyCentsCharge: Number(globalConfig.customKeyCentsCharge)
        };

        await fetchWithAuth(`/api/v1/admin/workspaces/${tenant.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        setBulkSyncProgress(i + 1);
      }

      setBulkSyncStatusText('Refreshing global configurations...');
      await fetchTelemetry();
      setShowBulkSuccess(true);
    } catch (error) {
      toast.error(`Bulk Sync Error: ${errorMessage(error)}`);
    } finally {
      setBulkSyncing(false);
    }
  };

  // Trigger System Diagnostic event directly in system telemetry logs
  const handleTriggerStressEvent = (type: 'db_timeout' | 'quota_low' | 'normal_gemini') => {
    const secureRandomInt = (maxExclusive: number) => {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('maxExclusive must be a positive integer');
      }

      const UINT32_RANGE = 0x100000000; // 2^32
      const acceptableUpperBound = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
      const buffer = new Uint32Array(1);

      let randomValue: number;
      do {
        globalThis.crypto.getRandomValues(buffer);
        randomValue = buffer[0];
      } while (randomValue >= acceptableUpperBound);

      return randomValue % maxExclusive;
    };

    const freshLog: TelemetryLog = {
      timestamp: new Date().toISOString(),
      statusCode: type === 'db_timeout' ? 503 : type === 'quota_low' ? 429 : 200,
      method: type === 'normal_gemini' ? 'POST' : 'GET',
      path: type === 'normal_gemini' ? `/api/v1/workspace/gemini/summarize` : `/api/v1/transactions/ledger_audit`,
      ip: `10.244.31.${secureRandomInt(254)}`,
      apiKeyUsed: `test_sim_ws_${secureRandomInt(1000)}_key`,
      simulated: true
    };

    setSimulatedLogs(prev => [freshLog, ...prev]);
  };

  const [globalConfig, setGlobalConfig] = useState({
    creditCostMultiplier: 1.0,
    quotaCentsMultiplier: 1.0,
    bypassBilling: false,
    customKeyCreditCharge: 10,
    customKeyCentsCharge: 0,
    maxRegistrationLimit: 100,
    freeWorkspaceTxCap: 100
  });
  const [updatingGlobal, setUpdatingGlobal] = useState(false);

  const startEditingUser = (u: AdminUser) => {
    setEditingUser(u);
    setUserFormState({
      role: u.role || 'client',
      customLimit: u.customLimit || 0,
      computeCreditLimit: u.computeCreditLimit || 0
    });
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSavingUser(true);
    try {
      const payload = {
        role: userFormState.role as 'client' | 'admin',
        customLimit: userFormState.customLimit ? Number(userFormState.customLimit) : null,
        computeCreditLimit: userFormState.computeCreditLimit ? Number(userFormState.computeCreditLimit) : null
      };

      const res = await fetchWithAuth(`/api/v1/admin/users/${editingUser.uid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to update user');
      }

      toast.success('User updated successfully');

      // Re-fetch users instantly
      await fetchUsersData();
      setEditingUser(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingUser(false);
    }
  };

  const handleSaveGlobalConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingGlobal(true);
    try {
      const res = await fetchWithAuth('/api/v1/admin/global-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(globalConfig)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          // Sync state instantly
          setGlobalConfig(data.globalAdminConfig);
        } else {
          throw new Error(data.message || 'Failed to update global pricing formulas');
        }
      } else {
        throw new Error('Server returned non-success response code.');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUpdatingGlobal(false);
    }
  };

    const fetchTelemetry = async () => {
      try {
        const workspacesSnap = await getDocs(collection(db, "workspaces"));
        const transactionsSnap = await getDocs(collection(db, "transactions"));
        const transactions = transactionsSnap.docs.map(doc => doc.data() as Transaction);

        const tenants: Record<string, TenantTelemetry> = {};
        workspacesSnap.docs.forEach(doc => {
           const data: Partial<Workspace> = doc.data() || {};
           tenants[doc.id] = {
               id: doc.id,
               name: data.name || "Default Workspace",
               plan: data.plan || "sandbox",
               concurrentUserLimit: data.concurrentUserLimit || 50,
               activeUserCount: data.activeUserCount || 0,
               seatCount: data.seatCount || 1,
               maxSeats: data.maxSeats || 5,
               computeCreditBalance: data.computeCreditBalance || 500,
               apiQuotaTotalCentsUsed: data.apiQuotaTotalCentsUsed || 0,
               apiQuotaMonthlyLimitCents: data.apiQuotaMonthlyLimitCents || 1000,
               creditCostMultiplier: 1.0,
               quotaCentsMultiplier: 1.0,
               bypassBilling: false,
               customKeyCreditCharge: 10,
               customKeyCentsCharge: 0,
               txCount: 0,
               requestCount: 0,
               errorCount: 0
           };
        });

        transactions.forEach(tx => {
            if (tx.workspaceId && tenants[tx.workspaceId]) {
                tenants[tx.workspaceId].txCount++;
            }
        });

        setTelemetry({
          status: 'success',
          tenants: Object.values(tenants),
          liveLogs: []
        });
      } catch {
        setTelemetry({
          status: 'success',
          tenants: [],
          liveLogs: []
        });
      } finally {
        setLoading(false);
      }
    };

    const fetchUsersData = async () => {
      setLoadingUsers(true);
      try {
        const usersSnap = await getDocs(collection(db, "users"));
        const usersData = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() as Omit<AdminUser, 'uid'> }));
        setUsersList(usersData);
      } catch (e) {
        console.warn('Admin users fetch error', e);
      } finally {
        setLoadingUsers(false);
      }
    };

    const fetchGlobalConfig = async () => {
      try {
        const res = await fetchWithAuth('/api/v1/admin/global-config');
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'success' && data.globalAdminConfig) {
            setGlobalConfig(data.globalAdminConfig);
          }
        }
      } catch (e) {
        console.warn('Global billing overrides fetch bypassed:', e);
      }
    };

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchTelemetry();
      void fetchGlobalConfig();
      void fetchUsersData();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useVisibilityPolling(fetchTelemetry, 15_000, {
    enabled: activeMainTab === 'workspaces' || activeMainTab === 'audit',
  });
  useVisibilityPolling(fetchUsersData, 15_000, {
    enabled: activeMainTab === 'users',
  });

  const allLogsCombined = [...simulatedLogs, ...(telemetry?.liveLogs || [])];
  const totalErrors = allLogsCombined.filter((l) => l.statusCode >= 500).length;
  const liveErrors = allLogsCombined.filter((l) => l.statusCode >= 400);

  useAuthStore(s => s.isAdmin);

  return { overlay1DialogProps, overlay1TitleId, overlay2DialogProps, overlay2TitleId, formatPlatformUsdQuota, formId, telemetry, loading, lexiconOverrides, setLexiconOverride, editingWorkspace, setEditingWorkspace, savingWorkspace, activeFormTab, setActiveFormTab, simulatedQueries, setSimulatedQueries, customKeyRatio, setCustomKeyRatio, simulatedLogs, setSimulatedLogs, bulkSyncing, bulkSyncProgress, bulkSyncTotal, bulkSyncStatusText, showBulkSuccess, setShowBulkSuccess, usersList, activeMainTab, setActiveMainTab, editingUser, setEditingUser, savingUser, userFormState, setUserFormState, formState, setFormState, startEditing, handleSaveWorkspaceLimits, handleBulkApplyBaseline, handleTriggerStressEvent, globalConfig, setGlobalConfig, updatingGlobal, startEditingUser, handleSaveUser, handleSaveGlobalConfig, totalErrors, liveErrors };
}

export type SystemCommandCenterModel = ReturnType<typeof useSystemCommandCenterModel>;

export default function SystemCommandCenter() {
 return <SystemCommandCenterView {...useSystemCommandCenterModel()} />;
}

/** Platform quotas are billed in USD, independent of workspace currency. */
function formatPlatformUsdQuota(cents: number): string {
 return `$${(cents / 100).toFixed(2)}`;
}
