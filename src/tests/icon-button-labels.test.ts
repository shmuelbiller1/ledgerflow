/**
 * D-91 (P2-51): an icon-only button must name itself for a screen reader.
 *
 * A button whose whole content is one icon has no accessible name, so a screen reader announces
 * "button" — and on a page of ten icon buttons the person cannot tell them apart. Every such
 * button therefore needs `aria-label` (or `aria-labelledby`), and the same words should be offered
 * as a `title` tooltip for sighted mouse users.
 *
 * The two entries in `LEAD_OWNS` are the buttons that still lack a name inside AI #1's reserved
 * files (`src/components/sales/Sales.tsx`, `src/components/sales/EstimatesView.tsx`). They are
 * listed with their exact count, so this test fails when a *new* unnamed icon button appears, and
 * it also fails when one of these is fixed (then remove the entry) — the list cannot silently grow.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir: string): string[] => fs.readdirSync(dir).flatMap(name => {
  const entry = path.join(dir, name);
  if (fs.statSync(entry).isDirectory()) return name === 'tests' || name === 'node_modules' ? [] : walk(entry);
  return entry.endsWith('.tsx') ? [entry] : [];
});

/** The opening tag starting at `start`: JSX braces may contain ">" themselves. */
function openingTag(text: string, start: number): { tag: string; end: number } {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (character === '{') depth++;
    else if (character === '}') depth--;
    else if (character === '>' && depth === 0) return { tag: text.slice(start, index + 1), end: index + 1 };
  }
  return { tag: text.slice(start), end: text.length };
}

/** AI #1's reserved files; the lead fixes these, the list shrinks as they do. */
const LEAD_OWNS: Record<string, number> = {
  'src/components/sales/Sales.tsx': 5,
  'src/components/sales/EstimatesView.tsx': 2,
};

interface Unnamed { file: string; line: number; icon: string }

function unnamedIconButtons(): Unnamed[] {
  const found: Unnamed[] = [];
  for (const file of walk('src')) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/<button\b/g)) {
      const { tag, end } = openingTag(text, match.index!);
      if (/\baria-label(?:ledby)?=/.test(tag)) continue;
      const close = text.indexOf('</button>', end);
      if (close < 0) continue;
      const body = text.slice(end, close).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim();
      // One self-closing icon element and nothing else: no text, no second child.
      const icon = /^<([A-Z][A-Za-z0-9_.]*)\b[^<>]*\/>$/.exec(body);
      if (icon) found.push({ file, line: text.slice(0, match.index!).split('\n').length, icon: icon[1] });
    }
  }
  return found;
}

describe('icon-only buttons (D-91)', () => {
  test('every icon-only button names itself, apart from the lead\'s reserved files', () => {
    const unnamed = unnamedIconButtons();
    const byFile = new Map<string, Unnamed[]>();
    for (const item of unnamed) byFile.set(item.file, [...(byFile.get(item.file) || []), item]);

    const unexpected = [...byFile.entries()]
      .filter(([file, items]) => items.length !== (LEAD_OWNS[file] ?? 0))
      .map(([file, items]) => `${file}: ${items.length} unnamed icon button(s) at line ${items.map(item => item.line).join(', ')} — add aria-label (the words the tooltip already uses)`);
    assert.deepEqual(unexpected, [], 'a new icon-only button must carry aria-label');

    const fixed = Object.entries(LEAD_OWNS).filter(([file, count]) => (byFile.get(file)?.length ?? 0) < count).map(([file]) => file);
    assert.deepEqual(fixed, [], 'these are fixed: take them out of LEAD_OWNS');
  });

  test('the shared controls this lane owns name themselves and explain the icons', () => {
    // spot checks on the shared pieces rather than the whole tree: what a person meets everywhere
    const read = (file: string) => fs.readFileSync(file, 'utf8');
    const settings = read('src/components/platform/Settings.tsx');
    // Settings keeps search as a labelled input (no icon to hide, no icon-only control) and names its
    // clear control in words, so the same intent — nothing unnamed, nothing decorative announced — is
    // met by the screen's own markup rather than by an aria-label on an icon.
    assert.match(settings, /htmlFor="settings-search"[^>]*>\s*Search settings/, 'the search field has a visible label');
    assert.match(settings, /Clear search/, 'the clear control says what it does');
    const sidebar = read('src/components/layout/Sidebar.tsx');
    assert.match(sidebar, /aria-hidden="true"/);
    const emptyState = read('src/components/ui/EmptyState.tsx');
    assert.match(emptyState, /<Plus size=\{16\} aria-hidden="true" \/>/);
  });
});
