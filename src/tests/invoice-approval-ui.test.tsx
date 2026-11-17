/**
 * Invoice approval on the screens (BE-04): the rule in Settings → Emails & Reminders, the line under
 * an invoice in the list, and the notice in the invoice's Email dialog. What the rule *means* is
 * tested in invoice-approval.test.ts; here it is about what a person can see and press, and about
 * the exact fields that reach the database.
 */
import { stubFetch, stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailSettings from '../components/platform/settings/EmailSettings';
import InvoiceApprovalFlag from '../components/sales/InvoiceApprovalFlag';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';
import type { InvoiceApprovalSettings } from '../lib/invoiceApproval';

// the save goes through the supabase client, whose auth timers keep node alive after the last test
afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

const LIMIT = 100000;
const rule: InvoiceApprovalSettings = { enabled: true, thresholdCents: LIMIT };

/** The signed-in role, with the approval rule switched on in that workspace. */
function roleWithRule(role: 'owner' | 'accountant' | 'bookkeeper' | 'viewer') {
  const workspace = setComponentWorkspace(role);
  useAuthStore.setState({ workspaces: [useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, invoiceApproval: rule } : w))[0]] });
  return workspace;
}

/** The workspace in the store, with a field written into it (the screens read the store, not a server). */
function setWorkspaceField(patch: Record<string, unknown>) {
  const state = useAuthStore.getState();
  const current = state.getCurrentWorkspace();
  if (!current) throw new Error('test setup: no workspace');
  useAuthStore.setState({ workspaces: state.workspaces.map(w => (w.id === current.id ? { ...w, ...patch } : w)) });
}

describe('the approval rule in the settings', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    stubFetch(200, {});
  });


  test('an empty rule reads as off and shows nothing in the box', () => {
    render(<EmailSettings />);
    assert.equal((screen.getByLabelText('Require approval on invoices over a set amount') as HTMLInputElement).checked, false);
    assert.equal((screen.getByLabelText(/The amount, in/) as HTMLInputElement).value, '');
    assert.match(screen.getByText(/Turn this on and name an amount/).textContent || '', /leaving the amount empty keeps it off/);
  });

  test('a saved rule comes back with its amount as money a person typed', () => {
    setWorkspaceField({ invoiceApproval: rule });
    render(<EmailSettings />);
    assert.equal((screen.getByLabelText('Require approval on invoices over a set amount') as HTMLInputElement).checked, true);
    assert.equal((screen.getByLabelText(/The amount, in/) as HTMLInputElement).value, '1000');
    assert.match(screen.getByText(/wait for a signature/).textContent || '', /\$1,000\.00/, 'the limit shown is the money, not the cents');
  });

  test('the amount box is only open while the rule is on', () => {
    setWorkspaceField({ invoiceApproval: { enabled: false, thresholdCents: LIMIT } });
    render(<EmailSettings />);
    assert.equal((screen.getByLabelText(/The amount, in/) as HTMLInputElement).disabled, true);
    fireEvent.click(screen.getByLabelText('Require approval on invoices over a set amount'));
    assert.equal((screen.getByLabelText(/The amount, in/) as HTMLInputElement).disabled, false);
  });

  test('saving writes the rule and nothing else on the workspace', async () => {
    const calls = stubFetchWithBodies(200, {});
    render(<EmailSettings />);
    fireEvent.click(screen.getByLabelText('Require approval on invoices over a set amount'));
    fireEvent.change(screen.getByLabelText(/The amount, in/), { target: { value: '2,500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save approval rule' }));
    // the settings row is a command now: what reaches the server is `input.invoiceApproval` and nothing else
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/commands/workspace.settings')), 'the save reached the server'));
    const body = calls.find(c => c.url.includes('/commands/workspace.settings'))?.body as
      { workspaceId?: string; input?: Record<string, unknown> };
    assert.equal(body.workspaceId, 'component-workspace');
    assert.deepEqual(Object.keys(body.input || {}), ['invoiceApproval'], 'no other field of the workspace is touched');
    assert.deepEqual(body.input?.invoiceApproval, { enabled: true, thresholdCents: 250000 });
    assert.equal(useAuthStore.getState().getCurrentWorkspace()?.invoiceApproval?.thresholdCents, 250000, 'the screen shows what was just saved');
  });

  test('a limit that is not an amount leaves the rule off instead of guessing one', async () => {
    setWorkspaceField({ invoiceApproval: rule });
    const calls = stubFetchWithBodies(200, {});
    render(<EmailSettings />);
    fireEvent.change(screen.getByLabelText(/The amount, in/), { target: { value: 'soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save approval rule' }));
    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/commands/workspace.settings'))));
    const body = calls.find(c => c.url.includes('/commands/workspace.settings'))?.body as
      { input?: { invoiceApproval?: InvoiceApprovalSettings } };
    assert.deepEqual(body.input?.invoiceApproval, { enabled: false, thresholdCents: 0 });
    assert.equal(useAuthStore.getState().getCurrentWorkspace()?.invoiceApproval?.enabled, false, 'and the box says so straight away');
  });

  test('a viewer reads the rule but cannot change it', () => {
    setComponentWorkspace('viewer');
    setWorkspaceField({ invoiceApproval: rule });
    render(<EmailSettings />);
    assert.equal(screen.queryByRole('button', { name: 'Save approval rule' }), null);
    assert.ok(screen.getByLabelText('Require approval on invoices over a set amount'));
    assert.equal((screen.getByLabelText('Require approval on invoices over a set amount') as HTMLInputElement).disabled, true);
    assert.equal((screen.getByLabelText(/The amount, in/) as HTMLInputElement).disabled, true);
    // the same sentence the automatic-emails section says: both blocks belong to the same two roles
    assert.equal(screen.getAllByText('Owners and accountants change these settings.').length, 2);
  });
});

