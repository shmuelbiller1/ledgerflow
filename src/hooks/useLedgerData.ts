import { useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc,
  addDoc,
  limit,
  orderBy,
  getDocs
} from '../lib/db/firestore';
import { db } from '../firebase';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import type { Transaction, ChartAccount, RecurringTransaction, Workspace, CustomTemplate, UserProfile, DimensionNode } from '../types';
import { Scenario, useScenarioStore } from '../lib/scenarioStore';
import { seedDemoWorkspace } from '../lib/demoWorkspaceSeeder';
import { migrateWorkspaceDimensionNodesToCollection } from '../lib/migrations/dimensionNodesMigration';

import { handleFirestoreError, OperationType } from '../lib/firebaseUtils';

import { safeAsync } from "../lib/utils";
import { useDataNeedsStore } from "../stores/useDataNeedsStore";
import { useUIStore } from "../stores/useUIStore";
import { LEDGER_COLLECTIONS, keysToStart } from "../lib/ledgerCollections";
import type { LedgerCollectionSpec, LedgerKey } from "../lib/ledgerCollections";
import { effectiveLockDate } from '../lib/periodLock';
import { LedgerEngine } from '../kernel/ledger/LedgerEngine';

type LedgerState = ReturnType<typeof useLedgerStore.getState>;
type AnalyticalPattern = LedgerState['analyticalPatternCache'][string];

