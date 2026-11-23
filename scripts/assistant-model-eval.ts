/**
 * SBX-2 Part 6: one command that compares assistant models and writes the result for the owner.
 *
 *   ASSISTANT_EVAL_BASE_URL=https://api.arena.ai/v1 \
 *   ASSISTANT_EVAL_MODELS=gpt-6-luna,gpt-6.1-terra \
 *   ASSISTANT_EVAL_OCR_MODELS=gpt-6-luna,gpt-6.1-terra \
 *   npx tsx scripts/assistant-model-eval.ts --write
 *
 *   npx tsx scripts/assistant-model-eval.ts --self-test   # no key, no network: proves the graders and books
 *
 * For each model, every question that needs a model (scripts/eval/cases.ts) runs through the real turn
 * loop with the real per-question tool set, answered from a sample company (scripts/eval/sampleBooks.ts),
 * one model for every turn (no fallback to another model, so each model is billed and judged alone).
 * Each outcome is GRADED: the right step drafted, the right figure stated, or a question asked instead
 * of a guess. Then each OCR model reads generated receipt images and is scored field by field.
 *
 * Cost: the endpoint's own billed cost (`usage.cost`) is summed per model. A hard cap stops the run
 * (ASSISTANT_EVAL_MAX_CALLS, default 400 model calls in total). ASSISTANT_EVAL_REPEATS=3 runs each question
 * three times per model and reports the total, so one lucky or unlucky answer does not decide the comparison.
 * ASSISTANT_EVAL_PROMPTS=scripts/eval/prompts/before-2026-11-23.md,assistant/SYSTEM_PROMPT.md compares instructions in
 * the same run: every model is graded once per prompt file (default: assistant/SYSTEM_PROMPT.md only).
 * With --write, every turn is also saved in full to docs/eval/runs/<date-time>.json: model, prompt, question,
 * run number, grade and reason, the answer, each tool call with its arguments and the result the model saw,
 * time taken, model calls, billed cost and the turn's metric (tokens, steps), for deeper comparison. Test data only; the key is never read
 * here: the session's network proxy adds it for the configured host.
 */
import fs from 'node:fs';
import type { FunctionDeclaration } from '@google/genai';
import { assistantToolsFor, findAssistantCommands } from '../src/server/services/assistantCatalog';
import { proposedToolName } from '../src/server/services/assistantToolDefinitions';
import { stepCommand, stepCommandNames } from '../src/server/commands/sandboxStepCommands';
import { runAssistantTurn } from '../src/server/services/assistantTurn';
import { openAiCompatibleClient } from '../src/server/services/openAiCompatibleClient';
import { bookTool, TODAY } from './eval/sampleBooks';
import { assistantFacts } from '../src/server/services/assistantFacts';
import { CASES, RECEIPTS, gradeReceipt, whatHappened, type Outcome } from './eval/cases';

const ownerCommands = () => stepCommandNames().map(stepCommand).filter(c => c.roles.some(r => r === 'owner'));
const PROPOSAL_ID = 'sbx_eval_proposal';
const TURN_TIMEOUT_MS = Number(process.env.ASSISTANT_EVAL_TURN_TIMEOUT_MS ?? 120_000);

/** `priced` counts calls whose response carried a numeric billed cost; any other call leaves the total incomplete. */
interface Spend { usd: number; calls: number; priced: number }
/** Counts calls and the endpoint's billed cost, and refuses calls past the run's cap. */
export function meteredFetch(spend: Spend, total: { calls: number }, cap: number): typeof fetch {
  return async (input, init) => {
    if (total.calls >= cap) throw new Error(`call cap of ${cap} reached`);
    total.calls++; spend.calls++;
    const res = await fetch(input, init);
    try { const cost = (await res.clone().json() as { usage?: { cost?: number } }).usage?.cost; if (typeof cost === 'number' && Number.isFinite(cost)) { spend.usd += cost; spend.priced++; } } catch { /* not JSON: no billed cost */ }
    return res;
  };
}


