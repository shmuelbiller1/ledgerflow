import { takeCopyMark } from './copyMarkService';
import type { TaxProfiles } from '../../lib/tax/profile';
import crypto from 'crypto';
import type { DocumentData, Firestore } from '../db/firestore';
import { calculateAmountDue } from '../../lib/documentMath';
import { dayNumber } from '../../lib/fiscalCalendar';
import { workspaceRole } from '../../lib/periodLock';
import { formatMoney as formatCurrency } from '../../lib/moneyFormat';
import { formatTzDate } from '../../lib/calendarDate';
import { renderEmail, resolveTemplate } from '../../lib/emailTemplates';
import type { EmailTemplateKey, EmailTemplates, TemplateValues } from '../../lib/emailTemplates';
import { isMailConfigured, sendMail } from './mailer';
import { notify } from './notificationService';
import { generateDocumentPdf } from './pdfService';
import { contactTerms, documentLanguage } from '../../lib/documentLanguage';
import { loadStatement, StatementScopeError } from './statementService';
import { isArchivedParty } from '../../lib/contacts';
import { againstPreference, sendsByEmail } from '../../lib/delivery';
import { approvalDecision, approvalStatus, holdsSending, isApproverRole } from '../../lib/invoiceApproval';

/**
 * Emailing an invoice or a payment reminder to the customer (S-01, BE-01, BL-03, BL-05, K-08).
 * - owner/accountant/bookkeeper; the invoice must be issued (a draft isn't in the books yet);
 * - addresses that bounced or complained are skipped (suppression list, BL-03);
 * - text from the workspace's templates (or the defaults), HTML + plain text, PDF attached;
 * - every attempt is logged in emailEvents (send log per document, BL-05), and the provider's
 *   bounce/complaint reports are added to the same log (emailWebhookRoutes.ts);
 * - a contact who asked for paper instead of email (Y-27) is still emailed when a person presses
 *   Email, but the log says so (againstPreference) — only sends that happen by themselves skip them.
 *   A scheduled send (input.system) is never against their wish: the job doesn't email them at all.
 * - an invoice over the workspace's approval limit (BE-04, src/lib/invoiceApproval.ts) waits for a
 *   signature from an owner or an accountant, and for those two sending one *is* the signature: the
 *   invoice is approved as it goes out. The daily reminder job asks nobody to wait — an invoice still
 *   held back is filtered out before a reminder is considered (reminderService.ts).
 */

export class EmailSendError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}

