import { useDialog } from '../../hooks/useDialog';
import { useState, useEffect, useId, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';

import { toast } from 'sonner';
import { getLocalDateISO } from '../../lib/utils';
import { errorMessage } from '../../lib/errorRemedies';
import { commandErrorMessage, runCommand, ServerCommandError } from '../../lib/runCommand';
import { COMMAND_MANIFEST } from '../../lib/commands.generated';
import { convertXeroAccounts as _convertXeroAccounts } from '../../lib/xeroAdapter';
import { db, getIdToken } from '../../firebase';
import { collection, query, where, getDocs } from '../../lib/db/firestore';
import { useTimeout } from '../../hooks/useTimeout';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

import { AVAILABLE_SCOPES, ApiLogEntry, PublicKeyRow } from './ApiHubShared';
import { copyText } from '../../lib/clipboard';
/** Provides state, API key lifecycle actions, sandbox runner, and visibility-gated log polling for ApiHub. */
export function useApiHubModel() {
  const formId = useId();
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const user = useAuthStore(s => s.user);
  const workspaces = useAuthStore(s => s.workspaces);
  const setCurrentWorkspaceId = useAuthStore(s => s.setCurrentWorkspaceId);
  const currentWorkspace = getCurrentWorkspace();
  const [nowMs] = useState(() => Date.now());
  const [apiKey, setApiKey] = useState('');
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  // bumped when a new key replaces the shown one: a copy of the old key must not mark the new one copied
  const keyGeneration = useRef(0);
  const { setSafeTimeout } = useTimeout();
  const [activeTab, setActiveTab] = useState<'overview' | 'keys' | 'logs' | 'docs' | 'billing' | 'sandbox'>('overview');
  const [activeDoc, setActiveDoc] = useState('post-transaction');
  const [docLang, setDocLang] = useState<'curl' | 'python' | 'node'>('curl');

  const [publicKeys, setPublicKeys] = useState<PublicKeyRow[]>([]);
  const [newKeyName, setNewKeyName] = useState('Production Integration Key');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(AVAILABLE_SCOPES.map(s => s.id));
  const [expiration, setExpiration] = useState<'never' | '1h' | '24h' | '30d' | '90d'>('never');
  // Z-02: requests a minute the new key may make
  const [perMinute, setPerMinute] = useState(120);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(() => setShowCreateModal(false), showCreateModal);

  // Corporate Billing and Computational Resource Metering
  const [simSeatsCount, setSimSeatsCount] = useState(1);
  const [simRequestsCount, setSimRequestsCount] = useState(50);
  const [isSimulatingBurst, setIsSimulatingBurst] = useState(false);
  useState<string | null>(null);

  // Live Interactive Playground Sandbox State
  const [sandboxEndpoint, setSandboxEndpoint] = useState<string>('GET_v1_status');
  const [sandboxCredType, setSandboxCredType] = useState<'session' | 'key'>('session');
  const [sandboxSelectedKey, setSandboxSelectedKey] = useState<string>('');
  const [sandboxResult, setSandboxResult] = useState<unknown>(null);
  const [sandboxStatus, setSandboxStatus] = useState<number | null>(null);
  const [sandboxLatency, setSandboxLatency] = useState<number | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState<boolean>(false);
  const [sandboxLang, setSandboxLang] = useState<'curl' | 'python' | 'node'>('curl');

  // Dynamic fields
  const [fieldDesc, setFieldDesc] = useState('AWS EC2 Cloud Compute Virtual Machine Node billing');
  const [fieldAmountCents, setFieldAmountCents] = useState(15000); // $150.00
  const [fieldDate, setFieldDate] = useState(getLocalDateISO());
  const [fieldDryRun, setFieldDryRun] = useState(false);
  const [fieldIdempotencyKey, setFieldIdempotencyKey] = useState("lf_idem_" + crypto.randomUUID());
  const [fieldCOAName, setFieldCOAName] = useState('Procurement Cost Subaccount');
  const [fieldCOAType, setFieldCOAType] = useState('expense');
  const [fieldCOACode, setFieldCOACode] = useState('5230');
  const [fieldProjectName, setFieldProjectName] = useState('Project Phoenix Integration');
  const [fieldProjectCode, setFieldProjectCode] = useState('PHX-001');
  const [fieldMatchDesc, setFieldMatchDesc] = useState('Uber Trip transport ride\nAWS Cloud Services database bill\nMonthly advisory fee Deloitte business');
  const [fieldAIPrompt, setFieldAIPrompt] = useState('Explain what operational cost adjustments we should carry out based on our high software subscription drift.');

  const workspaceId = currentWorkspace?.id ?? null;
  const userUid = user?.uid ?? null;

  const loadBillingStatus = useCallback(async function loadBillingStatus() {
    if (!workspaceId || !userUid) return;
    try {
      const data = await runCommand<{ seatCount?: number }>({
        path: `/api/v1/billing/status?workspaceId=${workspaceId}`,
      });
      if (useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
      if (data?.seatCount) setSimSeatsCount(data.seatCount);
    } catch (e) {
      console.error("Failed to load billing status", e);
    }
  }, [workspaceId, userUid]);

  const handleCheckout = async (plan: string) => {
    if (!currentWorkspace?.id || !user) return;
    try {
      const data = await runCommand<{ url?: string; message?: string }>({
        path: '/api/v1/billing/checkout',
        method: 'POST',
        body: { workspaceId: currentWorkspace.id, plan },
      }) ?? {};
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.message || 'Failed to create checkout session');
      }
    } catch (e) {
      toast.error('Checkout Error', { description: errorMessage(e) });
    }
  };

  const loadWorkspaceKeys = useCallback(async function loadWorkspaceKeys() {
    if (!workspaceId || !userUid) return;
    try {
      const q = query(
        collection(db, 'apiKeys'),
        where('workspaceId', '==', workspaceId),
        where('uid', '==', userUid)
      );
      const snap = await getDocs(q);
      if (useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
      const keys = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || 'Unnamed Key',
          scopes: data.scopes || [],
          expiresAt: data.expiresAt || 'never',
          lastUsedAt: data.lastUsedAt || null,
          totalRequests: data.totalRequests || 0,
          createdAt: data.createdAt
        };
      });
      setPublicKeys(keys);
    } catch (e) {
      console.error(e);
    }
  }, [workspaceId, userUid]);

  const fetchLogs = useCallback(async function fetchLogs() {
    if (!workspaceId) return;
    try {
      const token = userUid ? await getIdToken() : '';
      const data = await runCommand<typeof apiLogs>({
        path: `/api/v1/logs?workspaceId=${workspaceId}`,
        // an API key answers for the integration itself, so the session token is not a substitute
        headers: { Authorization: `Bearer ${apiKey || token}` },
        token: apiKey ? null : undefined,
      });
      if (useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
      setApiLogs(data);
    } catch (e) {
      console.error("Failed to fetch logs", e);
    }
  }, [apiKey, workspaceId, userUid]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    const timer = setTimeout(() => {
      void loadBillingStatus();
      void loadWorkspaceKeys();
      void fetchLogs();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [workspaceId, fetchLogs, loadBillingStatus, loadWorkspaceKeys]);

  // Refresh credentials or billing summary once in the foreground when opening the relevant tab
  const prevActiveTabRef = useRef(activeTab);
  useEffect(() => {
    const prevTab = prevActiveTabRef.current;
    prevActiveTabRef.current = activeTab;
    if (!workspaceId || prevTab === activeTab) return undefined;
    if (activeTab !== 'keys' && activeTab !== 'sandbox' && activeTab !== 'billing') {
      return undefined;
    }
    const timer = setTimeout(() => {
      if (activeTab === 'keys' || activeTab === 'sandbox') {
        void loadWorkspaceKeys();
      } else {
        void loadBillingStatus();
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [activeTab, workspaceId, loadWorkspaceKeys, loadBillingStatus]);

  const isLogsPollingTab = activeTab === 'logs' || activeTab === 'billing';
  useVisibilityPolling(fetchLogs, 5_000, {
    enabled: Boolean(workspaceId) && isLogsPollingTab,
    runImmediately: true,
  });

  const generateNewKey = async () => {
    if (!currentWorkspace?.id || !user) return;
    setIsRegenerating(true);
    try {
      // a refusal throws with the server's own message, which is the sentence this toast was built from
      const data = await runCommand<{ apiKey?: string }>({
        path: '/api/v1/keys/provision',
        method: 'POST',
        body: {
          workspaceId: currentWorkspace.id,
          name: newKeyName || 'Production Integration Key',
          scopes: selectedScopes,
          expiration,
          rateLimitPerMinute: perMinute,
        },
      });
      keyGeneration.current += 1;
      setApiKey(data.apiKey ?? '');
      setIsCopied(false);
      toast.success('Developer API Key Provisioned', {
        description: 'New deep authentication token is ready for use. Store this safely.'
      });
      void loadWorkspaceKeys();
      setShowCreateModal(false);
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate key', { description: errorMessage(e) });
    } finally {
      setIsRegenerating(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!currentWorkspace?.id || !user) return;
    try {
      await runCommand({
        path: `/api/v1/keys/revoke/${keyId}`,
        method: 'DELETE',
      });

      toast.success('Key Revoked.');
      void loadWorkspaceKeys();
      if (apiKey.startsWith(keyId)) {
        keyGeneration.current += 1;
        setApiKey('');
        setIsCopied(false);
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to revoke key', { description: errorMessage(e) });
    }
  };

  const copyKey = () => {
    if (!apiKey) return;
    const generation = keyGeneration.current;
    void copyText(apiKey).then(ok => {
      if (generation !== keyGeneration.current) return;
      if (!ok) { toast.error('The browser blocked copying. Select the key above and copy it by hand.'); return; }
      setIsCopied(true);
      setSafeTimeout(() => { if (generation === keyGeneration.current) setIsCopied(false); }, 2000);
      toast.success('Key copied to clipboard');
    });
  };

  /**
   * Runs one registered command from the sandbox, with the same credentials the endpoint list uses.
   *
   * This is what the schema form is for: the 24 commands the server publishes have no sandbox entry
   * today, and the alternative to this is 24 hand-built payload forms that go stale the first time a
   * command changes. `runCommand` reads the answer the same way every screen does, so the sandbox shows
   * exactly what a screen would see — including the refusal sentence, not a bare status.
   */
  const runSandboxCommand = async (command: string, input: Record<string, unknown>) => {
    setSandboxLoading(true);
    setSandboxResult(null);
    setSandboxStatus(null);
    setSandboxLatency(null);
    const startedAt = performance.now();
    try {
      const auth = sandboxCredType === 'session'
        ? (user ? await getIdToken() : '')
        : (sandboxSelectedKey || apiKey || publicKeys[0]?.id || '');
      if (!auth) throw new Error('No API key selected or generated yet. Choose User Session instead, or generate a key.');
      const answer = await runCommand({
        path: `/api/v1/commands/${command}`,
        method: 'POST',
        token: auth,
        body: { workspaceId: currentWorkspace?.id, input },
      });
      setSandboxLatency(Math.round(performance.now() - startedAt));
      setSandboxStatus(200);
      setSandboxResult(answer ?? { ok: true });
      return true;
    } catch (error) {
      setSandboxLatency(Math.round(performance.now() - startedAt));
      setSandboxStatus(error instanceof ServerCommandError ? error.status : 0);
      setSandboxResult({
        error: commandErrorMessage(error),
        // the offered next step, for the sandbox reader who wants to know what to change
        next: error instanceof ServerCommandError && (error.body as { next?: string } | undefined)?.next,
      });
      return false;
    } finally {
      setSandboxLoading(false);
    }
  };

  const getEndpointPath = (endpoint: string) => {
    if (endpoint.startsWith('COMMAND_')) return `commands/${endpoint.slice('COMMAND_'.length)}`;
    switch (endpoint) {
      case 'GET_v1_status': return 'status';
      case 'GET_v1_workspaces': return 'workspaces';
      case 'GET_v1_ledger': return 'ledger';
      case 'POST_v1_ledger': return 'ledger';
      case 'GET_v1_ledger_diagnostics': return 'ledger/diagnostics';
      case 'GET_v1_transactions': return 'transactions';
      case 'POST_v1_transactions': return 'transactions';
      case 'POST_v1_transactions_bulk': return 'transactions/bulk';
      case 'GET_v1_projects': return 'projects';
      case 'POST_v1_projects': return 'projects';
      case 'GET_v1_metrics': return 'metrics';
      case 'POST_ledger_match': return 'ledger/match';
      case 'POST_brain_analyze': return 'brain/analyze';
      case 'POST_v1_brain_classify_batch': return 'brain/classify-batch';
      default: return 'status';
    }
  };

  /** The HTTP method an endpoint selection implies. A registered command is always a POST. */
  const sandboxMethod = (endpoint: string) => endpoint.startsWith('COMMAND_') ? 'POST' : endpoint.split('_')[0];

  const getSandboxPayload = (endpoint: string) => {
    const wsId = currentWorkspace?.id || '';
    if (endpoint.startsWith('COMMAND_')) {
      // the command's own documented example, so the snippet a reader copies is a real request
      const name = endpoint.slice('COMMAND_'.length);
      const entry = COMMAND_MANIFEST.find(command => command.name === name);
      const example = (entry?.description as { example?: unknown } | undefined)?.example;
      return { workspaceId: wsId, input: example && typeof example === 'object' ? example : {} };
    }
    switch (endpoint) {
      case 'POST_v1_transactions':
        return {
          workspaceId: wsId,
          date: fieldDate || getLocalDateISO(),
          description: fieldDesc || "AWS Hosting Tier Upgrade",
          amountCents: Number(fieldAmountCents) || 185000,
          dryRun: fieldDryRun,
          idempotencyKey: fieldIdempotencyKey || "lf_idem_9s7d3"
        };
      case 'POST_v1_transactions_bulk':
        return {
          workspaceId: wsId,
          transactions: [
            {
              date: fieldDate || getLocalDateISO(),
              description: fieldDesc || "Copier Machine Lease Monthly",
              amountCents: Number(fieldAmountCents) || 22000,
              idempotencyKey: "bulk_idem_1a2b3c"
            },
            {
              date: fieldDate || getLocalDateISO(),
              description: "Delta Air Lines Business Inbound Flight #98218-CA",
              amountCents: 45000,
              idempotencyKey: "bulk_idem_4d5e6f"
            }
          ],
          dryRun: fieldDryRun
        };
      case 'POST_v1_ledger':
        return {
          workspaceId: wsId,
          name: fieldCOAName || "Research Development Office",
          code: fieldCOACode || "5230",
          type: fieldCOAType || "expense"
        };
      case 'POST_v1_projects':
        return {
          workspaceId: wsId,
          name: fieldProjectName || "Enterprise Cloud Modernisation",
          code: fieldProjectCode || "PRJ-PHX-01"
        };
      case 'POST_ledger_match':
        return {
          workspaceId: wsId,
          descriptions: fieldMatchDesc.split('\n').filter(Boolean).length > 0
            ? fieldMatchDesc.split('\n').filter(Boolean)
            : ["Uber trip ride NY", "AWS Web Services Invoice"]
        };
      case 'POST_v1_brain_classify_batch':
        return {
          workspaceId: wsId,
          descriptions: fieldMatchDesc.split('\n').filter(Boolean).length > 0
            ? fieldMatchDesc.split('\n').filter(Boolean)
            : ["Google Workspace Subscription", "Rent Office Suite 12", "Hardware Store Staples"]
        };
      case 'POST_brain_analyze':
        return {
          workspaceId: wsId,
          prompt: fieldAIPrompt || "Generate executive review of cash allocation anomalies across our ledger assets."
        };
      default:
        return null;
    }
  };

  const runSandboxRequest = async () => {
    if (!currentWorkspace?.id) {
      toast.error("Please select a workspace before running queries.");
      return;
    }
    setSandboxLoading(true);
    setSandboxResult(null);
    setSandboxStatus(null);
    setSandboxLatency(null);

    const startTime = performance.now();
    try {
      let endpointUrl = '';
      let method = 'GET';
      let bodyData: Record<string, unknown> | null = null;

      switch (sandboxEndpoint) {
        case 'GET_v1_status':
          endpointUrl = `/api/v1/status?workspaceId=${currentWorkspace.id}`;
          method = 'GET';
          break;
        case 'GET_v1_workspaces':
          endpointUrl = `/api/v1/workspaces`;
          method = 'GET';
          break;
        case 'GET_v1_ledger':
          endpointUrl = `/api/v1/ledger?workspaceId=${currentWorkspace.id}`;
          method = 'GET';
          break;
        case 'POST_v1_ledger':
          endpointUrl = `/api/v1/ledger`;
          method = 'POST';
          bodyData = {
            workspaceId: currentWorkspace.id,
            name: fieldCOAName,
            code: fieldCOACode,
            type: fieldCOAType
          };
          break;
        case 'GET_v1_transactions':
          endpointUrl = `/api/v1/transactions?workspaceId=${currentWorkspace.id}`;
          method = 'GET';
          break;
        case 'POST_v1_transactions':
          endpointUrl = `/api/v1/transactions`;
          method = 'POST';
          bodyData = {
            workspaceId: currentWorkspace.id,
            date: fieldDate,
            description: fieldDesc,
            amountCents: Number(fieldAmountCents),
            dryRun: fieldDryRun,
            idempotencyKey: fieldIdempotencyKey
          };
          break;
        case 'GET_v1_projects':
          endpointUrl = `/api/v1/projects?workspaceId=${currentWorkspace.id}`;
          method = 'GET';
          break;
        case 'POST_v1_projects':
          endpointUrl = `/api/v1/projects`;
          method = 'POST';
          bodyData = {
            workspaceId: currentWorkspace.id,
            name: fieldProjectName,
            code: fieldProjectCode
          };
          break;
        case 'GET_v1_metrics':
          endpointUrl = `/api/v1/metrics?workspaceId=${currentWorkspace.id}`;
          method = 'GET';
          break;
        case 'POST_ledger_match':
          endpointUrl = `/api/v1/ledger/match`;
          method = 'POST';
          bodyData = {
            workspaceId: currentWorkspace.id,
            descriptions: fieldMatchDesc.split('\n').filter(x => x.trim())
          };
          break;
        case 'POST_brain_analyze':
          endpointUrl = `/api/v1/brain/analyze`;
          method = 'POST';
          bodyData = {
            workspaceId: currentWorkspace.id,
            prompt: fieldAIPrompt
          };
          break;
        case 'POST_v1_transactions_bulk':
          endpointUrl = `/api/v1/transactions/bulk`;
          method = 'POST';
          bodyData = {
            workspaceId: currentWorkspace.id,
            transactions: [
              {
                date: fieldDate || getLocalDateISO(),
                description: fieldDesc || "Copier Machine Lease Monthly",
                amountCents: Number(fieldAmountCents) || 22000,
                idempotencyKey: "bulk_idem_" + crypto.randomUUID()
              },
              {
                date: fieldDate || getLocalDateISO(),
                description: "Delta Air Lines Business Inbound Flight #98218-CA",
                amountCents: 45000,
                idempotencyKey: "bulk_idem_" + crypto.randomUUID()
              }
            ],
            dryRun: fieldDryRun
          };
          break;
        case 'GET_v1_ledger_diagnostics':
          endpointUrl = `/api/v1/ledger/diagnostics?workspaceId=${currentWorkspace.id}`;
          method = 'GET';
          break;
        case 'POST_v1_brain_classify_batch':
          endpointUrl = `/api/v1/brain/classify-batch`;
          method = 'POST';
          bodyData = {
            workspaceId: currentWorkspace.id,
            descriptions: fieldMatchDesc.split('\n').filter(x => x.trim()).length > 0
              ? fieldMatchDesc.split('\n').filter(x => x.trim())
              : ["Rent Payment Suite A", "GitHub Team Subscription", "Stripe Fee Processing", "Starbucks Coffee Retail Store #13"]
          };
          break;
        default:
          throw new Error('Unsupported sandbox endpoint selective pathway.');
      }

      let authHeader = '';
      if (sandboxCredType === 'session') {
        const token = user ? await getIdToken() : '';
        authHeader = `Bearer ${token}`;
      } else {
        const tokenToUse = sandboxSelectedKey || apiKey || (publicKeys[0] ? publicKeys[0].id : '');
        if (!tokenToUse) {
          throw new Error('No API Key selected or generated yet. Please select User Session instead or generate a key.');
        }
        authHeader = `Bearer ${tokenToUse}`;
      }

      const headers: Record<string, string> = {
        'Authorization': authHeader
      };

      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(endpointUrl, {
        method,
        headers,
        body: bodyData ? JSON.stringify(bodyData) : undefined
      });

      const endTime = performance.now();
      const duration = Math.round(endTime - startTime);
      setSandboxLatency(duration);
      setSandboxStatus(res.status);

      const data = await res.json();
      setSandboxResult(data);

      void fetchLogs();
      void loadBillingStatus();
      toast.success(`API Ingestion Completed in ${duration}ms`, {
        description: `HTTP Status ${res.status}`
      });

    } catch (e) {
      console.error(e);
      const endTime = performance.now();
      setSandboxLatency(Math.round(endTime - startTime));
      setSandboxStatus(500);
      setSandboxResult({ error: errorMessage(e) });
      toast.error('Sandbox Execution Faulted', { description: errorMessage(e) });
    } finally {
      setSandboxLoading(false);
    }
  };

  return { overlayDialogProps, overlayTitleId, formId, currentWorkspaceId, workspaces, setCurrentWorkspaceId, currentWorkspace, nowMs, apiKey, apiLogs, isRegenerating, isCopied, activeTab, setActiveTab, activeDoc, setActiveDoc, docLang, setDocLang, publicKeys, newKeyName, setNewKeyName, selectedScopes, setSelectedScopes, expiration, setExpiration, perMinute, setPerMinute, showCreateModal, setShowCreateModal, simSeatsCount, setSimSeatsCount, simRequestsCount, setSimRequestsCount, isSimulatingBurst, setIsSimulatingBurst, sandboxEndpoint, setSandboxEndpoint, sandboxCredType, setSandboxCredType, sandboxSelectedKey, setSandboxSelectedKey, sandboxResult, setSandboxResult, sandboxStatus, setSandboxStatus, sandboxLatency, setSandboxLatency, sandboxLoading, sandboxLang, setSandboxLang, fieldDesc, setFieldDesc, fieldAmountCents, setFieldAmountCents, fieldDate, setFieldDate, fieldDryRun, setFieldDryRun, fieldIdempotencyKey, setFieldIdempotencyKey, fieldCOAName, setFieldCOAName, fieldCOAType, setFieldCOAType, fieldCOACode, setFieldCOACode, fieldProjectName, setFieldProjectName, fieldProjectCode, setFieldProjectCode, fieldMatchDesc, setFieldMatchDesc, fieldAIPrompt, setFieldAIPrompt, loadBillingStatus, handleCheckout, fetchLogs, generateNewKey, revokeKey, copyKey, getEndpointPath, getSandboxPayload, runSandboxRequest, runSandboxCommand, sandboxMethod };
}
