/**
 * SBX-2 Part 1: replays 30 realistic assistant questions and prints, per answer path, the numbers
 * every later SBX-2 part is judged by. Test data only: tool calls are answered from the fixed
 * fixture below, never from a real workspace.
 *
 *   npx tsx scripts/assistant-replay.ts                 # without a model: fixed-prompt size and tools offered
 *   ASSISTANT_REPLAY_MODEL=gpt-6-luna \
 *   ASSISTANT_REPLAY_BASE_URL=https://api.arena.ai/v1 \
 *   npx tsx scripts/assistant-replay.ts --write          # with a model; --write saves docs/assistant-baseline.md
 *
 * The key is never read here: the session's network proxy adds it for the configured host.
 */
import fs from 'node:fs';
import type { FunctionDeclaration } from '@google/genai';
import { defaultAssistantTools, findAssistantCommands } from '../src/server/services/assistantCatalog';
import { stepCommand, stepCommandNames } from '../src/server/commands/sandboxStepCommands';
import { type AssistantTurnMetric, type ModelClient } from '../src/server/services/assistantTurn';
import { answerTurn } from '../src/server/services/assistantRouter';
import { openAiCompatibleClient } from '../src/server/services/openAiCompatibleClient';

/** `code` = the books can answer it exactly (Part 2 should answer without a model); `model` = needs the model. */
export const REPLAY_QUESTIONS: ReadonlyArray<{ q: string; kind: 'code' | 'model'; area: string }> = [
  { q: 'What is my cash balance?', kind: 'code', area: 'balances' },
  { q: 'How much is in the bank account today?', kind: 'code', area: 'balances' },
  { q: 'Who owes me money?', kind: 'code', area: 'receivables' },
  { q: 'How much do customers owe in total?', kind: 'code', area: 'receivables' },
  { q: 'Which invoices are overdue?', kind: 'code', area: 'receivables' },
  { q: 'Show invoice INV-1001.', kind: 'code', area: 'invoices' },
  { q: 'Is invoice INV-1002 paid?', kind: 'code', area: 'invoices' },
  { q: 'What were my sales this month?', kind: 'code', area: 'reports' },
  { q: 'What did I spend last month?', kind: 'code', area: 'reports' },
  { q: 'Run the profit and loss for this year.', kind: 'code', area: 'reports' },
  { q: 'Show the balance sheet at the end of last month.', kind: 'code', area: 'reports' },
  { q: 'Explain the revenue number on my dashboard.', kind: 'code', area: 'explain' },
  { q: 'Who do I owe money to?', kind: 'code', area: 'payables' },
  { q: 'Which bills are due this week?', kind: 'code', area: 'payables' },
  { q: 'What is 1,250 plus 17% VAT?', kind: 'code', area: 'calculate' },
  { q: 'Find the customer Acme Ltd.', kind: 'code', area: 'records' },
  { q: 'List my last five payments.', kind: 'code', area: 'payments' },
  { q: 'How many units of SKU-7 are in stock?', kind: 'code', area: 'inventory' },
  { q: 'Record a payment of 500 from Acme Ltd for INV-1001.', kind: 'model', area: 'payments' },
  { q: 'Create an invoice for Acme Ltd for two hours of consulting.', kind: 'model', area: 'invoices' },
  { q: 'Make a bill from the electricity company for 320.', kind: 'model', area: 'payables' },
  { q: 'Why is my profit lower than last month?', kind: 'model', area: 'explain' },
  { q: 'Should I chase Acme or Beta first?', kind: 'model', area: 'receivables' },
  { q: 'Fix the books.', kind: 'model', area: 'vague' },
  { q: 'Something looks off with my numbers, can you check?', kind: 'model', area: 'vague' },
  { q: 'Move all of last month\'s office costs to a new project.', kind: 'model', area: 'projects' },
  { q: 'Set up a monthly invoice for Beta Corp of 1,000.', kind: 'model', area: 'recurring' },
  { q: 'Can I afford to hire someone next quarter?', kind: 'model', area: 'forecast' },
  { q: 'Write off the small balances customers will never pay.', kind: 'model', area: 'receivables' },
  { q: 'Summarise how the business did this year in plain words.', kind: 'model', area: 'reports' },
];

