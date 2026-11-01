import React, { useState } from 'react';
import { DOCUMENT_LANGUAGES, MAX_CONTACT_TERMS } from '../../lib/documentLanguage';
import { taxExemptionOf } from '../../lib/taxExemption';
import { withholdingOf } from '../../lib/tax/withholding';
import { Plus, Trash2, X } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { Labelled } from '../ui/Labelled';
import { cleanContacts, parseTags, STANDARD_CONTACT_ROLES } from '../../lib/contacts';
import { DELIVERY_METHODS, preferredDelivery } from '../../lib/delivery';
import type { DeliveryMethod } from '../../lib/delivery';
import type { ContactPerson } from '../../lib/contacts';

/**
 * Add or edit a customer or vendor (one form for both sides): name, email, phone, address, status,
 * the vendor's category, the default currency for new invoices/bills (Y-22), how documents go out
 * on their own (Y-27), tags (Y-24) and the people to deal with (Y-21). On a new contact, empty
 * extras are left out; when editing, clearing one saves it cleared.
 */
export type PartySide = 'customer' | 'vendor';

/** The fields the form shows; a Customer or a Vendor fits. */
export interface PartyFields {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  status?: string;
  category?: string;
  currency?: string;
  /** How documents go out on their own (Y-27); 'email' is left out of a new contact, it is the default. */
  deliveryMethod?: DeliveryMethod;
  tags?: string[];
  contacts?: ContactPerson[];
  balanceCents?: number;
  /** P-11, P-12: `documentLanguage` and `documentTerms`, the language and their own terms on their documents; T-05 `taxExemption` */
  metadata?: Record<string, unknown>;
}
type Party = PartyFields;

interface PartyModalProps {
  side: PartySide;
  isOpen: boolean;
  /** The contact to edit; none for a new one. */
  initial?: Party | null;
  onClose: () => void;
  onSave: (party: Party) => void;
}

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'JPY', 'CHF'];
const field = 'w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';
const labelClass = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1';

/** PLAN §6: where the customer is for tax (`taxPlace` in their metadata): country, state, city. */
function placeFields(initial?: { metadata?: Record<string, unknown> } | null) {
  const place = initial?.metadata?.taxPlace as { country?: string; state?: string; city?: string } | undefined;
  return { placeCountry: place?.country || '', placeState: place?.state || '', placeCity: place?.city || '' };
}

