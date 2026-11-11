import React, { useRef, useState } from 'react';
import { suggestionsFrom } from '../../../lib/inlineEdit';
import InlineEdit from '../../ui/InlineEdit';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { inlineRecordAdapter } from '../../../lib/inlineRecordAdapter';
import { saveDimensionAxisLabel, type DimensionAxisAdapter } from '../../../lib/dimensionAxisLabel';
import { doc, getDoc, updateDoc } from '../../../lib/db/firestore';
import { db } from '../../../firebase';
import type { DimensionDefinition } from '../../../types';
const adapter: DimensionAxisAdapter = {
 session: inlineRecordAdapter.session,
 readWorkspace: async id => { const snapshot = await getDoc(doc(db, 'workspaces', id)); return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : undefined; },
 updateWorkspace: async (id, dimensions) => { await updateDoc(doc(db, 'workspaces', id), { dimensions }); },
};
function ScopedDimensionName({ axis, onSaved }: { axis: DimensionDefinition; onSaved: (value: string) => void }) {
 const role = useCurrentRole();
 const names = useAuthStore(state => state.getCurrentWorkspace()?.dimensions);
 const [saving, setSaving] = useState(false), [failure, setFailure] = useState<{ value: string; message: string }>();
 const busy = useRef(false);
 const save = async (value: string | number) => {
  if (busy.current) throw new Error('This name is already saving.'); busy.current = true; setSaving(true);
  try {
   await saveDimensionAxisLabel(adapter, axis.id, axis.name, String(value));
   const session = adapter.session();
   useAuthStore.setState(state => ({ workspaces: state.workspaces.map(workspace => workspace.id === session?.workspaceId ? { ...workspace, dimensions: workspace.dimensions?.map(d => d.id === axis.id ? { ...d, name: String(value) } : d) } : workspace) }));
   onSaved(String(value)); setFailure(undefined);
  } catch (error) { setFailure({ value: String(value), message: error instanceof Error ? error.message : String(error) }); throw error; }
  finally { busy.current = false; setSaving(false); }
 };
 return <span className="inline-flex flex-col"><InlineEdit value={axis.name} suggestions={suggestionsFrom(names || [], dimension => dimension.name)} label={`Dimension name ${axis.id}`} canEdit={role !== 'viewer' && !saving} onSave={save} validate={value => String(value).trim() ? null : 'Display name is required'} />{failure && <span role="alert">{failure.message} <bdi>{failure.value}</bdi> <button type="button" disabled={saving || role === 'viewer'} onClick={() => { void save(failure.value).catch((err) => { console.warn('[WorkspaceDimensionName] Retry failed:', err); }); }}>Retry name</button></span>}</span>;
}
export function WorkspaceDimensionName(props: React.ComponentProps<typeof ScopedDimensionName>) {
 const uid = useAuthStore(state => state.user?.uid), workspace = useAuthStore(state => state.currentWorkspaceId);
 return <ScopedDimensionName key={`${uid}:${workspace}:${props.axis.id}`} {...props} />;
}
