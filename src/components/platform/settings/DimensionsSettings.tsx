import { mergeDimensionDrafts } from '../../../lib/dimensionDrafts';
import { normalizeSearchText } from '../../../lib/textNormalization';
import {
  addDimensionAxisInline,
  matchDimensionNode,
  registerDimensionNodeInline,
  setDimensionNodeAliasesInline,
  setDimensionNodeStatusInline,
} from '../../../lib/dimensionNodeActions';
import { attempt, identityScope } from '../../../lib/serverAction';
import { RecordInlineField } from '../../ui/RecordInlineField';
import { WorkspaceDimensionName } from './WorkspaceDimensionName';
import { RequiredLabelRules } from './RequiredLabelRules';
import { LabelRoles } from './LabelRoles';
import { hasRoleAtLeast, useCurrentRole } from '../../../hooks/useCurrentRole';
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Archive, Check, Database, Layers, RefreshCw, ShieldCheck, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { doc, updateDoc, writeBatch } from '../../../lib/db/firestore';
import { db } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { 
  DimensionDefinition, 
  DimensionNode 
} from '../../../types';
import { 
  DEFAULT_WORKSPACE_DIMENSIONS, 
  suggestNextDimensionNodeId, 
  migrateWorkspaceDimensionNodes,
  backfillDimensionNodesFromTransactions
} from '../../../lib/dimensionUtils';
import AsyncButton from '../../ui/AsyncButton';
import { Labelled } from '../../ui/Labelled';

