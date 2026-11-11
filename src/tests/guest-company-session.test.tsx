import './helpers/dom';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { loadGuestCompany } from '../lib/guestCompany';
import { guestSession, guestReady, endGuestDatabase, startGuestDatabase, initializeGuestDatabase, writeGuestBatch, guestRows } from '../lib/db/guestDatabase';
import { workspaceActor } from '../lib/guestActor';
import { nextDocumentNumber } from '../services/documentNumbers';
import { setComponentWorkspace } from './helpers/componentFixtures';

const before = useAuthStore.getState();
afterEach(() => {
  useAuthStore.getState().setIsGuest(false);
  useAuthStore.setState(before);
  endGuestDatabase();
  localStorage.removeItem('isGuest');
  sessionStorage.clear();
  useLedgerStore.getState().resetStore();
});

test('sample year is complete, local actor is not an Auth User, and exit erases records and workspace', async () => {
  useAuthStore.setState({ user: null, isGuest: false, currentWorkspaceId: 'remembered-real-workspace' });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const state = useAuthStore.getState();
  assert.equal(state.user, null);
  assert.deepEqual(workspaceActor(state), { uid: 'owner-sample', email: null });
  assert.equal('getIdToken' in workspaceActor(state)!, false);
  assert.equal(state.currentWorkspaceId, 'guest');
  assert.equal(state.workspaces.length, 1);
  const invoices = useLedgerStore.getState().invoices;
  assert.equal(new Set(invoices.map(invoice => invoice.date?.slice(0, 7))).size, 12);
  assert.ok(useLedgerStore.getState().transactions.length > 100);
  assert.ok(useLedgerStore.getState().inventory.length > 0);
  const first = await nextDocumentNumber('guest', 'invoice');
  const second = await nextDocumentNumber('guest', 'invoice');
  assert.equal(first, 'SAMPLE-INVOICE-0001');
  assert.equal(second, 'SAMPLE-INVOICE-0002');
  assert.ok(sessionStorage.getItem('ledgerflow_sample_company_v1'));
  useAuthStore.getState().setIsGuest(false);
  assert.equal(guestReady(), false);
  assert.equal(sessionStorage.getItem('ledgerflow_sample_company_v1'), null);
  assert.equal(useLedgerStore.getState().invoices.length, 0);
  assert.equal(useAuthStore.getState().currentWorkspaceId, null);
  assert.equal(localStorage.getItem('ledgerflow_current_workspace'), null);
  assert.deepEqual(useAuthStore.getState().workspaces, []);
  assert.equal(workspaceActor(useAuthStore.getState()), null);
});

test('local saves restore after a tab refresh, storage failure does not publish success', () => {
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  writeGuestBatch([{ op: 'set', table: 'customers', id: 'test-persisted', data: { name: 'Persisted sample', workspaceId: 'guest' } }], guestSession()!);
  const stored = sessionStorage.getItem('ledgerflow_sample_company_v1')!;
  // Simulate a fresh JS context with the same tab's browser storage.
  endGuestDatabase();
  sessionStorage.setItem('ledgerflow_sample_company_v1', stored);
  startGuestDatabase();
  initializeGuestDatabase({});
  assert.equal(guestRows('customers').find(row => row.id === 'test-persisted')?.data.name, 'Persisted sample');
  const prototype = Object.getPrototypeOf(sessionStorage);
  const original = prototype.setItem;
  prototype.setItem = () => { throw new Error('Storage quota exceeded'); };
  try {
    assert.throws(() => writeGuestBatch([{ op: 'set', table: 'customers', id: 'not-persisted', data: { workspaceId: 'guest' } }], guestSession()!), /Storage quota/);
    assert.equal(guestRows('customers').some(row => row.id === 'not-persisted'), false);
  } finally { prototype.setItem = original; }
});

test('a real sign-in clears the demo first, never carries sample records or workspace into the account', () => {
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const sampleSession = guestSession()!;
  setComponentWorkspace();
  const realUser = useAuthStore.getState().user!;
  // Restore the demo state, then exercise the actual identity setter with the real fixture user.
  useAuthStore.setState({ user: null, isGuest: true, currentWorkspaceId: 'guest' });
  useAuthStore.getState().setUser(realUser);
  assert.equal(useAuthStore.getState().isGuest, false);
  assert.equal(useAuthStore.getState().user, realUser);
  assert.equal(guestSession(), null);
  assert.equal(useLedgerStore.getState().invoices.length, 0);
  assert.notEqual(useAuthStore.getState().currentWorkspaceId, 'guest');
  assert.throws(() => writeGuestBatch([], sampleSession), /sample company has closed/);
});