/** The facts the live assistant sends with each question, for the sample company; ASSISTANT_EVAL_FACTS=off leaves them out. */
const EVAL_FACTS = process.env.ASSISTANT_EVAL_FACTS === 'off' ? undefined : assistantFacts({ today: TODAY, currency: 'USD', fiscalYearStartMonth: 1 });

/**
 * One question through the real turn loop; every tool call (name and arguments) is kept for grading.
 * On timeout the in-flight request is aborted and later calls are refused, and the turn is awaited
 * before the next case, so a timed-out turn never keeps spending in the background.
 */
export async function runCase(baseUrl: string, doFetch: typeof fetch, model: string, systemPrompt: string, q: string, timeoutMs = TURN_TIMEOUT_MS) {
  const commands = ownerCommands();
  const tools = assistantToolsFor(commands, q)[0].functionDeclarations as FunctionDeclaration[];
  const calls: Outcome['calls'] = [];
  const steps: Array<{ id: string; command: string; position: number; state: string; input: Record<string, unknown> }> = [];
  const stop = new AbortController();
  const caseFetch: typeof fetch = async (input, init) => {
    if (stop.signal.aborted) throw new Error('turn timed out');
    return doFetch(input, { ...init, signal: stop.signal });
  };
  const client = openAiCompatibleClient({ baseUrl, fetchImpl: caseFetch });
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const result = await answerTool(name, args);
    calls[calls.length - 1].result = result;
    return result;
  };
  const answerTool = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'find_command') return { matches: findAssistantCommands(commands, String(args.words ?? ''), typeof args.limit === 'number' ? args.limit : undefined) };
    // drafted steps are kept for this case, so the review tools the system prompt requires see them
    if (name.startsWith('propose_')) {
      // validated against the command's own input schema, as drafting does in production; a refused
      // input drafts nothing and is returned to the model, and the grader ignores it
      const command = commands.find(c => proposedToolName(c.name) === name);
      const parsed = command?.input.safeParse(args);
      if (!command || !parsed?.success) {
        calls[calls.length - 1].ok = false;
        // the first schema issue, for the report (field path and message only; no values)
        const issue = parsed?.error?.issues?.[0];
        calls[calls.length - 1].refusal = command ? `${issue?.path?.join('.') || 'input'}: ${issue?.message ?? 'invalid'}` : 'unknown command';
        return { error: command ? 'Invalid input for this command' : 'Unknown command', issues: parsed?.error?.issues?.slice(0, 5) ?? [] };
      }
      const step = { id: `step_${steps.length + 1}`, command: name.slice('propose_'.length).replace(/_/g, '.'), position: steps.length + 1, state: 'pending', input: args };
      steps.push(step);
      return { proposalId: PROPOSAL_ID, step: { id: step.id, command: step.command, state: step.state }, note: 'drafted in the sandbox for the person to review' };
    }
    if (name === 'list_proposals') return { proposals: steps.length ? [{ id: PROPOSAL_ID, steps: steps.map(({ input: _input, ...rest }) => rest) }] : [] };
    if (name === 'preview_proposal') return args.proposalId === PROPOSAL_ID && steps.length
      ? { proposal: { id: PROPOSAL_ID, steps: steps.map(st => ({ id: st.id, command: st.command, state: st.state, preview: { title: st.command, input: st.input } })) } }
      : { error: 'No such proposal in this sandbox' };
    return bookTool(name, args);
  };
  const discover = (tool: string, result: unknown) => tool === 'find_command'
    ? ((result as { matches?: Array<{ tool?: FunctionDeclaration }> }).matches ?? []).flatMap(m => (m.tool ? [m.tool] : [])) : [];
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const { answer, metric } = await runAssistantTurn({ client, model, systemPrompt, tools, question: q, callTool, discover, maxSteps: 6, ...(EVAL_FACTS ? { facts: EVAL_FACTS } : {}) });
    // an endpoint error, the call cap, a timeout or running out of steps comes back as ok: false, not a throw
    const error = stop.signal.aborted ? `timed out after ${timeoutMs / 1000}s` : metric.ok ? undefined : 'no final answer (endpoint error, call cap or step limit)';
    return { outcome: { answer, calls, ...(error ? { error } : {}) } as Outcome, metric };
  } catch (err) {
    return { outcome: { answer: '', calls, error: err instanceof Error ? err.message : String(err) } as Outcome, metric: null };
  } finally { clearTimeout(timer); }
}

