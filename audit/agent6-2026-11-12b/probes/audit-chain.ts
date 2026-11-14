/**
 * Agent #6 (12 Nov 2026, second session) — S-12, the audit trail's hash chain, end to end.
 *
 * `writeServerAuditLog` writes each entry with two digests: `chainHash` (computeAuditChainHash over a tuple)
 * and `entryHash` (computeAuditEntryHash from src/lib/auditHashChain, canonical v1 JSON). The patch that
 * fixed AF6-006 made the verifier accept either link. This probe builds a real multi-entry stream with the
 * production builder, verifies it, then tampers with each field an attacker would try and checks that the
 * verifier notices — a verifier that says "valid" for everything would pass a happy-path check and be
 * worthless.
 *
 * Run: NODE_ENV=test npx tsx audit/agent6-2026-11-12b/probes/audit-chain.ts
 */
import {
  AUDIT_CHAIN_GENESIS,
  buildAuditLogRecord,
  verifyAuditHashChain,
  type AuditChainHead,
} from '../../../src/server/services/auditLogService';

let failures = 0;
const report = (id: string, ok: boolean, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK    ' : 'DEFECT'} ${id}: ${detail}`);
};

const entries = [] as ReturnType<typeof buildAuditLogRecord>[];
// buildAuditLogRecord stamps the head it is given, and the writer resolves the NEXT head (seq + 1)
let head: AuditChainHead = { seq: 1, prevHash: AUDIT_CHAIN_GENESIS };
for (let n = 1; n <= 5; n++) {
  const record = buildAuditLogRecord(
    {
      workspaceId: 'ws_chain',
      uid: 'u1',
      action: 'TRANSACTION_UPDATED',
      entityType: 'transaction',
      entityId: `tx${n}`,
      details: { description: `edit ${n}`, before: { status: 'completed' }, after: { status: 'flagged' } },
    },
    `aud_${n}`,
    head,
  );
  entries.push(record);
  head = { seq: (record.seq as number) + 1, prevHash: record.entryHash as string };
}

const asVerifyInput = entries.map(e => ({
  id: e.id,
  workspaceId: e.workspaceId,
  uid: e.uid,
  action: e.action,
  entityType: e.entityType,
  entityId: e.entityId,
  details: e.details,
  timestamp: e.timestamp,
  seq: e.seq,
  prevHash: e.prevHash,
  chainHash: e.chainHash,
  entryHash: e.entryHash,
}));

report('1 the sequence numbers are 1..5', entries.map(e => e.seq).join(',') === '1,2,3,4,5', entries.map(e => e.seq).join(','));
report(
  '2 every entry links to the previous entry hash',
  entries.every((e, i) => (i === 0 ? e.prevHash === AUDIT_CHAIN_GENESIS : e.prevHash === entries[i - 1].entryHash)),
  entries.map(e => String(e.prevHash).slice(0, 8)).join(' → '),
);

const clean = verifyAuditHashChain(asVerifyInput);
report('3 the untouched stream verifies', clean.valid, JSON.stringify(clean));

const tamperedDetails = asVerifyInput.map(e => ({ ...e }));
tamperedDetails[2] = { ...tamperedDetails[2], details: { description: 'edit 3', before: { status: 'void' }, after: { status: 'flagged' } } };
const tamperedDetailsResult = verifyAuditHashChain(tamperedDetails);
report('4 changing an entry\'s details is detected at that entry', !tamperedDetailsResult.valid && tamperedDetailsResult.brokenAtId === 'aud_3', JSON.stringify(tamperedDetailsResult));

const removed = asVerifyInput.filter(e => e.id !== 'aud_3');
const removedResult = verifyAuditHashChain(removed);
report('5 deleting an entry breaks the link that followed it', !removedResult.valid, JSON.stringify(removedResult));

const reordered = [asVerifyInput[0], asVerifyInput[2], asVerifyInput[1], asVerifyInput[3], asVerifyInput[4]];
const reorderedResult = verifyAuditHashChain(reordered);
report('6 reordering entries breaks the chain', !reorderedResult.valid, JSON.stringify(reorderedResult));

const forgedPrev = asVerifyInput.map(e => ({ ...e }));
forgedPrev[3] = { ...forgedPrev[3], prevHash: 'a'.repeat(64) };
const forgedPrevResult = verifyAuditHashChain(forgedPrev);
report('7 a forged prevHash is detected', !forgedPrevResult.valid && forgedPrevResult.brokenAtId === 'aud_4', JSON.stringify(forgedPrevResult));

console.log('');
console.log(failures === 0 ? 'the audit chain verifies and every tamper is detected' : `${failures} case(s) reported DEFECT`);
process.exit(0);
