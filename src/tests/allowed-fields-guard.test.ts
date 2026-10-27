/**
 * The database guard refuses a whole document when it has one field outside the table's allowed
 * list. That silently broke adding customers (status), applying templates (chartAccounts.role)
 * and saving the time zone. So: every field of the app's model for such a table must be allowed.
 * A field written only by the server must be allowed too, and unchangeable by users: the guard checks
 * every field of the document on each user save, so one server field outside the list refused every
 * later save of that document (27 Oct: the setup wizard could not save the business once the server
 * had written e.g. `modules` or `setupCompletedAt`).
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { migrationsSql, ruleArrays } from './helpers/migrations';
import { typesSource as readTypesSource } from './helpers/typesSource';

const typesSource = readTypesSource();

/** Top-level field names of `export interface Name { ... }` in src/types.ts (and src/model/). */
function interfaceFields(name: string): string[] {
  const start = typesSource.search(new RegExp(`export interface ${name}\\b[^{]*\\{`));
  assert.ok(start >= 0, `interface ${name} not found`);
  let i = typesSource.indexOf('{', start) + 1;
  let depth = 1;
  let line = '';
  const fields: string[] = [];
  for (; i < typesSource.length && depth > 0; i++) {
    const ch = typesSource[i];
    if (ch === '\n') {
      const m = depth === 1 ? line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/) : null;
      if (m) fields.push(m[1]);
      line = '';
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 1 || (depth === 2 && ch === '{')) line += ch;
  }
  return fields;
}

// table → [model, fields written only through the server]
const TABLES: Record<string, [string, string[]]> = {
  customers: ['Customer', ['portalToken', 'portalTokenAt']],
  chartAccounts: ['ChartAccount', []],
  projects: ['Project', []],
  supportTickets: ['SupportTicket', []],
  // credit notes and vendor credits are saved through POST /api/v1/transactions/bulk
  creditNotes: ['CreditNote', ['exchangeRate', 'tags', 'metadata', 'taxAmountCents', 'taxInclusive', 'taxVersion', 'taxTreatment', 'refundedCents', 'returnedGoods']],
  vendorCredits: ['VendorCredit', ['exchangeRate', 'tags', 'metadata', 'taxAmountCents', 'taxInclusive', 'taxVersion', 'taxTreatment', 'refundedCents', 'returnedGoods']],
  // numberingSeries lives in its own collection; the field on the model is a legacy read path.
  // expensePolicy (A-74) is read by the Expense Policy Check report; the client never saves it, so the
  // workspace's allowed-field list (and the migration that carries it) stays AI #1's to add.
  workspaces: ['Workspace', ['numberingSeries', 'retention', 'setupCompletedAt', 'openingBalanceDate', 'branding', 'scheduledReportsSent', 'closeSteps', 'ledgerHealth', 'alerts', 'alertsSent', 'payrollApproval', 'requireTwoStep', 'refuseNegativeStock', 'modules', 'goodsLeaveWith', 'allocationRules', 'priceLists', 'salesReps', 'twoPersonRule', 'roleDashboards', 'approvalDelegates', 'taxProfiles', 'brandingProfiles', 'expensePolicy', 'budgetControl']],
  notifications: ['AppNotification', []],
  purchaseOrders: ['PurchaseOrder', []],
};

// The server saves invoices and bills through zod schemas that drop unknown fields (L-114: the
// discount, "tax inclusive" and a bill's currency were silently lost). Every model field must be
// in the schema, except those only the server writes.
const SCHEMA_MODELS: Array<[string, () => Promise<Record<string, unknown>>, string[]]> = [
  ['Invoice', async () => (await import('../schemas')).InvoiceSchema.shape, ['writtenOffCents', 'writeOffTransactionId', 'writeOffReason', 'writtenOffAt', 'writeOffReversalTransactionId', 'revenueSchedule', 'createdAt', 'updatedAt', 'viewedAt', 'lastViewedAt', 'viewCount']],
  ['Bill', async () => (await import('../schemas')).BillSchema.shape, ['prepaidSchedule', 'createdAt', 'updatedAt']],
  ['CreditNote', async () => (await import('../schemas')).CreditNoteSchema.shape, ['createdAt', 'updatedAt', 'refundedCents']],
  ['VendorCredit', async () => (await import('../schemas')).VendorCreditSchema.shape, ['createdAt', 'updatedAt', 'refundedCents']],
];

describe('Server schemas keep every field the app saves', () => {
  for (const [model, shape, serverOnly] of SCHEMA_MODELS) {
    test(`${model}: no field is dropped on save`, async () => {
      const keys = Object.keys(await shape());
      const missing = interfaceFields(model).filter(f => !keys.includes(f) && !serverOnly.includes(f));
      assert.deepEqual(missing, [], `${model}Schema drops: ${missing.join(', ')}`);
    });
  }
});

describe('Allowed fields match the app model', () => {
  const sql = migrationsSql();
  for (const [table, [model, serverOnly]] of Object.entries(TABLES)) {
    test(`${table}: every ${model} field can be saved`, () => {
      const { allowed } = ruleArrays(table, sql);
      assert.ok(allowed.length > 0, `no allowed list found for ${table}`);
      const missing = interfaceFields(model).filter(f => !allowed.includes(f) && !serverOnly.includes(f));
      assert.deepEqual(missing, [], `${table} refuses these ${model} fields: ${missing.join(', ')}`);
    });
    if (serverOnly.length === 0) continue;
    test(`${table}: a field only the server writes does not block user saves, and users cannot change it`, () => {
      const { allowed, immutable } = ruleArrays(table, sql);
      const notAllowed = serverOnly.filter(f => !allowed.includes(f));
      assert.deepEqual(notAllowed, [], `${table}: once the server writes one of these, every user save is refused: ${notAllowed.join(', ')}`);
      const changeable = serverOnly.filter(f => !immutable.includes(f));
      assert.deepEqual(changeable, [], `${table}: users could change these server-only fields: ${changeable.join(', ')}`);
    });
  }
});
