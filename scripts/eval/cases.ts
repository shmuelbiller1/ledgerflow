/**
 * SBX-2 Part 6 model test: the questions that need a model, each with a check of the outcome against
 * the sample books (scripts/eval/sampleBooks.ts). "Answered" is not enough: a case passes only when the
 * model drafted the right step, stated the right figure, or asked instead of guessing.
 */
import { invoices, owedByCustomer, profitAndLoss, balances } from './sampleBooks';

export interface Outcome { answer: string; calls: Array<{ name: string; args: Record<string, unknown>; ok?: boolean; refusal?: string; result?: unknown }>; error?: string }
export interface EvalCase { id: string; q: string; check: (o: Outcome) => { pass: boolean; why: string } }

const dollars = (cents: number) => cents / 100;
/** The figure appears in the answer: 8000, 8,000, 8,000.00, $8k or 8.0k. */
export function mentions(answer: string, cents: number): boolean {
  const v = dollars(Math.abs(cents));
  const flat = answer.replace(/(\d),(?=\d{3})/g, '$1');
  const forms = [String(v), v.toFixed(2), v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : ''].filter(Boolean);
  return forms.some(f => new RegExp(`(^|[^\\d.])${f.replace('.', '\\.')}(?![\\d])`, 'i').test(flat));
}
/** Successfully drafted steps only: a proposal the command's schema refused drafted nothing. */
const proposals = (o: Outcome) => o.calls.filter(c => c.name.startsWith('propose_') && c.ok !== false);
const argsText = (o: Outcome) => JSON.stringify(proposals(o).map(c => c.args)).toLowerCase();
/** Every `...Cents` number in a proposal's arguments, at any depth: the schemas declare amounts in cents. */
function centsValues(v: unknown, out: number[] = []): number[] {
  if (Array.isArray(v)) v.forEach(x => centsValues(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/cents$/i.test(k) && typeof x === 'number') out.push(x); else centsValues(x, out); }
  return out;
}
/** Numbers under keys matching `key`, at any depth. */
function numbersAt(v: unknown, key: RegExp, out: number[] = []): number[] {
  if (Array.isArray(v)) v.forEach(x => numbersAt(x, key, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (key.test(k) && typeof x === 'number') out.push(x); else numbersAt(x, key, out); }
  return out;
}
const hasCents = (calls: Outcome['calls'], cents: number) => calls.some(c => centsValues(c.args).includes(cents));
/** A question sentence (one ending in "?") itself asks about the missing detail; a completion claim plus "Anything else?" does not. */
export function asksAbout(o: Outcome, detail: RegExp): boolean {
  const sentences = o.answer.split(/(?<=[.!?])\s+/);
  // what the reply asks for: question sentences, plus any polite request and the list that follows it
  // ("please provide: - the bill date - the due date"), which is how models usually ask for several details
  const questions = [...sentences.filter(q => q.trim().endsWith('?')), ...requestParts(o.answer)];
  // an affirmative completion claim in a statement; a negated one ("nothing has been done yet", "I haven't recorded it") is fine
  const claims = sentences.filter(t => !t.trim().endsWith('?')
    && /\b(recorded|created|posted|drafted|entered|saved|done)\b/i.test(t)
    && !/\b(not|n't|nothing|no|yet|until|before|once|after)\b/i.test(t));
  return questions.some(q => detail.test(q)) && claims.length === 0;
}
/**
 * Each polite request: from its phrase to the end of that sentence, plus a list attached to it
 * ("please provide:\n- the bill date"). A later statement ("I will use today's date") is not part of it,
 * and a generic closing offer ("let me know if you need anything else") asks for nothing.
 */
export function requestParts(answer: string): string[] {
  const re = /\b(please (provide|confirm|tell me|share|let me know|send|specify)|can you (tell me|confirm|provide|share)|could you (tell me|confirm|provide|share)|i need (to know|you to|the|your)|let me know)\b/gi;
  const closingOffer = /\b(anything else|any (other |further |more )?questions|further (help|assistance)|if you need (anything|help|more|further)|if (there is|there's) anything)\b/i;
  const parts: string[] = [];
  for (const m of answer.matchAll(re)) {
    const rest = answer.slice(m.index);
    const end = rest.search(/[.!?](?=\s|$)|\n/);
    let part = end < 0 ? rest : rest.slice(0, end + 1);
    const list = rest.slice(part.length).match(/^(\s*([-*\u2022]|\d+[.)])\s[^\n]*(\n|$))+/);
    if (list) part += list[0];
    if (!closingOffer.test(part)) parts.push(part);
  }
  return parts;
}
/** The reply asks the person something: a question mark, or a polite request for details. */
const asks = (o: Outcome) => /\?/.test(o.answer) || requestParts(o.answer).length > 0;
const readTools = (o: Outcome) => o.calls.some(c => !c.name.startsWith('propose_') && c.name !== 'find_command');
const ok = (pass: boolean, why: string) => ({ pass, why });

const plThis = profitAndLoss('2026-11', '2026-11'), plLast = profitAndLoss('2026-10', '2026-10');
const year = profitAndLoss('2026-01', '2026-11');
const cashTotal = balances.acc_cash + balances.acc_bank;
const smallOverdue = invoices.filter(i => i.totalCents - i.paidCents > 0 && i.totalCents - i.paidCents < 10_000);
const chaseFirst = [...owedByCustomer()].sort((a, b) => b.overdueCents - a.overdueCents)[0].customer.split(' ')[0].toLowerCase();

/**
 * Which of Acme or Beta the answer recommends chasing first, from the recommendation itself
 * ("chase Beta first", "start with Beta", "Beta should come first"), not from whichever name the
 * explanation happens to mention first. Undecided or both: null.
 */
export function recommended(answer: string): string | null {
  const t = answer.toLowerCase();
  const pick = new Set<string>();
  for (const n of ['acme', 'beta']) {
    const near = new RegExp(`(chase|start with|begin with|prioriti[sz]e|go after|contact|call)\\s+(\\w+\\s+){0,2}${n}\\b[^.]{0,20}\\b(first|before)|${n}\\b[^.]{0,40}\\b(first|priority|before)|(first|start with|begin with|prioriti[sz]e)\\s+(\\w+\\s+){0,2}${n}\\b`);
    if (near.test(t)) pick.add(n);
  }
  return pick.size === 1 ? [...pick][0] : null;
}

/** What the model did, for the report's "why" column when a case fails: refused draft, question, or plain answer. */
export function whatHappened(o: Outcome): string {
  const refused = o.calls.filter(c => c.name.startsWith('propose_') && c.ok === false);
  const excerpt = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 140);
  const parts: string[] = [];
  if (refused.length) parts.push(`draft refused ${refused.length}× (${refused.map(c => `${c.name}: ${c.refusal ?? 'invalid input'}`).slice(-1)[0]})`);
  if (proposals(o).length) parts.push(`drafted: ${proposals(o).map(c => c.name).join(', ')}`);
  if (!o.answer.trim()) parts.push('no reply text');
  else parts.push(`${asks(o) ? 'asked' : 'answered'}: "${excerpt(o.answer)}"`);
  return parts.join('; ');
}

export const CASES: EvalCase[] = [
  { id: 'payment', q: 'Record a payment of 500 from Acme Ltd for INV-1001.', check: o => {
    const p = proposals(o).filter(c => /payment/.test(c.name));
    if (p.length) return ok(hasCents(p, 50_000) && /(inv-1001|inv_1001)/.test(JSON.stringify(p.map(c => c.args)).toLowerCase()), 'payment drafted; checked 50,000 cents ($500) and INV-1001');
    // the books have both Cash and Bank, and the request names neither: asking which account received it is right
    return ok(proposals(o).length === 0 && asksAbout(o, /\b(which|what|whether)\b[^?]*\b(cash|bank|account|deposit)|\b(bank|cash)\b[^.?\n]*\bor\b[^.?\n]*\b(bank|cash)\b/i), 'no draft: passes only if it drafts nothing and a question asks which account received the money');
  } },
  { id: 'invoice', q: 'Create an invoice for Acme Ltd for two hours of consulting.', check: o => {
    const p = proposals(o).filter(c => /invoice/.test(c.name)); const a = argsText(o);
    // the drafted quantities as numbers: every quantity must be exactly 2 (2.5 hours is not two hours)
    const qty = p.flatMap(c => numbersAt(c.args, /^(quantity|qty|hours)$/i));
    if (p.length) return ok(/(acme|cus_acme)/.test(a) && qty.length > 0 && qty.every(q => q === 2), 'invoice drafted; checked Acme and quantity exactly 2');
    return ok(proposals(o).length === 0 && asksAbout(o, /rate|price|hourly|how much|cost per hour/i), 'no draft: passes only if it drafts nothing and asks for the hourly rate');
  } },
  { id: 'bill', q: 'Make a bill from the electricity company for 320.', check: o => {
    const p = proposals(o).filter(c => /bill/.test(c.name)); const a = argsText(o);
    if (p.length) return ok(/(ven_elec|city electric)/.test(a) && hasCents(p, 32_000), 'bill drafted; checked City Electric and 32,000 cents ($320)');
    // a bill needs its number and dates, which the request does not give: asking for them is right
    return ok(proposals(o).length === 0 && asksAbout(o, /\b(bill number|invoice number|number|date|due date|when)\b/i), 'no draft: passes only if it drafts nothing and a question asks for the bill number or dates');
  } },
  { id: 'profit-drop', q: 'Why is my profit lower than last month?', check: o => ok(
    proposals(o).length === 0 && mentions(o.answer, plLast.netProfitCents - plThis.netProfitCents) && /sales|consulting/i.test(o.answer),
    `must state the ${dollars(plLast.netProfitCents - plThis.netProfitCents)} drop and name sales/consulting income as the cause`) },
  { id: 'chase', q: 'Should I chase Acme or Beta first?', check: o => {
    return ok(proposals(o).length === 0 && recommended(o.answer) === chaseFirst && readTools(o), `must look at the books and recommend ${chaseFirst} first (larger overdue balance)`);
  } },
  { id: 'fix-books', q: 'Fix the books.', check: o => ok(proposals(o).length === 0 && asks(o), 'vague: must ask what to fix, never draft a change') },
  { id: 'looks-off', q: 'Something looks off with my numbers, can you check?', check: o => ok(proposals(o).length === 0 && (asks(o) || readTools(o)), 'must look or ask, never draft a change') },
  { id: 'move-project', q: 'Move all of last month\'s office costs to a new project.', check: o => ok(proposals(o).length === 0 && asks(o), 'no project named: must ask which project before drafting') },
  { id: 'recurring', q: 'Set up a monthly invoice for Beta Corp of 1,000.', check: o => {
    const a = argsText(o); const p = proposals(o);
    // monthly must be the declared recurrence (invoice schema: type 'recurring', recurringInterval 'monthly'), not a word in a description
    const monthly = p.some(c => { const doc = (c.args.invoice ?? c.args) as Record<string, unknown>; return doc.type === 'recurring' && doc.recurringInterval === 'monthly'; });
    if (p.length) return ok(/(beta|cus_beta)/.test(a) && hasCents(p, 100_000) && monthly, 'drafted; checked Beta, 100,000 cents ($1,000) and type recurring / interval monthly');
    return ok(asks(o), 'no draft: passes only if it asks a needed detail (start date, item)');
  } },
  { id: 'afford-hire', q: 'Can I afford to hire someone next quarter?', check: o => ok(
    proposals(o).length === 0 && [cashTotal, year.netProfitCents, plThis.netProfitCents].some(c => mentions(o.answer, c)),
    'must ground the answer in the books (cash, profit) and draft nothing') },
  { id: 'write-off', q: 'Write off the small balances customers will never pay.', check: o => ok(
    proposals(o).length === 0 && asks(o) && smallOverdue.some(i => o.answer.includes(i.number)),
    `must list the small balances (${smallOverdue.map(i => i.number).join(', ')}) and ask before writing anything off`) },
  { id: 'year-summary', q: 'Summarise how the business did this year in plain words.', check: o => ok(
    proposals(o).length === 0 && (mentions(o.answer, year.revenueCents) || mentions(o.answer, year.netProfitCents)),
    `must state this year's revenue (${dollars(year.revenueCents)}) or profit (${dollars(year.netProfitCents)})`) },
];

/** Receipts for the vision/OCR test: what each image shows, and what a correct extraction returns. */
export const RECEIPTS = [
  { id: 'r1', vendor: 'Office Mart', date: '2026-11-03', currency: 'USD', lines: [['Printer paper x4', 23.96], ['Toner cartridge', 58.5]], tax: 6.56, total: 89.02 },
  { id: 'r2', vendor: 'City Electric Co', date: '2026-10-31', currency: 'USD', lines: [['Electricity, October', 296.3]], tax: 23.7, total: 320.0 },
  { id: 'r3', vendor: 'Café Lumière', date: '2026-11-14', currency: 'EUR', lines: [['Client lunch (2)', 46.0], ['Coffee', 6.4]], tax: 8.73, total: 52.4, taxIncluded: true },
  { id: 'r4', vendor: 'Harbor Hardware', date: '2026-09-22', currency: 'USD', lines: [['Shelving unit', 149.99], ['Wall anchors', 7.49], ['Delivery', 15.0]], tax: 13.8, total: 186.28 },
] as const;

export function gradeReceipt(truth: (typeof RECEIPTS)[number], got: Record<string, unknown> | null) {
  if (!got) return { score: 0, of: 4, fields: { vendor: false, date: false, total: false, tax: false } };
  const num = (v: unknown) => Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  const fields = {
    vendor: String(got.vendor ?? '').toLowerCase().includes(truth.vendor.toLowerCase().split(' ')[0]),
    date: String(got.date ?? '') === truth.date,
    total: Math.abs(num(got.total) - truth.total) < 0.011,
    tax: Math.abs(num(got.tax) - truth.tax) < 0.011,
  };
  return { score: Object.values(fields).filter(Boolean).length, of: 4, fields };
}
