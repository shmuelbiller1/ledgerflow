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
 * (ASSISTANT_EVAL_MAX_CALLS, default 400 model calls in total). Test data only; the key is never read
 * here: the session's network proxy adds it for the configured host.
 */
import fs from 'node:fs';
import type { FunctionDeclaration } from '@google/genai';
import { assistantToolsFor, findAssistantCommands } from '../src/server/services/assistantCatalog';
import { stepCommand, stepCommandNames } from '../src/server/commands/sandboxStepCommands';
import { runAssistantTurn } from '../src/server/services/assistantTurn';
import { openAiCompatibleClient } from '../src/server/services/openAiCompatibleClient';
import { bookTool } from './eval/sampleBooks';
import { CASES, RECEIPTS, gradeReceipt, type Outcome } from './eval/cases';

const ownerCommands = () => stepCommandNames().map(stepCommand).filter(c => c.roles.some(r => r === 'owner'));
const TURN_TIMEOUT_MS = Number(process.env.ASSISTANT_EVAL_TURN_TIMEOUT_MS ?? 120_000);

interface Spend { usd: number; calls: number }
/** Counts calls and the endpoint's billed cost, and refuses calls past the run's cap. */
function meteredFetch(spend: Spend, total: { calls: number }, cap: number): typeof fetch {
  return async (input, init) => {
    if (total.calls >= cap) throw new Error(`call cap of ${cap} reached`);
    total.calls++; spend.calls++;
    const res = await fetch(input, init);
    try { const cost = (await res.clone().json() as { usage?: { cost?: number } }).usage?.cost; if (typeof cost === 'number') spend.usd += cost; } catch { /* not JSON */ }
    return res;
  };
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms))]);

/** One question through the real turn loop; every tool call (name and arguments) is kept for grading. */
async function runCase(client: ReturnType<typeof openAiCompatibleClient>, model: string, systemPrompt: string, q: string) {
  const commands = ownerCommands();
  const tools = assistantToolsFor(commands, q)[0].functionDeclarations as FunctionDeclaration[];
  const calls: Outcome['calls'] = [];
  const callTool = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'find_command') return { matches: findAssistantCommands(commands, String(args.words ?? ''), typeof args.limit === 'number' ? args.limit : undefined) };
    if (name.startsWith('propose_')) return { drafted: true, note: 'drafted in the sandbox for the person to review' };
    return bookTool(name, args);
  };
  const discover = (tool: string, result: unknown) => tool === 'find_command'
    ? ((result as { matches?: Array<{ tool?: FunctionDeclaration }> }).matches ?? []).flatMap(m => (m.tool ? [m.tool] : [])) : [];
  try {
    const { answer, metric } = await withTimeout(runAssistantTurn({ client, model, systemPrompt, tools, question: q, callTool, discover, maxSteps: 6 }), TURN_TIMEOUT_MS);
    return { outcome: { answer, calls } as Outcome, metric };
  } catch (err) {
    return { outcome: { answer: '', calls, error: err instanceof Error ? err.message : String(err) } as Outcome, metric: null };
  }
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
  const total = { calls: 0 };
  const systemPrompt = fs.readFileSync('assistant/SYSTEM_PROMPT.md', 'utf8');
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
  for (const model of models) {
    const spend: Spend = { usd: 0, calls: 0 };
    const client = openAiCompatibleClient({ baseUrl, fetchImpl: meteredFetch(spend, total, cap) });
    let correct = 0, finished = 0;
    detail.push('', `#### ${model}`, '', '| question | result | why |', '|---|---|---|');
    for (const c of CASES) {
      const { outcome } = await runCase(client, model, systemPrompt, c.q);
      const g = outcome.error ? { pass: false, why: outcome.error } : c.check(outcome);
      if (!outcome.error) finished++;
      if (g.pass) correct++;
      detail.push(`| ${c.q} | ${g.pass ? 'correct' : 'wrong'} | ${g.why.replaceAll('|', '/')} |`);
    }
    const cents = spend.usd * 100;
    say(`| ${model} | ${correct} / ${CASES.length} | ${finished} / ${CASES.length} | ${spend.calls} | ${cents.toFixed(2)}¢ | ${correct ? (cents / correct).toFixed(2) + '¢' : '—'} |`);
  }
  if (ocrModels.length) {
    say(); say('### Receipts (OCR)'); say();
    say(`${RECEIPTS.length} generated receipt images; each scored on vendor, date, total and tax (4 fields each).`); say();
    say('| model | fields right | receipts fully right | billed cost |'); say('|---|---|---|---|');
    const images = await receiptImages();
    for (const model of ocrModels) {
      const spend: Spend = { usd: 0, calls: 0 };
      const doFetch = meteredFetch(spend, total, cap);
      let fields = 0, full = 0;
      for (const r of RECEIPTS) {
        const got = await readReceipt(baseUrl, doFetch, model, images.get(r.id)!).catch(() => null);
        const g = gradeReceipt(r, got); fields += g.score; if (g.score === g.of) full++;
      }
      say(`| ${model} | ${fields} / ${RECEIPTS.length * 4} | ${full} / ${RECEIPTS.length} | ${(spend.usd * 100).toFixed(2)}¢ |`);
    }
  }
  say(); say('### Per question'); detail.forEach(l => say(l));
  say(); say(`Model calls in this run: ${total.calls} (cap ${cap}).`);

  if (process.argv.includes('--write')) {
    const file = 'docs/assistant-model-eval.md';
    const head = '# Assistant model comparison (SBX-2 Part 6)\n\nGenerated by `scripts/assistant-model-eval.ts`; the newest run is on top. Rerun the same command to update it.\n\n';
    const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(head, '') : '';
    fs.writeFileSync(file, head + out.join('\n') + '\n\n' + prev);
    console.log(`\nWrote ${file}.`);
  }
}

if (process.argv[1]?.endsWith('assistant-model-eval.ts')) main().catch(err => { console.error(err); process.exitCode = 1; });