test('guest mode cannot be enabled over a signed-in account', () => {
  setComponentWorkspace();
  const user = useAuthStore.getState().user;
  useAuthStore.getState().setIsGuest(true);
  assert.equal(useAuthStore.getState().isGuest, false);
  assert.equal(localStorage.getItem('isGuest'), 'false');
  assert.equal(useAuthStore.getState().user, user);
  assert.equal(useAuthStore.getState().currentWorkspaceId, 'component-workspace');
  assert.equal(guestSession(), null);
});

test('sample labels use local create-only records and retain session identity', async () => {
  const { defaultDimensionNodeAdapter: adapter } = await import('../lib/dimensionNodeActions');
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const scope = adapter.session();
  assert.ok(scope?.canWriteNodes);
  assert.equal(scope.sampleSession, guestSession());
  const node = { id: 'trial', dimensionId: 'location', description: 'Trial location', status: 'active' as const };
  assert.equal(await adapter.createOnlyNode!('guest', node), 'created');
  assert.equal(await adapter.createOnlyNode!('guest', node), 'conflict');
  assert.equal((await adapter.readNode('guest', 'location', 'trial'))?.description, 'Trial location');
  useAuthStore.getState().setIsGuest(false);
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  assert.notEqual(adapter.session()?.sampleSession, scope.sampleSession);
  assert.equal(await adapter.readNode('guest', 'location', 'trial'), undefined);
});

test('external authenticated-store hydration also retires the local transport', () => {
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  assert.ok(guestSession());
  setComponentWorkspace();
  assert.equal(guestSession(), null);
  assert.equal(sessionStorage.getItem('ledgerflow_sample_company_v1'), null);
});

test('country sample picker/reset replaces the same saved copy used by forms, not just the visible cache', async () => {
  const { replaceGuestCompany } = await import('../lib/guestCompany');
  const { seedCountryDemoWorkspace, buildResetDemoWorkspace } = await import('../lib/countryDemoWorkspace');
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const israel = seedCountryDemoWorkspace('guest', 'IL');
  replaceGuestCompany(israel, israel.companyName);
  assert.equal(useAuthStore.getState().getCurrentWorkspace()?.currency, 'ILS');
  assert.equal(useLedgerStore.getState().inventory.length, 0, 'the old sample stock cannot refer to the new accounts');
  writeGuestBatch([{ op: 'set', table: 'customers', id: 'country-trial', data: { workspaceId: 'guest', name: 'Country trial' } }], guestSession()!);
  loadGuestCompany();
  assert.equal(useAuthStore.getState().getCurrentWorkspace()?.currency, 'ILS');
  assert.ok(useLedgerStore.getState().invoices.every(invoice => invoice.currency === 'ILS'));
  replaceGuestCompany(buildResetDemoWorkspace('guest', 'empty'), 'Empty sample');
  loadGuestCompany();
  assert.equal(useLedgerStore.getState().invoices.length, 0);
  assert.equal(guestRows('customers').length, 0);
});

test('sample inline and related-record metadata edits save locally, without a synthetic Auth User', async () => {
  const { recordDetailsAdapter } = await import('../lib/recordDetailsAdapter');
  const { loadRecordDetails, saveRecordDetails } = await import('../lib/recordDetails');
  const { inlineRecordAdapter } = await import('../lib/inlineRecordAdapter');
  const { saveInlineRecordField } = await import('../lib/inlineRecordFields');
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const customer = useLedgerStore.getState().customers[0];
  const target = { kind: 'customers' as const, id: customer.id };
  const baseline = await loadRecordDetails(recordDetailsAdapter, target);
  await saveRecordDetails(recordDetailsAdapter, target, baseline, { name: 'Locally renamed customer' });
  assert.equal((await loadRecordDetails(recordDetailsAdapter, target)).name, 'Locally renamed customer');
  const budget = useLedgerStore.getState().budgets[0];
  await saveInlineRecordField(inlineRecordAdapter, { collection: 'budgets', id: budget.id }, 'amountCents', budget.amountCents, 12345);
  assert.equal(guestRows('budgets').find(row => row.id === budget.id)?.data.amountCents, 12345);
  assert.equal(useAuthStore.getState().user, null);
  const oldScope = recordDetailsAdapter.session()!;
  useAuthStore.getState().setIsGuest(false);
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  assert.notEqual(recordDetailsAdapter.session()?.sampleSession, oldScope.sampleSession);
});

