/**
 * A-107 screen: US per diem rates (GSA). A GSA-shaped FY2026 CSV is read by column name, the
 * file's standard rate is checked against A-76's built-in row, and a wrong file is refused.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import GsaPerDiemReportView from '../components/reporting/GsaPerDiemReportView';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

const FY26 = [
  'State,Destination,County / Location Defined,Season Begin,Season End,FY26 Lodging Rate,FY26 MIE',
  ',"Standard CONUS rate applies to all counties not specifically listed.",,,,110,68',
  'TX,Houston,"Montgomery / Fort Bend / Harris",,,128,80',
].join('\n');

describe('GSA per diem screen', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('reads the GSA file, agrees the standard rate with A-76, and refuses a wrong file', async () => {
    stubFetch(404);
    setComponentWorkspace('owner');
    render(<GsaPerDiemReportView />);

    fireEvent.change(screen.getByLabelText('GSA per diem rates CSV'), {
      target: { files: [new File([FY26], 'FY2026_PerDiemMasterRatesFile.csv', { type: 'text/csv' })] },
    });
    assert.match((await screen.findByRole('status')).textContent || '', /1 localities.*fiscal year 2026/);
    assert.match((await screen.findByRole('status')).textContent || '', /agrees with the built-in expense-claim table/);
    const houston = screen.getByRole('rowheader', { name: 'Houston, TX' }).parentElement!;
    assert.match(houston.textContent || '', /\$80\.00/);
    assert.match(houston.textContent || '', /\$128\.00/);

    fireEvent.change(screen.getByLabelText('GSA per diem rates CSV'), {
      target: { files: [new File(['a,b\n1,2'], 'not-gsa.csv', { type: 'text/csv' })] },
    });
    assert.match((await screen.findByRole('alert')).textContent || '', /No header row with State and Destination/);
  });
});
