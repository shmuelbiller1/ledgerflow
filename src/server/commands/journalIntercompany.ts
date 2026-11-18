import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { computeIntercompanyIdentityHash } from '../../lib/selfBalancingDimensions';
import { lockMessage, postingLock } from '../../lib/periodLock';
import { HttpError } from '../auth/requestUser';
import { isWorkspaceMemberData, FieldValue, type DocumentData } from '../db/firestore';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { ledgerCreate } from '../services/ledgerDoor';
import { writeServerAuditLog } from '../services/auditLogService';
import { formatTzDate } from '../utils/formatTzDate';
import type { CommandDefinition } from './types';

export const intercompanyInput = z.object({
  sourceWorkspaceId: z.string().min(1), targetWorkspaceId: z.string().min(1), amountCents: z.number().int(),
  description: z.string().optional(), date: z.string().optional(), sourceAccountId: z.string().optional(), targetAccountId: z.string().optional(), targetAmountCents: z.number().int().optional(),
}).strict();
type IntercompanyPrepared = Awaited<ReturnType<typeof prepareIntercompany>>;
type IntercompanyResult = { sourceTxId: string; targetTxId: string; sharedIdentityHash: string; sourceName: string; targetName: string; sourceAmount: number; targetAmount: number };

async function authorizeTarget(ctx: Parameters<NonNullable<CommandDefinition<typeof intercompanyInput>['prepare']>>[0], targetId: string): Promise<DocumentData> {
  if (ctx.user.developerWorkspaceId && ctx.user.developerWorkspaceId !== targetId) throw new HttpError(`Forbidden: API key is scoped strictly to workspace ${ctx.user.developerWorkspaceId}`, 403);
  const target = await ctx.db.collection('workspaces').doc(targetId).get();
  if (!target.exists) throw new HttpError('Workspace not found', 404);
  const data = target.data() || {};
  if (!isWorkspaceMemberData(data, ctx.user, targetId) || (!ctx.user.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(data, ctx.actor)))) throw new HttpError('Forbidden: changing the books requires the owner, accountant or bookkeeper role', 403);
  return data;
}

