/**
 * SBX-2 Part 2: answer without the model when code can. A question the books can answer exactly goes
 * straight to an existing read tool and is worded from a fixed template that cites its source; the
 * model is called only when the router cannot decide.
 *
 * The router says "not sure" (→ model) far more often than it guesses. A wrong answer from code is
 * worse than a slow answer from the model, so:
 * - anything that asks to change the books, asks why, asks for advice, or is vague goes to the model;
 * - a code route is taken only on an exact pattern, and the tool's own answer must be complete (e.g.
 *   `ask_books` placed every word and returned a figure); otherwise the turn falls back to the model.
 */
import { currencyDigits, minorToMajor } from '../../lib/currencyMinorUnits';
import { runAssistantTurn, turnMetric, type AssistantTurnInput, type AssistantTurnMetric } from './assistantTurn';

export type CodeRoute =
  | { tool: 'ask_books'; args: { question: string }; template: 'figure' }
  | { tool: 'run_report'; args: { report: 'aging'; params: { type: 'ar' | 'ap' } }; template: 'aging' }
  | { tool: 'search_records'; args: { text: string; collections: ReadonlyArray<'invoices' | 'customers' | 'vendors'> }; template: 'records' }
  | { tool: 'list_records'; args: { collection: 'payments'; limit: number; orderBy: { field: 'date'; direction: 'desc' } }; template: 'records' }
  | { tool: 'calculate'; args: { expression: string }; template: 'calculation' };

export type RouteDecision = { path: 'code'; route: CodeRoute } | { path: 'model'; reason: string };

/** Words that mean the person wants something done, judged, explained or advised: always the model. */
const MODEL_ONLY = /\b(create|record|make|add|set ?up|move|write ?off|fix|delete|remove|send|pay|post|change|update|edit|cancel|void|refund|approve|reconcile|draft|should|why|could|would|afford|summari[sz]e|advise|recommend|suggest|check|forecast|predict|plan|hire|compare|best|worse|better|help)\b/i;
const VAGUE = /\b(something|anything|stuff|things?|looks? off|weird|wrong)\b/i;

