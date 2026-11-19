/**
 * #924 (the bar half) and the #909 class: a decorative track must never be wider than its own truth.
 *
 * A negative share, a share above 100 % and a division by zero all produced an invalid or `auto` CSS
 * width, which the browser renders as a **full** track: a refund looked like a 100 % contribution and a
 * 0 / 0 progress ratio looked complete. `barWidthPercent` (src/lib/barWidth.ts) clamps the drawing to
 * [0, 100]; the text beside it keeps its true, unclamped value.
 *
 * Hand-worked case for the project split tranches: rules of −20 %, 140 % and 33.5 % (the schema does not
 * validate them — that half of #924 is AI #1's) must draw 0 %, 100 % and 33.5 %, while the labels still
 * read −20 %, 140 % and 33.5 %.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { barWidthPercent } from '../lib/barWidth';
import { ProjectsView } from '../components/projects/ProjectsView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';

describe('barWidthPercent', () => {
  test('clamps to [0, 100] and survives values that are not numbers', () => {
    assert.equal(barWidthPercent(0), '0%');
    assert.equal(barWidthPercent(33.5), '33.5%');
    assert.equal(barWidthPercent(100), '100%');
    assert.equal(barWidthPercent(140), '100%');
    assert.equal(barWidthPercent(-20), '0%');
    assert.equal(barWidthPercent(-0.0001), '0%');
    for (const impossible of [NaN, Infinity, -Infinity, undefined, null, '', 'abc', {}]) {
      assert.equal(barWidthPercent(impossible), '0%', `no width for ${String(impossible)}`);
    }
    assert.equal(barWidthPercent('55'), '55%', 'a numeric string is still a number');
  });
});

describe('#924: split tranche bars are clamped, their labels are not', () => {
  afterEach(() => cleanup());

  test('a −20 %, a 140 % and a 33.5 % tranche draw 0 %, 100 % and 33.5 %', () => {
    setComponentWorkspace();
    useLedgerStore.setState({ transactions: [], accounts: [], taxRates: [], projects: [] } as never);
    const splitRules = [
      { partnerId: 'p1', partnerName: 'Dana', percentage: -20 },
      { partnerId: 'p2', partnerName: 'Omer', percentage: 140 },
      { partnerId: 'p3', partnerName: 'Yael', percentage: 33.5 },
    ];
    const withOccurrenceKeys = <T,>(items: T[], keyFor: (item: T) => string) => {
      const seen = new Map<string, number>();
      return items.map(item => {
        const base = keyFor(item);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return { item, key: `${base}#${count}` };
      });
    };
    const props = {
      projects: [], filteredProjects: [], transactions: [], projectStats: {}, projectVendors: [],
      activeSubTab: 'list', selectedProject: { id: 'p', name: 'Split project', status: 'active', splitRules },
      searchTerm: '', loading: false, newProject: {}, formId: () => 'fixture', withOccurrenceKeys,
    } as unknown as Parameters<typeof ProjectsView>[0];
    const { container } = render(<ProjectsView {...props} />);

    const tracks = Array.from(container.querySelectorAll<HTMLElement>('div.h-full.bg-\\[var\\(--brass\\)\\]'));
    assert.equal(tracks.length, 3, 'one decorative track per tranche');
    assert.deepEqual(tracks.map(t => t.style.width), ['0%', '100%', '33.5%']);
    const text = container.textContent || '';
    for (const label of ['-20%', '140%', '33.5%']) assert.ok(text.includes(label), `label keeps ${label}`);
  });
});

describe('the decorative tracks in this app go through the clamp', () => {
  // These are the screens whose track was built from a raw percentage or a ratio that can divide by zero.
  const FILES = [
    'src/components/projects/ProjectsView.tsx',
    'src/components/platform/SystemTelemetryPanel.tsx',
    'src/components/inventory/inventoryColumns.tsx',
    'src/components/inventory/Inventory.tsx',
    'src/components/ledger/ReconciliationView.tsx',
    'src/components/intelligence/IntelligenceCenter.tsx',
  ];
  for (const file of FILES) {
    test(`${file} imports barWidthPercent and has no raw percentage width left`, () => {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      assert.match(source, /import \{ barWidthPercent \} from '\.\.\/\.\.\/lib\/barWidth';/);
      // a bare `${…}%` width is the shape that produced an invalid CSS value (#909/#924)
      const rawWidths = source.match(/style=\{\{ width: `\$\{[^`]*\}%` \}\}/g) ?? [];
      assert.deepEqual(rawWidths, [], 'use barWidthPercent for a decorative track');
    });
  }
});
