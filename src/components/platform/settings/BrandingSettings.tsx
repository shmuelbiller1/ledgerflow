import React, { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Palette, FileText, Trash2 } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getIdToken } from '../../../firebase';
import { BRANDED_DOCUMENTS, BRANDED_DOCUMENT_LABELS, DEFAULT_BRAND_COLOR, DOCUMENT_STYLES, MAX_LOGO_BYTES } from '../../../lib/brandingConstants';
import type { WorkspaceBranding } from '../../../lib/brandingConstants';
import { DOCUMENT_LANGUAGES } from '../../../lib/documentLanguage';
import { registerUnsavedWorkGuard } from '../../../lib/pwaUpdateManager';

/**
 * Settings → Branding (Y-11…Y-14, Y-33, Y-34): logo, colour, address, footer and default terms for
 * each document type, and the payment QR code on invoices. "Preview PDF" shows a sample invoice
 * with the choices on screen; "Save" stores them (owners and accountants; the server checks the
 * logo). Every PDF the app makes uses them (src/server/services/pdfService.ts).
 */

const inputClass = 'w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';

async function brandingRequest(workspaceId: string, path: '' | '/preview', method: 'PUT' | 'POST', branding: WorkspaceBranding) {
  return fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/branding${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
    body: JSON.stringify({ branding }),
  });
}

async function failure(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.message || fallback;
}

