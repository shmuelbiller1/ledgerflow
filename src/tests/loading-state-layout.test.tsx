import './helpers/dom';
import React from 'react';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { render, cleanup, screen } from '@testing-library/react';
import { LoadingState } from '../components/ui/LoadingState';

afterEach(cleanup);
test('list loading reserves rows, announces one named status and has no pretend controls or amounts', () => {
  const { container } = render(<LoadingState what="invoices" />);
  assert.equal(screen.getAllByRole('status').length, 1);
  assert.equal(screen.getByRole('status').textContent, 'Loading invoices…');
  assert.equal(container.querySelectorAll('button,input,select,table').length, 0);
  assert.ok(container.querySelector('[aria-hidden="true"]'));
  assert.equal(container.querySelectorAll('[aria-hidden="true"] [style]').length, 6);
});
test('the full-page books loader reserves a larger content footprint', () => {
  const { container } = render(<LoadingState what="your books" rows={12} />);
  assert.equal(container.querySelectorAll('[aria-hidden="true"] [style]').length, 13);
});
