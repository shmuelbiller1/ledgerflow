import { useDialog } from '../../hooks/useDialog';
import { useState, useEffect, useId, useCallback } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';

import { toast } from 'sonner';
import { getLocalDateISO } from '../../lib/utils';
import { errorMessage } from '../../lib/errorRemedies';
import { convertXeroAccounts as _convertXeroAccounts } from '../../lib/xeroAdapter';
import { db, getIdToken } from '../../firebase';
import { collection, query, where, getDocs } from '../../lib/db/firestore';
import { useTimeout } from '../../hooks/useTimeout';

import { AVAILABLE_SCOPES, ApiLogEntry, PublicKeyRow } from './ApiHubShared';
import { copyText } from '../../lib/clipboard';
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

  const loadBillingStatus = useCallback(async function loadBillingStatus() {
    if (!currentWorkspace?.id || !user) return;
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/v1/billing/status?workspaceId=${currentWorkspace.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.seatCount) {
          setSimSeatsCount(data.seatCount);
        }
      }
    } catch (e) {
      console.error("Failed to load billing status", e);
    }
  }, [currentWorkspace, user]);

  const handleCheckout = async (plan: string) => {
    if (!currentWorkspace?.id || !user) return;
    try {
      const token = await getIdToken();
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workspaceId: currentWorkspace.id,
          plan: plan
        })
      });
      const data = await res.json();
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
    if (!currentWorkspace?.id || !user) return;
    try {
      const q = query(
        collection(db, 'apiKeys'),
        where('workspaceId', '==', currentWorkspace.id),
        where('uid', '==', user.uid)
      );
      const snap = await getDocs(q);
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
  }, [currentWorkspace, user]);

  const fetchLogs = useCallback(async function fetchLogs() {
    if (!currentWorkspace?.id) return;
    try {
      const token = user ? await getIdToken() : '';
      const authHeader = `Bearer ${(apiKey || token)}`;
      const res = await fetch(`/api/v1/logs?workspaceId=${currentWorkspace.id}`, {
        headers: {
          'Authorization': authHeader
        }
      });
      if (res.ok) {
        const data = await res.json();
        setApiLogs(data);
      }
    } catch (e) {
      console.error("Failed to fetch logs", e);
    }
  }, [apiKey, currentWorkspace, user]);

  useEffect(() => {
    if (!currentWorkspace?.id) return;
    const timer = setTimeout(() => {
      loadBillingStatus();
      loadWorkspaceKeys();
      fetchLogs();
    }, 0);
    const interval = setInterval(fetchLogs, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [currentWorkspace?.id, activeTab, fetchLogs, loadBillingStatus, loadWorkspaceKeys]);

  const generateNewKey = async () => {
    if (!currentWorkspace?.id || !user) return;
    setIsRegenerating(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/v1/keys/provision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          workspaceId: currentWorkspace.id,
          name: newKeyName || 'Production Integration Key',
          scopes: selectedScopes,
          expiration: expiration,
          rateLimitPerMinute: perMinute
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Key generation endpoint rejected request.');
      }

      const data = await res.json();
      setApiKey(data.apiKey);
      toast.success('Developer API Key Provisioned', {
        description: 'New deep authentication token is ready for use. Store this safely.'
      });
      loadWorkspaceKeys();
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
      const token = await getIdToken();
      const res = await fetch(`/api/v1/keys/revoke/${keyId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Key revoking endpoint rejected request.');
      }

      toast.success('Key Revoked.');
      loadWorkspaceKeys();
      if (apiKey.startsWith(keyId)) {
        setApiKey('');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to revoke key', { description: errorMessage(e) });
    }
  };

  const copyKey = () => {
    if (!apiKey) return;
    void copyText(apiKey).then(ok => {
      if (!ok) { toast.error('The browser refused the clipboard. Select the text and copy it by hand.'); return; }
      setIsCopied(true);
      setSafeTimeout(() => setIsCopied(false), 2000);
      toast.success('Key copied to clipboard');
    });
  };

  const getEndpointPath = (endpoint: string) => {
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

  const getSandboxPayload = (endpoint: string) => {
    const wsId = currentWorkspace?.id || '';
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

      fetchLogs();
      loadBillingStatus();
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

  return { overlayDialogProps, overlayTitleId, formId, currentWorkspaceId, workspaces, setCurrentWorkspaceId, currentWorkspace, nowMs, apiKey, apiLogs, isRegenerating, isCopied, activeTab, setActiveTab, activeDoc, setActiveDoc, docLang, setDocLang, publicKeys, newKeyName, setNewKeyName, selectedScopes, setSelectedScopes, expiration, setExpiration, perMinute, setPerMinute, showCreateModal, setShowCreateModal, simSeatsCount, setSimSeatsCount, simRequestsCount, setSimRequestsCount, isSimulatingBurst, setIsSimulatingBurst, sandboxEndpoint, setSandboxEndpoint, sandboxCredType, setSandboxCredType, sandboxSelectedKey, setSandboxSelectedKey, sandboxResult, setSandboxResult, sandboxStatus, setSandboxStatus, sandboxLatency, setSandboxLatency, sandboxLoading, sandboxLang, setSandboxLang, fieldDesc, setFieldDesc, fieldAmountCents, setFieldAmountCents, fieldDate, setFieldDate, fieldDryRun, setFieldDryRun, fieldIdempotencyKey, setFieldIdempotencyKey, fieldCOAName, setFieldCOAName, fieldCOAType, setFieldCOAType, fieldCOACode, setFieldCOACode, fieldProjectName, setFieldProjectName, fieldProjectCode, setFieldProjectCode, fieldMatchDesc, setFieldMatchDesc, fieldAIPrompt, setFieldAIPrompt, loadBillingStatus, handleCheckout, fetchLogs, generateNewKey, revokeKey, copyKey, getEndpointPath, getSandboxPayload, runSandboxRequest };
}
