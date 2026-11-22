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
import { formatMoney } from '../../lib/moneyFormat';
import { answerCents } from '../../lib/askBooks';
import { runAssistantTurn, turnMetric, type AssistantTurnInput, type AssistantTurnMetric } from './assistantTurn';

export type CodeRoute =
  | { tool: 'ask_books'; args: { question: string }; template: 'figure' }
  | { tool: 'ask_books'; args: { question: string }; template: 'balance' }
  | { tool: 'run_report'; args: { report: 'aging'; params: { type: 'ar' | 'ap' } }; template: 'aging' }
  | { tool: 'search_records'; args: { text: string; collections: ReadonlyArray<'invoices' | 'customers' | 'vendors'> }; template: 'records'; asksPaid?: true }
  | { tool: 'list_records'; args: { collection: 'payments'; limit: number; orderBy: { field: 'date'; direction: 'desc' } }; template: 'records' }
  | { tool: 'calculate'; args: { expression: string }; template: 'calculation' };

export type RouteDecision = { path: 'code'; route: CodeRoute } | { path: 'model'; reason: string };

/** Words that mean the person wants something done, judged, explained or advised: always the model. */
const MODEL_ONLY = /\b(create|record|make|add|set ?up|move|write ?off|fix|delete|remove|send|pay|post|change|update|edit|cancel|void|refund|approve|reconcile|draft|should|why|could|would|afford|summari[sz]e|advise|recommend|suggest|check|forecast|predict|plan|hire|compare|best|worse|better|help)\b/i;
const VAGUE = /\b(something|anything|stuff|things?|looks? off|weird|wrong)\b/i;
/**
 * Words that narrow, exclude, split or compare a figure. ask_books matches accounts and a period but
 * does not reject words it does not use, so "sales excluding refunds" would read as plain sales; any
 * of these sends the question to the model.
 */
const QUALIFIER = /\b(exclud\w*|includ\w*|except|without|minus|less|net|profit|gross|only|just|but|not|no|per|each|every|by|average|avg|mean|median|total of|compared?|versus|vs|than|growth|change|increase|decrease|trend|share|ratio|margin|from|to|in|at|between|since|until|before|after|for|of)\b|%|percent/i;

