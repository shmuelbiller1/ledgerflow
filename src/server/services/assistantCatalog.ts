import { z } from 'zod';
import { toGeminiDeclaration, type GeminiToolDeclaration } from '../../../assistant/gemini';
import { byCodeUnit } from '../../lib/codeUnitOrder';
import type { RequestUser } from '../auth/requestUser';
import { stepCommand, stepCommandNames } from '../commands/sandboxStepCommands';
import type { AnyCommandDefinition } from '../commands/types';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { assertWorkspaceActiveForCommand, CommandRefusal } from '../utils/commandExecutor';
import { ASSISTANT_TOOL_LIMIT, commandToolSpec, geminiReadTools } from './assistantToolDefinitions';

const preferred = [
  'invoice.create', 'invoice.update', 'customer.create', 'customer.update', 'vendor.create', 'vendor.update',
  'bill.create', 'bill.update', 'payment.receive', 'journal.create', 'estimate.save', 'tasks.create',
  'project.create', 'chartaccount.create', 'inventoryitem.save',
];

export function draftableCommands(workspace: Record<string, unknown>, user: RequestUser, issuedRole?: string) {
  const role = roleInWorkspace(workspace, user.uid);
  if (!LEDGER_WRITER_ROLES.includes(role) || (issuedRole !== undefined && !LEDGER_WRITER_ROLES.includes(issuedRole))) return [];
  if (workspace.requireTwoStep === true && user.aal !== 'aal2') return [];
  try { assertWorkspaceActiveForCommand(workspace, 'sandbox.review'); }
  catch (error) { if (error instanceof CommandRefusal) return []; throw error; }
  return stepCommandNames().map(stepCommand).filter(command =>
    command.roles.some(r => r === role) && (issuedRole === undefined || command.roles.some(r => r === issuedRole)));
}

const declarations = new WeakMap<AnyCommandDefinition, GeminiToolDeclaration>();
function declaration(command: AnyCommandDefinition) {
  let tool = declarations.get(command);
  if (!tool) {
    tool = toGeminiDeclaration(commandToolSpec({ name: command.name, risk: command.risk, description: command.describe,
      inputSchema: z.toJSONSchema(command.input, { io: 'input', unrepresentable: 'any' }) }));
    declarations.set(command, tool);
  }
  return tool;
}

export function defaultAssistantTools(commands: readonly AnyCommandDefinition[]) {
  const byName = new Map(commands.map(command => [String(command.name), command]));
  const names = [...new Set([...preferred, ...byName.keys()])];
  return [{ functionDeclarations: [
    ...geminiReadTools,
    ...names.flatMap(name => byName.has(name) ? [byName.get(name)!] : [])
      .slice(0, ASSISTANT_TOOL_LIMIT - geminiReadTools.length).map(declaration),
  ] }];
}

/**
 * SBX-2 Part 5: the areas a question is about, read from its words. Each entry names the command areas
 * (the part of a command name before the dot) whose commands are offered for that word. The list is
 * written out, not learned, so the choice can be read and tested. Words that match nothing offer no
 * command at all: the read tools and `find_command` are always there, so a vague or read-only question
 * costs only the read tools, and the model can still reach any command through `find_command`.
 */
