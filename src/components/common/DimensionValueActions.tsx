import React, { useEffect, useId, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { hasRoleAtLeast, useCurrentRole } from '../../hooks/useCurrentRole';
import { attempt, identityScope, runOnce } from '../../lib/serverAction';
import {
  addDimensionAxisInline,
  matchDimensionNode,
  registerDimensionNodeInline,
  renameDimensionNodeInline,
  type DimensionNodeActionAdapter,
} from '../../lib/dimensionNodeActions';
import type { DimensionDefinition, DimensionNode } from '../../types';

/**
 * Attaches a native DOM keydown listener directly on an inline input so Enter and Escape are
 * handled before bubbling to `useDialog`'s native dialog listener or enclosing `<form>` handlers,
 * while ignoring IME composition confirmation keystrokes (`isComposing` / `keyCode === 229`).
 */
function useIsolatedInlineInputKeys(
  active: boolean,
  onEnter: () => void,
  onEscape: () => void,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const enterRef = useRef(onEnter);
  const escapeRef = useRef(onEscape);

  useEffect(() => {
    enterRef.current = onEnter;
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    const el = inputRef.current;
    if (!active || !el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        enterRef.current();
      } else if (e.key === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        escapeRef.current();
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [active]);

  return inputRef;
}

interface DimensionValueActionsInnerProps {
  dimensionId: string;
  dimensionName: string;
  value: string;
  lineNumber?: number;
  disabled?: boolean;
  onSelectNode: (node: DimensionNode) => void;
  onRenamed?: (node: DimensionNode) => void;
  adapter?: DimensionNodeActionAdapter;
}

/**
 * Renders inline actions below a dimension value input: saves newly typed values as `DimensionNode`s
 * or renames an already-matched node globally while preserving form draft edits made during async saves.
 */
function DimensionValueActionsInner({
  dimensionId,
  dimensionName,
  value,
  lineNumber,
  disabled = false,
  onSelectNode,
  onRenamed,
  adapter,
}: DimensionValueActionsInnerProps) {
  const inputId = useId();
  const role = useCurrentRole();
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const canWrite = !disabled && hasRoleAtLeast(role, 'bookkeeper');

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const latestValueRef = useRef(value);
  const onSelectNodeRef = useRef(onSelectNode);
  const onRenamedRef = useRef(onRenamed);

  useEffect(() => {
    latestValueRef.current = value;
    onSelectNodeRef.current = onSelectNode;
    onRenamedRef.current = onRenamed;
  });

  const trimmed = (value || '').trim();
  const normVal = (v: string) => v.normalize('NFC').toLowerCase().trim();
  const matched = canWrite && trimmed && trimmed !== 'Unassigned'
    ? matchDimensionNode(nodes, dimensionId, trimmed)
    : undefined;
  const activeMatch = matched && matched.status !== 'archived' ? matched : undefined;
  const isEditing = Boolean(activeMatch && editingNodeId === activeMatch.id);

  /** Closes the inline rename input and restores focus to the Rename trigger button. */
  const cancelRename = () => {
    setEditingNodeId(null);
    setDraftName('');
    setError('');
    queueMicrotask(() => triggerRef.current?.focus());
  };

  /** Persists a global rename for the matched DimensionNode and notifies the latest form callback if still selected. */
  const commitRename = async (node: DimensionNode) => {
    const next = draftName.trim();
    if (!next) {
      setError('Label name is required.');
      return false;
    }
    if (next === node.description) {
      cancelRename();
      return true;
    }
    const initiatingTrimmed = trimmed;
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    setBusy(true);
    setError('');
    const res = await runOnce(`dim-rename:${scope.workspaceId}:${dimensionId}:${node.id}`, () =>
      attempt(() => renameDimensionNodeInline(dimensionId, node.id, node.description, next, adapter)),
    );
    if (!scope.isCurrent()) return false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setEditingNodeId(null);
    setDraftName('');
    const currentTrimmed = (latestValueRef.current || '').trim();
    const latestNodes = (adapter ? adapter.getNodes() : useLedgerStore.getState().dimensionNodes) || [];
    const currentMatch = matchDimensionNode(latestNodes, dimensionId, currentTrimmed);
    if (currentMatch?.id === node.id || normVal(currentTrimmed) === normVal(initiatingTrimmed)) {
      onRenamedRef.current?.(res.value);
      queueMicrotask(() => triggerRef.current?.focus());
    }
    return true;
  };

  const renameInputRef = useIsolatedInlineInputKeys(
    isEditing,
    () => {
      if (activeMatch) void commitRename(activeMatch);
    },
    cancelRename,
  );

  if (!canWrite || !trimmed || trimmed === 'Unassigned') return null;

  const lineSuffix = lineNumber !== undefined ? ` on line ${lineNumber}` : '';

  /** Saves the currently typed free-text value as a Workspace DimensionNode and selects its ID if the field was not changed. */
  const createLabel = async () => {
    const submittedTrimmed = trimmed;
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    setBusy(true);
    setError('');
    const res = await runOnce(`dim-create:${scope.workspaceId}:${dimensionId}:${submittedTrimmed}`, () =>
      attempt(() => registerDimensionNodeInline(dimensionId, submittedTrimmed, [], adapter)),
    );
    if (!scope.isCurrent()) return false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    const currentTrimmed = (latestValueRef.current || '').trim();
    if (normVal(currentTrimmed) === normVal(submittedTrimmed) || normVal(currentTrimmed) === normVal(res.value.id)) {
      onSelectNodeRef.current(res.value);
    }
    return true;
  };

  /** Opens the inline rename editor seeded with the matched node's current description. */
  const startRename = (node: DimensionNode) => {
    setEditingNodeId(node.id);
    setDraftName(node.description);
    setError('');
  };

  if (activeMatch && isEditing) {
    return (
      <div className="mt-1 space-y-1 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <label htmlFor={inputId} className="sr-only">
            New name for {dimensionName} label {activeMatch.description}{lineSuffix}
          </label>
          <input
            ref={renameInputRef}
            id={inputId}
            type="text"
            dir="auto"
            disabled={busy}
            value={draftName}
            onChange={e => {
              setDraftName(e.target.value);
              if (error) setError('');
            }}
            className="flex-1 min-w-[8rem] min-h-11 px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-xs text-[var(--text)]"
          />
          <button
            type="button"
            disabled={busy || !draftName.trim()}
            onClick={() => {
              void commitRename(activeMatch);
            }}
            className="min-h-11 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50"
          >
            Save<span className="sr-only"> {dimensionName} label{lineSuffix}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={cancelRename}
            className="min-h-11 px-2 py-1 text-[var(--muted)] hover:text-[var(--text)] hover:underline"
          >
            Cancel<span className="sr-only"> renaming {dimensionName} label{lineSuffix}</span>
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (activeMatch) {
    return (
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-[11px]">
        <span className="text-[var(--muted)] truncate" dir="auto">
          <bdi>{activeMatch.description}</bdi>{' '}
          <span className="font-mono text-[10px]">({activeMatch.id})</span>
        </span>
        <button
          ref={triggerRef}
          type="button"
          disabled={busy}
          onClick={() => startRename(activeMatch)}
          className="min-h-11 px-2 inline-flex items-center gap-1 font-semibold text-[var(--muted)] hover:text-[var(--text)] hover:underline disabled:opacity-50"
        >
          <Pencil aria-hidden="true" size={11} />
          Rename<span className="sr-only"> {dimensionName} label {activeMatch.description}{lineSuffix}</span>
        </button>
        {error && (
          <p role="alert" className="w-full text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-0.5 space-y-0.5 text-[11px]">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void createLabel();
        }}
        className="min-h-11 px-2 inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline text-start disabled:opacity-50"
      >
        <Plus aria-hidden="true" size={12} className="shrink-0" />
        <span dir="auto">
          Save “{trimmed}” as {dimensionName} label
          <span className="sr-only">{lineSuffix}</span>
        </span>
      </button>
      {error && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Workspace-scoped wrapper for inline dimension label creation and global renaming.
 */
export function DimensionValueActions(props: DimensionValueActionsInnerProps) {
  const uid = useAuthStore(s => s.user?.uid);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  return <DimensionValueActionsInner key={`${uid}:${workspaceId}:${props.dimensionId}`} {...props} />;
}

interface InlineAddDimensionAxisInnerProps {
  disabled?: boolean;
  onAdded?: (axis: DimensionDefinition) => void;
  adapter?: DimensionNodeActionAdapter;
}

/**
 * Renders an inline "+ New dimension" control for workspace owners and accountants (`accountant+`).
 */
function InlineAddDimensionAxisInner({ disabled = false, onAdded, adapter }: InlineAddDimensionAxisInnerProps) {
  const inputId = useId();
  const role = useCurrentRole();
  const canManageAxes = !disabled && hasRoleAtLeast(role, 'accountant');

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const onAddedRef = useRef(onAdded);

  useEffect(() => {
    onAddedRef.current = onAdded;
  });

  /** Closes the new-dimension input and returns focus to the trigger button. */
  const close = () => {
    setOpen(false);
    setName('');
    setError('');
    queueMicrotask(() => triggerRef.current?.focus());
  };

  /** Persists a new dimension category on the active workspace and notifies the caller. */
  const submitAxis = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a dimension name.');
      return false;
    }
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    setBusy(true);
    setError('');
    const res = await runOnce(`dim-axis:${scope.workspaceId}:${trimmed.toLowerCase()}`, () =>
      attempt(() => addDimensionAxisInline(trimmed, undefined, adapter)),
    );
    if (!scope.isCurrent()) return false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setOpen(false);
    setName('');
    onAddedRef.current?.(res.value);
    queueMicrotask(() => triggerRef.current?.focus());
    return true;
  };

  const axisInputRef = useIsolatedInlineInputKeys(
    open && canManageAxes,
    () => {
      void submitAxis();
    },
    close,
  );

  if (!canManageAxes) return null;

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 px-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--text)] hover:underline"
      >
        <Plus aria-hidden="true" size={12} />
        New label
      </button>
    );
  }

  return (
    <div className="space-y-1 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          New label name
        </label>
        <input
          ref={axisInputRef}
          id={inputId}
          type="text"
          dir="auto"
          disabled={busy}
          value={name}
          placeholder="e.g. Property or Store"
          onChange={e => {
            setName(e.target.value);
            if (error) setError('');
          }}
          className="min-w-[10rem] min-h-11 px-2.5 py-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-xs text-[var(--text)]"
        />
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => {
            void submitAxis();
          }}
          className="min-h-11 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-semibold disabled:opacity-50"
        >
          Add dimension
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={close}
          className="min-h-11 px-2 py-1 text-[var(--muted)] hover:text-[var(--text)] hover:underline"
        >
          Cancel<span className="sr-only"> adding dimension</span>
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Workspace-scoped wrapper for adding a new workspace dimension axis inline.
 */
export function InlineAddDimensionAxis(props: InlineAddDimensionAxisInnerProps) {
  const uid = useAuthStore(s => s.user?.uid);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  return <InlineAddDimensionAxisInner key={`${uid}:${workspaceId}`} {...props} />;
}