async function prepareIntercompany(ctx: Parameters<NonNullable<CommandDefinition<typeof intercompanyInput>['prepare']>>[0], input: z.output<typeof intercompanyInput>) {
  const { sourceWorkspaceId, targetWorkspaceId, amountCents, description, date, sourceAccountId, targetAccountId, targetAmountCents: givenTargetCents } = input;
  const user = ctx.user; const db = ctx.db;
  if (sourceWorkspaceId !== ctx.workspaceId) throw new HttpError('Workspace mismatch', 403);
  if (!amountCents) throw new HttpError('Missing required intercompany parameters (source, target, amount)', 400);
  if (sourceWorkspaceId === targetWorkspaceId) throw new HttpError('Intercompany transfer requires two distinct workspaces; use an internal bank transfer within the same workspace.', 400);
  // Source access was checked by the runner. Target access is checked before replay, again during
  // preparation and once more in the commit transaction.
  const sourceWsData = ctx.workspace;
  const targetWsData = await authorizeTarget(ctx, targetWorkspaceId);
  // Z-19 (found by DA-09): companies in different currencies need the amount that arrives; it is
  // never converted with a guessed rate
  const sourceCurrency = String(sourceWsData.currency || 'USD');
  const targetCurrency = String(targetWsData.currency || 'USD');
  let targetCents = amountCents;
  if (sourceCurrency !== targetCurrency) {
    if (typeof givenTargetCents !== 'number' || !Number.isSafeInteger(givenTargetCents) || givenTargetCents <= 0) {
      throw new HttpError(`${sourceWsData.name || 'One company'} keeps its books in ${sourceCurrency} and ${targetWsData.name || 'the other'} in ${targetCurrency}: say how much arrives in ${targetCurrency} (targetAmountCents).`, 400);
    }
    targetCents = givenTargetCents;
  }

  // 2. Resolve Reciprocal Clearing Accounts
  // We look for accounts marked as 'intercompany' role or named 'Intercompany'
  const [sourceAccsSnap, targetAccsSnap] = await Promise.all([
    db.collection('chartAccounts').where('workspaceId', '==', sourceWorkspaceId).get(),
    db.collection('chartAccounts').where('workspaceId', '==', targetWorkspaceId).get()
  ]);

  const sourceAccounts = sourceAccsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));
  const targetAccounts = targetAccsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData & { id: string }));

  let sourceClearing = sourceAccounts.find(a => a.role === 'intercompany' || (a.name || '').toLowerCase().includes('intercompany'));
  let targetClearing = targetAccounts.find(a => a.role === 'intercompany' || (a.name || '').toLowerCase().includes('intercompany'));

  // Create clearing accounts if missing (persisted inside the atomic runTransaction below)
  if (!sourceClearing) {
    const ref = db.collection('chartAccounts').doc();
    sourceClearing = {
      id: ref.id,
      workspaceId: sourceWorkspaceId,
      name: `Intercompany Due From ${targetWsData.name || 'Target'}`,
      code: '1300',
      type: 'asset',
      subtype: 'other_current_asset',
      category: 'Receivables',
      balanceCents: 0,
      createdAt: new Date().toISOString()
    };
  }

  if (!targetClearing) {
    const ref = db.collection('chartAccounts').doc();
    targetClearing = {
      id: ref.id,
      workspaceId: targetWorkspaceId,
      name: `Intercompany Due To ${sourceWsData.name || 'Source'}`,
      code: '2300',
      type: 'liability',
      subtype: 'other_current_liability',
      category: 'Payables',
      balanceCents: 0,
      createdAt: new Date().toISOString()
    };
  }

  // 3. Prepare Reciprocal Transactions
  const sourceTxId = db.collection('transactions').doc().id;
  const targetTxId = db.collection('transactions').doc().id;
  const effectiveSourceDate = date || formatTzDate(new Date(), typeof sourceWsData.timezone === 'string' ? sourceWsData.timezone : undefined);
  const sharedIdentityHash = computeIntercompanyIdentityHash({
    sourceWorkspaceId,
    targetWorkspaceId,
    sourceTxId,
    targetTxId,
    date: effectiveSourceDate,
    sourceAmountCents: amountCents,
    targetAmountCents: targetCents,
    sourceCurrency,
    targetCurrency,
  });

  // SOURCE: Dr Intercompany Clearing / Cr Cash (Asset Transfer Out)
  const sourceTx: Record<string, unknown> = {
    id: sourceTxId,
    uid: user.uid,
    workspaceId: sourceWorkspaceId,
    date: effectiveSourceDate,
    description: description || `Intercompany Transfer to ${targetWsData.name}`,
    totalAmountCents: amountCents,
    currency: sourceWsData.currency || 'USD',
    exchangeRate: 1,
    status: 'completed',
    type: 'actual',
    metadata: { isIntercompany: true, targetWorkspaceId, targetTxId, sharedIdentityHash },
    lines: [
      {
        accountId: sourceClearing.id,
        accountName: sourceClearing.name,
        amountCents: amountCents, // Debit Due From (Asset Up)
        description: `Due From ${targetWsData.name}`
      },
      {
        accountId: sourceAccountId || sourceAccounts.find(a => a.role === 'cash' || a.subtype === 'cash')?.id,
        accountName: 'Cash/Bank',
        amountCents: -amountCents, // Credit Cash (Asset Down)
        description: `Transfer Out`
      }
    ]
  };

  // TARGET: Dr Asset/Expense / Cr Intercompany Clearing (Liability Up)
  const targetTx: Record<string, unknown> = {
    id: targetTxId,
    uid: user.uid,
    workspaceId: targetWorkspaceId,
    date: date || formatTzDate(new Date(), targetWsData?.timezone),
    description: description || `Intercompany Receipt from ${sourceWsData.name}`,
    totalAmountCents: targetCents,
    currency: targetWsData.currency || 'USD',
    exchangeRate: 1,
    status: 'completed',
    type: 'actual',
    metadata: { isIntercompany: true, sourceWorkspaceId, sourceTxId, sharedIdentityHash },
    lines: [
      {
        accountId: targetAccountId || targetAccounts.find(a => a.role === 'cash' || a.subtype === 'cash')?.id,
        accountName: 'Target Account',
        amountCents: targetCents, // Debit Cash/Specified Target Account
        description: `Intercompany Receipt`
      },
      {
        accountId: targetClearing.id,
        accountName: targetClearing.name,
        amountCents: -targetCents, // Credit Due To (Liability Up)
        description: `Due To ${sourceWsData.name}`
      }
    ]
  };

  // 4. Validate both transactions before posting
  // the clearing accounts made above are written in the same batch as the entries, so the check
  // is given each company's accounts including them (DA-09 found the first post always refused)
  const accountsOf = (list: Array<DocumentData & { id: string }>, clearing: DocumentData & { id: string }) =>
    new Map<string, { workspaceId?: string; name?: string }>([...list, clearing].map(a => [a.id, { workspaceId: a.workspaceId, name: a.name }]));
  const [validSource, validTarget] = await Promise.all([
    TransactionValidator.validateAndPrepare(sourceTx, { db, workspaceId: sourceWorkspaceId, user, wsData: sourceWsData, accountsMap: accountsOf(sourceAccounts, sourceClearing as DocumentData & { id: string }) }),
    TransactionValidator.validateAndPrepare(targetTx, { db, workspaceId: targetWorkspaceId, user, wsData: targetWsData, accountsMap: accountsOf(targetAccounts, targetClearing as DocumentData & { id: string }) })
  ]);
  return { sourceWsData, targetWsData, sourceAccounts, targetAccounts, sourceClearing: sourceClearing!, targetClearing: targetClearing!, sourceTxId, targetTxId, sharedIdentityHash, validSource, validTarget, targetCents };
}