function EditableNodeAliases({
  initialValue,
  onCommit
}: {
  initialValue: string;
  onCommit: (newVal: string) => void;
}) {
  const [val, setVal] = useState(initialValue);
  const [prevInitial, setPrevInitial] = useState(initialValue);

  if (initialValue !== prevInitial) {
    setPrevInitial(initialValue);
    setVal(initialValue);
  }

  return (
    <input aria-label="Dimension node aliases"
      type="text"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={() => {
        if (val !== initialValue) {
          onCommit(val);
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="e.g. Alias 1, Alias 2"
      className="w-full bg-[var(--surface)] border border-[var(--line)] focus:border-indigo-500 rounded-lg px-2.5 py-1 text-xs text-[var(--muted)] outline-none"
    />
  );
}

/** Settings view for managing workspace dimension axes, label nodes, aliases, and required-account rules. */
function DimensionsSettingsContent() {
  const role = useCurrentRole();
  const canWrite = hasRoleAtLeast(role, 'bookkeeper');
  const canAdmin = hasRoleAtLeast(role, 'accountant');
  const currentWorkspace = useAuthStore(s => s.getCurrentWorkspace());
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const transactions = useLedgerStore(s => s.transactions);
  const setTransactions = useLedgerStore(s => s.setTransactions);
  const storeDimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const storeSetDimensionNodes = useLedgerStore(s => s.setDimensionNodes);

  const [dimensions, setDimensions] = useState<DimensionDefinition[]>(() => {
    return currentWorkspace?.dimensions || DEFAULT_WORKSPACE_DIMENSIONS;
  });

  const [dimensionNodes, setDimensionNodes] = useState<DimensionNode[]>(storeDimensionNodes);

  const previousSource = useRef(storeDimensionNodes);
  useEffect(() => {
    const previous = previousSource.current;
    previousSource.current = storeDimensionNodes;
    setDimensionNodes(draft => mergeDimensionDrafts(storeDimensionNodes, draft, previous));
  }, [storeDimensionNodes]);

  const [isSaving, setIsSaving] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  // Form state for adding new axis
  const [newAxisId, setNewAxisId] = useState('');
  const [newAxisName, setNewAxisName] = useState('');
  const [showAddAxis, setShowAddAxis] = useState(false);

  // Form state for adding node per axis
  const [newNodeInputs, setNewNodeInputs] = useState<Record<string, { description: string; aliases: string }>>({});

  const handleNodeInputChange = (dimId: string, field: 'description' | 'aliases', value: string) => {
    setNewNodeInputs(prev => ({
      ...prev,
      [dimId]: {
        ...(prev[dimId] || { description: '', aliases: '' }),
        [field]: value
      }
    }));
  };

  /** Returns true when an Enter keystroke is part of an active IME composition session. */
  const isImeEnter = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

  /** Registers a new label node immediately, or merges newly entered aliases when the label already exists. */
  const handleAddNode = async (dimId: string): Promise<boolean> => {
    if (!canWrite) return false;
    const input = newNodeInputs[dimId];
    const trimmedDesc = input?.description.trim() || '';
    if (!trimmedDesc) {
      toast.error('Please enter a description for the new label node');
      return false;
    }

    const aliasesArray = input.aliases
      ? input.aliases.split(',').map(a => a.trim()).filter(Boolean)
      : [];
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    const priorMatch = matchDimensionNode(useLedgerStore.getState().dimensionNodes || [], dimId, trimmedDesc);

    if (priorMatch && priorMatch.status !== 'archived') {
      const existingAliases = priorMatch.aliases || [];
      const aliasKey = (value: string) => normalizeSearchText(value).trim();
      const existingKeys = new Set([priorMatch.description, ...existingAliases].map(aliasKey));
      const freshAliases: string[] = [];
      for (const candidate of aliasesArray) {
        const key = aliasKey(candidate);
        if (key && !existingKeys.has(key)) {
          existingKeys.add(key);
          freshAliases.push(candidate);
        }
      }
      if (freshAliases.length > 0) {
        const mergedAliases = [...existingAliases, ...freshAliases];
        const aliasRes = await attempt(() => setDimensionNodeAliasesInline(dimId, priorMatch.id, mergedAliases));
        if (!scope.isCurrent()) return false;
        if (!aliasRes.ok) {
          toast.error(aliasRes.error);
          return false;
        }
        setDimensionNodes(useLedgerStore.getState().dimensionNodes);
        setNewNodeInputs(prev => ({ ...prev, [dimId]: { description: '', aliases: '' } }));
        toast.success(`Added aliases to existing label ${priorMatch.id} ("${priorMatch.description}")`);
        return true;
      }
      toast.info(`Label "${priorMatch.description}" (${priorMatch.id}) already exists.`);
      return true;
    }

    const res = await attempt(() =>
      registerDimensionNodeInline(dimId, trimmedDesc, aliasesArray),
    );
    if (!scope.isCurrent()) return false;
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }

    setDimensionNodes(useLedgerStore.getState().dimensionNodes);
    setNewNodeInputs(prev => ({ ...prev, [dimId]: { description: '', aliases: '' } }));
    toast.success(
      priorMatch?.status === 'archived'
        ? `Restored archived label ${res.value.id} ("${res.value.description}")`
        : `Saved label node ${res.value.id} ("${res.value.description}")`,
    );
    return true;
  };

  /** Persists updated comma-separated aliases for an existing DimensionNode immediately. */
  const handleUpdateNodeAliases = async (nodeId: string, dimId: string, aliasesStr: string): Promise<boolean> => {
    if (!canWrite) return false;
    const aliasesArray = aliasesStr.split(',').map(a => a.trim()).filter(Boolean);
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    const res = await attempt(() => setDimensionNodeAliasesInline(dimId, nodeId, aliasesArray));
    if (!scope.isCurrent()) return false;
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setDimensionNodes(prev => prev.map(n => {
      if (n.id === nodeId && n.dimensionId === dimId) {
        return { ...n, aliases: aliasesArray };
      }
      return n;
    }));
    return true;
  };

  /** Toggles a DimensionNode between active and archived immediately in the database and store. */
  const handleToggleArchiveNode = async (nodeId: string, dimId: string): Promise<boolean> => {
    if (!canWrite) return false;
    const target = dimensionNodes.find(n => n.id === nodeId && n.dimensionId === dimId);
    const nextStatus = target?.status === 'archived' ? 'active' : 'archived';
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    const res = await attempt(() => setDimensionNodeStatusInline(dimId, nodeId, nextStatus));
    if (!scope.isCurrent()) return false;
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setDimensionNodes(prev => prev.map(n => {
      if (n.id === nodeId && n.dimensionId === dimId) {
        return { ...n, status: nextStatus };
      }
      return n;
    }));
    toast.success(nextStatus === 'archived' ? `Archived label ${nodeId}` : `Restored label ${nodeId}`);
    return true;
  };

  const handleUpdateAxisName = (axisId: string, newName: string) => {
    setDimensions(prev => prev.map(d => {
      if (d.id === axisId) {
        return { ...d, name: newName };
      }
      return d;
    }));
  };

  /** Creates and persists a new workspace dimension axis immediately for owners and accountants. */
  const handleAddAxis = async (): Promise<boolean> => {
    if (!canAdmin) return false;
    if (!newAxisName.trim()) {
      toast.error('Display name is required');
      return false;
    }
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    const res = await attempt(() =>
      addDimensionAxisInline(newAxisName.trim(), newAxisId.trim() || undefined),
    );
    if (!scope.isCurrent()) return false;
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }

    const updatedDims = useAuthStore.getState().getCurrentWorkspace()?.dimensions;
    setDimensions(updatedDims || [...dimensions, res.value]);
    setNewAxisId('');
    setNewAxisName('');
    setShowAddAxis(false);
    toast.success(`Saved dimension axis "${res.value.name}" (${res.value.id})`);
    return true;
  };

  const handleSaveChanges = async () => {
    if (!currentWorkspaceId) return;
    setIsSaving(true);
    try {
      if (db) {
        const wsRef = doc(db, 'workspaces', currentWorkspaceId);
        await updateDoc(wsRef, {
          dimensions
        });

        // Write individual nodes in batch
        const batch = writeBatch(db);
        dimensionNodes.forEach(node => {
          const docId = `${currentWorkspaceId}_${node.dimensionId}_${node.id}`;
          const nodeRef = doc(db, 'dimensionNodes', docId);
          batch.set(nodeRef, {
            ...node,
            workspaceId: currentWorkspaceId
          });
        });
        await batch.commit();
      }

      // Update store slice
      storeSetDimensionNodes(dimensionNodes);

      // Update local workspace store
      const allWorkspaces = useAuthStore.getState().workspaces;
      const updated = allWorkspaces.map(w => {
        if (w.id === currentWorkspaceId) {
          return { ...w, dimensions };
        }
        return w;
      });
      setWorkspaces(updated);

      toast.success('Dimension axes & label nodes saved successfully');
    } catch (err) {
      console.error('Failed to save dimension settings:', err);
      toast.error(`Save failed: ${(err as Error).message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunMigration = async () => {
    if (!currentWorkspaceId) return;
    setIsMigrating(true);
    try {
      const { updatedTransactions, updatedNodes, migrationCount } = migrateWorkspaceDimensionNodes(
        transactions,
        dimensionNodes,
        dimensions
      );

      if (migrationCount === 0 && updatedNodes.length === dimensionNodes.length) {
        toast.info('All transaction dimension values are already stored as stable node IDs.');
        setIsMigrating(false);
        return;
      }

      setDimensionNodes(updatedNodes);
      setTransactions(updatedTransactions);

      // Persist nodes
      if (db) {
        const batch = writeBatch(db);
        updatedNodes.forEach(node => {
          const docId = `${currentWorkspaceId}_${node.dimensionId}_${node.id}`;
          const nodeRef = doc(db, 'dimensionNodes', docId);
          batch.set(nodeRef, {
            ...node,
            workspaceId: currentWorkspaceId
          });
        });
        await batch.commit();

        // Batch update modified transactions in chunks of 450
        const chunkSize = 450;
        for (let i = 0; i < updatedTransactions.length; i += chunkSize) {
          const chunk = updatedTransactions.slice(i, i + chunkSize);
          const tBatch = writeBatch(db);
          let batchHasWrites = false;
          chunk.forEach(tx => {
            if (tx.id) {
              const txRef = doc(db, 'transactions', tx.id);
              tBatch.update(txRef, { lines: tx.lines });
              batchHasWrites = true;
            }
          });
          if (batchHasWrites) {
            await tBatch.commit();
          }
        }
      }

      // Update store slice
      storeSetDimensionNodes(updatedNodes);

      // Update local workspace store
      const allWorkspaces = useAuthStore.getState().workspaces;
      const updated = allWorkspaces.map(w => {
        if (w.id === currentWorkspaceId) {
          return { ...w, dimensions };
        }
        return w;
      });
      setWorkspaces(updated);

      toast.success(`Migration complete! Converted ${migrationCount} free-text labels to stable node IDs.`);
    } catch (err) {
      console.error('Migration failed:', err);
      toast.error(`Migration failed: ${(err as Error).message || err}`);
    } finally {
      setIsMigrating(false);
    }
  };

  const handleRunBackfillOnly = async () => {
    if (!currentWorkspaceId) return;
    setIsMigrating(true);
    try {
      const { allNodes, createdCount } = backfillDimensionNodesFromTransactions(
        transactions,
        dimensionNodes,
        dimensions
      );

      if (createdCount === 0) {
        toast.info('All historical free-text paths are already backed by registered nodes.');
        setIsMigrating(false);
        return;
      }

      setDimensionNodes(allNodes);

      if (db) {
        const batch = writeBatch(db);
        allNodes.forEach(node => {
          const docId = `${currentWorkspaceId}_${node.dimensionId}_${node.id}`;
          const nodeRef = doc(db, 'dimensionNodes', docId);
          batch.set(nodeRef, {
            ...node,
            workspaceId: currentWorkspaceId
          });
        });
        await batch.commit();
      }

      // Update store slice
      storeSetDimensionNodes(allNodes);

      const allWorkspaces = useAuthStore.getState().workspaces;
      const updated = allWorkspaces.map(w => {
        if (w.id === currentWorkspaceId) {
          return { ...w, dimensions };
        }
        return w;
      });
      setWorkspaces(updated);

      toast.success(`One-time backfill complete: minted ${createdCount} new nodes from transaction paths.`);
    } catch (err) {
      console.error('Backfill failed:', err);
      toast.error(`Backfill failed: ${(err as Error).message || err}`);
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-10">
      {/* Overview Banner */}
      <div className="p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] rounded-[32px] space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-500 rounded-2xl">
            <Layers aria-hidden="true" size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--text)] tracking-tight">Dimensions & Label Node Registry</h2>
            <p className="text-xs text-[var(--muted)] font-medium">
              Stable identity map for dimensional accounting. Renaming a label node description updates all historical reporting without splitting buckets.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-4 bg-[var(--surface)] border border-[var(--line)] rounded-2xl text-xs space-y-1">
            <div className="flex items-center gap-2 text-[var(--muted)] font-bold uppercase tracking-wider text-[9px]">
              <Lock aria-hidden="true" size={12} className="text-indigo-500" /> Immutable Axis ID
            </div>
            <p className="text-slate-600 font-medium leading-relaxed">
              Axis keys (e.g., <code className="text-indigo-600 font-bold">category</code>, <code className="text-indigo-600 font-bold">project</code>) cannot be renamed to prevent orphaned querying history.
            </p>
          </div>

          <div className="p-4 bg-[var(--surface)] border border-[var(--line)] rounded-2xl text-xs space-y-1">
            <div className="flex items-center gap-2 text-[var(--muted)] font-bold uppercase tracking-wider text-[9px]">
              <ShieldCheck aria-hidden="true" size={12} className="text-emerald-500" /> Stable Node Identity
            </div>
            <p className="text-slate-600 font-medium leading-relaxed">
              Transactions store short stable codes (e.g. <code className="text-emerald-600 font-bold">P1</code>). Changing the description instantly updates all past transactions.
            </p>
          </div>

          <div className="p-4 bg-[var(--surface)] border border-[var(--line)] rounded-2xl text-xs space-y-1">
            <div className="flex items-center gap-2 text-[var(--muted)] font-bold uppercase tracking-wider text-[9px]">
              <Archive aria-hidden="true" size={12} className="text-amber-500" /> Append-Only Archiving
            </div>
            <p className="text-slate-600 font-medium leading-relaxed">
              Nodes are archived rather than deleted, keeping existing transaction lines valid while hiding old categories from new entries.
            </p>
          </div>
        </div>
      </div>

      {/* Migration Card */}
      {canWrite && (
      <div className="p-6 bg-gradient-to-r from-indigo-950/20 via-purple-950/10 to-transparent border border-indigo-500/20 rounded-[28px] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-1 max-w-xl">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-bold uppercase tracking-widest">
            <Database aria-hidden="true" size={12} /> Auto-Migration Engine
          </div>
          <h3 className="text-base font-bold text-[var(--text)]">Migrate Free-Text Labels to Stable Nodes</h3>
          <p className="text-xs text-[var(--muted)] font-medium">
            Scans all existing transaction lines, automatically mints node records for free-text dimension labels, and rewrites lines to store stable node IDs.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          <AsyncButton
            type="button"
            loading={isMigrating}
            onClick={handleRunBackfillOnly}
            className="px-4 py-3 bg-[var(--surface)] border border-indigo-500/40 hover:bg-indigo-500/10 text-indigo-300 font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Database aria-hidden="true" size={14} />
            One-Time Node Backfill
          </AsyncButton>

          <AsyncButton
            type="button"
            loading={isMigrating}
            onClick={handleRunMigration}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <RefreshCw aria-hidden="true" size={14} className={isMigrating ? "animate-spin" : ""} />
            Run Full Migration Sweep
          </AsyncButton>
        </div>
      </div>
      )}

      {/* Dimension Axes & Nodes */}
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text)]">Configured Dimensions ({dimensions.length})</h2>
          {canAdmin && (
            <button
              type="button"
              onClick={() => setShowAddAxis(!showAddAxis)}
              className="px-4 py-2 bg-[var(--surface)] border border-[var(--line)] hover:border-indigo-500/50 text-[var(--text)] text-xs font-bold rounded-xl transition-all flex items-center gap-2"
            >
              <Plus aria-hidden="true" size={14} /> Add Dimension Axis
            </button>
          )}
        </div>

        {canAdmin && showAddAxis && (
          <div className="p-6 bg-[var(--surface)] border border-indigo-500/30 rounded-2xl space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400">Add New Dimension Axis</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Labelled labelClassName="text-[10px] font-bold text-[var(--muted)] uppercase" label="Axis Key / ID (Optional — auto-generated if blank)">
                  <input
                    type="text"
                    value={newAxisId}
                    onChange={e => setNewAxisId(e.target.value)}
                    placeholder="e.g. cost_center or property"
                    className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-500 font-mono"
                  />
                </Labelled>
              </div>
              <div className="space-y-1">
                <Labelled labelClassName="text-[10px] font-bold text-[var(--muted)] uppercase" label="Display Name">
                  <input
                    type="text"
                    value={newAxisName}
                    onChange={e => setNewAxisName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !isImeEnter(e)) {
                        e.preventDefault();
                        void handleAddAxis();
                      }
                    }}
                    placeholder="e.g. Cost Center or Property"
                    className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-500"
                  />
                </Labelled>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddAxis(false)}
                className="px-4 py-2 text-xs font-bold text-[var(--muted)] hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleAddAxis(); }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl"
              >
                Create Axis
              </button>
            </div>
          </div>
        )}

        {dimensions.map(dim => {
          const axisNodes = dimensionNodes.filter(n => n.dimensionId === dim.id);
          const nextSuggestedId = suggestNextDimensionNodeId(dim.id, dimensionNodes);
          const nodeInput = newNodeInputs[dim.id] || { description: '', aliases: '' };

          return (
            <div key={dim.id} className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-3xl space-y-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <WorkspaceDimensionName axis={dim} onSaved={value => handleUpdateAxisName(dim.id, value)} />
                    <span className="px-2 py-0.5 bg-slate-800 text-indigo-300 font-mono text-[10px] rounded-lg font-bold">
                      {dim.id}
                    </span>
                    {dim.systemDefault && (
                      <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[9px] font-bold uppercase rounded-full">
                        System Default
                      </span>
                    )}
                    {dim.isWorld && (
                      <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 text-[9px] font-bold uppercase rounded-full">
                        World Entity
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Axis Key ID: <span className="font-mono text-[var(--muted)]">{dim.id}</span> (Immutable) — {axisNodes.length} registered label node{axisNodes.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {/* Node List Table */}
              {axisNodes.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Dimensions</caption>
                    <thead>
                      <tr className="border-b border-[var(--line)] text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                        <th scope="col" className="py-2 px-3 w-24">Node ID</th>
                        <th scope="col" className="py-2 px-3">Display Description</th>
                        <th scope="col" className="py-2 px-3">Aliases (CSV)</th>
                        <th scope="col" className="py-2 px-3 w-28">Status</th>
                        <th scope="col" className="py-2 px-3 w-28 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {axisNodes.map(node => (
                        <tr key={node.id} className={node.status === 'archived' ? 'opacity-50 bg-slate-900/30' : ''}>
                          <td className="py-2.5 px-3 font-mono font-bold text-indigo-400 text-xs">
                            {node.id}
                          </td>
                          <td className="py-2.5 px-3">
                            <RecordInlineField collection="dimensionNodes" record={node} documentId={`${currentWorkspaceId}_${dim.id}_${node.id}`} field="description" label={`Label ${dim.id} ${node.id}`} canEdit={canWrite} />
                          </td>
                          <td className="py-2.5 px-3">
                            {canWrite ? <EditableNodeAliases initialValue={(node.aliases || []).join(', ')} onCommit={newVal => { void handleUpdateNodeAliases(node.id, dim.id, newVal); }} /> : <span>{(node.aliases || []).join(', ')}</span>}
                          </td>
                          <td className="py-2.5 px-3">
                            {node.status === 'archived' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-bold rounded-full">
                                <Archive aria-hidden="true" size={10} /> Archived
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold rounded-full">
                                <Check aria-hidden="true" size={10} /> Active
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {canWrite ? (
                              <button
                                type="button"
                                onClick={() => { void handleToggleArchiveNode(node.id, dim.id); }}
                                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                                  node.status === 'archived'
                                    ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                    : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                                }`}
                              >
                                {node.status === 'archived' ? 'Unarchive' : 'Archive'}
                                <span className="sr-only"> {dim.name} {node.description}</span>
                              </button>
                            ) : (
                              <span className="text-[var(--muted)]">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-6 text-center border border-dashed border-[var(--line)] rounded-2xl text-xs text-[var(--muted)]">
                  No registered label nodes for <span className="font-bold text-[var(--muted)]">{dim.name}</span> yet.{canWrite ? ' Add one below.' : ''}
                </div>
              )}

              {/* Add New Node Row */}
              {canWrite && (
              <div className="p-4 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center justify-between">
                  <span>Register New Label Node</span>
                  <span className="font-mono text-[var(--muted)]">Next ID: <strong className="text-indigo-400">{nextSuggestedId}</strong></span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  <div className="sm:col-span-2 font-mono text-xs font-bold text-indigo-400 px-3 py-2 bg-slate-900 border border-[var(--line)] rounded-xl text-center">
                    {nextSuggestedId}
                  </div>
                  <div className="sm:col-span-5">
                    <input aria-label={`Display Description for new ${dim.name} value`}
                      type="text"
                      dir="auto"
                      value={nodeInput.description}
                      onChange={e => handleNodeInputChange(dim.id, 'description', e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !isImeEnter(e)) {
                          e.preventDefault();
                          void handleAddNode(dim.id);
                        }
                      }}
                      placeholder="Display Description (e.g. Food & Beverage)"
                      className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <input aria-label={`Aliases for new ${dim.name} value`}
                      type="text"
                      dir="auto"
                      value={nodeInput.aliases}
                      onChange={e => handleNodeInputChange(dim.id, 'aliases', e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !isImeEnter(e)) {
                          e.preventDefault();
                          void handleAddNode(dim.id);
                        }
                      }}
                      placeholder="Aliases (comma-separated)"
                      className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-xl px-3 py-2 text-xs text-[var(--text)] outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => { void handleAddNode(dim.id); }}
                      className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                    >
                      <Plus aria-hidden="true" size={14} /> Add Node<span className="sr-only"> to {dim.name}</span>
                    </button>
                  </div>
                </div>
              </div>
              )}
            </div>
          );
        })}
      </div>

      <RequiredLabelRules dimensions={dimensions}
        onSaved={saved => setDimensions(prev => prev.map(d => ({ ...d, requiredOn: saved.find(x => x.id === d.id)?.requiredOn })))} />
      <LabelRoles dimensions={dimensions} onSaved={saved => setDimensions(prev => prev.map(d => ({ ...d, role: saved.find(x => x.id === d.id)?.role })))} />

      {/* Save Button Bar */}
      {canWrite && (
      <div className="flex justify-end pt-6 border-t border-[var(--line)]">
        <AsyncButton
          type="button"
          loading={isSaving}
          onClick={handleSaveChanges}
          className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition-all flex items-center gap-2"
        >
          <Check aria-hidden="true" size={16} /> Save Dimension Registry
        </AsyncButton>
      </div>
      )}
    </div>
  );
}

export default function DimensionsSettings() {
  const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
  return <DimensionsSettingsContent key={`${uid}:${workspace}`} />;
}
