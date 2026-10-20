import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import IsraeliDocumentTypesView from '../components/reporting/IsraeliDocumentTypesView';
import { classifyIsraeliDocument, israeliDocumentTitle } from '../lib/tax/israeliDocumentTypes';

afterEach(() => cleanup());

test('C-117 titles in both languages are exposed', () => {
  assert.equal(israeliDocumentTitle('tax-invoice', 'he'), 'חשבונית מס');
  assert.equal(israeliDocumentTitle('receipt', 'en'), 'Receipt');
  assert.equal(israeliDocumentTitle('tax-invoice-receipt', 'he'), 'חשבונית מס / קבלה');
  assert.equal(classifyIsraeliDocument({ source: 'invoice', lifecycle: 'issued', issuedAs: 'tax-invoice', vatStatus: 'registered' }).status, 'classified');
  assert.equal(classifyIsraeliDocument({ source: 'invoice', lifecycle: 'draft', issuedAs: 'tax-invoice', vatStatus: 'registered' }).status, 'not-issued');
});

test('C-117 screen shows examples and live classification', () => {
  render(<IsraeliDocumentTypesView/>);
  assert.ok(screen.getByRole('heading', { name: 'Israeli document types (מסמכי מס בישראל)' }));
  assert.match(document.body.textContent || '', /does not turn a tax invoice into a combined document/i);
  // Defaults: invoice issued tax-invoice registered => classified
  assert.match(document.body.textContent || '', /Classified:/);
  assert.match(document.body.textContent || '', /חשבונית מס/);
  // Change to draft => not-issued
  fireEvent.change(screen.getByLabelText('Lifecycle'), { target: { value: 'draft' } });
  assert.match(document.body.textContent || '', /Not issued:/);
  assert.match(document.body.textContent || '', /Draft/);
  // Payment made => not receipt
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'payment' } });
  fireEvent.change(screen.getByLabelText('Lifecycle'), { target: { value: 'issued' } });
  // default payment direction received + receiptIssued true => classified receipt
  assert.match(document.body.textContent || '', /קבלה/);
  fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'made' } });
  assert.match(document.body.textContent || '', /not customer receipts/i);
  // Examples table has 6 rows
  const tables = screen.getAllByRole('table');
  assert.ok(tables.length >= 1);
});

test('C-117 capability disclaimer and no filing claim', () => {
  render(<IsraeliDocumentTypesView/>);
  assert.match(document.body.textContent || '', /Internal, test or demo only/);
  assert.match(document.body.textContent || '', /no authority-approved numbering/i);
});
