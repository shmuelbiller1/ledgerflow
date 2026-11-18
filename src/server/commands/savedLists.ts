/**
 * Saved lists (Q-05 split rules, M-11 price lists, P-13 sales reps, PLAN §6 tax profiles, BC-02 role
 * dashboards, BG-07 approval hand-over, CC-09 payment types, CC-11 customer groups): the eight writes
 * `savedListRoutes.ts` made, each mounted under a workspace and each replacing a list whole.
 *
 * The services already carry every rule — the refusals, the new ids, the audit line — and each opens
 * its own transaction, so `audit` answers null: the service's own line, written inside that
 * transaction, stays the only one, exactly as the legacy routes left it. The commands add the
 * registered door the checklist asks for (the runner's workspace and role gates run first) and the
 * legacy `{ status: 'success', ... }` / `{ status: 'error', message }` answers stay in the route.
 *
 * The legacy routes gated these with `requireWorkspaceRole(['owner','accountant'])` before parsing the
 * body, so every command's roles are owners and accountants — and each service checks the role again
 * inside its own transaction, so a demotion between the two still refuses.
 */
import { z } from 'zod';
import type { CommandContext, CommandDefinition, CommandDescription, CommandPreview } from './types';
import { setAllocationRules } from '../services/allocationRuleService';
import { setPriceLists } from '../services/priceListService';
import { setSalesReps } from '../services/salesRepService';
import { setTaxProfiles } from '../services/taxProfileService';
import { setRoleDashboard } from '../services/roleDashboardService';
import { setApprovalDelegate } from '../services/approvalDelegateService';
import { changePaymentTypes } from '../services/paymentTypeService';
import { changeCustomerGroups } from '../services/customerGroupService';

const KEEPERS = ['owner', 'accountant'] as const;

/**
 * The body every one of these routes reads: the list itself (or the one change), plus the workspace
 * for the runner. The service validates the list, so the command does not re-describe it — a second
 * schema here would be a second answer to "what is a valid rule", and the route has always let the
 * service give the only one.
 */
const listBody = z.object({
  /** The legacy URL carried the workspace; the route reads it there and passes it in. */
  workspaceId: z.string().min(1).max(200).optional(),
}).passthrough();

/** What a saved-list command needs beyond the shared shape: its name, its words, and the service call. */
interface SavedListSpec<Result> {
  name: `${string}.${string}`;
  describe: CommandDescription;
  preview(body: Readonly<Record<string, unknown>>): CommandPreview;
  run(ctx: CommandContext, body: Readonly<Record<string, unknown>>): Promise<Result>;
}

/**
 * The eight writes share one shape: owner or accountant, a list the service replaces whole, one audit
 * line the service writes, nothing to undo (the previous list is in the audit line, not a command).
 */
function savedListCommand<Result>(spec: SavedListSpec<Result>): CommandDefinition<typeof listBody, Result> {
  return {
    name: spec.name,
    input: listBody,
    roles: KEEPERS,
    async handler(ctx, _tx, input) {
      return spec.run(ctx, input as Record<string, unknown>);
    },
    async preview(_ctx, input) {
      return spec.preview(input as Record<string, unknown>);
    },
    audit() { return null; },
    inverse() { return null; },
    risk: 'normal',
    describe: spec.describe,
  };
}

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

// --------------------------------------------------------------------------- split rules (Q-05)

