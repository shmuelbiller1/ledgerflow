/**
 * Prompt 2, part 5: "One box that can do anything" — the search box must reach every screen, every
 * report, every settings tab and every action the app knows, and it must be provable.
 *
 * The old check next to this one walks the import graph, so it only says a file is *imported*. A
 * screen can be imported and still be unreachable: nothing in the sidebar names it and no test clicks
 * it. That is how the interface hides the server. This guard asks the question a person asks — "can I
 * get there by typing a word?" — of every registry entry, in English and in Hebrew.
 *
 * Rules the guard keeps:
 *  - every registered screen tab, report and settings tab appears in the palette index;
 *  - it is found by its own name, in both languages, and by each of the words a person would type;
 *  - every action a palette command names is one the dispatcher knows, so choosing it cannot do nothing;
 *  - a module that is switched off is offered as "turn on", never silently missing.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_TABS,
  REPORT_TABS_REGISTRY,
  SCREEN_TABS_REGISTRY,
  SETTINGS_TABS_REGISTRY,
  SYSTEM_COMMANDS,
} from '../config/registry';
import { pageIndex, searchPages } from '../config/pageIndex';
import { MODULES } from '../lib/modules';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CommandPalette from '../components/layout/CommandPalette';
import { useUIStore } from '../stores/useUIStore';

/** The names in the palette's result list, as drawn. */
function resultNames(): string[] {
  return Array.from(document.querySelectorAll('p.text-base')).map(el => (el.textContent || '').trim());
}

const index = pageIndex('en');
const keys = new Set(index.map(entry => `${entry.page.tab}|${entry.page.sub ?? ''}`));
/** Screens held back for developers on purpose: listed only in developer mode. */
const developerOnly = new Set(
  (APP_TABS as ReadonlyArray<{ id: string; developerOnly?: boolean }>)
    .filter(tab => tab.developerOnly)
    .map(tab => tab.id),
);
const indexedInDeveloperMode = new Set(
  pageIndex('en', { developerMode: true }).map(entry => `${entry.page.tab}|${entry.page.sub ?? ''}`),
);

