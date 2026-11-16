import { useNewRecord } from '../../hooks/useNewRecord';
import { PartyDetailButton } from '../common/PartyDetailButton';
import { PageHeader } from '../ui/PageHeader';
import { useDetailReturnFocus } from '../../hooks/useDetailReturnFocus';
import React, { useCallback, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { StageChip } from '../collaboration/StageChip';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import InlineEdit from '../ui/InlineEdit';
import InlineAdd from '../ui/InlineAdd';
import { suggestionsFrom } from '../../lib/inlineEdit';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { ShoppingBag, Plus, Trash2, CheckCircle, AlertCircle, DollarSign, Ban, Pencil, Printer } from 'lucide-react';
import PdfPreviewModal from '../ui/PdfPreviewModal';
import DocumentBulkBar from '../ui/DocumentBulkBar';
import { useAuthStore } from '../../stores/useAuthStore';
import type { Bill, Vendor } from '../../types';
import { useRecordFocus, recordElementId } from '../../hooks/useRecordFocus';
import { formatCurrency, getLocalDateISO, safeConfirm } from '../../lib/utils';
import { undoSpreadRequest } from '../../services/spreadActions';
import { spreadProgress } from '../../lib/prepaidSchedule';
import SpreadBillDialog from './SpreadBillDialog';
import PaymentRunDialog from './PaymentRunDialog';
import ExpenseClaims, { type NewClaim } from './ExpenseClaims';
import { claimBill, claimDecision, claimOf } from '../../lib/expenseClaims';
import BillModal from './BillModal';
import VendorModal from './VendorModal';
import TagFilter from '../common/TagFilter';
import DocumentTotalsFoot from '../ui/DocumentTotalsFoot';
import { recurringBillSchedule } from '../../lib/recurringBills';
import type { BillDraft } from './BillModal';
import { allTags, hasTag, isArchivedParty } from '../../lib/contacts';
import PartyRowActions, { ArchivedBadge, ShowArchivedToggle } from '../common/PartyRowActions';
import VendorDetailView from './VendorDetailView';
import ReceivePaymentModal from '../sales/ReceivePaymentModal';
import { toast } from 'sonner';
import { attachFiles, attachSummary } from '../../services/attachmentActions';
import { ensureBillDimensionNodes } from '../../lib/dimensionNodeActions';
import OpeningDocumentsDialog from '../common/OpeningDocumentsDialog';
import { deleteWithUndo } from '../../lib/undoableDelete';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { LoadingState } from '../ui/LoadingState';
import { EmptyState } from '../ui/EmptyState';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { csvMoney } from '../../lib/csvExport';
import ExpectedBills from './ExpectedBills';
import type { ExpectedBill } from '../../lib/expectedBills';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { translateScreenString } from '../../lib/i18n/screenTranslations';
import { useUIStore } from '../../stores/useUIStore';
import { inBackground } from '../../lib/inBackground';

const NO_VENDORS: Vendor[] = [];
const NO_BILLS: Bill[] = [];

/** Accounts payable workspace screen for vendor bills, recurring schedules, and vendor management. */
export default function Purchases() {
  // EU-G1: visible text goes through the EN/HE table (src/lib/i18n/screenTranslations.ts)
  const language = useUIStore(s => s.language);
  const purchasesText = useCallback((key: string, fallback: string) => translateScreenString('purchases', key, language, fallback), [language]);
  const vendors = useLedgerStore(s => s.vendors) ?? NO_VENDORS;
  const bills = useLedgerStore(s => s.bills) ?? NO_BILLS;
  const accounts = useLedgerStore(s => s.accounts) || [];
  const { loading } = useLedgerCollections('bills', 'vendors');
  const schedules = useLedgerStore(s => s.recurring) || [];
  useLedgerCollections('recurring');
  // A-235: the same notice every screen uses when its data could not be loaded
  const dataHealth = useScreenDataHealth(['bills', 'vendors', 'recurring', 'accounts']);
  const { addEntity, updateEntity, deleteEntity } = useEntityOperations();
  const currentRole = useCurrentRole();
  const canEditContacts = currentRole !== 'viewer';

  const [activeSubTab, setActiveSubTab] = useState<'bills' | 'vendors'>('bills');
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const detailOpenerId = useDetailReturnFocus(selectedVendorId);
  const [searchTerm, setSearchTerm] = useState('');

  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Partial<Bill> | undefined>(undefined);
  const [previewBill, setPreviewBill] = useState<Bill | null>(null);
  const [spreadingBill, setSpreadingBill] = useState<Bill | null>(null);
  const [paymentRunOpen, setPaymentRunOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [pickedBills, setPickedBills] = useState<Set<string>>(() => new Set());
  const pdfWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const homeCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  // A record link (#purchases/bill/<id>, e.g. from Data Health) shows and highlights the bill
  const focusedBillId = useRecordFocus('bill', { ready: bills.length > 0, onFocus: () => { setActiveSubTab('bills'); setSelectedVendorId(null); setSearchTerm(''); } });
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  useNewRecord('bill', canEditContacts, () => {
    setActiveSubTab('bills'); setSelectedVendorId(null); setEditingBill(undefined); setIsBillModalOpen(true);
  });
  useNewRecord('vendor', canEditContacts, () => {
    setActiveSubTab('vendors'); setSelectedVendorId(null); setIsVendorModalOpen(true);
  });

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentDocumentId, setPaymentDocumentId] = useState<string | null>(null);
  const [paymentContactId, setPaymentContactId] = useState<string | null>(null);

  const filteredBills = useMemo(() => {
    return bills.filter(b => {
      const vendorName = b.vendorName || '';
      const billNumber = b.number || '';
      const matchText = `${vendorName} ${billNumber}`.toLowerCase();
      return matchText.includes(searchTerm.toLowerCase());
    });
  }, [bills, searchTerm]);

  const [billLimit, setBillLimit] = useState(100);
  /**
   * The focused bill (a `#purchases/bill/<id>` link) is moved to the front, not appended as row 101: the grid
   * pages at `billLimit`, so an appended row would sit on a page nobody turns to and the link would scroll to
   * nothing. Front keeps it on the first page, where the link lands.
   */
  const visibleBills = useMemo(() => {
    const focused = focusedBillId ? filteredBills.find(b => b.id === focusedBillId) : undefined;
    const rest = focused ? filteredBills.filter(b => b.id !== focused.id) : filteredBills;
    const sliced = rest.slice(0, Math.max(billLimit - (focused ? 1 : 0), 0));
    return focused ? [focused, ...sliced] : sliced;
  }, [filteredBills, billLimit, focusedBillId]);

  const [vendorTag, setVendorTag] = useState<string | null>(null);
  const vendorTags = useMemo(() => allTags(vendors), [vendors]);
  const vendorCategories = useMemo(() => suggestionsFrom(vendors, v => v.category), [vendors]);
  const [showArchivedVendors, setShowArchivedVendors] = useState(false);
  const archivedVendors = useMemo(() => vendors.filter(isArchivedParty).length, [vendors]);
  const filteredVendors = useMemo(() => {
    return vendors.filter(v => {
      const matchText = `${v.name} ${v.email || ''} ${v.phone || ''} ${v.category || ''} ${(v.tags || []).join(' ')}`.toLowerCase();
      return matchText.includes(searchTerm.toLowerCase()) && hasTag(v, vendorTag) && (showArchivedVendors || !isArchivedParty(v));
    });
  }, [vendors, searchTerm, vendorTag, showArchivedVendors]);

  const handleAddVendor = async (data: Partial<Vendor>) => {
    const created = await addEntity('vendors', data, 'Vendor successfully created');
    if (!created) return false;
    setIsVendorModalOpen(false);
    return true;
  };

  /** Ensures bill dimension labels exist in the workspace, then creates or updates the bill and its attachments. */
  const handleAddBill = async (input: BillDraft) => {
    const { recurringInterval, attachmentFiles, ...rawData } = input;
    let data: typeof rawData;
    try {
      data = await ensureBillDimensionNodes(rawData);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Could not save dimension label.');
      throw err;
    }
    if (data.id) {
      const { id, ...updates } = data;
      await updateEntity('bills', id, updates, 'Bill updated');
    } else {
      const created = await addEntity('bills', data, 'Bill successfully recorded');
      const uid = useAuthStore.getState().user?.uid;
      if (created && uid && attachmentFiles?.length) {
        const { ok, message } = attachSummary(await attachFiles(useAuthStore.getState().currentWorkspaceId || '', uid, { collection: 'bills', id: created.id, label: `Bill ${data.number || ''}`.trim() }, attachmentFiles));
        if (ok) toast.success(message); else toast.error(message);
      }
      if (recurringInterval) await addEntity('recurring', recurringBillSchedule(data, recurringInterval), 'Recurring bill scheduled');
    }
    setIsBillModalOpen(false);
    setEditingBill(undefined);
  };

  const recordExpected = (e: ExpectedBill) => {
    const last = bills.find(b => b.id === e.lastBillId);
    const { id: _id, number: _number, date: _date, dueDate: _due, status: _status, amountPaidCents: _paid, settledByRecordsCents: _settled,
      createdAt: _created, updatedAt: _updated, metadata: _metadata, ...copy } = (last || {}) as Bill;
    setEditingBill({ ...copy, vendorId: e.vendorId, vendorName: e.vendorName });
    setIsBillModalOpen(true);
  };
  const stopExpecting = (e: ExpectedBill) =>
    updateEntity('vendors', e.vendorId, { billsExpected: false }, `Bills from ${e.vendorName} are no longer expected`);

  const currentUser = useAuthStore(s => s.user);
  const submitClaim = async (c: NewClaim) => {
    let payee: { id: string; name: string } | undefined = vendors.find(v => v.name.trim().toLowerCase() === c.payeeName.toLowerCase());
    if (!payee) {
      const created = await addEntity('vendors', { name: c.payeeName, type: 'employee', category: 'Employee', status: 'active' }, `${c.payeeName} added as someone to pay back`);
      if (!created) return;
      payee = { id: created.id, name: c.payeeName };
    }
    await addEntity('bills', claimBill({
      payee, date: c.date, lines: c.lines, note: c.note, currency: homeCurrency, now: new Date().toISOString(),
      submittedBy: currentUser?.uid || '', submittedByName: currentUser?.displayName || currentUser?.email || undefined,
    }), 'Expense claim submitted for approval');
  };
  const decideClaim = (b: Bill, approve: boolean, reason?: string) =>
    updateEntity('bills', b.id, claimDecision(b, approve, currentUser?.uid || '', new Date().toISOString(), reason), approve ? 'Claim approved: it is now a bill to pay' : 'Claim rejected');

  const describeBill = (b: Bill) => `bill ${b.number || ''} from ${b.vendorName || 'this vendor'} (${formatCurrency(b.amountCents || 0, b.currency)})`.replace('bill  from', 'bill from');

  const handleDeleteBill = useCallback(async (b: Bill) => {
    const at = useLedgerStore.getState().bills.findIndex(x => x.id === b.id);
    deleteWithUndo({
      key: `bills/${b.id}`,
      label: `Draft ${describeBill(b)}`,
      hide: () => useLedgerStore.setState(s => ({ bills: s.bills.filter(x => x.id !== b.id) })),
      restore: () => useLedgerStore.setState(s => {
        const rows = s.bills.filter(x => x.id !== b.id);
        rows.splice(at < 0 ? rows.length : Math.min(at, rows.length), 0, b);
        return { bills: rows };
      }),
      commit: () => deleteEntity('bills', b.id),
    });
  }, [deleteEntity]);

  const undoSpread = useCallback((b: Bill) => undoSpreadRequest('bill', b.workspaceId, b.id), []);

  const handleUndoSpread = useCallback(async (b: Bill) => {
    if (safeConfirm(`Undo the spread of ${describeBill(b)}? Its monthly entries are voided and the whole cost is back in the bill's month.`) && await undoSpread(b)) {
      toast.success('Spread undone');
    }
  }, [undoSpread]);

  const handleVoidBill = useCallback(async (b: Bill) => {
    const spread = b.prepaidSchedule ? ' Its spread over months is undone too.' : '';
    if (safeConfirm(`Void ${describeBill(b)}? It stays on record as void and its entries are reversed.${spread}`)) {
      if (b.prepaidSchedule && !(await undoSpread(b))) return;
      await updateEntity('bills', b.id, { status: 'void' }, 'Bill voided');
    }
  }, [undoSpread, updateEntity]);

  const billColumns = useMemo<ColumnDef<Bill, unknown>[]>(() => [
    {
      accessorKey: 'vendorName',
      header: purchasesText('col.vendor', 'Vendor'),
      cell: ({ row }) => (
        <span className="font-semibold text-slate-900 dark:text-white">
          {row.original.vendorName || purchasesText('fallback.unknownVendor', 'Unknown Vendor')}
        </span>
      ),
    },
    {
      accessorKey: 'number',
      header: purchasesText('col.billNumber', 'Bill #'),
      cell: ({ row }) => {
        const b = row.original;
        return (
          <InlineEdit
            value={b.number}
            display={b.number || b.id.slice(0, 8).toUpperCase()}
            label={purchasesText('label.billNumberFrom', 'Number of bill from {vendor}').replace('{vendor}', b.vendorName || purchasesText('fallback.vendor', 'vendor'))}
            canEdit={canEditContacts && b.status !== 'void'}
            onSave={x => updateEntity('bills', b.id, { number: String(x) }, 'Bill number saved')}
            className="text-slate-600 dark:text-slate-400 font-mono text-xs"
          />
        );
      },
    },
    {
      accessorKey: 'date',
      header: purchasesText('col.date', 'Date'),
      cell: ({ row }) => {
        const b = row.original;
        return (
          <InlineEdit
            kind="date"
            value={b.date?.slice(0, 10)}
            label={`Date of bill ${b.number || ''}`.trim()}
            canEdit={canEditContacts && b.status === 'draft'}
            onSave={x => updateEntity('bills', b.id, { date: String(x) }, 'Date saved')}
          />
        );
      },
    },
    {
      accessorKey: 'dueDate',
      header: purchasesText('col.dueDate', 'Due Date'),
      cell: ({ row }) => {
        const b = row.original;
        return (
          <InlineEdit
            kind="date"
            value={b.dueDate?.slice(0, 10)}
            label={`Due date of bill ${b.number || ''}`.trim()}
            canEdit={canEditContacts && b.status !== 'paid' && b.status !== 'void'}
            validate={x => (b.date && String(x) < b.date.slice(0, 10) ? 'The due date is before the bill date' : null)}
            onSave={x => updateEntity('bills', b.id, { dueDate: String(x) }, 'Due date saved')}
          />
        );
      },
    },
    {
      accessorKey: 'status',
      header: purchasesText('col.status', 'Status'),
      cell: ({ row }) => {
        const b = row.original;
        const isOverdue = b.dueDate && new Date(b.dueDate) < new Date() && b.status !== 'paid' && b.status !== 'void';
        return (
          <div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              b.status === 'paid'
                ? 'bg-emerald-100 text-emerald-800'
                : isOverdue
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-amber-100 text-amber-800'
            }`}>
              {b.status === 'paid' ? <CheckCircle size={10} aria-hidden="true" /> : <AlertCircle size={10} aria-hidden="true" />}
              {b.status || purchasesText('status.unpaid', 'Unpaid')}
            </span>
            {b.prepaidSchedule && <div className="mt-1 text-[10px] text-[var(--muted)]">{spreadProgress(b.prepaidSchedule, getLocalDateISO())}</div>}
            <StageChip kind="bill" id={b.id} label={`bill ${b.number || ''}`.trim()} />
            {claimOf(b) && (
              <div className="mt-1 text-[10px] text-[var(--muted)]">
                {purchasesText('label.expenseClaim', 'Expense claim')}{claimOf(b)?.state === 'rejected' ? ` · ${purchasesText('label.rejected', 'rejected')}${claimOf(b)?.reason ? `: ${claimOf(b)?.reason}` : ''}` : ''}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'amountCents',
      header: purchasesText('col.amount', 'Amount'),
      cell: ({ row }) => (
        <span className="block text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
          {formatCurrency(row.original.amountCents || 0)}
        </span>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">{purchasesText('col.actions', 'Actions')}</span>,
      cell: ({ row }) => {
        const b = row.original;
        return (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setPreviewBill(b); }}
              className="p-1 text-[var(--muted)] hover:text-slate-800 rounded-lg"
              title={purchasesText('title.preview', 'Preview / download PDF')}
              aria-label={purchasesText('aria.pdf', 'PDF of bill {n}').replace('{n}', b.number || '').trim()}
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
            </button>
            {b.status !== 'void' && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setEditingBill(b); setIsBillModalOpen(true); }}
                className="p-1 text-[var(--muted)] hover:text-slate-800 rounded-lg"
                title={purchasesText('title.edit', 'Edit bill')}
                aria-label={purchasesText('aria.edit', 'Edit bill {n}').replace('{n}', b.number || '').trim()}
              >
                <Pencil className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            {canEditContacts && b.status !== 'draft' && b.status !== 'void' && (b.prepaidSchedule ? (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); void handleUndoSpread(b); }}
                className="px-2 py-1 text-xs text-[var(--muted)] hover:text-slate-800 rounded-md"
                aria-label={purchasesText('aria.undoSpread', 'Undo the spread of bill {n}').replace('{n}', b.number || '').trim()}
              >
                {purchasesText('action.undoSpread', 'Undo spread')}
              </button>
            ) : (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setSpreadingBill(b); }}
                className="px-2 py-1 text-xs text-indigo-700 dark:text-indigo-300 hover:underline rounded-md"
                title={purchasesText('title.spread', 'A prepaid expense: spread the cost over the months it covers')}
                aria-label={purchasesText('aria.spread', 'Spread bill {n} over months').replace('{n}', b.number || '').replace('  ', ' ')}
              >
                {purchasesText('action.spread', 'Spread')}
              </button>
            ))}
            {b.status !== 'paid' && b.status !== 'void' && (
              <>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setPaymentDocumentId(b.id);
                    setPaymentContactId(b.vendorId || '');
                    setIsPaymentModalOpen(true);
                  }}
                  className="px-2 py-1 text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-semibold rounded-md flex items-center gap-1 shadow-xs transition-colors"
                >
                  <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
                  {purchasesText('action.pay', 'Pay')}
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    inBackground(handleVoidBill(b));
                  }}
                  className="px-2 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 font-semibold rounded-md flex items-center gap-1 shadow-xs transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                  {purchasesText('action.void', 'Void')}
                </button>
              </>
            )}
            {b.status === 'draft' && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  inBackground(handleDeleteBill(b));
                }}
                className="text-rose-500 hover:text-rose-700 p-1 rounded-lg"
                title={purchasesText('title.deleteDraft', 'Delete draft')}
                aria-label={purchasesText('aria.deleteDraft', 'Delete draft bill {n}').replace('{n}', b.number || '').trim()}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      },
    },
  ], [purchasesText, canEditContacts, updateEntity, handleUndoSpread, handleVoidBill, handleDeleteBill]);

  const vendorColumns = useMemo<ColumnDef<Vendor, unknown>[]>(() => {
    const base: ColumnDef<Vendor, unknown>[] = [
      {
        accessorKey: 'name',
        header: purchasesText('col.vendorName', 'Vendor Name'),
        cell: ({ row }) => {
          const v = row.original;
          return (
            <div>
              <InlineEdit
                value={v.name}
                label={`${purchasesText('label.nameOf', 'Name of')} ${v.name}`}
                canEdit={canEditContacts}
                validate={x => (String(x) ? null : 'A vendor needs a name')}
                onSave={x => updateEntity('vendors', v.id, { name: x }, 'Name saved')}
                className="font-semibold text-slate-900 dark:text-white"
              />
              <ArchivedBadge party={v} />
              <PartyDetailButton id={detailOpenerId(v.id)} side="vendor" name={v.name} onOpen={() => setSelectedVendorId(v.id)} />
            </div>
          );
        },
      },
      {
        accessorKey: 'category',
        header: purchasesText('col.category', 'Category'),
        cell: ({ row }) => {
          const v = row.original;
          return (
            <InlineEdit
              value={v.category}
              label={`${purchasesText('label.categoryOf', 'Category of')} ${v.name}`}
              placeholder={purchasesText('fallback.standard', 'Standard')}
              canEdit={canEditContacts}
              suggestions={vendorCategories}
              onSave={x => updateEntity('vendors', v.id, { category: x }, 'Category saved')}
            />
          );
        },
      },
      {
        accessorKey: 'email',
        header: purchasesText('col.email', 'Email'),
        cell: ({ row }) => {
          const v = row.original;
          return (
            <InlineEdit
              kind="email"
              value={v.email}
              label={`${purchasesText('label.emailOf', 'Email of')} ${v.name}`}
              placeholder={purchasesText('placeholder.email', 'Add email')}
              canEdit={canEditContacts}
              onSave={x => updateEntity('vendors', v.id, { email: x }, 'Email saved')}
            />
          );
        },
      },
      {
        accessorKey: 'phone',
        header: purchasesText('col.phone', 'Phone'),
        cell: ({ row }) => {
          const v = row.original;
          return (
            <InlineEdit
              kind="tel"
              value={v.phone}
              label={`${purchasesText('label.phoneOf', 'Phone of')} ${v.name}`}
              placeholder={purchasesText('placeholder.phone', 'Add phone')}
              canEdit={canEditContacts}
              onSave={x => updateEntity('vendors', v.id, { phone: x }, 'Phone saved')}
            />
          );
        },
      },
      {
        accessorKey: 'balanceCents',
        header: purchasesText('col.outstanding', 'Outstanding balance'),
        cell: ({ row }) => (
          <span className="block text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
            {formatCurrency(row.original.balanceCents || 0)}
          </span>
        ),
      },
    ];
    const actionsCol: ColumnDef<Vendor, unknown> = {
      id: 'actions',
      enableSorting: false,
      header: () => <span className="sr-only">{purchasesText('col.actions', 'Actions')}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <PartyRowActions side="vendor" party={row.original} />
        </div>
      ),
    };
    return canEditContacts ? [...base, actionsCol] : base;
  }, [purchasesText, canEditContacts, detailOpenerId, vendorCategories, updateEntity]);

  if (selectedVendorId) {
    return (
      <VendorDetailView
        vendorId={selectedVendorId}
        onBack={() => setSelectedVendorId(null)}
      />
    );
  }

  return (
    <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8">
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what={purchasesText('what.screen', 'this screen')} />
      <PageHeader
        icon={<ShoppingBag className="w-6 h-6 text-emerald-500" aria-hidden="true" />}
        title={purchasesText('page.title', 'Purchases & AP')}
        description={purchasesText('page.description', 'Bills from vendors, the vendors themselves and what you owe them.')}
      >
        {activeSubTab === 'bills' && canEditContacts && (
          <button
            type="button"
            onClick={() => setPaymentRunOpen(true)}
            title={purchasesText('title.payRun', 'Pay every bill due by a date and download the bank file')}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-lg flex items-center gap-2 text-sm shadow-sm transition-colors border border-slate-200 dark:border-slate-800"
          >
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            {purchasesText('action.paymentRun', 'Payment run')}
          </button>
        )}
        {activeSubTab === 'bills' && canEditContacts && (
          <button
            type="button"
            onClick={() => setOpeningOpen(true)}
            title={purchasesText('title.openBills', 'The bills still unpaid when you started: paste them from a spreadsheet')}
            className="px-3 py-2 text-slate-500 dark:text-slate-400 text-sm font-semibold hover:underline"
          >
            {purchasesText('action.openingBills', 'Opening bills')}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (activeSubTab === 'bills') {
              setEditingBill(undefined);
              setIsBillModalOpen(true);
            } else {
              setIsVendorModalOpen(true);
            }
          }}
          className="px-4 py-2 bg-[#018669] hover:bg-emerald-700 text-white font-semibold rounded-lg flex items-center gap-2 text-sm shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {activeSubTab === 'bills' ? purchasesText('action.recordBill', 'Record Bill') : purchasesText('action.addVendor', 'Add Vendor')}
        </button>
      </PageHeader>

      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-6">
        <button
          type="button"
          onClick={() => { setActiveSubTab('bills'); setSearchTerm(''); }}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeSubTab === 'bills'
              ? 'border-emerald-500 text-[#02806d] dark:text-emerald-400'
              : 'border-transparent text-[var(--muted)] dark:text-slate-400 hover:text-slate-700'
          }`}
        >
          {purchasesText('tab.bills', 'Bills')} ({bills.length})
        </button>
        <button
          type="button"
          onClick={() => { setActiveSubTab('vendors'); setSearchTerm(''); }}
          className={`pb-3 text-sm font-bold border-b-2 transition-all ${
            activeSubTab === 'vendors'
              ? 'border-emerald-500 text-[#02806d] dark:text-emerald-400'
              : 'border-transparent text-[var(--muted)] dark:text-slate-400 hover:text-slate-700'
          }`}
        >
          {purchasesText('tab.vendors', 'Vendors')} ({vendors.length})
        </button>
      </div>

      {activeSubTab === 'bills' && (
        <>
          <ExpectedBills bills={bills} vendors={vendors} schedules={schedules} canEdit={canEditContacts} onRecord={recordExpected} onDismiss={stopExpecting} />
          <ExpenseClaims bills={bills} vendors={vendors} accounts={accounts} userRole={currentRole} uid={currentUser?.uid || ''} currency={homeCurrency}
            onSubmit={submitClaim} onDecide={decideClaim} />
        </>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 sm:p-4 overflow-hidden">
        {activeSubTab === 'bills' ? (
          <TanStackDataGrid
            caption={purchasesText('tab.bills', 'Bills')}
            data={visibleBills}
            columns={billColumns}
            totalCount={bills.length}
            loading={loading}
            loadingWhat="bills"
            loadingState={<LoadingState what={purchasesText('what.bills', 'bills')} />}
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            manualFilter
            searchPlaceholder="Search bills..."
            pageSize={billLimit}
            hidePaginationOnSinglePage
            columnScope="purchase-bills"
            columnLabel="Bills"
            columnNames={['Selection', 'Vendor', 'Bill #', 'Date', 'Due Date', 'Status', 'Amount', 'Actions']}
            selectable
            selectedIds={pickedBills}
            onSelectionChange={setPickedBills}
            selectAllLabel={purchasesText('aria.selectAll', 'Select all bills shown')}
            selectRowLabel={b => purchasesText('aria.selectBill', 'Select bill {n}').replace('{n}', b.number || '').trim()}
            bulkActions={pdfWorkspaceId ? (
              <DocumentBulkBar
                type="bill"
                noun="bill"
                ids={[...pickedBills].filter(id => filteredBills.some(b => b.id === id))}
                documents={filteredBills.filter(b => pickedBills.has(b.id))}
                workspaceId={pdfWorkspaceId}
                onClear={() => setPickedBills(new Set())}
              />
            ) : undefined}
            exportConfig={{
              filename: 'bills_export.csv',
              label: purchasesText('action.exportCsv', 'Export CSV'),
              headers: ['Vendor Name', 'Bill Number', 'Date', 'Due Date', 'Status', 'Amount', 'Currency'],
              mapRow: b => [b.vendorName || 'Unknown Vendor', b.number || b.id, b.date || '', b.dueDate || '', b.status || 'unpaid', csvMoney(b.amountCents || 0), b.currency || ''],
            }}
            mobileLayout="table"
            getRowProps={b => ({
              id: recordElementId('bill', b.id),
              'aria-current': focusedBillId === b.id ? 'true' : undefined,
              className: focusedBillId === b.id ? 'ring-2 ring-inset ring-[var(--brass)]' : undefined,
            })}
            footerContent={<DocumentTotalsFoot docs={filteredBills} homeCurrency={homeCurrency} colSpan={8} noun="bill" />}
            afterTable={filteredBills.length > visibleBills.length ? (
              <div className="p-4 text-center">
                <button
                  type="button"
                  onClick={() => setBillLimit(n => n + 200)}
                  className="min-h-11 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                >
                  {purchasesText('list.showMore', 'Show more bills')} ({visibleBills.length} {purchasesText('list.of', 'of')} {filteredBills.length})
                </button>
              </div>
            ) : undefined}
            emptyState={(
              <EmptyState
                title={purchasesText('empty.noBills', 'No bills yet')}
                description={purchasesText('empty.noBillsHint', 'Record your first bill to track what the business owes.')}
                actionLabel={purchasesText('action.recordFirstBill', 'Record first bill')}
                onAction={() => setIsBillModalOpen(true)}
              />
            )}
            filteredEmptyState={(
              <EmptyState
                title={purchasesText('empty.noBillMatch', 'No bills match your search')}
                description={purchasesText('empty.noBillMatchHint', 'Try another vendor, number, or clear the search.')}
                actionLabel={purchasesText('action.clearSearch', 'Clear search')}
                onAction={() => setSearchTerm('')}
              />
            )}
          />
        ) : (
          <div className="space-y-3">
            {vendors.length > 0 && (
              <div className="space-y-2">
                <TagFilter tags={vendorTags} value={vendorTag} onChange={setVendorTag} label={purchasesText('label.vendorTag', 'Show vendors with the tag')} />
                <ShowArchivedToggle count={archivedVendors} on={showArchivedVendors} onChange={setShowArchivedVendors} noun="vendor" />
              </div>
            )}
            {canEditContacts && (
              <InlineAdd
                label={purchasesText('label.newVendor', 'New vendor name')}
                placeholder={purchasesText('placeholder.newVendor', 'Add a vendor: type a name and press Enter')}
                existing={vendors.map(v => v.name)}
                onAdd={name => addEntity('vendors', { name }, `Vendor "${name}" added`)}
              />
            )}
            <TanStackDataGrid
              caption={purchasesText('tab.vendors', 'Vendors')}
              data={filteredVendors}
              columns={vendorColumns}
              totalCount={vendors.length}
              loading={loading}
              loadingWhat="vendors"
              loadingState={<LoadingState what={purchasesText('what.vendors', 'vendors')} />}
              searchValue={searchTerm}
              onSearchChange={setSearchTerm}
              manualFilter
              searchPlaceholder="Search vendors..."
              pageSize={50}
              hidePaginationOnSinglePage
              columnScope="purchase-vendors"
              columnLabel="Vendors"
              columnNames={['Vendor Name', 'Category', 'Email', 'Phone', 'Outstanding balance', ...(canEditContacts ? ['Actions'] : [])]}
              mobileLayout="cards"
              renderCard={v => (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <InlineEdit
                        value={v.name}
                        label={`${purchasesText('label.nameOf', 'Name of')} ${v.name}`}
                        canEdit={canEditContacts}
                        validate={x => (String(x) ? null : 'A vendor needs a name')}
                        onSave={x => updateEntity('vendors', v.id, { name: x }, 'Name saved')}
                        className="font-semibold text-slate-900 dark:text-white"
                      />
                      <ArchivedBadge party={v} />
                      <p className="text-xs text-[var(--muted)] truncate">{v.email || v.phone || v.category || purchasesText('fallback.standard', 'Standard')}</p>
                    </div>
                    <span className="font-mono font-bold text-sm tabular-nums text-slate-900 dark:text-white shrink-0">
                      {formatCurrency(v.balanceCents || 0)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--line)]">
                    <PartyDetailButton id={detailOpenerId(v.id)} side="vendor" name={v.name} onOpen={() => setSelectedVendorId(v.id)} />
                    {canEditContacts && <PartyRowActions side="vendor" party={v} />}
                  </div>
                </div>
              )}
              emptyState={(
                <EmptyState
                  title={purchasesText('empty.noVendors', 'No vendors yet')}
                  description={purchasesText('empty.noVendorsHint', 'Add a vendor before recording their first bill.')}
                  actionLabel={purchasesText('action.addFirstVendor', 'Add first vendor')}
                  onAction={() => setIsVendorModalOpen(true)}
                />
              )}
              filteredEmptyState={(
                <EmptyState
                  title={purchasesText('empty.noVendorMatch', 'No vendors match your search')}
                  description={purchasesText('empty.noVendorMatchHint', 'Try another name or clear the search.')}
                  actionLabel={purchasesText('action.clearSearch', 'Clear search')}
                  onAction={() => setSearchTerm('')}
                />
              )}
            />
          </div>
        )}
      </div>

      {isBillModalOpen && (
        <BillModal
          key={editingBill?.id || 'new'}
          isOpen={isBillModalOpen}
          onClose={() => { setIsBillModalOpen(false); setEditingBill(undefined); }}
          onSave={handleAddBill}
          vendors={vendors}
          accounts={accounts}
          initialBill={editingBill}
        />
      )}

      <VendorModal
        isOpen={isVendorModalOpen}
        onClose={() => setIsVendorModalOpen(false)}
        onSave={handleAddVendor}
      />

      {spreadingBill && <SpreadBillDialog bill={spreadingBill} onClose={() => setSpreadingBill(null)} />}
      {paymentRunOpen && <PaymentRunDialog bills={bills} vendors={vendors} onClose={() => setPaymentRunOpen(false)} />}
      {openingOpen && <OpeningDocumentsDialog side="vendor" onClose={() => setOpeningOpen(false)} />}
      {isPaymentModalOpen && paymentDocumentId && paymentContactId && (
        <ReceivePaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          defaultDirection="made"
          defaultDocumentId={paymentDocumentId}
          defaultContactId={paymentContactId}
        />
      )}
      {previewBill && pdfWorkspaceId && (
        <PdfPreviewModal isOpen onClose={() => setPreviewBill(null)} title={`${purchasesText('title.bill', 'Bill')} ${previewBill.number || previewBill.id}`}
          documentType="bill" documentId={previewBill.id} workspaceId={pdfWorkspaceId} filename={`bill_${previewBill.number || previewBill.id}.pdf`} />
      )}
    </div>
  );
}