export const allocationRulesSaveCommand = savedListCommand({
  name: 'savedlist.allocationrules',
  run: (ctx, body) => setAllocationRules(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, rules: body.rules,
  }) as Promise<{ rules: unknown }>,
  preview(body) {
    return {
      title: 'Save the split rules',
      lines: [`${count(body.rules)} rule(s) replace the workspace's split rules`, 'Saving writes one audit line'],
    };
  },
  describe: {
    sentence: "Replace the workspace's split rules, which decide how an expense is spread over accounts; do not use it to change one bill — set its lines instead.",
    example: { rules: [{ id: 'ar_1', name: 'Half and half', match: 'rent', shares: [{ percent: 50 }, { percent: 50 }] }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A rule has no name or match, or its shares do not add up.', next: 'Fix the named rule; shares add up to 100.' },
      { code: 'NOT_FOUND', when: 'The workspace is not found.', next: 'Check the workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

// --------------------------------------------------------------------------- price lists (M-11)

export const priceListsSaveCommand = savedListCommand({
  name: 'savedlist.pricelists',
  run: (ctx, body) => setPriceLists(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, lists: body.lists,
  }) as Promise<{ lists: unknown }>,
  preview(body) {
    return {
      title: 'Save the price lists',
      lines: [`${count(body.lists)} list(s) replace the workspace's price lists`, 'Saving writes one audit line'],
    };
  },
  describe: {
    sentence: "Replace the workspace's price lists, which set an item's price for a customer group or currency; do not use it to change one invoice line.",
    example: { lists: [{ id: 'pl_1', name: 'Wholesale', currency: 'USD', items: [{ itemId: 'item_1', unitPriceCents: 900 }] }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A list has no name, or an entry has no price.', next: 'Fix the named list.' },
      { code: 'NOT_FOUND', when: 'The workspace is not found.', next: 'Check the workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

// --------------------------------------------------------------------------- sales reps (P-13)

export const salesRepsSaveCommand = savedListCommand({
  name: 'savedlist.salesreps',
  run: (ctx, body) => setSalesReps(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, reps: body.reps,
  }) as Promise<{ reps: unknown }>,
  preview(body) {
    return {
      title: 'Save the sales reps',
      lines: [`${count(body.reps)} rep(s) replace the workspace's sales reps`, 'Saving writes one audit line'],
    };
  },
  describe: {
    sentence: "Replace the workspace's sales reps, whom an invoice can credit; do not use it to change a person's sign-in — that is a workspace role.",
    example: { reps: [{ id: 'rep_1', name: 'Dana Levi' }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A rep has no name.', next: 'Give each rep a name.' },
      { code: 'NOT_FOUND', when: 'The workspace is not found.', next: 'Check the workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

// --------------------------------------------------------------------------- tax profiles (PLAN §6)

export const taxProfilesSaveCommand = savedListCommand({
  name: 'savedlist.taxprofiles',
  run: (ctx, body) => setTaxProfiles(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, profiles: body.profiles,
  }) as Promise<{ profiles: unknown }>,
  preview(body) {
    return {
      title: 'Save the tax profiles',
      lines: [`${count(body.profiles)} profile(s) replace the workspace's tax profiles`, 'Saving writes one audit line'],
    };
  },
  describe: {
    sentence: "Replace the tax profiles the books and label values use, each a rate and the accounts it posts to; do not use it to re-file a tax return.",
    example: { profiles: [{ id: 'vat17', name: 'VAT 17%', ratePercent: 17, liabilityAccountId: 'acc_vat' }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A profile has no name or rate, or names an account that is not in the books.', next: 'Fix the named profile and its account.' },
      { code: 'NOT_FOUND', when: 'The workspace is not found.', next: 'Check the workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

// --------------------------------------------------------------------------- role dashboards (BC-02)

export const roleDashboardSaveCommand = savedListCommand({
  name: 'savedlist.roledashboard',
  run: (ctx, body) => setRoleDashboard(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, role: body.role, layout: body.layout ?? null,
  }) as Promise<{ roleDashboards: unknown }>,
  preview(body) {
    return {
      title: `Save the ${String(body.role || 'role')} starting dashboard`,
      lines: ['People with that role start here', 'Saving writes one audit line'],
    };
  },
  describe: {
    sentence: "Set the dashboard a role starts on when someone opens the workspace; do not use it to change a person's own layout.",
    example: { role: 'owner', layout: ['cash', 'profit'] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The role is missing or unknown, or the layout is not a list.', next: 'Name a real role and send a layout array.' },
      { code: 'NOT_FOUND', when: 'The workspace is not found.', next: 'Check the workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

// --------------------------------------------------------------------------- approval hand-over (BG-07)

export const approvalDelegateSaveCommand = savedListCommand({
  name: 'savedlist.approvaldelegate',
  run: (ctx, body) => setApprovalDelegate(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email,
    to: body.to, until: body.until, clear: body.clear === true,
  }) as Promise<{ approvalDelegates: unknown }>,
  preview(body) {
    return body.clear === true
      ? { title: 'Take the hand-over back', lines: ['You approve your own invoices again', 'Saving writes one audit line'] }
      : {
        title: `Hand invoice approvals to ${String(body.to || 'someone')}`,
        lines: [`Until ${String(body.until || 'the date you chose')}`, 'Saving writes one audit line'],
      };
  },
  describe: {
    sentence: 'Hand your invoice approvals to another person until a date, or take the hand-over back; do not use it to give someone a role.',
    example: { to: 'uid_accountant', until: '2026-12-31' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The person is missing, or the date is not a real future day and clear is not set.', next: 'Send to and until, or clear: true.' },
      { code: 'NOT_FOUND', when: 'The workspace, or the person in it, is not found.', next: 'Choose a member of this workspace.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

// --------------------------------------------------------------------------- payment types (CC-09)

export const paymentTypesChangeCommand = savedListCommand({
  name: 'savedlist.paymenttype',
  run: (ctx, body) => changePaymentTypes(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, change: body as never,
  }) as Promise<{ paymentTypes: unknown }>,
  preview(body) {
    return {
      title: `Payment types: ${String(body.op || 'change')} ${String(body.name || '')}`.trim(),
      lines: ['One change at a time', 'Saving writes one audit line'],
    };
  },
  describe: {
    sentence: "Add, rename or remove one of the workspace's payment types; do not use it to record a payment.",
    example: { op: 'add', name: 'Cheque', method: 'cheque' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The operation is unknown, the name is empty, or the method is not a payment method.', next: 'Send add, rename or remove with the fields it needs.' },
      { code: 'CONFLICT', when: 'The name is already a payment type, or the type is in use.', next: 'Choose another name, or keep a type that payments use.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

// --------------------------------------------------------------------------- customer groups (CC-11)

export const customerGroupsChangeCommand = savedListCommand({
  name: 'savedlist.customergroup',
  run: (ctx, body) => changeCustomerGroups(ctx.db, {
    workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, change: body as never,
  }) as Promise<{ customerGroups: unknown }>,
  preview(body) {
    return {
      title: `Customer groups: ${String(body.op || 'change')} ${String(body.name || '')}`.trim(),
      lines: ['One change at a time', 'Saving writes one audit line'],
    };
  },
  describe: {
    sentence: "Add, rename, re-price or remove one of the workspace's customer groups; do not use it to move a customer to another group.",
    example: { op: 'add', name: 'Wholesale', paymentTerms: 30 },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The operation is unknown or a required field is missing.', next: 'Send add, rename, setTerms or remove with the fields it needs.' },
      { code: 'CONFLICT', when: 'The name is already a group, or the group still has customers.', next: 'Choose another name, or move its customers first.' },
      { code: 'FORBIDDEN', when: 'The caller is not an owner or an accountant.', next: 'Ask an owner or an accountant.' },
    ],
  },
});

/** Every saved-list command this batch registers. */
export const SAVED_LIST_COMMANDS = [
  allocationRulesSaveCommand,
  priceListsSaveCommand,
  salesRepsSaveCommand,
  taxProfilesSaveCommand,
  roleDashboardSaveCommand,
  approvalDelegateSaveCommand,
  paymentTypesChangeCommand,
  customerGroupsChangeCommand,
];
