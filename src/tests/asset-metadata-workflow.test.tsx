import { inlineEditName } from './helpers/inlineEditName';
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { code128Geometry, code128Problem, code128Symbols } from '../lib/code128';
import { isMaintenanceDay, MAX_MAINTENANCE, maintenanceProblem, withEntry } from '../lib/assetMaintenance';
import { assetTagProblem } from '../lib/assetTags';
import { createAssetTagAdapter } from '../lib/assetTagAdapter';
import { saveInlineRecordField, type InlineRecordAdapter } from '../lib/inlineRecordFields';
import { MaintenanceLog } from '../components/assets/MaintenanceLog';
import { AssetInlineDetails } from '../components/assets/AssetInlineDetails';
import AssetLabels from '../components/assets/AssetLabels';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { FixedAsset } from '../types';

const realFetch = globalThis.fetch;
const asset: FixedAsset = {
  id: 'van', uid: 'test-user', workspaceId: 'component-workspace', name: 'ציוד', purchaseDate: '2026-01-01',
  purchasePriceCents: 1200000, salvageValueCents: 10000, usefulLifeYears: 5, depreciationMethod: 'straight-line',
  accumulatedDepreciationCents: 20000, status: 'active', createdAt: '2026-01-01',
  maintenance: [{ id: 'old', date: '2026-03-01', description: 'New tyres', costCents: 40000, by: 'Tyre shop' }],
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function setup() {
  setComponentWorkspace('bookkeeper');
  useLedgerStore.setState({ assets: [asset], truncatedCollections: {} });
  markComponentCollectionsLoaded('assets');
}
afterEach(async () => {
  cleanup(); globalThis.fetch = realFetch;
  getSupabase().realtime.disconnect(); await getSupabase().auth.dispose();
});

test('Code 128 B: independent symbol/checksum fixtures, stop and ten-module quiet zones', () => {
  assert.deepEqual(code128Symbols('AB'), [104, 33, 34, 102, 106]);
  // 104 + 33*1 + 52*2 + 13*3 + 16*4 + 16*5 + 16*6 + 17*7 = 639; mod 103 = 21.
  assert.deepEqual(code128Symbols('AT-0001'), [104, 33, 52, 13, 16, 16, 16, 17, 21, 106]);
  const geometry = code128Geometry('AB');
  assert.equal(geometry.width, 77); // four 11-module symbols, 13-module stop, two 10-module quiet zones
  assert.deepEqual(geometry.bars.slice(0, 3), [{ x: 10, width: 2 }, { x: 13, width: 1 }, { x: 16, width: 1 }]);
  const last = geometry.bars.at(-1)!;
  assert.equal(last.x + last.width, 67);
  assert.equal(code128Geometry('AT-0001').width, 132);
  for (const text of ['', 'A\nB', 'ציוד', 'x'.repeat(33)]) {
    assert.ok(code128Problem(text)); assert.throws(() => code128Symbols(text));
  }
  assert.equal(code128Problem('a-Z_09 !'), null);
});

test('maintenance dates reject normalization, validate leap days and refuse log overflow', () => {
  for (const date of ['2026-02-30', '2026-04-31', '2026-02-29', '1900-02-29', '2026-13-01', 'not a date']) {
    assert.equal(isMaintenanceDay(date), false);
    assert.ok(maintenanceProblem({ date, description: 'Service' }));
  }
  for (const date of ['2024-02-29', '2000-02-29', '2026-10-11']) assert.equal(isMaintenanceDay(date), true);
  assert.ok(maintenanceProblem({ date: '2026-10-01', description: 'Service', nextDue: '2027-02-30' }));
  assert.ok(maintenanceProblem({ date: '2026-10-01', description: 'Service', by: 'a'.repeat(121) }));
  const log = Array.from({ length: MAX_MAINTENANCE }, (_, number) => ({ id: String(number), date: '2026-01-01', description: 'Service' }));
  assert.throws(() => withEntry(log, { id: 'extra', date: '2026-10-11', description: 'Service' }), /already has 500/);
  assert.equal(log.length, 500);
});

test('asset tag adapter checks authoritative workspace tags, including disposed ones, without editing money', async () => {
  const session = { uid: 'u', workspaceId: 'w', writable: true };
  const writes: unknown[] = [];
  const base: InlineRecordAdapter = {
    session: () => session,
    read: async () => ({ workspaceId: 'w', assetTag: '', purchasePriceCents: 1200000 }),
    update: async (target, fields) => { writes.push({ target, fields }); },
  };
  const target = { collection: 'assets', id: 'own' } as const;
  const adapter = createAssetTagAdapter(base, async () => [
    { id: 'disposed', workspaceId: 'w', assetTag: 'At-0001' },
    { id: 'elsewhere', workspaceId: 'other', assetTag: 'AT-0002' },
  ]);
  await assert.rejects(saveInlineRecordField(adapter, target, 'assetTag', '', 'AT-0001'), /already used/);
  assert.equal(writes.length, 0);
  await saveInlineRecordField(adapter, target, 'assetTag', '', 'AT-0002');
  assert.deepEqual(writes, [{ target, fields: { assetTag: 'AT-0002' } }]);
  assert.equal(assetTagProblem(' AT-0001 ', [{ id: 'own', assetTag: 'AT-0001' }], 'own'), null);
  assert.match(assetTagProblem('i-1', [{ id: 'other', assetTag: 'I-1' }], 'own') || '', /already used/);
  for (const tag of [' AT-1', 'AT-1 ', 'a'.repeat(33), 'ציוד']) await assert.rejects(saveInlineRecordField(adapter, target, 'assetTag', '', tag));
  await assert.rejects(saveInlineRecordField(adapter, target, 'purchasePriceCents', 1200000, 1), /own editor/);
  await assert.rejects(saveInlineRecordField(adapter, target, 'nextServiceDue', '', '2026-02-30'), /valid date/);
  await saveInlineRecordField(adapter, target, 'nextServiceDue', '', '2027-02-28');
});

test('tag duplicate lookup refuses changed workspace/permissions and read failure', async () => {
  const session = { uid: 'u', workspaceId: 'w', writable: true };
  let writes = 0;
  const base: InlineRecordAdapter = { session: () => session, read: async () => ({ workspaceId: 'w' }), update: async () => { writes += 1; } };
  const adapter = createAssetTagAdapter(base, async () => { session.workspaceId = 'other'; return []; });
  await assert.rejects(saveInlineRecordField(adapter, { collection: 'assets', id: 'own' }, 'assetTag', '', 'AT-1'), /Workspace/);
  session.workspaceId = 'w'; session.writable = false;
  await assert.rejects(saveInlineRecordField(adapter, { collection: 'assets', id: 'own' }, 'assetTag', '', 'AT-1'), /role/);
  session.writable = true;
  const offline = createAssetTagAdapter(base, async () => { throw new Error('offline'); });
  await assert.rejects(saveInlineRecordField(offline, { collection: 'assets', id: 'own' }, 'assetTag', '', 'AT-1'), /offline/);
  assert.equal(writes, 0);
});

test('inline tag editing refuses a real request-boundary duplicate and retains a working retry', async () => {
  setup();
  let duplicate = true;
  // the tag is a field of the asset, so it is `record.fields` now: one call, with the tag the row showed
  const writes: Array<{ input: { collection: string; id: string; fields: Record<string, unknown>; expected: Record<string, unknown> } }> = [];
  globalThis.fetch = (async (input, init) => {
    // the command goes out as a Request in some paths, so the URL is read from whichever shape arrived
    // a command's path is relative, so it is resolved against the page the way the browser would
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    if (url.pathname.endsWith('/assets') && url.searchParams.has('id')) return response({ id: asset.id, data: asset });
    if (url.pathname.endsWith('/assets')) return response([
      { id: asset.id, data: asset }, ...(duplicate ? [{ id: 'other', data: { workspaceId: asset.workspaceId, assetTag: 'at-0002', status: 'disposed' } }] : []),
    ]);
    if (url.pathname.endsWith('/commands/record.fields')) {
      writes.push(JSON.parse(String(init?.body)));
      return response({ ok: true, data: { collection: 'assets', id: asset.id, fields: ['assetTag'], updatedAt: '2026-01-02T00:00:00Z' } });
    }
    return response([]);
  }) as typeof fetch;
  render(<AssetInlineDetails asset={asset} />);
  fireEvent.click(screen.getByRole('button', { name: inlineEditName('Edit Tag of ציוד') }));
  fireEvent.change(screen.getByLabelText('Tag of ציוד'), { target: { value: 'AT-0002' } });
  fireEvent.keyDown(screen.getByLabelText('Tag of ציוד'), { key: 'Enter' });
  await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /already used/));
  assert.equal(writes.length, 0);
  assert.match(screen.getByRole('alert').textContent || '', /AT-0002/);
  duplicate = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry Tag of ציוד' })); });
  await waitFor(() => assert.equal(writes.length, 1));
  assert.deepEqual([writes[0].input.collection, writes[0].input.id], ['assets', asset.id]);
  assert.equal(writes[0].input.fields.assetTag, 'AT-0002');
  assert.deepEqual(Object.keys(writes[0].input.fields), ['assetTag'], 'the command stamps the timestamp, the tab does not');
  // this asset had no tag yet, so its expectation is "still untagged": a tag saved elsewhere meanwhile is a refusal
  assert.equal(writes[0].input.expected.assetTag, '', 'the row showed no tag, and the command compares that too');
  assert.equal(useLedgerStore.getState().assets[0].purchasePriceCents, 1200000);
});