export default function BrandingSettings() {
  const formId = useId();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant';
  const [draft, setDraft] = useState<WorkspaceBranding>(() => workspace?.branding || {});
  const [busy, setBusy] = useState<'save' | 'preview' | null>(null);
  const dirty = Boolean(workspace) && JSON.stringify(draft) !== JSON.stringify(workspace?.branding || {});
  useEffect(() => (dirty ? registerUnsavedWorkGuard(() => true) : undefined), [dirty]);

  const set = (fields: Partial<WorkspaceBranding>) => setDraft(d => ({ ...d, ...fields }));
  const setTerms = (type: typeof BRANDED_DOCUMENTS[number], text: string) => setDraft(d => ({ ...d, terms: { ...(d.terms || {}), [type]: text } }));

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast.error('Use a PNG or JPEG image for the logo.'); return; }
    if (file.size > MAX_LOGO_BYTES) { toast.error(`The logo is ${Math.round(file.size / 1000)} KB; use one under ${MAX_LOGO_BYTES / 1000} KB.`); return; }
    const reader = new FileReader();
    reader.onload = () => set({ logoDataUrl: String(reader.result) });
    reader.onerror = () => toast.error('The image could not be read.');
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!workspace?.id) return;
    setBusy('save');
    try {
      const res = await brandingRequest(workspace.id, '', 'PUT', draft);
      if (!res.ok) throw new Error(await failure(res, 'The branding could not be saved'));
      const { branding } = await res.json();
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, branding } : w)));
      setDraft(branding);
      toast.success('Branding saved. New PDFs use it.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The branding could not be saved');
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    if (!workspace?.id) return;
    // opened before the request so the browser doesn't block it as a pop-up
    const tab = window.open('', '_blank');
    setBusy('preview');
    try {
      const res = await brandingRequest(workspace.id, '/preview', 'POST', draft);
      if (!res.ok) throw new Error(await failure(res, 'The preview could not be made'));
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url; else window.location.assign(url);
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : 'The preview could not be made');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ledger-card p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-6" aria-labelledby={`${formId}-title`}>
      <div className="flex items-start gap-3">
        <Palette aria-hidden="true" className="w-5 h-5 text-[var(--brass)] mt-1" />
        <div>
          <h2 id={`${formId}-title`} className="text-lg font-bold text-[var(--text)]">Branding on documents</h2>
          <p className="text-xs text-[var(--muted)]">Logo, colour, address, footer and terms on every invoice, estimate, credit note, receipt and statement PDF.</p>
        </div>
      </div>
      {!canEdit && <p role="status" className="text-xs text-[var(--muted)]">Only owners and accountants can change the branding.</p>}

      <fieldset disabled={!canEdit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor={`${formId}-logo`} className="block text-xs font-semibold text-[var(--text)]">Logo (PNG or JPEG, up to {MAX_LOGO_BYTES / 1000} KB)</label>
            <input id={`${formId}-logo`} type="file" accept="image/png,image/jpeg" onChange={e => pickLogo(e.target.files?.[0])} className="text-xs" />
            {draft.logoDataUrl && (
              <div className="flex items-center gap-3">
                <img src={draft.logoDataUrl} alt="Logo preview" className="max-h-14 max-w-[160px] border border-[var(--line)] rounded bg-white p-1" />
                <button type="button" onClick={() => set({ logoDataUrl: '' })} className="inline-flex items-center gap-1 text-xs text-[var(--neg)]">
                  <Trash2 aria-hidden="true" className="w-3.5 h-3.5" /> Remove logo
                </button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${formId}-color`} className="block text-xs font-semibold text-[var(--text)]">Brand colour</label>
            <div className="flex items-center gap-2">
              <input id={`${formId}-color`} type="color" value={draft.color || DEFAULT_BRAND_COLOR} onChange={e => set({ color: e.target.value.toUpperCase() })} className="h-9 w-14 rounded border border-[var(--line)]" />
              <span className="font-mono text-xs text-[var(--muted)]">{(draft.color || DEFAULT_BRAND_COLOR).toUpperCase()}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${formId}-address`} className="block text-xs font-semibold mb-1 text-[var(--text)]">Address under the company name</label>
            <textarea id={`${formId}-address`} rows={3} maxLength={300} value={draft.address || ''} onChange={e => set({ address: e.target.value })} className={inputClass} placeholder={'12 High Street\nLondon EC1A 1BB\nVAT GB123456789'} />
          </div>
          <div>
            <label htmlFor={`${formId}-footer`} className="block text-xs font-semibold mb-1 text-[var(--text)]">Footer on every page</label>
            <textarea id={`${formId}-footer`} rows={3} maxLength={300} value={draft.footer || ''} onChange={e => set({ footer: e.target.value })} className={inputClass} placeholder="Bank details, registration number, thank-you note" />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-bold text-[var(--text)] flex items-center gap-2"><FileText aria-hidden="true" className="w-4 h-4" /> Terms printed at the end</h3>
          {BRANDED_DOCUMENTS.map(type => (
            <div key={type}>
              <label htmlFor={`${formId}-terms-${type}`} className="block text-xs font-semibold mb-1 text-[var(--text)]">{BRANDED_DOCUMENT_LABELS[type]}</label>
              <textarea id={`${formId}-terms-${type}`} rows={2} maxLength={2000} value={draft.terms?.[type] || ''} onChange={e => setTerms(type, e.target.value)} className={inputClass} />
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--text)]">
          <input type="checkbox" checked={draft.showPaymentQr !== false} onChange={e => set({ showPaymentQr: e.target.checked })} />
          Print a QR code to the payment page on invoices that have one (sent invoices)
        </label>
        <div>
          <label htmlFor={`${formId}-style`} className="block text-xs font-semibold mb-1 text-[var(--text)]">Page style</label>
          <select id={`${formId}-style`} value={draft.style || 'classic'} onChange={e => set({ style: e.target.value as WorkspaceBranding['style'] })} className={inputClass}>
            {DOCUMENT_STYLES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--text)]">
          <input type="checkbox" checked={draft.hideQuantity === true} onChange={e => set({ hideQuantity: e.target.checked })} />
          Leave out the quantity column (for amounts-only billing)
        </label>
        <div>
          <label htmlFor={`${formId}-language`} className="block text-xs font-semibold mb-1 text-[var(--text)]">Language of the printed words (titles, labels, totals)</label>
          <select id={`${formId}-language`} value={draft.language || 'en'} onChange={e => set({ language: e.target.value as WorkspaceBranding['language'] })} className={inputClass}>
            {DOCUMENT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">A customer can have their own language (in the customer's details). What you type prints as typed.</p>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={preview} disabled={busy !== null || !workspace?.id} className="px-4 py-2 rounded-lg border border-[var(--line)] text-sm font-semibold disabled:opacity-50">
          {busy === 'preview' ? 'Preparing…' : 'Preview PDF'}
        </button>
        {canEdit && (
          <button type="button" onClick={save} disabled={busy !== null || !workspace?.id} className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50">
            {busy === 'save' ? 'Saving…' : 'Save branding'}
          </button>
        )}
      </div>
    </section>
  );
}
