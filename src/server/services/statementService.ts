import type { Firestore } from '../db/firestore';
import type { PdfDocument } from './pdfService';
import type { Bill, CreditNote, Customer, Invoice, Payment, Vendor, VendorCredit } from '../../types';
import { computeStatement } from '../reports/computeReports';
import { formatTzDate } from '../../lib/calendarDate';
import { resolveStatementScope, statementRows, type StatementScope } from '../../lib/statementScope';

export interface LoadedStatement {
  contactType: 'customer' | 'vendor';
  contact: Customer | Vendor;
  endingBalanceCents: number;
  /** the period the statement covers (AUD-01: the same for the screen, the JSON and the PDF) */
  scope: StatementScope;
  /** computeStatement's result: the opening balance, each entry with its running balance, the ending balance */
  statement: ReturnType<typeof computeStatement>;
  pdf: PdfDocument;
}

export interface StatementPeriod { startDate?: unknown; endDate?: unknown }

/** A period that is not real dates, or that starts after it ends (AUD-01: refused, never widened to all history). */
export class StatementScopeError extends Error {}

/**
 * A date from a query string, as given, or undefined when none was given (ISS-141: the PDF follows the screen's
 * period). Anything else — a repeated parameter Express hands over as a list — is passed on to be refused, never
 * read as "no date".
 */
export function statementDate(value: unknown): unknown {
  return value === undefined || value === '' ? undefined : value;
}

/**
 * A customer's or vendor's statement for a period (AUD-01, src/lib/statementScope.ts): the period resolved with
 * today in the workspace's time zone, the contact's documents, payments and credits, the opening balance as the
 * first row. Used by the JSON report, the statement PDF and emailed statements (BE-07). Null when the contact isn't
 * in this workspace (another workspace's contact answers like a missing one), or isn't of the type asked for.
 */
export async function loadStatement(db: Firestore, workspaceId: string, contactId: string, period: StatementPeriod = {}, type?: 'customer' | 'vendor'): Promise<LoadedStatement | null> {
  const [customerSnap, vendorSnap, workspaceSnap] = await Promise.all([
    db.collection('customers').doc(contactId).get(), db.collection('vendors').doc(contactId).get(), db.collection('workspaces').doc(workspaceId).get(),
  ]);
  const workspace = workspaceSnap.data() || {};
  const resolved = resolveStatementScope(period, formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC'));
  if ('error' in resolved) throw new StatementScopeError(resolved.error);
  const { scope } = resolved;
  const customer = customerSnap.data();
  const vendor = vendorSnap.data();
  const contactType = customer?.workspaceId === workspaceId && type !== 'vendor' ? 'customer' : vendor?.workspaceId === workspaceId && type !== 'customer' ? 'vendor' : null;
  if (!contactType) return null;
  const contact = { ...(contactType === 'customer' ? customer : vendor), id: contactId } as Customer | Vendor;
  const rows = async <T>(collection: string, field: string) =>
    (await db.collection(collection).where('workspaceId', '==', workspaceId).where(field, '==', contactId).get()).docs.map(d => ({ id: d.id, ...d.data() }) as T);

  const invoices = contactType === 'customer' ? await rows<Invoice>('invoices', 'customerId') : [];
  const bills = contactType === 'vendor' ? await rows<Bill>('bills', 'vendorId') : [];
  // the statement only reads this contact's payments: no need to load the whole workspace's
  const payments = await rows<Payment>('payments', 'contactId');
  const credits = contactType === 'customer' ? await rows<CreditNote>('creditNotes', 'customerId') : await rows<VendorCredit>('vendorCredits', 'vendorId');
  const stmt = computeStatement(contact, invoices, bills, payments, scope.startDate, scope.endDate, contactType, credits);
  return {
    contactType,
    contact,
    endingBalanceCents: stmt.endingBalanceCents,
    scope,
    statement: stmt,
    pdf: {
      number: `STMT-${contactId.substring(0, 6).toUpperCase()}`,
      // the statement is as of the end of its period
      date: scope.endDate,
      period: scope,
      customerName: stmt.contactName,
      amountCents: stmt.endingBalanceCents,
      transactions: statementRows(stmt).map(row => ({ description: `${row.date} ${row.type}${row.reference ? ` ${row.reference}` : ''}`, amountCents: row.amountCents, balanceCents: row.runningBalanceCents })),
    },
  };
}
