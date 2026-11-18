import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

/**
 * The workspace's own settings row: the preferences a person changes in Settings, written as one command.
 *
 * Before this, sixteen screens wrote the `workspaces` row straight from the browser — an `updateDoc` per panel, one
 * for the time zone, one for the fiscal year, one for money display, one per email template, one for each report
 * note. Every one of them had the same three problems, and none of them were visible from a panel:
 *
 * 1. **Any role could write.** The database's rules allow an owner, an accountant or a bookkeeper to write the
 *    workspace row, so a bookkeeper could change the fiscal year or the money format while the panel that offered
 *    it was hidden from them. A command names the roles that may change settings.
 * 2. **Two panels, two writers.** The row is one document; a panel that wrote `{scheduledReports}` and a panel that
 *    wrote `{moneyDisplay}` a moment later both sent whole-field patches without knowing about each other, and a
 *    stale tab could put back a value someone had just changed.
 * 3. **No record.** Nothing said who changed the fiscal year, or when the reminder emails were switched on.
 *
 * What it is **not**: a way to touch the books. Amounts, accounts, postings, taxes and exchange rates are not in the
 * allowlist below and cannot be reached through this command. `dimensions` is absent too: the label axes have
 * `workspace.dimensionaxes`, which knows the rows that carry them. `currency` is allowed **only while the workspace
 * is empty**, because the set-up wizard chooses the home currency before there is anything to read in it; once the
 * workspace holds a document, changing the currency rewrites how every stored amount reads, so the command refuses
 * it (`CONFLICT`) and says so — that is a migration, not a setting.
 *
 * `reportNotes` is the one nested field: the panel writes one note per report and period, and half a dozen reports
 * write their own, so the command merges by key rather than replacing the map.
 */

const text = (max: number) => z.string().trim().max(max);