export const QUESTION_AREAS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\b(invoices?|invoic\w*|bill(ed)? (the |a )?(customer|client)|charge (the |a )?(customer|client)|write ?offs?|written off|bad debts?)\b/i, ['invoice', 'customer', 'creditnote']],
  [/\b(customers?|clients?)\b/i, ['customer', 'invoice', 'contact']],
  [/\b(bills?|suppliers?|vendors?|purchases?)\b/i, ['bill', 'vendor', 'vendorcredit']],
  [/\b(pay|paid|payments?|receipts?|received|deposits?|refunds?|settle)\b/i, ['payment', 'invoice', 'bill']],
  [/\b(credit notes?|credit memos?|vendor credits?)\b/i, ['creditnote', 'vendorcredit', 'payment']],
  [/\b(estimates?|quotes?|quotations?)\b/i, ['estimate', 'customer']],
  [/\b(journals?|entries|entry|reclass\w*|recategori[sz]\w*|accruals?|reverse|reversal|intercompany)\b/i, ['journal', 'journaltemplate', 'chartaccount']],
  [/\b(accounts?|chart of accounts|ledger accounts?)\b/i, ['chartaccount']],
  [/\b(inventory|stock|sku|items?|products?|units?|warehouses?|landed cost|cogs|returns?|rma|warrant(y|ies))\b/i, ['inventory', 'inventoryitem', 'rma', 'warranty']],
  [/\b(assets?|depreciat\w*|equipment|dispos\w*)\b/i, ['asset']],
  [/\b(budgets?)\b/i, ['budget']],
  [/\b(projects?|jobs?)\b/i, ['project', 'time', 'tasks']],
  [/\b(time|hours?|timesheets?)\b/i, ['time', 'project']],
  [/\b(tasks?|to-?dos?|reminders?)\b/i, ['tasks']],
  [/\b(employees?|staff|payroll|salar(y|ies))\b/i, ['employee']],
  [/\b(loans?|mortgages?)\b/i, ['loan']],
  [/\b(rules?|automat\w*)\b/i, ['autorule']],
  [/\b(tags?|labels?|links?)\b/i, ['tag', 'entrylink']],
  [/\b(documents?|attachments?|uploads?)\b/i, ['document', 'record']],
  [/\b(watch\w*|alerts?|notify)\b/i, ['watches']],
  [/\b(merge|duplicates?|contacts?)\b/i, ['contact']],
  [/\b(recurring|every month|monthly|templates?)\b/i, ['journaltemplate', 'invoice', 'bill']],
];

/** The command areas a question names, in the order of QUESTION_AREAS, without repeats. */
export function questionAreas(question: string): string[] {
  const areas: string[] = [];
  for (const [words, named] of QUESTION_AREAS) {
    if (!words.test(question)) continue;
    for (const area of named) if (!areas.includes(area)) areas.push(area);
  }
  return areas;
}

/**
 * The tools offered for one question: the read tools (always, first and in a fixed order, so the start
 * of every request is byte-identical and the provider's prompt cache can hit), then the commands of
 * the question's areas — the commonly used ones first, then by name — up to ASSISTANT_TOOL_LIMIT.
 * Descriptions come from each command's own `describe` (commandToolSpec), never hand-copied.
 */
export function assistantToolsFor(commands: readonly AnyCommandDefinition[], question: string) {
  const areas = questionAreas(question);
  const rank = (name: string) => { const i = preferred.indexOf(name); return i < 0 ? preferred.length : i; };
  const chosen = areas.flatMap(area => commands
    .filter(command => command.name.split('.')[0] === area)
    .sort((a, b) => rank(a.name) - rank(b.name) || byCodeUnit(a.name, b.name)));
  return [{ functionDeclarations: [
    ...geminiReadTools,
    ...[...new Set(chosen)].slice(0, ASSISTANT_TOOL_LIMIT - geminiReadTools.length).map(declaration),
  ] }];
}

const wordsIn = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
// Ignore common connectors, not domain words. Require every remaining search term to match.
const filler = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'with', 'and', 'in', 'how', 'i', 'can']);

export function findAssistantCommands(commands: readonly AnyCommandDefinition[], words: string, limit = 5) {
  const terms = [...new Set(wordsIn(words).filter(word => !filler.has(word)))];
  if (!terms.length) return [];
  return commands.map(command => {
    const name = wordsIn(command.name);
    const description = wordsIn(command.describe.sentence);
    const score = terms.map(term => {
      const stem = term.length > 4 ? term.replace(/s$/, '') : term;
      if (name.includes(term)) return 8;
      if (name.some(word => word.startsWith(stem))) return 4;
      if (description.some(word => word.startsWith(stem))) return 1;
      return 0;
    });
    return { command, score: score.includes(0) ? 0 : score.reduce<number>((sum, n) => sum + n, 0) };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || byCodeUnit(a.command.name, b.command.name))
    .slice(0, limit).map(({ command }) => ({ command: command.name, tool: declaration(command) }));
}
