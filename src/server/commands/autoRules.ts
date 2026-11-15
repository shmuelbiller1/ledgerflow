import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandContext, CommandDefinition } from './types';

const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const optionalText = (max = 200) => z.string().max(max).optional();
const amount = z.number().finite().optional();

const conditionSchema = z.object({
  vendor: optionalText(),
  project: optionalText(),
  category: optionalText(),
  descriptionContains: optionalText(),
  descriptionStartsWith: optionalText(),
  amountThreshold: amount,
  exactAmount: amount,
  minAmountCents: amount,
  maxAmountCents: amount,
  dateRange: z.object({ start: z.string().max(40), end: z.string().max(40) }).strict().optional(),
}).strict();

const actionSchema = z.object({
  type: z.literal('categorize').optional(),
  targetAccountId: idSchema.optional(),
  targetTransactionKind: z.enum(['expense', 'transfer']).optional(),
  bankAccountId: idSchema.optional(),
  contactId: idSchema.optional(),
  targetNodeId: idSchema.optional(),
  targetProject: optionalText(),
  targetCategory: optionalText(),
  targetClass: idSchema.optional(),
  targetLocation: idSchema.optional(),
  targetDimensions: z.record(z.string(), z.string()).optional(),
  targetTags: z.array(z.string().max(200)).max(100).optional(),
  flagForReview: z.boolean().optional(),
  descriptionPrefix: z.string().max(500).optional(),
  descriptionSuffix: z.string().max(500).optional(),
  setNotes: z.string().max(5000).optional(),
  addTags: z.array(z.string().max(200)).max(100).optional(),
  removeTags: z.array(z.string().max(200)).max(100).optional(),
  setAmountCents: z.number().int().safe().optional(),
  deleteTransaction: z.boolean().optional(),
}).strict();

const mutableRuleFields = {
  name: optionalText(200),
  groupName: z.string().min(1).max(120).optional(),
  groupIsActive: z.boolean().optional(),
  condition: conditionSchema,
  action: actionSchema,
  confidence: z.number().min(0).max(1).optional(),
  isHardened: z.boolean().optional(),
  priority: z.number().int().safe().optional(),
  isActive: z.boolean().optional(),
  stopProcessingOnMatch: z.boolean().optional(),
};
const createRuleData = z.object({
  id: idSchema.optional(),
  ...mutableRuleFields,
}).strict().refine(rule => rule.condition !== undefined && rule.action !== undefined, 'A rule condition and action are required.');
const updateRuleData = z.object(mutableRuleFields).strict().partial()
  .refine(data => Object.keys(data).length > 0, 'Provide at least one rule field.');

export const autoRuleCreateInput = z.object({ rule: createRuleData }).strict();
export const autoRuleUpdateInput = z.object({ id: idSchema, data: updateRuleData }).strict();
export const autoRuleDeleteInput = z.object({ id: idSchema }).strict();
export const autoRuleGroupInput = z.object({
  groupName: z.string().min(1).max(120),
  newName: z.string().trim().min(1).max(120).optional(),
  groupIsActive: z.boolean().optional(),
}).strict().refine(input => (input.newName !== undefined) !== (input.groupIsActive !== undefined), 'Rename a group or change its active state, not both.');
export const autoRuleRecordHitsInput = z.object({
  rules: z.array(z.object({ id: idSchema, hits: z.number().int().positive().safe() }).strict()).min(1).max(1000),
}).strict().refine(input => new Set(input.rules.map(rule => rule.id)).size === input.rules.length, 'Rule ids must be unique.');

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type RuleRecord = Record<string, unknown> & { id: string; workspaceId?: string };
type CreateInput = z.output<typeof autoRuleCreateInput>;
type UpdateInput = z.output<typeof autoRuleUpdateInput>;
type GroupInput = z.output<typeof autoRuleGroupInput>;
type HitInput = z.output<typeof autoRuleRecordHitsInput>;
type RuleResult = { rule: RuleRecord };
type GroupResult = { groupName: string; ruleIds: string[]; groupIsActive?: boolean };
type HitResult = { updated: Array<{ id: string; hitCount: number; lastTriggeredAt: string }> };

type ReadContext = Omit<CommandContext, 'prepared' | 'afterCommit'>;

function readWorkspaceRules(ctx: CommandContext, tx: import('../db/firestore').Transaction): Promise<{ id: string; data: Record<string, unknown> }[]> {
  return tx.get(ctx.db.collection('autoRules').where('workspaceId', '==', ctx.workspaceId))
    .then(snapshot => snapshot.docs.map(row => ({ id: row.id, data: row.data() || {} })));
}

function groupOf(rule: Record<string, unknown>): string {
  return typeof rule.groupName === 'string' && rule.groupName ? rule.groupName : 'General';
}

function resultFrom(rule: Record<string, unknown>, id: string, workspaceId: string): RuleRecord {
  return { ...rule, id, workspaceId } as RuleRecord;
}

function updateRef(ctx: CommandContext, tx: import('../db/firestore').Transaction, id: string, data: Record<string, unknown>): void {
  tx.update(ctx.db.collection('autoRules').doc(id), data);
}

