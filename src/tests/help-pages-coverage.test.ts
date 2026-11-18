/**
 * A-219: every screen's help link opens a page that exists.
 *
 * Before this, `findScreenHelpDoc` fell back to the Overview page for any screen the help centre did
 * not name, so pressing `? Help` on 180 of the registered screens opened a page about the dashboard.
 * This guard lists what is missing rather than trusting the screen: every registered screen (main
 * screens, reports, settings, intelligence and analytical lenses) must appear in exactly one
 * `SCREEN_HELP_DOCS` entry, and every entry must point at a real bilingual Markdown page that the
 * help-centre README links to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ANALYTICAL_LENSES_REGISTRY,
  INTELLIGENCE_TABS_REGISTRY,
  REPORT_TABS_REGISTRY,
  SCREEN_TABS_REGISTRY,
  SETTINGS_TABS_REGISTRY,
} from '../config/registry';
import { HOW_TO_ARTICLES, SCREEN_HELP_DOCS, findScreenHelpDoc } from '../lib/helpCenterArticles';

const registries: Array<[string, ReadonlyArray<{ id: string }>]> = [
  ['screen', SCREEN_TABS_REGISTRY],
  ['report', REPORT_TABS_REGISTRY],
  ['settings', SETTINGS_TABS_REGISTRY],
  ['intelligence', INTELLIGENCE_TABS_REGISTRY],
  ['lens', ANALYTICAL_LENSES_REGISTRY],
];

test('A-219: every registered screen is named by exactly one help page (no silent fallback)', () => {
  const missing: string[] = [];
  const duplicates: string[] = [];
  const seen = new Map<string, string>();
  for (const doc of SCREEN_HELP_DOCS) {
    for (const id of doc.screenIds) {
      const previous = seen.get(id);
      if (previous) duplicates.push(`${id} is in ${previous} and ${doc.slug}`);
      else seen.set(id, doc.slug);
    }
  }
  for (const [group, list] of registries) {
    for (const entry of list) {
      if (!seen.has(entry.id)) missing.push(`${group}:${entry.id}`);
    }
  }
  assert.deepEqual(missing, [], `screens with no help page: ${missing.join(', ')}`);
  assert.deepEqual(duplicates, [], `screens claimed by two help pages: ${duplicates.join('; ')}`);
  // the fallback in findScreenHelpDoc is now only a safety net: no registered screen reaches it
  for (const [, list] of registries) {
    for (const entry of list) {
      assert.ok(
        findScreenHelpDoc(entry.id).screenIds.includes(entry.id),
        `pressing Help on ${entry.id} must open its own page, not the Overview fallback`,
      );
    }
  }
});

test('A-219: every help page is a real bilingual Markdown page that says something specific', () => {
  const problems: string[] = [];
  for (const doc of SCREEN_HELP_DOCS) {
    const absolute = path.resolve(process.cwd(), doc.docPath);
    if (!fs.existsSync(absolute)) {
      problems.push(`${doc.slug}: missing file ${doc.docPath}`);
      continue;
    }
    const markdown = fs.readFileSync(absolute, 'utf8');
    if (!/## English/.test(markdown)) problems.push(`${doc.slug}: no "## English" section`);
    if (!/## עברית/.test(markdown)) problems.push(`${doc.slug}: no "## עברית" section`);
    // a page, not a stub: at least 15 lines, and the Hebrew half is actually Hebrew
    if (markdown.split('\n').length < 15) problems.push(`${doc.slug}: page is too short to help anyone`);
    const hebrew = markdown.split(/## עברית/)[1] || '';
    if (!/[\u0590-\u05FF]/.test(hebrew)) problems.push(`${doc.slug}: the Hebrew section has no Hebrew`);
    // metadata the dialog shows is real in both languages
    if (!doc.titleEn.trim() || !doc.titleHe.trim()) problems.push(`${doc.slug}: missing a title in one language`);
    if (!/[\u0590-\u05FF]/.test(doc.summaryHe)) problems.push(`${doc.slug}: summaryHe is not Hebrew`);
    if (doc.keyTasksEn.length < 2 || doc.keyTasksEn.length > 5) problems.push(`${doc.slug}: needs 2–5 key tasks`);
    if (doc.keyTasksHe.length !== doc.keyTasksEn.length) problems.push(`${doc.slug}: key tasks differ in length between languages`);
    if (!doc.keyTasksHe.every(task => /[\u0590-\u05FF]/.test(task))) problems.push(`${doc.slug}: a Hebrew key task is not Hebrew`);
    if (doc.keyTasksEn.some((task, index) => task === doc.keyTasksHe[index])) problems.push(`${doc.slug}: a Hebrew task is a copy of the English one`);
    if (doc.screenIds.length === 0) problems.push(`${doc.slug}: names no screen`);
    if (!doc.docPath.startsWith('docs/help/') || !doc.docPath.endsWith('.md')) problems.push(`${doc.slug}: docPath is not a docs/help page`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('A-219: the help centre index links every page', () => {
  const readme = fs.readFileSync(path.resolve(process.cwd(), 'docs/help/README.md'), 'utf8');
  const missing = SCREEN_HELP_DOCS.filter(doc => !readme.includes(path.basename(doc.docPath)));
  assert.deepEqual(missing.map(doc => doc.slug), [], 'every help page is listed in docs/help/README.md');
});

test('A-219: pages are named after the areas they cover, and slugs are unique', () => {
  const slugs = SCREEN_HELP_DOCS.map(doc => doc.slug);
  assert.deepEqual(slugs, [...new Set(slugs)], 'two pages share a slug');
  const paths = SCREEN_HELP_DOCS.map(doc => doc.docPath);
  assert.deepEqual(paths, [...new Set(paths)], 'two pages share a file');
  // the areas added with this task, so a rename is a visible decision
  for (const slug of ['inventory-and-assets', 'taxes', 'cash-and-credit', 'system-and-data']) {
    assert.ok(slugs.includes(slug), `${slug} page is present`);
  }
});

test('N-2: the ten contextual manuals agree with their bilingual pages and ship the pictured screen', () => {
  // These are the ten named in COORDINATION H-1. Use the Ledger’s Trial Balance, not the party-linked report.
  const expected = ['dashboard', 'sales', 'purchases', 'banking', 'reconciliation', 'pnl', 'balance-sheet',
    'trial-balance', 'israel-vat-report', 'settings'];
  const illustrated = SCREEN_HELP_DOCS.filter(doc => doc.illustration);
  assert.deepEqual(illustrated.map(doc => doc.illustration!.screenId).sort(), expected.sort());
  for (const doc of illustrated) {
    const picture = doc.illustration!;
    assert.equal(findScreenHelpDoc(picture.screenId), doc);
    const [english, hebrew] = fs.readFileSync(doc.docPath, 'utf8').split('## עברית');
    for (const [section, purpose, tasks] of [[english, doc.summaryEn, doc.keyTasksEn], [hebrew, doc.summaryHe, doc.keyTasksHe]] as const) {
      assert.ok(section.includes(purpose), `Purpose differs in ${doc.docPath}`);
      assert.equal(tasks.length, 3);
      assert.deepEqual([...section.matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]), tasks, doc.docPath);
    }
    assert.match(picture.altHe, /\p{Script=Hebrew}/u);
    const image = `public/help/${doc.slug}.webp`;
    assert.ok(hebrew.includes(`](../../${image})`), `Missing illustration in ${doc.docPath}`);
    assert.equal(fs.readFileSync(image).toString('ascii', 8, 12), 'WEBP', image);
  }
});

test('every Open screen action on a how-to points to a registered screen and subview', () => {
  const targets = new Set(SCREEN_TABS_REGISTRY.map(entry => entry.id));
  const subviews: Record<string, Set<string>> = {
    reports: new Set(REPORT_TABS_REGISTRY.map(entry => entry.id)),
    settings: new Set(SETTINGS_TABS_REGISTRY.map(entry => entry.id)),
  };
  const invalid = HOW_TO_ARTICLES.filter(({ target: { tab, sub } }) =>
    !targets.has(tab) || (sub !== undefined && !subviews[tab]?.has(sub)),
  ).map(({ id, target }) => `${id}: ${target.tab}/${target.sub ?? ''}`);
  assert.deepEqual(invalid, [], 'a how-to sends the reader to a nonexistent destination');
});
