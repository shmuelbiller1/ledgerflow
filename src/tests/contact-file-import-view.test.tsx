import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ImportSettings from '../components/platform/settings/ImportSettings';
import { setComponentWorkspace, markComponentCollectionsLoaded } from './helpers/componentFixtures';
import { stubFetch } from './helpers/dom';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { auth } from '../firebase';
import { getSupabase } from '../lib/db/client';

/**
 * A-182 screen: choosing an address-book file in Settings → Import data.
 * A vCard and a Google Contacts CSV both land in the ordinary checked import, and the
 * duplicate check compares the rows with the customers already in the workspace.
 */

beforeEach(() => {
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('customers', 'vendors', 'inventory', 'accounts', 'transactions');
  useLedgerStore.setState({
    customers: [{ id: 'c1', uid: 'test-user', workspaceId: 'component-workspace', name: 'Acme Ltd', email: 'hello@acme.example', phone: '212-555-0100' }],
    vendors: [], inventory: [], accounts: [],
  } as never);
  stubFetch(200, {});
});
afterEach(async () => { cleanup(); auth.currentUser = null; await getSupabase().auth.dispose(); });

const upload = async (name: string, text: string) => {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [{ name, type: 'text/plain', text: async () => text }] } });
  });
};

const VCARD = [
  'BEGIN:VCARD',
  'FN:Acme Ltd',
  'EMAIL:accounts@acme.example',
  'END:VCARD',
  'BEGIN:VCARD',
  'FN:New Person',
  'EMAIL:new@example.com',
  'TEL:050-9998887',
  'END:VCARD',
].join('\r\n');

test('A-182 a vCard is read into the checked import and the exact-name duplicate is called out', async () => {
  render(<ImportSettings />);
  await upload('phone-contacts.vcf', VCARD);

  const status = await screen.findByRole('status');
  assert.match(status.textContent || '', /Address book read: 2 contacts/);
  // both rows are valid for the ordinary import…
  assert.match(document.body.textContent || '', /2 rows ready/);
  // …and the duplicate check says the Acme row will be skipped, naming the existing record
  const skipped = await screen.findByLabelText('Rows that will be skipped as duplicates');
  const lines = within(skipped).getAllByRole('listitem').map(item => item.textContent || '');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Row 2: “Acme Ltd” matches “Acme Ltd”/);
});

test('A-182 a Google Contacts CSV is recognised and a same-email different-name row is flagged', async () => {
  render(<ImportSettings />);
  const csv = [
    'Name,First Name,Last Name,E-mail 1 - Value,Phone 1 - Value,Organization 1 - Name',
    ',,,hello@acme.example,,Acme Holdings',
  ].join('\n');
  await upload('contacts.csv', csv);

  const status = await screen.findByRole('status');
  assert.match(status.textContent || '', /Address book read: 1 contact/);
  const possible = await screen.findByLabelText('Rows that look like existing contacts');
  const lines = within(possible).getAllByRole('listitem').map(item => item.textContent || '');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Row 2: “Acme Holdings” looks like “Acme Ltd” \(same email address\)/);
});

