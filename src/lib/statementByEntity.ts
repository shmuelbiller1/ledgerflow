/**
 * A-72: a customer's or vendor's statement scoped to one entity label (the workspace's World /
 * Entity dimension — "World A", "Entity B", …).
 *
 * What this module does and does not do:
 *   - It picks the documents that carry the chosen entity label and hands them to the same
 *     `computeStatement` the whole-account statement uses, so opening balance, rows and running
 *     balance come from one implementation. No amount is recalculated here.
 *   - A posted payment counts only for the part it was allocated to a document of this entity.
 *     The rest of that payment — applied to another entity's documents, or applied to nothing yet —
 *     is left out, and the screen states both amounts. Draft and void payments are not money the
 *     whole-account statement counts either, so they are neither included nor reported as missing.
 *   - A credit note has no labels of its own; it belongs to the entity of the invoice or bill it
 *     credits, which the caller names through `creditSourceId`. A credit with no source document
 *     and no label belongs with the unlabelled documents, exactly as an unlabelled invoice does.
 *   - A document whose lines carry two or more different entity labels belongs to no single
 *     entity. Splitting it would mean recalculating its amount here, which this module must not
 *     do, so it is kept out of every by-entity statement and the screen says how many there are.
 *   - The server statement JSON and PDF still cover the whole account (AI #1's `loadStatement` has
 *     no entity argument), so the screen refuses those two buttons while an entity is chosen
 *     rather than showing a page that disagrees with the one beside it.
 */

/** The one value that means "documents with no entity label at all". */
export const UNLABELLED_ENTITY = '(no entity label)';

/** Documents are read structurally: an invoice keeps labels on its items, a bill on its splits. */
type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function propertyOf(doc: unknown, key: string): unknown {
  const record = asRecord(doc);
  return record ? record[key] : undefined;
}

/** A `dimensionId → value` map with only string values, or null. */
function dimensionsOf(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string') out[key] = raw;
  }
  return out;
}

/** Every child row that can carry labels: invoice items, bill splits, transaction lines. */
function childRows(doc: unknown): unknown[] {
  const rows: unknown[] = [];
  for (const key of ['lines', 'items', 'splits']) {
    const list = propertyOf(doc, key);
    if (Array.isArray(list)) rows.push(...list);
  }
  return rows;
}

function labelFromDimensions(dims: Record<string, string> | null, key: string): string {
  if (!dims) return '';
  const found = Object.keys(dims).find(k => k.normalize('NFC').toLowerCase().trim() === key);
  const value = found ? dims[found] : '';
  return typeof value === 'string' && value.trim() && value.trim() !== 'Unassigned' ? value.trim() : '';
}

/**
 * Every distinct entity label written on one document (its own `dimensions` and each line's), in
 * the order they appear. Empty when it carries none; more than one when its lines are split
 * between entities.
 */
export function entityLabelsOf(doc: unknown, entityDimensionId = 'world'): string[] {
  if (!doc) return [];
  const key = (entityDimensionId || 'world').normalize('NFC').toLowerCase().trim();
  const labels: string[] = [];
  const add = (value: string) => {
    if (value && !labels.includes(value)) labels.push(value);
  };
  add(labelFromDimensions(dimensionsOf(propertyOf(doc, 'dimensions')), key));
  for (const row of childRows(doc)) {
    add(labelFromDimensions(dimensionsOf(propertyOf(row, 'dimensions')), key));
  }
  return labels;
}

/** The label written on one document for the entity dimension, or '' when it carries none. */
export function entityLabelOf(doc: unknown, entityDimensionId = 'world'): string {
  return entityLabelsOf(doc, entityDimensionId)[0] ?? '';
}

/** True when the document's lines name two or more different entities. */
export function hasMixedEntityLabels(doc: unknown, entityDimensionId = 'world'): boolean {
  return entityLabelsOf(doc, entityDimensionId).length > 1;
}

/**
 * True when the document belongs to the chosen entity; an empty choice means the whole account.
 * A document split between entities belongs to none of them (and not to the unlabelled group).
 */
export function matchesEntity(doc: unknown, entity: string, entityDimensionId = 'world'): boolean {
  if (!entity) return true;
  const labels = entityLabelsOf(doc, entityDimensionId);
  if (labels.length > 1) return false;
  return entity === UNLABELLED_ENTITY ? labels.length === 0 : labels[0] === entity;
}