export function useLedgerData() {
  const user = useAuthStore(s => s.user);
  const userUid = user?.uid;
  const isGuest = useAuthStore(s => s.isGuest);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const setCurrentWorkspaceId = useAuthStore(s => s.setCurrentWorkspaceId);
  const setUserProfile = useAuthStore(s => s.setUserProfile);
  
  const setAccounts = useLedgerStore(s => s.setAccounts);
  const setCustomers = useLedgerStore(s => s.setCustomers);
  const setVendors = useLedgerStore(s => s.setVendors);
  const setTransactions = useLedgerStore(s => s.setTransactions);
  
  // Guest mode seed effect
  useEffect(() => {
    if (!user && isGuest) {
      const demoData = seedDemoWorkspace('guest');
      setAccounts(demoData.accounts);
      setCustomers(demoData.customers);
      setVendors(demoData.vendors);
      setTransactions(demoData.transactions);
      if (!currentWorkspaceId) {
        setCurrentWorkspaceId('guest');
      }
    }
  }, [user, isGuest, setAccounts, setCustomers, setVendors, setTransactions, currentWorkspaceId, setCurrentWorkspaceId]);


  const userEmail = user?.email || '';

  // 1. Workspaces
  useEffect(() => {
    if (!userUid) return;
    const q = query(collection(db, 'workspaces'), where('uid', '==', userUid));
    return onSnapshot(q, async (snapshot) => {
      const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Workspace));
      setWorkspaces(fetched);

      if (fetched.length === 0) {
        // Create Default Workspace
        const defaultWorkspace: Partial<Workspace> = {
          uid: userUid,
          name: 'Personal Workspace',
          businessType: 'personal',
          createdAt: new Date().toISOString(),
          currency: 'USD'
        };
        await safeAsync(
          setDoc(doc(collection(db, 'workspaces')), defaultWorkspace),
          OperationType.CREATE,
          'workspaces',
          { userId: userUid }
        );
      } else {
        // Validation: Ensure current selection is still valid without tearing down channel on switch
        const selectedWorkspaceId = useAuthStore.getState().currentWorkspaceId;
        const isCurrentValid = fetched.some(w => w.id === selectedWorkspaceId);
        if (!selectedWorkspaceId || !isCurrentValid) {
          setCurrentWorkspaceId(fetched[0].id);
        }
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'workspaces'));
  }, [userUid, setCurrentWorkspaceId, setWorkspaces]);

  // 2. User Profile
  useEffect(() => {
    if (!userUid) return;
    return onSnapshot(doc(db, 'users', userUid), async (snap) => {
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        setUserProfile(data);
      } else {
        const profileData: UserProfile = {
          uid: userUid,
          email: userEmail,
          role: 'client',
          createdAt: new Date().toISOString()
        };
        await safeAsync(
          setDoc(doc(db, 'users', userUid), profileData),
          OperationType.CREATE,
          `users/${userUid}`
        );
        setUserProfile(profileData);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${userUid}`));
  }, [userUid, userEmail, setUserProfile]);

  // Sync workspace-level settings (currency, lockDate, and matchingThreshold) to the ledger store
  const workspaces = useAuthStore(state => state.workspaces);
  const baseCurrency = useLedgerStore(state => state.baseCurrency);
  const lockDate = useLedgerStore(state => state.lockDate);
  const matchingThreshold = useLedgerStore(state => state.matchingThreshold);
  const setBaseCurrency = useLedgerStore(state => state.setBaseCurrency);
  const setLockDate = useLedgerStore(state => state.setLockDate);
  const setLockException = useLedgerStore(state => state.setLockException);
  const setMatchingThreshold = useLedgerStore(state => state.setMatchingThreshold);

  useEffect(() => {
    const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
    if (currentWorkspace) {
      const targetCurrency = currentWorkspace.currency || 'USD';
      // Closed through this date for this user (soft close applies to bookkeepers only)
      const targetLockDate = effectiveLockDate(currentWorkspace, user?.uid || '');
      setLockException(currentWorkspace.lockException || null);
      const targetThreshold = typeof currentWorkspace.matchingThreshold === 'number' ? currentWorkspace.matchingThreshold : 0.85;
      if (baseCurrency !== targetCurrency) {
        setBaseCurrency(targetCurrency);
      }
      if (lockDate !== targetLockDate) {
        setLockDate(targetLockDate);
      }
      if (matchingThreshold !== targetThreshold) {
        setMatchingThreshold(targetThreshold);
      }
    }
  }, [currentWorkspaceId, workspaces, user?.uid, baseCurrency, lockDate, matchingThreshold, setBaseCurrency, setLockDate, setLockException, setMatchingThreshold]);

  // Main Entities (Workspace Scoped)
  useEffect(() => {
    if (!userUid || !currentWorkspaceId) return;

    // Login Audit
    const sessionLoginKey = `login_logged_${currentWorkspaceId}_${userUid}`;
    if (!sessionStorage.getItem(sessionLoginKey)) {
      sessionStorage.setItem(sessionLoginKey, 'true');
      void addDoc(collection(db, 'auditLogs'), {
        action: 'USER_LOGIN',
        details: { description: 'User authenticated and entered workspace session' },
        severity: 'info',
        uid: userUid,
        userEmail: useAuthStore.getState().user?.email,
        workspaceId: currentWorkspaceId,
        timestamp: new Date().toISOString()
      }).catch(err => console.error('Failed to write login audit:', err));
    }

    // Clear data immediately to prevent ghosting between workspaces
    useDataNeedsStore.getState().resetLoaded(currentWorkspaceId);
    useUIStore.getState().loadHiddenTabs(currentWorkspaceId);
    useLedgerStore.setState({
      ...Object.fromEntries(Object.keys(LEDGER_COLLECTIONS).filter(k => k !== 'scenarios').map(k => [k, []])),
      truncatedCollections: {},
      isDataTruncated: false,
      runningBalances: {
        totalIncome: 0,
        totalExpense: 0,
        totalBalance: 0,
        projectMetrics: {},
        categoryMetrics: {}
      }
    });

    // Reference lists read once per workspace
    const filter = [where('workspaceId', '==', currentWorkspaceId)];
    // #100: a read started for one workspace never fills the store after the user switched books
    let cancelled = false;
    const stillHere = () => !cancelled && useAuthStore.getState().currentWorkspaceId === currentWorkspaceId && useAuthStore.getState().user?.uid === userUid;
    const loadReferenceData = async () => {
      try {
        const snapTemplates = await getDocs(query(collection(db, 'customTemplates'), where('uid', '==', userUid), limit(500)));
        if (!stillHere()) return;
        useLedgerStore.getState().setCollectionTruncated('customTemplates', snapTemplates.docs.length >= 500);
        useLedgerStore.getState().setCustomTemplates(snapTemplates.docs.map(d => ({ id: d.id, ...d.data() } as CustomTemplate)));

        const snapPartners = await getDocs(query(collection(db, 'partners'), ...filter, limit(500)));
        if (!stillHere()) return;
        useLedgerStore.getState().setCollectionTruncated('partners', snapPartners.docs.length >= 500);
        useLedgerStore.getState().setPartners(snapPartners.docs.map(d => ({ id: d.id, ...d.data() })));

        const snapRulePatterns = await getDocs(query(collection(db, 'rulePatterns'), ...filter, limit(2000)));
        if (!stillHere()) return;
        useLedgerStore.getState().setCollectionTruncated('rulePatterns', snapRulePatterns.docs.length >= 2000);
        const cache: LedgerState['analyticalPatternCache'] = {};
        snapRulePatterns.docs.forEach(d => {
          const data = d.data();
          cache[(data.description || '').toLowerCase().trim()] = data as AnalyticalPattern;
        });
        useLedgerStore.getState().setAnalyticalPatternCache(cache);

        const snapDimensionNodes = await getDocs(query(collection(db, 'dimensionNodes'), ...filter, limit(10000)));
        if (!stillHere()) return;
        useLedgerStore.getState().setCollectionTruncated('dimensionNodes', snapDimensionNodes.docs.length >= 10000);
        let nodes = snapDimensionNodes.docs.map(d => ({ ...d.data() } as DimensionNode));
        if (snapDimensionNodes.empty) {
          const currentWorkspace = useAuthStore.getState().workspaces.find(w => w.id === currentWorkspaceId);
          // older workspaces kept their dimension tree on the workspace document
          const legacyNodes = (currentWorkspace as { dimensionNodes?: DimensionNode[] } | undefined)?.dimensionNodes;
          if (legacyNodes && legacyNodes.length > 0) {
            nodes = legacyNodes;
            if (db && currentWorkspaceId) {
              void migrateWorkspaceDimensionNodesToCollection(db, currentWorkspaceId).catch(e => {
                console.warn('[Ledger] Background dimension migration error:', e);
              });
            }
          }
        }
        useLedgerStore.getState().setDimensionNodes(nodes);
      } catch (err) {
        console.warn('[Ledger] Error loading reference data:', err);
      }
    };
    void loadReferenceData();
    return () => { cancelled = true; };
  }, [userUid, currentWorkspaceId]);

  // Live collections (src/lib/ledgerCollections.ts): the core ones as soon as a workspace opens,
  // the others the first time a screen asks for them (useLedgerCollections). Each stays live until
  // the workspace changes, so no screen sees a stale copy; changes are fetched incrementally.
  const asked = useDataNeedsStore(s => s.asked);
  const failed = useDataNeedsStore(s => s.failed);
  const trouble = useDataNeedsStore(s => s.trouble);
  const active = useRef(new Map<string, () => void>());
  useEffect(() => {
    const subscriptions = active.current;
    const evictedWorkspaceId = currentWorkspaceId;
    return () => {
      subscriptions.forEach(unsubscribe => unsubscribe());
      subscriptions.clear();
      if (evictedWorkspaceId) {
        LedgerEngine.clearNormalizationCache(evictedWorkspaceId);
      }
    };
  }, [userUid, currentWorkspaceId]);
  useEffect(() => {
    if (!userUid || !currentWorkspaceId) return;
    // a failed collection waits for "Try again" (useDataNeedsStore.retry) before starting over
    const skip = new Set([...active.current.keys(), ...Object.keys(failed)]);
    for (const key of keysToStart(asked, skip)) {
      const subscriptions = active.current;
      let unsub: (() => void) | null = null;
      let failedSynchronously = false;
      unsub = subscribeLedgerCollection(key, currentWorkspaceId, () => {
        if (!unsub) {
          failedSynchronously = true;
          return;
        }
        if (subscriptions.get(key) === unsub) {
          unsub();
          subscriptions.delete(key);
        }
      });
      if (failedSynchronously) {
        unsub();
      } else {
        subscriptions.set(key, unsub);
      }
    }
  }, [userUid, currentWorkspaceId, asked, failed]);

  // A collection that failed on connection trouble is tried again on its own (src/lib/collectionRetry.ts,
  // #96): at the scheduled time, and at once when the browser reports it is online again or the tab
  // becomes visible. A permission refusal is left for the person ("Try again"); nothing is retried
  // for another workspace, because a switch clears these records (resetLoaded).
  useEffect(() => {
    if (!userUid || !currentWorkspaceId) return;
    const retryNow = () => useDataNeedsStore.getState().retryTransientFailures(Date.now());
    const timers: ReturnType<typeof setTimeout>[] = [];
    const now = Date.now();
    for (const plan of Object.values(trouble)) {
      if (!plan || plan.nextRetryAt === null) continue;
      timers.push(setTimeout(retryNow, Math.max(0, plan.nextRetryAt - now)));
    }
    // Back on the network, or back at the screen: a fresh bounded cycle, even if the earlier
    // attempts were used up (the person is looking at the page again and would otherwise be told
    // to press "Try again" for trouble that may be over).
    const onOnline = () => useDataNeedsStore.getState().retryAfterReconnect();
    const onVisible = () => { if (document.visibilityState === 'visible') useDataNeedsStore.getState().retryAfterReconnect(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userUid, currentWorkspaceId, trouble]);

  return null;
}

type StoredRow = { id: string } & Record<string, unknown>;

function toStore(key: LedgerKey, rows: StoredRow[]): void {
  const store = useLedgerStore.getState();
  switch (key) {
    case 'transactions': store.setTransactions(rows as unknown as Transaction[]); return;
    case 'accounts': store.setAccounts(rows as unknown as ChartAccount[]); return;
    case 'recurring':
      store.setRecurring(rows.map(row => {
        const data = row as StoredRow & Partial<RecurringTransaction> & { lastTriggeredAt?: string; template?: { payee?: string } };
        return {
          ...data,
          status: data.status || (data.isActive ? 'active' : 'paused'),
          payee: data.payee || data.template?.payee || '',
          lastOccurrence: data.lastOccurrence || data.lastTriggeredAt || ''
        } as RecurringTransaction;
      }));
      return;
    case 'scenarios': {
      const scenarios = rows as unknown as Scenario[];
      useScenarioStore.getState().setScenarios(scenarios.length > 0 ? scenarios : [{
        id: 'default-scenario',
        name: 'Base Evolution',
        description: 'The natural trajectory of current operations.',
        ghosts: [],
        isActive: true
      }]);
      return;
    }
    default: {
      const setter = (store as unknown as Record<string, unknown>)[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`];
      if (typeof setter === 'function') (setter as (data: unknown[]) => void)(rows);
    }
  }
}

/** One live collection of one workspace into the store; `onFailed` stops it after an error. */
function subscribeLedgerCollection(key: LedgerKey, workspaceId: string, onFailed: () => void): () => void {
  const spec: LedgerCollectionSpec = LEDGER_COLLECTIONS[key];
  const constraints = [where('workspaceId', '==', workspaceId)];
  if (spec.newestFirstBy) constraints.push(orderBy(spec.newestFirstBy, 'desc'));
  constraints.push(limit(spec.cap));
  return onSnapshot(query(collection(db, spec.collection), ...constraints), (snap) => {
    if (useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
    useLedgerStore.getState().setCollectionTruncated(spec.collection, snap.docs.length >= spec.cap);
    toStore(key, snap.docs.map(d => ({ id: d.id, ...d.data() })));
    useDataNeedsStore.getState().markLoaded(key);
  }, (err) => {
    if (useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
    useDataNeedsStore.getState().markFailed(key, err instanceof Error ? err.message : String(err), err);
    onFailed();
    try {
      handleFirestoreError(err, OperationType.LIST, spec.collection);
    } catch {
      // reported in the data status bar with "Try again"
    }
  });
}
