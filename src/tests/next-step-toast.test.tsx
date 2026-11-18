import './helpers/dom';
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { showSavedToast } from '../components/common/NextStepToast';
import { invoiceSavedSteps, type SavedStep } from '../lib/nextSteps';

/**
 * The toast after a save asks what comes next, and the answer has to be pressable.
 *
 * `toast.custom(id => …)` is where the offer is drawn, so these tests take the toast apart at that seam: the
 * buttons are real buttons with the labels the steps carry, a press runs the one step it names and closes the
 * toast first, and a document with nothing left to do gets a sentence rather than an empty gap where buttons go.
 */
afterEach(() => {
  cleanup();
  mock.restoreAll();
});

function captureToast() {
  let draw: ((id: string | number) => React.ReactElement) | null = null;
  const dismissed: unknown[] = [];
  const ran: Array<SavedStep['action']> = [];
  mock.method(toast, 'custom', (jsx: (id: string | number) => React.ReactElement) => {
    draw = jsx;
    return 'toast-1';
  });
  mock.method(toast, 'dismiss', (id?: string | number) => {
    dismissed.push(id);
  });
  return {
    dismissed,
    ran,
    run: (action: SavedStep['action']) => {
      ran.push(action);
    },
    view(id: string | number = 'toast-1') {
      assert.ok(draw, 'the toast is drawn by toast.custom, or there is nothing to press');
      const drawNow = draw;
      return drawNow(id);
    },
  };
}

test('a saved draft offers send, payment and new invoice as buttons, in that order', () => {
  const capture = captureToast();
  showSavedToast('Invoice 1042 saved', invoiceSavedSteps({ status: 'draft', amountCents: 10_000, amountPaidCents: 0 }), capture.run);
  render(capture.view());

  const buttons = screen.getAllByRole('button').map(button => button.textContent);
  assert.deepEqual(buttons, ['Send it', 'Record a payment', 'New invoice']);
  assert.equal(screen.getByRole('status').getAttribute('aria-label'), 'Invoice 1042 saved', 'the message is what a screen reader hears first');
  assert.deepEqual(capture.ran, [], 'drawing the offer runs nothing');

  fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
  assert.deepEqual(capture.ran, ['payment'], 'the press runs exactly the step it names');
  assert.deepEqual(capture.dismissed, ['toast-1'], 'and the offer closes before the payment screen opens');
});

test('a settled invoice says what happened and offers nothing to press', () => {
  const capture = captureToast();
  showSavedToast('Invoice 1043 saved', invoiceSavedSteps({ status: 'issued', amountCents: 5_000, amountPaidCents: 5_000 }), capture.run);
  render(capture.view());

  assert.equal(screen.getByRole('status').textContent, 'Invoice 1043 saved', 'the sentence is still there when there is nothing left to do');
  assert.deepEqual(screen.queryAllByRole('button'), [], 'and there is no dead button to press');
});

test('each step is a real button that a keyboard can reach', () => {
  const capture = captureToast();
  showSavedToast('Invoice 1044 saved', invoiceSavedSteps({ status: 'draft', amountCents: 1_000, amountPaidCents: 0 }), capture.run);
  render(capture.view());

  const button = screen.getByRole('button', { name: 'New invoice' });
  assert.equal(button.tagName, 'BUTTON', 'a step is a button a person can reach, not a link-shaped div');
  assert.equal(button.getAttribute('type'), 'button', 'a toast must never submit a form behind it');
  button.focus();
  assert.equal(document.activeElement, button, 'Tab lands on the step, and the name is its own text');
});