const MAX_ROUTED_LENGTH = 120;
const INVOICE_NO = /\binvoice\s+(?:no\.?\s*|number\s*|#\s*)?([A-Za-z]{1,6}-?\d{1,10})\b/i;
const PURE_ARITHMETIC = /^[\d\s.,+\-*/()]+$/;

export function routeQuestion(raw: string): RouteDecision {
  const question = raw.trim().replace(/\s+/g, ' ');
  if (!question) return { path: 'model', reason: 'empty' };
  if (question.length > MAX_ROUTED_LENGTH) return { path: 'model', reason: 'long' };
  if (MODEL_ONLY.test(question)) return { path: 'model', reason: 'action-or-judgement' };
  if (VAGUE.test(question)) return { path: 'model', reason: 'vague' };
  // two questions in one ("what is X and who owes Y") — not one exact answer
  if ((question.match(/\?/g) ?? []).length > 1 || /\band (who|what|how|which)\b/i.test(question)) return { path: 'model', reason: 'several-questions' };

  const q = question.toLowerCase();

  // arithmetic the person typed out: only digits and operators after "what is"
  const sum = q.replace(/^(what('s| is)|calculate|compute)\s+/, '').replace(/\?$/, '').trim();
  if (sum && PURE_ARITHMETIC.test(sum) && /\d\s*[+\-*/]\s*\d/.test(sum)) {
    return { path: 'code', route: { tool: 'calculate', args: { expression: sum.replace(/,(?=\d{3}\b)/g, '') }, template: 'calculation' } };
  }

  const invoice = INVOICE_NO.exec(question);
  if (invoice && /^(show|find|open|is|was|what('s| is)|status of)\b/i.test(q)) {
    return { path: 'code', route: { tool: 'search_records', args: { text: invoice[1].toUpperCase(), collections: ['invoices'] }, template: 'records' } };
  }

  // the aging report gives totals by how overdue, not names or due dates: only "how much in total" is exact
  if (/^how much do (customers|clients) owe( me| us)?( in total)?\??$/.test(q) || /^how much (am i|are we) owed( in total)?\??$/.test(q)) {
    return { path: 'code', route: { tool: 'run_report', args: { report: 'aging', params: { type: 'ar' } }, template: 'aging' } };
  }
  if (/^how much do (i|we) owe( suppliers| vendors)?( in total)?\??$/.test(q)) {
    return { path: 'code', route: { tool: 'run_report', args: { report: 'aging', params: { type: 'ap' } }, template: 'aging' } };
  }

  const find = /^find (the )?(customer|vendor|supplier) (.{2,60}?)\.?$/i.exec(question);
  if (find) {
    const collection = find[2].toLowerCase() === 'customer' ? 'customers' : 'vendors';
    return { path: 'code', route: { tool: 'search_records', args: { text: find[3], collections: [collection] }, template: 'records' } };
  }

  const payments = /^(list|show) (my )?(last|latest) (\d{1,2}|five|ten) payments\.?$/.exec(q);
  if (payments) {
    const words: Record<string, number> = { five: 5, ten: 10 };
    const limit = Math.min(20, words[payments[4]] ?? Number(payments[4]));
    return { path: 'code', route: { tool: 'list_records', args: { collection: 'payments', limit, orderBy: { field: 'date', direction: 'desc' } }, template: 'records' } };
  }

  // a figure from accounts and a period ("what is my cash balance", "what were my sales this month"):
  // ask_books reads it with plain matching and refuses what it cannot place, so its answer decides.
  if (/^(what('s| is| was| were| did)|how much)\b/.test(q) && /\b(balance|cash|bank|sales|revenue|income|spen[dt]|expenses?|costs?)\b/.test(q)) {
    return { path: 'code', route: { tool: 'ask_books', args: { question }, template: 'figure' } };
  }

  return { path: 'model', reason: 'no-exact-route' };
}

/**
 * Formats an amount given in the currency's minor units (yen has none, KWD has three). Without a
 * workspace currency the digits are unknown, so the answer is not stated.
 */
function money(minor: number, currency: string | null): string | null {
  if (!currency) return null;
  let digits: number;
  try { digits = currencyDigits(currency); } catch { return null; }
  const value = minorToMajor(minor, currency).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value} ${currency}`;
}

/**
 * Words the tool's answer from a fixed template, or returns null when the answer is not complete
 * enough to state — the caller then asks the model instead. Nothing here calculates money: figures
 * come straight from the tool.
 */
export function wordCodeAnswer(route: CodeRoute, result: unknown, currency: string | null): string | null {
  if (!result || typeof result !== 'object' || 'error' in (result as object)) return null;
  const r = result as Record<string, unknown>;
  switch (route.template) {
    case 'figure': {
      const answer = r.answer as { answerCents?: number } | null | undefined;
      const reading = r.reading as { problem?: string | null; understood?: { accounts?: string[]; period?: string } } | undefined;
      if (!answer || typeof answer.answerCents !== 'number' || reading?.problem) return null;
      const amount = money(answer.answerCents, currency);
      if (!amount) return null;
      const accounts = reading?.understood?.accounts?.join(', ') || 'the matching accounts';
      const period = reading?.understood?.period || 'the period asked';
      return `${amount} — ${accounts}, ${period}. Source: posted entries (explain this number).`;
    }
    case 'aging': {
      // the aging route returns minor units per bucket and a total (reportRoutes.ts /aging)
      const buckets = ['current', '1-30', '31-60', '61-90', '90+'] as const;
      if (typeof r.total !== 'number' || buckets.some(b => typeof r[b] !== 'number')) return null;
      const total = money(r.total, currency);
      if (!total) return null;
      const parts = buckets.map(b => `${b === 'current' ? 'not yet due' : `${b} days overdue`} ${money(r[b] as number, currency)}`);
      const who = route.args.params.type === 'ar' ? 'Customers owe you' : 'You owe suppliers';
      return `${who} ${total} (${parts.join('; ')}). Source: aging report.`;
    }
    case 'records': {
      // list_records returns `records`; search_records returns `matches[].record` (sandboxTools.ts)
      const records = Array.isArray(r.records) ? r.records as Array<Record<string, unknown>>
        : Array.isArray(r.matches) ? (r.matches as Array<{ record?: Record<string, unknown> }>).map(m => m.record ?? {}) : undefined;
      if (!records) return null;
      const what = route.tool === 'list_records' ? route.args.collection : route.args.collections.join(', ');
      if (!records.length) return `No matching ${what} found. Source: ${what} records.`;
      const label = (x: Record<string, unknown>) => String(x.number ?? x.invoiceNumber ?? x.name ?? x.reference ?? x.id ?? '').slice(0, 80);
      const listed = records.slice(0, 10).map(label).filter(Boolean);
      return `${records.length} found: ${listed.join(', ')}${records.length > 10 ? ', …' : ''}. Source: ${what} records.`;
    }
    case 'calculation': {
      // calculate returns { expression, cents, amount } (exact decimal arithmetic, sandboxTools.ts)
      if (typeof r.cents !== 'number') return null;
      const sign = r.cents < 0 ? '-' : '';
      const abs = Math.abs(r.cents);
      return `${route.args.expression} = ${sign}${Math.trunc(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}. Source: calculate.`;
    }
  }
}

/**
 * One assistant turn with the router in front: an exact question is answered by its read tool and a
 * fixed template (path `code`, no model call); otherwise — or when the tool's answer is not complete
 * enough to state — the model loop answers (path `model`).
 */
export async function answerTurn(input: AssistantTurnInput & { currency: string | null }): Promise<{ answer: string; metric: AssistantTurnMetric }> {
  const now = input.now ?? (() => performance.now());
  const started = now();
  const decision = routeQuestion(input.question);
  if (decision.path === 'code') {
    let result: unknown;
    try { result = await input.callTool(decision.route.tool, decision.route.args as unknown as Record<string, unknown>); }
    catch { result = undefined; }
    const answer = wordCodeAnswer(decision.route, result, input.currency);
    if (answer) {
      const ended = now();
      return { answer, metric: turnMetric({ path: 'code', traces: [], toolsOffered: 0, toolsCalled: [decision.route.tool],
        answerMs: ended - started, totalMs: ended - started, ok: true }) };
    }
  }
  return runAssistantTurn(input);
}
