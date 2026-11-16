/**
 * A learned pattern is a workspace record: the count, the merge and the delta are the server's.
 *
 * These are the cases the browser could not get right while it kept the number itself — two tabs filing the
 * same description, two descriptions that differ only in spacing, and a delta the classifier must be able to
 * find.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommand } from '../server/utils/commandExecutor';
import { autoRuleLearnCommand, autoRuleLearnInput } from '../server/commands/rulePatterns';
import { learnedPatternId } from '../lib/learnedPatterns';
import { captureResponse, fakeRequest, MemoryDb, owner, runnerDependencies, seedWorkspace, workspaceId } from './helpers/commandTestUtils';

test('a learned pattern is counted and merged by the server, not by the copy the browser holds', async () => {
  const db = new MemoryDb();
  seedWorkspace(db);
  const patternId = `${workspaceId}_${learnedPatternId('paper co')}`;
  // the browser used to write the whole record with the count it had in cache, so two tabs both wrote 1
  const first = autoRuleLearnInput.parse({ description: '  Paper Co ', accountId: 'expense-office', accountName: 'Office', tags: ['paper', 'office'] });
  assert.equal(autoRuleLearnInput.safeParse({ description: 'Paper Co', accountId: 'expense-office', count: 99 }).success, false);
  assert.equal(autoRuleLearnInput.safeParse({ description: 'Paper Co', accountId: 'expense-office', workspaceId: 'other' }).success, false);
  const one = await executeCommand(fakeRequest(owner, { workspaceId, input: first }), captureResponse().response,
    { definition: autoRuleLearnCommand, workspaceId, input: first }, runnerDependencies(db));
  assert.equal(one.ok, true);
  assert.equal(db.read(`rulePatterns/${patternId}`)?.count, 1);
  assert.equal(db.read(`rulePatterns/${patternId}`)?.description, 'paper co', 'the description is cleaned once, on the server');
  assert.equal(db.read(`rulePatterns/${patternId}`)?.workspaceId, workspaceId);
  assert.equal(db.read(`learnedDeltas/${patternId}`)?.category, 'Office', 'the models read the same event');
  assert.equal(db.read(`learnedDeltas/${patternId}`)?.apiKeyId, 'human_web_console', 'the classifier only trains on this id');

  const second = autoRuleLearnInput.parse({ description: 'paper co', accountId: 'expense-office', accountName: 'Office', tags: ['paper', 'stationery'], dimensions: { class: 'Admin' } });
  const two = await executeCommand(fakeRequest(owner, { workspaceId, input: second }), captureResponse().response,
    { definition: autoRuleLearnCommand, workspaceId, input: second }, runnerDependencies(db));
  assert.equal(two.ok, true);
  assert.equal(db.read(`rulePatterns/${patternId}`)?.count, 2, 'the second tab counts up, it does not overwrite 1');
  assert.deepEqual(db.read(`rulePatterns/${patternId}`)?.tags, ['paper', 'office', 'stationery'], 'labels merge without repeating');
  assert.deepEqual(db.read(`rulePatterns/${patternId}`)?.dimensions, { class: 'Admin' });

  // a description the matcher left with two inner spaces keeps its own id: the server must not merge it into
  // "paper co", or an existing pattern stops counting and a new row starts again at 1
  const spaced = autoRuleLearnInput.parse({ description: 'paper  co', accountId: 'expense-office' });
  await executeCommand(fakeRequest(owner, { workspaceId, input: spaced }), captureResponse().response,
    { definition: autoRuleLearnCommand, workspaceId, input: spaced }, runnerDependencies(db));
  assert.equal(db.read(`rulePatterns/${workspaceId}_${learnedPatternId('paper  co')}`)?.count, 1);
  assert.equal(db.read(`rulePatterns/${patternId}`)?.count, 2, 'and the pattern with one space is untouched');

  const many = autoRuleLearnInput.parse({ description: 'paper co', accountId: 'expense-office', tags: ['a', 'b', 'c', 'd', 'e', 'f'] });
  await executeCommand(fakeRequest(owner, { workspaceId, input: many }), captureResponse().response,
    { definition: autoRuleLearnCommand, workspaceId, input: many }, runnerDependencies(db));
  assert.equal((db.read(`rulePatterns/${patternId}`)?.tags as string[]).length, 5, 'a long-lived pattern does not collect a whole chart of labels');
});

