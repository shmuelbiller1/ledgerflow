/**
 * EU-C4: "Snap a receipt" from the phone's + menu.
 *
 * Takes (or picks) a photo, asks who it is from, and saves the photo in Documents plus a **draft**
 * bill that points at it. A draft posts nothing to the ledger; the bill is approved, paid or
 * matched to its bank line later, in Bills and bank review. Reading the amount and date from the
 * photo is offered, never required: the person can type them.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Camera, X } from 'lucide-react';
import { addDoc, collection, doc, updateDoc } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { workspaceActor } from '../../lib/guestActor';
import { isArchivedParty } from '../../lib/contacts';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { aiService } from '../../services/aiService';
import { getLocalDateISO } from '../../lib/utils';
import {
  MAX_RECEIPT_BYTES, parseReceiptAmount, readerCentsToMinor, receiptAmountText, receiptDraftBill, receiptDraftProblem, receiptFileName,
} from '../../lib/snapReceipt';
import { RelatedRecordEditButton } from '../common/RecordDetailsLauncher';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The photo could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** The writes this dialog makes. Injectable so a component test can stub the database boundary. */
export interface ReceiptWrites {
  saveDocument(data: Record<string, unknown>): Promise<string>;
  saveBill(bill: ReturnType<typeof receiptDraftBill>): Promise<string | null>;
  linkDocument(docId: string, link: { linkedCollection: 'bills'; linkedId: string; linkedLabel: string }): Promise<void>;
}