test('E-36/E-37 suggestions preserve contact values by default and require explicit acceptance', async () => {
  render(<ImportSettings />);
  const address = 'רחוב הרצל 10, תל אביב, מיקוד 61000';
  await upload('contacts.csv', [
    'Name,Email,Phone,Address',
    `Local Contact,USER@EXAMPLE.COM,052-123-4567,"${address}"`,
  ].join('\n'));

  fireEvent.change(screen.getByLabelText('Country for local phone numbers'), { target: { value: 'IL' } });
  fireEvent.click(screen.getByLabelText('Suggest Israeli address parts (preview only)'));
  assert.ok(screen.getByText('Street suggestion'));
  assert.ok(screen.getAllByText('תל אביב').length > 0);

  const preview = screen.getByRole('table', { name: 'First rows to import' });
  const previewValues = () => within(within(preview).getAllByRole('row')[1]).getAllByRole('cell').map(cell => cell.textContent);
  assert.equal(previewValues()[2], 'USER@EXAMPLE.COM', 'email source stays uppercase until explicitly accepted');
  assert.equal(previewValues()[3], '052-123-4567', 'phone source stays local until explicitly accepted');
  assert.equal(previewValues()[4], address, 'street/city/postal suggestions do not replace the original free-text address');

  let posted: { kind: string; rows: Array<Record<string, string>>; dryRun: boolean } | undefined;
  auth.currentUser = useAuthStore.getState().user;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/import-records')) {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ created: 1, skipped: [], openingStockCents: 0, dryRun: true, batchId: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  fireEvent.click(screen.getByRole('button', { name: 'Check against existing customers' }));
  await screen.findByText(/Check: 1 new customers will be added/);
  assert.equal(posted?.kind, 'customers');
  assert.equal(posted?.dryRun, true);
  assert.equal(posted?.rows[0].email, 'USER@EXAMPLE.COM', 'default dry-run sends source email unchanged');
  assert.equal(posted?.rows[0].phone, '052-123-4567', 'default dry-run sends source phone unchanged');
  assert.equal(posted?.rows[0].address, address);

  fireEvent.click(screen.getByLabelText(/Apply 1 suggested email cleanup/));
  assert.equal(previewValues()[2], 'user@example.com');
  assert.equal(previewValues()[3], '052-123-4567', 'accepting email suggestions does not accept phone suggestions');
  fireEvent.click(screen.getByLabelText(/Apply 1 suggested phone cleanup/));
  assert.equal(previewValues()[3], '+972521234567');
  assert.equal(previewValues()[4], address);

  fireEvent.click(screen.getByRole('button', { name: 'Check against existing customers' }));
  await screen.findByText(/Check: 1 new customers will be added/);
  assert.equal(posted?.rows[0].email, 'user@example.com', 'accepted email suggestion is sent to dry-run');
  assert.equal(posted?.rows[0].phone, '+972521234567', 'accepted phone suggestion is sent to dry-run');
  assert.equal(posted?.rows[0].address, address);
});

test('A-182 an address book cannot be switched to items mid-import', async () => {
  render(<ImportSettings />);
  await upload('phone-contacts.vcf', VCARD);
  await screen.findByRole('status');
  const itemsButton = screen.getAllByRole('button').find(button => button.textContent?.startsWith('Items'));
  assert.ok(itemsButton, 'the Items type button is on the screen');
  fireEvent.click(itemsButton);
  // still on customers with the contacts import intact (an error toast explains why)
  assert.match(screen.getByRole('status').textContent || '', /Address book read: 2 contacts/);
  assert.match(document.body.textContent || '', /2 rows ready/);
});

test('duplicate check warns when the customer list is capped instead of claiming no matches', async () => {
  useLedgerStore.setState({ customers: [], truncatedCollections: { customers: true } });
  render(<ImportSettings />);
  await upload('contacts.csv', 'Name,Email\nNew Company,new@example.com');
  assert.match(document.body.textContent || '', /existing contact list is incomplete or failed to load/i);
  assert.doesNotMatch(document.body.textContent || '', /No matches were found in the loaded customer list/);
});


test('duplicate check warns on a failed customer subscription even after an earlier load', async () => {
  useDataNeedsStore.getState().markFailed('customers', 'Connection lost');
  useLedgerStore.setState({ customers: [], truncatedCollections: {} });
  render(<ImportSettings />);
  await upload('contacts.csv', 'Name,Email\nNew Company,new@example.com');
  assert.match(document.body.textContent || '', /existing contact list is incomplete or failed to load/i);
  assert.doesNotMatch(document.body.textContent || '', /No matches were found in the loaded customer list/);
});

