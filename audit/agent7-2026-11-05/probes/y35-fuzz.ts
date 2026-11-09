// Agent #7 probe: fuzz computeTax / roundTaxCents (Y-35 tax rounding policy) at upstream 28b90c2e.
// Review-only: imports pure functions, touches nothing. Run from the repo root:
//   NODE_ENV=test npx tsx <this file>
import { computeTax, roundTaxCents, effectiveRate, documentTotals } from '../../../src/lib/taxCodes.ts';
import type { TaxCode, TaxRounding } from '../../../src/lib/taxCodes.ts';
import { netFromGross } from '../../../src/lib/documentMath.ts';

let seed = 123456789;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const RATES = [0.5, 1, 3, 5, 6.25, 7, 7.8125, 8.875, 9.975, 10, 12.5, 13, 15, 17, 18, 19, 20, 21, 23, 25, 27];
const MODES: TaxRounding[] = ['half_up', 'half_even', 'down'];

// legacy (pre-Y-35) algorithm, copied from git show bceae940^:src/lib/taxCodes.ts
function legacyComponentTaxes(base: number, comps: { rate: number; compound?: boolean }[]) {
  let running = 0;
  return comps.map(c => { const on = c.compound ? base + running : base; const t = Math.round((on * c.rate) / 100); running += t; return t; });
}
function legacy(amount: number, comps: { rate: number; compound?: boolean }[], inclusive: boolean) {
  let net = amount; let taxes: number[];
  if (inclusive) {
    net = netFromGross(amount, effectiveRate(comps as never));
    taxes = legacyComponentTaxes(net, comps);
    taxes[taxes.length - 1] += amount - net - taxes.reduce((s, t) => s + t, 0);
  } else taxes = legacyComponentTaxes(net, comps);
  return { net, taxes, tax: taxes.reduce((s, t) => s + t, 0) };
}

const fails: Record<string, { n: number; example?: unknown }> = {};
const bad = (k: string, ex: unknown) => { const f = (fails[k] ||= { n: 0 }); f.n++; if (!f.example) f.example = ex; };
const N = 400000;
for (let i = 0; i < N; i++) {
  const nComp = 1 + Math.floor(rnd() * 3);
  const comps = Array.from({ length: nComp }, (_, j) => ({ name: `c${j}`, rate: pick(RATES), compound: j > 0 && rnd() < 0.5 }));
  const code: TaxCode = { id: 'x', name: 'x', treatment: 'standard', components: comps };
  const magnitude = pick([100, 1000, 100000, 10_000_000]);
  const amount = Math.floor(rnd() * magnitude);
  const inclusive = rnd() < 0.5;
  for (const mode of MODES) {
    const r = computeTax(amount, code, inclusive, mode);
    const sumParts = r.components.reduce((s, c) => s + c.taxCents, 0);
    const ctx = { amount, inclusive, mode, comps: comps.map(c => `${c.rate}${c.compound ? 'c' : ''}`).join('+'), r };
    if (sumParts !== r.taxCents) bad('parts-sum-mismatch', ctx);
    if (r.components.some(c => c.taxCents < 0) || r.netCents < 0 || r.taxCents < 0) bad('negative', ctx);
    if (inclusive ? r.netCents + r.taxCents !== amount : r.netCents !== amount) bad('net+tax!=amount', ctx);
    if (!Number.isInteger(r.taxCents) || !Number.isInteger(r.netCents)) bad('non-integer', ctx);
    if (mode === 'half_up') {
      const l = legacy(amount, comps, inclusive);
      if (l.tax !== r.taxCents || l.net !== r.netCents) bad('half_up-differs-from-legacy', { ...ctx, legacy: l });
    }
    if (!inclusive && mode === 'down') {
      // exclusive 'down' must never exceed the exact (unrounded) tax by more than float noise
      let running = 0; let exact = 0;
      for (const c of comps) { const on = c.compound ? amount + running : amount; const e = on * c.rate / 100; exact += e; running += Math.floor(e + 1e-7); }
      if (r.taxCents > exact + 1e-6) bad('down-exceeds-exact', ctx);
    }
    const t = documentTotals(amount, 0, code, inclusive, mode);
    if (t.amountCents !== (inclusive ? amount : amount + t.taxCents)) bad('totals-amount', ctx);
  }
}
// roundTaxCents semantics
const half = (k: number) => k + 0.5;
for (let k = 0; k < 2000; k++) {
  const e = roundTaxCents(half(k), 'half_even'); if (e % 2 !== 0) bad('half_even-not-even', { k, e });
  if (roundTaxCents(half(k), 'half_up') !== k + 1) bad('half_up-half', { k });
  if (roundTaxCents(half(k), 'down') !== k) bad('down-half', { k });
}
// unknown/invalid mode string from a hand-edited workspace document falls back to half-up behaviour
const odd = roundTaxCents(10.5, 'bogus' as never);
console.log(`cases: ${N} x 3 modes; unknown-mode(10.5)=${odd}`);
console.log(Object.keys(fails).length === 0 ? 'ALL PROPERTIES HELD' : JSON.stringify(fails, null, 1));
