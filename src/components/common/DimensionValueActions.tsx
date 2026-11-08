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
 * handled before bubbling to `useDialog`'s native dialog listener or enclosing `<form>` handlers.
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
        e.preventDefault();
        e.stopPropagation();
        enterRef.current();
      } else if (e.key === 'Escape') {
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

  const trimmed = (value || '').trim();
  const matched = canWrite && trimmed && trimmed !== 'Unassigned'
    ? matchDimensionNode(nodes, dimensionId, trimmed)
    : undefined;
  const activeMatch = matched && matched.status !== 'archived' ? matched : undefined;
  const isEditing = Boolean(activeMatch && editingNodeId === activeMatch.id);

  const cancelRename = () => {
    setEditingNodeId(null);
    setDraftName('');
    setError('');
    queueMicrotask(() => triggerRef.current?.focus());
  };

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
    onRenamed?.(res.value);
    queueMicrotask(() => triggerRef.current?.focus());
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

  const createLabel = async () => {
    const scope = identityScope(
      () => useAuthStore.getState().user?.uid,
      () => useAuthStore.getState().currentWorkspaceId,
    );
    setBusy(true);
    setError('');
    const res = await runOnce(`dim-create:${scope.workspaceId}:${dimensionId}:${trimmed}`, () =>
      attempt(() => registerDimensionNodeInline(dimensionId, trimmed, [], adapter)),
    );
    if (!scope.isCurrent()) return false;
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onSelectNode(res.value);
    return true;
  };

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

function InlineAddDimensionAxisInner({ disabled = false, onAdded, adapter }: InlineAddDimensionAxisInnerProps) {
  const inputId = useId();
  const role = useCurrentRole();
  const canManageAxes = !disabled && hasRoleAtLeast(role, 'accountant');

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setName('');
    setError('');
    queueMicrotask(() => triggerRef.current?.focus());
  };

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
    onAdded?.(res.value);
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
        New dimension
      </button>
    );
  }

  return (
    <div className="space-y-1 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          New dimension name
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

export function InlineAddDimensionAxis(props: InlineAddDimensionAxisInnerProps) {
  const uid = useAuthStore(s => s.user?.uid);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  return <InlineAddDimensionAxisInner key={`${uid}:${workspaceId}`} {...props} />;
}
