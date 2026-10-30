/**
 * A-259: every dialog a busy-screen row opens obeys the shared keyboard contract — focus moves into
 * it, Escape closes it, and focus returns to the button that opened it. Six dialogs announced
 * `role="dialog"` but never wired the keyboard behaviour (`useDialog`): Make deposit (Banking),
 * Spread (Sales/Purchases rows), Apply/refund credit (credit notes), Pay/Split a bank line
 * (Reconciliation), Email invoice (Sales row) and Add a fixed asset. Each now uses `useDialog`;
 * these tests pin the contract per dialog, plus a source guard that row actions hidden until hover
 * (`opacity-0 … group-hover:opacity-100`) also appear on keyboard focus
 * (`group-focus-within:opacity-100`) — a hover-only button is invisible to a keyboard user even
 * while it holds focus, because the hidden ancestor hides the focus ring too.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import MakeDepositDialog from '../components/banking/MakeDepositDialog';
import SpreadDialog from '../components/common/SpreadDialog';
import CreditActionDialog from '../components/finance/CreditActionDialog';
import BankLineActionDialog from '../components/ledger/BankLineActionDialog';
import InvoiceEmailDialog from '../components/sales/InvoiceEmailDialog';
import FixedAssetsView from '../components/assets/FixedAssetsView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeInvoice } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { Invoice } from '../types';

const accounts = [
  makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' }),
  makeChartAccount({ id: 'sales', code: '4000', name: 'Subscriptions', type: 'income', category: 'Revenue' }),
  makeChartAccount({ id: 'def', code: '2400', name: 'Deferred Revenue', type: 'liability', category: 'Current Liabilities' }),
  makeChartAccount({ id: 'ar', code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
];

/** Focus the opener, open the dialog from it, Escape, and require focus back on the opener. */
function Opener({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>{label}</button>
      {open && children(() => setOpen(false))}
    </>
  );
}

async function openEscapeAndCheckReturn(openerName: string, dialogName: string | RegExp) {
  const opener = screen.getByRole('button', { name: openerName });
  opener.focus();
  assert.equal(document.activeElement, opener, 'the opener holds focus before the dialog opens');
  await act(async () => { fireEvent.click(opener); });
  const dialog = screen.getByRole('dialog', { name: dialogName });
  assert.ok(dialog.contains(document.activeElement) || document.activeElement === dialog,
    `focus moved into the ${String(dialogName)} dialog (active: ${(document.activeElement as HTMLElement)?.tagName})`);
  await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
  assert.equal(screen.queryByRole('dialog', { name: dialogName }), null, 'Escape closed the dialog');
  assert.equal(document.activeElement, opener, 'focus returned to the button that opened the dialog');
}

beforeEach(() => {
  setComponentWorkspace('owner');
  markComponentCollectionsLoaded('accounts', 'payments', 'invoices', 'bills', 'customers', 'assets');
  useLedgerStore.setState({ accounts, payments: [], invoices: [], bills: [], customers: [], assets: [] } as never);
  stubFetchWithBodies(200, { events: [] });
});
afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

