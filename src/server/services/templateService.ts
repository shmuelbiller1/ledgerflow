import type { DocumentData, Firestore, Transaction } from '../db/firestore';
import { BUSINESS_TEMPLATES } from '../../lib/businessTemplates';

/**
 * Applies a chart-of-accounts template to a workspace on the server, in one database transaction.
 * Built-in templates (BUSINESS_TEMPLATES) also set the dashboard layout (analyticalTopology), a
 * field users may not write because it holds the categorisation cache the server trusts; an
 * AI-generated chart only adds accounts. A workspace with no transactions yet gets the template's
 * accounts in place of its current (non-system) ones; otherwise only missing accounts are added.
 */

export class TemplateError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Account fields a template may set (the rest of the chartAccounts document is the server's). */
const ACCOUNT_FIELDS = ['name', 'code', 'type', 'category', 'subtype', 'taxCategory', 'description', 'currency', 'isContra', 'role', 'classification'] as const;
const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'income', 'expense', 'cost_of_goods']);

export function sanitizeTemplateAccount(input: unknown): DocumentData | null {
  if (!input || typeof input !== 'object') return null;
  const src = input as Record<string, unknown>;
  const out: DocumentData = {};
  for (const field of ACCOUNT_FIELDS) {
    const value = src[field];
    if (typeof value === 'string' && value.trim()) out[field] = value.trim().slice(0, 200);
    else if (typeof value === 'boolean') out[field] = value;
  }
  if (!out.name || typeof out.type !== 'string' || !ACCOUNT_TYPES.has(out.type.toLowerCase())) return null;
  out.type = out.type.toLowerCase();
  return out;
}

export interface ApplyTemplateInput {
  workspaceId: string;
  uid: string;
  templateId?: string;
  accounts?: unknown[];
}

/** What a template write needs: the accounts to add and, for a built-in template, its layout. */
export interface PreparedTemplate {
  accounts: DocumentData[];
  templateId?: string;
  topology?: DocumentData;
}

/**
 * The checks and the reading a template write needs (read-only): the template exists, the accounts
 * are valid. Then `applyTemplateInTransaction` holds the write, so the command runner's transaction
 * also holds the audit line — a direct caller's own `db.runTransaction` awaits both steps.
 */
export function prepareAccountTemplate(input: { templateId?: string; accounts?: unknown[] }): PreparedTemplate {
  const template = input.templateId ? BUSINESS_TEMPLATES[input.templateId] : undefined;
  if (input.templateId && !template) throw new TemplateError(404, `Unknown template ${input.templateId}`);
  const source = template ? template.accounts : input.accounts;
  if (!Array.isArray(source) || source.length === 0) throw new TemplateError(400, 'Choose a template or send the accounts');
  if (source.length > 500) throw new TemplateError(400, 'Too many accounts');
  const accounts = source.map(sanitizeTemplateAccount).filter((a): a is DocumentData => a !== null);
  if (accounts.length === 0) throw new TemplateError(400, 'None of the accounts is valid (each needs a name and a type)');
  return { accounts, templateId: input.templateId, topology: template?.topology as DocumentData | undefined };
}

export async function applyTemplateInTransaction(db: Firestore, t: Transaction, input: ApplyTemplateInput, prepared: PreparedTemplate) {
  const workspaceRef = db.collection('workspaces').doc(input.workspaceId);
  if (!(await t.get(workspaceRef)).exists) throw new TemplateError(404, 'Workspace not found');
  const existing = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs;
  const hasTransactions = !(await t.get(db.collection('transactions').where('workspaceId', '==', input.workspaceId).limit(1))).empty;

  const replaced = hasTransactions ? [] : existing.filter(d => d.data().isSystem !== true);
  const kept = existing.filter(d => !replaced.includes(d)).map(d => d.data());
  const codes = new Set(kept.map(a => a.code).filter(Boolean));
  const names = new Set(kept.map(a => String(a.name || '').trim().toLowerCase()));
  const toCreate = prepared.accounts.filter(a => {
    const duplicate = (a.code && codes.has(a.code)) || names.has(String(a.name).trim().toLowerCase());
    if (!duplicate) {
      if (a.code) codes.add(a.code);
      names.add(String(a.name).trim().toLowerCase());
    }
    return !duplicate;
  });

  const now = new Date().toISOString();
  replaced.forEach(d => t.delete(d.ref));
  for (const account of toCreate) {
    const ref = db.collection('chartAccounts').doc();
    t.set(ref, { ...account, id: ref.id, uid: input.uid, workspaceId: input.workspaceId, balanceCents: 0, isArchived: false, createdAt: now });
  }
  t.update(workspaceRef, {
    businessType: prepared.templateId || 'ai_custom',
    ...(prepared.topology ? { analyticalTopology: prepared.topology } : {}),
    updatedAt: now,
  });
  return { created: toCreate.length, removed: replaced.length, kept: kept.length };
}

export async function applyAccountTemplate(db: Firestore, input: ApplyTemplateInput) {
  const prepared = prepareAccountTemplate(input);
  return db.runTransaction(t => applyTemplateInTransaction(db, t, input, prepared));
}
