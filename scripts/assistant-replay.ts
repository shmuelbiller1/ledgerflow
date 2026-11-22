/**
 * SBX-2 Part 1: replays 30 realistic assistant questions and prints, per answer path, the numbers
 * every later SBX-2 part is judged by. Test data only: tool calls are answered from the fixed
 * fixture below, never from a real workspace.
 *
 *   npx tsx scripts/assistant-replay.ts                 # without a model: fixed-prompt size and tools offered
 *   ASSISTANT_REPLAY_MODEL=gpt-6-luna \
 *   ASSISTANT_REPLAY_BASE_URL=https://api.arena.ai/v1 \
 *   npx tsx scripts/assistant-replay.ts --write          # with a model; --write updates the Parts 4–6 section of docs/assistant-baseline.md
 *
 * Each run replays the questions twice and prints before/after tables: with each SBX-2 part switched
 * back off, then as it is today (Parts 4–6).
 *
 * The key is never read here: the session's network proxy adds it for the configured host.
 */
import fs from 'node:fs';
import type { FunctionDeclaration } from '@google/genai';
import { assistantToolsFor, defaultAssistantTools, findAssistantCommands } from '../src/server/services/assistantCatalog';
import { memoryToolCache } from '../src/server/services/assistantReadCache';
import { assistantModels, chooseModel } from '../src/server/services/assistantModels';
import { stepCommand, stepCommandNames } from '../src/server/commands/sandboxStepCommands';
import { type AssistantTurnMetric, type ModelClient } from '../src/server/services/assistantTurn';
import { answerTurn, routeQuestion } from '../src/server/services/assistantRouter';
import { openAiCompatibleClient } from '../src/server/services/openAiCompatibleClient';
import { callCostCents } from '../src/lib/ai/modelPricing';

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
  ask_books: { question: 'test', today: '2026-11-22', reading: { filter: { accountIds: ['acc_cash'], startDate: '2026-01-01', endDate: '2026-11-22' }, problem: null, understood: { accounts: ['Cash'], label: null, period: 'this year' }, sense: 'net' }, answer: { totalCents: 1_234_500, answerCents: 1_234_500, sense: 'net' } },
  run_report: { current: 300_000, '1-30': 120_000, '31-60': 50_000, '61-90': 0, '90+': 25_000, total: 495_000 },
  explain_number: { totalCents: 1_334_500, lines: [{ label: 'Opening balance', cents: 100_000 }, { label: 'Cash', cents: 1_234_500 }] },
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

export function summarise(rows: Array<{ kind: string; metric: AssistantTurnMetric; offeredBytes?: number }>) {
  const byPath = new Map<string, Array<{ metric: AssistantTurnMetric; offeredBytes?: number }>>();
  for (const row of rows) byPath.set(row.metric.path, [...(byPath.get(row.metric.path) ?? []), row]);
  return [...byPath].map(([path, rs]) => {
    const ms = rs.map(r => r.metric);
    const priced = ms.filter(m => m.costCents !== null);
    return {
      path, turns: ms.length, ok: ms.filter(m => m.ok).length,
      modelCalls: ms.reduce((s, m) => s + m.modelCalls, 0),
      medianInputTokens: median(ms.map(m => m.inputTokens)),
      medianOutputTokens: median(ms.map(m => m.outputTokens)),
      medianToolsOffered: median(ms.map(m => m.toolsOffered)),
      medianOfferedTokens: median(rs.map(r => Math.ceil((r.offeredBytes ?? 0) / 4))),
      toolCalls: ms.reduce((s, m) => s + m.toolsCalled.length, 0),
      toolCacheHits: ms.reduce((s, m) => s + m.toolCacheHits, 0),
      medianAnswerMs: median(ms.map(m => m.answerMs)),
      medianTotalMs: median(ms.map(m => m.totalMs)),
      totalCostCents: priced.length === ms.length ? priced.reduce((s, m) => s + (m.costCents ?? 0), 0) : null,
    };
  });
}

/** How a run is set up: today's behaviour, or one part switched back to how it was before it landed. */
export interface ReplayMode { label: string; areaTools: boolean; cache: boolean; modelRule: boolean; passes: number }
export const CURRENT: ReplayMode = { label: 'after Parts 4–6', areaTools: true, cache: true, modelRule: true, passes: 2 };