test('refused maintenance save keeps the draft; retry and removal write only metadata', async () => {
  setup();
  let refuse = true;
  const writes: Array<{ p_set: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input).includes('/lf_update')) {
      writes.push(JSON.parse(String(init?.body)));
      if (refuse) return response({ code: '42501', message: 'Permission denied for asset note' }, 403);
    }
    return response([]);
  }) as typeof fetch;
  const view = render(<MaintenanceLog asset={asset} currency="USD" />);
  fireEvent.change(screen.getByLabelText('Day done'), { target: { value: '2026-09-15' } });
  fireEvent.change(screen.getByLabelText('What was done'), { target: { value: 'בדיקת ציוד' } });
  fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '120.25' } });
  fireEvent.change(screen.getByLabelText('By'), { target: { value: 'Dana' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Note it' })); });
  assert.match(screen.getByRole('alert').textContent || '', /Not saved.*Permission denied/);
  assert.equal((screen.getByLabelText('What was done') as HTMLInputElement).value, 'בדיקת ציוד');
  refuse = false;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Note it' })); });
  assert.equal((screen.getByLabelText('What was done') as HTMLInputElement).value, '');
  assert.deepEqual(Object.keys(writes.at(-1)!.p_set).sort(), ['maintenance', 'updatedAt']);
  const saved = writes.at(-1)!.p_set.maintenance as NonNullable<FixedAsset['maintenance']>;
  assert.equal(saved[0].description, 'בדיקת ציוד'); assert.equal(saved[0].costCents, 12025);
  view.rerender(<MaintenanceLog asset={{ ...asset, maintenance: saved }} currency="USD" />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove בדיקת ציוד on 2026-09-15' })); });
  assert.deepEqual(writes.at(-1)!.p_set.maintenance, asset.maintenance);
});

test('maintenance blocks double submits, rejects fractional-cent text and viewers cannot mutate', async () => {
  setup();
  let release: (value: Response) => void = () => {};
  let writes = 0;
  globalThis.fetch = (async input => {
    if (String(input).includes('/lf_update')) { writes += 1; return new Promise<Response>(resolve => { release = resolve; }); }
    return response([]);
  }) as typeof fetch;
  render(<MaintenanceLog asset={asset} currency="USD" />);
  fireEvent.change(screen.getByLabelText('What was done'), { target: { value: 'Service' } });
  fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '12.345' } });
  assert.equal((screen.getByRole('button', { name: 'Note it' }) as HTMLButtonElement).disabled, true);
  fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '12,34' } });
  const button = screen.getByRole('button', { name: 'Note it' });
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => assert.equal(writes, 1));
  await act(async () => { release(response([])); });
  assert.equal((screen.getByLabelText('What was done') as HTMLInputElement).value, '');
  cleanup(); setComponentWorkspace('viewer');
  render(<MaintenanceLog asset={asset} currency="USD" />);
  assert.equal(screen.queryByRole('button'), null);
  assert.equal(screen.queryByLabelText('What was done'), null);
});

