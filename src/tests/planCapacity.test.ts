import type { Request } from 'express';
import type { CapturedResponse, TestResponseBody } from './helpers/mockTypes';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requirePlanCapacity, PLAN_LIMITS } from '../server/middleware/planCapacity';

function makeRes(): CapturedResponse {
  return {
    statusCode: 200,
    jsonBody: null as unknown as TestResponseBody,
    status(this: CapturedResponse, code: number) {
      this.statusCode = code;
      return this;
    },
    json(this: CapturedResponse, body: TestResponseBody) {
      this.jsonBody = body;
      return this;
    },
  } as unknown as CapturedResponse;
}

describe('Server Plan Capacity Middleware — Strategy 7 Value-Aligned Meters', () => {
  it('exports uncapped entries and value-aligned limits hierarchy', () => {
    assert.strictEqual(PLAN_LIMITS.free.transactions, null);
    assert.strictEqual(PLAN_LIMITS.growth.transactions, null);
    assert.strictEqual(PLAN_LIMITS.pro.transactions, null);
    assert.strictEqual(PLAN_LIMITS.enterprise.transactions, null);

    assert.deepEqual(
      [PLAN_LIMITS.free.entities, PLAN_LIMITS.growth.entities, PLAN_LIMITS.pro.entities, PLAN_LIMITS.enterprise.entities],
      [1, 1, 3, 50],
    );
    assert.deepEqual(
      [PLAN_LIMITS.free.firmClients, PLAN_LIMITS.growth.firmClients, PLAN_LIMITS.pro.firmClients, PLAN_LIMITS.enterprise.firmClients],
      [1, 5, 25, 250],
    );
    assert.deepEqual(
      [PLAN_LIMITS.free.rentalUnits, PLAN_LIMITS.growth.rentalUnits, PLAN_LIMITS.pro.rentalUnits, PLAN_LIMITS.enterprise.rentalUnits],
      [2, 15, 75, 1000],
    );
    assert.deepEqual(
      [PLAN_LIMITS.free.platformFeeBps, PLAN_LIMITS.growth.platformFeeBps, PLAN_LIMITS.pro.platformFeeBps, PLAN_LIMITS.enterprise.platformFeeBps],
      [50, 35, 20, 10],
    );
  });

  it('never penalizes or blocks standard workspaces on transaction count', async () => {
    const mockReq = { body: { workspaceId: 'ws-free-unlimited-tx' } } as unknown as Request;
    const mockRes = makeRes();
    let nextCalled = false;

    const fakeDb = {
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => ({
            exists: col === 'workspaces',
            data: () => ({ plan: 'free', workspaceId: id }),
          }),
        }),
      }),
    };

    await requirePlanCapacity('transactions', fakeDb)(mockReq, mockRes, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(mockRes.statusCode, 200);
  });

  it('enforces explicit admin apiQuotaMonthlyLimitCents using native count() without full scan', async () => {
    const mockReq = { body: { workspaceId: 'ws-api-quota-test' } } as unknown as Request;
    const mockRes = makeRes();
    let nextCalled = false;
    let countCalled = false;
    let fullScanCalled = false;

    const fakeDbWithCount = {
      collection: (col: string) => {
        if (col === 'workspaces') {
          return {
            doc: (id: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({ plan: 'free', workspaceId: id, apiQuotaMonthlyLimitCents: 10000 }),
              }),
            }),
          };
        }
        if (col === 'transactions') {
          return {
            where: () => ({
              count: () => {
                countCalled = true;
                return { get: async () => ({ data: () => ({ count: 100 }) }) };
              },
              get: async () => {
                fullScanCalled = true;
                return { size: 100 };
              },
            }),
          };
        }
        return {};
      },
    };

    await requirePlanCapacity('transactions', fakeDbWithCount)(mockReq, mockRes, () => {
      nextCalled = true;
    });
    assert.strictEqual(mockRes.statusCode, 402);
    assert.strictEqual(mockRes.jsonBody.code, 'PLAN_CAPACITY_EXCEEDED');
    assert.strictEqual(countCalled, true);
    assert.strictEqual(fullScanCalled, false);
    assert.strictEqual(nextCalled, false);
  });

  it('enforces entity, firmClient, rentalUnit, and seat limits with 402 and honors add-on slots', async () => {
    const entityRes = makeRes();
    let entityNext = false;
    await requirePlanCapacity('entities', {
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ plan: 'growth' }) }) }),
      }),
    })({ body: { workspaceId: 'ws-g', workspaceIds: ['ws-1', 'ws-2'] } } as unknown as Request, entityRes, () => {
      entityNext = true;
    });
    assert.strictEqual(entityRes.statusCode, 402);
    assert.strictEqual(entityRes.jsonBody.code, 'ENTITY_CAPACITY_EXCEEDED');
    assert.strictEqual(entityNext, false);

    // Extra entity add-on slot allows the 2nd entity on Growth
    const entityAddonRes = makeRes();
    let entityAddonNext = false;
    await requirePlanCapacity('entities', {
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ plan: 'growth', extraEntities: 1 }) }) }),
      }),
    })({ body: { workspaceId: 'ws-g', workspaceIds: ['ws-1', 'ws-2'] } } as unknown as Request, entityAddonRes, () => {
      entityAddonNext = true;
    });
    assert.strictEqual(entityAddonNext, true);

    const unitRes = makeRes();
    let unitNext = false;
    await requirePlanCapacity('rentalUnits', {
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ plan: 'free', rentalUnitCount: 2 }) }) }),
      }),
    })({ body: { workspaceId: 'ws-f' } } as unknown as Request, unitRes, () => {
      unitNext = true;
    });
    assert.strictEqual(unitRes.statusCode, 402);
    assert.strictEqual(unitRes.jsonBody.code, 'RENTAL_UNIT_CAPACITY_EXCEEDED');
    assert.strictEqual(unitNext, false);

    const clientRes = makeRes();
    let clientNext = false;
    await requirePlanCapacity('firmClients', {
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ plan: 'growth', firmClientCount: 5 }) }) }),
      }),
    })({ body: { workspaceId: 'ws-firm' } } as unknown as Request, clientRes, () => {
      clientNext = true;
    });
    assert.strictEqual(clientRes.statusCode, 402);
    assert.strictEqual(clientRes.jsonBody.code, 'FIRM_CLIENT_CAPACITY_EXCEEDED');
    assert.strictEqual(clientNext, false);

    const seatRes = makeRes();
    let seatNext = false;
    await requirePlanCapacity('seats', {
      collection: () => ({
        doc: () => ({ get: async () => ({ exists: true, data: () => ({ plan: 'free', members: ['user-1'] }) }) }),
      }),
    })({ params: { workspaceId: 'ws-seat-cap-test' } } as unknown as Request, seatRes, () => {
      seatNext = true;
    });
    assert.strictEqual(seatRes.statusCode, 402);
    assert.strictEqual(seatRes.jsonBody.code, 'SEAT_CAPACITY_EXCEEDED');
    assert.strictEqual(seatNext, false);
  });
});
