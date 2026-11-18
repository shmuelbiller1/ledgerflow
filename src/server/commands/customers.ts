import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { Customer, EntityMetadata, InventoryItem, Invoice } from '../../types';
import {
  createWarrantyRecord,
  warrantyCandidates,
  warrantyEndDateProblem,
  warrantyRecordForCandidate,
  warrantyRecordsFromMetadata,
  RMAS_METADATA_FIELD,
  WARRANTIES_METADATA_FIELD,
  type WarrantyCandidate,
  type WarrantyRecord,
} from '../../lib/warehouseRecords';
import { normalizeSerial } from '../../lib/serialNumbers';
import { mergeMetadataPatch } from '../../lib/metadataPatch';
import type { CommandContext, CommandDefinition } from './types';

const optionalId = z.string().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash').optional();
const requiredId = z.string().min(1).max(200).refine(id => !id.includes('/'), 'Id cannot contain a slash');
const workspaceIdInput = z.string().min(1).max(200).optional();
const customerMetadataInput = z.record(z.string(), z.unknown())
  .refine(metadata => !Object.hasOwn(metadata, WARRANTIES_METADATA_FIELD) && !Object.hasOwn(metadata, RMAS_METADATA_FIELD),
    'Warranty and return-authorization history can only be changed through their dedicated workflows.')
  .optional();

const customerFields = {
  name: z.string().trim().min(1).max(200),
  email: z.string().max(320).optional(),
  phone: z.string().max(100).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  pipelineStage: z.enum(['lead', 'qualified', 'proposal', 'won', 'lost', 'delinquent', 'inactive']).optional(),
  customerSegment: z.enum(['high-value', 'repeat', 'service-tier', 'standard']).optional(),
  expectedRevenueCents: z.number().int().safe().optional(),
  probability: z.number().min(0).max(1).optional(),
  score: z.number().optional(),
  tags: z.array(z.string()).optional(),
  metadata: customerMetadataInput,
  notes: z.string().optional(),
  isForeign: z.boolean().optional(),
  address: z.string().optional(),
  currency: z.string().max(10).optional(),
  deliveryMethod: z.string().optional(),
  linkedVendorId: z.string().max(200).optional(),
  groupId: z.string().optional(),
  contacts: z.array(z.unknown()).optional(),
  noteLog: z.array(z.unknown()).optional(),
  noReminders: z.boolean().optional(),
  noStatements: z.boolean().optional(),
};

const CustomerRecordSchema = z.object({
  id: optionalId,
  workspaceId: workspaceIdInput,
  ...customerFields,
  importBatchId: z.string().optional(),
}).strict();
const CustomerUpdateDataSchema = z.object(customerFields).strict().partial();

export const customerCreateInput = z.object({ customer: CustomerRecordSchema }).strict();
export const customerUpdateInput = z.object({ id: requiredId, data: CustomerUpdateDataSchema }).strict();

type CustomerCreateInput = z.output<typeof customerCreateInput>;
type CustomerUpdateInput = z.output<typeof customerUpdateInput>;
type CustomerResult = { customer: Record<string, unknown> };

function assertCustomerWorkspace(workspaceId: string, value: string | undefined): void {
  if (value && value !== workspaceId) throw new HttpError('Input workspaceId must match the command workspace', 400);
}

async function assertLinkedVendorAvailable(
  ctx: CommandContext,
  tx: import('../db/firestore').Transaction,
  linkedVendorId: string | undefined,
  exceptCustomerId?: string,
): Promise<void> {
  const normalizedVendorId = String(linkedVendorId || '').trim();
  if (!normalizedVendorId) return;
  if (normalizedVendorId.includes('/')) throw new HttpError('Vendor id cannot contain a slash.', 400);
  const vendorRef = ctx.db.collection('vendors').doc(normalizedVendorId);
  const vendor = await tx.get(vendorRef);
  const vendorData = vendor.data();
  if (!vendor.exists || vendorData?.workspaceId !== ctx.workspaceId) {
    throw new HttpError('Choose a vendor in this workspace.', 400);
  }
  const linked = await tx.get(ctx.db.collection('customers')
    .where('workspaceId', '==', ctx.workspaceId)
    .where('linkedVendorId', '==', normalizedVendorId));
  const duplicate = linked.docs.find(doc => doc.id !== exceptCustomerId);
  if (duplicate) throw Object.assign(new HttpError('This vendor is already linked to another customer.', 409), { code: 'CONFLICT' });
}