/** Fixed test answers in the read tools' real shapes (sandboxTools.ts / the report routes), so a run never touches real books. */
const FIXTURE: Record<string, unknown> = {
  ask_books: { question: 'test', today: '2026-11-22', reading: { problem: null, understood: { accounts: ['Cash'], label: null, period: 'up to today' }, sense: 'net' }, answer: { totalCents: 1_234_500, answerCents: 1_234_500, sense: 'net' } },
  run_report: { current: 300_000, '1-30': 120_000, '31-60': 50_000, '61-90': 0, '90+': 25_000, total: 495_000 },
  explain_number: { totalCents: 4_200_000, lines: [{ label: 'Sales', cents: 4_200_000 }] },
  get_record: { collection: 'invoices', record: { id: 'inv_1', number: 'INV-1001', total: 1200, status: 'open' } },
  search_records: { text: 'test', matches: [{ collection: 'invoices', id: 'inv_1', matched: 'number', record: { id: 'inv_1', number: 'INV-1001', name: 'Acme Ltd' } }], scannedPerCollection: 500 },
  list_records: { collection: 'payments', records: [{ id: 'pay_1', date: '2026-11-20', amountCents: 50_000, currency: 'USD', reference: 'PAY-1' }, { id: 'pay_2', date: '2026-11-18', amountCents: 75_000, currency: 'USD', reference: 'PAY-2' }], nextCursor: null },
  calculate: { expression: 'test', cents: 146_250, amount: 1462.5 },
  list_proposals: { proposals: [] },
  preview_proposal: { proposal: null },
};
const REPLAY_CURRENCY = 'USD';

const ownerCommands = () => stepCommandNames().map(stepCommand).filter(c => c.roles.some(r => r === 'owner'));

export function offeredTools(): FunctionDeclaration[] {
  return defaultAssistantTools(ownerCommands())[0].functionDeclarations as FunctionDeclaration[];
}

/** find_command runs the real catalog search, as the sandbox route does; reads use the fixture. */
export function replayTool(name: string, args: Record<string, unknown>): unknown {
  if (name === 'find_command') {
    const words = typeof args.words === 'string' ? args.words : '';
    const limit = typeof args.limit === 'number' ? args.limit : undefined;
    return { matches: findAssistantCommands(ownerCommands(), words, limit) };
  }
  if (name.startsWith('propose_')) return { drafted: true, note: 'test fixture: a proposal step would be drafted in the sandbox' };
  if (name === 'search_records') {
    // test books: the invoice or customer asked about exists, with the fields a lookup reads
    const text = typeof args.text === 'string' ? args.text : '';
    const invoice = /^[A-Z]{1,6}-?\d+$/.test(text);
    const record = invoice ? { id: 'inv_t', number: text, status: 'open', dueDate: '2026-12-01' } : { id: 'cus_t', name: text };
    return { text, matches: [{ collection: invoice ? 'invoices' : 'customers', id: record.id, matched: invoice ? 'number' : 'name', record }], scannedPerCollection: 500 };
  }
  return FIXTURE[name] ?? { error: 'not in the test fixture' };
}