export async function replay(mode: ReplayMode, opts: { client: ModelClient; model: string; systemPrompt: string }) {
  const commands = ownerCommands();
  const fixed = offeredTools();
  const cache = mode.cache ? memoryToolCache({ workspaceId: 'replay-test-books', sandboxId: 'replay' }) : undefined;
  const models = assistantModels();
  const rows: Array<{ kind: string; pass: number; metric: AssistantTurnMetric; offeredBytes: number; tier?: string; reason?: string }> = [];
  for (let pass = 1; pass <= mode.passes; pass++) {
    for (const { q, kind } of REPLAY_QUESTIONS) {
      const tools = mode.areaTools ? assistantToolsFor(commands, q)[0].functionDeclarations as FunctionDeclaration[] : fixed;
      // the same model rule the server's turn handler uses (assistantTurnHandler.ts), retry included
      const modelRule = mode.modelRule ? { choose: (reason: string) => chooseModel(q, reason, commands, models), strong: models.strong } : undefined;
      const { metric } = await answerTurn({ client: opts.client, model: opts.model, systemPrompt: opts.systemPrompt, tools, question: q,
        currency: REPLAY_CURRENCY, callTool: async (name, args) => replayTool(name, args), discover: replayDiscover, ...(cache ? { cache } : {}),
        ...(modelRule ? { modelRule } : {}) });
      const offeredBytes = metric.path === 'model' ? Buffer.byteLength(opts.systemPrompt) + Buffer.byteLength(JSON.stringify(tools)) : 0;
      // the rule's first pick, for the table (the metric holds the model that finally answered, which
      // without a model run is always the strong retry)
      const decision = routeQuestion(q);
      const first = mode.modelRule ? chooseModel(q, decision.path === 'model' ? decision.reason : 'code-answer-incomplete', commands, models) : undefined;
      rows.push({ kind, pass, metric, offeredBytes, ...(metric.path === 'model' && first ? { tier: first.tier, reason: first.reason } : {}) });
    }
  }
  return rows;
}

const HEADER = '| path | turns | ok | model calls | median input tokens | median output tokens | median tools offered | median fixed prompt tokens (system + tools, bytes ÷ 4) | tool calls | tool calls from cache | median answer ms (no streaming yet) | median total ms | total cost (cents) |';

export function table(rows: Awaited<ReturnType<typeof replay>>, measured: boolean): string {
  return [HEADER, '|---|---|---|---|---|---|---|---|---|---|---|---|---|', ...summarise(rows).map(r => measured || r.path !== 'model'
    ? `| ${r.path} | ${r.turns} | ${r.ok} | ${r.modelCalls} | ${r.medianInputTokens} | ${r.medianOutputTokens} | ${r.medianToolsOffered} | ${r.medianOfferedTokens} | ${r.toolCalls} | ${r.toolCacheHits} | ${r.medianAnswerMs} | ${r.medianTotalMs} | ${r.totalCostCents === null ? 'unknown (no price row)' : r.totalCostCents.toFixed(4)} |`
    : `| ${r.path} | ${r.turns} | not measured | not measured | not measured | not measured | ${r.medianToolsOffered} | ${r.medianOfferedTokens} | ${r.toolCalls} | ${r.toolCacheHits} | not measured | not measured | not measured |`)].join('\n');
}

