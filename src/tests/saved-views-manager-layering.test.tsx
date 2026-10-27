/**
 * #274 (recording report), Saved Views manager: the dialog must sit above the app chrome and be
 * opaque. Both were broken: the overlay was `z-50` while the sidebar is `z-[100]` (so at 1280 px
 * the sidebar covered the dialog's title and Close button), and `--surface-card` /
 * `--surface-elevated` were used by the manager, the Saved Views bar and the deep-search bar but
 * never defined in the theme, so their backgrounds resolved to nothing and the dark ledger showed
 * through. These assertions are source-level because jsdom runs no Tailwind.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import SavedViewsManagerModal from '../components/ui/SavedViewsManagerModal';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const zIndexOf = (className: string) => {
  const arbitrary = /(?:^|\s)z-\[(\d+)\]/.exec(className);
  if (arbitrary) return Number(arbitrary[1]);
  const named = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(className);
  return named ? Number(named[1]) : null;
};

describe('Saved Views manager: above the chrome, opaque (#274)', () => {
  afterEach(() => cleanup());

  test('it is a modal dialog with its title and Close button, and Escape closes it', async () => {
    let closed = 0;
    await act(async () => { render(<SavedViewsManagerModal isOpen onClose={() => { closed += 1; }} />); });
    const dialog = screen.getByRole('dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(dialog.getAttribute('aria-labelledby'), screen.getByRole('heading', { name: 'Saved Views & Default Lenses' }).id);
    assert.ok(screen.getByRole('button', { name: 'Close saved views dialog' }));
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    assert.equal(closed, 1);
  });

  test('the overlay is above the app chrome, not level with it', async () => {
    await act(async () => { render(<SavedViewsManagerModal isOpen onClose={() => {}} />); });
    const overlayZ = zIndexOf(screen.getByRole('dialog').className);
    assert.ok(overlayZ !== null, 'the overlay declares a stacking level');
    // Header, sidebar (z-[100]) and the phone bottom bar are the persistent chrome around the page.
    const chromeZ = ['Header', 'Sidebar', 'BottomNav'].flatMap(name =>
      [...read(`src/components/layout/${name}.tsx`).matchAll(/(?:["'\s])z-(?:\[(\d+)\]|(\d+))/g)]
        .map(match => Number(match[1] ?? match[2])));
    const highestChrome = Math.max(...chromeZ);
    assert.ok(highestChrome > 0, 'the chrome still sets a stacking level this test compares against');
    assert.ok(overlayZ! > highestChrome, `the dialog (z-${overlayZ}) must sit above the chrome (z-${highestChrome})`);
  });

  test('the dialog surface and the scroll area do not let the page behind show or scroll through', async () => {
    await act(async () => { render(<SavedViewsManagerModal isOpen onClose={() => {}} />); });
    const dialog = screen.getByRole('dialog');
    const panel = dialog.firstElementChild as HTMLElement;
    const surface = /bg-\[var\(--([a-z-]+)\)\]/.exec(panel.className)?.[1];
    assert.equal(surface, 'surface-card', 'the panel paints an opaque theme surface');
    const css = read('src/index.css');
    for (const theme of [':root', '.light']) {
      const block = new RegExp(`${theme.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
      for (const name of ['--surface-card', '--surface-elevated']) {
        assert.match(block, new RegExp(`${name}:\\s*var\\(--[a-z-]+\\)`), `${theme} defines ${name}`);
      }
    }
    const scroller = panel.querySelector('.overflow-y-auto');
    assert.ok(scroller, 'the list scrolls inside the dialog');
    assert.match(scroller!.className, /overscroll-contain/, 'wheel at the end of the list does not scroll the page behind');
  });
});
