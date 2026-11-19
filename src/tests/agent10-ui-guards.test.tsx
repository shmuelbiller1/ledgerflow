import { stubFetch } from './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DocumentEntanglement from '../components/forensics/DocumentEntanglement';
import TransactionEditModal from '../components/transactions/TransactionEditModal';
import Projects from '../components/projects/Projects';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount, makeTransaction } from './fixtures';
import { useLedgerStore } from '../stores/useLedgerStore';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const SVG = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+';

afterEach(() => {
  cleanup();
  useLedgerStore.setState({ projects: [], transactions: [], accounts: [], vendors: [] } as never);
});

test('#915 UI sink: DocumentEntanglement refuses svg/script receiptUrl and accepts safe PNG data URL', () => {
  const parsedData = {
    vendorName: 'Acme',
    date: '2026-11-19',
    totalAmountCents: 1000,
    taxAmountCents: 0,
    currency: 'USD',
    lineItems: [{ description: 'Item', amountCents: 1000, categorySuggestion: 'Supplies' }],
    confidenceScore: 95,
  };

  render(<DocumentEntanglement isOpen onClose={() => {}} onVerify={() => {}} receiptUrl={SVG} parsedData={parsedData} />);
  assert.equal(document.querySelector('img'), null);
  assert.ok(screen.getByText('No Image Available'));
  cleanup();

  render(<DocumentEntanglement isOpen onClose={() => {}} onVerify={() => {}} receiptUrl="javascript:alert(1)" parsedData={parsedData} />);
  assert.equal(document.querySelector('img'), null);
  cleanup();

  render(<DocumentEntanglement isOpen onClose={() => {}} onVerify={() => {}} receiptUrl={PNG} parsedData={parsedData} />);
  const img = document.querySelector('img');
  assert.ok(img);
  assert.equal(img?.getAttribute('src'), PNG);
});

test('#915 UI sink: TransactionEditModal refuses SVG/script fileUrls while rendering safe PNG data URL', () => {
  stubFetch(200);
  setComponentWorkspace('owner');
  const accounts = [
    makeChartAccount({ id: 'cash', name: 'Cash', type: 'asset', category: 'Cash' }),
    makeChartAccount({ id: 'exp', name: 'Expense', type: 'expense', category: 'Operating' }),
  ];
  const tx = makeTransaction({
    id: 'tx-files',
    date: '2026-11-19',
    description: 'Receipt check',
    totalAmountCents: 500,
    fileUrls: [SVG, 'javascript:alert(1)', PNG],
    lines: [
      { id: 'l1', accountId: 'exp', amountCents: 500 },
      { id: 'l2', accountId: 'cash', amountCents: -500 },
    ],
  });

  render(<TransactionEditModal isOpen transaction={tx} accounts={accounts} onClose={() => {}} />);
  const imgs = Array.from(document.querySelectorAll('img'));
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].getAttribute('src'), PNG);
  assert.equal(screen.getAllByText('Document').length, 2);
});

test('#924 UI bar clamp: ProjectsView clamps splitRules percentage bar widths to [0, 100]', () => {
  stubFetch(200);
  const ws = setComponentWorkspace('owner');
  markComponentCollectionsLoaded('projects', 'transactions', 'vendors');
  useLedgerStore.setState({
    projects: [
      {
        id: 'proj-1',
        workspaceId: ws.id,
        name: 'Solar Rollout',
        status: 'active',
        budgetCents: 100000,
        spentCents: 0,
        splitRules: [
          { partnerId: 'p1', partnerName: 'Partner Neg', percentage: -25 },
          { partnerId: 'p2', partnerName: 'Partner Over', percentage: 145 },
          { partnerId: 'p3', partnerName: 'Partner Mid', percentage: 40 },
        ],
      },
    ],
    transactions: [],
    vendors: [],
  } as never);

  render(<Projects />);
  fireEvent.click(screen.getByRole('button', { name: /List/i }));
  fireEvent.click(screen.getByText('Allocated'));
  assert.ok(screen.getByText('-25%'));
  assert.ok(screen.getByText('145%'));
  assert.ok(screen.getByText('40%'));
  const bars = Array.from(document.querySelectorAll('div.h-1.w-full > div.bg-\\[var\\(--brass\\)\\]'));
  assert.deepEqual(bars.map(el => (el as HTMLElement).style.width), ['0%', '100%', '40%']);
});
