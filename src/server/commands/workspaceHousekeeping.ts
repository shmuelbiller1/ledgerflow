/**
 * Workspace housekeeping that changes records but posts nothing: merging two accounts or two contacts,
 * removing a contact nothing refers to, saving or removing a journal template, turning on two-step login
 * for everyone and the two-person rule, and previewing or sending a scheduled report.
 *
 * Every one of these already had its work in a service — `accountMergeService`,
 * `contactMergeService`, `twoStepPolicyService`, `scheduledReportService` — so the command is the
 * registered door in front of it: a name, a schema, the roles, a read-only preview and the runner's
 * workspace and role checks in one order. None declares `dated`: nothing here posts an entry, and a
 * merge's own service checks the periods of the records it moves.
 *
 * The two merges have a preview address of their own that writes nothing (`POST …/merge/preview`), and
 * they are one-way in practice (a merge cannot be told apart from records that were always one), so
 * `inverse()` is null throughout.
 */
import crypto from 'crypto';
import { z } from 'zod';
import { mergeAccounts, previewAccountMerge } from '../services/accountMergeService';
import { deleteContact, mergeContacts } from '../services/contactMergeService';
import { setRequireTwoStep, setTwoPersonRule } from '../services/twoStepPolicyService';
import { previewSchedule, sendScheduleNow } from '../services/scheduledReportService';
import { createPortalLink, revokePortalLink } from '../services/customerPortalService';
import { createSignLink } from '../services/estimateSignService';
import { getDb } from '../db/firestore';
import { writeServerAuditLog } from '../services/auditLogService';
import { JOURNAL_TEMPLATE_KIND, MAX_TEMPLATE_LINES, templateProblem, type JournalTemplate } from '../../lib/journalTemplates';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const id = z.string().min(1).max(200);
const identity = z.object({ workspaceId: z.string().min(1).max(200).optional() });

// --------------------------------------------------------------------------- account.merge

const accountMergeFields = z.object({ fromId: id, intoId: id }).strict();

export const accountMergeInput = identity.merge(accountMergeFields).strict();

export const accountMergeCommand: CommandDefinition<typeof accountMergeInput, Record<string, unknown>> = {
  name: 'account.merge',
  input: accountMergeInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, _tx, input) {
    return mergeAccounts(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, fromId: input.fromId, intoId: input.intoId,
    }) as unknown as Record<string, unknown>;
  },
  async preview(_ctx, input) {
    return {
      title: `Merge account ${input.fromId} into ${input.intoId}`,
      lines: ['Every record that used the first account is moved to the second', 'The first account is then removed; this cannot be undone'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'high',
  describe: {
    sentence: 'Merge two chart accounts, moving everything the first one holds into the second and removing it; do not use it to correct one entry — that is a journal edit.',
    example: { fromId: 'acc_old', intoId: 'acc_new' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'An account is missing, or the two are the same.', next: 'Name the account to move from and the one to keep.' },
      { code: 'CONFLICT', when: 'One of the accounts is locked, is the workspace bank account, or a record it holds is in a closed period.', next: 'Reopen the period or pick another account.' },
      { code: 'FORBIDDEN', when: 'The caller is a bookkeeper or a viewer.', next: 'Ask an owner or an accountant.' },
    ],
  },
};

export const accountMergePreviewCommand: CommandDefinition<typeof accountMergeInput, Record<string, unknown>> = {
  ...accountMergeCommand,
  name: 'account.mergepreview',
  async handler(ctx, _tx, input) {
    return previewAccountMerge(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, fromId: input.fromId, intoId: input.intoId,
    }) as unknown as Record<string, unknown>;
  },
  audit() { return null; },
  describe: {
    ...accountMergeCommand.describe,
    sentence: 'Say what merging two chart accounts would change, without changing anything; run account.merge to do it.',
  },
};

// --------------------------------------------------------------------------- contact.merge / contact.delete

const contactSide = z.enum(['customer', 'vendor']);

export const contactMergeInput = identity.extend({
  side: contactSide, keepId: id, mergeId: id,
}).strict();

