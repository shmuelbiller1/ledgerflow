/**
 * S-43: nothing of the question is stored. After real assistant turns on every answer path — code,
 * cached, model and failed — the stored turn metrics and AI traces (billingLedgerTraces) contain no
 * question text, answer text, amounts or names. Real PostgreSQL: the scan reads the actual rows the
 * turns wrote.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { cleanupHost, scriptedModel, startAssistantFixture, type AssistantFixture, type ScriptedModel } from './helpers/assistantTurnHarness';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);
// unique per run, so the storage scan can never match another suite's rows
const NAME = `ZEBRA-CUSTOMER-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const AMOUNT = String(86_753_000 + crypto.randomBytes(2).readUInt16BE(0));
const QUESTION_CODE = `Find customer ${NAME}`;
const QUESTION_MODEL = `What does the record for customer ${NAME} say about the ${AMOUNT} dollars?`;
const QUESTION_FAILED = `Why is ${NAME} showing ${AMOUNT}?`;

describe('S-43: the stored metrics and AI traces hold no question, answer, amount or name', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL', timeout: 60_000 }, () => {
  const host = cleanupHost();
  let model: ScriptedModel;
  let f: AssistantFixture;
  const answers: Record<string, string> = {};

  before(async () => {
    model = scriptedModel(number => {
      if (number === 1) return { functionCalls: [{ name: 'search_records', args: { text: NAME, collections: ['customers'] } }] };
      if (number === 2) return { text: `The record for ${NAME} shows ${AMOUNT} dollars owed.` };
      throw new Error('provider down');
    });
    f = await startAssistantFixture(host, { modelClient: () => model.client });
    await f.live.doc(`customers/${f.workspaceId}-zebra`).create({
      id: `${f.workspaceId}-zebra`, workspaceId: f.workspaceId,
      name: NAME, balanceCents: Number(AMOUNT), createdAt: new Date().toISOString(),
    });
    // 1. code path: an exact lookup, answered from a template with no model call
    const code = await f.turn(QUESTION_CODE);
    assert.equal(code.status, 200, JSON.stringify(code.json));
    assert.equal(code.json.path, 'code');
    answers.code = String(code.json.answer);
    // 2. cached path: the same question again, every tool result served from the read cache
    const cached = await f.turn(QUESTION_CODE);
    assert.equal(cached.status, 200, JSON.stringify(cached.json));
    assert.equal(cached.json.path, 'cache');
    answers.cache = String(cached.json.answer);
    // 3. model path: the model answers (with the very text a leak would carry)
    const modelTurn = await f.turn(QUESTION_MODEL);
    assert.equal(modelTurn.status, 200, JSON.stringify(modelTurn.json));
    assert.equal(modelTurn.json.path, 'model');
    answers.model = String(modelTurn.json.answer);
    // 4. failed path: the provider throws; the turn is recorded as not ok
    const failed = await f.turn(QUESTION_FAILED);
    assert.equal(failed.json.status, 'error');
    answers.failed = String(failed.json.answer);
  });

  after(async () => { await host.run(); });

  it('all four answer paths really ran (the stored rows are non-vacuous)', async () => {
    assert.match(answers.code, new RegExp(NAME), 'the code answer named the customer');
    assert.equal(answers.cache, answers.code);
    assert.match(answers.model, new RegExp(NAME), 'the model answer carried the very text a leak would');
    const { rows } = await f.live.pool.query(
      `select data->'assistantTurn'->>'path' as path, (data->'assistantTurn'->>'ok')::bool as ok
         from public."billingLedgerTraces" where workspace_id = $1 and data->>'algorithmName' = 'ASSISTANT_TURN'`, [f.workspaceId]);
    assert.deepEqual(rows.map(row => `${row.path}:${row.ok}`).sort(),
      ['cache:true', 'code:true', 'model:false', 'model:true'], JSON.stringify(rows));
  });

  it('no stored metric or AI trace contains the question text, answer text, amounts or names', async () => {
    const sentinels = [NAME, AMOUNT, QUESTION_CODE, QUESTION_MODEL, QUESTION_FAILED, answers.code, answers.model];
    const scanned = ['billingLedgerTraces', 'auditLogs', 'notifications', 'emailEvents', 'idempotencyKeys', 'rateLimitEntries'];
    for (const table of scanned) {
      for (const sentinel of sentinels) {
        const { rows } = await f.live.pool.query(
          `select count(*)::int as n from public."${table}" where data::text like $1`, [`%${sentinel}%`]);
        assert.equal(rows[0].n, 0, `public."${table}" must not store "${sentinel}"`);
      }
    }
  });

  it('the stored metric is counts, times and cost only', async () => {
    const { rows } = await f.live.pool.query(
      `select data from public."billingLedgerTraces" where workspace_id = $1 and data->>'algorithmName' = 'ASSISTANT_TURN'
         and data->'assistantTurn'->>'path' = 'code' limit 1`, [f.workspaceId]);
    const turn = rows[0].data.assistantTurn as Record<string, unknown>;
    assert.equal(turn.path, 'code');
    assert.equal(turn.modelCalls, 0);
    assert.equal(turn.costCents, 0);
    assert.ok(Array.isArray(turn.toolsCalled));
    for (const key of Object.keys(turn)) {
      const value = turn[key];
      if (typeof value === 'string') assert.ok(!value.includes('ZEBRA') && !value.includes(AMOUNT), `metric.${key} leaks`);
    }
  });
});
