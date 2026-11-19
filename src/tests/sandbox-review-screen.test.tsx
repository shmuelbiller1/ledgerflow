/**
 * SBX-1, the review screen: the step list as the server describes it, "the books with this applied"
 * through the sandbox's run_report tool, the conflict view, accept-selected with the server's revision,
 * and the two-step confirmation of a high-risk step (SANDBOX_HIGH_RISK_CONFIRM → the dialog → the
 * second call names the step as `confirmHighRisk`). The screen calculates nothing: every figure and
 * every state here is what the stubbed server answered.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SandboxReviewView from '../components/ledger/SandboxReviewView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import type { FetchCall } from './helpers/dom';
import { getSupabase } from '../lib/db/client';
import { getLocalDateISO } from '../lib/calendarDate';

const SANDBOX = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';
const S2 = '33333333-3333-4333-8333-333333333333';
const S3 = '44444444-4444-4444-8444-444444444444';

const step = (id: string, position: number, command: string, title: string, state = 'pending', extra: Record<string, unknown> = {}) => ({
  id, position, command, input: {}, recordIds: [], dependencies: [], state, failureReason: null, inverse: null,
  preview: { title, lines: [`${title} line`], effects: [], allocatedIds: {}, accounts: [{ accountId: 'ar', accountName: 'Accounts receivable', amountCents: 12000 }] }, ...extra,
});
const review = (steps: unknown[], outcome = 'review', revision = 'rev-1') => ({ id: SANDBOX, revision, steps, accepted: [], skipped: [], outcome });
const trialBalance = { accounts: [{ id: 'ar', name: 'Accounts receivable', code: '1200', type: 'asset', debit: 12000, credit: 0, netSigned: 12000 }], totalDebit: 12000, totalCredit: 12000, isBalanced: true };

/** A server that answers by route: the test chooses each answer, and sees every call. */
function stubServer(answers: Record<string, (call: FetchCall) => { status?: number; body: unknown }>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method || 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const key = `${call.method} ${call.url.replace(/^.*\/api\/v1/, '')}`;
    const answer = answers[key]?.(call) ?? { status: 404, body: { status: 'error', message: `No answer for ${key}` } };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

describe('Assistant drafts (SBX-1 review screen)', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('lists the steps as the server describes them, shows the books with the draft applied through the sandbox tool, and flags the conflicts', async () => {
    setComponentWorkspace('owner');
    const calls = stubServer({
      'GET /workspaces/component-workspace/sandboxes': () => ({ body: { sandboxes: [{ id: SANDBOX, createdAt: '2026-11-18T10:00:00Z', expiresAt: '2026-11-25T10:00:00Z', pendingSteps: 2 }] } }),
      [`GET /workspaces/component-workspace/sandboxes/${SANDBOX}`]: () => ({ body: review([
        step(S1, 1, 'customer.create', 'Create customer Acme'),
        step(S2, 2, 'invoice.create', 'Invoice Acme 120.00', 'needs-recheck'),
        step(S3, 3, 'payment.receive', 'Receive 120.00 from Acme', 'failed', { failureReason: 'The period is closed' }),
      ]) }),
      [`POST /workspaces/component-workspace/sandboxes/${SANDBOX}/tools/run_report`]: () => ({ body: trialBalance }),
    });
    render(<SandboxReviewView />);
    await waitFor(() => assert.ok(screen.getByText('Create customer Acme')));
    assert.ok(screen.getByText('Books changed: recheck'));
    assert.ok(screen.getByText('Could not be rebuilt'));
    assert.match(document.body.textContent || '', /The period is closed/);
    // the conflict view names the two unsettled steps and nothing else
    const conflicts = screen.getByText('Changed since review').parentElement!;
    assert.match(conflicts.textContent || '', /2\. Invoice Acme 120\.00/);
    assert.match(conflicts.textContent || '', /3\. Receive 120\.00 from Acme/);
    assert.doesNotMatch(conflicts.textContent || '', /Create customer Acme/);
    // the books with this applied: the trial balance from the sandbox's run_report, not a local sum
    await waitFor(() => assert.ok(screen.getByRole('table', { name: 'Trial balance with the draft applied' })));
    assert.match(screen.getByRole('table', { name: 'Trial balance with the draft applied' }).textContent || '', /1200 Accounts receivable.*\$120\.00/);
    const asked = calls.find(c => c.url.endsWith('/tools/run_report'));
    assert.deepEqual(asked?.body, { report: 'trial-balance', source: 'reports', params: { asOfDate: getLocalDateISO() } });
    assert.ok(calls.every(c => !c.url.includes('/api/v1/reports/')), 'the live report route is never asked: only the sandbox handle');
  });

  test('accept selected sends the revision and the chosen steps; a rechecked step is named as confirmed; the answer replaces the list', async () => {
    setComponentWorkspace('owner');
    const calls = stubServer({
      'GET /workspaces/component-workspace/sandboxes': () => ({ body: { sandboxes: [{ id: SANDBOX, createdAt: '2026-11-18T10:00:00Z', expiresAt: '2026-11-25T10:00:00Z', pendingSteps: 2 }] } }),
      [`GET /workspaces/component-workspace/sandboxes/${SANDBOX}`]: () => ({ body: review([step(S1, 1, 'customer.create', 'Create customer Acme'), step(S2, 2, 'invoice.create', 'Invoice Acme 120.00', 'needs-recheck')]) }),
      [`POST /workspaces/component-workspace/sandboxes/${SANDBOX}/tools/run_report`]: () => ({ body: trialBalance }),
      [`POST /workspaces/component-workspace/sandboxes/${SANDBOX}/accept`]: () => ({ body: review([step(S1, 1, 'customer.create', 'Create customer Acme', 'accepted', { inverse: { command: 'customer.archive', input: {} } }), step(S2, 2, 'invoice.create', 'Invoice Acme 120.00', 'accepted')], 'accepted', 'rev-2') }),
    });
    render(<SandboxReviewView />);
    await waitFor(() => assert.ok(screen.getByText('Invoice Acme 120.00')));
    fireEvent.click(screen.getByLabelText('Select Invoice Acme 120.00'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept selected (1)' })); });
    const accept = calls.find(c => c.url.endsWith('/accept'));
    assert.deepEqual(accept?.body, { revision: 'rev-1', stepIds: [S2], confirmRechecked: [S2] });
    await waitFor(() => assert.equal(screen.getAllByText('Accepted').length, 2));
    assert.ok(screen.getByRole('button', { name: /Undo/ }), 'an accepted step with an inverse offers Undo');
    assert.equal(screen.queryByRole('button', { name: 'Accept all ready steps' })?.hasAttribute('disabled'), true);
  });

  test('a high-risk step is asked about twice: the refusal opens the dialog, and confirming sends the step again as confirmHighRisk', async () => {
    setComponentWorkspace('owner');
    let accepts = 0;
    const calls = stubServer({
      'GET /workspaces/component-workspace/sandboxes': () => ({ body: { sandboxes: [{ id: SANDBOX, createdAt: '2026-11-18T10:00:00Z', expiresAt: '2026-11-25T10:00:00Z', pendingSteps: 1 }] } }),
      [`GET /workspaces/component-workspace/sandboxes/${SANDBOX}`]: () => ({ body: review([step(S1, 1, 'workspace.purge', 'Purge closed years')]) }),
      [`POST /workspaces/component-workspace/sandboxes/${SANDBOX}/tools/run_report`]: () => ({ body: trialBalance }),
      [`POST /workspaces/component-workspace/sandboxes/${SANDBOX}/accept`]: () => {
        accepts += 1;
        return accepts === 1
          ? { status: 409, body: { status: 'error', code: 'SANDBOX_HIGH_RISK_CONFIRM', message: 'Confirm "Purge closed years" to apply it', details: { stepId: S1, preview: { title: 'Purge closed years', lines: ['Deletes 3 closed years'], effects: [], allocatedIds: {} } } } }
          : { body: review([step(S1, 1, 'workspace.purge', 'Purge closed years', 'accepted')], 'accepted', 'rev-2') };
      },
    });
    render(<SandboxReviewView />);
    await waitFor(() => assert.ok(screen.getByText('Purge closed years')));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept' })); });
    const dialog = await screen.findByRole('alertdialog');
    assert.match(dialog.textContent || '', /This step is high-risk/);
    assert.match(dialog.textContent || '', /Deletes 3 closed years/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply this step' })); });
    const sent = calls.filter(c => c.url.endsWith('/accept')).map(c => c.body);
    assert.deepEqual(sent, [{ revision: 'rev-1', stepIds: [S1] }, { revision: 'rev-1', stepIds: [S1], confirmHighRisk: S1 }]);
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null));
    assert.ok(screen.getByText('Accepted'));
  });
});