describe('A-259: the six dialogs that announced a dialog but had no keyboard behaviour', () => {
  test('Banking → Make deposit: focus in, Escape closes, focus returns', async () => {
    render(<Opener label="Make deposit opener">{close => <MakeDepositDialog onClose={close} />}</Opener>);
    await openEscapeAndCheckReturn('Make deposit opener', 'Make deposit');
  });

  test('Reconciliation → Split this bank line: focus in, Escape closes, focus returns', async () => {
    const target = { mode: 'split' as const, line: { id: 'bl1', date: '2026-09-03', description: 'ACME SUPPLIES', amountCents: -42000, accountId: 'bank' } };
    render(<Opener label="Split opener">{close => <BankLineActionDialog target={target} onClose={close} />}</Opener>);
    await openEscapeAndCheckReturn('Split opener', 'Split this bank line');
  });

  test('Credit notes → Apply CN-1: focus in, Escape closes, focus returns', async () => {
    const target = { kind: 'customer' as const, mode: 'apply' as const, id: 'cn1', number: 'CN-1', partyId: 'c1', partyName: 'Acme', remainingCents: 5000, currency: 'USD' };
    render(<Opener label="Apply opener">{close => <CreditActionDialog target={target} onClose={close} />}</Opener>);
    await openEscapeAndCheckReturn('Apply opener', 'Apply CN-1');
  });

  test('Sales/Purchases rows → Spread over months: focus in, Escape closes, focus returns', async () => {
    const invoice = {
      id: 'i1', uid: 'test-user', workspaceId: 'component-workspace', customerId: 'c1', customerName: 'Acme', number: 'INV-9',
      amountCents: 13200, status: 'sent', date: '2026-09-15', dueDate: '2026-10-15', currency: 'USD',
      items: [{ id: 'l1', description: 'Annual plan', quantity: 1, rateCents: 12000, amountCents: 12000, accountId: '' }],
    } as Invoice;
    render(<Opener label="Spread opener">{close => <SpreadDialog kind="invoice" document={invoice} onClose={close} />}</Opener>);
    await openEscapeAndCheckReturn('Spread opener', 'Spread over months');
  });

  test('Sales row → Email invoice: focus in, Escape closes, focus returns', async () => {
    const invoice = makeInvoice({ id: 'i9', number: 'INV-9', customerId: 'c1', status: 'sent' });
    render(<Opener label="Email opener">{close => <InvoiceEmailDialog invoice={invoice} onClose={close} />}</Opener>);
    await openEscapeAndCheckReturn('Email opener', /Email invoice INV-9/);
  });

  test('Fixed assets → Add a fixed asset: Escape closes the inline dialog', async () => {
    render(<FixedAssetsView />);
    const opener = screen.getByRole('button', { name: 'Add your first asset' });
    opener.focus();
    await act(async () => { fireEvent.click(opener); });
    const dialog = screen.getByRole('dialog', { name: 'Add a fixed asset' });
    assert.ok(dialog.contains(document.activeElement) || document.activeElement === dialog, 'focus moved into the add-asset dialog');
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    assert.equal(screen.queryByRole('dialog', { name: 'Add a fixed asset' }), null, 'Escape closed the add-asset dialog');
  });
});

describe('A-259: hover-only row actions also appear for keyboard focus', () => {
  // Non-interactive decorations that may stay hover-only: the Vault card sheen, the Copilot and
  // P&L drill icons, a chart tooltip, a drag grip, the cash-flow delta word, and the command
  // palette's "Jump" hint (the palette row itself is the visible, focusable button).
  const DECORATIVE = new Map<string, number>([
    ['src/components/forensics/Vault.tsx', 1],
    ['src/components/intelligence/Copilot.tsx', 1],
    ['src/components/ledger/CashFlowView.tsx', 1],
    ['src/components/ledger/ProfitAndLossView.tsx', 2],
    ['src/components/planning/CashFlowPredictor.tsx', 1],
    ['src/components/projects/ProjectPipeline.tsx', 1],
    ['src/components/layout/CommandPalette.tsx', 1],
  ]);

  test('every opacity-0 + group-hover class string also reveals on group-focus-within, decorations aside', () => {
    const root = path.join(process.cwd(), 'src', 'components');
    const offenders = new Map<string, number>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx')) {
          for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
            if (line.includes('opacity-0') && line.includes('group-hover:opacity-100') && !line.includes('group-focus-within:opacity-100')) {
              const rel = path.relative(process.cwd(), full);
              offenders.set(rel, (offenders.get(rel) || 0) + 1);
            }
          }
        }
      }
    };
    walk(root);
    assert.deepEqual(Object.fromEntries(offenders), Object.fromEntries(DECORATIVE),
      'a hover-only control appeared (or a listed decoration changed): interactive row actions must also show on group-focus-within');
  });
});