const MAX_ROUTED_LENGTH = 120;
/** The periods ask_books' readPeriod understands; removed before looking for any other time word. */
const READ_PERIOD = new RegExp(String.raw`\b(this|last) (fiscal )?(year|month)\b|\byear to date\b|\bytd\b|\bq[1-4] (19|20)\d{2}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec) (19|20)\d{2}\b|\b(19|20)\d{2}\b`, 'g');
/** A readable period, with the "in" that often comes before it ("sales in March 2026"). */
const READ_PERIOD_WITH_IN = new RegExp(String.raw`\b(in )?(?:${READ_PERIOD.source})`, 'g');
const UNREAD_PERIOD = /\b(today|yesterday|tomorrow|tonight|now|day|days|daily|week|weeks|weekly|weekend|weekends|fortnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|on|as of|since|until|till|before|after|eod|eom|end of|month|months|monthly|quarter|quarters|quarterly|q[1-4]|year|years|yearly|annual|next|previous|recent|recently|ago|so far|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/;
/** search_records' default match limit (sandboxTools.ts): a full page may have been cut short */
const SEARCH_RESULT_CAP = 20;
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
  // The invoice template states number, status and due date only: amounts and other fields go to the model.
  if (invoice && /^(show|find|open|is|was|what('s| is)|status of)\b/i.test(q)
    && !/\b(amount|outstanding|owed?|owing|balance|total|left|remaining|paid how much|how much|tax|vat|lines?|items?|who|when was|sent|email)\b/.test(q)) {
    // "is/was invoice X paid?" is a yes/no question: the answer leads with yes or no, not just the status
    // Only the plain form gets a verdict; "partially paid", "not paid", "paid on time", "paid or overdue" go to the model.
    const plainPaid = /^(is|was) (the )?invoice (no\.?\s*|number\s*|#\s*)?[a-z]{1,6}-?\d{1,10} (fully )?paid\??$/.test(q);
    if (!plainPaid && /\bpaid\b/.test(q)) return { path: 'model', reason: 'no-exact-route' };
    const asksPaid = plainPaid ? { asksPaid: true as const } : {};
    return { path: 'code', route: { tool: 'search_records', args: { text: invoice[1].toUpperCase(), collections: ['invoices'] }, template: 'records', ...asksPaid } };
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

  // a balance ("what is my cash balance", "how much is in the bank"): the accounts come from ask_books,
  // the figure from the explain report with no start date, so opening balances and earlier years count
  if (/^(what('s| is)|how much)\b/.test(q) && /\b(balance|in the bank)\b/.test(q) && /\b(cash|bank)\b/.test(q)
      && !QUALIFIER.test(q.replace(/\btoday\b|\bnow\b|\bin the bank( account)?\b/g, ''))
      // today/now or a period ask_books reads (the balance at its end); any other date goes to the model
      && !UNREAD_PERIOD.test(q.replace(/\btoday\b|\bnow\b/g, ' ').replace(READ_PERIOD, ' '))
      && !/\d/.test(q.replace(READ_PERIOD, ' '))) {
    return { path: 'code', route: { tool: 'ask_books', args: { question }, template: 'balance' } };
  }
  // a figure from accounts and a period ("what were my sales this month"): only the periods ask_books
  // reads (readPeriod in askBooks.ts). Any other time word ("today", "this quarter", "last week", "March"
  // without a year) would silently become this year to date, so the model answers those.
  // ask_books reads it with plain matching and refuses what it cannot place, so its answer decides.
  if (/^(what('s| is| was| were| did)|how much)\b/.test(q) && /\b(sales|revenue|income|spen[dt]|expenses?|costs?)\b/.test(q)
      && !/\b(balance|cash|bank)\b/.test(q)
      && !UNREAD_PERIOD.test(q.replace(READ_PERIOD, ' '))
      // a leftover day or ISO/slash date would be read as the whole month or year
      && !/\d/.test(q.replace(READ_PERIOD, ' '))
      && !QUALIFIER.test(q.replace(READ_PERIOD_WITH_IN, ' ').replace(/\bin the bank( account)?\b/g, ' '))) {
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

/** One record in words, with the fields a lookup asks about; null when a payment's amount cannot be stated. */
function describeRecord(x: Record<string, unknown>, collection: string, currency?: string | null): string | null {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
  if (collection === 'invoices') {
    const parts = [str(x.status) && `status ${str(x.status)}`, str(x.dueDate) && `due ${str(x.dueDate)}`].filter(Boolean);
    return `Invoice ${str(x.number) ?? str(x.invoiceNumber) ?? str(x.id) ?? '?'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  }
  if (collection === 'payments') {
    // the same formatter the payment screens use for amountCents
    const cur = str(x.currency) ?? currency ?? undefined;
    if (typeof x.amountCents !== 'number' || !cur) return null;
    return [str(x.date), formatMoney(x.amountCents, cur), str(x.reference)].filter(Boolean).join(' ');
  }
  return str(x.name) ?? str(x.number) ?? str(x.id) ?? '?';
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
    case 'balance': {
      // the result here is the explain report's (no start date), with the reading attached by answerTurn
      const reading = r.reading as { problem?: string | null; sense?: 'spent' | 'earned' | 'net'; understood?: { accounts?: string[] }; filter?: { endDate?: string; label?: unknown } | null } | undefined;
      if (typeof r.totalCents !== 'number' || !reading || reading.problem || reading.filter?.label) return null;
      const amount = money(answerCents(r.totalCents, reading.sense ?? 'net'), currency);
      if (!amount) return null;
      const accounts = reading.understood?.accounts?.join(', ') || 'the matching accounts';
      // name the day the balance is at: "last year" means the end of last year, not today
      const asOf = reading.filter?.endDate;
      return `${amount} — ${accounts}, balance ${asOf ? `at ${asOf}` : 'to date'} including opening balances. Source: posted entries (explain this number).`;
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
      // list_records returns `records`; search_records returns `matches[].record` (sandboxTools.ts).
      // search_records matches substrings inside text fields and reads a capped number of records,
      // so its result is never stated as exact: an invoice must match its number exactly, and an
      // empty or full (possibly truncated) search goes to the model.
      let records = Array.isArray(r.records) ? r.records as Array<Record<string, unknown>>
        : Array.isArray(r.matches) ? (r.matches as Array<{ record?: Record<string, unknown> }>).map(m => m.record ?? {}) : undefined;
      if (!records) return null;
      if (route.tool === 'search_records') {
        if (records.length >= SEARCH_RESULT_CAP) return null;
        if (route.args.collections.length === 1 && route.args.collections[0] === 'invoices') {
          records = records.filter(x => String(x.number ?? x.invoiceNumber ?? '').toUpperCase() === route.args.text);
        }
        if (!records.length) return null;
        if (route.asksPaid) {
          // one exact invoice with a known status, or the model answers
          const status = records.length === 1 && typeof records[0].status === 'string' ? records[0].status.trim().toLowerCase() : '';
          if (!status) return null;
          const verdict = status === 'paid' ? 'Yes' : status === 'void' ? 'No — it was voided' : 'No';
          return `${verdict}. ${describeRecord(records[0], 'invoices')}. Source: invoices records.`;
        }
        return records.slice(0, 10).map(x => describeRecord(x, route.args.collections[0])).join('; ') + `. Source: ${route.args.collections.join(', ')} records.`;
      }
      if (!records.length) return 'No payments recorded yet. Source: payments records.';
      const lines = records.map(x => describeRecord(x, 'payments', currency));
      if (lines.some(l => l === null)) return null;
      return `Last ${records.length} payments: ${lines.join('; ')}. Source: payments records.`;
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
    const toolsUsed: string[] = [decision.route.tool];
    try {
      result = await input.callTool(decision.route.tool, decision.route.args as unknown as Record<string, unknown>);
      if (decision.route.template === 'balance') {
        const reading = (result as { reading?: { filter?: { accountIds?: string[]; endDate?: string; label?: unknown } | null; problem?: string | null } })?.reading;
        const filter = reading?.filter;
        // a label narrows the balance, and the explain report leaves opening balances out when a label is
        // set, so a labelled balance is not exact here: the model answers it
        if (!filter?.accountIds?.length || reading?.problem || filter.label) result = undefined;
        else {
          toolsUsed.push('explain_number');
          const explained = await input.callTool('explain_number', { accountIds: filter.accountIds, ...(filter.endDate ? { endDate: filter.endDate } : {}) });
          result = explained && typeof explained === 'object' ? { ...(explained as object), reading } : undefined;
        }
      }
    } catch { result = undefined; }
    const answer = wordCodeAnswer(decision.route, result, input.currency);
    if (answer) {
      const ended = now();
      return { answer, metric: turnMetric({ path: 'code', traces: [], toolsOffered: 0, toolsCalled: toolsUsed,
        answerMs: ended - started, totalMs: ended - started, ok: true }) };
    }
    // fell back: the person also waited for the code tool, so its time and name count in this turn
    const spent = now() - started;
    const fallback = await runAssistantTurn(input);
    return { answer: fallback.answer, metric: { ...fallback.metric,
      toolsCalled: [...toolsUsed, ...fallback.metric.toolsCalled],
      answerMs: Math.round(fallback.metric.answerMs + spent), totalMs: Math.round(fallback.metric.totalMs + spent) } };
  }
  return runAssistantTurn(input);
}
