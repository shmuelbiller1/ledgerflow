import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { DEFAULT_WORKSPACE_DIMENSIONS } from '../lib/dimensionUtils';
import { availableDocumentDefaults, fillLineDefaults, type DocumentDefaults } from '../lib/documentDefaults';
import type { ChartAccount } from '../types';

/** Session-only edits, never persisted. Identity/document changes discard the edit markers. */
export function useDocumentDefaults(documentId: string | undefined, isOpen: boolean, accounts: ChartAccount[]) {
  const uid = useAuthStore(s => s.user?.uid);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const axes = useAuthStore(s => s.getCurrentWorkspace()?.dimensions) || DEFAULT_WORKSPACE_DIMENSIONS;
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const key = `${uid}:${workspaceId}:${documentId || 'new'}:${isOpen}`;
  const state = useRef({ key, taxEdited: false, fields: new Map<string, Set<string>>() });
  useEffect(() => { state.current = { key, taxEdited: false, fields: new Map() }; }, [key]);
  const current = () => {
    if (state.current.key !== key) state.current = { key, taxEdited: false, fields: new Map() };
    return state.current;
  };
  return {
    mark: (id: string, field: string) => {
      const fields = current().fields.get(id) || new Set<string>();
      fields.add(field); current().fields.set(id, fields);
    },
    markTax: () => { current().taxEdited = true; },
    taxAvailable: () => !current().taxEdited && !documentId,
    fill: <L extends { id: string; accountId: string; dimensions?: Record<string, string> }>(line: L, defaults: DocumentDefaults): L =>
      fillLineDefaults(line, availableDocumentDefaults(defaults, axes, nodes), accounts, current().fields.get(line.id)),
  };
}