test('price lists save into the local sample with stable IDs and retain the normal validator', async () => {
  const { saveWorkspacePriceLists } = await import('../services/workspacePriceLists');
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const lists = await saveWorkspacePriceLists('guest', [{ name: 'Sample wholesale', discountPercent: 10 }]);
  assert.match(lists[0].id, /^pl_[a-z0-9]{6,20}$/);
  assert.deepEqual(guestRows('workspaces')[0].data.priceLists, lists);
  const updated = await saveWorkspacePriceLists('guest', [{ ...lists[0], name: 'Updated sample wholesale' }]);
  assert.equal(updated[0].id, lists[0].id);
  await assert.rejects(saveWorkspacePriceLists('guest', [{ name: 'Invalid discount', discountPercent: 150 }]), /percentage/);
  assert.deepEqual(guestRows('workspaces')[0].data.priceLists, updated);
  await assert.rejects(saveWorkspacePriceLists('real-workspace', []), /Only the sample/);
});

test('sample alert settings and invoice/bill workflow stages persist locally with validation', async () => {
  const { saveGuestAlerts, readGuestStages, saveGuestStages, moveGuestStage } = await import('../lib/guestSettings');
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const alerts = { closeReminderDay: 7, cashLowCents: 25000, budgetAlerts: false };
  saveGuestAlerts('guest', alerts);
  assert.deepEqual(guestRows('workspaces')[0].data.alerts, alerts);
  assert.throws(() => saveGuestAlerts('guest', { ...alerts, closeReminderDay: 40 }));
  saveGuestStages('guest', { invoice: ['Checked', 'Followed up'], bill: ['Received'] });
  const invoice = useLedgerStore.getState().invoices[0];
  moveGuestStage('guest', 'invoice', invoice.id, 'Checked');
  assert.equal(readGuestStages('guest', 'invoice').current[invoice.id], 'Checked');
  assert.throws(() => moveGuestStage('guest', 'invoice', invoice.id, 'Unknown'), /Choose/);
  assert.throws(() => moveGuestStage('guest', 'invoice', 'missing', 'Checked'), /not in/);
  moveGuestStage('guest', 'invoice', invoice.id, '');
  assert.equal(readGuestStages('guest', 'invoice').current[invoice.id], undefined);
  assert.throws(() => saveGuestStages('foreign', {}), /Only the sample/);
});

test('sample numbering Settings share counters with actual local document saves and refuse used numbers', async () => {
  const { readGuestNumbering, saveGuestNumbering } = await import('../lib/guestNumbering');
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  assert.equal(readGuestNumbering('guest').length, 6);
  saveGuestNumbering('guest', 'invoice', { prefix: 'DEMO-', nextNumber: 42, padding: 3 });
  assert.equal(await nextDocumentNumber('guest', 'invoice'), 'DEMO-042');
  writeGuestBatch([{ op: 'set', table: 'invoices', id: 'local-numbered-invoice', data: { workspaceId: 'guest', number: 'DEMO-042' } }], guestSession()!);
  assert.throws(() => saveGuestNumbering('guest', 'invoice', { prefix: 'DEMO-', nextNumber: 42, padding: 3 }), /already used/);
  assert.equal(await nextDocumentNumber('guest', 'invoice'), 'DEMO-043');
  assert.throws(() => saveGuestNumbering('guest', 'bill', { prefix: 'x', nextNumber: -1, padding: 99 }), /positive/);
});

test('an inline edit started in a discarded demo cannot write into a newly opened demo', async () => {
  const { inlineRecordAdapter } = await import('../lib/inlineRecordAdapter');
  const { saveInlineRecordField } = await import('../lib/inlineRecordFields');
  useAuthStore.setState({ user: null, isGuest: false });
  useAuthStore.getState().setIsGuest(true);
  loadGuestCompany();
  const budget = useLedgerStore.getState().budgets[0];
  let writes = 0;
  const switchedAdapter = {
    ...inlineRecordAdapter,
    read: async (target: Parameters<typeof inlineRecordAdapter.read>[0]) => {
      const record = await inlineRecordAdapter.read(target);
      useAuthStore.getState().setIsGuest(false);
      useAuthStore.getState().setIsGuest(true);
      loadGuestCompany();
      return record;
    },
    update: async () => { writes += 1; },
  };
  await assert.rejects(saveInlineRecordField(switchedAdapter, { collection: 'budgets', id: budget.id }, 'amountCents', budget.amountCents, 98765), /Workspace or permissions changed/);
  assert.equal(writes, 0);
  assert.notEqual(guestRows('budgets').find(row => row.id === budget.id)?.data.amountCents, 98765);
});
