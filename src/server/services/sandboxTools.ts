import { todayIn } from './assistantFacts';
import { z } from 'zod';
import { evaluateAmountExpression } from '../../lib/amountExpression';
import { answerCents, readQuestion, type AskReading } from '../../lib/askBooks';
import type { ChartAccount, DimensionDefinition, DimensionNode } from '../../types';
import { FieldPath, type Firestore, type Query } from '../db/firestore';
import { parseFields, pickFields } from '../http/sparseFields';
import { CommandRefusal } from '../utils/commandExecutor';

/**
 * The assistant's read tools (CMD-1 "Tools for the assistant", built here on the sandbox handle as
 * SBX-1 says). Each is a thin wrapper over the existing data layer: the handle it is given is the
 * sandbox-scoped `getDb({ sandboxId })`, so every list, record and figure already includes the
 * draft steps and the person's live books underneath them. Nothing here calculates money: figures
 * come from the report routes (`run_report`, `explain_number`, `ask_books` delegate to them) and
 * `calculate` is the same rational-arithmetic evaluator the amount fields use.
 *
 * Reads are allow-listed twice: by collection (the reviewed book collections a person sees in the
 * app) and by field (credentials, links that grant access and hashes never leave the server). Text
 * inside a record is returned as data; nothing in it is executed or turned into a step.
 */
export const READ_COLLECTIONS = [
  'bills', 'budgets', 'chartAccounts', 'creditNotes', 'customers', 'dimensionNodes', 'documents', 'employees', 'estimates',
  'fixedAssets', 'inventory', 'invoices', 'journalEntries', 'loans', 'numberingSeries', 'paymentAllocations', 'payments',
  'periods', 'projects', 'purchaseOrders', 'reconciliations', 'recurring', 'stockMoves', 'taxRates', 'transactions',
  'vendorCredits', 'vendors',
] as const;
export type ReadCollection = (typeof READ_COLLECTIONS)[number];

/** Keys never returned by a read tool, at any depth. */
const HIDDEN_KEY = /(secret|token|hash|password|passcode|otp|apikey|signature|paymentlink|portallink|portalurl|signlink|accesscode)/i;

/** The text fields `search_records` matches, in the order they are shown. */
const SEARCH_FIELDS = ['name', 'number', 'invoiceNumber', 'billNumber', 'reference', 'description', 'memo', 'notes', 'email', 'title', 'customerName', 'vendorName', 'entityName', 'payee', 'sku', 'code'];

const MAX_LIMIT = 100;
const SEARCH_SCAN = 500;

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (HIDDEN_KEY.test(key)) continue;
      out[key] = redact(inner);
    }
    return out as T;
  }
  return value;
}

const collectionSchema = z.enum(READ_COLLECTIONS);
const fieldName = z.string().trim().min(1).max(120).regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/, 'Not a field name')
  .refine(f => !HIDDEN_KEY.test(f), 'That field is not readable');
const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
const whereSchema = z.object({
  field: fieldName,
  op: z.enum(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains']),
  value: z.union([scalar, z.array(scalar).max(30)]),
}).strict();

export const listRecordsInput = z.object({
  collection: collectionSchema,
  where: z.array(whereSchema).max(10).optional(),
  orderBy: z.object({ field: fieldName, direction: z.enum(['asc', 'desc']).default('asc') }).strict().optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(25),
  /** the `nextCursor` of the previous page */
  cursor: z.string().max(2000).optional(),
  fields: z.array(fieldName).max(50).optional(),
  count: z.boolean().default(false),
}).strict();

export const getRecordInput = z.object({ collection: collectionSchema, id: z.string().trim().min(1).max(400) }).strict();

export const searchRecordsInput = z.object({
  text: z.string().trim().min(1).max(200),
  collections: z.array(collectionSchema).min(1).max(READ_COLLECTIONS.length).default(['customers', 'vendors', 'invoices', 'bills', 'payments', 'transactions', 'chartAccounts', 'inventory', 'projects', 'documents']),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(20),
}).strict();

export const calculateInput = z.object({
  /** +, -, *, / and parentheses over decimal amounts, e.g. "(1250.50 + 99) * 0.17" */
  expression: z.string().trim().min(1).max(500).optional(),
  /** several calculations in one call, e.g. ["4600 - 4200", "600 - 300"]; answered in the same order */
  expressions: z.array(z.string().trim().min(1).max(500)).min(1).max(20).optional(),
}).strict().refine(v => (v.expression === undefined) !== (v.expressions === undefined), 'Give expression or expressions, not both');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const askBooksInput = z.object({
  question: z.string().trim().min(1).max(500),
  /** the day "this year" and "last month" are counted from; defaults to today in the workspace time zone. Not offered to the model. */
  today: day.optional(),
}).strict();

export const explainNumberInput = z.object({
  accountIds: z.array(z.string().min(1).max(200)).min(1).max(5000),
  startDate: day.optional(),
  endDate: day.optional(),
  labelDimension: z.string().max(100).optional(),
  labelValue: z.string().max(200).optional(),
}).strict();

export const runReportInput = z.object({
  /** the report's address under /api/v1/reports (e.g. `profit-and-loss`, `aging`, `trial-balance`) or /api/v1/balances */
  report: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?$/, 'Name the report by its address'),
  source: z.enum(['reports', 'balances']).default('reports'),
  /** its query parameters (period, basis, label filters); `workspaceId` is supplied */
  params: z.record(z.string().max(80), z.union([z.string().max(2000), z.number(), z.boolean()])).default({}),
}).strict();

