import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Palette, Trash2 } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getIdToken, db } from '../../../firebase';
import { doc, getDoc } from '../../../lib/db/firestore';
import { DEFAULT_BRAND_COLOR, MAX_LOGO_BYTES } from '../../../lib/brandingConstants';
import type { WorkspaceBranding } from '../../../lib/brandingConstants';
import { brandingForLabels, brandingProfilesProblem, labelKey } from '../../../lib/entityBranding';
import type { BrandingProfiles } from '../../../lib/entityBranding';

const field = 'min-h-11 w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2';
const areaField = 'w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';

export default function BrandingProfilesSettings() {
  const uid = useAuthStore(s => s.user?.uid), workspaceId = useAuthStore(s => s.currentWorkspaceId);
  return <Scoped key={JSON.stringify([uid, workspaceId])} />;
}

function Scoped() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const uid = useAuthStore(s => s.user?.uid);
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const truncated = useLedgerStore(s => s.truncatedCollections.dimensionNodes);
  const dimensions = workspace?.dimensions || [];
  const order = dimensions.map(d => d.id);
  const role = useCurrentRole();
  const isGuest = useAuthStore(s => s.isGuest);
  const canEdit = !isGuest && (role === 'owner' || role === 'accountant');

  const profiles: BrandingProfiles = workspace?.brandingProfiles || {};
  const workspaceBranding: WorkspaceBranding = workspace?.branding || {};

  const [target, setTarget] = useState('books');
  const [editing, setEditing] = useState<{ target: string; original: WorkspaceBranding | undefined; draft: WorkspaceBranding } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const editButton = useRef<HTMLButtonElement>(null);
  const draftAddress = useRef<HTMLTextAreaElement>(null);
  const previouslyEditing = useRef(false);

  useEffect(() => {
    if (editing && !previouslyEditing.current) draftAddress.current?.focus();
    if (!editing && previouslyEditing.current) editButton.current?.focus();
    previouslyEditing.current = Boolean(editing);
  }, [editing]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const current = () => mounted.current && useAuthStore.getState().currentWorkspaceId === workspace?.id && useAuthStore.getState().user?.uid === uid;

  const own = (key: string, value: BrandingProfiles = profiles): WorkspaceBranding | undefined =>
    key === 'books' ? undefined : value.labels?.[key];

  const names = new Map(nodes.map(node => [`${node.dimensionId}:${node.id}`, (node.description || node.id)]));
  const targets = [...new Set(['books', ...(editing ? [editing.target] : []), ...Object.keys(profiles.labels || {}), ...names.keys()])];

  const resolved = (key: string): WorkspaceBranding => {
    if (key === 'books') return workspaceBranding;
    const dimensionId = key.slice(0, key.indexOf(':'));
    const nodeId = key.slice(key.indexOf(':') + 1);
    return brandingForLabels(workspaceBranding, profiles, { [dimensionId]: nodeId }, order.length ? order : [dimensionId]);
  };
  const selected = resolved(target);
  const ownSelected = own(target);

  function edit(key: string) {
    if (!canEdit || busy) return;
    setTarget(key);
    setError('');
    setNotice('');
    const draft = structuredClone(own(key) || {});
    setEditing({ target: key, original: structuredClone(own(key)), draft });
  }
  function change(next: WorkspaceBranding) {
    if (editing && !busy) setEditing({ ...editing, draft: next });
  }
  const pickLogo = (file: File | undefined) => {
    if (!file || !editing) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast.error('Use a PNG or JPEG image for the logo.'); return; }
    if (file.size > MAX_LOGO_BYTES) { toast.error(`The logo is ${Math.round(file.size / 1000)} KB; use one under ${MAX_LOGO_BYTES / 1000} KB.`); return; }
    const reader = new FileReader();
    reader.onload = () => change({ ...editing.draft, logoDataUrl: String(reader.result) });
    reader.onerror = () => toast.error('The image could not be read.');
    reader.readAsDataURL(file);
  };

  async function save() {
    if (!workspace || !uid || !editing || pending.current || !canEdit || !current()) return;
    const submitted = structuredClone(editing);
    const candidate: BrandingProfiles = submitted.target === 'books' ? {} : { labels: { [submitted.target]: submitted.draft } };
    const problem = brandingProfilesProblem(candidate as BrandingProfiles);
    if (problem) { setError(problem); return; }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const fresh = await getDoc(doc(db, 'workspaces', workspace.id));
      if (!current()) return;
      if (!fresh.exists()) throw new Error('This workspace is no longer available.');
      const data = fresh.data() as { brandingProfiles?: BrandingProfiles; roles?: Record<string, string>; uid?: string };
      const latest = (data.brandingProfiles || {}) as BrandingProfiles;
      const currentRole = data.uid === uid ? 'owner' : data.roles?.[uid];
      if (currentRole !== 'owner' && currentRole !== 'accountant') throw new Error('Only owners and accountants can edit branding profiles.');
      if (brandingProfilesProblem(latest)) throw new Error('The current branding profiles are not readable. Reload before editing.');
      if (JSON.stringify(own(submitted.target, latest)) !== JSON.stringify(submitted.original)) {
        throw new Error('This branding changed while you were editing. Your draft is retained; cancel and reopen it to review the newer version.');
      }
      // Build next: books target edits workspace branding? For A-77 we store per-label only.
      // Keep workspace.branding untouched; per-label overrides live in brandingProfiles.
      let next: BrandingProfiles;
      if (submitted.target === 'books') {
        throw new Error('The books branding is edited in Settings → Branding & PDFs. This screen is for per-label overrides.');
      } else {
        // Empty override means remove the label's override (inherit fully)
        const isEmpty = !submitted.draft || Object.keys(submitted.draft).length === 0 || Object.values(submitted.draft).every(v => v === '' || v === undefined || v === null || (typeof v === 'object' && Object.keys(v as object).length === 0));
        if (isEmpty) {
          const { [submitted.target]: _removed, ...rest } = latest.labels || {};
          next = { ...latest, labels: rest };
          if (Object.keys(next.labels || {}).length === 0) delete (next as Record<string, unknown>).labels;
        } else {
          next = { ...latest, labels: { ...latest.labels, [submitted.target]: submitted.draft } };
        }
      }
      const token = await getIdToken();
      if (!current()) return;
      if (!token) throw new Error('Sign in again before saving.');
      const active = useAuthStore.getState();
      const activeWorkspace = active.getCurrentWorkspace();
      const activeRole = activeWorkspace?.uid === uid ? 'owner' : activeWorkspace?.roles?.[uid];
      if (active.isGuest || (activeRole !== 'owner' && activeRole !== 'accountant')) throw new Error('Your permissions changed. The draft is retained; reopen this workspace before saving.');
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/branding-profiles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profiles: next }),
      });
      const result: Record<string, unknown> = await res.json().catch(() => ({}));
      if (!current()) return;
      if (!res.ok) {
        const msg = (result.message as string) || (result.error as string) || '';
        if (res.status === 404) throw new Error(msg || 'Branding profiles are not yet writable on the server (AI#1 wiring). Your draft is kept; try again after the server update.');
        throw new Error(msg || 'The branding profile was not saved.');
      }
      if (result.status !== 'success' || brandingProfilesProblem((result.profiles as BrandingProfiles) || next)) throw new Error('The server did not confirm valid branding profiles. Reload to check the saved state.');
      const auth = useAuthStore.getState();
      auth.setWorkspaces(auth.workspaces.map(row => (row.id === workspace.id ? { ...row, brandingProfiles: result.profiles as BrandingProfiles } : row)));
      setEditing(null);
      setNotice('Branding profile saved. New PDFs for that label use it; child labels inherit it until they override it.');
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'The branding profile was not saved.');
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  }

  if (!workspace) return <p>No workspace is selected.</p>;
  const unreadable = brandingProfilesProblem(profiles);
  if (unreadable) return <section aria-label="Branding profiles" className="p-4"><h2>Branding per label</h2><p role="alert">The saved branding profiles cannot be displayed: {unreadable}. Reload or ask an accountant to review them.</p></section>;

  const addLabel = () => {
    const key = newLabel.trim();
    const problem = brandingProfilesProblem({ labels: { [key]: {} } });
    if (problem) { setError(problem); return; }
    edit(key);
  };

  // Helper to show inheritance source for a field
  const sourceFor = (key: keyof WorkspaceBranding): string | null => {
    if (target === 'books') return null;
    if (ownSelected && (ownSelected as Record<string, unknown>)[key] !== undefined && (ownSelected as Record<string, unknown>)[key] !== '' && (ownSelected as Record<string, unknown>)[key] !== null) return target;
    // Walk ancestry to find which parent provides it
    const dimensionId = target.slice(0, target.indexOf(':'));
    const nodeId = target.slice(target.indexOf(':') + 1);
    const parts = nodeId.split('/').map(p => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 1; i--) {
      const ancestor = parts.slice(0, i).join('/');
      const k = labelKey(dimensionId, ancestor);
      const parentBranding = profiles.labels?.[k];
      if (parentBranding && (parentBranding as Record<string, unknown>)[key] !== undefined && (parentBranding as Record<string, unknown>)[key] !== '' && (parentBranding as Record<string, unknown>)[key] !== null) return k;
    }
    if ((workspaceBranding as Record<string, unknown>)[key] !== undefined && (workspaceBranding as Record<string, unknown>)[key] !== '' && (workspaceBranding as Record<string, unknown>)[key] !== null) return 'books';
    return null;
  };

  return (
    <section aria-label="Branding profiles" className="space-y-4 p-4 min-w-0">
      <div className="flex items-start gap-3">
        <Palette aria-hidden="true" className="w-5 h-5 text-[var(--brass)] mt-1" />
        <div>
          <h2 className="text-lg font-bold text-[var(--text)]">Branding per label</h2>
          <p className="text-xs text-[var(--muted)]">Logo, colour, address and footer for each label value. Child labels inherit their parent&apos;s branding until they set their own — like tax profiles. The server picks this branding when it makes a PDF for that label (AI#1).</p>
        </div>
      </div>
      {truncated && <p role="status" className="text-xs text-[var(--muted)]">The loaded label catalogue is incomplete. Existing profiles are listed; enter an exact label:value key to edit another.</p>}
      <label className="block text-sm">
        Label
        <select className={field} value={target} disabled={Boolean(editing)} onChange={e => setTarget(e.target.value)}>
          {targets.map(key => <option key={key} value={key}>{key === 'books' ? 'The books (default — edit in Branding & PDFs)' : `${names.get(key) || key} (${key})`}</option>)}
        </select>
      </label>

      <div className="rounded border border-[var(--line)] p-3 space-y-3 bg-[var(--surface)]">
        <h3 className="text-sm font-bold text-[var(--text)]">Effective branding for {target === 'books' ? 'the books' : target}</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {([
            ['Logo', selected.logoDataUrl ? 'Set' : 'Not set', 'logoDataUrl' as const],
            ['Brand colour', selected.color || DEFAULT_BRAND_COLOR, 'color' as const],
            ['Address', selected.address || 'Not set', 'address' as const],
            ['Footer', selected.footer || 'Not set', 'footer' as const],
            ['Style', selected.style || 'classic', 'style' as const],
            ['Language', selected.language || 'en', 'language' as const],
          ] as Array<[string, string, keyof WorkspaceBranding]>).map(([label, value, key]) => {
            const src = sourceFor(key);
            const inherited = Boolean(value && value !== 'Not set' && src && src !== target && src !== null);
            return (
              <div key={key}>
                <dt className="font-semibold text-xs text-[var(--muted)]">{label}</dt>
                <dd className={inherited ? 'min-w-0 break-words text-[var(--muted)]' : 'min-w-0 break-words text-[var(--text)]'}>
                  {key === 'logoDataUrl' && selected.logoDataUrl ? <img src={selected.logoDataUrl} alt="Logo preview" className="max-h-10 max-w-[140px] border border-[var(--line)] rounded bg-white p-1" /> : key === 'color' ? <span className="inline-flex items-center gap-2"><span className="inline-block h-4 w-4 rounded border border-[var(--line)]" style={{ background: value }} aria-hidden />{value}</span> : <bdi dir="auto" className="break-words whitespace-pre-wrap">{value}</bdi>}
                  {inherited && src && <span className="block text-xs">Inherited from <bdi>{src === 'books' ? 'the books' : src}</bdi></span>}
                </dd>
              </div>
            );
          })}
        </dl>
        {selected.terms && Object.keys(selected.terms).length > 0 && (
          <div className="text-xs">
            <div className="font-semibold text-[var(--muted)]">Terms</div>
            {Object.entries(selected.terms).map(([doc, text]) => text && <div key={doc}><span className="font-semibold">{doc}:</span> <bdi dir="auto">{String(text).slice(0, 120)}{String(text).length > 120 ? '…' : ''}</bdi></div>)}
          </div>
        )}
      </div>

      {!editing && canEdit && target !== 'books' && <button ref={editButton} type="button" onClick={() => edit(target)} className="min-h-11 border rounded px-3 text-sm">Edit this label&apos;s branding</button>}
      {!editing && canEdit && (
        <div className="flex flex-wrap gap-2 items-end">
          <label className="min-w-0 text-sm">Another label:value key<input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="property:A/C1 or costCentre:EU" className={field} /></label>
          <button type="button" onClick={addLabel} className="min-h-11 border rounded px-3 text-sm">Edit label branding</button>
        </div>
      )}
      {!canEdit && <p role="status" className="text-xs text-[var(--muted)]">Only owners and accountants can change branding.</p>}

      {editing && (
        <form onSubmit={e => { e.preventDefault(); void save(); }} aria-label="Edit branding profile" className="rounded border p-3 space-y-4 bg-[var(--surface)]">
          <p className="text-xs text-[var(--muted)]"><bdi>{editing.target}</bdi> — leave a field empty to inherit it from its parent label or the books. Clear every field to remove this label&apos;s override.</p>
          <fieldset disabled={busy || !canEdit} className="space-y-4">
            <legend className="sr-only">Own branding fields</legend>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[var(--text)]">Logo (PNG or JPEG, up to {MAX_LOGO_BYTES / 1000} KB)</label>
              <input type="file" accept="image/png,image/jpeg" onChange={e => pickLogo(e.target.files?.[0])} className="text-xs" />
              {editing.draft.logoDataUrl && (
                <div className="flex items-center gap-3">
                  <img src={editing.draft.logoDataUrl} alt="Logo preview" className="max-h-14 max-w-[160px] border border-[var(--line)] rounded bg-white p-1" />
                  <button type="button" onClick={() => change({ ...editing.draft, logoDataUrl: '' })} className="inline-flex items-center gap-1 text-xs text-[var(--neg)]">
                    <Trash2 aria-hidden="true" className="w-3.5 h-3.5" /> Remove logo
                  </button>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="branding-colour" className="block text-xs font-semibold mb-1 text-[var(--text)]">Brand colour</label>
              <div className="flex items-center gap-2">
                <input id="branding-colour" type="color" value={editing.draft.color || DEFAULT_BRAND_COLOR} onChange={e => change({ ...editing.draft, color: e.target.value.toUpperCase() })} className="h-9 w-14 rounded border border-[var(--line)]" />
                <span className="font-mono text-xs text-[var(--muted)]">{(editing.draft.color || DEFAULT_BRAND_COLOR).toUpperCase()}</span>
                <button type="button" onClick={() => change({ ...editing.draft, color: '' })} className="text-xs underline">Inherit</button>
              </div>
            </div>
            <div>
              <label htmlFor="branding-address" className="block text-xs font-semibold mb-1 text-[var(--text)]">Address under the company name</label>
              <textarea id="branding-address" ref={draftAddress} rows={3} maxLength={300} value={editing.draft.address || ''} onChange={e => change({ ...editing.draft, address: e.target.value })} className={areaField} placeholder="Leave empty to inherit" />
            </div>
            <div>
              <label htmlFor="branding-footer" className="block text-xs font-semibold mb-1 text-[var(--text)]">Footer on every page</label>
              <textarea id="branding-footer" rows={3} maxLength={300} value={editing.draft.footer || ''} onChange={e => change({ ...editing.draft, footer: e.target.value })} className={areaField} placeholder="Leave empty to inherit" />
            </div>
            <button type="submit" className="min-h-11 border rounded px-3 text-sm font-semibold bg-[var(--brass)] text-[var(--ink)]">{busy ? 'Saving…' : 'Save branding'}</button>
          </fieldset>
          <button type="button" disabled={busy} onClick={() => { setEditing(null); setError(''); }} className="min-h-11 border rounded px-3 text-sm">Cancel</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-[var(--neg)] whitespace-pre-wrap">{error}</p>}
      <p role="status" className="text-xs text-[var(--muted)]">{notice}</p>
    </section>
  );
}
