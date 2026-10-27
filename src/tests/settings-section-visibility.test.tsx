/**
 * #274 (recording report): a Settings section chosen from the shortcut grid changed the selection
 * but left the panel below the fold, so the buttons looked dead. Choosing a section now brings its
 * panel into view and moves focus there; opening Settings with a saved section does not jump.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Settings from '../components/platform/Settings';
import { useUIStore } from '../stores/useUIStore';

type Reveal = { label: string; block?: ScrollIntoViewOptions['block'] };

const originalScrollIntoView = (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;

describe('Settings: choosing a section reveals it (#274)', () => {
  let revealed: Reveal[];
  // kept apart from `revealed` so the existing expectations stay exactly as they were
  let behaviors: Array<ScrollBehavior | undefined>;
  beforeEach(() => {
    revealed = [];
    behaviors = [];
    (Element.prototype as unknown as { scrollIntoView: (options?: ScrollIntoViewOptions) => void }).scrollIntoView =
      function scrollIntoView(this: Element, options?: ScrollIntoViewOptions) {
        revealed.push({ label: this.getAttribute('aria-label') || '', block: options?.block });
        behaviors.push(options?.behavior);
      };
    useUIStore.setState({ activeSettingsTab: 'appearance', language: 'en' });
  });
  afterEach(() => {
    cleanup();
    if (originalScrollIntoView) (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = originalScrollIntoView;
    else delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });

  const renderSettings = async () => {
    await act(async () => { render(<Settings />); });
  };

  test('opening Settings does not jump: the saved section stays as it was', async () => {
    await renderSettings();
    assert.deepEqual(revealed, [], 'no click, no scroll');
    assert.equal(useUIStore.getState().activeSettingsTab, 'appearance');
    assert.equal(screen.getByRole('region', { name: 'Appearance & Display settings' }).id, 'settings-panel');
  });

  test('a section button scrolls its panel to the top of the view and moves focus to it', async () => {
    await renderSettings();
    const developer = screen.getByRole('button', { name: 'Developer' });
    await act(async () => { fireEvent.click(developer); });

    assert.equal(useUIStore.getState().activeSettingsTab, 'developer');
    assert.deepEqual(revealed, [{ label: 'Developer settings', block: 'start' }], 'the panel itself is brought into view, not the buttons');
    const panel = screen.getByRole('region', { name: 'Developer settings' });
    assert.equal(document.activeElement, panel, 'keyboard and screen-reader focus follow the choice');
    assert.equal(panel.getAttribute('tabindex'), '-1');
  });

  test('every section in every group reveals itself, and rapid switching lands on the last one', async () => {
    await renderSettings();
    for (const name of ['Billing & Plan', 'Import price lists', 'Developer', 'Currencies']) {
      const button = screen.getByRole('button', { name });
      await act(async () => { fireEvent.click(button); });
      assert.equal(useUIStore.getState().activeSettingsTab.length > 0, true);
      assert.equal(revealed.at(-1)?.label, `${name} settings`, `${name} was revealed`);
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Billing & Plan' }));
      fireEvent.click(screen.getByRole('button', { name: 'Developer' }));
    });
    assert.equal(useUIStore.getState().activeSettingsTab, 'developer');
    assert.equal(revealed.at(-1)?.label, 'Developer settings');
    assert.equal(document.activeElement?.id, 'settings-panel');
  });

  test('choosing the section that is already open still brings it back into view', async () => {
    await renderSettings();
    const appearance = screen.getByRole('button', { name: 'Appearance & Display' });
    await act(async () => { fireEvent.click(appearance); });
    assert.equal(revealed.length, 1, 'selecting the open section re-reveals it instead of doing nothing');
    assert.equal(revealed[0].label, 'Appearance & Display settings');
  });

  test("Appearance's Reduced motion setting also turns the jump into an instant move", async () => {
    // The operating system did not ask for less motion, the app did (Settings → Appearance).
    useUIStore.setState({ activeSettingsTab: 'appearance', language: 'en', reduceMotion: true });
    await renderSettings();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Developer' })); });
    assert.equal(revealed.at(-1)?.label, 'Developer settings');
    assert.equal(behaviors.at(-1), 'auto', 'the app setting is honoured, not just prefers-reduced-motion');
    useUIStore.setState({ reduceMotion: false });
  });

  test('a search that hides groups leaves the open panel and its focus alone', async () => {
    await renderSettings();
    await act(async () => { fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'zzz-no-such-setting' } }); });
    assert.deepEqual(revealed, []);
    assert.equal(screen.getByRole('region', { name: 'Appearance & Display settings' }).id, 'settings-panel');
  });
});