const WRITER_ROLES = ['owner', 'accountant', 'bookkeeper'];
const NOT_ISSUED = new Set(['draft', 'void', 'cancelled', 'rejected']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function isSuppressed(db: Firestore, address: string): Promise<boolean> {
  const snap = await db.collection('emailEvents')
    .where('recipient', '==', address.trim().toLowerCase())
    .where('event', 'in', ['bounced', 'complaint'])
    .limit(1)
    .get();
  return !snap.empty;
}

export async function logEmailEvent(db: Firestore, event: DocumentData) {
  const ref = db.collection('emailEvents').doc();
  await ref.set({ id: ref.id, ...event, recipient: String(event.recipient || '').toLowerCase(), timestamp: new Date().toISOString() });
  return ref.id;
}

export interface EmailInvoiceInput {
  workspaceId: string;
  uid: string;
  invoiceId: string;
  template: Extract<EmailTemplateKey, 'invoice' | 'reminder'>;
  baseUrl: string;
  to?: string;
  subject?: string;
  body?: string;
  /** Scheduled reminders: no role check (the workspace's own schedule). */
  system?: boolean;
}

export async function emailInvoice(db: Firestore, input: EmailInvoiceInput) {
  const workspace = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!workspace) throw new EmailSendError(404, 'Workspace not found');
  if (!input.system && !WRITER_ROLES.includes(workspaceRole(workspace, input.uid))) throw new EmailSendError(403, 'Viewers cannot send emails');

  const invoiceRef = db.collection('invoices').doc(input.invoiceId);
  const invoice = (await invoiceRef.get()).data();
  if (!invoice || invoice.workspaceId !== input.workspaceId) throw new EmailSendError(404, 'Invoice not found');
  if (NOT_ISSUED.has(String(invoice.status))) {
    throw new EmailSendError(409, invoice.status === 'draft' ? 'Save the invoice as final (not a draft) before sending it' : `The invoice is ${invoice.status}`);
  }

  const customer = invoice.customerId ? (await db.collection('customers').doc(String(invoice.customerId)).get()).data() : undefined;
  const to = String(input.to || customer?.email || '').trim().toLowerCase();
  if (!EMAIL.test(to)) throw new EmailSendError(400, 'The customer has no valid email address');
  if (await isSuppressed(db, to)) throw new EmailSendError(409, `${to} bounced or reported an earlier email as spam; update the customer's email address`);
  if (!isMailConfigured()) throw new EmailSendError(503, 'Email sending is not set up yet (add an email provider key in the settings)');

  // BE-04: over the approval limit, a person who cannot sign gets refused; a person who can signs.
  const settings = workspace.invoiceApproval;
  const held = holdsSending(invoice, settings);
  const approver = isApproverRole(workspaceRole(workspace, input.uid));
  if (held && !input.system) {
    if (!approver) {
      throw new EmailSendError(409, approvalStatus(invoice, settings) === 'rejected'
        ? 'An owner or an accountant sent this invoice back — fix what they wrote before it goes to the customer'
        : 'This invoice is over the approval limit: an owner or an accountant must approve it first (Settings → Emails & Reminders)');
    }
  }

  let token = typeof invoice.paymentToken === 'string' ? invoice.paymentToken : '';
  if (!token) token = `pay_${crypto.randomBytes(32).toString('hex')}`;

  const currency = String(invoice.currency || workspace.currency || 'USD');
  const today = formatTzDate(new Date(), typeof workspace.timezone === 'string' ? workspace.timezone : 'UTC');
  const due = typeof invoice.dueDate === 'string' ? invoice.dueDate.slice(0, 10) : '';
  const values: TemplateValues = {
    company: String(workspace.name || ''),
    customer: String(invoice.customerName || customer?.name || ''),
    number: String(invoice.number || input.invoiceId),
    amount: formatCurrency(Number(invoice.amountCents) || 0, currency),
    amount_due: formatCurrency(calculateAmountDue(invoice), currency),
    due_date: due,
    days_overdue: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? String(Math.max(0, dayNumber(today) - dayNumber(due))) : '0',
    link: `${input.baseUrl.replace(/\/+$/, '')}/i/${token}`,
  };
  const template = resolveTemplate(input.template, workspace.emailTemplates as EmailTemplates | undefined);
  const message = renderEmail({ subject: input.subject?.trim() || template.subject, body: input.body?.trim() || template.body }, values);

  let attachments;
  try {
    const copyMark = await takeCopyMark(db, 'invoice', input.invoiceId, workspace as { taxProfiles?: TaxProfiles });
    const pdf = await generateDocumentPdf('invoice', { ...invoice, id: input.invoiceId }, workspace, { paymentUrl: values.link, language: documentLanguage(workspace.branding, customer), terms: contactTerms(customer), ...(copyMark ? { copyMark } : {}) });
    attachments = [{ filename: `invoice_${values.number}.pdf`, content: pdf, contentType: 'application/pdf' }];
  } catch {
    attachments = undefined;
  }

  const paper = againstPreference(customer);
  const logBase = { workspaceId: input.workspaceId, documentType: 'invoice', documentId: input.invoiceId, invoiceId: input.invoiceId, template: input.template, subject: message.subject, recipient: to, sentBy: input.system ? 'schedule' : input.uid, ...(paper ? { againstPreference: paper } : {}) };
  let result;
  try {
    result = await sendMail({ to, subject: message.subject, html: message.html, text: message.text, attachments });
  } catch (err) {
    await logEmailEvent(db, { ...logBase, event: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    throw new EmailSendError(502, `The email could not be sent: ${err instanceof Error ? err.message : String(err)}`);
  }
  await logEmailEvent(db, { ...logBase, event: 'sent', provider: result.provider, messageId: result.messageId || null });

  const now = new Date().toISOString();
  const metadata = { ...(invoice.metadata || {}), lastSentAt: now, sentTo: to, sendCount: (Number(invoice.metadata?.sendCount) || 0) + 1 };
  if (input.template === 'reminder') {
    metadata.lastReminderAt = now;
    metadata.remindersSent = (Number(invoice.metadata?.remindersSent) || 0) + 1;
  }
  await invoiceRef.update({
    paymentToken: token,
    // pending/approved → sent (all are issued, already in the books); other statuses stay
    ...(invoice.status === 'pending' || invoice.status === 'approved' ? { status: 'sent' } : {}),
    // an approver sending a held invoice signs it off on the spot (BE-04)
    ...(held && approver && !input.system
      ? { approval: approvalDecision(settings, 'approved', { uid: input.uid, now }) }
      : {}),
    metadata,
    updatedAt: now,
  });
  if (input.template === 'invoice') {
    await notify(db, {
      workspaceId: input.workspaceId, workspace, kind: 'invoice.sent',
      title: `Invoice ${values.number} emailed`,
      message: `Sent to ${to} (${values.customer || 'customer'}, ${values.amount_due} due).`,
      eventKey: `invoice.sent:${input.invoiceId}:${now}`, recordId: input.invoiceId,
      actorUid: input.system ? undefined : input.uid,
    });
  }
  return { to, subject: message.subject, provider: result.provider, messageId: result.messageId || null, invoiceUrl: values.link };
}

/**
 * Thank-you email after a payment (BE-02): when the workspace turned it on (Settings → Emails &
 * Reminders), the customer gets the "Payment received (thank you)" template for each invoice the
 * payment settled part of. Best effort: never throws, so a payment is never held up by an email;
 * every send or failure is in the invoice's send log. Returns what happened per invoice.
 */
export async function thankForPayment(db: Firestore, input: { workspaceId: string; allocations: Array<{ documentId: string; documentType: string; amountCents: number }> }): Promise<Array<{ invoiceId: string; result: string }>> {
  const out: Array<{ invoiceId: string; result: string }> = [];
  const invoices = (input.allocations || []).filter(a => a.documentType === 'invoice' && a.amountCents > 0);
  if (invoices.length === 0) return out;
  const workspace = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!workspace?.reminderSettings?.thankYou) return invoices.map(a => ({ invoiceId: a.documentId, result: 'off' }));
  for (const allocation of invoices) {
    let result: string;
    try {
      result = await sendReceipt(db, workspace, input.workspaceId, allocation.documentId, allocation.amountCents);
    } catch (err) {
      result = 'failed';
      await logEmailEvent(db, { workspaceId: input.workspaceId, documentType: 'invoice', documentId: allocation.documentId, invoiceId: allocation.documentId, template: 'receipt', event: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err), sentBy: 'payment' }).catch(() => undefined);
    }
    out.push({ invoiceId: allocation.documentId, result });
  }
  return out;
}

