/**
 * Install LedgerFlow (Settings → Appearance): the browser's install offer, kept even when it came
 * before the panel opened; the button installs; otherwise the panel says how.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import InstallAppPanel from '../components/platform/settings/InstallAppPanel';

import { BRAND_NAME } from '../config/brand';
describe(`Install ${BRAND_NAME}`, () => {
  afterEach(() => cleanup());

  test('no offer: says how; an offer made before the panel opened shows the button, which installs', async () => {
    render(<InstallAppPanel />);
    assert.ok(screen.getByText(/install icon at the right of the address bar/));
    cleanup();
    let prompted = 0;
    const offer = Object.assign(new window.Event('beforeinstallprompt', { cancelable: true }), {
      platforms: ['web'], prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    });
    window.dispatchEvent(offer);
    render(<InstallAppPanel />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Install ${BRAND_NAME}` })); });
    assert.equal(prompted, 1);
    assert.ok(screen.getByText(`${BRAND_NAME} is installed on this device.`));
  });
});
