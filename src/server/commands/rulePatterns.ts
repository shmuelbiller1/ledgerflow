import { z } from 'zod';
import { learnedPatternId } from '../../lib/learnedPatterns';
import type { CommandContext, CommandDefinition } from './types';

/**
 * A learned pattern: "this description was filed to this account".
 *
 * The browser used to keep the count itself — it read the cached copy, added one, and wrote the whole
 * record back with `setDoc(..., { merge: true })`. Two tabs, or the same tab twice before the cache
 * refreshed, both wrote the same count, so the pattern that should have read 5 read 3; and the merge
 * of tags and dimensions was decided by a cache that only holds the patterns the open page has seen.
 * The count and the merge are the workspace's record, so the server keeps them, in one transaction.
 */
const idSchema = z.string().trim().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');

export const autoRuleLearnInput = z.object({
  /** The description as the person wrote it; the command cleans it the same way the matcher does. */
  description: z.string().trim().min(3).max(500),
  accountId: idSchema,
  accountName: z.string().trim().max(200).optional(),
  /** Labels the matcher should carry next time; the server keeps the first five, as the cache did. */
  tags: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  dimensions: z.record(z.string().max(200), z.string().max(200)).optional(),
}).strict();

const ROLES = ['owner', 'accountant', 'bookkeeper'] as const;
type LearnInput = z.output<typeof autoRuleLearnInput>;
type PatternRecord = { id: string; description: string; accountId: string; accountName?: string; count: number; tags: string[]; dimensions?: Record<string, string>; lastUpdated: string };
type LearnResult = { pattern: PatternRecord };

/** The most labels a pattern carries, so a long-lived pattern does not accumulate a whole chart of them. */
const MAX_TAGS = 5;

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordOf(value: unknown): Record<string, string> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => (typeof item === 'string' ? [[key, item]] : [])))
    : {};
}

export const autoRuleLearnCommand: CommandDefinition<typeof autoRuleLearnInput, LearnResult> = {
  name: 'autorule.learn',
  input: autoRuleLearnInput,
  roles: ROLES,
  async handler(ctx: CommandContext, tx, input: LearnInput) {
    // the same cleaning the matcher does — lower-case and trimmed, and nothing else: the id is derived from these
    // characters, so collapsing inner spaces here would start a second pattern for a description that already has
    // one, and would disagree with the key the screen's own cache is filed under
    const description = input.description.toLowerCase().trim();
    const patternId = learnedPatternId(description);
    const id = `${ctx.workspaceId}_${patternId}`;
    const ref = ctx.db.collection('rulePatterns').doc(id);
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : {};

    const tags = Array.from(new Set([...stringsOf(current.tags), ...(input.tags || [])])).slice(0, MAX_TAGS);
    const dimensions = { ...recordOf(current.dimensions), ...(input.dimensions || {}) };
    const count = (typeof current.count === 'number' && Number.isFinite(current.count) ? current.count : 0) + 1;
    const now = new Date().toISOString();

    const record: Record<string, unknown> = {
      uid: ctx.actor,
      workspaceId: ctx.workspaceId,
      description,
      accountId: input.accountId,
      accountName: input.accountName || input.accountId,
      tags,
      count,
      lastUpdated: now,
    };
    // `undefined` is not a value in the table: a pattern with no labels keeps no field, as it did before
    if (Object.keys(dimensions).length > 0) record.dimensions = dimensions;

    tx.set(ref, record, { merge: true });

    // the same event in the shape the categorisation models read; without it a pattern is learnt for the
    // screen and not for the models that suggest the next one
    tx.set(ctx.db.collection('learnedDeltas').doc(id), {
      id,
      uid: ctx.actor,
      workspaceId: ctx.workspaceId,
      // the classifier reads `human_web_console` for everything the web console teaches; a delta under any other
      // id would be written and never trained on, and would relabel an existing one out of the training set
      apiKeyId: 'human_web_console',
      description: description.slice(0, 500),
      category: (input.accountName || 'General').slice(0, 100),
      timestamp: now,
    }, { merge: true });

    return { pattern: { id, description, accountId: input.accountId, accountName: record.accountName as string, count, tags, dimensions: Object.keys(dimensions).length ? dimensions : undefined, lastUpdated: now } };
  },
  async preview(ctx: CommandContext, input: LearnInput) {
    const description = input.description.toLowerCase().trim();
    const snapshot = await ctx.db.collection('rulePatterns').doc(`${ctx.workspaceId}_${learnedPatternId(description)}`).get();
    const count = snapshot.exists && typeof snapshot.data()?.count === 'number' ? snapshot.data()!.count as number : 0;
    return {
      title: `Learn "${description}"`,
      lines: [`Files to ${input.accountName || input.accountId}`, `Seen ${count + 1} time${count === 0 ? '' : 's'}`],
    };
  },
  audit(input: LearnInput, result: LearnResult) {
    return {
      action: 'RULE_PATTERN_LEARNED',
      entityType: 'rulePatterns',
      entityId: result.pattern.id,
      description: `Learned "${result.pattern.description}" → ${result.pattern.accountName || result.pattern.accountId} (${result.pattern.count})`,
      details: { accountId: input.accountId, count: result.pattern.count },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Count a description that was filed to an account, so the next entry with that description is suggested the same account; do not use it to change an entry that was already posted.',
    example: { description: 'Paper Co', accountId: 'expense_supplies', accountName: 'Office supplies', tags: ['supplies'] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The description is shorter than three characters, or a label is longer than the record allows.', next: 'Use the description as the bank or the person wrote it, and keep labels short.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
    ],
    next: [
      { command: 'autorule.create', label: 'Turn this into a rule' },
      { command: 'autorule.recordhits', label: 'Record what it matched' },
    ],
  },
};
