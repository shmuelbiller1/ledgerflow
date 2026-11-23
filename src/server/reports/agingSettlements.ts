import type { Firestore } from '../db/firestore';
import type { SettlementEvent } from '../../lib/aging';
import { convertMinorUnits } from '../../lib/currencyMinorUnits';

interface LedgerRow { documentId?: unknown; documentType?: unknown; date?: unknown; baseClearedCents?: unknown; kind?: unknown; sourceId?: unknown }
interface PaymentRecord {
  id: string; status?: unknown; paymentDate?: unknown; date?: unknown; voidDate?: unknown; voidedAt?: unknown;
  currency?: unknown; exchangeRate?: unknown;
  allocations?: Array<{ documentId?: unknown; documentType?: unknown; amountCents?: unknown }>;
}

/**
 * RP-01 (aging): every dated settlement event of one document kind, all-time (the aging itself applies the
 * cutoff, and needs the all-time total to spot history no event covers).
 *
 * The `paymentAllocations` ledger only holds settlements recorded since it was introduced. A payment
 * recorded before that has no ledger row, but its record still says what it settled and when, so it is
 * turned into dated events here: each allocation on the payment date (in base cents, at the payment's
 * rate and minor-unit scale), and — when the payment was voided — the same amounts reversed on the void
 * date. A payment that has ledger rows (its id is a row's sourceId) is never counted twice.
 */
export function agingSettlementEvents(
  ledgerRows: LedgerRow[],
  payments: PaymentRecord[],
  documentType: 'invoice' | 'bill',
  baseCurrency: string,
): SettlementEvent[] {
  const events: SettlementEvent[] = [];
  const inLedger = new Set<string>();
  for (const r of ledgerRows) {
    if (typeof r.sourceId === 'string' && r.sourceId) inLedger.add(r.sourceId);
    if (r.documentType !== documentType || typeof r.date !== 'string') continue;
    events.push({
      documentId: String(r.documentId), documentType, date: r.date,
      // baseClearedCents is what the control account cleared (not the cash settlement value)
      amountCents: Number(r.baseClearedCents) || 0,
      ...(r.kind === undefined ? {} : { kind: String(r.kind) }),
    });
  }
  for (const p of payments) {
    if (inLedger.has(p.id)) continue;
    const paidOn = String(p.paymentDate || p.date || '').slice(0, 10);
    if (!paidOn) continue;
    const rate = typeof p.exchangeRate === 'number' && p.exchangeRate > 0 ? p.exchangeRate : 1;
    const currency = typeof p.currency === 'string' && p.currency ? p.currency : baseCurrency;
    const voided = p.status === 'void';
    const voidOn = String(p.voidDate || p.voidedAt || '').slice(0, 10) || paidOn;
    for (const a of Array.isArray(p.allocations) ? p.allocations : []) {
      const cents = Number(a.amountCents) || 0;
      if (a.documentType !== documentType || typeof a.documentId !== 'string' || cents <= 0) continue;
      const base = convertMinorUnits(cents, rate, currency, baseCurrency);
      events.push({ documentId: a.documentId, documentType, date: paidOn, amountCents: base, kind: 'payment' });
      if (voided) events.push({ documentId: a.documentId, documentType, date: voidOn, amountCents: -base, kind: 'reversal' });
    }
  }
  return events;
}

/** Loads the ledger rows and payment records of a workspace and returns its aging settlement events. */
export async function loadAgingSettlements(db: Firestore, workspaceId: string, documentType: 'invoice' | 'bill', baseCurrency: string): Promise<SettlementEvent[]> {
  const [rows, payments] = await Promise.all([
    db.collection('paymentAllocations').where('workspaceId', '==', workspaceId).get(),
    db.collection('payments').where('workspaceId', '==', workspaceId).get(),
  ]);
  return agingSettlementEvents(
    rows.docs.map(d => d.data() as LedgerRow),
    payments.docs.map(d => ({ ...(d.data() as Omit<PaymentRecord, 'id'>), id: d.id })),
    documentType, baseCurrency,
  );
}
