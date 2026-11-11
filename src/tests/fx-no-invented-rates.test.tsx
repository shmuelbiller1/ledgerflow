/**
 * L-187: exchange rates are never made up. When the rate service can't be reached the server
 * says so (no fallback numbers that could reach the books), and the converter shows no amount.
 */
import { stubFetchWithBodies } from './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { FxService } from '../server/services/FxService';
import CurrencyConverter from '../components/finance/CurrencyConverter';
import { setComponentWorkspace } from './helpers/componentFixtures';

const realTransport = FxService.transport;
const realTimeout = FxService.timeoutMs;
afterEach(() => { FxService.transport = realTransport; FxService.timeoutMs = realTimeout; cleanup(); });

test('the rate service is down: an error, not a guessed rate', async () => {
  FxService.transport = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(FxService.getRate('USD', 'NOK'), /not available/);
  await assert.rejects(FxService.getRatesForBase('USD'), /not available/);
  assert.equal(await FxService.getRate('EUR', 'EUR'), 1, 'the same currency needs no rate');
});

test('a live rate is used as given', async () => {
  FxService.transport = async () => ({ rates: { SEK: 11.2 } });
  assert.equal(await FxService.getRate('USD', 'SEK'), 11.2);
});

test('#629: a rate service that never answers is "not available" within the deadline, not a hang', async () => {
  FxService.transport = () => new Promise(() => { /* never settles */ });
  FxService.timeoutMs = 30;
  const started = Date.now();
  await assert.rejects(FxService.getRate('USD', 'DKK'), /not available/);
  await assert.rejects(FxService.getRatesForBase('USD'), /not available/);
  assert.ok(Date.now() - started < 2000, 'both calls gave up at the deadline');
});

test('#629: one stalled currency does not hold up the others, and no rate is invented for it', async () => {
  FxService.timeoutMs = 30;
  FxService.transport = url => (url.endsWith('/CHF') ? new Promise(() => { /* stalls */ }) : Promise.resolve({ rates: { USD: 1.25 } }));
  const settled = await Promise.allSettled([FxService.getRate('GBP', 'USD'), FxService.getRate('CHF', 'USD')]);
  assert.deepEqual(settled.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal((settled[0] as PromiseFulfilledResult<number>).value, 1.25);
});

test('#629: an answer with no usable rates table is "not available", never a success carrying nothing', async () => {
  for (const body of [{}, { rates: null }, { rates: [] }, { rates: { SEK: 'x', nok: 3, ZAR: -1 } }, null, 'oops']) {
    FxService.transport = async () => body;
    await assert.rejects(FxService.getRatesForBase('USD'), /not available/);
  }
  FxService.transport = async () => ({ rates: { SEK: 11.2, bad: 1, NOK: Number.NaN } });
  assert.deepEqual(await FxService.getRatesForBase('USD'), { SEK: 11.2 });
});

test('#629: the real transport is the checked fetch, limited to the rate host', async () => {
  const source = (await import('node:fs')).readFileSync('src/server/services/FxService.ts', 'utf8');
  assert.match(source, /safeFetch\(url, \{ allowedHostnames: \[RATE_HOST\], timeoutMs \}\)/);
  assert.ok(!/from 'axios'/.test(source));
});

test('the converter shows no amount and says why when there are no rates', async () => {
  setComponentWorkspace('owner');
  stubFetchWithBodies(503, { error: 'Exchange rates for USD are not available right now' });
  render(<CurrencyConverter />);
  await waitFor(() => assert.ok(screen.getByRole('status')));
  assert.match(screen.getByRole('status').textContent || '', /not available/);
  assert.ok(screen.getByText(/— EUR/));
});