function refuse(message: string, status = 400, code = 'INVALID_INPUT', details?: unknown): never {
  throw new CommandRefusal(message, status, code, details);
}

function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): unknown[] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return refuse('The cursor is not one this tool issued', 400, 'INVALID_CURSOR');
}

function fieldValue(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined), record);
}

export async function listRecords(db: Firestore, workspaceId: string, raw: unknown) {
  const input = listRecordsInput.parse(raw);
  let query: Query = db.collection(input.collection).where('workspaceId', '==', workspaceId);
  for (const filter of input.where ?? []) {
    if (filter.field === 'workspaceId') continue;
    query = query.where(filter.field, filter.op, filter.value);
  }
  const orderField = input.orderBy?.field ?? 'id';
  const direction = input.orderBy?.direction ?? 'asc';
  if (orderField !== 'id') query = query.orderBy(orderField, direction);
  query = query.orderBy(FieldPath.documentId(), direction);
  if (input.cursor) query = query.startAfter(...decodeCursor(input.cursor));
  const total = input.count ? (await query.count().get()).data().count : undefined;
  const snap = await query.limit(input.limit + 1).get();
  const rows = snap.docs.slice(0, input.limit).map(doc => ({ ...doc.data(), id: doc.id }) as Record<string, unknown>);
  const last = rows.at(-1);
  const nextCursor = snap.docs.length > input.limit && last
    ? encodeCursor(orderField === 'id' ? [last.id] : [fieldValue(last, orderField) ?? null, last.id]) : null;
  const fields = parseFields(input.fields?.join(','));
  return { collection: input.collection, records: pickFields(redact(rows), fields), nextCursor, ...(total !== undefined ? { total } : {}) };
}

export async function getRecord(db: Firestore, workspaceId: string, raw: unknown) {
  const input = getRecordInput.parse(raw);
  if (input.id.includes('/')) refuse('An id cannot contain a slash');
  const doc = await db.collection(input.collection).doc(input.id).get();
  const data = doc.data();
  if (!doc.exists || data?.workspaceId !== workspaceId) refuse('No such record in these books', 404, 'NOT_FOUND');
  return { collection: input.collection, record: redact({ ...data, id: doc.id }) };
}

const norm = (s: unknown) => (typeof s === 'string' ? s.normalize('NFC').toLocaleLowerCase() : typeof s === 'number' ? String(s) : '');

export async function searchRecords(db: Firestore, workspaceId: string, raw: unknown) {
  const input = searchRecordsInput.parse(raw);
  const needle = norm(input.text);
  const matches: Array<{ collection: string; id: string; matched: string; record: Record<string, unknown> }> = [];
  for (const collection of input.collections) {
    if (matches.length >= input.limit) break;
    const snap = await db.collection(collection).where('workspaceId', '==', workspaceId).limit(SEARCH_SCAN).get();
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const field = SEARCH_FIELDS.find(name => norm(data[name]).includes(needle)) ?? (doc.id.toLowerCase().includes(needle) ? 'id' : undefined);
      if (!field) continue;
      matches.push({ collection, id: doc.id, matched: field, record: redact({ ...data, id: doc.id }) });
      if (matches.length >= input.limit) break;
    }
  }
  return { text: input.text, matches, scannedPerCollection: SEARCH_SCAN };
}

function calculateOne(expression: string) {
  let cents: number;
  try { cents = evaluateAmountExpression(expression); }
  catch (err) { refuse(err instanceof Error ? err.message : 'That expression could not be calculated', 400, 'INVALID_EXPRESSION'); }
  return { expression, cents, amount: cents / 100 };
}

export function calculate(raw: unknown) {
  const input = calculateInput.parse(raw);
  // each sum stands alone: a bad one is reported on its own entry, the others still answer
  if (input.expressions) return { results: input.expressions.map(expression => {
    try { return calculateOne(expression); }
    catch (err) { return { expression, error: err instanceof Error ? err.message : 'That expression could not be calculated' }; }
  }) };
  return calculateOne(input.expression!);
}

/** What `ask_books` understood; the figure itself comes from the explain report on the same handle. */
export async function readBooksQuestion(db: Firestore, workspaceId: string, workspace: Record<string, unknown>, raw: unknown): Promise<{ question: string; reading: AskReading; today: string }> {
  const input = askBooksInput.parse(raw);
  const today = input.today ?? todayIn(typeof workspace.timezone === 'string' ? workspace.timezone : null);
  const [accounts, nodes] = await Promise.all([
    db.collection('chartAccounts').where('workspaceId', '==', workspaceId).get(),
    db.collection('dimensionNodes').where('workspaceId', '==', workspaceId).get(),
  ]);
  const reading = readQuestion(input.question, {
    accounts: accounts.docs.map(doc => ({ ...doc.data(), id: doc.id }) as ChartAccount),
    dimensions: Array.isArray(workspace.dimensions) ? workspace.dimensions as DimensionDefinition[] : [],
    nodes: nodes.docs.map(doc => ({ ...doc.data(), id: doc.id }) as DimensionNode),
    today,
    ...(typeof workspace.fiscalYearStartMonth === 'number' ? { fiscalYearStartMonth: workspace.fiscalYearStartMonth } : {}),
  });
  return { question: input.question, reading, today };
}

export { answerCents };