async function assertNameAvailable(
  ctx: CommandContext,
  tx: import('../db/firestore').Transaction,
  collectionName: 'customers' | 'vendors',
  name: string,
  exceptId?: string,
): Promise<void> {
  const matches = await tx.get(ctx.db.collection(collectionName).where('workspaceId', '==', ctx.workspaceId).where('name', '==', name));
  if (matches.docs.some(doc => doc.id !== exceptId && String(doc.data()?.name || '').trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) {
    throw Object.assign(new HttpError(`A ${collectionName === 'customers' ? 'customer' : 'vendor'} with this name already exists in this workspace.`, 409), { code: 'CONFLICT' });
  }
}

export const customerCreateCommand: CommandDefinition<typeof customerCreateInput, CustomerResult> = {
  name: 'customer.create',
  input: customerCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: CustomerCreateInput) {
    const customer = input.customer;
    assertCustomerWorkspace(ctx.workspaceId, customer.workspaceId);
    const id = customer.id || ctx.db.collection('customers').doc().id;
    const ref = ctx.db.collection('customers').doc(id);
    if ((await tx.get(ref)).exists) throw Object.assign(new HttpError(`Customer ${id} already exists`, 409), { code: 'DUPLICATE_RECORD' });
    await assertLinkedVendorAvailable(ctx, tx, customer.linkedVendorId, id);
    await assertNameAvailable(ctx, tx, 'customers', customer.name);
    const now = new Date().toISOString();
    const { importBatchId: _importBatchId, ...profile } = customer;
    const record = {
      ...profile,
      id,
      uid: ctx.actor,
      workspaceId: ctx.workspaceId,
      balanceCents: 0,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(ref, record);
    return { customer: record };
  },
  async preview(ctx, input) {
    assertCustomerWorkspace(ctx.workspaceId, input.customer.workspaceId);
    return { title: `Create customer ${input.customer.name}`, lines: [input.customer.name, input.customer.email || 'No email'] };
  },
  audit(_input, result) {
    return { action: 'CUSTOMER_CREATED', entityType: 'customers', entityId: String(result.customer.id), description: `Created customer "${String(result.customer.name)}"` };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Create a customer profile for sales documents; do not use this command to change a balance or record a payment.',
    next: [{ command: 'invoice.create', label: 'New invoice' }],
    example: { customer: { name: 'Acme Design', email: 'billing@example.test', status: 'active' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The customer profile contains invalid fields or a different workspace id.', next: 'Correct the customer details and retry.' },
      { code: 'DUPLICATE_RECORD', when: 'The supplied customer id already exists.', next: 'Choose a new id or load the existing customer.' },
      { code: 'CONFLICT', when: 'The customer name or linked vendor is already in use.', next: 'Choose a unique name or unlink the other customer first.' },
    ],
  },
};

export const customerUpdateCommand: CommandDefinition<typeof customerUpdateInput, CustomerResult> = {
  name: 'customer.update',
  input: customerUpdateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: CustomerUpdateInput) {
    const ref = ctx.db.collection('customers').doc(input.id);
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (!snapshot.exists || current?.workspaceId !== ctx.workspaceId) throw Object.assign(new HttpError('Customer not found in this workspace', 404), { code: 'NOT_FOUND' });
    if (input.data.linkedVendorId !== undefined) await assertLinkedVendorAvailable(ctx, tx, input.data.linkedVendorId, input.id);
    if (input.data.name) await assertNameAvailable(ctx, tx, 'customers', input.data.name, input.id);
    const patch = {
      ...input.data,
      ...(input.data.metadata !== undefined
        ? { metadata: mergeCustomerMetadata(current?.metadata, input.data.metadata) }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    tx.update(ref, patch);
    return { customer: { ...current, ...patch } };
  },
  async preview(ctx, input) {
    const customer = (await ctx.db.collection('customers').doc(input.id).get()).data();
    if (!customer || customer.workspaceId !== ctx.workspaceId) throw new HttpError('Customer not found in this workspace', 404);
    return {
      title: `Update customer ${String(input.data.name || customer.name || input.id)}`,
      lines: Object.keys(input.data).length ? Object.keys(input.data).sort((a, b) => a.localeCompare(b, 'en')) : ['No profile fields changed'],
    };
  },
  audit(_input, result) {
    return { action: 'CUSTOMER_UPDATED', entityType: 'customers', entityId: String(result.customer.id), description: `Updated customer "${String(result.customer.name)}"` };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Update a customer profile without changing its server-managed identity or balance; metadata keys merge, and send null to remove one. Do not use this command to record a payment.',
    next: [{ command: 'invoice.create', label: 'New invoice' }],
    example: { id: 'customer_123', data: { email: 'billing@example.test', linkedVendorId: 'vendor_123', metadata: { creditLimitCents: 500000 } } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The customer id or one of the supplied profile fields is invalid.', next: 'Correct the customer details and retry.' },
      { code: 'NOT_FOUND', when: 'The customer is not in the selected workspace.', next: 'Reload the workspace and choose an existing customer.' },
      { code: 'CONFLICT', when: 'The linked vendor is already assigned to another customer.', next: 'Unlink the other customer or choose a different vendor.' },
    ],
  },
};

const warrantyIdentitySchema = z.object({
  id: z.string().min(1).max(1000),
  workspaceId: requiredId,
  customerId: requiredId,
  invoiceId: requiredId,
  invoiceLineId: requiredId,
  itemId: requiredId,
  serial: z.string().min(1).max(80),
}).strict();
export const warrantyUpdateInput = z.object({ candidate: warrantyIdentitySchema, endDate: z.string().max(100) }).strict();

type WarrantyUpdateInput = z.output<typeof warrantyUpdateInput>;
type WarrantyUpdateResult = { id: string; changed: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Apply a metadata patch without allowing server-managed histories to be edited here. */
function mergeCustomerMetadata(currentValue: unknown, updates: Record<string, unknown>): Record<string, unknown> {
  return mergeMetadataPatch(currentValue, updates, [WARRANTIES_METADATA_FIELD, RMAS_METADATA_FIELD]);
}

function customerMetadata(value: unknown): EntityMetadata {
  return isRecord(value) ? value as EntityMetadata : {};
}

function savedWarrantyRecords(customer: Record<string, unknown>, customerId: string, workspaceId: string): WarrantyRecord[] {
  return warrantyRecordsFromMetadata(customerMetadata(customer.metadata), customerId, workspaceId);
}

type WarrantyReadContext = Omit<CommandContext, 'prepared' | 'afterCommit'>;

async function resolveWarrantyCandidate(
  ctx: WarrantyReadContext,
  tx: import('../db/firestore').Transaction,
  selected: WarrantyUpdateInput['candidate'],
): Promise<{ customer: Record<string, unknown>; candidate: WarrantyCandidate }> {
  if (selected.workspaceId !== ctx.workspaceId) throw new HttpError('Choose a warranty record in this workspace.', 400);
  const customerRef = ctx.db.collection('customers').doc(selected.customerId);
  const invoiceRef = ctx.db.collection('invoices').doc(selected.invoiceId);
  const itemRef = ctx.db.collection('inventory').doc(selected.itemId);
  const [customerSnapshot, invoiceSnapshot, itemSnapshot] = await Promise.all([
    tx.get(customerRef), tx.get(invoiceRef), tx.get(itemRef),
  ]);
  const customerData = customerSnapshot.data();
  const invoiceData = invoiceSnapshot.data();
  const itemData = itemSnapshot.data();
  if (!customerSnapshot.exists || customerData?.workspaceId !== ctx.workspaceId || !invoiceSnapshot.exists || invoiceData?.workspaceId !== ctx.workspaceId) {
    throw new HttpError('The selected warranty candidate is no longer available.', 409);
  }
  if (itemSnapshot.exists && itemData?.workspaceId !== ctx.workspaceId) throw new HttpError('The selected inventory item is not in this workspace.', 400);
  const customer = { ...customerData, id: selected.customerId, workspaceId: ctx.workspaceId } as Customer;
  const invoice = { ...invoiceData, id: selected.invoiceId, workspaceId: ctx.workspaceId } as unknown as Invoice;
  const items: InventoryItem[] = itemSnapshot.exists && itemData
    ? [{ ...itemData, id: selected.itemId, workspaceId: ctx.workspaceId } as InventoryItem]
    : [];
  const candidate = warrantyCandidates([invoice], [customer], items, ctx.workspaceId).find(row =>
    row.id === selected.id && row.customerId === selected.customerId && row.invoiceId === selected.invoiceId &&
    row.invoiceLineId === selected.invoiceLineId && row.itemId === selected.itemId && row.serial === normalizeSerial(selected.serial),
  );
  if (!candidate) throw new HttpError('The selected warranty candidate is no longer available.', 409);
  return { customer: customerData, candidate };
}

const warrantyExample = {
  candidate: {
    id: 'w_example', workspaceId: 'workspace_123', customerId: 'customer_123', invoiceId: 'invoice_123',
    invoiceLineId: 'line_1', itemId: 'item_1', serial: 'SN-100',
  },
  endDate: '2028-01-15',
};

export const warrantyUpdateCommand: CommandDefinition<typeof warrantyUpdateInput, WarrantyUpdateResult> = {
  name: 'warranty.update',
  input: warrantyUpdateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: WarrantyUpdateInput) {
    const { customer, candidate } = await resolveWarrantyCandidate(ctx, tx, input.candidate);
    const existing = warrantyRecordForCandidate(savedWarrantyRecords(customer, candidate.customerId, ctx.workspaceId), candidate);
    const record = createWarrantyRecord({
      candidate,
      endDate: input.endDate,
      actor: { uid: ctx.actor, name: ctx.user.displayName || ctx.user.email || 'Workspace user', role: ctx.role },
      at: new Date().toISOString(),
      existing,
    });
    const changed = record !== existing;
    if (changed) {
      const metadata = customerMetadata(customer.metadata);
      const warrantyMap = isRecord(metadata[WARRANTIES_METADATA_FIELD]) ? metadata[WARRANTIES_METADATA_FIELD] as Record<string, unknown> : {};
      const customerRef = ctx.db.collection('customers').doc(candidate.customerId);
      tx.update(customerRef, {
        metadata: { ...metadata, [WARRANTIES_METADATA_FIELD]: { ...warrantyMap, [record.id]: record } },
        updatedAt: new Date().toISOString(),
      });
    }
    return { id: record.id, changed };
  },
  async preview(ctx, input) {
    const problem = warrantyEndDateProblem(input.endDate);
    if (problem) throw new HttpError(problem, 400);
    await ctx.db.runTransaction(async tx => { await resolveWarrantyCandidate(ctx, tx, input.candidate); });
    return { title: `Set warranty end date for ${input.candidate.serial}`, lines: [input.endDate] };
  },
  audit(input, result) {
    return {
      action: result.changed ? 'WARRANTY_DATE_UPDATED' : 'WARRANTY_DATE_UNCHANGED',
      entityType: 'customers',
      entityId: input.candidate.customerId,
      description: `${result.changed ? 'Updated' : 'Kept'} warranty end date for serial ${input.candidate.serial}`,
      details: { warrantyId: result.id, endDate: input.endDate },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Set the warranty end date for a serial on an issued invoice and preserve who changed it; do not use this command to change inventory, invoices, or posted amounts.',
    example: warrantyExample,
    refusals: [
      { code: 'INVALID_INPUT', when: 'The selected serial or warranty end date is invalid.', next: 'Choose an issued invoice serial and enter a real calendar date.' },
      { code: 'CONFLICT', when: 'The customer, invoice line, or serial changed before the update.', next: 'Reload the warranty register and select the current serial row.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant, or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
    ],
  },
};
