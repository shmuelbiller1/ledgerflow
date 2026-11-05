/**
 * Live lists fetch only what changed (src/lib/db/liveQuery.ts): the merge must give the same list
 * a full reload would, or ask for the full reload.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { changedSince, fieldValue, latestUpdate, mergeChanges, orderedResult, rowMatches } from '../lib/db/liveQuery';
import type { LiveRow, LiveQueryShape } from '../lib/db/liveQuery';

const row = (id: string, data: Record<string, unknown>, updatedAt = '2026-10-01T10:00:00.000000+00:00'): LiveRow => ({ id, data, updatedAt });
const ws = { field: 'workspaceId', op: '==', value: 'w1' };

describe('Live query merging', () => {
  test('filters mean what the database makes them mean', () => {
    const r = row('a', { workspaceId: 'w1', date: '2026-09-01', amount: 5, status: 'sent', tags: ['x', 'y'], meta: { kind: 'k' } });
    assert.equal(rowMatches(r, [ws]), true);
    assert.equal(rowMatches(r, [{ field: 'workspaceId', op: '==', value: 'w2' }]), false);
    assert.equal(rowMatches(r, [{ field: 'date', op: '>=', value: '2026-01-01' }]), true);
    assert.equal(rowMatches(r, [{ field: 'date', op: '<', value: '2026-09-01' }]), false);
    assert.equal(rowMatches(r, [{ field: 'amount', op: '>', value: 4 }]), true);
    assert.equal(rowMatches(r, [{ field: 'amount', op: '==', value: '5' }]), true, 'text comparison of a number field');
    assert.equal(rowMatches(r, [{ field: 'status', op: 'in', value: ['sent', 'overdue'] }]), true);
    assert.equal(rowMatches(r, [{ field: 'status', op: 'not-in', value: ['void'] }]), true);
    assert.equal(rowMatches(r, [{ field: 'tags', op: 'array-contains', value: 'y' }]), true);
    assert.equal(rowMatches(r, [{ field: 'meta.kind', op: '==', value: 'k' }]), true);
    // SQL NULL: a missing field never passes a comparison, and != is not "missing"
    assert.equal(rowMatches(r, [{ field: 'missing', op: '!=', value: 'x' }]), false);
    assert.equal(rowMatches(r, [{ field: 'missing', op: '==', value: null }]), true);
    assert.equal(rowMatches(r, [{ field: 'missing', op: '>=', value: '2026-01-01' }]), false);
    // collation-dependent text comparison → can't reproduce → null
    assert.equal(rowMatches(row('b', { name: 'apple' }), [{ field: 'name', op: '>', value: 'Banana' }]), null);
    assert.equal(fieldValue(r, '__name__'), 'a');
  });

  test('ordering leaves out rows without the field, sorts and cuts to the limit', () => {
    const rows = [row('a', { date: '2026-01-02' }), row('b', { date: '2026-03-01' }), row('c', {}), row('d', { date: '2026-02-01' })];
    const q: LiveQueryShape = { filters: [], orders: [{ field: 'date', direction: 'desc' }], limitCount: 2 };
    assert.deepEqual(orderedResult(rows, q)?.map(r => r.id), ['b', 'd']);
    assert.equal(orderedResult([row('x', { n: 'b' }), row('y', { n: 'A' })], { filters: [], orders: [{ field: 'n', direction: 'asc' }] }), null);
  });

  test('changes, moves out of the filter and deletes merge into the same list a reload gives', () => {
    const q: LiveQueryShape = { filters: [ws, { field: 'status', op: '!=', value: 'void' }], orders: [{ field: 'date', direction: 'desc' }], limitCount: 10 };
    const current = [row('a', { workspaceId: 'w1', status: 'sent', date: '2026-01-01' }), row('b', { workspaceId: 'w1', status: 'sent', date: '2026-02-01' })];
    const out = mergeChanges(orderedResult(current, q)!, [
      row('c', { workspaceId: 'w1', status: 'sent', date: '2026-03-01' }, '2026-10-01T11:00:00Z'),
      row('a', { workspaceId: 'w1', status: 'void', date: '2026-01-01' }, '2026-10-01T11:00:01Z'),
      row('z', { workspaceId: 'w2', status: 'sent', date: '2026-04-01' }, '2026-10-01T11:00:02Z'),
    ], [], q);
    assert.equal(out.changed, true);
    assert.deepEqual(out.rows?.map(r => r.id), ['c', 'b']);
    const deleted = mergeChanges(out.rows!, [], ['b'], q);
    assert.deepEqual(deleted.rows?.map(r => r.id), ['c']);
    const same = mergeChanges(deleted.rows!, [deleted.rows![0]], [], q);
    assert.equal(same.changed, false);
  });

  test('a row leaving a list cut by its limit, or a filter that can\'t be reproduced, asks for a reload', () => {
    const q: LiveQueryShape = { filters: [ws], orders: [], limitCount: 2 };
    const current = [row('a', { workspaceId: 'w1' }), row('b', { workspaceId: 'w1' })];
    assert.equal(mergeChanges(current, [], ['a'], q).rows, null);
    assert.equal(mergeChanges(current, [row('a', { workspaceId: 'w9' })], [], q).rows, null);
    // a new row in a full list just competes for a place
    assert.deepEqual(mergeChanges(current, [row('0', { workspaceId: 'w1' })], [], q).rows?.map(r => r.id), ['0', 'a']);
    const odd: LiveQueryShape = { filters: [{ field: 'name', op: '>', value: 'B' }], orders: [] };
    assert.equal(mergeChanges([], [row('x', { name: 'c' })], [], odd).rows, null);
  });

  test('a loaded row whose sort key moves in a list cut by its limit asks for a reload; elsewhere it just re-sorts', () => {
    // newest two entries by date; c (2026-01-01) was never loaded
    const q: LiveQueryShape = { filters: [ws], orders: [{ field: 'date', direction: 'desc' }], limitCount: 2 };
    const current = [row('a', { workspaceId: 'w1', date: '2026-03-01' }), row('b', { workspaceId: 'w1', date: '2026-02-01' })];
    // b moves to 2025-06-01: c may now outrank it, which only the database knows
    assert.equal(mergeChanges(current, [row('b', { workspaceId: 'w1', date: '2025-06-01' }, '2026-10-02T10:00:00.000000+00:00')], [], q).rows, null);
    // a change that leaves the sort key alone merges in place
    assert.deepEqual(mergeChanges(current, [row('b', { workspaceId: 'w1', date: '2026-02-01', memo: 'x' }, '2026-10-02T10:00:00.000000+00:00')], [], q).rows?.map(r => r.id), ['a', 'b']);
    // a list the limit did not cut has nothing missing: it just re-sorts
    const roomy: LiveQueryShape = { ...q, limitCount: 10 };
    assert.deepEqual(mergeChanges(current, [row('a', { workspaceId: 'w1', date: '2025-01-01' }, '2026-10-02T10:00:00.000000+00:00')], [], roomy).rows?.map(r => r.id), ['b', 'a']);
  });

  test('the next fetch starts a little before the latest change seen', () => {
    const latest = latestUpdate([row('a', {}, '2026-10-01T10:00:00.5+00:00'), row('b', {}, '2026-10-01T10:00:05+00:00')], null);
    assert.equal(latest, '2026-10-01T10:00:05+00:00');
    assert.equal(changedSince(latest!), '2026-10-01T09:59:55.000Z');
    assert.equal(latestUpdate([], '2026-10-01T10:00:00Z'), '2026-10-01T10:00:00Z');
  });
});
