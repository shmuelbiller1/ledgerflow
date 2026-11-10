import { sendMail } from './mailer';

import { BRAND_NAME } from '../../config/brand';
export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendInvoiceEmailParams {
  toEmail: string;
  subject: string;
  invoiceNumber?: string;
  customerName?: string;
  totalFormatted?: string;
  invoiceUrl: string;
  customBody?: string;
  pdfAttachment?: EmailAttachment;
  attachments?: EmailAttachment[];
}

export interface EmailDeliveryResult {
  delivered: boolean;
  provider: 'resend' | 'postmark' | 'sendgrid' | 'smtp' | 'test';
  messageId?: string;
  responseSummary?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface SupportNotificationParams {
  toEmail: string;
  subject: string;
  ticketSubject: string;
  messageBody: string;
}

/**
 * Sends a notification email to the user when a support agent replies to their ticket.
 */
export async function sendSupportNotification(params: SupportNotificationParams): Promise<EmailDeliveryResult> {
  const fromEmail = process.env.EMAIL_FROM || 'support@ledgerflow.app';
  
  const safeTicketSubject = escapeHtml(params.ticketSubject);
  const safeMessageBody = escapeHtml(params.messageBody).replace(/\n/g, '<br/>');

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
      <h2 style="color: #0f172a; margin-top: 0;">Support Update: ${safeTicketSubject}</h2>
      <p>A support agent has replied to your ticket:</p>
      <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 16px; margin: 20px 0; font-style: italic;">
        ${safeMessageBody}
      </div>
      <p>Please log in to the application to view the full thread and reply.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #64748b;">
        This is an automated notification from ${BRAND_NAME} Support.
      </p>
    </div>
  `;


  return sendMail({ from: fromEmail, to: params.toEmail, subject: params.subject, html: htmlContent });
}

/**
 * Executes real email delivery through an externally configured delivery provider (#84, N5).
 * All user-supplied inputs are HTML-escaped to prevent email template injection.
 */
export async function deliverInvoiceEmail(params: SendInvoiceEmailParams): Promise<EmailDeliveryResult> {
  const fromEmail = process.env.EMAIL_FROM || 'invoices@ledgerflow.app';
  
  const safeInvoiceNumber = params.invoiceNumber ? escapeHtml(params.invoiceNumber) : '';
  const safeCustomerName = params.customerName ? escapeHtml(params.customerName) : '';
  const safeCustomBody = params.customBody ? escapeHtml(params.customBody) : '';
  const safeTotalFormatted = params.totalFormatted ? escapeHtml(params.totalFormatted) : '';
  const safeInvoiceUrl = encodeURI(params.invoiceUrl);

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
      <h2 style="color: #0f172a; margin-top: 0;">Invoice ${safeInvoiceNumber}</h2>
      ${safeCustomerName ? `<p>Dear <strong>${safeCustomerName}</strong>,</p>` : ''}
      ${safeCustomBody ? `<p>${safeCustomBody}</p>` : `<p>Your invoice has been generated and is ready for payment.</p>`}
      ${safeTotalFormatted ? `<p style="font-size: 18px; margin: 20px 0;"><strong>Amount Due: ${safeTotalFormatted}</strong></p>` : ''}
      <div style="margin: 32px 0;">
        <a href="${safeInvoiceUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
          View &amp; Pay Invoice
        </a>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #64748b; word-break: break-all;">
        If the button above does not work, copy and paste this link into your browser:<br />
        <a href="${safeInvoiceUrl}" style="color: #2563eb;">${safeInvoiceUrl}</a>
      </p>
    </div>
  `;

  const attachmentsList: EmailAttachment[] = [];
  if (params.pdfAttachment) {
    attachmentsList.push(params.pdfAttachment);
  }
  if (Array.isArray(params.attachments)) {
    attachmentsList.push(...params.attachments);
  }

  return sendMail({ from: fromEmail, to: params.toEmail, subject: params.subject, html: htmlContent, attachments: attachmentsList });
}

export interface ErrorGroupSummary {
  message: string;
  count: number;
  source?: string;
  severity?: string;
  firstSeen: string;
  lastSeen: string;
  sampleStack?: string;
  sampleUrl?: string;
}

export interface ErrorDigestEmailParams {
  toEmail: string;
  subject?: string;
  periodHours: number;
  totalErrors: number;
  uniqueErrors: number;
  groups: ErrorGroupSummary[];
}

/**
 * Sends a daily/periodic error digest email summarizing captured telemetry signatures.
 */
export async function sendErrorDigestEmail(params: ErrorDigestEmailParams): Promise<EmailDeliveryResult> {
  const fromEmail = process.env.EMAIL_FROM || 'alerts@ledgerflow.app';
  const safeSubject = escapeHtml(params.subject || `[${BRAND_NAME}] Error Digest: ${params.totalErrors} error(s) in last ${params.periodHours}h`);

  const groupRowsHtml = params.groups.map(g => {
    const safeMsg = escapeHtml(g.message);
    const safeSev = escapeHtml(g.severity || 'error').toUpperCase();
    const safeSrc = escapeHtml(g.source || 'frontend');
    const safeStack = g.sampleStack 
      ? `<pre style="font-size: 11px; background: #f1f5f9; padding: 8px; border-radius: 4px; overflow-x: auto; color: #475569; max-height: 100px; margin-top: 6px;">${escapeHtml(g.sampleStack.slice(0, 800))}</pre>` 
      : '';
    const sevColor = g.severity === 'fatal' ? '#ef4444' : g.severity === 'warning' ? '#f59e0b' : '#dc2626';

    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px; font-weight: bold; text-align: center; color: #0f172a; font-size: 13px;">${g.count}</td>
        <td style="padding: 10px; text-align: center;"><span style="background-color: ${sevColor}18; color: ${sevColor}; padding: 2px 6px; border-radius: 6px; font-weight: 700; font-size: 10px; text-transform: uppercase;">${safeSev}</span></td>
        <td style="padding: 10px; font-size: 12px; color: #64748b;">${safeSrc}</td>
        <td style="padding: 10px; font-size: 12px; color: #1e293b;">
          <div style="font-weight: 600; margin-bottom: 2px;">${safeMsg}</div>
          <div style="font-size: 10px; color: #94a3b8;">Last seen: ${escapeHtml(g.lastSeen)}</div>
          ${safeStack}
        </td>
      </tr>
    `;
  }).join('');

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
      <h2 style="color: #0f172a; margin-top: 0;">🛡️ ${BRAND_NAME} Telemetry: Error Digest</h2>
      <p style="color: #475569; font-size: 14px;">
        Digest summary for the past <strong>${params.periodHours} hours</strong>:
      </p>
      <div style="display: flex; gap: 16px; margin: 16px 0;">
        <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 12px 20px; border-radius: 8px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #991b1b;">Total Occurrences</div>
          <div style="font-size: 24px; font-weight: 800; color: #b91c1c;">${params.totalErrors}</div>
        </div>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 20px; border-radius: 8px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569;">Unique Signatures</div>
          <div style="font-size: 24px; font-weight: 800; color: #0f172a;">${params.uniqueErrors}</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-top: 20px; text-align: left;">
        <thead>
          <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 11px; text-transform: uppercase; color: #64748b;">
            <th style="padding: 10px; width: 60px; text-align: center;">Count</th>
            <th style="padding: 10px; width: 80px; text-align: center;">Severity</th>
            <th style="padding: 10px; width: 80px;">Source</th>
            <th style="padding: 10px;">Signature &amp; Details</th>
          </tr>
        </thead>
        <tbody>
          ${groupRowsHtml || '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #64748b;">No errors recorded during this period.</td></tr>'}
        </tbody>
      </table>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 11px; color: #94a3b8;">
        This automated notification was generated by ${BRAND_NAME} Telemetry.
      </p>
    </div>
  `;

  return sendMail({ from: fromEmail, to: params.toEmail, subject: safeSubject, html: htmlContent });
}