/** Renders each receipt to a PNG with the pre-installed browser. */
export async function receiptImages(): Promise<Map<string, string>> {
  const { chromium } = await import('playwright');
  // the project pins its own Playwright; use the pre-installed browser when its bundled one is missing
  const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const page = await browser.newPage({ viewport: { width: 420, height: 560 }, deviceScaleFactor: 1 });
  const out = new Map<string, string>();
  for (const r of RECEIPTS) {
    const sym = r.currency === 'EUR' ? '€' : '$';
    const rows = r.lines.map(([d, a]) => `<tr><td>${d}</td><td style="text-align:right">${sym}${a.toFixed(2)}</td></tr>`).join('');
    await page.setContent(`<body style="font:15px monospace;padding:24px;background:#fff"><h2 style="margin:0">${r.vendor}</h2><p>Date: ${r.date.split('-').reverse().join('/')}</p>
      <table style="width:100%">${rows}${'taxIncluded' in r ? '' : `<tr><td>Tax</td><td style="text-align:right">${sym}${r.tax.toFixed(2)}</td></tr>`}
      <tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${sym}${r.total.toFixed(2)}</b></td></tr>
      ${'taxIncluded' in r ? `<tr><td>incl. VAT 20%</td><td style="text-align:right">${sym}${r.tax.toFixed(2)}</td></tr>` : ''}</table><p>Thank you!</p></body>`);
    out.set(r.id, (await page.screenshot({ fullPage: true })).toString('base64'));
  }
  await browser.close();
  return out;
}