export default function SnapReceiptDialog({ onClose, writes }: { onClose: () => void; writes?: ReceiptWrites }) {
  // while a save is under way the dialog stays open, so its result always shows here (no second
  // save of the same receipt because the first one's outcome was never seen)
  const savingRef = useRef(false);
  const requestClose = () => { if (!savingRef.current) onClose(); };
  const { dialogProps, titleId } = useDialog(requestClose, true);
  // the signed-in person, or the sample company's local editor (the same actor addEntity uses)
  const user = useAuthStore(workspaceActor);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const vendors = useLedgerStore(s => s.vendors);
  useLedgerCollections('vendors');
  const { addEntity } = useEntityOperations();
  const io: ReceiptWrites = writes || {
    saveDocument: async data => (await addDoc(collection(db, 'documents'), data)).id,
    saveBill: async bill => (await addEntity('bills', bill))?.id ?? null,
    linkDocument: async (docId, link) => { await updateDoc(doc(db, 'documents', docId), link); },
  };
  const ids = { photo: useId(), vendor: useId(), amount: useId(), date: useId() };

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getLocalDateISO());
  const [busy, setBusy] = useState<'' | 'reading' | 'saving'>('');
  const [error, setError] = useState('');
  // the photo on screen now: a reading that finishes after the photo was replaced is stale
  const currentPhoto = useRef<File | null>(null);
  const currency = workspace?.currency || 'USD';
  // a receipt belongs to the books it was snapped in: a change of person or workspace drops it
  const scope = `${user?.uid || ''}:${workspace?.id || ''}`;
  const openedIn = useRef(scope);
  // a save that finishes after this dialog was closed (or replaced by a new one) must not close
  // the newer dialog or announce itself in other books
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    if (openedIn.current === scope) return;
    currentPhoto.current = null; // any reading still under way is now stale
    onClose();
  }, [scope, onClose]);

  const choose = async (picked: File | undefined) => {
    setError('');
    if (!picked) return;
    if (!picked.type.startsWith('image/')) { setError('Choose a photo of the receipt.'); return; }
    if (picked.size > MAX_RECEIPT_BYTES) { setError('This photo is larger than 700 KB. Take it again at a lower resolution.'); return; }
    currentPhoto.current = picked;
    try {
      const url = await readAsDataUrl(picked);
      if (currentPhoto.current !== picked) return; // stale: another photo was chosen meanwhile
      setPreview(url);
      setFile(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const readIt = async () => {
    const asked = file;
    if (!asked) return;
    setBusy('reading');
    setError('');
    try {
      const parsed = await aiService.parseReceipt(asked) as { totalAmountCents?: number; date?: string } | null;
      if (currentPhoto.current !== asked) return; // stale: the photo was replaced while it was read
      if (typeof parsed?.totalAmountCents === 'number') setAmount(receiptAmountText(readerCentsToMinor(parsed.totalAmountCents, currency), currency));
      if (parsed?.date && /^\d{4}-\d{2}-\d{2}/.test(parsed.date)) setDate(parsed.date.slice(0, 10));
      if (typeof parsed?.totalAmountCents !== 'number') setError('The amount could not be read. Type it in.');
    } catch (err) {
      if (currentPhoto.current !== asked) return;
      setError(`The receipt could not be read: ${err instanceof Error ? err.message : String(err)}. Type the amount in.`);
    } finally {
      setBusy('');
    }
  };

  const amountCents = parseReceiptAmount(amount, currency);
  const vendor = vendors.find(v => v.id === vendorId);
  const problem = !file ? 'Take a photo of the receipt first.'
    : amountCents === null ? `Type the amount as a number in ${currency}.`
      : receiptDraftProblem({ vendorId, amountCents, date, receiptDocId: 'pending' });

  const save = async () => {
    if (problem || !file || amountCents === null || !vendor) return;
    if (!user || !workspace?.id) { setError('Sign in to save receipts.'); return; }
    setBusy('saving');
    savingRef.current = true;
    setError('');
    let receiptDocId = '';
    try {
      receiptDocId = await io.saveDocument({
        uid: user.uid,
        workspaceId: workspace.id,
        name: receiptFileName(date, file.name),
        fileUrl: preview,
        mimeType: file.type,
        sizeBytes: file.size,
        tags: ['Receipt'],
        createdAt: new Date().toISOString(),
      });
      const billId = await io.saveBill(receiptDraftBill({
        vendorId: vendor.id, vendorName: vendor.name, amountCents, date,
        currency, receiptDocId,
      }));
      if (!billId) throw new Error('the draft bill was not saved');
      // the bill exists now: a failed link must not invite a second save (and a second bill)
      try {
        await io.linkDocument(receiptDocId, {
          linkedCollection: 'bills', linkedId: billId, linkedLabel: `${vendor.name} receipt (draft)`,
        });
        if (mounted.current) toast.success('Receipt saved as a draft bill. Nothing is posted until it is approved.');
      } catch (linkErr) {
        if (mounted.current) toast.warning(`Receipt saved as a draft bill, but the photo could not be linked to it (${linkErr instanceof Error ? linkErr.message : String(linkErr)}). The photo is in Documents.`);
      }
      if (mounted.current) onClose();
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      setError(receiptDocId
        ? `The photo is saved in Documents, but ${why}. Open Documents to try again.`
        : `Not saved: ${why}.`);
    } finally {
      savingRef.current = false;
      setBusy('');
    }
  };

  return createPortal(
    <div {...dialogProps} className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] text-[var(--text)] border border-[var(--line)] shadow-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="font-semibold">Snap a receipt</h2>
          <button type="button" aria-label="Close" disabled={busy === 'saving'} className="min-h-11 min-w-11 flex items-center justify-center disabled:opacity-50" onClick={requestClose}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <label htmlFor={ids.photo} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--line)] px-3 py-3 text-sm cursor-pointer">
          {preview
            ? <img src={preview} alt="Snapped receipt" className="max-h-40 rounded-lg object-contain" />
            : <><Camera aria-hidden="true" size={18} /> Take or choose a photo</>}
        </label>
        <input id={ids.photo} data-testid="snap-receipt-photo" type="file" accept="image/*" capture="environment" className="sr-only"
          onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
        {file && (
          <button type="button" disabled={busy !== ''} onClick={() => void readIt()} className="w-full min-h-11 rounded-xl border border-[var(--line)] text-sm disabled:opacity-50">
            {busy === 'reading' ? 'Reading…' : 'Read the amount and date for me'}
          </button>
        )}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={ids.vendor} className="text-sm font-medium">Vendor</label>
            {vendorId && <RelatedRecordEditButton target={{ kind: 'vendors', id: vendorId }} />}
          </div>
          <select id={ids.vendor} value={vendorId} onChange={e => setVendorId(e.target.value)} className="w-full min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2">
            <option value="">Choose a vendor</option>
            {vendors.filter(v => !isArchivedParty(v) && v.status !== 'blocked').map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor={ids.amount} className="text-sm font-medium">Amount</label>
            <input id={ids.amount} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="w-full min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
          </div>
          <div className="space-y-1">
            <label htmlFor={ids.date} className="text-sm font-medium">Date</label>
            <input id={ids.date} type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full min-h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2" />
          </div>
        </div>
        {(error || problem) && <p role={error ? 'alert' : undefined} className="text-sm text-[var(--muted)]">{error || problem}</p>}
        <p className="text-xs text-[var(--muted)]">Saved as a draft bill with the photo attached. Nothing is posted until it is approved; match it to the bank payment later.</p>
        <button type="button" disabled={Boolean(problem) || busy !== ''} onClick={() => void save()} className="w-full min-h-11 rounded-xl bg-[var(--text)] text-[var(--surface)] font-semibold disabled:opacity-50">
          {busy === 'saving' ? 'Saving…' : 'Save draft'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