function commandDescription(action: string, example: unknown) {
  return {
    sentence: `Manage workspace automation rules with server-side membership and workspace checks; do not use this command to apply a rule to ledger entries.`,
    example,
    refusals: [
      { code: 'INVALID_INPUT', when: 'The rule or group input is malformed or exceeds supported limits.', next: 'Correct the rule fields and retry.' },
      { code: 'NOT_FOUND', when: 'The rule or group is not in the selected workspace.', next: 'Reload the rules list and choose an existing rule or group.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      ...(action === 'create' || action === 'group' ? [{ code: 'CONFLICT', when: 'A rule id or group name is already in use.', next: 'Choose a different id or group name.' }] : []),
    ],
  };
}

const createExample = { rule: { name: 'Office supplies', condition: { descriptionContains: 'Paper Co' }, action: { targetAccountId: 'expense_supplies' }, confidence: 1, isHardened: true } };

export const autoRuleCreateCommand: CommandDefinition<typeof autoRuleCreateInput, RuleResult> = {
  name: 'autorule.create',
  input: autoRuleCreateInput,
  roles: ROLES,
  async handler(ctx, tx, input: CreateInput) {
    const fields = input.rule;
    const id = fields.id || ctx.db.collection('autoRules').doc().id;
    const ref = ctx.db.collection('autoRules').doc(id);
    if ((await tx.get(ref)).exists) throw Object.assign(new HttpError('This rule id already exists.', 409), { code: 'DUPLICATE_RECORD' });
    const groupName = fields.groupName || 'General';
    const workspaceRules = await readWorkspaceRules(ctx, tx);
    const groupIsActive = !workspaceRules.some(rule => groupOf(rule.data) === groupName && rule.data.groupIsActive === false);
    const now = new Date().toISOString();
    const record = {
      ...fields,
      id,
      uid: ctx.actor,
      workspaceId: ctx.workspaceId,
      name: fields.name || `Rule: ${fields.condition.descriptionContains || fields.condition.vendor || 'Untitled'}`,
      groupName,
      groupIsActive,
      confidence: fields.confidence ?? 1,
      isHardened: fields.isHardened ?? true,
      priority: fields.priority ?? 100,
      isActive: fields.isActive ?? true,
      stopProcessingOnMatch: fields.stopProcessingOnMatch ?? false,
      hitCount: 0,
      createdAt: now,
    };
    tx.create(ref, record);
    return { rule: resultFrom(record, id, ctx.workspaceId) };
  },
  async preview(_ctx: ReadContext, input) {
    return { title: `Create rule ${input.rule.name || input.rule.condition.descriptionContains || input.rule.condition.vendor || 'Untitled'}`, lines: [input.rule.groupName || 'General'] };
  },
  audit(_input, result) {
    return { action: 'AUTO_RULE_CREATED', entityType: 'autoRules', entityId: result.rule.id, description: `Created rule "${String(result.rule.name || result.rule.id)}"` };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: commandDescription('create', createExample),
};

export const autoRuleUpdateCommand: CommandDefinition<typeof autoRuleUpdateInput, RuleResult> = {
  name: 'autorule.update',
  input: autoRuleUpdateInput,
  roles: ROLES,
  async handler(ctx, tx, input: UpdateInput) {
    const ref = ctx.db.collection('autoRules').doc(input.id);
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (!snapshot.exists || current?.workspaceId !== ctx.workspaceId) throw Object.assign(new HttpError('Rule not found in this workspace.', 404), { code: 'NOT_FOUND' });
    const patch = { ...input.data, updatedAt: new Date().toISOString() };
    tx.update(ref, patch);
    return { rule: resultFrom({ ...current, ...patch }, input.id, ctx.workspaceId) };
  },
  async preview(ctx, input) {
    const snapshot = await ctx.db.collection('autoRules').doc(input.id).get();
    const current = snapshot.data();
    if (!snapshot.exists || current?.workspaceId !== ctx.workspaceId) throw new HttpError('Rule not found in this workspace.', 404);
    return { title: `Update rule ${String(input.data.name || current.name || input.id)}`, lines: Object.keys(input.data).sort((a, b) => a.localeCompare(b)) };
  },
  audit(_input, result) {
    return { action: 'AUTO_RULE_UPDATED', entityType: 'autoRules', entityId: result.rule.id, description: `Updated rule "${String(result.rule.name || result.rule.id)}"` };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: commandDescription('update', { id: 'rule_123', data: { priority: 10, isActive: true } }),
};

export const autoRuleDeleteCommand: CommandDefinition<typeof autoRuleDeleteInput, { id: string }> = {
  name: 'autorule.delete',
  input: autoRuleDeleteInput,
  roles: ROLES,
  async handler(ctx, tx, input) {
    const ref = ctx.db.collection('autoRules').doc(input.id);
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (!snapshot.exists || current?.workspaceId !== ctx.workspaceId) throw Object.assign(new HttpError('Rule not found in this workspace.', 404), { code: 'NOT_FOUND' });
    tx.delete(ref);
    return { id: input.id };
  },
  async preview(ctx, input) {
    const snapshot = await ctx.db.collection('autoRules').doc(input.id).get();
    const current = snapshot.data();
    if (!snapshot.exists || current?.workspaceId !== ctx.workspaceId) throw new HttpError('Rule not found in this workspace.', 404);
    return { title: `Delete rule ${String(current.name || input.id)}`, lines: ['No ledger entries are changed.'] };
  },
  audit(_input, result) {
    return { action: 'AUTO_RULE_DELETED', entityType: 'autoRules', entityId: result.id, description: `Deleted rule "${result.id}"` };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: commandDescription('delete', { id: 'rule_123' }),
};

export const autoRuleGroupCommand: CommandDefinition<typeof autoRuleGroupInput, GroupResult> = {
  name: 'autorule.group',
  input: autoRuleGroupInput,
  roles: ROLES,
  async handler(ctx, tx, input: GroupInput) {
    const rules = await readWorkspaceRules(ctx, tx);
    const members = rules.filter(rule => groupOf(rule.data) === input.groupName);
    if (!members.length) throw Object.assign(new HttpError('This group no longer contains rules.', 404), { code: 'NOT_FOUND' });
    if (input.newName && input.newName !== input.groupName && rules.some(rule => groupOf(rule.data) === input.newName)) {
      throw Object.assign(new HttpError('That group already exists. Choose another name.', 409), { code: 'CONFLICT' });
    }
    const now = new Date().toISOString();
    const patch = input.newName !== undefined
      ? { groupName: input.newName, updatedAt: now }
      : { groupIsActive: input.groupIsActive, updatedAt: now };
    members.forEach(rule => updateRef(ctx, tx, rule.id, patch));
    return {
      groupName: input.newName ?? input.groupName,
      ruleIds: members.map(rule => rule.id),
      ...(input.groupIsActive !== undefined ? { groupIsActive: input.groupIsActive } : {}),
    };
  },
  async preview(ctx, input) {
    const snapshot = await ctx.db.collection('autoRules').where('workspaceId', '==', ctx.workspaceId).get();
    const members = snapshot.docs.filter(row => groupOf(row.data() || {}) === input.groupName);
    if (!members.length) throw new HttpError('This group no longer contains rules.', 404);
    return { title: input.newName ? `Rename rule group ${input.groupName}` : `${input.groupIsActive ? 'Enable' : 'Pause'} rule group ${input.groupName}`, lines: [`${members.length} rule(s)`, ...(input.newName ? [`New name: ${input.newName}`] : [])] };
  },
  audit(input, result) {
    return {
      action: input.newName ? 'AUTO_RULE_GROUP_RENAMED' : 'AUTO_RULE_GROUP_UPDATED',
      entityType: 'autoRules',
      entityId: result.ruleIds[0] || result.groupName,
      description: input.newName ? `Renamed rule group "${input.groupName}" to "${input.newName}"` : `Updated rule group "${result.groupName}"`,
      details: { groupName: result.groupName, ruleCount: result.ruleIds.length, ...(input.groupIsActive !== undefined ? { groupIsActive: input.groupIsActive } : {}) },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: commandDescription('group', { groupName: 'General', groupIsActive: false }),
};

export const autoRuleRecordHitsCommand: CommandDefinition<typeof autoRuleRecordHitsInput, HitResult> = {
  name: 'autorule.recordhits',
  input: autoRuleRecordHitsInput,
  roles: ROLES,
  async handler(ctx, tx, input: HitInput) {
    const snapshots = await Promise.all(input.rules.map(rule => tx.get(ctx.db.collection('autoRules').doc(rule.id))));
    const updates = input.rules.map((rule, index) => {
      const snapshot = snapshots[index];
      const current = snapshot.data();
      if (!snapshot.exists || current?.workspaceId !== ctx.workspaceId) throw Object.assign(new HttpError('Rule not found in this workspace.', 404), { code: 'NOT_FOUND' });
      const hitCount = Number(current.hitCount || 0) + rule.hits;
      if (!Number.isSafeInteger(hitCount)) throw new HttpError('Rule hit count exceeds the supported range.', 409);
      return { id: rule.id, hitCount, lastTriggeredAt: new Date().toISOString() };
    });
    updates.forEach(update => updateRef(ctx, tx, update.id, { hitCount: update.hitCount, lastTriggeredAt: update.lastTriggeredAt }));
    return { updated: updates };
  },
  async preview(_ctx, input) {
    return { title: 'Record rule matches', lines: [`${input.rules.reduce((sum, rule) => sum + rule.hits, 0)} match(es) across ${input.rules.length} rule(s)`] };
  },
  audit(_input, result) {
    return { action: 'AUTO_RULE_HITS_RECORDED', entityType: 'autoRules', entityId: result.updated[0]?.id || 'rules', description: `Recorded matches for ${result.updated.length} rule(s)`, details: { rules: result.updated } };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: commandDescription('hits', { rules: [{ id: 'rule_123', hits: 3 }] }),
};
