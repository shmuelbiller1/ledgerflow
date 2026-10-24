/**
 * A-138 screen: Israeli bank and branch codes. The table names the banks by their Bank of
 * Israel code, an IBAN is split and its bank named, and a retired code is refused in words.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import IsraeliBankCodesReportView from '../components/reporting/IsraeliBankCodesReportView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

describe('Israeli bank codes screen', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('names Bank Hapoalim from an IBAN, finds Leumi by Hebrew search, refuses the retired code 13', () => {
    stubFetch(404);
    setComponentWorkspace('owner');
    render(<IsraeliBankCodesReportView />);

    const hapoalim = screen.getByRole('rowheader', { name: '12' }).parentElement!;
    assert.match(hapoalim.textContent || '', /Bank Hapoalim/);
    assert.match(hapoalim.textContent || '', /הפועלים/);

    fireEvent.change(screen.getByLabelText('Israeli IBAN to check'), { target: { value: 'IL090123450000000123456' } });
    assert.match(screen.getByRole('status').textContent || '', /Bank 12 — Bank Hapoalim/);
    assert.match(screen.getByRole('status').textContent || '', /branch 345/);

    fireEvent.change(screen.getByLabelText('Bank code'), { target: { value: '13' } });
    fireEvent.change(screen.getByLabelText('Branch code'), { target: { value: '63' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '123456' } });
    assert.match(screen.getByRole('alert').textContent || '', /no longer holds accounts/);

    fireEvent.change(screen.getByLabelText('Search banks'), { target: { value: 'בנק לאומי' } });
    assert.match(screen.getByRole('rowheader', { name: '10' }).parentElement!.textContent || '', /Leumi/);
  });
});
