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
import { defaultAssistantTools } from '../src/server/services/assistantCatalog';
import { stepCommand, stepCommandNames } from '../src/server/commands/sandboxStepCommands';
import { runAssistantTurn, turnMetric, type AssistantTurnMetric } from '../src/server/services/assistantTurn';
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

/** Fixed test answers for each read tool, so a model run never touches real books. */
const FIXTURE: Record<string, unknown> = {
  ask_books: { answerCents: 1_234_500, currency: 'USD', source: 'cash report (test data)' },
  run_report: { report: 'test', totalCents: 4_200_000, currency: 'USD', source: 'test fixture' },
  explain_number: { totalCents: 4_200_000, lines: [{ label: 'Sales', cents: 4_200_000, source: 'invoices (test)' }] },
  get_record: { id: 'INV-1001', total: 1200, status: 'open', customer: 'Acme Ltd' },
  search_records: { records: [{ id: 'cus_1', name: 'Acme Ltd' }] },
  list_records: { records: [{ id: 'pay_1', amount: 500 }, { id: 'pay_2', amount: 750 }] },
  calculate: { result: '1462.50' },
  list_proposals: { proposals: [] },
  preview_proposal: { proposal: null },
  find_command: { commands: [{ name: 'payment.receive' }, { name: 'invoice.create' }] },
};

export function offeredTools(): FunctionDeclaration[] {
  const commands = stepCommandNames().map(stepCommand).filter(c => c.roles.some(r => r === 'owner'));
  return defaultAssistantTools(commands)[0].functionDeclarations as FunctionDeclaration[];
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
  if (measured) {
    const client = openAiCompatibleClient({ baseUrl: baseUrl! });
    for (const { q, kind } of REPLAY_QUESTIONS) {
      const { metric } = await runAssistantTurn({ client, model: model!, systemPrompt, tools, question: q,
        callTool: async name => FIXTURE[name] ?? { error: 'not in the test fixture' } });
      rows.push({ kind, metric });
    }
    lines.push(`Model: ${model} via ${baseUrl}.`);
  } else {
    lines.push('No model configured (ASSISTANT_REPLAY_MODEL / ASSISTANT_REPLAY_BASE_URL): every question would go to the model today; token, time and cost columns need a model run.');
    for (const { kind } of REPLAY_QUESTIONS) {
      rows.push({ kind, metric: turnMetric({ path: 'model', traces: [], toolsOffered: tools.length, toolsCalled: [], answerMs: 0, totalMs: 0, ok: false }) });
    }
  }
  const table = summarise(rows);
  const header = '| path | turns | ok | model calls | median input tokens | median output tokens | median tools offered | median answer ms (no streaming yet) | median total ms | total cost (cents) |';
  const md = [header, '|---|---|---|---|---|---|---|---|---|---|',
    ...table.map(r => measured
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
