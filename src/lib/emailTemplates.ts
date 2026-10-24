/**
 * Email templates (K-08, A-132) for the emails LedgerFlow sends to customers and vendors. A
 * workspace can change the subject and text of each (Settings → Emails & Reminders), including
 * per-language variants ('en', 'he'); what it hasn't changed falls back to that language's built-in
 * default (or the workspace's base template for English). Templates are plain text with
 * {{placeholders}}; the HTML version is built from the text with everything escaped, so a template
 * can't inject markup, and the text version is sent alongside (BL-08). Used by the server to send
 * and by the settings screen to preview.
 */

export const EMAIL_TEMPLATE_KEYS = ['invoice', 'reminder', 'receipt', 'statement', 'remittance'] as const;
export type EmailTemplateKey = typeof EMAIL_TEMPLATE_KEYS[number];

export const TEMPLATE_LANGUAGES = ['en', 'he'] as const;
export type TemplateLanguage = typeof TEMPLATE_LANGUAGES[number];

export interface EmailTemplate {
  subject: string;
  body: string;
}

export type EmailTemplateMap = Partial<Record<EmailTemplateKey, Partial<EmailTemplate>>>;

export type EmailTemplates = EmailTemplateMap & {
  /** A-132: per-language template overrides stored durably inside `workspaces.emailTemplates`. */
  byLanguage?: Partial<Record<TemplateLanguage, EmailTemplateMap>>;
};

export const PLACEHOLDERS = ['company', 'customer', 'number', 'amount', 'amount_due', 'due_date', 'days_overdue', 'link', 'vendor', 'paid_bills', 'payment_date'] as const;
export type Placeholder = typeof PLACEHOLDERS[number];
export type TemplateValues = Partial<Record<Placeholder, string>>;

export const TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  invoice: 'Sending an invoice',
  reminder: 'Payment reminder',
  receipt: 'Payment received (thank you)',
  statement: 'Customer statement',
  remittance: 'Payment sent to a vendor (remittance advice)',
};

export const TEMPLATE_LANGUAGE_LABELS: Record<TemplateLanguage, string> = {
  en: 'English (default)',
  he: 'Hebrew (עברית)',
};

export const DEFAULT_TEMPLATES: Record<EmailTemplateKey, EmailTemplate> = {
  invoice: {
    subject: 'Invoice {{number}} from {{company}}',
    body: 'Hello {{customer}},\n\nPlease find invoice {{number}} for {{amount}} attached, due on {{due_date}}.\n\nYou can view and pay it here: {{link}}\n\nThank you,\n{{company}}',
  },
  reminder: {
    subject: 'Reminder: invoice {{number}} is overdue',
    body: 'Hello {{customer}},\n\nThis is a friendly reminder that invoice {{number}} was due on {{due_date}} ({{days_overdue}} days ago). {{amount_due}} is still open.\n\nYou can view and pay it here: {{link}}\n\nIf you have already paid, please ignore this message.\n\nThank you,\n{{company}}',
  },
  receipt: {
    subject: 'Thank you for your payment',
    body: 'Hello {{customer}},\n\nWe received your payment of {{amount}} for invoice {{number}}. Thank you!\n\n{{company}}',
  },
  statement: {
    subject: 'Your statement from {{company}}',
    body: 'Hello {{customer}},\n\nPlease find your account statement attached. The balance is {{amount_due}}.\n\nIf anything looks wrong, just reply to this email.\n\nThank you,\n{{company}}',
  },
  remittance: {
    subject: 'Payment from {{company}}',
    body: 'Hello {{vendor}},\n\nWe sent you a payment of {{amount}} on {{payment_date}} for: {{paid_bills}}.\n\nThank you,\n{{company}}',
  },
};

