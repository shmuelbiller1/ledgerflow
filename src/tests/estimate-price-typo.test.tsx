/**
 * AF-010: the estimate price box takes any text. Since parseAmountToCents throws on text that is not one
 * amount, a typo such as '1.2.3' threw inside onChange and the box stopped taking keys. The price is now read
 * with readAmountCents: the text is kept, the line has no amount and cannot be saved until it reads.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EstimateLinesEditor } from '../components/sales/EstimateLinesEditor';
import { estimateLinesProblem } from '../lib/estimateLines';

afterEach(() => cleanup());

test('a mistyped price is kept as typed, adds nothing to the total and blocks saving', () => {
  let lines: Array<Record<string, unknown>> = [{ id: 'e1', description: 'Setup', quantity: 2, quantityText: '2', rateCents: 0, amountCents: 0, accountId: '', priceText: '' }];
  function Harness() {
    const [state, setState] = React.useState(lines);
    return <EstimateLinesEditor lines={state as never} onChange={next => { lines = next as never; setState(lines); }} currency="USD" />;
  }
  render(<Harness />);
  const price = () => screen.getByLabelText(/^Price, line 1/) as HTMLInputElement;
  fireEvent.change(price(), { target: { value: '1.2.3' } });
  assert.equal(price().value, '1.2.3');
  assert.equal(lines[0].priceText, '1.2.3');
  assert.equal(lines[0].amountCents, 0);
  assert.match(String(estimateLinesProblem(lines as never)), /Enter the price/);
  fireEvent.change(price(), { target: { value: '12.50' } });
  assert.deepEqual([lines[0].rateCents, lines[0].amountCents], [1250, 2500]);
  assert.doesNotMatch(String(estimateLinesProblem(lines as never)), /Enter the price/);
});