test('permission loss with a pending maintenance save keeps the draft and does not strand the next retry', async () => {
  setup();
  let release: (value: Response) => void = () => {};
  let writes = 0;
  globalThis.fetch = (async input => {
    if (String(input).includes('/lf_update')) {
      writes += 1;
      return new Promise<Response>(resolve => { release = resolve; });
    }
    return response([]);
  }) as typeof fetch;
  const view = render(<MaintenanceLog asset={asset} currency="USD" />);
  fireEvent.change(screen.getByLabelText('What was done'), { target: { value: 'Service awaiting confirmation' } });
  fireEvent.click(screen.getByRole('button', { name: 'Note it' }));
  await waitFor(() => assert.equal(writes, 1));
  await act(async () => { setComponentWorkspace('viewer'); });
  await act(async () => { release(response([])); });
  assert.deepEqual(useLedgerStore.getState().assets[0].maintenance, asset.maintenance);
  await act(async () => { setComponentWorkspace('bookkeeper'); });
  assert.equal((screen.getByLabelText('What was done') as HTMLInputElement).value, 'Service awaiting confirmation');
  assert.equal(view.container.querySelector('fieldset')!.disabled, false);
  globalThis.fetch = (async () => response([])) as typeof fetch;
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Note it' })); });
  assert.equal((screen.getByLabelText('What was done') as HTMLInputElement).value, '');
});

