/** EU-E3: parents and children for label values — order, loops, roll-ups and the "/" conversion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ancestors, descendants, parentProblem, rollUp, slashConversionPlan, treeOrder } from '../lib/labelTree';
import { setDimensionNodeParentInline } from '../lib/labelTreeActions';
import type { DimensionNodeActionAdapter } from '../lib/dimensionNodeActions';
import type { DimensionNode } from '../types';

const n = (id: string, description: string, parentId?: string, extra: Partial<DimensionNode> = {}): DimensionNode =>
  ({ id, dimensionId: 'property', description, ...(parentId ? { parentId } : {}), ...extra });
// North → Maui house → Unit 1, Unit 2; South (no children); a value of another label
const nodes = [
  n('R1', 'North'), n('P1', 'Maui house', 'R1'), n('U1', 'Unit 1', 'P1'), n('U2', 'Unit 2', 'P1'), n('R2', 'South'),
  { id: 'C1', dimensionId: 'class', description: 'Operations' } as DimensionNode,
];

test('EU-E3: tree order puts each parent before its children, with depth', () => {
  assert.deepEqual(treeOrder(nodes, 'property').map(({ node, depth }) => `${depth}:${node.id}`), ['0:R1', '1:P1', '2:U1', '2:U2', '0:R2']);
  assert.deepEqual(ancestors(nodes, 'property', 'U2').map(x => x.id), ['P1', 'R1']);
  assert.deepEqual(descendants(nodes, 'property', 'R1').map(x => x.id), ['P1', 'U1', 'U2']);
});

test('EU-E3: a value with a missing parent, or in a loop, is still shown at the top level', () => {
  const broken = [n('A', 'A', 'B'), n('B', 'B', 'A'), n('X', 'X', 'gone')];
  assert.deepEqual(treeOrder(broken, 'property').map(({ node }) => node.id).sort(), ['A', 'B', 'X']);
  assert.deepEqual(ancestors(broken, 'property', 'A').map(x => x.id), ['B'], 'stops at the loop');
});

test('EU-E3: the parent choices that are refused', () => {
  assert.equal(parentProblem(nodes, 'property', 'P1', null), null);
  assert.equal(parentProblem(nodes, 'property', 'P1', 'R2'), null);
  assert.equal(parentProblem(nodes, 'property', 'P1', 'P1'), 'A value cannot be its own parent.');
  assert.equal(parentProblem(nodes, 'property', 'R1', 'U1'), 'That value is already under this one; choosing it would make a loop.');
  assert.equal(parentProblem(nodes, 'property', 'P1', 'C1'), 'Choose a value of the same label as the parent.');
  assert.equal(parentProblem([...nodes, n('OLD', 'Old', undefined, { status: 'archived' })], 'property', 'P1', 'OLD'), 'An archived value cannot be a parent.');
});

test('EU-E3: totals with children — Unit 1 100.00, Unit 2 250.00, Maui 50.00, North 0', () => {
  const net: Record<string, number> = { U1: 10_000, U2: 25_000, P1: 5_000 };
  assert.deepEqual(rollUp(nodes, 'property', id => net[id] || 0), [
    { id: 'R1', name: 'North', own: 0, children: 40_000, total: 40_000 },
    { id: 'P1', name: 'Maui house', own: 5_000, children: 35_000, total: 40_000 },
  ]);
});

test('EU-E3: "/" names become a plan, matched to an existing parent or one to create', () => {
  const flat = [n('R1', 'North'), n('P1', 'North / Maui house'), n('P2', 'south/Aspen cabin'), n('P3', 'A / B / C'), n('P4', 'Plain'), n('P5', 'X / Y', 'R1')];
  assert.deepEqual(slashConversionPlan(flat, 'property'), [
    { nodeId: 'P1', from: 'North / Maui house', newName: 'Maui house', parentName: 'North', parentId: 'R1' },
    { nodeId: 'P2', from: 'south/Aspen cabin', newName: 'Aspen cabin', parentName: 'south', parentId: null },
    { nodeId: 'P3', from: 'A / B / C', newName: 'C', parentName: 'A / B', parentId: null },
  ], 'a value that already has a parent, and one without "/", are not offered');
});

test('EU-E3: setting a parent writes parentId (and the new name in a conversion), and refuses a loop', async () => {
  let store = [...nodes];
  const writes: Array<Record<string, unknown>> = [];
  const adapter = {
    session: () => ({ workspaceId: 'w1', uid: 'u1', canWriteNodes: true }),
    getNodes: () => store,
    setNodes: (next: DimensionNode[]) => { store = next; },
    updateNode: async (_w: string, _d: string, id: string, fields: Record<string, unknown>) => { writes.push({ id, ...fields }); },
  } as unknown as DimensionNodeActionAdapter;
  await setDimensionNodeParentInline('property', 'R2', 'R1', 'South coast', adapter);
  assert.equal(writes.length, 1);
  assert.deepEqual({ ...writes[0], updatedAt: 'x' }, { id: 'R2', parentId: 'R1', description: 'South coast', updatedAt: 'x' });
  assert.equal(store.find(x => x.id === 'R2')?.parentId, 'R1');
  await setDimensionNodeParentInline('property', 'R2', null, undefined, adapter);
  assert.equal(store.find(x => x.id === 'R2')?.parentId, undefined, 'cleared');
  await assert.rejects(setDimensionNodeParentInline('property', 'R1', 'U1', undefined, adapter), /loop/);
  assert.equal(writes.length, 2, 'nothing written for the refused loop');
});