async function readReceipt(baseUrl: string, doFetch: typeof fetch, model: string, png: string): Promise<Record<string, unknown> | null> {
  const res = await doFetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer injected-by-proxy' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: [
      { type: 'text', text: 'Read this receipt. Reply with JSON only: {"vendor": string, "date": "YYYY-MM-DD", "currency": string, "total": number, "tax": number}.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] }] }) });
  if (!res.ok) throw new Error(`endpoint answered ${res.status}`);
  const text = String(((await res.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '');
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>; } catch { return null; }
}

function selfTest() {
  // the graders accept the right outcome and refuse a wrong one, against the sample books
  const right: Record<string, Outcome> = {
    payment: { answer: 'Drafted.', calls: [{ name: 'propose_payment_receive', args: { customerId: 'cus_acme', amountCents: 50000, allocations: [{ documentId: 'inv_1001' }] } }] },
    bill: { answer: 'Drafted.', calls: [{ name: 'propose_bill_create', args: { bill: { vendorId: 'ven_elec', totalCents: 32000 } } }] },
    'fix-books': { answer: 'What looks wrong to you?', calls: [] },
    chase: { answer: 'Chase Beta first: $4,500 is overdue, against $1,232 for Acme.', calls: [{ name: 'run_report', args: { report: 'receivables-aging' } }] },
  };
  const wrong: Record<string, Outcome> = {
    payment: { answer: 'Drafted.', calls: [{ name: 'propose_payment_receive', args: { amountCents: 5000, documentId: 'inv_1002' } }] },
    bill: { answer: 'Done', calls: [] },
    'fix-books': { answer: 'Fixed.', calls: [{ name: 'propose_journal_create', args: {} }] },
    chase: { answer: 'Acme first, then Beta.', calls: [{ name: 'run_report', args: {} }] },
  };
  let failures = 0;
  for (const c of CASES.filter(k => k.id in right)) {
    const good = c.check(right[c.id]).pass, bad = c.check(wrong[c.id]).pass;
    if (!good || bad) { failures++; console.error(`grader ${c.id}: right=${good} wrong=${bad}`); }
  }
  const r = RECEIPTS[1];
  if (gradeReceipt(r, { vendor: 'City Electric Co', date: r.date, total: '320.00', tax: 23.7 }).score !== 4) failures++;
  if (gradeReceipt(r, { vendor: 'Office Mart', date: '2026-10-30', total: 32, tax: 0 }).score !== 0) failures++;
  console.log(failures ? `self-test: ${failures} failure(s)` : `self-test: graders and sample books OK (${CASES.length} cases, ${RECEIPTS.length} receipts)`);
  process.exitCode = failures ? 1 : 0;
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const baseUrl = process.env.ASSISTANT_EVAL_BASE_URL;
  const models = (process.env.ASSISTANT_EVAL_MODELS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const ocrModels = (process.env.ASSISTANT_EVAL_OCR_MODELS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!baseUrl || (!models.length && !ocrModels.length)) {
    console.error('Set ASSISTANT_EVAL_BASE_URL and ASSISTANT_EVAL_MODELS (and optionally ASSISTANT_EVAL_OCR_MODELS); see the top of this file.');
    process.exitCode = 2; return;
  }
  const cap = Number(process.env.ASSISTANT_EVAL_MAX_CALLS ?? 400);
  // ASSISTANT_EVAL_REPEATS: run each question this many times per model and report the total (default 1)
  const repeats = Math.max(1, Math.min(10, Number(process.env.ASSISTANT_EVAL_REPEATS ?? 1) || 1));
  const total = { calls: 0 };
  const promptFiles = (process.env.ASSISTANT_EVAL_PROMPTS ?? 'assistant/SYSTEM_PROMPT.md').split(',').map(s => s.trim()).filter(Boolean);
  const prompts = promptFiles.map(file => ({ name: file.split('/').pop()!.replace(/\.md$/, ''), text: fs.readFileSync(file, 'utf8') }));
  const runs = prompts.flatMap(p => models.map(model => ({ model, prompt: p })));
  const out: string[] = [];
  const say = (l = '') => { out.push(l); console.log(l); };
  const date = new Date().toISOString().slice(0, 10);

  say(`## Model comparison (${date}, via ${new URL(baseUrl).host})`);
  say();
  say(`Graded on ${CASES.length} questions that need a model, against a sample company's books (scripts/eval). One model per run, no fallback. "Correct" means the right step drafted, the right figure stated, or a question asked instead of a guess. Cost is what the endpoint billed.`);
  say();
  say('| model | correct | finished (no error/timeout) | model calls | billed cost | cost per correct answer |');
  say('|---|---|---|---|---|---|');
  const detail: string[] = [];
  const log: unknown[] = [];
  for (const { model, prompt } of runs) {
    const systemPrompt = prompt.text;
    const label = prompts.length > 1 ? `${model} (${prompt.name})` : model;
    const spend: Spend = { usd: 0, calls: 0, priced: 0 };
    const doFetch = meteredFetch(spend, total, cap);
    let correct = 0, finished = 0;
    detail.push('', `#### ${label}`, '', `| question | result${repeats > 1 ? ` (of ${repeats})` : ''} | why (first wrong run) |`, '|---|---|---|');
    for (const c of CASES) {
      // each question runs `repeats` times: models answer differently run to run, so one run is luck
      let right = 0, why = '';
      for (let r = 0; r < repeats; r++) {
        const before = { usd: spend.usd, calls: spend.calls }, started = Date.now();
        const { outcome, metric } = await runCase(baseUrl, doFetch, model, systemPrompt, c.q);
        const g = outcome.error ? { pass: false, why: outcome.error } : c.check(outcome);
        log.push({ model, prompt: prompt.name, case: c.id, question: c.q, run: r + 1, pass: g.pass, why: g.why, answer: outcome.answer,
          error: outcome.error, calls: outcome.calls, ms: Date.now() - started, modelCalls: spend.calls - before.calls,
          billedCents: Math.round((spend.usd - before.usd) * 1e6) / 1e4, metric });
        if (!outcome.error) finished++;
        if (g.pass) right++;
        else if (!why) why = g.why + (outcome.error ? '' : ` — ${whatHappened(outcome)}`);
      }
      correct += right;
      const result = repeats > 1 ? `${right} / ${repeats}` : right ? 'correct' : 'wrong';
      detail.push(`| ${c.q} | ${result} | ${(why || 'correct every run').replaceAll('|', '/').replace(/\n/g, ' ')} |`);
    }
    const cents = spend.usd * 100;
    // only a fully priced run is a measured cost; otherwise say how much is missing
    const known = spend.priced === spend.calls;
    const billed = known ? `${cents.toFixed(2)}¢` : `unknown (${spend.calls - spend.priced} of ${spend.calls} calls without a billed cost; ≥${cents.toFixed(2)}¢)`;
    const asked = CASES.length * repeats;
    say(`| ${label} | ${correct} / ${asked}${repeats > 1 ? ` (${(correct / repeats).toFixed(1)} of ${CASES.length} on average)` : ''} | ${finished} / ${asked} | ${spend.calls} | ${billed} | ${known && correct ? (cents / correct).toFixed(2) + '¢' : '—'} |`);
  }
  if (ocrModels.length) {
    say(); say('### Receipts (OCR)'); say();
    say(`${RECEIPTS.length} generated receipt images; each scored on vendor, date, total and tax (4 fields each).`); say();
    say('| model | fields right | receipts fully right | billed cost |'); say('|---|---|---|---|');
    const images = await receiptImages();
    for (const model of ocrModels) {
      const spend: Spend = { usd: 0, calls: 0, priced: 0 };
      const doFetch = meteredFetch(spend, total, cap);
      let fields = 0, full = 0;
      for (const r of RECEIPTS) {
        const got = await readReceipt(baseUrl, doFetch, model, images.get(r.id)!).catch(() => null);
        const g = gradeReceipt(r, got); fields += g.score; if (g.score === g.of) full++;
      }
      say(`| ${model} | ${fields} / ${RECEIPTS.length * 4} | ${full} / ${RECEIPTS.length} | ${spend.priced === spend.calls ? `${(spend.usd * 100).toFixed(2)}¢` : 'unknown (no billed cost on some calls)'} |`);
    }
  }
  say(); say('### Per question'); detail.forEach(l => say(l));
  say(); say(`Model calls in this run: ${total.calls} (cap ${cap}).`);

  if (process.argv.includes('--write')) {
    const file = 'docs/assistant-model-eval.md';
    const head = '# Assistant model comparison (SBX-2 Part 6)\n\nGenerated by `scripts/assistant-model-eval.ts`; the newest run is on top. Rerun the same command to update it.\n\n';
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(head, '') : '';
    fs.writeFileSync(file, head + out.join('\n') + '\n\n' + prev);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const runFile = `docs/eval/runs/${stamp}.json`;
    fs.mkdirSync('docs/eval/runs', { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify({ date: new Date().toISOString(), endpoint: new URL(baseUrl).host, repeats, prompts: promptFiles, turns: log }, null, 1));
    console.log(`\nWrote ${file} and every turn in full to ${runFile}.`);
  }
}

if (process.argv[1]?.endsWith('assistant-model-eval.ts')) main().catch(err => { console.error(err); process.exitCode = 1; });