/** Every entity label the contact's documents use (all labels of a split document), alphabetically. */
export function entityOptions(documents: unknown[], entityDimensionId = 'world'): string[] {
  const values = new Set<string>();
  for (const doc of documents) {
    for (const label of entityLabelsOf(doc, entityDimensionId)) values.add(label);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

/** The same rule `computeStatement` applies: only a posted payment is money on the statement. */
export function isPostedPayment(payment: unknown): boolean {
  return propertyOf(payment, 'status') === 'posted';
}

/** A payment, read structurally: the amount and the documents it was applied to. */
export interface PaymentAllocationLike {
  documentId: string;
  documentType: 'invoice' | 'bill';
  amountCents: number;
}

export interface ScopedStatementDocuments<I, B, P, C> {
  invoices: I[];
  bills: B[];
  payments: P[];
  credits: C[];
  /** posted payments with money that is not in this statement (wholly or in part) */
  paymentsWithoutScope: number;
  /** all of that money (absolute cents) = allocatedElsewhereCents + unappliedCents */
  paymentsWithoutScopeCents: number;
  /** the part of it applied to documents outside this entity (another entity, or a split document) */
  allocatedElsewhereCents: number;
  /** the part of it applied to no document at all — money with no entity yet */
  unappliedCents: number;
  /** documents whose lines name more than one entity; they are in no by-entity statement */
  mixedLabelDocuments: number;
  /** true when the statement is the whole account and nothing was left out */
  wholeAccount: boolean;
}

function idOf(doc: unknown): string {
  const id = propertyOf(doc, 'id');
  return typeof id === 'string' ? id : '';
}

function allocationsOf(payment: unknown): PaymentAllocationLike[] {
  const list = propertyOf(payment, 'allocations');
  if (!Array.isArray(list)) return [];
  const out: PaymentAllocationLike[] = [];
  for (const raw of list) {
    const record = asRecord(raw);
    if (!record) continue;
    const documentId = record.documentId;
    const amountCents = record.amountCents;
    const documentType = record.documentType;
    if (typeof documentId === 'string' && typeof amountCents === 'number' && Number.isFinite(amountCents)) {
      out.push({
        documentId,
        amountCents,
        documentType: documentType === 'bill' ? 'bill' : 'invoice',
      });
    }
  }
  return out;
}

/**
 * The documents a by-entity statement is built from. `entity` is an entity label,
 * `UNLABELLED_ENTITY` for documents with none, or '' for the whole account (the same lists,
 * untouched).
 *
 * A payment is copied, never changed: its `amountCents` becomes the part allocated to this entity's
 * documents and `allocations` keeps only those, so the same `computeStatement` reads it correctly
 * and the stored record is untouched.
 */
export function scopeStatementDocuments<I, B, P, C>(
  documents: { invoices: I[]; bills: B[]; payments: P[]; credits: C[] },
  entity: string,
  entityDimensionId = 'world',
  options: { creditSourceId?: (credit: C) => string | undefined } = {},
): ScopedStatementDocuments<I, B, P, C> {
  const { invoices, bills, payments, credits } = documents;
  if (!entity) {
    return {
      invoices, bills, payments, credits,
      paymentsWithoutScope: 0, paymentsWithoutScopeCents: 0, allocatedElsewhereCents: 0, unappliedCents: 0,
      mixedLabelDocuments: 0, wholeAccount: true,
    };
  }

  const scopedInvoices = invoices.filter(doc => matchesEntity(doc, entity, entityDimensionId));
  const scopedBills = bills.filter(doc => matchesEntity(doc, entity, entityDimensionId));
  let mixedLabelDocuments = 0;
  for (const doc of [...invoices, ...bills, ...credits]) {
    if (hasMixedEntityLabels(doc, entityDimensionId)) mixedLabelDocuments += 1;
  }

  const documentIds = new Set<string>();
  for (const doc of [...scopedInvoices, ...scopedBills]) {
    const id = idOf(doc);
    if (id) documentIds.add(id);
  }

  // A credit note usually carries no labels of its own: it belongs to the entity of the document it
  // credits. One that credits no document and carries no label is an unlabelled document itself.
  const scopedCredits = credits.filter(credit => {
    if (entityLabelsOf(credit, entityDimensionId).length > 0) return matchesEntity(credit, entity, entityDimensionId);
    const source = options.creditSourceId?.(credit);
    if (source) return documentIds.has(source);
    return entity === UNLABELLED_ENTITY;
  });
  for (const credit of scopedCredits) {
    const id = idOf(credit);
    if (id) documentIds.add(id);
  }

  const scopedPayments: P[] = [];
  let paymentsWithoutScope = 0;
  let allocatedElsewhereCents = 0;
  let unappliedCents = 0;
  for (const payment of payments) {
    const all = allocationsOf(payment);
    const inScope = all.filter(a => documentIds.has(a.documentId));
    const posted = isPostedPayment(payment);
    if (posted) {
      // Only a posted payment is money on the statement, so only its missing part is reported.
      const amountRaw = propertyOf(payment, 'amountCents');
      const amount = Math.abs(typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : 0);
      const applied = all.reduce((sum, a) => sum + Math.abs(a.amountCents), 0);
      const inScopeCents = inScope.reduce((sum, a) => sum + Math.abs(a.amountCents), 0);
      const elsewhere = applied - inScopeCents;
      const unapplied = Math.max(0, amount - applied);
      if (elsewhere > 0 || unapplied > 0) {
        paymentsWithoutScope += 1;
        allocatedElsewhereCents += elsewhere;
        unappliedCents += unapplied;
      }
    }
    if (inScope.length === 0) continue;
    const allocatedCents = inScope.reduce((sum, a) => sum + a.amountCents, 0);
    const copy = { ...(payment as AnyRecord), amountCents: allocatedCents, allocations: inScope } as unknown as P;
    scopedPayments.push(copy);
  }

  return {
    invoices: scopedInvoices,
    bills: scopedBills,
    credits: scopedCredits,
    payments: scopedPayments,
    paymentsWithoutScope,
    paymentsWithoutScopeCents: allocatedElsewhereCents + unappliedCents,
    allocatedElsewhereCents,
    unappliedCents,
    mixedLabelDocuments,
    wholeAccount: false,
  };
}

/**
 * What the screen says when an entity is chosen, in plain words. Says what a reader must know:
 * which label these figures are for, how much posted money is not in them and why (applied to
 * another entity, or applied to nothing yet), which documents are in no by-entity statement, and
 * that the PDF is the whole account.
 */
export function entityStatementNote(input: {
  entity: string;
  paymentsWithoutScope: number;
  paymentsWithoutScopeCents: number;
  formattedMissing?: string;
  /** cents applied to other entities' documents, with its formatted text */
  allocatedElsewhereCents?: number;
  formattedElsewhere?: string;
  /** cents applied to no document yet, with its formatted text */
  unappliedCents?: number;
  formattedUnapplied?: string;
  mixedLabelDocuments?: number;
}): string {
  if (!input.entity) return '';
  const scope = input.entity === UNLABELLED_ENTITY ? 'documents with no entity label' : `the entity “${input.entity}”`;
  const n = input.paymentsWithoutScope;
  const money = (cents: number | undefined, text: string | undefined) => (text ? text : cents ? `${cents} cents` : '');
  const parts: string[] = [];
  if ((input.allocatedElsewhereCents ?? 0) > 0) parts.push(`${money(input.allocatedElsewhereCents, input.formattedElsewhere)} applied to documents outside this entity`);
  if ((input.unappliedCents ?? 0) > 0) parts.push(`${money(input.unappliedCents, input.formattedUnapplied)} applied to no document yet`);
  const breakdown = parts.length ? `: ${parts.join(' and ')}` : '';
  const missing = n > 0
    ? ` Of ${n} posted payment${n === 1 ? '' : 's'}, ${input.formattedMissing || `${input.paymentsWithoutScopeCents} cents`} ${n === 1 ? 'is' : 'are'} not in this statement${breakdown}.`
    : '';
  const mixed = (input.mixedLabelDocuments ?? 0) > 0
    ? ` ${input.mixedLabelDocuments} document${input.mixedLabelDocuments === 1 ? ' carries' : 's carry'} lines for more than one entity and ${input.mixedLabelDocuments === 1 ? 'is' : 'are'} in no single-entity statement; the whole-account statement has ${input.mixedLabelDocuments === 1 ? 'it' : 'them'}.`
    : '';
  return `This statement covers ${scope} only, read from the same documents as the whole-account statement.${missing}${mixed} The PDF and the server statement still cover the whole account, so they are switched off while an entity is chosen.`;
}
