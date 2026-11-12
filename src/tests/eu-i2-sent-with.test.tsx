/** EU-I2: the customer portal carries a small "Sent with <brand>" line; the business can turn it off in Branding. */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import CustomerPortalPage from '../components/sales/CustomerPortalPage';
import { BRAND } from '../config/brand';
import { getSupabase } from '../lib/db/client';

const realFetch = globalThis.fetch;
const portal = (extra: object) => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'success', business: 'Acme', customer: 'Bob', currency: 'USD', owedCents: 0, invoices: [], ...extra }), { status: 200 })) as typeof fetch;
  window.history.pushState({}, '', '/c/tok123');
};
afterEach(async () => { cleanup(); globalThis.fetch = realFetch; window.history.pushState({}, '', '/'); await getSupabase().auth.dispose(); });

test('EU-I2: "Sent with" is shown by default, linked to the product', async () => {
  portal({ poweredBy: true });
  render(<CustomerPortalPage />);
  await waitFor(() => assert.ok(screen.getByText(/Sent with/)));
  assert.equal(screen.getByRole('link', { name: BRAND.name }).getAttribute('href'), `https://${BRAND.domain}`);
});

test('EU-I2: turned off, the line is not there', async () => {
  portal({ poweredBy: false });
  render(<CustomerPortalPage />);
  await waitFor(() => assert.ok(screen.getByText(/Invoices for/)));
  assert.equal(screen.queryByText(/Sent with/), null);
});
