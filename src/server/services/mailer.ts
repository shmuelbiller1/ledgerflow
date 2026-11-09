import { safeFetch } from '../utils/safeFetch';

/**
 * The one place that talks to the email provider (Resend, Postmark or SendGrid, whichever key
 * is set). Every email has an HTML and a plain-text part (BL-08), so mail clients that don't
 * show HTML, and spam filters, get readable text. Tests replace the transport.
 */

export interface MailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface MailMessage {
  from?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  /** the same key again within the provider's window is not delivered twice (Resend's Idempotency-Key; AUD-04) */
  idempotencyKey?: string;
}

export interface MailResult {
  delivered: true;
  provider: 'resend' | 'postmark' | 'sendgrid' | 'test';
  messageId?: string;
  responseSummary?: string;
}

type Transport = (message: Required<Pick<MailMessage, 'from' | 'to' | 'subject' | 'html' | 'text'>> & MailMessage) => Promise<MailResult>;

let testTransport: Transport | null = null;

/** Tests only: capture messages instead of calling a provider (null restores the providers). */
export function setMailTransportForTests(transport: Transport | null) {
  testTransport = transport;
}

export function isMailConfigured(): boolean {
  return Boolean(testTransport || process.env.RESEND_API_KEY || process.env.POSTMARK_SERVER_TOKEN || process.env.SENDGRID_API_KEY);
}

/** Plain text from simple HTML (the fallback when a caller gives only HTML). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/li)\s*\/?>/gi, '\n')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const base64 = (content: string | Buffer) => (Buffer.isBuffer(content) ? content.toString('base64') : content);

export async function sendMail(input: MailMessage): Promise<MailResult> {
  const message = { ...input, from: input.from || process.env.EMAIL_FROM || 'no-reply@ledgerflow.app', text: input.text || htmlToText(input.html) };
  const attachments = message.attachments || [];
  if (testTransport) return testTransport(message);

  if (process.env.RESEND_API_KEY) {
    const res = await safeFetch('https://api.resend.com/emails', {
      allowedHostnames: ['api.resend.com'],
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey.slice(0, 256) } : {}) },
      body: JSON.stringify({
        from: message.from, to: [message.to], subject: message.subject, html: message.html, text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        attachments: attachments.length ? attachments.map(a => ({ filename: a.filename, content: base64(a.content) })) : undefined,
      }),
    });
    const body = await res.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
    if (!res.ok) throw new Error(`Resend delivery rejected (${res.status}): ${body.message || body.name || res.statusText}`);
    return { delivered: true, provider: 'resend', messageId: body.id, responseSummary: `Dispatched via Resend [ID: ${body.id}]` };
  }

  if (process.env.POSTMARK_SERVER_TOKEN) {
    const res = await safeFetch('https://api.postmarkapp.com/email', {
      allowedHostnames: ['api.postmarkapp.com'],
      method: 'POST',
      headers: { 'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: message.from, To: message.to, Subject: message.subject, HtmlBody: message.html, TextBody: message.text,
        ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
        Attachments: attachments.length ? attachments.map(a => ({ Name: a.filename, Content: base64(a.content), ContentType: a.contentType || 'application/pdf' })) : undefined,
      }),
    });
    const body = await res.json().catch(() => ({})) as { MessageID?: string; Message?: string };
    if (!res.ok) throw new Error(`Postmark delivery rejected (${res.status}): ${body.Message || res.statusText}`);
    return { delivered: true, provider: 'postmark', messageId: body.MessageID, responseSummary: `Dispatched via Postmark [ID: ${body.MessageID}]` };
  }

  if (process.env.SENDGRID_API_KEY) {
    const res = await safeFetch('https://api.sendgrid.com/v3/mail/send', {
      allowedHostnames: ['api.sendgrid.com'],
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: message.from },
        ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
        subject: message.subject,
        content: [{ type: 'text/plain', value: message.text }, { type: 'text/html', value: message.html }],
        attachments: attachments.length ? attachments.map(a => ({ content: base64(a.content), filename: a.filename, type: a.contentType || 'application/pdf', disposition: 'attachment' })) : undefined,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`SendGrid delivery rejected (${res.status}): ${errText}`);
    }
    return { delivered: true, provider: 'sendgrid', messageId: res.headers.get('x-message-id') || undefined, responseSummary: 'Dispatched via SendGrid' };
  }

  throw new Error('NO_EMAIL_SERVICE_CONFIGURED');
}