describe('every registered screen can be reached by searching for it', () => {
  test('no screen tab is missing from the index', () => {
    // accept-invite is the link in an invitation mail, opened before anyone is signed in: it is not a
    // page a person searches for, and it is registered so the route exists.
    const missing = SCREEN_TABS_REGISTRY
      .map(tab => tab.id)
      .filter(id => id !== 'accept-invite')
      .filter(id => !(developerOnly.has(id) ? indexedInDeveloperMode : keys).has(`${id}|`));
    assert.deepEqual(missing, [], `screens nothing can open:\n${missing.join('\n')}`);
  });

  test('no report and no settings tab is missing from the index', () => {
    const reports = REPORT_TABS_REGISTRY.map(r => r.id).filter(id => !keys.has(`reports|${id}`));
    const settings = SETTINGS_TABS_REGISTRY.map(tab => tab.id).filter(id => !keys.has(`settings|${id}`));
    assert.deepEqual(reports, [], `reports nothing can open:\n${reports.join('\n')}`);
    assert.deepEqual(settings, [], `settings nothing can open:\n${settings.join('\n')}`);
  });

  test('each one is found by its name, in English and in Hebrew', () => {
    const english = pageIndex('en');
    const hebrew = pageIndex('he');
    const notFound: string[] = [];
    const check = (list: typeof english, entries: ReadonlyArray<{ id: string; label: Record<string, string> }>, kind: string, languages: ReadonlyArray<'en' | 'he'>) => {
      for (const entry of entries) {
        for (const language of languages) {
          const name = entry.label[language];
          if (!name) continue;
          const destination = kind.startsWith('report') ? { tab: 'reports', sub: entry.id }
            : kind === 'settings' ? { tab: 'settings', sub: entry.id }
              : { tab: entry.id, sub: undefined };
          const found = searchPages(list, name).some(hit => hit.page.tab === destination.tab && hit.page.sub === destination.sub);
          if (!found) notFound.push(`${kind} ${entry.id} (${language}): "${name}"`);
        }
      }
    };
    const searchable = SCREEN_TABS_REGISTRY.filter(t => t.id !== 'accept-invite' && !developerOnly.has(t.id));
    check(english, searchable, 'screen', ['en']);
    check(hebrew, searchable, 'screen', ['he']);
    check(pageIndex('en', { developerMode: true }), SCREEN_TABS_REGISTRY.filter(t => developerOnly.has(t.id)), 'screen (developer mode)', ['en']);
    check(english, REPORT_TABS_REGISTRY, 'report', ['en']);
    // Hebrew screen names are not part of this slice of work: the index carries the name as
    // registered, and folding Hebrew for search is its own change. Reports and settings are checked in
    // both languages because their names come from the same dictionary either way.
    check(hebrew, REPORT_TABS_REGISTRY, 'report', ['he']);
    check(english, SETTINGS_TABS_REGISTRY, 'settings', ['en']);
    check(hebrew, SETTINGS_TABS_REGISTRY, 'settings', ['he']);
    assert.deepEqual(notFound, [], `not found by name:\n${notFound.join('\n')}`);
  });

  test('a person who does not know the accounting name still finds it in English and Hebrew', () => {
    // The words in docs/EASE_OF_USE.md Part 4 (U-5), including everyday Hebrew rather than
    // merely typing the translated report title. Search the real page index the palette uses.
    const plainWords: Array<['en' | 'he', string, { tab: string; sub?: string }]> = [
      ['en', 'profit and loss', { tab: 'reports', sub: 'pnl' }],
      ['en', 'income statement', { tab: 'reports', sub: 'pnl' }],
      ['en', 'who owes me', { tab: 'reports', sub: 'ar-aging' }],
      ['en', 'who do i owe', { tab: 'reports', sub: 'ap-aging' }],
      ['en', 'statement of financial position', { tab: 'reports', sub: 'balance-sheet' }],
      ['en', 'money in money out', { tab: 'reports', sub: 'cash-flow' }],
      ['en', 'logo', { tab: 'settings', sub: 'branding' }],
      ['en', 'invoice number', { tab: 'settings', sub: 'numbering' }],
      ['en', 'turn on payroll', { tab: 'settings', sub: 'modules' }],
      ['he', 'דוח הכנסות והוצאות', { tab: 'reports', sub: 'pnl' }],
      ['he', 'מי חייב לי', { tab: 'reports', sub: 'ar-aging' }],
      ['he', 'למי אני חייב', { tab: 'reports', sub: 'ap-aging' }],
      ['he', 'מה יש לנו ומה חייבים', { tab: 'reports', sub: 'balance-sheet' }],
      ['he', 'כסף נכנס כסף יוצא', { tab: 'reports', sub: 'cash-flow' }],
      ['he', 'לוגו', { tab: 'settings', sub: 'branding' }],
      ['he', 'מספר חשבונית', { tab: 'settings', sub: 'numbering' }],
      ['he', 'להפעיל שכר', { tab: 'settings', sub: 'modules' }],
    ];
    const missed = plainWords
      .filter(([language, query, page]) => !searchPages(pageIndex(language), query)
        .some(hit => hit.page.tab === page.tab && hit.page.sub === page.sub))
      .map(([language, query, page]) => `${language} "${query}" does not reach ${page.tab}${page.sub ? '/' + page.sub : ''}`);
    assert.deepEqual(missed, []);
  });

  test('a switched-off module is offered as turn-on, not left out', () => {
    const allOff = Object.fromEntries(MODULES.map(m => [m.id, false]));
    const withOff = pageIndex('en', { modules: allOff });
    const offEntries = withOff.filter(entry => entry.disabledModuleId);
    assert.equal(offEntries.length, MODULES.length, 'every module says how to turn it on');
    for (const entry of offEntries) {
      assert.match(entry.label, /\(off\).*turn on/, entry.label);
      assert.deepEqual(entry.page, { tab: 'settings', sub: 'modules' }, 'the link goes where the switch is');
    }
    const inHebrew = searchPages(pageIndex('he', { modules: { payroll: false } }), 'להפעיל שכר');
    const payroll = inHebrew.find(entry => entry.disabledModuleId === 'payroll');
    assert.ok(payroll, 'a Hebrew request to enable payroll finds its disabled-module link');
    assert.match(payroll.label, /כבוי.*מודולים/);
    assert.deepEqual(payroll.page, { tab: 'settings', sub: 'modules' });
  });
});

