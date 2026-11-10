/**
 * Keyboard shortcuts (I-10): one list feeds the keys and the "Keyboard shortcuts" card; labels
 * follow the platform; no shortcut takes a key the browser keeps (⌘Q quits it on a Mac, ⌘F find,
 * ⌘P print).
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SHORTCUTS, shortcutKeyMap, shortcutLabel, type ShortcutId } from '../config/shortcuts';

describe('Keyboard shortcuts', () => {
  test('labels: ⌘ ⇧ on a Mac, Ctrl + Shift elsewhere', () => {
    assert.equal(shortcutLabel('mod+shift+e', true), '⌘ ⇧ E');
    assert.equal(shortcutLabel('mod+shift+e', false), 'Ctrl + Shift + E');
    assert.equal(shortcutLabel('?', false), '?');
    assert.equal(shortcutLabel('n i', true), 'N then I');
    assert.equal(shortcutLabel('n i', false), 'N then I');
    assert.equal(shortcutLabel('alt+r', true), '⌥ R');
  });

  test('every key belongs to one shortcut, and none is a key the browser keeps', () => {
    const keys = SHORTCUTS.flatMap(s => s.keys);
    assert.equal(new Set(keys).size, keys.length);
    for (const reserved of ['mod+q', 'mod+f', 'mod+p', 'mod+w', 'mod+t', 'mod+n', 'mod+alt+i', 'mod+alt+j', 'mod+alt+b']) assert.ok(!keys.includes(reserved), reserved);
  });

  test('the key map calls the right action for every key', () => {
    const called: string[] = [];
    const actions = Object.fromEntries(SHORTCUTS.map(s => [s.id, () => { called.push(s.id); }])) as Record<ShortcutId, () => void>;
    const map = shortcutKeyMap(actions);
    map['mod+/']();
    map['?']();
    map['mod+4']();
    assert.deepEqual(called, ['shortcuts', 'shortcuts', 'reports']);
  });

  test('the app and the card both use the list', () => {
    assert.match(fs.readFileSync('src/App.tsx', 'utf8'), /shortcutKeyMap\(\{/);
    assert.match(fs.readFileSync('src/components/layout/ShortcutOverlay.tsx', 'utf8'), /SHORTCUTS\.map/);
  });
});
