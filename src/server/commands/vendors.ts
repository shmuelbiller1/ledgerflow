import { z } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandDefinition } from './types';

const optionalVendorId = z.string().min(1).max(200).refine(id => !id.includes('/'), 'Vendor id cannot contain a slash').optional();
const requiredVendorId = z.string().min(1).max(200).refine(id => !id.includes('/'), 'Vendor id cannot contain a slash');
const vendorWorkspaceId = z.string().min(1).max(200).optional();

const VendorRecordSchema = z.object({
  id: optionalVendorId,
  workspaceId: vendorWorkspaceId,
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(100).optional(),
  website: z.string().max(500).optional(),
  taxId: z.string().max(100).optional(),
  taxNumber: z.string().max(100).optional(),
  paymentTerms: z.string().max(100).optional(),
  terms: z.string().max(100).optional(),
  billsExpected: z.boolean().optional(),
  type: z.string().max(100).optional(),
  status: z.string().trim().min(1).max(40).optional(),
  pipelineStage: z.string().max(100).optional(),
  is1099: z.boolean().optional(),
  isForeign: z.boolean().optional(),
  rating: z.number().finite().optional(),
  tags: z.array(z.string().max(100)).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  address: z.string().max(2000).optional(),
  currency: z.string().max(10).optional(),
  deliveryMethod: z.string().max(40).optional(),
  contacts: z.array(z.unknown()).max(500).optional(),
  noteLog: z.array(z.unknown()).max(500).optional(),
  notes: z.string().max(10000).optional(),
  importBatchId: z.string().max(200).optional(),
  bankDetails: z.object({
    accountName: z.string().max(200).optional(),
    accountNumber: z.string().max(200).optional(),
    routingCode: z.string().max(100).optional(),
  }).strict().optional(),
}).strict();

const VendorUpdateDataSchema = VendorRecordSchema
  .omit({ id: true, workspaceId: true, importBatchId: true })
  .partial();

export const vendorCreateInput = z.object({ vendor: VendorRecordSchema }).strict();
export const vendorUpdateInput = z.object({ id: requiredVendorId, data: VendorUpdateDataSchema }).strict();

type VendorCreateInput = z.output<typeof vendorCreateInput>;
type VendorUpdateInput = z.output<typeof vendorUpdateInput>;
type VendorResult = { vendor: Record<string, unknown> };

function assertVendorWorkspace(workspaceId: string, value: string | undefined): void {
  if (value && value !== workspaceId) throw new HttpError('Input workspaceId must match the command workspace', 400);
}

export const vendorCreateCommand: CommandDefinition<typeof vendorCreateInput, VendorResult> = {
  name: 'vendor.create',
  input: vendorCreateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: VendorCreateInput) {
    const vendor = input.vendor;
    assertVendorWorkspace(ctx.workspaceId, vendor.workspaceId);
    const id = vendor.id || ctx.db.collection('vendors').doc().id;
    const ref = ctx.db.collection('vendors').doc(id);
    if ((await tx.get(ref)).exists) throw Object.assign(new HttpError(`Vendor ${id} already exists`, 409), { code: 'DUPLICATE_RECORD' });
    const now = new Date().toISOString();
    const record = {
      ...vendor,
      id,
      uid: ctx.actor,
      workspaceId: ctx.workspaceId,
      category: vendor.category || 'Standard',
      balanceCents: 0,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(ref, record);
    return { vendor: record };
  },
  async preview(ctx, input) {
    assertVendorWorkspace(ctx.workspaceId, input.vendor.workspaceId);
    return { title: `Create vendor ${input.vendor.name}`, lines: [input.vendor.name, input.vendor.category || 'Standard'] };
  },
  audit(_input, result) {
    return {
      action: 'VENDOR_CREATED',
      entityType: 'vendors',
      entityId: String(result.vendor.id),
      description: `Created vendor "${String(result.vendor.name)}"`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Create a vendor contact for bills and payments; do not use this command to record a bill payment or change a vendor balance.',
    example: { vendor: { name: 'Paper Co', category: 'Office Supplies', currency: 'USD' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The vendor name or a supplied profile field is invalid.', next: 'Correct the vendor details and retry.' },
      { code: 'DUPLICATE_RECORD', when: 'The supplied vendor id is already used.', next: 'Choose a new id or load the existing vendor.' },
    ],
  },
};

export const vendorUpdateCommand: CommandDefinition<typeof vendorUpdateInput, VendorResult> = {
  name: 'vendor.update',
  input: vendorUpdateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, tx, input: VendorUpdateInput) {
    const ref = ctx.db.collection('vendors').doc(input.id);
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (!current || current.workspaceId !== ctx.workspaceId) throw Object.assign(new HttpError('Vendor not found in this workspace', 404), { code: 'NOT_FOUND' });
    const patch = { ...input.data, updatedAt: new Date().toISOString() };
    tx.update(ref, patch);
    return { vendor: { ...current, ...patch } };
  },
  async preview(ctx, input) {
    const vendor = (await ctx.db.collection('vendors').doc(input.id).get()).data();
    if (!vendor || vendor.workspaceId !== ctx.workspaceId) throw new HttpError('Vendor not found in this workspace', 404);
    return {
      title: `Update vendor ${String(input.data.name || vendor.name || input.id)}`,
      lines: Object.keys(input.data).length ? Object.keys(input.data).sort() : ['No profile fields changed'],
    };
  },
  audit(_input, result) {
    return {
      action: 'VENDOR_UPDATED',
      entityType: 'vendors',
      entityId: String(result.vendor.id),
      description: `Updated vendor "${String(result.vendor.name)}"`,
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Update a vendor profile without changing its server-managed balance or recording a bill payment.',
    example: { id: 'vendor_123', data: { email: 'ap@example.test', category: 'Office Supplies' } },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The vendor id or one of the supplied fields is invalid.', next: 'Correct the vendor details and retry.' },
      { code: 'NOT_FOUND', when: 'The vendor is not in the selected workspace.', next: 'Reload the workspace and choose an existing vendor.' },
    ],
  },
};