test('duplicate check warns if the candidate matcher omits a large shared-email group', async () => {
  useLedgerStore.setState({ customers: Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`, uid: 'test-user', workspaceId: 'component-workspace', name: `Company ${i}`, email: 'shared@example.com',
  })), truncatedCollections: {} } as never);
  render(<ImportSettings />);
  await upload('contacts.csv', 'Name,Email\nNew Company,shared@example.com');
  assert.match(document.body.textContent || '', /potential matches were omitted/i);
  assert.doesNotMatch(document.body.textContent || '', /No matches were found in the loaded customer list/);
});

test('an unreadable replacement removes the previous file rather than letting it import', async () => {
  render(<ImportSettings />);
  await upload('previous.csv', 'Name,Email\nPrevious Company,previous@example.com');
  assert.ok(screen.getByRole('button', { name: 'Import 1 customers' }));

  await upload('broken.csv', 'Name,Email\n"Unclosed');
  assert.ok(!screen.queryByText(/previous\.csv/));
  assert.ok(!screen.queryByRole('table', { name: 'First rows to import' }));
  assert.ok(!screen.queryByRole('button', { name: 'Import 1 customers' }));
  assert.match(screen.getByRole('alert').textContent || '', /broken\.csv.*could not be read/i);
});

test('the last selected file wins even when a previous read finishes later', async () => {
  render(<ImportSettings />);
  const older = Promise.withResolvers<string>();
  fireEvent.change(screen.getByLabelText(/choose the file/i), {
    target: { files: [{ name: 'first.csv', text: () => older.promise }] },
  });
  await upload('second.csv', 'Name,Email\nSecond Company,second@example.com');
  assert.match(screen.getByRole('table', { name: 'First rows to import' }).textContent || '', /Second Company/);

  await act(async () => older.resolve('Name,Email\nFirst Company,first@example.com'));
  assert.match(screen.getByRole('table', { name: 'First rows to import' }).textContent || '', /Second Company/);
  assert.ok(!screen.queryByText(/first\.csv/));
});

test('the dry run keeps the checked file and mapping unchanged until its answer arrives', { timeout: 5000 }, async () => {
  const waiting = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const checks: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith('/import-records')) return Response.json({});
    checks.push(JSON.parse(String(init?.body)));
    started.resolve();
    return waiting.promise;
  };
  render(<ImportSettings />);
  await upload('customers.csv', 'Name,Email\nNew Company,new@example.com');
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Check against existing customers' }));
    await started.promise;
    const file = screen.getByLabelText(/choose the file/i) as HTMLInputElement;
    const source = screen.getByRole('combobox', { name: 'CSV source' }) as HTMLSelectElement;
    const mapping = screen.getByLabelText(/^name/i) as HTMLSelectElement;
    const vendorButton = screen.getByRole('button', { name: /^Vendors/ });
    for (const control of [file, source, mapping, vendorButton]) assert.ok(control.matches(':disabled'), control.outerHTML);
    assert.deepEqual(checks, [{ kind: 'customers', rows: [{ name: 'New Company', email: 'new@example.com' }], dryRun: true }]);
  } finally {
    await act(async () => waiting.resolve(Response.json({ created: 1, skipped: [], openingStockCents: 0, dryRun: true, batchId: null })));
  }
  assert.match(document.body.textContent || '', /Check: 1 new customers will be added/);
  assert.equal(screen.getByLabelText(/choose the file/i).matches(':disabled'), false);
});

test('switching books clears the draft and drops an old dry-run reply', { timeout: 5000 }, async () => {
  const previousWorkspace = useAuthStore.getState().getCurrentWorkspace();
  assert.ok(previousWorkspace);
  const other = { ...previousWorkspace, id: 'other-import-book' };
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  globalThis.fetch = async input => {
    if (!String(input).endsWith('/import-records')) return Response.json({});
    assert.match(String(input), /component-workspace\/import-records$/);
    started.resolve();
    return pending.promise;
  };
  render(<ImportSettings />);
  await upload('old-book.csv', 'Name,Email\nPrevious Company,previous@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Check against existing customers' }));
  await started.promise;
  await act(async () => useAuthStore.setState({ currentWorkspaceId: other.id, workspaces: [previousWorkspace, other] }));
  await act(async () => pending.resolve(Response.json({ created: 1, skipped: [], openingStockCents: 0, dryRun: true, batchId: null })));
  assert.ok(!screen.queryByText(/old-book\.csv/));
  assert.ok(!screen.queryByRole('table', { name: 'First rows to import' }));
  assert.doesNotMatch(document.body.textContent || '', /Check: 1 new customers will be added/);
});

for (const { name, contents } of [
  { name: 'book.vcf', contents: VCARD },
  { name: 'google.csv', contents: 'Name,First Name,Last Name,E-mail 1 - Value\nNew Contact,,,owner@example.com' },
  { name: 'customers.iif', contents: '!CUST\tNAME\nCUST\tNew Contact\n!VEND\tNAME\nVEND\tSupply Co' },
]) {
  test(`successful import consumes the ${name} preview and preserves the result`, async () => {
    let submitted = 0;
    globalThis.fetch = async (input, init) => {
      if (!String(input).endsWith('/import-records')) return Response.json({});
      const request = JSON.parse(String(init?.body));
      assert.equal(request.dryRun, false);
      submitted = request.rows.length;
      return Response.json({ created: submitted, skipped: [], openingStockCents: 0, dryRun: false, batchId: 'imp_complete' });
    };
    render(<ImportSettings />);
    await upload(name, contents);
    fireEvent.click(screen.getByRole('button', { name: /^Import \d+ customers/ }));
    assert.ok(await screen.findByRole('button', { name: 'Undo this import' }));
    assert.ok(submitted > 0);
    assert.ok(!screen.queryByRole('table', { name: 'First rows to import' }));
    assert.ok(!screen.queryByRole('button', { name: /^Import \d+ customers/ }));
    if (name.endsWith('.iif')) {
      fireEvent.click(screen.getByRole('button', { name: /^Vendors/ }));
      assert.match(screen.getByRole('table', { name: 'First rows to import' }).textContent || '', /Supply Co/);
      assert.ok(screen.getByRole('button', { name: 'Import 1 vendors' }));
    }
  });
}

test('customer duplicate review only waits for the customer collection', async () => {
  markComponentCollectionsLoaded('customers');
  render(<ImportSettings />);
  await upload('customers.csv', 'Name,Email\nAcme Holdings,hello@acme.example');
  assert.match(screen.getByLabelText('Rows that look like existing contacts').textContent || '', /Acme Ltd/);
  assert.doesNotMatch(document.body.textContent || '', /Still loading your existing customers/);
});

test('the review does not promise an existing customer will be imported', async () => {
  globalThis.fetch = async input => String(input).endsWith('/import-records')
    ? Response.json({ created: 1, skipped: [{ row: 2, message: 'Acme Ltd already exists' }], openingStockCents: 0, dryRun: true, batchId: null })
    : Response.json({});
  render(<ImportSettings />);
  await upload('customers.csv', 'Name,Email\nAcme Ltd,hello@acme.example\nNew Company,new@example.com');
  const table = screen.getByRole('table', { name: 'First rows to import' });
  assert.doesNotMatch(within(table).getByRole('row', { name: /Acme Ltd/ }).textContent || '', /Will be imported/);
  fireEvent.click(screen.getByRole('button', { name: 'Check against existing customers' }));
  assert.ok(await within(table).findByText('Skipped in check: Acme Ltd already exists'));
  assert.match(within(table).getByRole('row', { name: /New Company/ }).textContent || '', /Ready to import/);
});

test('a different bookkeeper in the same workspace does not inherit a pending file', async () => {
  const { user, workspaces } = useAuthStore.getState();
  assert.ok(user);
  const workspace = workspaces[0];
  const nextUser = { ...user, uid: 'replacement-bookkeeper' };
  const read = Promise.withResolvers<string>();
  render(<React.StrictMode><ImportSettings /></React.StrictMode>);
  fireEvent.change(screen.getByLabelText(/choose the file/i), {
    target: { files: [{ name: 'pending.csv', text: () => read.promise }] },
  });
  assert.match(screen.getByRole('status').textContent || '', /Reading pending.csv/);
  await act(async () => useAuthStore.setState({ user: nextUser, workspaces: [{ ...workspace, roles: { [nextUser.uid]: 'bookkeeper' } }] }));
  await act(async () => read.resolve('Name,Email\nPrior Company,prior@example.com'));
  assert.ok(!screen.queryByText(/pending\.csv/));
  assert.ok(!screen.queryByRole('table', { name: 'First rows to import' }));
  assert.ok(screen.getByLabelText(/choose the file/i));
});

test('Excel text is preserved rather than treated as an escaped CSV export', async () => {
  const { createWorkbook } = await import('../lib/excelExport');
  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet('Contacts');
  sheet.addRows([['Name', 'Notes'], ['New Company', "'-call first"]]);
  const binary = Uint8Array.from(Buffer.from(await workbook.xlsx.writeBuffer())).buffer;
  let submitted: unknown;
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith('/import-records')) return Response.json({});
    submitted = JSON.parse(String(init?.body));
    return Response.json({ created: 1, skipped: [], openingStockCents: 0, dryRun: false, batchId: 'imp_excel' });
  };
  render(<ImportSettings />);
  fireEvent.change(screen.getByLabelText(/choose the file/i), {
    target: { files: [{ name: 'contacts.xlsx', arrayBuffer: async () => binary }] },
  });
  const preview = await screen.findByRole('table', { name: 'First rows to import' });
  assert.ok(within(preview).queryByText("'-call first"), 'the literal apostrophe remains in the preview');
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 customers' }));
  await screen.findByRole('button', { name: 'Undo this import' });
  assert.deepEqual(submitted, { kind: 'customers', rows: [{ name: 'New Company', notes: "'-call first" }], dryRun: false });
});
