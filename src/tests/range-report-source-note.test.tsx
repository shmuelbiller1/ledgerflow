import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { RangeReportSourceNote } from '../components/reporting/RangeReportSourceNote';

afterEach(() => cleanup());

test('the source note: nothing when whole; the server; and an incomplete case that does not blame the entries alone', () => {
  const { rerender } = render(<RangeReportSourceNote source="loaded" testId="n" />);
  assert.equal(screen.queryByTestId('n'), null);
  rerender(<RangeReportSourceNote source="server" testId="n" what="these charts" />);
  assert.match(screen.getByTestId('n').textContent || '', /these charts are read from every entry on the server/);
  rerender(<RangeReportSourceNote source="loaded-incomplete" testId="n" what="these charts" />);
  const text = screen.getByTestId('n').textContent || '';
  assert.match(text, /entries, documents or the lists they use/);
  assert.match(text, /these charts cover only what is loaded, so they may be incomplete/);
  assert.doesNotMatch(text, /loaded entries only/);
});
