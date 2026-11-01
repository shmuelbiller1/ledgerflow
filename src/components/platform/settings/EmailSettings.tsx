import React, { useMemo, useState, useId } from 'react';
import ApprovalDelegatePanel from './ApprovalDelegatePanel';
import { toast } from 'sonner';
import { Mail, RotateCcw } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { db } from '../../../firebase';
import { doc, updateDoc } from '../../../lib/db/firestore';
import {
  EMAIL_TEMPLATE_KEYS, MAX_BODY, MAX_SUBJECT, PLACEHOLDERS, TEMPLATE_LABELS,
  TEMPLATE_LANGUAGES, TEMPLATE_LANGUAGE_LABELS, defaultTemplateForLanguage,
  renderEmail, resolveTemplate, unknownPlaceholders,
} from '../../../lib/emailTemplates';
import type { EmailTemplateKey, EmailTemplates, TemplateLanguage } from '../../../lib/emailTemplates';
import { normalizeReminderSettings } from '../../../lib/reminders';
import { approvalLimitUnits, normalizeInvoiceApproval, normalizePoApproval, parseApprovalLimit } from '../../../lib/invoiceApproval';
import { formatCurrency } from '../../../lib/utils';

/**
 * Settings → Emails & Reminders: the texts of the emails sent to customers (K-08, A-132 per-language
 * variants), with a live preview, the automatic payment reminder schedule (BE-01, K-26), the invoice
 * approval limit (BE-04) and the purchase-order approval threshold (A-120). Owners and accountants edit.
 */

const SAMPLE = {
  company: 'Your Company', customer: 'Acme Ltd', vendor: 'Paper Co', number: 'INV-1042',
  amount: '$1,250.00', amount_due: '$750.00', due_date: '2026-10-15', days_overdue: '14',
  payment_date: '2026-10-23', paid_bills: 'BILL-204 ($1,250.00)', link: 'https://example.com/i/sample',
};

const inputClass = 'w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';

