/**
 * SBX-2 Part 6 model test: the questions that need a model, each with a check of the outcome against
 * the sample books (scripts/eval/sampleBooks.ts). "Answered" is not enough: a case passes only when the
 * model drafted the right step, stated the right figure, or asked instead of guessing.
 */
import { invoices, owedByCustomer, profitAndLoss, balances } from './sampleBooks';

export interface Outcome { answer: string; calls: Array<{ name: string; args: Record<string, unknown> }>; error?: string }
export interface EvalCase { id: string; q: string; check: (o: Outcome) => { pass: boolean; why: string } }

const dollars = (cents: number) => cents / 100;
/** The figure appears in the answer: 8000, 8,000, 8,000.00, $8k or 8.0k. */
export function mentions(answer: string, cents: number): boolean {
  const v = dollars(Math.abs(cents));
  const flat = answer.replace(/(\d),(?=\d{3})/g, '$1');
  const forms = [String(v), v.toFixed(2), v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : ''].filter(Boolean);
  return forms.some(f => new RegExp(`(^|[^\\d.])${f.replace('.', '\\.')}(?![\\d])`, 'i').test(flat));
}
const proposals = (o: Outcome) => o.calls.filter(c => c.name.startsWith('propose_'));
const argsText = (o: Outcome) => JSON.stringify(proposals(o).map(c => c.args)).toLowerCase();
const asks = (o: Outcome) => /\?/.test(o.answer);
const readTools = (o: Outcome) => o.calls.some(c => !c.name.startsWith('propose_') && c.name !== 'find_command');
const ok = (pass: boolean, why: string) => ({ pass, why });

const plThis = profitAndLoss('2026-11', '2026-11'), plLast = profitAndLoss('2026-10', '2026-10');
const year = profitAndLoss('2026-01', '2026-11');
const cashTotal = balances.acc_cash + balances.acc_bank;
const smallOverdue = invoices.filter(i => i.totalCents - i.paidCents > 0 && i.totalCents - i.paidCents < 10_000);
const chaseFirst = [...owedByCustomer()].sort((a, b) => b.overdueCents - a.overdueCents)[0].customer.split(' ')[0].toLowerCase();

export const CASES: EvalCase[] = [
  { id: 'payment', q: 'Record a payment of 500 from Acme Ltd for INV-1001.', check: o => {
    const p = proposals(o).filter(c => /payment/.test(c.name)); const a = argsText(o);
    return ok(p.length > 0 && /(^|\D)(500|50000)(\D|$)/.test(a) && /(inv-1001|inv_1001)/.test(a), p.length ? 'payment drafted; checked amount 500 and INV-1001' : 'no payment drafted');
  } },
  { id: 'invoice', q: 'Create an invoice for Acme Ltd for two hours of consulting.', check: o => {
    const p = proposals(o).filter(c => /invoice/.test(c.name)); const a = argsText(o);
    if (p.length) return ok(/(acme|cus_acme)/.test(a) && /"quantity":2\b|"qty":2\b|"hours":2\b/.test(a.replace(/\s/g, '')), 'invoice drafted; checked Acme and quantity 2');
    return ok(asks(o) && /rate|price|hourly|how much/i.test(o.answer), 'no draft: passes only if it asks for the hourly rate');
  } },
  { id: 'bill', q: 'Make a bill from the electricity company for 320.', check: o => {
    const p = proposals(o).filter(c => /bill/.test(c.name)); const a = argsText(o);
    return ok(p.length > 0 && /(ven_elec|city electric)/.test(a) && /(^|\D)(320|32000)(\D|$)/.test(a), p.length ? 'bill drafted; checked City Electric and 320' : 'no bill drafted');
  } },
  { id: 'profit-drop', q: 'Why is my profit lower than last month?', check: o => ok(
    proposals(o).length === 0 && mentions(o.answer, plLast.netProfitCents - plThis.netProfitCents) && /sales|consulting/i.test(o.answer),
    `must state the ${dollars(plLast.netProfitCents - plThis.netProfitCents)} drop and name sales/consulting income as the cause`) },
  { id: 'chase', q: 'Should I chase Acme or Beta first?', check: o => {
    const t = o.answer.toLowerCase(); const first = ['acme', 'beta'].map(n => [n, t.indexOf(n)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0]?.[0];
    return ok(proposals(o).length === 0 && first === chaseFirst && readTools(o), `must look at the books and say ${chaseFirst} first (larger overdue balance)`);
  } },
  { id: 'fix-books', q: 'Fix the books.', check: o => ok(proposals(o).length === 0 && asks(o), 'vague: must ask what to fix, never draft a change') },
  { id: 'looks-off', q: 'Something looks off with my numbers, can you check?', check: o => ok(proposals(o).length === 0 && (asks(o) || readTools(o)), 'must look or ask, never draft a change') },
  { id: 'move-project', q: 'Move all of last month\'s office costs to a new project.', check: o => ok(proposals(o).length === 0 && asks(o), 'no project named: must ask which project before drafting') },
  { id: 'recurring', q: 'Set up a monthly invoice for Beta Corp of 1,000.', check: o => {
    const a = argsText(o); const p = proposals(o);
    if (p.length) return ok(/(beta|cus_beta)/.test(a) && /(^|\D)(1000|100000)(\D|$)/.test(a.replace(/,/g, '')) && /month/.test(a + p.map(c => c.name).join(' ')), 'drafted; checked Beta, 1,000 and monthly');
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