async function sendReceipt(db: Firestore, workspace: DocumentData, workspaceId: string, invoiceId: string, amountCents: number): Promise<string> {
  const invoice = (await db.collection('invoices').doc(invoiceId).get()).data();
  if (!invoice || invoice.workspaceId !== workspaceId) return 'no invoice';
  const customer = invoice.customerId ? (await db.collection('customers').doc(String(invoice.customerId)).get()).data() : undefined;
  const to = String(customer?.email || '').trim().toLowerCase();
  if (!EMAIL.test(to)) return 'no email';
  if (await isSuppressed(db, to)) return 'suppressed';
  if (!isMailConfigured()) return 'mail not set up';
  const currency = String(invoice.currency || workspace.currency || 'USD');
  const values: TemplateValues = {
    company: String(workspace.name || ''),
    customer: String(invoice.customerName || customer?.name || ''),
    number: String(invoice.number || invoiceId),
    amount: formatCurrency(amountCents, currency),
    amount_due: formatCurrency(calculateAmountDue(invoice), currency),
  };
  const message = renderEmail(resolveTemplate('receipt', workspace.emailTemplates as EmailTemplates | undefined), values);
  const sent = await sendMail({ to, subject: message.subject, html: message.html, text: message.text });
  await logEmailEvent(db, { workspaceId, documentType: 'invoice', documentId: invoiceId, invoiceId, template: 'receipt', subject: message.subject, recipient: to, sentBy: 'payment', event: 'sent', provider: sent.provider, messageId: sent.messageId || null });
  return 'sent';
}