describe('the line under an invoice in the list', () => {


  const decide = () => { /* the buttons are the subject, not what they do */ };

  test('an invoice waiting for a signature says so, and only an approver is offered the buttons', () => {
    render(<InvoiceApprovalFlag invoice={{ number: 'INV-7', amountCents: 150000, status: 'pending' }} settings={rule} currency="USD" canDecide={false} onDecide={decide} />);
    assert.match(screen.getByText('Waiting for approval').textContent || '', /Waiting/);
    assert.match(screen.getByText('Waiting for approval').getAttribute('title') || '', /over the \$1,000\.00 limit/);
    assert.equal(screen.queryByRole('button', { name: 'Approve' }), null);
    assert.equal(screen.queryByRole('button', { name: /Send back/ }), null);
  });

  test('an approver is offered both decisions, and each says which one it is', () => {
    const seen: string[] = [];
    render(<InvoiceApprovalFlag invoice={{ number: 'INV-7', amountCents: 150000, status: 'pending' }} settings={rule} currency="USD" canDecide onDecide={d => seen.push(d)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    assert.deepEqual(seen, ['approved', 'rejected'], 'the list buttons are the decision, and the second one asks for a reason');
    assert.match(screen.getByRole('button', { name: 'Approve' }).getAttribute('title') || '', /INV-7/);
  });

  test('nothing is shown for an invoice under the limit, an approved one, or a workspace with no rule', () => {
    const { container } = render(
      <div>
        <InvoiceApprovalFlag invoice={{ amountCents: 50000, status: 'pending' }} settings={rule} canDecide onDecide={decide} />
        <InvoiceApprovalFlag invoice={{ amountCents: 150000, status: 'pending', approval: { state: 'approved', thresholdCents: LIMIT } }} settings={rule} canDecide onDecide={decide} />
        <InvoiceApprovalFlag invoice={{ amountCents: 150000, status: 'pending' }} settings={{ enabled: false, thresholdCents: 0 }} canDecide onDecide={decide} />
        <InvoiceApprovalFlag invoice={{ amountCents: 150000, status: 'draft' }} settings={rule} canDecide onDecide={decide} />
      </div>
    );
    assert.equal(container.textContent, '', 'a quiet list is the point: only what is held back is marked');
  });

  test('a sent-back invoice shows the reason, without a person having to hover', () => {
    render(<InvoiceApprovalFlag invoice={{ number: 'INV-7', amountCents: 150000, status: 'pending', approval: { state: 'rejected', thresholdCents: LIMIT, note: 'the tax code on line 2' } }} settings={rule} currency="USD" canDecide onDecide={decide} />);
    assert.ok(screen.getByText('Sent back'));
    assert.match(screen.getByText('Sent back').getAttribute('title') || '', /the tax code on line 2/);
  });
});

describe('the invoice Email dialog', () => {
  beforeEach(() => {
    roleWithRule('accountant');
    stubFetch(404, { events: [] });
  });


  test('it says the invoice is being held, and for an accountant the button approves as it sends', async () => {
    const { default: InvoiceEmailDialog } = await import('../components/sales/InvoiceEmailDialog');
    const { useLedgerStore } = await import('../stores/useLedgerStore');
    useLedgerStore.setState({ customers: [] });
    render(<InvoiceEmailDialog invoice={{ id: 'i1', uid: 'u1', workspaceId: 'component-workspace', number: 'INV-8', amountCents: 150000, status: 'pending', metadata: { sentTo: 'ap@acme.test' } } as never} onClose={() => {}} />);
    assert.match(screen.getByText(/Waiting for an owner or an accountant/).textContent || '', /\$1,000\.00/);
    assert.ok(screen.getByRole('button', { name: 'Approve and send' }));
  });

  test('a bookkeeper is told who has to release it', async () => {
    roleWithRule('bookkeeper');
    const { default: InvoiceEmailDialog } = await import('../components/sales/InvoiceEmailDialog');
    const { useLedgerStore } = await import('../stores/useLedgerStore');
    useLedgerStore.setState({ customers: [] });
    render(<InvoiceEmailDialog invoice={{ id: 'i2', uid: 'u1', workspaceId: 'component-workspace', number: 'INV-9', amountCents: 150000, status: 'pending', metadata: { sentTo: 'ap@acme.test' } } as never} onClose={() => {}} />);
    assert.match(screen.getByText(/Waiting for an owner or an accountant/).textContent || '', /approves it from the invoice list/);
    assert.ok(screen.getByRole('button', { name: 'Send' }), 'the button is not taken away; the server is the one that refuses, and it explains');
  });

  test('an invoice under the limit gets no notice at all', async () => {
    roleWithRule('accountant');
    stubFetch(404, { events: [] });
    const { default: InvoiceEmailDialog } = await import('../components/sales/InvoiceEmailDialog');
    const { useLedgerStore } = await import('../stores/useLedgerStore');
    useLedgerStore.setState({ customers: [] });
    render(<InvoiceEmailDialog invoice={{ id: 'i3', uid: 'u1', workspaceId: 'component-workspace', number: 'INV-10', amountCents: 50000, status: 'pending' } as never} onClose={() => {}} />);
    assert.equal(screen.queryByText(/Waiting for an owner/), null);
  });
});