describe('every action the search box offers can be run', () => {
  afterEach(() => cleanup());

  test('plain English and Hebrew words lead to the right report in the rendered palette', () => {
    const cases = [
      { language: 'en', query: 'who owes me', label: 'Go to Report: A/R Aging', report: 'ar-aging' },
      { language: 'he', query: 'למי אני חייב', label: 'Go to Report: גיול ספקים', report: 'ap-aging' },
    ] as const;
    for (const { language, query, label, report } of cases) {
      useUIStore.setState({ language, activeTab: 'dashboard', activeReportTab: 'pnl' });
      const view = render(<CommandPalette isOpen onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText('Search commands or enter a transaction'), { target: { value: query } });
      assert.ok(resultNames().includes(label), `the palette visibly offers ${label}`);
      const offered = screen.getByText(label).closest('button');
      assert.ok(offered, 'the page result has a clickable button');
      fireEvent.click(offered);
      assert.equal(useUIStore.getState().activeTab, 'reports');
      assert.equal(useUIStore.getState().activeReportTab, report);
      view.unmount();
    }
  });

  const dispatcher = fs.readFileSync(path.join(process.cwd(), 'src/hooks/useSystemContext.ts'), 'utf8');

  test('each command names an action the dispatcher knows', () => {
    const unknown = [...new Set(SYSTEM_COMMANDS.map(command => command.actionId))]
      // a screen name is dispatched by opening that screen; those are checked against the registry instead
      .filter(actionId => !APP_TABS.some(tab => tab.id === actionId))
      .filter(actionId => !dispatcher.includes(`'${actionId}'`));
    assert.deepEqual(unknown, [], `a command that would do nothing:\n${unknown.join('\n')}`);
  });

  test('each command is found by typing its name into the real palette, in English and in Hebrew', () => {
    // The earlier version of this test re-implemented the palette's filter and searched the English
    // label only. That is a test of a copy: it passes even if the palette stops listing commands
    // altogether, and it never looks at Hebrew, where the palette shows the Hebrew label. This renders
    // the palette and types, which is what a person does.
    const missed: string[] = [];
    for (const language of ['en', 'he'] as const) {
      useUIStore.setState({ language });
      const view = render(<CommandPalette isOpen onClose={() => {}} />);
      const box = screen.getByLabelText(/Search commands|חיפוש/);
      for (const command of SYSTEM_COMMANDS) {
        const typed = command.label[language];
        if (!typed) {
          missed.push(`${command.id}: no ${language} name`);
          continue;
        }
        fireEvent.change(box, { target: { value: typed } });
        const offered = resultNames().includes(typed);
        if (!offered) missed.push(`${command.id} (${language}): typing "${typed}" offers nothing`);
      }
      view.unmount();
    }
    assert.deepEqual(missed, [], `commands typing cannot reach:\n${missed.join('\n')}`);
  });

  test('the palette is not simply listing everything: a word that matches nothing lists no command', () => {
    // the other half of the previous test — "found by typing" is meaningless if every query shows all
    useUIStore.setState({ language: 'en' });
    render(<CommandPalette isOpen onClose={() => {}} />);
    const box = screen.getByLabelText(/Search commands|חיפוש/);
    for (const command of SYSTEM_COMMANDS) {
      assert.ok(resultNames().includes(command.label.en), 'the whole list is there before typing');
      break;
    }
    fireEvent.change(box, { target: { value: 'zzzq' } });
    assert.deepEqual(resultNames(), [], 'a query that matches nothing lists nothing');
  });

  test('a command and a screen with the same word are both offered, not one instead of the other', () => {
    // "report" is a command (financial reports) and a screen. A person typing it may mean either, so the
    // palette must show both. Checked in the drawn list, because the point is what the person sees, not
    // what two filters would return if they were called.
    useUIStore.setState({ language: 'en' });
    render(<CommandPalette isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Search commands|חיפוש/), { target: { value: 'report' } });
    const shown = resultNames();
    assert.ok(
      shown.some(name => name === 'Financial Reports'),
      `the report command is offered (saw: ${shown.join(' | ')})`,
    );
    assert.ok(
      shown.some(name => name.startsWith('Go to Report:') || name.startsWith('Go to Reports')),
      `a report screen is offered too (saw: ${shown.join(' | ')})`,
    );
  });
});