/** Discovered commands' declarations come from the catalog's own search result (trusted server code). */
export function replayDiscover(tool: string, result: unknown): FunctionDeclaration[] {
  if (tool !== 'find_command') return [];
  const matches = (result as { matches?: Array<{ tool?: FunctionDeclaration }> })?.matches ?? [];
  return matches.flatMap(m => (m.tool ? [m.tool] : []));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function summarise(rows: Array<{ kind: string; metric: AssistantTurnMetric }>) {
  const byPath = new Map<string, AssistantTurnMetric[]>();
  for (const { metric } of rows) byPath.set(metric.path, [...(byPath.get(metric.path) ?? []), metric]);
  return [...byPath].map(([path, ms]) => {
    const priced = ms.filter(m => m.costCents !== null);
    return {
      path, turns: ms.length, ok: ms.filter(m => m.ok).length,
      modelCalls: ms.reduce((s, m) => s + m.modelCalls, 0),
      medianInputTokens: median(ms.map(m => m.inputTokens)),
      medianOutputTokens: median(ms.map(m => m.outputTokens)),
      medianToolsOffered: median(ms.map(m => m.toolsOffered)),
      medianAnswerMs: median(ms.map(m => m.answerMs)),
      medianTotalMs: median(ms.map(m => m.totalMs)),
      totalCostCents: priced.length === ms.length ? priced.reduce((s, m) => s + (m.costCents ?? 0), 0) : null,
    };
  });
}

async function main() {
  const systemPrompt = fs.readFileSync('assistant/SYSTEM_PROMPT.md', 'utf8');
  const tools = offeredTools();
  const fixedBytes = Buffer.byteLength(systemPrompt) + Buffer.byteLength(JSON.stringify(tools));
  const model = process.env.ASSISTANT_REPLAY_MODEL;
  const baseUrl = process.env.ASSISTANT_REPLAY_BASE_URL;
  const lines: string[] = [];
  lines.push(`Fixed part of every request (system prompt + ${tools.length} tool definitions): ${fixedBytes} bytes, about ${Math.ceil(fixedBytes / 4)} tokens (bytes ÷ 4 estimate).`);
  lines.push(`Replay questions: ${REPLAY_QUESTIONS.length} (${REPLAY_QUESTIONS.filter(x => x.kind === 'code').length} the books can answer exactly, ${REPLAY_QUESTIONS.filter(x => x.kind === 'model').length} that need the model).`);
  const rows: Array<{ kind: string; metric: AssistantTurnMetric }> = [];
  const measured = Boolean(model && baseUrl);
  // Without a model the router still answers what code can; the rest are recorded as not measured.
  const noModel: ModelClient = { models: { generateContent: async () => { throw new Error('no model configured'); } } };
  const client = measured ? openAiCompatibleClient({ baseUrl: baseUrl! }) : noModel;
  for (const { q, kind } of REPLAY_QUESTIONS) {
    const { metric } = await answerTurn({ client, model: model ?? 'none', systemPrompt, tools, question: q, currency: REPLAY_CURRENCY,
      callTool: async (name, args) => replayTool(name, args), discover: replayDiscover });
    rows.push({ kind, metric });
  }
  const codeKind = REPLAY_QUESTIONS.filter(x => x.kind === 'code').length;
  const codeAnswered = rows.filter(r => r.kind === 'code' && r.metric.path === 'code').length;
  const modelKindOnCode = rows.filter(r => r.kind === 'model' && r.metric.path === 'code').length;
  lines.push(`Answered without a model: ${codeAnswered} of ${codeKind} questions the books can answer; questions that need the model answered by code: ${modelKindOnCode} (must be 0).`);
  lines.push(measured ? `Model: ${model} via ${baseUrl}.` : 'No model configured (ASSISTANT_REPLAY_MODEL / ASSISTANT_REPLAY_BASE_URL): model-path tokens, times and cost are not measured.');
  const table = summarise(rows);
  const header = '| path | turns | ok | model calls | median input tokens | median output tokens | median tools offered | median answer ms (no streaming yet) | median total ms | total cost (cents) |';
  const md = [header, '|---|---|---|---|---|---|---|---|---|---|',
    ...table.map(r => measured || r.path === 'code'
      ? `| ${r.path} | ${r.turns} | ${r.ok} | ${r.modelCalls} | ${r.medianInputTokens} | ${r.medianOutputTokens} | ${r.medianToolsOffered} | ${r.medianAnswerMs} | ${r.medianTotalMs} | ${r.totalCostCents === null ? 'unknown (no price row)' : r.totalCostCents.toFixed(4)} |`
      : `| ${r.path} | ${r.turns} | not measured | not measured | not measured | not measured | ${r.medianToolsOffered} | not measured | not measured | not measured |`)];
  const out = [...lines, '', ...md].join('\n');
  console.log(out);
  if (process.argv.includes('--write')) {
    fs.writeFileSync('docs/assistant-baseline.md', `# SBX-2 assistant baseline\n\nRun ${new Date().toISOString().slice(0, 10)} with \`scripts/assistant-replay.ts\` (test data only).\n\n${out}\n`);
  }
}

if (process.argv[1]?.endsWith('assistant-replay.ts')) {
  main().catch(err => { console.error(err); process.exit(1); });
}