/** #841: ISO 4217 codes this runtime formats; "ZZZ" or "123" is refused instead of stored as the home currency. */
const ISO_CURRENCIES: ReadonlySet<string> = new Set(
  (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency') ?? [],
);

/** The settings a person changes in Settings, and nothing else. */
const settingsSchema = z.object({
  name: text(120).optional(),
  businessType: text(40).optional(),
  /** the home currency: accepted only while the workspace holds no document (the set-up wizard's step) */
  currency: text(3).length(3).transform(code => code.toUpperCase())
    .refine(code => ISO_CURRENCIES.size === 0 || ISO_CURRENCIES.has(code), 'Use a three-letter ISO 4217 currency code, such as USD or ILS.').optional(),
  timezone: text(80).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  fiscalYearStartDay: z.number().int().min(1).max(28).optional(),
  /** the same three modes the workspace model and the tax calculation know (#841) */
  taxRounding: z.enum(['half_up', 'half_even', 'down']).optional(),
  moneyDisplay: z.record(z.string(), z.unknown()).optional(),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  customFields: z.array(z.unknown()).max(200).optional(),
  defaultAccountMappings: z.record(z.string(), z.unknown()).optional(),
  scheduledReports: z.array(z.unknown()).max(50).optional(),
  matchingThreshold: z.number().min(0).max(1).optional(),
  aiModel: text(80).optional(),
  emailTemplates: z.record(z.string(), z.unknown()).optional(),
  reminderSettings: z.record(z.string(), z.unknown()).optional(),
  invoiceApproval: z.record(z.string(), z.unknown()).optional(),
  /** one note per report and period; `null` deletes that note rather than storing an empty one */
  reportNotes: z.record(z.string(), z.union([z.string().max(2000), z.null()])).optional(),
}).strict();

export const workspaceSettingsInput = settingsSchema;

type SettingsInput = z.output<typeof workspaceSettingsInput>;
type SettingsResult = { workspaceId: string; changed: string[]; updatedAt: string };

const ROLES = ['owner', 'accountant'] as const;
/** the settings whose value is a map keyed by something else (a report and period), so it is merged per key */
const NESTED_MAPS = new Set(['reportNotes']);

/**
 * The collections that make a currency change a migration rather than a setting: every one of them stores
 * amounts in the home currency's minor units (#841: credit notes, payments, assets, stock, pay runs, loans and
 * bank lines were missing, so a USD book with only those could still become JPY and read $1,000.00 as ¥100,000).
 */
const BOOKS = [
  'transactions', 'invoices', 'bills', 'journalEntries', 'creditNotes', 'vendorCredits', 'payments', 'estimates',
  'purchaseOrders', 'assets', 'inventory', 'payRuns', 'loans', 'bankLines',
] as const;

const HAS_BOOKS = 'This workspace already has entries in its books, so its home currency cannot be changed here.';

type Reader = Pick<CommandContext['db'], 'collection'>;

async function booksAreEmpty(db: Reader, workspaceId: string, get: (query: ReturnType<ReturnType<Reader['collection']>['where']>) => Promise<{ docs: Array<{ data(): unknown }> }>): Promise<boolean> {
  for (const collection of BOOKS) {
    const rows = await get(db.collection(collection).where('workspaceId', '==', workspaceId).limit(1));
    if (rows.docs.length > 0) return false;
  }
  // a chart of accounts alone is fine (every new workspace has one); an opening balance is an amount
  const accounts = await get(db.collection('chartAccounts').where('workspaceId', '==', workspaceId));
  return !accounts.docs.some(doc => Number((doc.data() as { openingBalanceCents?: unknown })?.openingBalanceCents) || 0);
}

function currencyChange(input: SettingsInput, workspace: unknown): string | null {
  const next = input.currency?.toUpperCase();
  if (!next) return null;
  const current = String((workspace as { currency?: string } | undefined)?.currency || '').toUpperCase();
  return next === current ? null : next;
}

export const workspaceSettingsCommand: CommandDefinition<typeof workspaceSettingsInput, SettingsResult> = {
  name: 'workspace.settings',
  input: workspaceSettingsInput,
  roles: ROLES,
  async prepare(ctx: CommandContext, input: SettingsInput) {
    // #841: invoice approval is the owner's control over what an accountant may send; an accountant may not loosen it
    if (input.invoiceApproval !== undefined && ctx.role !== 'owner' && !ctx.user.admin) {
      throw Object.assign(new HttpError('Only the workspace owner changes invoice approval.', 403), { code: 'FORBIDDEN' });
    }
    if (!currencyChange(input, ctx.workspace)) return undefined;
    if (!(await booksAreEmpty(ctx.db, ctx.workspaceId, query => query.get()))) {
      throw Object.assign(new HttpError(HAS_BOOKS, 409), { code: 'CONFLICT' });
    }
    return undefined;
  },
  async handler(ctx: CommandContext, tx, input: SettingsInput) {
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw Object.assign(new HttpError('This workspace is no longer open.', 404), { code: 'NOT_FOUND' });
    }
    const updatedAt = new Date().toISOString();
    const before = snapshot.data() as Record<string, unknown>;
    // #841: checked again inside the write, so an entry saved since prepare still stops the change
    if (currencyChange(input, before) && !(await booksAreEmpty(ctx.db, ctx.workspaceId, query => tx.get(query) as never))) {
      throw Object.assign(new HttpError(HAS_BOOKS, 409), { code: 'CONFLICT' });
    }
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      changed.push(key);
      if (NESTED_MAPS.has(key)) {
        // merged here rather than with a dotted key: the map is written whole, so a note another report saved
        // meanwhile stays, and an emptied note is removed instead of being stored as an empty string
        const merged: Record<string, unknown> = { ...((before[key] as Record<string, unknown>) || {}) };
        for (const [entryKey, entry] of Object.entries(value as Record<string, string | null>)) {
          if (entry === null) delete merged[entryKey];
          else merged[entryKey] = entry;
        }
        patch[key] = merged;
      } else {
        patch[key] = key === 'currency' ? String(value).toUpperCase() : value;
      }
    }
    if (changed.length === 0) return { workspaceId: ctx.workspaceId, changed, updatedAt };
    tx.update(ref, { ...patch, updatedAt });
    return { workspaceId: ctx.workspaceId, changed, updatedAt };
  },
  async preview(ctx: CommandContext, input: SettingsInput) {
    const snapshot = await ctx.db.collection('workspaces').doc(ctx.workspaceId).get();
    if (!snapshot.exists) throw new HttpError('This workspace is no longer open.', 404);
    const before = snapshot.data() as Record<string, unknown>;
    const changes = Object.entries(input)
      .filter(([key, value]) => value !== undefined && JSON.stringify(before[key]) !== JSON.stringify(value))
      .map(([key]) => key);
    return {
      title: 'Change workspace settings',
      lines: changes.length ? changes.map(key => `${key} changes`) : ['No setting will change'],
    };
  },
  audit(_input: SettingsInput, result: SettingsResult) {
    if (result.changed.length === 0) return null;
    return {
      action: 'WORKSPACE_SETTINGS_CHANGED',
      entityType: 'workspaces',
      entityId: result.workspaceId,
      description: `Changed ${result.changed.join(', ')}`,
      details: { changed: result.changed },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Change the settings a person manages in Settings — time zone, fiscal year, money display, templates, reminders, schedules, report notes, custom fields, default accounts, AI matching, and (while the books are empty) the home currency; do not use it to change the label axes, which have their own command.',
    example: { timezone: 'America/New_York', fiscalYearStartMonth: 1, paymentTermDays: 30 },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A field is not one of the settings above, or a value is out of range (a fiscal month must be 1–12, a matching threshold 0–1).', next: 'Send only the settings named in the command definition, with values in range.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or an accountant.', next: 'Ask a workspace owner or accountant to change these settings.' },
      { code: 'CONFLICT', when: 'The home currency is being changed in a workspace that already holds transactions, invoices, bills or journal entries.', next: 'Choose the currency while the books are empty; changing it later is a migration of every stored amount.' },
      { code: 'NOT_FOUND', when: 'The workspace no longer exists.', next: 'Choose an existing workspace.' },
    ],
    next: [
      { command: 'workspace.modules', label: 'Choose which screens this workspace shows' },
      { command: 'workspace.dimensionaxes', label: 'Manage the labels' },
    ],
  },
};