async function main() {
  const systemPrompt = fs.readFileSync('assistant/SYSTEM_PROMPT.md', 'utf8');
  const model = process.env.ASSISTANT_REPLAY_MODEL;
  const baseUrl = process.env.ASSISTANT_REPLAY_BASE_URL;
  const measured = Boolean(model && baseUrl);
  // Without a model the router still answers what code can; the rest are recorded as not measured.
  const noModel: ModelClient = { models: { generateContent: async () => { throw new Error('no model configured'); } } };
  const client = measured ? openAiCompatibleClient({ baseUrl: baseUrl! }) : noModel;
  const opts = { client, model: model ?? 'none', systemPrompt };
  const out: string[] = [];
  const say = (line = '') => out.push(line);
  const codeKind = REPLAY_QUESTIONS.filter(x => x.kind === 'code').length;
  say(`Replay questions: ${REPLAY_QUESTIONS.length} (${codeKind} the books can answer exactly, ${REPLAY_QUESTIONS.length - codeKind} that need the model), each asked twice (pass 2 = the same person asking again with the books unchanged).`);
  say(measured ? `Model: ${model} via ${baseUrl}.` : 'No model configured (ASSISTANT_REPLAY_MODEL / ASSISTANT_REPLAY_BASE_URL): model-path tokens, times and cost are not measured; the fixed prompt size per model turn is.');
  const runs: Array<[string, ReplayMode]> = [
    ['Before Parts 4–6 (Part 2 router only: fixed 25 tools, no cache, one model)', { label: 'before', areaTools: false, cache: false, modelRule: false, passes: 2 }],
    ['Part 4 only (cache on)', { label: 'part4', areaTools: false, cache: true, modelRule: false, passes: 2 }],
    ['Part 5 only (tools by the question’s area)', { label: 'part5', areaTools: true, cache: false, modelRule: false, passes: 2 }],
    ['After Parts 4–6 (today)', CURRENT],
  ];
  let current: Awaited<ReturnType<typeof replay>> = [];
  for (const [title, mode] of runs) {
    const rows = await replay(mode, opts);
    if (mode === CURRENT) current = rows;
    const noModelCall = rows.filter(r => r.kind === 'code' && r.metric.modelCalls === 0).length;
    const wrong = rows.filter(r => r.kind === 'model' && r.metric.path !== 'model').length;
    say(); say(`### ${title}`); say();
    say(`Book questions answered without a model call: ${noModelCall} of ${rows.filter(r => r.kind === 'code').length} (both passes); questions that need the model answered without it: ${wrong} (must be 0).`);
    say(); say(table(rows, measured));
  }
  const modelRows = current.filter(r => r.pass === 1 && r.metric.path === 'model');
  const tiers = new Map<string, number>();
  for (const r of modelRows) tiers.set(`${r.tier} (${r.reason})`, (tiers.get(`${r.tier} (${r.reason})`) ?? 0) + 1);
  say(); say('### Part 6: which model the written rule picks first for the model turns (pass 1)'); say();
  if (measured) say(`Retried on the strong model after the simple one failed: ${modelRows.filter(r => r.metric.modelReason === 'simple-model-failed').length}.`);
  say('| model (rule) | turns |'); say('|---|---|');
  for (const [k, n] of [...tiers].sort(([a], [b]) => a.localeCompare(b))) say(`| ${k} | ${n} |`);
  // An estimate, labelled as one: the fixed prompt's input cost on the first model call of a turn, at
  // the list price of the model that answers (no prompt-cache discount). Before: one model for every
  // turn (the app's chat model, gemini-2.5-flash) with the fixed 25 tools.
  const before = (await replay(runs[0][1], opts)).filter(r => r.pass === 1 && r.metric.path === 'model');
  const today = new Date().toISOString().slice(0, 10);
  const est = (rows: typeof before, modelOf: (r: (typeof before)[number]) => string) =>
    rows.reduce((sum, r) => sum + (callCostCents(modelOf(r), today, Math.ceil(r.offeredBytes / 4), 0) ?? Number.NaN), 0);
  const models = assistantModels();
  const beforeCents = est(before, () => 'gemini-2.5-flash');
  const afterCents = est(modelRows, r => (r.tier === 'strong' ? models.strong : models.simple));
  const cachedCents = modelRows.reduce((sum, r) => sum + (callCostCents(r.tier === 'strong' ? models.strong : models.simple, today, Math.ceil(r.offeredBytes / 4), 0, Math.ceil(r.offeredBytes / 4)) ?? Number.NaN), 0);
  say();
  say(`Estimated input cost of the fixed prompt, first model call of each of the ${modelRows.length} model turns (pass 1), list prices on ${today}: before ${beforeCents.toFixed(3)} cents (all on gemini-2.5-flash, 25 fixed tools); after ${afterCents.toFixed(3)} cents (the rule's models, tools by area); after, when the provider's prompt cache serves the fixed prefix, ${cachedCents.toFixed(3)} cents. Measured cost needs a model run.`);
  const text = out.join('\n');
  console.log(text);
  if (process.argv.includes('--write')) {
    const file = 'docs/assistant-baseline.md';
    const marker = '## Parts 4–6 — before and after';
    const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# SBX-2 assistant baseline\n';
    const kept = prior.includes(marker) ? prior.slice(0, prior.indexOf(marker)) : `${prior.trimEnd()}\n\n`;
    fs.writeFileSync(file, `${kept}${marker} (run ${new Date().toISOString().slice(0, 10)}, \`scripts/assistant-replay.ts --write\`, test data only)\n\n${text}\n`);
  }
}

if (process.argv[1]?.endsWith('assistant-replay.ts')) {
  main().catch(err => { console.error(err); process.exit(1); });
}