export default function PartyModal({ side, isOpen, initial, onClose, onSave }: PartyModalProps) {
  const noun = side === 'customer' ? 'Customer' : 'Vendor';
  const editing = Boolean(initial?.id);
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const blank = () => ({
    name: initial?.name || '', email: initial?.email || '', phone: initial?.phone || '', address: initial?.address || '',
    status: (initial?.status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
    category: initial?.category || 'Standard', currency: initial?.currency || '', tags: (initial?.tags || []).join(', '),
    deliveryMethod: preferredDelivery(initial),
    language: typeof initial?.metadata?.documentLanguage === 'string' ? initial.metadata.documentLanguage : '',
    terms: typeof initial?.metadata?.documentTerms === 'string' ? initial.metadata.documentTerms : '',
    exemptNumber: taxExemptionOf(initial)?.number || '', exemptUntil: taxExemptionOf(initial)?.expires || '',
    ...placeFields(initial),
    vatNumber: typeof initial?.metadata?.vatNumber === 'string' ? initial.metadata.vatNumber : '',
    whtRate: withholdingOf(initial) ? String(withholdingOf(initial)!.ratePercent) : '', whtNumber: withholdingOf(initial)?.number || '', whtUntil: withholdingOf(initial)?.expires || '',
    // each row keeps a key of its own while it is edited (cleanContacts drops it on save)
    contacts: (initial?.contacts || []).map(p => ({ ...p, rowKey: crypto.randomUUID() })) as Array<ContactPerson & { rowKey: string }>,
  });
  const [form, setForm] = useState(blank);
  const [loadedFor, setLoadedFor] = useState<Party | null | undefined>(initial);
  if (initial !== loadedFor) {
    // another contact opened in the same form: start from its values
    setLoadedFor(initial);
    setForm(blank());
  }
  const set = (fields: Partial<ReturnType<typeof blank>>) => setForm(f => ({ ...f, ...fields }));
  const setPerson = (i: number, fields: Partial<ContactPerson>) => set({ contacts: form.contacts.map((p, n) => (n === i ? { ...p, ...fields } : p)) });

  const { dialogProps, titleId } = useDialog(onClose, isOpen);
  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // "required" lets a name of only spaces through; spaces around an email would break sending
    if (!form.name.trim()) return;
    const party: Party = { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), status: form.status };
    if (side === 'vendor') party.category = form.category.trim() || 'Standard';
    if (!editing) party.balanceCents = 0;
    const tags = parseTags(form.tags);
    const contacts = cleanContacts(form.contacts);
    const address = form.address.trim();
    if (address || (editing && initial?.address)) party.address = address;
    if (form.currency || (editing && initial?.currency)) party.currency = form.currency;
    // Email is what happened before anyone could choose, so it is only written when it was set before
    if (form.deliveryMethod !== 'email' || (editing && initial?.deliveryMethod)) party.deliveryMethod = form.deliveryMethod;
    if (tags.length || (editing && initial?.tags?.length)) party.tags = tags;
    const taxPlace = form.placeCountry.trim() ? { country: form.placeCountry.trim().toUpperCase(), ...(form.placeState.trim() ? { state: form.placeState.trim().toUpperCase() } : {}), ...(form.placeCity.trim() ? { city: form.placeCity.trim() } : {}) } : null;
    const whtRate = form.whtRate.trim() === '' ? Number.NaN : Number(form.whtRate);
    const withholding = Number.isFinite(whtRate) && whtRate >= 0 && whtRate <= 100 ? { ratePercent: whtRate, ...(form.whtNumber.trim() ? { number: form.whtNumber.trim() } : {}), ...(form.whtUntil ? { expires: form.whtUntil } : {}) } : null;
    const exemption = form.exemptNumber.trim() ? { number: form.exemptNumber.trim(), ...(form.exemptUntil ? { expires: form.exemptUntil } : {}) } : null;
    if (form.language || form.terms.trim() || exemption || taxPlace || withholding || form.vatNumber.trim() || initial?.metadata?.vatNumber || initial?.metadata?.withholding || initial?.metadata?.documentLanguage || initial?.metadata?.documentTerms || initial?.metadata?.taxExemption || initial?.metadata?.taxPlace) {
      // the whole `metadata` is saved, so a choice taken back is simply left out
      const { documentLanguage: _l, documentTerms: _t, taxExemption: _x, taxPlace: _p, withholding: _w, vatNumber: _v, ...rest } = initial?.metadata || {};
      party.metadata = { ...rest, ...(form.language ? { documentLanguage: form.language } : {}), ...(form.terms.trim() ? { documentTerms: form.terms.trim() } : {}), ...(exemption ? { taxExemption: exemption } : {}), ...(taxPlace ? { taxPlace } : {}), ...(withholding ? { withholding } : {}), ...(form.vatNumber.trim() ? { vatNumber: form.vatNumber.trim() } : {}) };
    }
    if (contacts.length || (editing && initial?.contacts?.length)) party.contacts = contacts;
    onSave(editing ? { ...party, id: initial!.id } : party);
    if (!editing) setForm(blank());
  };

  const currencies = [...new Set([workspaceCurrency, ...(form.currency ? [form.currency] : []), ...COMMON_CURRENCIES])];

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-lg w-full max-h-[92vh] overflow-y-auto border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
          <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-white">{editing ? 'Edit' : 'Add'} {noun}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--muted)] hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <Labelled labelClassName={labelClass} label={`${noun} Name`}>
              <input type="text" required value={form.name} onChange={e => set({ name: e.target.value })} className={field} />
            </Labelled>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Labelled labelClassName={labelClass} label="Email Address">
                <input type="email" value={form.email} onChange={e => set({ email: e.target.value })} className={field} />
              </Labelled>
            </div>
            <div>
              <Labelled labelClassName={labelClass} label="Phone Number">
                <input type="text" value={form.phone} onChange={e => set({ phone: e.target.value })} className={field} />
              </Labelled>
            </div>
          </div>
          <div>
            <Labelled labelClassName={labelClass} label="Address">
              <textarea rows={2} maxLength={300} value={form.address} onChange={e => set({ address: e.target.value })} className={field} />
            </Labelled>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {side === 'vendor' && (
              <div>
                <Labelled labelClassName={labelClass} label="Category">
                  <input type="text" required value={form.category} onChange={e => set({ category: e.target.value })} className={field} />
                </Labelled>
              </div>
            )}
            <div>
              <Labelled labelClassName={labelClass} label="Status">
                <select value={form.status} onChange={e => set({ status: e.target.value as 'active' | 'inactive' })} className={field}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Labelled>
            </div>
            <div>
              <Labelled labelClassName={labelClass} label={`Default currency for new ${side === 'customer' ? 'invoices' : 'bills'}`}>
                <select value={form.currency} onChange={e => set({ currency: e.target.value })} className={field}>
                  <option value="">Home currency ({workspaceCurrency})</option>
                  {currencies.filter(c => c !== workspaceCurrency).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Labelled>
            </div>
          </div>
          <div>
            <Labelled labelClassName={labelClass} label={`Preferred delivery for ${side === 'customer' ? 'invoices and statements' : 'bills and remittances'}`}>
              <select value={form.deliveryMethod} onChange={e => set({ deliveryMethod: e.target.value as DeliveryMethod })} className={field}>
                {DELIVERY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label} — {m.note}</option>)}
              </select>
            </Labelled>
          </div>
          <div>
            <Labelled labelClassName={labelClass} label="Language of their documents">
              <select value={form.language} onChange={e => set({ language: e.target.value })} className={field}>
                <option value="">The workspace's (Settings → Branding)</option>
                {DOCUMENT_LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Labelled>
          </div>
          <div>
            <Labelled labelClassName={labelClass} label="Their own terms on their documents (in place of the workspace's)">
              <textarea rows={2} maxLength={MAX_CONTACT_TERMS} value={form.terms} onChange={e => set({ terms: e.target.value })} placeholder="Leave empty for the workspace's terms (Settings → Branding)" className={field} />
            </Labelled>
          </div>
          {side === 'vendor' && (
            <div className="grid grid-cols-3 gap-3">
              <Labelled labelClassName={labelClass} label="Tax withheld at source, %">
                <input type="number" min="0" max="100" step="0.01" value={form.whtRate} onChange={e => set({ whtRate: e.target.value })} placeholder="From their certificate" className={field} />
              </Labelled>
              <Labelled labelClassName={labelClass} label="Withholding certificate">
                <input type="text" maxLength={40} value={form.whtNumber} onChange={e => set({ whtNumber: e.target.value })} className={field} />
              </Labelled>
              <Labelled labelClassName={labelClass} label="Withholding certificate good until">
                <input type="date" value={form.whtUntil} onChange={e => set({ whtUntil: e.target.value })} className={field} />
              </Labelled>
            </div>
          )}
          {side === 'customer' && (
            <div className="grid grid-cols-3 gap-3">
              <Labelled labelClassName={labelClass} label="Tax country">
                <input type="text" maxLength={2} value={form.placeCountry} onChange={e => set({ placeCountry: e.target.value })} placeholder="US, IL" className={field} />
              </Labelled>
              <Labelled labelClassName={labelClass} label="Tax state">
                <input type="text" maxLength={3} value={form.placeState} onChange={e => set({ placeState: e.target.value })} placeholder="TX" className={field} />
              </Labelled>
              <Labelled labelClassName={labelClass} label="Tax city">
                <input type="text" maxLength={80} value={form.placeCity} onChange={e => set({ placeCity: e.target.value })} className={field} />
              </Labelled>
              <Labelled labelClassName={labelClass} label="Their VAT / dealer number">
                <input type="text" maxLength={20} value={form.vatNumber} onChange={e => set({ vatNumber: e.target.value })} placeholder="When they are a business" className={field} />
              </Labelled>
            </div>
          )}
          {side === 'customer' && (
            <div className="grid grid-cols-2 gap-3">
              <Labelled labelClassName={labelClass} label="Tax exemption certificate">
                <input type="text" maxLength={80} value={form.exemptNumber} onChange={e => set({ exemptNumber: e.target.value })} placeholder="Its number, if they don't pay tax" className={field} />
              </Labelled>
              <Labelled labelClassName={labelClass} label="Certificate good until">
                <input type="date" value={form.exemptUntil} disabled={!form.exemptNumber.trim()} onChange={e => set({ exemptUntil: e.target.value })} className={field} />
              </Labelled>
            </div>
          )}
          <div>
            <Labelled labelClassName={labelClass} label="Tags (separated by commas)">
              <input type="text" value={form.tags} onChange={e => set({ tags: e.target.value })} placeholder="wholesale, priority" className={field} />
            </Labelled>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-700 dark:text-slate-300">People to contact</legend>
            <datalist id={`contact-roles-${side}`}>
              {STANDARD_CONTACT_ROLES.map(r => <option key={r} value={r} />)}
            </datalist>
            {form.contacts.map((person, i) => (
              <div key={person.rowKey} className="grid grid-cols-2 gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                <input aria-label={`Contact ${i + 1} name`} placeholder="Name" value={person.name} onChange={e => setPerson(i, { name: e.target.value })} className={field} />
                <input aria-label={`Contact ${i + 1} role`} list={`contact-roles-${side}`} placeholder="Role (Billing, Shipping, AP…)" value={person.role || ''} onChange={e => setPerson(i, { role: e.target.value })} className={field} />
                <input aria-label={`Contact ${i + 1} email`} type="email" placeholder="Email" value={person.email || ''} onChange={e => setPerson(i, { email: e.target.value })} className={field} />
                <div className="flex gap-2">
                  <input aria-label={`Contact ${i + 1} phone`} placeholder="Phone" value={person.phone || ''} onChange={e => setPerson(i, { phone: e.target.value })} className={field} />
                  <button type="button" aria-label={`Remove contact ${i + 1}`} onClick={() => set({ contacts: form.contacts.filter((_, n) => n !== i) })} className="p-2 text-rose-600">
                    <Trash2 aria-hidden="true" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {form.contacts.length < 20 && (
              <button type="button" onClick={() => set({ contacts: [...form.contacts, { name: '', rowKey: crypto.randomUUID() }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                <Plus aria-hidden="true" className="w-3.5 h-3.5" /> Add a person
              </button>
            )}
          </fieldset>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">Save {noun}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