/** The send log of a document (newest first): sends, failures, bounces, complaints. */
export async function emailLog(db: Firestore, workspaceId: string, documentId: string) {
  const snap = await db.collection('emailEvents').where('workspaceId', '==', workspaceId).where('documentId', '==', documentId).limit(200).get();
  return snap.docs
    .map(d => d.data())
    .map(e => ({ event: e.event, recipient: e.recipient, subject: e.subject || null, template: e.template || null, provider: e.provider || null, error: e.error || null, againstPreference: e.againstPreference || null, timestamp: e.timestamp }))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

export interface StatementBatchResult {
  sent: Array<{ id: string; name: string; to: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  failed: Array<{ id: string; name: string; message: string }>;
}

/**
 * Email statements (BE-07): each chosen customer (or every active customer) gets their statement
 * PDF with the "statement" email. Customers with nothing open, without an email address, archived
 * or bounced are skipped with the reason; one failure doesn't stop the rest. Writers only.
 */
export async function emailStatements(db: Firestore, input: { workspaceId: string; uid: string; customerIds?: string[]; system?: boolean; startDate?: string; endDate?: string }): Promise<StatementBatchResult> {
  const workspace = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!workspace) throw new EmailSendError(404, 'Workspace not found');
  if (!input.system && !WRITER_ROLES.includes(workspaceRole(workspace, input.uid))) throw new EmailSendError(403, 'Viewers cannot send emails');
  if (!isMailConfigured()) throw new EmailSendError(503, 'Email sending is not set up yet (add an email provider key in the settings)');

  const ids = input.customerIds?.length
    ? input.customerIds
    : (await db.collection('customers').where('workspaceId', '==', input.workspaceId).get()).docs
      // archived customers, those who asked for no statements (Y-28) and those who get paper (Y-27)
      // are left out unless chosen by hand
      .filter(d => !isArchivedParty(d.data() as { status?: string }) && !d.data().noStatements && sendsByEmail(d.data())).map(d => d.id);
  const result: StatementBatchResult = { sent: [], skipped: [], failed: [] };
  const template = resolveTemplate('statement', workspace.emailTemplates as EmailTemplates | undefined);
  for (const id of ids) {
    const statement = await loadStatement(db, input.workspaceId, id, { startDate: input.startDate, endDate: input.endDate }).catch(err => {
      if (err instanceof StatementScopeError) throw new EmailSendError(400, err.message);
      throw err;
    });
    if (!statement || statement.contactType !== 'customer') { result.skipped.push({ id, name: id, reason: 'not a customer here' }); continue; }
    const name = String(statement.contact.name || id);
    const to = String(statement.contact.email || '').trim().toLowerCase();
    const currency = String(statement.contact.currency || workspace.currency || 'USD');
    if (statement.endingBalanceCents <= 0) { result.skipped.push({ id, name, reason: 'nothing is open' }); continue; }
    if (!EMAIL.test(to)) { result.skipped.push({ id, name, reason: 'no email address' }); continue; }
    if (await isSuppressed(db, to)) { result.skipped.push({ id, name, reason: `${to} bounced or reported spam` }); continue; }
    const balance = formatCurrency(statement.endingBalanceCents, currency);
    const message = renderEmail(template, { company: String(workspace.name || ''), customer: name, amount: balance, amount_due: balance, number: statement.pdf.number });
    const paper = againstPreference(statement.contact);
    const logBase = { workspaceId: input.workspaceId, documentType: 'statement', documentId: id, template: 'statement', subject: message.subject, recipient: to, sentBy: input.system ? 'schedule' : input.uid, ...(paper ? { againstPreference: paper } : {}) };
    try {
      const pdf = await generateDocumentPdf('statement', statement.pdf, workspace, { language: documentLanguage(workspace.branding, statement.contact), terms: contactTerms(statement.contact) });
      const sent = await sendMail({ to, subject: message.subject, html: message.html, text: message.text, attachments: [{ filename: `statement_${name.replace(/[^\w.-]+/g, '_')}.pdf`, content: pdf, contentType: 'application/pdf' }] });
      await logEmailEvent(db, { ...logBase, event: 'sent', provider: sent.provider, messageId: sent.messageId || null });
      result.sent.push({ id, name, to });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logEmailEvent(db, { ...logBase, event: 'failed', error: msg.slice(0, 300) });
      result.failed.push({ id, name, message: msg });
    }
  }
  return result;
}

/**
 * Remittance advice (K-25): after paying a vendor, email them what was paid and for which bills,
 * when the person paying asked for it. Best effort: returns what happened, never undoes the payment.
 */
export async function emailRemittance(db: Firestore, payment: DocumentData): Promise<string> {
  if (payment.direction !== 'made' || !payment.workspaceId || !payment.contactId) return 'not a vendor payment';
  const workspace = (await db.collection('workspaces').doc(String(payment.workspaceId)).get()).data();
  if (!workspace) return 'no workspace';
  const vendor = (await db.collection('vendors').doc(String(payment.contactId)).get()).data();
  if (!vendor || vendor.workspaceId !== payment.workspaceId) return 'no vendor';
  const to = String(vendor.email || '').trim().toLowerCase();
  if (!EMAIL.test(to)) return 'no email';
  if (await isSuppressed(db, to)) return 'suppressed';
  if (!isMailConfigured()) return 'mail not set up';
  const allocations = (Array.isArray(payment.allocations) ? payment.allocations : []) as Array<{ documentId: string; documentType: string; amountCents: number }>;
  const labels: string[] = [];
  for (const a of allocations.filter(x => x.documentType === 'bill')) {
    const bill = (await db.collection('bills').doc(a.documentId).get()).data();
    labels.push(`${bill?.number || 'bill'} (${formatCurrency(a.amountCents, String(bill?.currency || workspace.currency || 'USD'))})`);
  }
  const currency = String(payment.currency || workspace.currency || 'USD');
  const values: TemplateValues = {
    company: String(workspace.name || ''),
    vendor: String(vendor.name || payment.contactName || ''),
    customer: String(vendor.name || payment.contactName || ''),
    amount: formatCurrency(Number(payment.amountCents) || 0, currency),
    payment_date: String(payment.date || payment.paymentDate || '').slice(0, 10),
    paid_bills: labels.join(', ') || 'your invoice',
  };
  const message = renderEmail(resolveTemplate('remittance', workspace.emailTemplates as EmailTemplates | undefined), values);
  const paper = againstPreference(vendor);
  const logBase = { workspaceId: payment.workspaceId, documentType: 'payment', documentId: payment.id || '', template: 'remittance', subject: message.subject, recipient: to, sentBy: 'payment', ...(paper ? { againstPreference: paper } : {}) };
  try {
    const sent = await sendMail({ to, subject: message.subject, html: message.html, text: message.text });
    await logEmailEvent(db, { ...logBase, event: 'sent', provider: sent.provider, messageId: sent.messageId || null });
    return 'sent';
  } catch (err) {
    await logEmailEvent(db, { ...logBase, event: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) }).catch(() => undefined);
    return 'failed';
  }
}
