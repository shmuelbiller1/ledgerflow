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