export default function EmailSettings() {
  const formId = useId();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant';

  const [key, setKey] = useState<EmailTemplateKey>('invoice');
  const [lang, setLang] = useState<TemplateLanguage>('en');
  const [drafts, setDrafts] = useState<EmailTemplates>(() => workspace?.emailTemplates || {});
  const [reminders, setReminders] = useState(() => normalizeReminderSettings(workspace?.reminderSettings));
  const [approval, setApproval] = useState(() => normalizeInvoiceApproval(workspace?.invoiceApproval));
  const [limitText, setLimitText] = useState(() => approvalLimitUnits(normalizeInvoiceApproval(workspace?.invoiceApproval).thresholdCents));
  const [poApproval, setPoApproval] = useState(() => normalizePoApproval(workspace?.invoiceApproval));
  const [poLimitText, setPoLimitText] = useState(() => approvalLimitUnits(normalizePoApproval(workspace?.invoiceApproval).thresholdCents));
  const [daysText, setDaysText] = useState(() => normalizeReminderSettings(workspace?.reminderSettings).daysAfterDue.join(', '));
  const [saving, setSaving] = useState(false);

  const current = resolveTemplate(key, drafts, lang);
  const preview = useMemo(() => renderEmail(current, SAMPLE, { language: lang }), [current, lang]);
  const unknown = unknownPlaceholders(`${current.subject} ${current.body}`);

  const save = async (fields: Record<string, unknown>, message: string) => {
    if (!workspace?.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { ...fields, updatedAt: new Date().toISOString() });
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, ...fields } : w)));
      toast.success(message);
    } catch {
      toast.error('Could not save (owners and accountants can change these settings).');
    } finally {
      setSaving(false);
    }
  };

  const editTemplate = (field: 'subject' | 'body', value: string) => setDrafts(d => {
    if (lang === 'en') {
      return { ...d, [key]: { ...(d[key] || {}), [field]: value } };
    }
    const existingLang = d.byLanguage?.[lang] || {};
    return {
      ...d,
      byLanguage: {
        ...(d.byLanguage || {}),
        [lang]: {
          ...existingLang,
          [key]: { ...(existingLang[key] || {}), [field]: value },
        },
      },
    };
  });

  const resetTemplate = () => setDrafts(d => {
    if (lang === 'en') {
      const next: EmailTemplates = { ...d };
      delete next[key];
      if (next.byLanguage?.en?.[key]) {
        const nextEn = { ...next.byLanguage.en };
        delete nextEn[key];
        next.byLanguage = { ...next.byLanguage, en: nextEn };
      }
      return next;
    }
    const nextLang = { ...(d.byLanguage?.[lang] || {}) };
    delete nextLang[key];
    return { ...d, byLanguage: { ...(d.byLanguage || {}), [lang]: nextLang } };
  });

  const hasCustomVariant = (k: EmailTemplateKey) => Boolean(drafts[k] || drafts.byLanguage?.en?.[k] || drafts.byLanguage?.he?.[k]);

  /**
   * BE-04 + A-120: invoice and purchase-order approval thresholds stored together on `invoiceApproval`.
   * A limit that is not a positive number keeps the rule off — no threshold is ever guessed.
   */
  const saveApproval = () => {
    const poNext = normalizePoApproval({ poEnabled: poApproval.enabled, poThresholdCents: parseApprovalLimit(poLimitText) });
    const settings = normalizeInvoiceApproval({
      enabled: approval.enabled,
      thresholdCents: parseApprovalLimit(limitText),
      poEnabled: poNext.enabled,
      poThresholdCents: poNext.thresholdCents,
    });
    setApproval(settings);
    setLimitText(approvalLimitUnits(settings.thresholdCents));
    setPoApproval(poNext);
    setPoLimitText(approvalLimitUnits(poNext.thresholdCents));
    void save({ invoiceApproval: settings }, settings.enabled
      ? `Invoices over ${formatCurrency(settings.thresholdCents, workspace?.currency)} now wait for an owner's or an accountant's approval before they are emailed.`
      : 'Approval rules saved.');
  };

  const saveReminders = () => {
    const days = daysText.split(/[,\s]+/).filter(Boolean).map(Number);
    const settings = normalizeReminderSettings({ enabled: reminders.enabled, daysAfterDue: days, thankYou: reminders.thankYou, monthlyStatements: reminders.monthlyStatements });
    setReminders(settings);
    setDaysText(settings.daysAfterDue.join(', '));
    void save({ reminderSettings: settings }, `${settings.enabled ? `Reminders on: ${settings.daysAfterDue.join(', ')} days after the due date.` : 'Automatic reminders are off.'} ${settings.thankYou ? 'Thank-you emails on.' : 'No thank-you emails.'} ${settings.monthlyStatements ? 'Monthly statements on.' : ''}`.trim());
  };

  const langDefault = defaultTemplateForLanguage(key, lang);
  const rawDraftValue = lang === 'en' ? drafts[key] : drafts.byLanguage?.[lang]?.[key];

  return (
    <div className="space-y-8">
      <section className="ledger-card p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-5" aria-labelledby={`${formId}-email-templates`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-[var(--brass)]" aria-hidden="true" />
            <div>
              <h2 id={`${formId}-email-templates`} className="text-lg font-bold text-[var(--text)]">Email templates</h2>
              <p className="text-xs text-[var(--muted)]">The text of the emails your customers receive, with per-language variants. A plain-text version is always sent with it.</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Template language">
            {TEMPLATE_LANGUAGES.map(code => (
              <button
                key={code}
                type="button"
                aria-pressed={lang === code}
                onClick={() => setLang(code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${lang === code ? 'border-[var(--brass)] bg-[var(--brass-soft)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)]'}`}
              >
                {TEMPLATE_LANGUAGE_LABELS[code]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Email templates">
          {EMAIL_TEMPLATE_KEYS.map(k => (
            <button key={k} type="button" role="tab" aria-selected={key === k} onClick={() => setKey(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${key === k ? 'border-[var(--brass)] bg-[var(--brass-soft)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>
              {TEMPLATE_LABELS[k]}{hasCustomVariant(k) ? ' ·' : ''}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <label htmlFor={`${formId}-tpl-subject`} className="block text-xs font-semibold text-[var(--text)] mb-1">Subject ({TEMPLATE_LANGUAGE_LABELS[lang]})</label>
              <input id={`${formId}-tpl-subject`} dir={lang === 'he' ? 'rtl' : 'ltr'} maxLength={MAX_SUBJECT} disabled={!canEdit}
                value={rawDraftValue?.subject ?? langDefault.subject}
                onChange={e => editTemplate('subject', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor={`${formId}-tpl-body`} className="block text-xs font-semibold text-[var(--text)] mb-1">Text ({TEMPLATE_LANGUAGE_LABELS[lang]})</label>
              <textarea id={`${formId}-tpl-body`} dir={lang === 'he' ? 'rtl' : 'ltr'} rows={12} maxLength={MAX_BODY} disabled={!canEdit}
                value={rawDraftValue?.body ?? langDefault.body}
                onChange={e => editTemplate('body', e.target.value)} className={`${inputClass} font-mono text-xs`} />
            </div>
            <p className="text-[11px] text-[var(--muted)]">You can use: {PLACEHOLDERS.map(p => `{{${p}}}`).join(' ')}</p>
            {unknown.length > 0 && <p className="text-xs text-[var(--neg)]" role="alert">Unknown: {unknown.map(p => `{{${p}}}`).join(', ')} (it will be sent as written)</p>}
            {canEdit && (
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={() => save({ emailTemplates: drafts }, 'Email templates saved.')}
                  className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50">Save templates</button>
                <button type="button" onClick={resetTemplate} className="px-3 py-2 rounded-lg border border-[var(--line)] text-sm text-[var(--text)] inline-flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4" aria-hidden="true" /> Use the default
                </button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--muted)]">Preview ({TEMPLATE_LANGUAGE_LABELS[lang]})</p>
            <div dir={preview.dir} className="rounded-xl border border-[var(--line)] bg-white text-slate-800 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 text-xs"><strong>Subject:</strong> {preview.subject}</div>
              {/* The preview HTML is built from escaped text by renderEmail */}
              <div className="text-sm" dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          </div>
        </div>
      </section>

      <section className="ledger-card p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-4" aria-labelledby={`${formId}-reminders`}>
        <div>
          <h2 id={`${formId}-reminders`} className="text-lg font-bold text-[var(--text)]">Automatic payment reminders</h2>
          <p className="text-xs text-[var(--muted)]">Customers with an overdue invoice get the "Payment reminder" email on these days after the due date (checked every morning).</p>
        </div>
        <label htmlFor={`${formId}-enabled`} className="flex items-center gap-2 text-sm text-[var(--text)]">
          <input id={`${formId}-enabled`} type="checkbox" disabled={!canEdit} checked={reminders.enabled} onChange={e => setReminders({ ...reminders, enabled: e.target.checked })} />
          Send reminders automatically
        </label>
        <div className="max-w-sm">
          <label htmlFor={`${formId}-reminder-days`} className="block text-xs font-semibold text-[var(--text)] mb-1">Days after the due date</label>
          <input id={`${formId}-reminder-days`} disabled={!canEdit} value={daysText} onChange={e => setDaysText(e.target.value)} placeholder="3, 14, 30" className={inputClass} />
        </div>
        <label htmlFor={`${formId}-thanks`} className="flex items-start gap-2 text-sm text-[var(--text)] pt-2 border-t border-[var(--line)]">
          <input id={`${formId}-thanks`} type="checkbox" className="mt-1" disabled={!canEdit} checked={Boolean(reminders.thankYou)} onChange={e => setReminders({ ...reminders, thankYou: e.target.checked })} />
          <span>
            Email a thank-you when a customer pays
            <span className="block text-xs text-[var(--muted)]">Uses the &quot;Payment received (thank you)&quot; email above, for payments recorded by hand, from a bank line or online.</span>
          </span>
        </label>
        <label htmlFor={`${formId}-statements`} className="flex items-start gap-2 text-sm text-[var(--text)]">
          <input id={`${formId}-statements`} type="checkbox" className="mt-1" disabled={!canEdit} checked={Boolean(reminders.monthlyStatements)} onChange={e => setReminders({ ...reminders, monthlyStatements: e.target.checked })} />
          <span>
            Email each customer their statement on the 1st of every month
            <span className="block text-xs text-[var(--muted)]">Customers with something open, using the &quot;Customer statement&quot; email above. A customer can be left out on their page.</span>
          </span>
        </label>
        {canEdit && (
          <button type="button" disabled={saving} onClick={saveReminders} className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50">Save automatic emails</button>
        )}
        {!canEdit && <p className="text-xs text-[var(--muted)]">Owners and accountants change these settings.</p>}
      </section>

      <section className="ledger-card p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-4" aria-labelledby={`${formId}-approval`}>
        <div>
          <h2 id={`${formId}-approval`} className="text-lg font-bold text-[var(--text)]">Approval before an invoice goes out</h2>
          <p className="text-xs text-[var(--muted)]">
            A larger invoice is not emailed until an owner or an accountant has said yes. The invoice is saved,
            posted and counted as it always was — only the customer receiving it waits.
          </p>
        </div>
        <label htmlFor={`${formId}-approval-on`} className="flex items-center gap-2 text-sm text-[var(--text)]">
          <input id={`${formId}-approval-on`} type="checkbox" disabled={!canEdit} checked={approval.enabled}
            onChange={e => setApproval({ ...approval, enabled: e.target.checked })} />
          Require approval on invoices over a set amount
        </label>
        <div className="max-w-xs">
          <label htmlFor={`${formId}-approval-limit`} className="block text-xs font-semibold text-[var(--text)] mb-1">
            The amount, in {workspace?.currency || 'the workspace currency'}
          </label>
          <input id={`${formId}-approval-limit`} inputMode="decimal" disabled={!canEdit || !approval.enabled}
            value={limitText} onChange={e => setLimitText(e.target.value)} placeholder="2000" className={inputClass} />
        </div>
        <p className="text-xs text-[var(--muted)]">
          {approval.enabled && approval.thresholdCents > 0
            ? `Invoices above ${formatCurrency(approval.thresholdCents, workspace?.currency)} wait for a signature. Their payment reminders wait too.`
            : 'Turn this on and name an amount to hold big invoices back; leaving the amount empty keeps it off.'}
        </p>

        <div className="pt-4 border-t border-[var(--line)] space-y-3">
          <h3 className="text-sm font-bold text-[var(--text)]">Purchase order approval threshold</h3>
          <label htmlFor={`${formId}-po-approval-on`} className="flex items-center gap-2 text-sm text-[var(--text)]">
            <input id={`${formId}-po-approval-on`} type="checkbox" disabled={!canEdit} checked={poApproval.enabled}
              onChange={e => setPoApproval({ ...poApproval, enabled: e.target.checked })} />
            Require approval on purchase orders over a set amount
          </label>
          <div className="max-w-xs">
            <label htmlFor={`${formId}-po-approval-limit`} className="block text-xs font-semibold text-[var(--text)] mb-1">
              Purchase order limit, in {workspace?.currency || 'the workspace currency'}
            </label>
            <input id={`${formId}-po-approval-limit`} inputMode="decimal" disabled={!canEdit || !poApproval.enabled}
              value={poLimitText} onChange={e => setPoLimitText(e.target.value)} placeholder="1500" className={inputClass} />
          </div>
          <p className="text-xs text-[var(--muted)]">
            {poApproval.enabled && poApproval.thresholdCents > 0
              ? `Purchase orders above ${formatCurrency(poApproval.thresholdCents, workspace?.currency)} wait for approval before receiving or billing; orders at or below pass automatically.`
              : 'Off: every bookkeeper order waits for approval regardless of amount (default requisition rule).'}
          </p>
        </div>

        {canEdit && (
          <button type="button" disabled={saving} onClick={saveApproval} className="px-4 py-2 rounded-lg bg-[var(--brass)] text-[var(--ink)] text-sm font-bold disabled:opacity-50">Save approval rule</button>
        )}
        {!canEdit && <p className="text-xs text-[var(--muted)]">Owners and accountants change these settings.</p>}
        {approval.enabled && <ApprovalDelegatePanel />}
      </section>
    </div>
  );
}
