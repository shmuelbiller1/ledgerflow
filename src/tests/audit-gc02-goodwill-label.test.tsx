/**
 * Audit GC-02 (P1, labeling): the group report's goodwill figure is the excess of the parent's
 * investment account over the subsidiary's acquisition-date BOOK equity share, with no fair-value
 * adjustment to the acquired net assets. The audit requires that this not be presented as final
 * statutory goodwill — it must be clearly labeled a non-statutory book-value estimate that excludes
 * fair-value adjustments. This test seeds the worked example from the audit review ($120 price,
 * $100 book net assets → $20 labeled goodwill) and asserts the screen says the estimate is not
 * statutory goodwill and excludes fair-value adjustments.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import GroupSummaryReportView from '../components/reporting/GroupSummaryReportView';
import { getSupabase } from '../lib/db/client';
import { setComponentWorkspace } from './helpers/componentFixtures';

describe('audit GC-02: the goodwill shown is a book-value estimate, not statutory goodwill', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('the goodwill line is qualified as a non-statutory estimate without fair-value adjustments', async () => {
    setComponentWorkspace('owner');
    const groups = [{ id: 'grp_aaaaaaaa', name: 'Family', workspaceIds: ['ws-a', 'ws-b'] }];
    const figures = (income: number) => ({ income, cogs: 0, grossProfit: income, expense: 100, netIncome: income - 100, totalAssets: 5000, totalLiabilities: 0, totalEquity: 5000 });
    // the audit's worked example: $120 paid for $100 of book net assets, all of it above book value
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith('/api/v1/account/groups') ? { status: 'success', groups }
        : { group: groups[0], notIncluded: 0,
          members: [
            { workspaceId: 'ws-a', name: 'Holding', currency: 'USD', isBalanced: true, ...figures(1000) },
            { workspaceId: 'ws-b', name: 'Daughter', currency: 'USD', isBalanced: true, share: 100, ...figures(2000) },
          ],
          total: { currency: 'USD', ...figures(3000), eliminated: { assets: 0, liabilities: 0, difference: 0, investment: 12000, goodwill: 2000, belowBookValue: 0 } },
          parent: { workspaceId: 'ws-a', name: 'Holding' },
        };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    render(<GroupSummaryReportView />);
    await waitFor(() => assert.ok(screen.getByText(/The parent's investment in its companies, \$120\.00/)));
    const label = screen.getByText(/The parent's investment/).textContent || '';
    assert.match(label, /except goodwill: \$20\.00/);
    assert.match(label, /book-value estimate/i, 'the figure is qualified as a book-value estimate');
    assert.match(label, /fair[- ]value adjustments/i, 'the label says it excludes fair-value adjustments');
    assert.match(label, /not the statutory goodwill/i, 'the label says it is not statutory goodwill');
  });
});