export const journalIntercompanyCommand: CommandDefinition<typeof intercompanyInput, IntercompanyResult, IntercompanyPrepared> = {
  name: 'journal.intercompany', input: intercompanyInput, roles: ['owner', 'accountant', 'bookkeeper'], allowPlatformAdmin: true,
  async authorizeInput(ctx, input) {
    if (input.sourceWorkspaceId !== ctx.workspaceId) throw new HttpError('Workspace mismatch', 403);
    await authorizeTarget(ctx, input.targetWorkspaceId);
  },
  prepare: prepareIntercompany,
  async handler(ctx, tx, input) {
    const p = ctx.prepared as IntercompanyPrepared;
    const targetWs = (await tx.get(ctx.db.collection('workspaces').doc(input.targetWorkspaceId))).data();
    if (!targetWs || !isWorkspaceMemberData(targetWs, ctx.user, input.targetWorkspaceId) || (!ctx.user.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(targetWs, ctx.actor)))) throw new HttpError('Forbidden: changing the books requires the owner, accountant or bookkeeper role', 403);
    // Validate the exact chart used for preparation again inside the serializable commit. A clearing
    // account or posting account changed while the entries were prepared must not slip past validation.
    const [sourceChart, targetChart] = await Promise.all([
      tx.get(ctx.db.collection('chartAccounts').where('workspaceId', '==', input.sourceWorkspaceId)),
      tx.get(ctx.db.collection('chartAccounts').where('workspaceId', '==', input.targetWorkspaceId)),
    ]);
    const canonical = (docs: Array<{ id: string; data(): DocumentData }>) => docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const ordered = (rows: Array<DocumentData & { id: string }>) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    if (!isDeepStrictEqual(canonical(sourceChart.docs), ordered(p.sourceAccounts)) || !isDeepStrictEqual(canonical(targetChart.docs), ordered(p.targetAccounts))) throw new HttpError('The chart changed while the transfer was prepared. Reload and try again.', 409);
    if ((ctx.workspace.currency || 'USD') !== (p.sourceWsData.currency || 'USD') || (targetWs.currency || 'USD') !== (p.targetWsData.currency || 'USD')) throw new HttpError('A workspace currency changed while the transfer was prepared. Reload and try again.', 409);
    for (const [entry, workspace] of [[p.validSource, ctx.workspace], [p.validTarget, targetWs]] as const) {
      const lock = postingLock(entry.date, workspace, ctx.actor);
      if (lock) throw new HttpError(lockMessage(entry.date, lock), 400);
    }
    if (!p.sourceAccounts.some(a => a.id === p.sourceClearing.id)) tx.create(ctx.db.collection('chartAccounts').doc(p.sourceClearing.id), p.sourceClearing);
    if (!p.targetAccounts.some(a => a.id === p.targetClearing.id)) tx.create(ctx.db.collection('chartAccounts').doc(p.targetClearing.id), p.targetClearing);
    ledgerCreate(tx, ctx.db.collection('transactions').doc(p.sourceTxId), { ...p.validSource, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    ledgerCreate(tx, ctx.db.collection('transactions').doc(p.targetTxId), { ...p.validTarget, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await writeServerAuditLog({ workspaceId: input.targetWorkspaceId, uid: ctx.actor, email: ctx.email, action: 'INTERCOMPANY_TRANSFER_POSTED', entityType: 'transaction', entityId: p.targetTxId, details: { description: `Posted intercompany receipt from ${p.sourceWsData.name}`, sourceWorkspaceId: input.sourceWorkspaceId, sourceTxId: p.sourceTxId, amountCents: p.targetCents } }, { db: ctx.db, tx });
    return { sourceTxId: p.sourceTxId, targetTxId: p.targetTxId, sharedIdentityHash: p.sharedIdentityHash, sourceName: String(p.sourceWsData.name || ''), targetName: String(p.targetWsData.name || ''), sourceAmount: input.amountCents, targetAmount: p.targetCents };
  },
  async preview(ctx, input) { const p = await prepareIntercompany(ctx, input); return { title: 'Post an intercompany transfer', lines: [`${input.sourceWorkspaceId} to ${input.targetWorkspaceId}`, 'Both entries post atomically'], accounts: [...p.validSource.lines, ...p.validTarget.lines].map(l => ({ accountId: l.accountId, accountName: l.accountName, amountCents: l.amountCents })) }; },
  audit(input, result) { return { action: 'INTERCOMPANY_TRANSFER_POSTED', entityType: 'transaction', entityId: result.sourceTxId, description: `Posted intercompany transfer out to ${result.targetName}`, details: { targetWorkspaceId: input.targetWorkspaceId, targetTxId: result.targetTxId, amountCents: result.sourceAmount } }; },
  inverse() { return null; }, risk: 'normal',
  describe: { sentence: 'Post reciprocal entries in two workspaces for an intercompany transfer; do not use it for a transfer within one workspace.', example: { sourceWorkspaceId: 'ws_one', targetWorkspaceId: 'ws_two', amountCents: 10000 }, refusals: [
    { code: 'ROLE_REQUIRED', when: 'The caller cannot write both workspaces.', next: 'Ask each workspace owner for a writer role.' },
    { code: 'CONFLICT', when: 'A workspace or chart changed during preparation.', next: 'Reload and try again.' },
    { code: 'INVALID_INPUT', when: 'Both workspaces are the same or the arriving amount in a different currency is missing.', next: 'Choose two workspaces and supply both currency amounts.' },
  ] },
};