export const DEFAULT_HE_TEMPLATES: Record<EmailTemplateKey, EmailTemplate> = {
  invoice: {
    subject: 'חשבונית {{number}} מאת {{company}}',
    body: 'שלום {{customer}},\n\nמצורפת חשבונית {{number}} על סך {{amount}}, לתשלום עד {{due_date}}.\n\nלצפייה ולתשלום אונליין: {{link}}\n\nתודה,\n{{company}}',
  },
  reminder: {
    subject: 'תזכורת: חשבונית {{number}} עברה את מועד הפירעון',
    body: 'שלום {{customer}},\n\nתזכורת ידידותית לכך שמועד הפירעון של חשבונית {{number}} חל ב־{{due_date}} (לפני {{days_overdue}} ימים). היתרה הפתוחה לתשלום היא {{amount_due}}.\n\nלצפייה ולתשלום: {{link}}\n\nאם התשלום כבר הוסדר, נא להתעלם מהודעה זו.\n\nתודה,\n{{company}}',
  },
  receipt: {
    subject: 'תודה על התשלום שלך',
    body: 'שלום {{customer}},\n\nקיבלנו את התשלום שלך בסך {{amount}} עבור חשבונית {{number}}. תודה רבה!\n\n{{company}}',
  },
  statement: {
    subject: 'דף חשבון מאת {{company}}',
    body: 'שלום {{customer}},\n\nמצורף דף החשבון שלך. היתרה הנוכחית לתשלום היא {{amount_due}}.\n\nלכל שאלה ניתן להשיב להודעה זו.\n\nתודה,\n{{company}}',
  },
  remittance: {
    subject: 'אישור תשלום מאת {{company}}',
    body: 'שלום {{vendor}},\n\nהעברנו תשלום בסך {{amount}} בתאריך {{payment_date}} בגין: {{paid_bills}}.\n\nתודה,\n{{company}}',
  },
};

export const MAX_SUBJECT = 200;
export const MAX_BODY = 5000;

export function defaultTemplateForLanguage(key: EmailTemplateKey, language: TemplateLanguage = 'en'): EmailTemplate {
  return language === 'he' ? DEFAULT_HE_TEMPLATES[key] : DEFAULT_TEMPLATES[key];
}

/**
 * Resolve a template key.
 * - Without `language` (or `language === 'en'`): prefers `byLanguage.en[key]`, then top-level
 *   `custom[key]`, then `DEFAULT_TEMPLATES[key]`.
 * - With `language === 'he'`: prefers `byLanguage.he[key]`, then `DEFAULT_HE_TEMPLATES[key]`
 *   (falling back field-by-field so partial overrides always render complete wording).
 */
export function resolveTemplate(
  key: EmailTemplateKey,
  custom?: EmailTemplates | null,
  language?: TemplateLanguage,
): EmailTemplate {
  const lang: TemplateLanguage = language === 'he' ? 'he' : 'en';
  const langOwn = custom?.byLanguage?.[lang]?.[key];
  const baseOwn = lang === 'en' ? custom?.[key] : undefined;
  const fallback = defaultTemplateForLanguage(key, lang);
  return {
    subject: (langOwn?.subject || '').trim() || (baseOwn?.subject || '').trim() || fallback.subject,
    body: (langOwn?.body || '').trim() || (baseOwn?.body || '').trim() || fallback.body,
  };
}

/** Placeholders a template uses that don't exist (shown as a warning in settings). */
export function unknownPlaceholders(text: string): string[] {
  const found = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(m => m[1].toLowerCase());
  return [...new Set(found.filter(p => !(PLACEHOLDERS as readonly string[]).includes(p)))];
}

const fill = (text: string, values: TemplateValues) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const value = values[name.toLowerCase() as Placeholder];
    return value === undefined ? whole : value;
  });

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  dir?: 'ltr' | 'rtl';
}

/** Fills the template. The link becomes a button in the HTML; the text keeps it as a plain URL. */
export function renderEmail(template: EmailTemplate, values: TemplateValues, options?: { language?: TemplateLanguage }): RenderedEmail {
  const rtl = options?.language === 'he';
  const subject = fill(template.subject, values).replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_SUBJECT);
  const text = fill(template.body, values).slice(0, MAX_BODY);
  const link = values.link || '';
  const paragraphs = text.split(/\n{2,}/).map(p => {
    const safe = escapeHtml(p).replace(/\n/g, '<br />');
    return link && p.trim() !== '' && p.includes(link)
      ? `<p>${safe.replace(escapeHtml(link), `<a href="${escapeHtml(encodeURI(link))}" style="color:#2563eb">${escapeHtml(link)}</a>`)}</p>`
      : `<p>${safe}</p>`;
  });
  const buttonLabel = rtl ? 'לצפייה בחשבונית' : 'View invoice';
  const button = link
    ? `<p style="margin:28px 0"><a href="${escapeHtml(encodeURI(link))}" style="background:#2563eb;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${buttonLabel}</a></p>`
    : '';
  const dirAttr = rtl ? ' dir="rtl"' : '';
  const alignStyle = rtl ? ';text-align:right' : '';
  const html = `<div${dirAttr} style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1e293b;max-width:600px;margin:0 auto;padding:24px${alignStyle}">${paragraphs.join('')}${button}</div>`;
  return { subject, text, html, dir: rtl ? 'rtl' : 'ltr' };
}
