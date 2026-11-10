import { computeTax } from '../../../src/lib/taxCodes.ts';
const code = { id: 'x', name: 'x', treatment: 'standard' as const, components: [{ name: 'a', rate: 8.875 }] };
let diffDown = 0, diffEven = 0, n = 0;
for (let a = 1; a < 200000; a += 7) { n++;
  const u = computeTax(a, code, false, 'half_up').taxCents;
  if (computeTax(a, code, false, 'down').taxCents !== u) diffDown++;
  if (computeTax(a, code, false, 'half_even').taxCents !== u) diffEven++;
}
console.log({ n, 'down differs from half_up': diffDown, 'half_even differs from half_up': diffEven });
console.log('19.99 inclusive 10% down ->', JSON.stringify(computeTax(1999, { id: 'x', name: 'x', treatment: 'standard', components: [{ name: 'a', rate: 10 }] }, true, 'down')));