test('workspace switch clears maintenance draft and ignores a late successful save', async () => {
  setup();
  let release: (value: Response) => void = () => {};
  globalThis.fetch = (async input => String(input).includes('/lf_update') ? new Promise<Response>(resolve => { release = resolve; }) : response([])) as typeof fetch;
  const view = render(<MaintenanceLog asset={asset} currency="USD" />);
  fireEvent.change(screen.getByLabelText('What was done'), { target: { value: 'Old workspace draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Note it' }));
  const workspace = useAuthStore.getState().getCurrentWorkspace()!;
  await act(async () => { useAuthStore.setState({ currentWorkspaceId: 'new', workspaces: [{ ...workspace, id: 'new' }] }); });
  view.rerender(<MaintenanceLog asset={{ ...asset, workspaceId: 'new' }} currency="USD" />);
  fireEvent.change(screen.getByLabelText('What was done'), { target: { value: 'New workspace draft' } });
  await act(async () => { release(response([])); });
  assert.equal((screen.getByLabelText('What was done') as HTMLInputElement).value, 'New workspace draft');
  assert.equal(screen.queryByRole('alert'), null);
});

test('maintenance files load on expansion and attach to the real assets collection', async () => {
  setup();
  const writes: Array<{ workspaceId: string; input: Record<string, unknown> }> = [];
  let reads = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes('/documents?')) reads += 1;
    if (url.includes('/commands/document.save')) writes.push(JSON.parse(String(init?.body)));
    return response([]);
  }) as typeof fetch;
  const view = render(<MaintenanceLog asset={asset} currency="USD" />);
  assert.equal(reads, 0);
  const details = view.container.querySelector('details')!;
  await act(async () => { details.open = true; fireEvent(details, new window.Event('toggle')); });
  await waitFor(() => assert.equal(reads, 1));
  const file = new window.File(['service'], 'receipt.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('Attach files to Asset maintenance: ציוד'), { target: { files: [file] } });
  await waitFor(() => assert.equal(writes.length, 1));
  // one command for the row: the collection, the record it hangs from and the workspace the file is filed into
  const [sent] = writes;
  assert.equal(sent.input.linkedCollection, 'assets');
  assert.equal(sent.input.linkedId, asset.id);
  assert.equal(sent.input.linkedLabel, 'Asset maintenance: ציוד');
  assert.equal(sent.workspaceId, asset.workspaceId);
  assert.equal('workspaceId' in sent.input, false, 'document.save stamps the workspace from the session');
});

test('labels retain QR support, add SVG Code 128 and purchase date, and isolate the print root', async () => {
  render(<AssetLabels assets={[{ ...asset, assetTag: 'AT-0001' }]} company="Demo Co" onClose={() => {}} />);
  assert.ok(screen.getByRole('img', { name: 'Code 128 barcode of AT-0001' }));
  assert.ok(screen.getByText('Bought 2026-01-01'));
  assert.equal(screen.getByRole('img', { name: 'Code 128 barcode of AT-0001' }).getAttribute('viewBox'), '0 0 132 44');
  assert.ok(document.querySelector('[data-print-root]'));
  await waitFor(() => assert.ok(screen.getByRole('img', { name: 'QR code of AT-0001' })));
  const outside = document.createElement('button');
  document.body.append(outside); outside.focus();
  assert.equal(document.activeElement, outside);
  fireEvent(window, new window.Event('afterprint'));
  assert.equal(document.activeElement, screen.getByRole('dialog'));
  outside.remove();
});
