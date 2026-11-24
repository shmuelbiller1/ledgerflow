/** HTTP contract checks against the real math router. Auth middleware is deliberately not mounted. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { mathRouter } from '../server/routes/mathRoutes';

let server: Server;
let base: string;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/math', mathRouter);
  await new Promise<void>((resolve, reject) => { server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/math`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });

const cases: Array<{ route: string; input: object; expected: Record<string, unknown> }> = [
  { route: 'depreciation', input: { type: 'straight_line', costCents: 100000, salvageValueCents: 10000, usefulLifePeriods: 9 }, expected: { depreciationPerPeriodCents: 10000 } },
  { route: 'inventory/wac', input: { currentQty: 100, currentValueCents: 500000, incomingQty: 50, incomingValueCents: 250000 }, expected: { newAverageCostCents: 5000, totalQuantity: 150, totalValueCents: 750000 } },
  { route: 'inventory/eoq', input: { annualDemand: 100, costPerOrderCents: 200, holdingCostPerUnitCents: 100 }, expected: { eoq: 20 } },
  { route: 'amortization', input: { principalCents: 120000, annualInterestRate: 0, totalPeriods: 12 }, expected: { periodicPaymentCents: 10000 } },
  { route: 'kpi', input: { netProfitCents: 150, investmentCostCents: 1000, currentAssetsCents: 500, currentLiabilitiesCents: 200 }, expected: { roiPercentage: 15, currentRatio: 2.5 } },
  { route: 'temporal', input: { type: 'tax', amountCents: 10000, targetDate: '2026-06-01', timeSeries: [{ validFrom: '2026-01-01', validTo: null, value: 0.1 }] }, expected: { effectiveValue: 0.1, calculatedAmountCents: 1000 } },
  { route: 'valuation', input: { equityCents: 500, debtCents: 500, costOfEquity: 0.1, costOfDebt: 0.05, taxRate: 0.2 }, expected: { waccInfo: { wacc: 0.07 } } },
];
for (const { route, input, expected } of cases) {
  test(`real POST /math/${route} returns the worked example`, async () => {
    const res = await fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.success, true);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(body[key], value);
  });
}
test('invalid depreciation input is refused, not answered as success', async () => {
  const res = await fetch(`${base}/depreciation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'straight_line', costCents: 100, salvageValueCents: 200, usefulLifePeriods: 1 }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json() as { status: string }).status, 'error');
});