export const contactMergeCommand: CommandDefinition<typeof contactMergeInput, Record<string, unknown>> = {
  name: 'contact.merge',
  input: contactMergeInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, _tx, input) {
    return mergeContacts(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, side: input.side, keepId: input.keepId, mergeId: input.mergeId,
    }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: `Merge the ${input.side} ${input.mergeId} into ${input.keepId}`,
      lines: ['Invoices, bills, payments and the balance move to the one that is kept', 'The other is removed; this cannot be undone'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'high',
  describe: {
    sentence: 'Merge two duplicate customers or vendors into the one to keep, moving their documents and balance; do not use it to correct a name — edit the contact.',
    example: { side: 'customer', keepId: 'cus_1', mergeId: 'cus_2' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The side is not customer or vendor, or an id is missing.', next: 'Name the side and both ids.' },
      { code: 'CONFLICT', when: 'The two are the same record, or one is referred to by something a merge cannot move.', next: 'Pick the record to keep and try again.' },
      { code: 'FORBIDDEN', when: 'The caller is a bookkeeper or a viewer.', next: 'Ask an owner or an accountant.' },
    ],
  },
};

// `checkOnly` is the address's ?check=1: may this be deleted? Nothing is deleted, so it changes the
// answer only, never the permission (the same roles delete for real).
export const contactDeleteInput = identity.extend({ side: contactSide, id, checkOnly: z.boolean().optional() }).strict();

export const contactDeleteCommand: CommandDefinition<typeof contactDeleteInput, Record<string, unknown>> = {
  name: 'contact.delete',
  input: contactDeleteInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    // the address also answers "may this be deleted?" (?check=1) without deleting; the handler keeps
    // that choice, because it only changes the answer, not the permission
    const checkOnly = Boolean(input.checkOnly);
    await deleteContact(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, side: input.side, id: input.id, checkOnly,
    });
    return checkOnly ? { deletable: true } : {};
  },
  async preview(_ctx, input) {
    return { title: `Delete the ${input.side} ${input.id}`, lines: ['Only a contact that nothing refers to can be deleted', 'If anything refers to it, the answer says what does'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Delete a customer or vendor that nothing refers to; do not use it to remove one that has documents — merge it into another instead.',
    example: { side: 'vendor', id: 'ven_1' },
    refusals: [
      { code: 'CONFLICT', when: 'A document, payment or balance still refers to the contact.', next: 'Merge it into another contact, or remove what refers to it first.' },
      { code: 'NOT_FOUND', when: 'No such customer or vendor in this workspace.', next: 'Reload the list.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

// --------------------------------------------------------------------------- journal template save / remove

const MAX_LINES = MAX_TEMPLATE_LINES;
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const journalTemplateSaveInput = identity.extend({
  name: z.string().max(60),
  description: z.string().max(200).optional(),
  adjusting: z.boolean().optional(),
  lines: z.array(z.object({
    accountId: z.string().min(1).max(127),
    debitCents: cents,
    creditCents: cents,
    dimensions: z.record(z.string().max(64), z.string().max(120)).optional(),
  }).strict()).max(MAX_LINES),
}).strict();

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

async function templatesOf(db: ReturnType<typeof getDb>, workspaceId: string): Promise<JournalTemplate[]> {
  const snap = await db.collection('documents').where('workspaceId', '==', workspaceId).where('kind', '==', JOURNAL_TEMPLATE_KIND).get();
  return snap.docs.map(doc => ({ ...(doc.data() as JournalTemplate), id: doc.id })).sort((a, b) => a.name.localeCompare(b.name));
}

export const journalTemplateSaveCommand: CommandDefinition<typeof journalTemplateSaveInput, Record<string, unknown>> = {
  name: 'journaltemplate.save',
  input: journalTemplateSaveInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    const accounts = await ctx.db.collection('chartAccounts').where('workspaceId', '==', ctx.workspaceId).get();
    // the template's own rule (balanced, at least two lines, every account in this workspace), in its words
    const problem = templateProblem(input, new Set(accounts.docs.map(doc => doc.id)));
    if (problem) throw Object.assign(new Error(problem), { status: 400 });
    const existing = (await templatesOf(ctx.db, ctx.workspaceId)).find(template => sameName(template.name, input.name));
    const now = new Date().toISOString();
    const templateId = existing?.id || `jt_${crypto.randomBytes(8).toString('hex')}`;
    const template: JournalTemplate = {
      id: templateId, workspaceId: ctx.workspaceId, kind: JOURNAL_TEMPLATE_KIND,
      name: input.name.trim(), description: (input.description || '').trim(), adjusting: Boolean(input.adjusting),
      lines: input.lines, createdBy: existing?.createdBy || ctx.actor, createdAt: existing?.createdAt || now, updatedAt: now,
    };
    await ctx.db.runTransaction(async t => {
      t.set(ctx.db.collection('documents').doc(templateId), template);
      await writeServerAuditLog({
        workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email,
        action: existing ? 'journalTemplate.replaced' : 'journalTemplate.saved',
        entityType: 'journalTemplates', entityId: templateId,
        details: { description: `${existing ? 'Replaced' : 'Saved'} the journal template "${template.name}" (${template.lines.length} lines)`, name: template.name },
      }, { db: ctx.db, tx: t });
    });
    return { template, replaced: Boolean(existing) };
  },
  async preview(_ctx, input) {
    return {
      title: `Save the journal template "${input.name.trim()}"`,
      lines: [`${input.lines.length} ${input.lines.length === 1 ? 'line' : 'lines'}`, 'A template posts nothing; it only fills the journal form'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Save a journal-entry template under a name, replacing one of the same name; do not use it to post — a template only fills the form.',
    example: { name: 'Monthly depreciation', lines: [{ accountId: 'acc_exp', debitCents: 10000, creditCents: 0 }, { accountId: 'acc_acc', debitCents: 0, creditCents: 10000 }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The lines do not balance, there are fewer than two, or an account is not in this workspace.', next: 'Balance the lines and use this workspace\'s accounts.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

export const journalTemplateRemoveInput = identity.extend({ templateId: id }).strict();

export const journalTemplateRemoveCommand: CommandDefinition<typeof journalTemplateRemoveInput, Record<string, unknown>> = {
  name: 'journaltemplate.remove',
  input: journalTemplateRemoveInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    const ref = ctx.db.collection('documents').doc(input.templateId);
    const removed = await ctx.db.runTransaction(async t => {
      const snap = await t.get(ref);
      const template = snap.exists ? snap.data() as Partial<JournalTemplate> : undefined;
      if (!template || template.workspaceId !== ctx.workspaceId || template.kind !== JOURNAL_TEMPLATE_KIND) return false;
      t.delete(ref);
      await writeServerAuditLog({
        workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, action: 'journalTemplate.removed',
        entityType: 'journalTemplates', entityId: input.templateId,
        details: { description: `Removed the journal template "${template.name || input.templateId}"`, name: template.name || null },
      }, { db: ctx.db, tx: t });
      return true;
    });
    // the handler's 404, in its words
    if (!removed) throw Object.assign(new Error('That template is not in this workspace (already removed?)'), { status: 404 });
    return {};
  },
  async preview(_ctx, input) {
    return { title: `Remove the journal template ${input.templateId}`, lines: ['Templates post nothing, so no entry changes'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Remove a saved journal template; nothing in the books changes, because a template only filled the form.',
    example: { templateId: 'jt_1a2b3c4d5e6f7a8b' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The template is not in this workspace, or was already removed.', next: 'Reload the template list.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

// --------------------------------------------------------------------------- security.two-step / security.two-person

export const twoStepInput = identity.extend({ required: z.boolean() }).strict();

export const twoStepCommand: CommandDefinition<typeof twoStepInput, Record<string, unknown>> = {
  name: 'security.twostep',
  input: twoStepInput,
  roles: ['owner'],
  allowPlatformAdmin: true,
  async handler(ctx, _tx, input) {
    return setRequireTwoStep(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, aal: ctx.user.aal, required: input.required,
    }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: input.required ? 'Require two-step login for everyone' : 'Stop requiring two-step login',
      lines: ['Every member of this workspace is affected', 'Someone who has not set up an authenticator must do so before their next sign-in'],
    };
  },
  audit() { return null; },
  inverse(input) { return { command: 'security.twostep', input: { required: !input.required } }; },
  risk: 'high',
  describe: {
    sentence: 'Require (or stop requiring) two-step login for everyone in the workspace; do not use it to turn on your own second factor — that is your account settings.',
    example: { required: true },
    refusals: [
      { code: 'FORBIDDEN', when: 'The caller is not an owner, or has not confirmed two-step login themselves.', next: 'Ask an owner who signs in with two steps.' },
    ],
  },
};

export const twoPersonInput = identity.extend({ on: z.boolean() }).strict();

export const twoPersonCommand: CommandDefinition<typeof twoPersonInput, Record<string, unknown>> = {
  name: 'security.twoperson',
  input: twoPersonInput,
  roles: ['owner'],
  allowPlatformAdmin: true,
  async handler(ctx, _tx, input) {
    return setTwoPersonRule(ctx.db, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, on: input.on,
    }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: input.on ? 'Turn on the two-person rule' : 'Turn off the two-person rule',
      lines: ['A payment or pay run must then be prepared by one person and approved by another', 'Whoever prepares it can no longer approve it'],
    };
  },
  audit() { return null; },
  inverse(input) { return { command: 'security.twoperson', input: { on: !input.on } }; },
  risk: 'high',
  describe: {
    sentence: 'Turn the two-person rule on or off, so that whoever prepares a payment or pay run cannot also approve it; do not use it to approve one — that is the approve command.',
    example: { on: true },
    refusals: [{ code: 'FORBIDDEN', when: 'The caller is not an owner.', next: 'Ask a workspace owner.' }],
  },
};

// --------------------------------------------------------------------------- portal and signing links

/**
 * A customer's portal link and an estimate's signing link are both a secret the server mints for
 * someone outside the workspace. Making one is a write — it grants access to a page — and putting it
 * away is the inverse, so this is the one pair in this batch that undoes cleanly. Neither can be
 * answered from a preview: the link is what the record holds, and reading it twice would mail the same
 * address a link that was never saved.
 */
export const portalLinkCreateInput = identity.extend({ customerId: id }).strict();

export const portalLinkCreateCommand: CommandDefinition<typeof portalLinkCreateInput, Record<string, unknown>> = {
  name: 'portal.linkcreate',
  input: portalLinkCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    return createPortalLink(ctx.db, {
      workspaceId: ctx.workspaceId, customerId: input.customerId, uid: ctx.actor, email: ctx.email,
    }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: `Make a portal link for customer ${input.customerId}`,
      lines: ['The customer can see their invoices, estimates and balance without signing in', 'Anyone holding the link can see them until it is turned off'],
    };
  },
  audit() { return null; },
  inverse(input) { return { command: 'portal.linkrevoke', input: { customerId: input.customerId } }; },
  risk: 'normal',
  describe: {
    sentence: 'Mint the private link a customer uses to see their own invoices and balance; do not send it to anyone but that customer — it is a way into their account.',
    example: { customerId: 'cus_1' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The customer is not in this workspace.', next: 'Reload the customer list.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

export const portalLinkRevokeInput = identity.extend({ customerId: id }).strict();

export const portalLinkRevokeCommand: CommandDefinition<typeof portalLinkRevokeInput, Record<string, unknown>> = {
  name: 'portal.linkrevoke',
  input: portalLinkRevokeInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    await revokePortalLink(ctx.db, { workspaceId: ctx.workspaceId, customerId: input.customerId, uid: ctx.actor, email: ctx.email });
    return {};
  },
  async preview(_ctx, input) {
    return { title: `Turn off the portal link for customer ${input.customerId}`, lines: ['The link stops working immediately', 'A new one can be made later'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Turn off a customer\'s portal link so it stops working; do not use it to hide an invoice — void or correct the invoice instead.',
    example: { customerId: 'cus_1' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The customer is not in this workspace.', next: 'Reload the customer list.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

export const signLinkCreateInput = identity.extend({ estimateId: id }).strict();

export const signLinkCreateCommand: CommandDefinition<typeof signLinkCreateInput, Record<string, unknown>> = {
  name: 'estimate.signlink',
  input: signLinkCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    const today = await import('../../lib/calendarDate').then(m => m.formatTzDate(new Date(), 'UTC'));
    return createSignLink(ctx.db, {
      workspaceId: ctx.workspaceId, estimateId: input.estimateId, uid: ctx.actor, email: ctx.email,
    }, today) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return {
      title: `Make a signing link for estimate ${input.estimateId}`,
      lines: ['The customer can read the estimate and sign it once', 'Signing records who signed, when, and from where'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Mint the private link a customer uses to read and sign one estimate; do not use it to send an invoice — invoices have their own send.',
    example: { estimateId: 'est_1' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The estimate is not in this workspace, or is not one that can be signed.', next: 'Reload the estimate.' },
      { code: 'FORBIDDEN', when: 'The caller is a viewer.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};

// --------------------------------------------------------------------------- workspace branding

export const brandingSaveInput = identity.extend({
  /** validated by the branding schema itself, so an issue's own sentence reaches the screen */
  branding: z.unknown(),
}).loose();

export const brandingSaveCommand: CommandDefinition<typeof brandingSaveInput, { branding: unknown }> = {
  name: 'workspace.branding',
  input: brandingSaveInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, _tx, input) {
    const { BrandingSchema } = await import('../../lib/branding');
    const { compactBranding } = await import('../services/brandingService');
    const parsed = BrandingSchema.safeParse(input.branding);
    // the address answered a malformed body with the first issue's own sentence; the route still does
    if (!parsed.success) throw parsed.error;
    const branding = compactBranding(parsed.data);
    await ctx.db.collection('workspaces').doc(ctx.workspaceId).update({ branding, updatedAt: new Date().toISOString() });
    await writeServerAuditLog({
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email || '',
      action: 'BRANDING_UPDATED', entityType: 'workspace', entityId: ctx.workspaceId,
      details: {
        description: 'Document branding changed',
        logo: Boolean(branding.logoDataUrl), color: branding.color || null, termsFor: Object.keys(branding.terms || {}),
      },
    }, { db: ctx.db });
    return { branding };
  },
  async preview(_ctx, input) {
    const branding = (input.branding || {}) as { logoDataUrl?: unknown; color?: unknown };
    return {
      title: 'Save the document branding',
      lines: [branding.logoDataUrl ? 'With the uploaded logo' : 'Without a logo', 'It applies to every invoice, estimate and statement made from now on'],
    };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Save the logo, colour, address, footer and payment terms printed on documents; it changes what documents look like, never what they say.',
    example: { branding: { color: '#1F6FEB', footer: 'Thank you' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The logo is too large or not an image, the colour is not a hex colour, or a field is not one of the branding fields.', next: 'Fix the field the answer names.' },
      { code: 'FORBIDDEN', when: 'The caller is a bookkeeper or a viewer.', next: 'Ask an owner or an accountant.' },
    ],
  },
};

// --------------------------------------------------------------------------- report schedule preview / send-now

export const reportSchedulePreviewInput = identity.extend({
  report: z.unknown().optional(),
  frequency: z.unknown().optional(),
}).loose();

export const reportSchedulePreviewCommand: CommandDefinition<typeof reportSchedulePreviewInput, Record<string, unknown>> = {
  name: 'reportschedule.preview',
  input: reportSchedulePreviewInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, _tx, input) {
    return previewSchedule(ctx.db, {
      workspaceId: ctx.workspaceId, report: input.report, frequency: input.frequency,
    }) as Promise<Record<string, unknown>>;
  },
  async preview() {
    return { title: 'Show the email a schedule would send', lines: ['Nothing is sent and nothing is saved'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Show the report email a schedule would send, before it is saved; nothing is sent.',
    example: { report: 'pl', frequency: 'monthly' },
    refusals: [{ code: 'FORBIDDEN', when: 'The caller is a bookkeeper or a viewer.', next: 'Ask an owner or an accountant.' }],
  },
};

export const reportScheduleSendInput = identity.extend({ scheduleId: id }).strict();

export const reportScheduleSendCommand: CommandDefinition<typeof reportScheduleSendInput, Record<string, unknown>> = {
  name: 'reportschedule.send',
  input: reportScheduleSendInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, _tx, input) {
    return sendScheduleNow(ctx.db, { workspaceId: ctx.workspaceId, scheduleId: input.scheduleId }) as Promise<Record<string, unknown>>;
  },
  async preview(_ctx, input) {
    return { title: `Send the scheduled report ${input.scheduleId} now`, lines: ['It goes to the people on the schedule, now, in addition to its usual time'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Send a scheduled report now, in addition to its own time; do not use it to re-send one that already went — check the schedule first.',
    example: { scheduleId: 'sched_1' },
    refusals: [
      { code: 'NOT_FOUND', when: 'No schedule with that id in this workspace.', next: 'Reload the schedules.' },
      { code: 'FORBIDDEN', when: 'The caller is a bookkeeper or a viewer.', next: 'Ask an owner or an accountant.' },
    ],
  },
};

export const brandingProfilesSaveInput = identity.extend({
  /** { labels: { "dimension:node": branding } }; each label's branding is checked by the branding schema */
  profiles: z.unknown().optional(),
  /** or one label: its key, its new branding (empty or null removes it), and what the editor saw (stale check) */
  label: z.string().max(200).optional(),
  branding: z.unknown().optional(),
  expected: z.unknown().optional(),
}).loose();

/**
 * AUP-01: per-label branding (workspace.brandingProfiles). Each label key is "dimension:node" and its value is a
 * branding override checked by the same schema as the books' branding; PDFs for documents on that label (or a
 * label under it) use it, and the books' branding fills in what it leaves blank. workspace.branding is untouched.
 */
export const brandingProfilesSaveCommand: CommandDefinition<typeof brandingProfilesSaveInput, { profiles: unknown }> = {
  name: 'workspace.brandingprofiles',
  input: brandingProfilesSaveInput,
  roles: ['owner', 'accountant'],
  async handler(ctx, _tx, input) {
    const { BrandingSchema } = await import('../../lib/branding');
    const { compactBranding } = await import('../services/brandingService');
    const { brandingProfilesProblem } = await import('../../lib/entityBranding');
    const checked = (key: string, value: unknown) => {
      const parsed = BrandingSchema.safeParse(value);
      if (!parsed.success) throw Object.assign(new Error(`${key}: ${parsed.error.issues[0]?.message || 'check the branding fields'}`), { status: 400, code: 'INVALID_INPUT' });
      return compactBranding(parsed.data) as Record<string, unknown>;
    };
    const invalid = (problem: string | null) => { if (problem) throw Object.assign(new Error(problem), { status: 400, code: 'INVALID_INPUT' }); };
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    // one label at a time ({ label, branding, expected }) is read and changed inside one transaction, so two people
    // saving different labels keep both; the whole-map form ({ profiles }) still replaces everything
    const profiles = await ctx.db.runTransaction(async t => {
      let labels: Record<string, unknown> = {};
      if (typeof input.label === 'string') {
        const key = input.label;
        invalid(brandingProfilesProblem({ labels: { [key]: {} } } as never));
        const stored = ((await t.get(ref)).data()?.brandingProfiles || {}) as { labels?: Record<string, unknown> };
        labels = { ...(stored.labels || {}) };
        if (input.expected !== undefined && JSON.stringify(labels[key] ?? null) !== JSON.stringify(input.expected ?? null)) {
          throw Object.assign(new Error('This label\'s branding changed while you were editing. Reload to see the newer version.'), { status: 409, code: 'CONFLICT' });
        }
        const compact = input.branding && typeof input.branding === 'object' ? checked(key, input.branding) : {};
        if (Object.keys(compact).length) labels[key] = compact; else delete labels[key];
      } else {
        const raw = (input.profiles && typeof input.profiles === 'object' ? input.profiles : {}) as { labels?: Record<string, unknown> };
        invalid(brandingProfilesProblem(raw as never));
        for (const [key, value] of Object.entries(raw.labels || {}).slice(0, 500)) {
          const compact = checked(key, value);
          if (Object.keys(compact).length) labels[key] = compact;
        }
      }
      const next = Object.keys(labels).length ? { labels } : {};
      t.update(ref, { brandingProfiles: next, updatedAt: new Date().toISOString() });
      await writeServerAuditLog({
        workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email || '',
        action: 'BRANDING_PROFILES_UPDATED', entityType: 'workspace', entityId: ctx.workspaceId,
        details: { description: 'Branding per label changed', labels: Object.keys(labels) },
      }, { db: ctx.db, tx: t });
      return next;
    });
    return { profiles };
  },
  async preview(_ctx, input) {
    const labels = Object.keys(((input.profiles || {}) as { labels?: object }).labels || {});
    return { title: 'Save the branding per label', lines: [labels.length ? `Labels with their own branding: ${labels.join(', ')}` : 'No label overrides: every document uses the books\' branding'] };
  },
  audit() { return null; },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Save the branding a label (for example one property or one shop) prints on its documents instead of the books\' branding; it changes what documents look like, never what they say.',
    example: { profiles: { labels: { 'property:A': { color: '#0E7C66', footer: 'Building A' } } } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A label key is not "dimension:node", or a label\'s branding fails the branding rules.', next: 'Fix the label or field the answer names.' },
      { code: 'FORBIDDEN', when: 'The caller is a bookkeeper or a viewer.', next: 'Ask an owner or an accountant.' },
    ],
  },
};

export const WORKSPACE_HOUSEKEEPING_COMMANDS: AnyCommandDefinition[] = [
  accountMergeCommand, accountMergePreviewCommand,
  contactMergeCommand, contactDeleteCommand,
  journalTemplateSaveCommand, journalTemplateRemoveCommand,
  twoStepCommand, twoPersonCommand, brandingSaveCommand, brandingProfilesSaveCommand,
  reportSchedulePreviewCommand, reportScheduleSendCommand,
  portalLinkCreateCommand, portalLinkRevokeCommand, signLinkCreateCommand,
];
