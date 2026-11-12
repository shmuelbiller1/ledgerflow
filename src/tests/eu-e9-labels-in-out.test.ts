/**
 * EU-E9: labels in and out. The API's `label.<name>=<value>` takes the workspace's own labels by name or id (any
 * case) and refuses an unknown one with the names it has; an entry matches when it or one of its lines carries the
 * value. Exports get one column per label (not Category), filled from the entry, else from its lines.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LabelFilterError, labelExportColumns, matchesLabelFilters, parseLabelFilters } from '../lib/labelQueryFilter';

const labels = [{ id: 'category', name: 'Category' }, { id: 'property', name: 'Property' }, { id: 'class', name: 'Class' }];
const nodes = [{ id: 'maui', dimensionId: 'property', description: 'Maui house' }, { id: 'aspen', dimensionId: 'property', description: 'Aspen cabin' }];

test('EU-E9: label.Property=maui, by name or id, any case; other query keys untouched', () => {
  assert.deepEqual(parseLabelFilters({ 'label.Property': 'maui', startDate: '2026-01-01' }, labels), { property: 'maui' });
  assert.deepEqual(parseLabelFilters({ 'label.CLASS': ['ops', 'x'] }, labels), { class: 'ops' });
  assert.deepEqual(parseLabelFilters({}, labels), {});
});

test('EU-E9: an unknown label name or an empty value is refused with a message, never ignored', () => {
  assert.throws(() => parseLabelFilters({ 'label.Region': 'north' }, labels), (e: Error) => e instanceof LabelFilterError && /Unknown label "Region"\. Labels in this workspace: Category, Property, Class/.test(e.message));
  assert.throws(() => parseLabelFilters({ 'label.property': ' ' }, labels), LabelFilterError);
});

test('EU-E9: an entry matches by its own label or a line\'s; every filter must match', () => {
  const onEntry = { dimensions: { property: 'maui' }, lines: [] };
  const onLine = { lines: [{ dimensions: { property: 'maui', class: 'ops' } }, { dimensions: {} as Record<string, string> }] };
  assert.equal(matchesLabelFilters(onEntry, { property: 'maui' }), true);
  assert.equal(matchesLabelFilters(onLine, { property: 'maui', class: 'ops' }), true);
  assert.equal(matchesLabelFilters(onLine, { property: 'aspen' }), false);
  assert.equal(matchesLabelFilters(onEntry, { property: 'maui', class: 'ops' }), false);
});

test('EU-E9: export columns — one per label, descriptions, the entry first, then distinct line values', () => {
  const cols = labelExportColumns(labels, nodes);
  assert.deepEqual(cols.headers, ['Property', 'Class']);
  assert.deepEqual(cols.cells({ dimensions: { property: 'maui' } }), ['Maui house', '']);
  assert.deepEqual(cols.cells({ lines: [{ dimensions: { property: 'maui' } }, { dimensions: { property: 'aspen', class: 'ops' } }, { dimensions: { property: 'maui' } }] }), ['Maui house | Aspen cabin', 'ops']);
});

test('EU-E9: labels kept in the older fields (projectId, classId, locationId) match and export too', () => {
  const legacy = { projectId: 'p1', lines: [{ dimensions: {} as Record<string, string> }] } as unknown as Parameters<typeof matchesLabelFilters>[0];
  assert.equal(matchesLabelFilters(legacy, { project: 'p1' }), true);
  assert.equal(matchesLabelFilters(legacy, { project: 'p2' }), false);
  const cols = labelExportColumns([{ id: 'project', name: 'Project' }], []);
  assert.deepEqual(cols.cells(legacy), ['p1']);
});


test('EU-E9: exported labels reflect line overrides rather than the entry default', () => {
  const cols = labelExportColumns(labels, nodes);
  assert.deepEqual(cols.cells({
    dimensions: { property: 'maui' },
    lines: [
      { dimensions: { property: 'aspen' } },
      { dimensions: { property: 'maui' } },
      { dimensions: { property: 'aspen' } },
    ],
  }), ['Aspen cabin | Maui house', '']);
  assert.deepEqual(cols.cells({
    dimensions: { property: 'maui' },
    lines: [{ dimensions: { property: 'aspen' } }],
  }), ['Aspen cabin', ''], 'line label wins when all lines override the entry');
  assert.deepEqual(cols.cells({ dimensions: { property: 'maui' }, lines: [] }), ['Maui house', '']);
});
